//! Postflop tête-à-tête : construction de l'arbre depuis la configuration Spin, puis lecture
//! d'un nœud résolu (stratégie, CEV de chaque action, équité, EQR) pour l'interface.
//!
//! Unités : le moteur travaille en entiers ; 1 bb = 100 unités. Tout ce qui sort d'ici est en bb.

use super::ranges::{self, cell_of, combo_name};
use postflop_solver::{
    compute_average, compute_exploitability, finalize, holes_to_strings, solve_step, Range, Action, ActionTree, BetSizeOptions, BoardState, CardConfig, DonkSizeOptions,
    PostFlopGame, TreeConfig, NOT_DEALT,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const UNIT: f64 = 100.0;

/// Paramètres d'un solve postflop. Les tailles sont en % du pot, la relance en multiple de la
/// mise précédente. `extra_*` : tailles réellement jouées dans la main, ajoutées pour ce solve.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PostflopConfig {
    pub board: String,
    /// pot au début de la street de départ (bb)
    pub pot: f64,
    /// tapis effectif restant (bb)
    pub stack: f64,
    pub oop_range: String,
    pub ip_range: String,
    pub oop_label: String,
    pub ip_label: String,
    /// tailles de mise par street [flop, turn, river]
    pub bet_sizes: [Vec<f64>; 3],
    pub raise_sizes: Vec<f64>,
    pub donk: bool,
    /// tailles jouées par street (0 flop, 1 turn, 2 river) et par joueur [OOP, IP]
    #[serde(default)]
    pub extra_bets: Vec<[Vec<f64>; 2]>,
    #[serde(default)]
    pub extra_raises: Vec<[Vec<f64>; 2]>,
    /// précision cible, en % du pot
    pub precision: f64,
    pub max_iters: u32,
    /// mise forcée à tapis si le SPR après call tombe sous ce seuil
    pub force_allin: f64,
    /// contexte préflop affiché dans la barre du haut (tapis, décisions qui mènent au flop)
    #[serde(default)]
    pub context: Option<serde_json::Value>,
}

impl Default for PostflopConfig {
    fn default() -> Self {
        PostflopConfig {
            board: String::new(),
            pot: 4.0,
            stack: 21.0,
            oop_range: String::new(),
            ip_range: String::new(),
            oop_label: "BB".into(),
            ip_label: "BTN".into(),
            // profil « Standard » : 4 tailles au flop, 2 au turn et à la river. Les 4 tailles sur
            // les trois streets coûtent ~25 Go depuis un flop à 25 bb (mesuré sur Ryzen 5800X).
            bet_sizes: [vec![33.0, 55.0, 100.0, 150.0], vec![55.0, 100.0], vec![55.0, 100.0]],
            raise_sizes: vec![3.0],
            donk: true,
            extra_bets: vec![],
            extra_raises: vec![],
            precision: 0.3,
            max_iters: 1000,
            force_allin: 0.15,
            context: None,
        }
    }
}

fn fmt_num(v: f64) -> String {
    let s = format!("{:.2}", v);
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

fn sizes(bets: &[f64], extra: Option<&Vec<f64>>) -> String {
    let mut v: Vec<f64> = bets.to_vec();
    if let Some(e) = extra {
        v.extend(e.iter().copied());
    }
    v.retain(|x| *x > 0.0);
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v.dedup_by(|a, b| (*a - *b).abs() < 0.5);
    let mut parts: Vec<String> = v.iter().map(|x| format!("{}%", fmt_num(*x))).collect();
    parts.push("a".into());
    parts.join(", ")
}

fn raises(r: &[f64], extra: Option<&Vec<f64>>) -> String {
    let mut v: Vec<f64> = r.to_vec();
    if let Some(e) = extra {
        v.extend(e.iter().copied());
    }
    v.retain(|x| *x > 1.0);
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v.dedup_by(|a, b| (*a - *b).abs() < 0.05);
    let mut parts: Vec<String> = v.iter().map(|x| format!("{}x", fmt_num(*x))).collect();
    parts.push("a".into());
    parts.join(", ")
}

pub fn build(cfg: &PostflopConfig) -> Result<PostFlopGame, String> {
    build_with_ranges(cfg, [ranges::parse(&cfg.oop_range)?, ranges::parse(&cfg.ip_range)?])
}

pub fn build_with_ranges(cfg: &PostflopConfig, [oop, ip]: [Range; 2]) -> Result<PostFlopGame, String> {
    let board = ranges::parse_cards(&cfg.board)?;
    if board.len() < 3 || board.len() > 5 {
        return Err("le board doit compter 3, 4 ou 5 cartes".into());
    }
    if oop.is_empty() || ip.is_empty() {
        return Err("les deux ranges doivent contenir au moins une main".into());
    }
    if cfg.pot <= 0.0 || cfg.stack <= 0.0 {
        return Err("pot et tapis doivent être positifs".into());
    }
    let card_config = CardConfig {
        range: [oop, ip],
        flop: [board[0], board[1], board[2]],
        turn: board.get(3).copied().unwrap_or(NOT_DEALT),
        river: board.get(4).copied().unwrap_or(NOT_DEALT),
    };
    let initial_state = match board.len() {
        3 => BoardState::Flop,
        4 => BoardState::Turn,
        _ => BoardState::River,
    };
    // tailles jouées indexées par street absolue (0 = flop), comme les options du moteur
    let street = |k: usize| -> Result<[BetSizeOptions; 2], String> {
        let eb = cfg.extra_bets.get(k);
        let er = cfg.extra_raises.get(k);
        let mk = |p: usize| BetSizeOptions::try_from((sizes(&cfg.bet_sizes[k], eb.map(|x| &x[p])).as_str(), raises(&cfg.raise_sizes, er.map(|x| &x[p])).as_str()));
        Ok([mk(0)?, mk(1)?])
    };
    let donk = |k: usize| -> Result<Option<DonkSizeOptions>, String> {
        if !cfg.donk {
            return Ok(None);
        }
        Ok(Some(DonkSizeOptions::try_from(sizes(&cfg.bet_sizes[k], cfg.extra_bets.get(k).map(|x| &x[0])).as_str())?))
    };
    let tree_config = TreeConfig {
        initial_state,
        starting_pot: (cfg.pot * UNIT).round() as i32,
        effective_stack: (cfg.stack * UNIT).round() as i32,
        rake_rate: 0.0,
        rake_cap: 0.0,
        flop_bet_sizes: street(0)?,
        turn_bet_sizes: street(1)?,
        river_bet_sizes: street(2)?,
        turn_donk_sizes: donk(1)?,
        river_donk_sizes: donk(2)?,
        add_allin_threshold: 1.5,
        force_allin_threshold: cfg.force_allin,
        // seules les tailles quasi identiques sont fusionnées : une taille jouée doit rester dans l'arbre
        merging_threshold: 0.01,
    };
    let tree = ActionTree::new(tree_config)?;
    PostFlopGame::with_config(card_config, tree)
}

fn bb(x: i32) -> f64 {
    x as f64 / UNIT
}

/// Libellé et montant (bb, total de la street pour une relance) d'une action.
pub fn action_json(a: &Action, pot: i32) -> Value {
    let pct = |x: i32| if pot > 0 { x as f64 / pot as f64 * 100.0 } else { 0.0 };
    match *a {
        Action::Fold => json!({"kind": "fold", "label": "Fold"}),
        Action::Check => json!({"kind": "check", "label": "Check"}),
        Action::Call => json!({"kind": "call", "label": "Call"}),
        Action::Bet(x) => json!({"kind": "bet", "label": format!("Bet {}%", pct(x).round()), "amount": bb(x), "pct": pct(x)}),
        Action::Raise(x) => json!({"kind": "raise", "label": format!("Raise {}", fmt_num(bb(x))), "amount": bb(x)}),
        Action::AllIn(x) => json!({"kind": "allin", "label": "All-in", "amount": bb(x)}),
        Action::Chance(c) => json!({"kind": "card", "label": crate::model::card_str(c)}),
        Action::None => json!({"kind": "none", "label": "–"}),
    }
}

struct Side {
    cards: Vec<(u8, u8)>,
    weights: Vec<f32>,
    norm: Vec<f32>,
    equity: Vec<f32>,
    ev: Vec<f32>,
}

fn side(game: &PostFlopGame, p: usize) -> Side {
    Side {
        cards: game.private_cards(p).to_vec(),
        weights: game.weights(p).to_vec(),
        norm: game.normalized_weights(p).to_vec(),
        equity: game.equity(p),
        ev: game.expected_values(p),
    }
}

/// Rivers re-résolues d'un solve enregistré sans river : clé = chemin jusqu'à la carte river
/// comprise ; valeur = sous-jeu résolu et son exploitabilité (% du pot de la river).
pub type Rivers = std::collections::HashMap<Vec<usize>, (PostFlopGame, f64)>;

/// Résout la river qui suit le nœud de hasard courant (carte `card`), à partir des ranges
/// exactes atteintes à ce nœud. Les tailles river du solve d'origine sont reprises.
pub fn solve_river(game: &PostFlopGame, card: u8, cfg: &PostflopConfig) -> Result<(PostFlopGame, f64), String> {
    let mut board = game.current_board();
    board.push(card);
    let tb = game.total_bet_amount();
    let pot = game.tree_config().starting_pot + tb[0] + tb[1];
    let stack = game.tree_config().effective_stack - tb[0].max(tb[1]);
    let range = |p: usize| Range::from_hands_weights(game.private_cards(p), game.weights(p));
    let sub_cfg = PostflopConfig {
        board: board.iter().map(|&c| crate::model::card_str(c)).collect(),
        pot: bb(pot),
        stack: bb(stack),
        ..cfg.clone()
    };
    let mut sub = build_with_ranges(&sub_cfg, [range(0)?, range(1)?])?;
    sub.allocate_memory(false);
    let target = pot as f32 * (cfg.precision as f32) / 100.0;
    let mut e = f32::MAX;
    for i in 0..cfg.max_iters.max(200) {
        solve_step(&sub, i);
        if i % 10 == 9 {
            e = compute_exploitability(&sub);
            if e <= target {
                break;
            }
        }
    }
    finalize(&mut sub);
    Ok((sub, (e / pot as f32 * 100.0) as f64))
}

/// Actions par catégorie de main (onglet Breakdown) : poids, mélange d'actions et CEV moyenne.
fn breakdown(me: &Side, strat: &[f32], na: usize, board: &[u8]) -> Value {
    let n = me.cards.len();
    let mut rows: Vec<(String, bool, f64, Vec<f64>, f64)> = ranges::MADE
        .iter()
        .map(|m| (m.to_string(), false, 0.0, vec![0.0; na], 0.0))
        .chain(ranges::DRAWS.iter().map(|d| (d.to_string(), true, 0.0, vec![0.0; na], 0.0)))
        .collect();
    let nm = ranges::MADE.len();
    let mut cells: Vec<Vec<usize>> = vec![vec![]; rows.len()];
    for i in 0..n {
        let w = me.norm[i] as f64;
        if w <= 0.0 {
            continue;
        }
        let (c1, c2) = me.cards[i];
        let (made, draws) = ranges::classify(c1, c2, board);
        let ev = me.ev[i] as f64 / UNIT;
        for idx in std::iter::once(made).chain(draws.into_iter().map(|d| nm + d)) {
            let r = &mut rows[idx];
            r.2 += w;
            r.4 += w * ev;
            for a in 0..na {
                r.3[a] += w * strat[a * n + i] as f64;
            }
            let cell = cell_of(c1, c2);
            if !cells[idx].contains(&cell) {
                cells[idx].push(cell);
            }
        }
    }
    let total: f64 = me.norm.iter().map(|&x| x as f64).sum();
    json!(rows
        .into_iter()
        .zip(cells)
        .filter(|(r, _)| r.2 > 0.0)
        .map(|((name, draw, w, s, ev), cells)| json!({
            "name": name, "draw": draw, "combos": w, "pct": if total > 0.0 { w / total } else { 0.0 },
            "strategy": s.iter().map(|x| x / w).collect::<Vec<_>>(), "ev": ev / w, "cells": cells,
        }))
        .collect::<Vec<_>>())
}

/// Effet de chaque carte tenue sur la range adverse (onglet Blockers) : part des combos adverses
/// « valeur » (équité ≥ 50 %) et « trash » (équité < 50 %) qu'elle retire.
fn blockers(opp: &Side, board: &[u8]) -> Value {
    let (mut val, mut trash) = (0.0f64, 0.0f64);
    let mut per = [(0.0f64, 0.0f64); 52];
    for (i, &(a, b)) in opp.cards.iter().enumerate() {
        let w = opp.norm[i] as f64;
        if w <= 0.0 {
            continue;
        }
        let v = opp.equity[i] >= 0.5;
        if v { val += w } else { trash += w }
        for c in [a, b] {
            if v { per[c as usize].0 += w } else { per[c as usize].1 += w }
        }
    }
    json!((0..52u8)
        .filter(|c| !board.contains(c))
        .map(|c| json!({
            "card": crate::model::card_str(c),
            "value": if val > 0.0 { per[c as usize].0 / val } else { 0.0 },
            "trash": if trash > 0.0 { per[c as usize].1 / trash } else { 0.0 },
        }))
        .collect::<Vec<_>>())
}

/// Vue d'un nœud : `history` = indices d'actions et cartes distribuées depuis la racine.
/// Si le solve a été enregistré sans river, la river demandée est re-résolue (et gardée dans `rivers`).
pub fn node_view(game: &mut PostFlopGame, history: &[usize], cfg: &PostflopConfig, mut rivers: Option<&mut Rivers>) -> Result<Value, String> {
    game.back_to_root();
    for (k, &a) in history.iter().enumerate() {
        if game.is_terminal_node() {
            return Err(format!("chemin invalide (fin de main à l'étape {k})"));
        }
        if game.is_chance_node() {
            if a >= 52 || game.possible_cards() & (1u64 << a) == 0 {
                return Err("carte impossible à cet endroit".into());
            }
            // un solve allégé n'a plus les streets suivantes : le moteur paniquerait
            let dealing_turn = game.current_board().len() == 3;
            match game.storage_mode() {
                BoardState::Flop => return Err("solve allégé : seul le flop est conservé".into()),
                BoardState::Turn if !dealing_turn => {
                    let Some(rv) = rivers.as_deref_mut() else {
                        return Err("la river de ce solve n'est pas conservée".into());
                    };
                    let key = history[..=k].to_vec();
                    if !rv.contains_key(&key) {
                        let solved = solve_river(game, a as u8, cfg)?;
                        rv.insert(key.clone(), solved);
                    }
                    let (sub, exploit) = rv.get_mut(&key).unwrap();
                    let exploit = *exploit;
                    let mut v = node_view(sub, &history[k + 1..], cfg, None)?;
                    v["resolved_river"] = json!({ "exploit": exploit });
                    return Ok(v);
                }
                _ => {}
            }
        } else if a >= game.available_actions().len() {
            return Err("action inconnue à cet endroit".into());
        }
        game.play(a);
    }
    let board: Vec<String> = game.current_board().iter().map(|&c| crate::model::card_str(c)).collect();
    let tb = game.total_bet_amount();
    let pot = game.tree_config().starting_pot + tb[0] + tb[1];
    let stack = game.tree_config().effective_stack;
    let base = json!({
        "board": board, "pot": bb(pot), "stacks": [bb(stack - tb[0]), bb(stack - tb[1])],
        "labels": [cfg.oop_label, cfg.ip_label],
    });
    if game.is_terminal_node() {
        let mut v = base;
        v["terminal"] = json!(true);
        return Ok(v);
    }
    if game.is_chance_node() {
        let pc = game.possible_cards();
        let mut v = base;
        v["chance"] = json!(true);
        let dealing_turn = game.current_board().len() == 3;
        // river non enregistrée : elle sera re-résolue à la demande
        v["stored"] = json!(game.storage_mode() != BoardState::Flop);
        v["resolve_on_demand"] = json!(game.storage_mode() == BoardState::Turn && !dealing_turn);
        v["cards"] = json!((0..52u8).filter(|c| pc & (1u64 << c) != 0).map(|c| json!({"id": c, "card": crate::model::card_str(c)})).collect::<Vec<_>>());
        return Ok(v);
    }
    game.cache_normalized_weights();
    let player = game.current_player();
    let actions = game.available_actions();
    let strat = game.strategy();
    let detail = game.expected_values_detail(player);
    let sides = [side(game, 0), side(game, 1)];
    let me = &sides[player];
    let n = me.cards.len();
    let na = actions.len();
    let names = holes_to_strings(&me.cards).unwrap_or_default();

    // fréquences globales et grille
    let tot_norm: f64 = me.norm.iter().map(|&x| x as f64).sum();
    let mut freq = vec![0.0f64; na];
    let mut grid_w = vec![0.0f64; 169];
    let mut grid_s = vec![vec![0.0f64; na]; 169];
    let mut grid_ev = vec![0.0f64; 169];
    let mut grid_eq = vec![0.0f64; 169];
    let mut hands = Vec::with_capacity(n);
    for i in 0..n {
        let (c1, c2) = me.cards[i];
        let w = me.norm[i] as f64;
        let s: Vec<f64> = (0..na).map(|a| strat[a * n + i] as f64).collect();
        let e: Vec<f64> = (0..na).map(|a| detail[a * n + i] as f64 / UNIT).collect();
        if w > 0.0 {
            let cell = cell_of(c1, c2);
            grid_w[cell] += w;
            for a in 0..na {
                freq[a] += w * s[a];
                grid_s[cell][a] += w * s[a];
            }
            grid_ev[cell] += w * me.ev[i] as f64 / UNIT;
            grid_eq[cell] += w * me.equity[i] as f64;
        }
        if me.weights[i] > 0.0 {
            let eq = me.equity[i] as f64;
            let ev = me.ev[i] as f64 / UNIT;
            hands.push(json!({
                "combo": names.get(i).cloned().unwrap_or_else(|| combo_name(c1, c2)),
                "cell": cell_of(c1, c2),
                "weight": me.weights[i],
                "norm": w,
                "strategy": s,
                "evs": e,
                "ev": ev,
                "equity": eq,
                "eqr": if eq > 0.0 { Some(ev / (eq * bb(pot))) } else { None },
            }));
        }
    }
    if tot_norm > 0.0 {
        for f in &mut freq {
            *f /= tot_norm;
        }
    }
    let grid: Vec<Value> = (0..169)
        .map(|c| {
            if grid_w[c] <= 0.0 {
                return Value::Null;
            }
            let w = grid_w[c];
            json!({
                "w": w,
                "s": grid_s[c].iter().map(|x| x / w).collect::<Vec<_>>(),
                "ev": grid_ev[c] / w,
                "eq": grid_eq[c] / w,
            })
        })
        .collect();
    let summary: Vec<Value> = sides
        .iter()
        .map(|sd| {
            let eq = compute_average(&sd.equity, &sd.norm) as f64;
            let ev = compute_average(&sd.ev, &sd.norm) as f64 / UNIT;
            let combos: f64 = sd.norm.iter().map(|&x| x as f64).sum();
            let mut eqs: Vec<(f32, f32)> = sd.equity.iter().copied().zip(sd.norm.iter().copied()).filter(|x| x.1 > 0.0).collect();
            eqs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
            let tot: f64 = eqs.iter().map(|x| x.1 as f64).sum();
            let mut dist = Vec::with_capacity(101);
            if !eqs.is_empty() {
                let (mut acc, mut k) = (0.0f64, 0usize);
                for p in 0..=100 {
                    let target = tot * p as f64 / 100.0;
                    while k < eqs.len() - 1 && acc + (eqs[k].1 as f64) < target {
                        acc += eqs[k].1 as f64;
                        k += 1;
                    }
                    dist.push(eqs[k].0 as f64);
                }
            }
            json!({
                "equity": eq, "ev": ev, "combos": combos,
                "eqr": if eq > 0.0 { Some(ev / (eq * bb(pot))) } else { None },
                "distribution": dist,
            })
        })
        .collect();
    let mut v = base;
    v["player"] = json!(player);
    v["actions"] = json!(actions.iter().map(|a| action_json(a, pot)).collect::<Vec<_>>());
    v["freq"] = json!(freq);
    v["grid"] = json!(grid);
    v["hands"] = json!(hands);
    v["summary"] = json!(summary);
    let board_cards = game.current_board();
    v["breakdown"] = breakdown(me, &strat, na, &board_cards);
    v["action_ev"] = json!((0..na)
        .map(|a| {
            let (mut num, mut den) = (0.0f64, 0.0f64);
            for i in 0..n {
                let m = me.norm[i] as f64 * strat[a * n + i] as f64;
                num += m * detail[a * n + i] as f64 / UNIT;
                den += m;
            }
            json!({ "combos": den, "ev": if den > 0.0 { Some(num / den) } else { None } })
        })
        .collect::<Vec<_>>());
    v["blockers"] = blockers(&sides[player ^ 1], &board_cards);
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;
    use postflop_solver::{load_data_from_std_read, save_data_into_std_write};

    fn small() -> PostflopConfig {
        PostflopConfig {
            board: "Td9d6hQc2s".into(),
            pot: 4.0,
            stack: 10.0,
            oop_range: "88+,AT+,KQ".into(),
            ip_range: "22+,A2s+,KTs+,QJs,T9s".into(),
            bet_sizes: [vec![33.0, 55.0, 100.0, 150.0], vec![33.0, 55.0, 100.0, 150.0], vec![33.0, 55.0, 100.0, 150.0]],
            ..Default::default()
        }
    }

    #[test]
    fn builds_spin_tree() {
        let mut g = build(&small()).unwrap();
        g.allocate_memory(false);
        let acts = g.available_actions();
        // check + 33 / 55 / 100 / 150 % + all-in (150 % de 4 bb = 6 bb < 10 bb)
        assert_eq!(acts.len(), 6, "{acts:?}");
        assert_eq!(acts[0], Action::Check);
        assert!(matches!(acts.last(), Some(Action::AllIn(1000))));
    }

    #[test]
    fn river_solve_converges_and_conserves_chips() {
        let cfg = small();
        let mut g = build(&cfg).unwrap();
        g.allocate_memory(false);
        let target = cfg.pot as f32 * UNIT as f32 * 0.003;
        let mut e = f32::MAX;
        for i in 0..2000 {
            solve_step(&g, i);
            if i % 10 == 9 {
                e = compute_exploitability(&g);
                if e <= target {
                    break;
                }
            }
        }
        assert!(e <= target, "exploitabilité {e}");
        finalize(&mut g);
        let v = node_view(&mut g, &[], &cfg, None).unwrap();
        // la somme des CEV des deux joueurs vaut le pot (jeu à somme nulle, sans rake)
        let s = &v["summary"];
        let ev0 = s[0]["ev"].as_f64().unwrap();
        let ev1 = s[1]["ev"].as_f64().unwrap();
        // pondération : l'EV moyenne de chaque range sur ses propres combos ; avec retrait de
        // cartes l'égalité n'est qu'approchée
        assert!((ev0 + ev1 - cfg.pot).abs() < 0.15, "{ev0} + {ev1} != {}", cfg.pot);
        // stratégie : chaque main somme à 1
        for h in v["hands"].as_array().unwrap() {
            let t: f64 = h["strategy"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).sum();
            assert!((t - 1.0).abs() < 1e-3);
        }
    }

    fn solve(g: &mut PostFlopGame, pct: f32) {
        g.allocate_memory(false);
        let target = g.tree_config().starting_pot as f32 * pct / 100.0;
        for i in 0..3000 {
            solve_step(g, i);
            if i % 10 == 9 && compute_exploitability(g) <= target {
                break;
            }
        }
        finalize(g);
    }

    /// Une river re-résolue depuis un fichier flop+turn doit retrouver la river de l'arbre complet.
    #[test]
    fn resolved_river_matches_full_tree() {
        let cfg = PostflopConfig {
            board: "Td9d6hQc".into(),
            pot: 5.0,
            stack: 12.0,
            oop_range: "99-22,AT-A2,KJ-K9,QJ-Q9,J9+,T8+,97+,86+,75+,65,54".into(),
            ip_range: "TT+,AQ+,AT,KQ,QJs,JTs,T9s,98s".into(),
            bet_sizes: [vec![], vec![55.0, 100.0], vec![55.0, 100.0]],
            precision: 0.1,
            ..Default::default()
        };
        let mut full = build(&cfg).unwrap();
        solve(&mut full, 0.1);
        // fichier sans river, relu
        full.set_target_storage_mode(BoardState::Turn).unwrap();
        let mut buf = Vec::new();
        save_data_into_std_write(&full, "", &mut buf, None).unwrap();
        full.set_target_storage_mode(BoardState::River).unwrap();
        let (mut light, _): (PostFlopGame, String) = load_data_from_std_read(&mut buf.as_slice(), None).unwrap();
        let mut rivers = Rivers::new();
        // check, bet 55 %, call, puis river 2s (carte 3)
        let path = [0usize, 1, 1, 3];
        let a = node_view(&mut full, &path, &cfg, None).unwrap();
        let b = node_view(&mut light, &path, &cfg, Some(&mut rivers)).unwrap();
        assert!(b["resolved_river"].is_object(), "{b}");
        let pot = a["pot"].as_f64().unwrap();
        for p in 0..2 {
            let ea = a["summary"][p]["ev"].as_f64().unwrap();
            let eb = b["summary"][p]["ev"].as_f64().unwrap();
            assert!((ea - eb).abs() < 0.01 * pot, "joueur {p} : {ea} vs {eb} (pot {pot})");
        }
        let fa: Vec<f64> = a["freq"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect();
        let fb: Vec<f64> = b["freq"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect();
        for (x, y) in fa.iter().zip(&fb) {
            assert!((x - y).abs() < 0.05, "fréquences {fa:?} vs {fb:?}");
        }
    }

    #[test]
    fn extra_size_is_added() {
        let mut cfg = small();
        cfg.extra_bets = vec![[vec![], vec![]], [vec![], vec![]], [vec![42.0], vec![]]];
        let mut g = build(&cfg).unwrap();
        g.allocate_memory(false);
        assert!(g.available_actions().contains(&Action::Bet(168)), "{:?}", g.available_actions());
    }
}

#[cfg(test)]
mod bench {
    use super::*;
    use postflop_solver::{compute_exploitability, finalize, solve_step};

    /// Flop Spin typique à 25 bb, toutes les tailles du cahier des charges.
    /// `cargo test --release --lib bench_flop -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_flop() {
        let cfg = PostflopConfig {
            board: "9s7h4d".into(),
            pot: 4.5,
            stack: 23.0,
            oop_range: "66-22,A9s-A2s,A9o-A2o,KTs-K2s,KJo-K5o,QJs-Q2s,QJo-Q8o,JTs-J4s,JTo-J8o,T9s-T6s,T9o-T8o,98s-96s,87s-85s,76s-74s,65s-64s,54s-53s,43s".into(),
            ip_range: "22+,A2+,K2s+,K5o+,Q4s+,Q8o+,J6s+,J8o+,T6s+,T8o+,96s+,98o,85s+,87o,74s+,64s+,53s+,43s".into(),
            bet_sizes: [vec![33.0, 55.0, 100.0, 150.0], vec![55.0, 100.0], vec![55.0, 100.0]],
            ..Default::default()
        };
        let mut g = build(&cfg).unwrap();
        let (m, mc) = g.memory_usage();
        println!("mémoire : {:.0} Mo ({:.0} Mo compressé)", m as f64 / 1e6, mc as f64 / 1e6);
        g.allocate_memory(false);
        let t = std::time::Instant::now();
        let pot = g.tree_config().starting_pot as f32;
        for i in 0..2000 {
            solve_step(&g, i);
            if i % 10 == 9 {
                let e = compute_exploitability(&g) / pot * 100.0;
                if i % 50 == 49 || e <= 0.3 {
                    println!("{} it, {:.1} s, exploitabilité {:.3} % du pot", i + 1, t.elapsed().as_secs_f64(), e);
                }
                if e <= 0.3 {
                    break;
                }
            }
        }
        finalize(&mut g);
    }
}

#[cfg(test)]
mod size_probe {
    use super::*;

    /// `cargo test --release --lib probe_tree_sizes -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn probe_tree_sizes() {
        let base = PostflopConfig {
            board: "9s7h4d".into(),
            pot: 4.5,
            stack: 23.0,
            oop_range: "66-22,A9s-A2s,A9o-A2o,KTs-K2s,KJo-K5o,QJs-Q2s,QJo-Q8o,JTs-J4s,JTo-J8o,T9s-T6s,T9o-T8o,98s-96s,87s-85s,76s-74s,65s-64s,54s-53s,43s".into(),
            ip_range: "22+,A2+,K2s+,K5o+,Q4s+,Q8o+,J6s+,J8o+,T6s+,T8o+,96s+,98o,85s+,87o,74s+,64s+,53s+,43s".into(),
            ..Default::default()
        };
        let v = |f: &[f64], t: &[f64], r: &[f64], raise: &[f64]| PostflopConfig {
            bet_sizes: [f.to_vec(), t.to_vec(), r.to_vec()],
            raise_sizes: raise.to_vec(),
            ..base.clone()
        };
        let all = [33.0, 55.0, 100.0, 150.0];
        let variants: Vec<(&str, PostflopConfig)> = vec![
            ("4 / 4 / 4, 3x", base.clone()),
            ("4 / 2 / 2, 3x", v(&all, &[55.0, 100.0], &[55.0, 100.0], &[3.0])),
            ("4 / 2 / 2, all-in", v(&all, &[55.0, 100.0], &[55.0, 100.0], &[])),
            ("4 / 1 / 1, 3x", v(&all, &[100.0], &[100.0], &[3.0])),
            ("4 / 3 / 2, 3x", v(&all, &[33.0, 55.0, 100.0], &[55.0, 100.0], &[3.0])),
            ("2 / 2 / 2, 3x", v(&[33.0, 100.0], &[55.0, 100.0], &[55.0, 100.0], &[3.0])),
            ("turn 4/4, 3x", PostflopConfig { board: "9s7h4d2c".into(), ..base.clone() }),
            ("river 4, 3x", PostflopConfig { board: "9s7h4d2cKh".into(), ..base.clone() }),
        ];
        for (name, cfg) in variants {
            let g = build(&cfg).unwrap();
            let (m, mc) = g.memory_usage();
            println!("{name:<22} {:>8.0} Mo  {:>8.0} Mo compressé", m as f64 / 1e6, mc as f64 / 1e6);
        }
    }
}

#[cfg(test)]
mod tiny_probe {
    use super::*;

    /// Coût d'un petit arbre (valeur postflop pour le préflop) : 12 bb, SB raise 2 / BB call.
    /// `cargo test --release --lib probe_tiny -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn probe_tiny() {
        for (bets, raise) in [(vec![50.0], vec![]), (vec![33.0, 100.0], vec![]), (vec![33.0, 55.0, 100.0, 150.0], vec![3.0])] {
            let cfg = PostflopConfig {
                board: "9s7h4d".into(),
                pot: 4.0,
                stack: 10.0,
                oop_range: "22+,A2+,K2+,Q2+,J4+,T6+,96+,86+,75+,65,54".into(),
                ip_range: "22+,A2+,K2+,Q2+,J2+,T2+,92+,82+,72+,62+,52+,42+,32".into(),
                bet_sizes: [bets.clone(), bets.clone(), bets.clone()],
                raise_sizes: raise.clone(),
                ..Default::default()
            };
            let mut g = build(&cfg).unwrap();
            let (m, _) = g.memory_usage();
            g.allocate_memory(false);
            let t = std::time::Instant::now();
            let pot = g.tree_config().starting_pot as f32;
            let mut it = 0;
            let mut e = 0.0;
            for i in 0..2000 {
                solve_step(&g, i);
                it = i + 1;
                if i % 10 == 9 {
                    e = compute_exploitability(&g) / pot * 100.0;
                    if e <= 0.5 {
                        break;
                    }
                }
            }
            println!("{bets:?} {raise:?} : {:.0} Mo, {it} it, {:.1} s, {e:.2} %", m as f64 / 1e6, t.elapsed().as_secs_f64());
        }
    }
}
