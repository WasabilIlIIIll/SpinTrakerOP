//! Reconstruction d'un spot postflop à partir d'une main importée : pot et tapis en bb,
//! positions OOP / IP, board, tailles réellement jouées et ligne suivie par les joueurs.

use super::postflop::PostflopConfig;
use crate::analysis::{positions, Pos};
use crate::model::{card_str, ActKind, Hand};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct LineAction {
    pub street: u8,
    /// 0 = OOP, 1 = IP
    pub side: u8,
    pub kind: String,
    /// total misé sur la street après l'action (bb)
    pub to: f64,
    /// mise ajoutée par l'action (bb)
    pub amount: f64,
    pub pot_before: f64,
}

/// Action préflop réellement jouée (tuiles du haut de la vue du solve).
#[derive(Debug, Serialize)]
pub struct PreAction {
    pub pos: String,
    /// tapis avant l'action (bb)
    pub stack: f64,
    pub action: String,
}

#[derive(Debug, Serialize)]
pub struct Spot {
    pub config: PostflopConfig,
    pub line: Vec<LineAction>,
    /// cartes du board complet (pour suivre la main au turn / river)
    pub runout: Vec<String>,
    pub hero_side: Option<u8>,
    pub hero_cards: Option<String>,
    pub names: [String; 2],
    pub preflop: String,
    pub pre: Vec<PreAction>,
    /// tapis de départ de chaque joueur (bb), dans l'ordre BTN, SB, BB
    pub stacks: Vec<(String, f64)>,
}

fn pos_name(p: Pos, n: usize) -> &'static str {
    match (p, n) {
        (Pos::Btn, _) => "BTN",
        (Pos::Sb, 2) => "SB",
        (Pos::Sb, _) => "SB",
        (Pos::Bb, _) => "BB",
    }
}

/// Ordre d'action postflop : SB, BB, BTN (en tête-à-tête le bouton est SB et parle en dernier).
fn post_order(p: Pos, n: usize) -> u8 {
    match (p, n) {
        (Pos::Sb, 2) => 2,
        (Pos::Sb, _) => 0,
        (Pos::Bb, _) => 1,
        (Pos::Btn, _) => 2,
    }
}

pub fn from_hand(h: &Hand) -> Result<Spot, String> {
    let n = h.seats.len();
    let bb = if h.bb > 0.0 { h.bb } else { return Err("big blind inconnue".into()) };
    if h.board.len() < 3 {
        return Err("la main s'arrête avant le flop".into());
    }
    let pos = positions(h);
    // mises préflop
    let mut invested = vec![0.0f64; n];
    let mut antes = vec![0.0f64; n];
    let mut folded = vec![false; n];
    let mut allin = vec![false; n];
    let mut pot = 0.0;
    let mut pre = Vec::new();
    let mut max_bet = 0.0f64;
    let mut pre_actions = Vec::new();
    for a in h.actions.iter().filter(|a| a.street == 0) {
        let p = a.p as usize;
        if a.kind == ActKind::Ante {
            pot += a.amount;
            antes[p] += a.amount;
        } else {
            invested[p] += a.amount;
        }
        if a.kind == ActKind::Fold {
            folded[p] = true;
        }
        if a.allin {
            allin[p] = true;
        }
        if !a.kind.is_post() {
            let who = pos_name(pos[p], n);
            let before = h.seats[p].stack - antes[p] - (invested[p] - a.amount);
            pre_actions.push(PreAction {
                pos: who.to_string(),
                stack: (before / bb * 100.0).round() / 100.0,
                action: match a.kind {
                    ActKind::Fold => "Fold".to_string(),
                    ActKind::Check => "Check".to_string(),
                    ActKind::Call if max_bet <= bb + 1e-9 => "Limp".to_string(),
                    ActKind::Call => "Call".to_string(),
                    _ if a.allin => format!("Allin {}", ((invested[p] / bb) * 10.0).round() / 10.0),
                    _ => format!("Raise {}", ((invested[p] / bb) * 10.0).round() / 10.0),
                },
            });
            pre.push(match a.kind {
                ActKind::Fold => format!("{who} fold"),
                ActKind::Check => format!("{who} check"),
                ActKind::Call if max_bet <= bb + 1e-9 => format!("{who} limp"),
                ActKind::Call => format!("{who} call"),
                ActKind::Raise | ActKind::Bet => format!("{who} {} {:.1} bb", if a.allin { "all-in" } else { "relance à" }, invested[p] / bb),
                _ => String::new(),
            });
        }
        max_bet = max_bet.max(invested[p]);
    }
    // mise non suivie rendue
    let live: Vec<usize> = (0..n).filter(|&i| !folded[i]).collect();
    if live.len() > 2 {
        return Err("pot à 3 joueurs : le moteur 3 joueurs arrive en phase 4 du cahier des charges".into());
    }
    if live.len() < 2 {
        return Err("un seul joueur voit le flop".into());
    }
    let mut sorted = invested.clone();
    sorted.sort_by(|a, b| b.partial_cmp(a).unwrap());
    let unc = sorted[0] - sorted.get(1).copied().unwrap_or(0.0);
    if unc > 0.0 {
        let top = (0..n).max_by(|&a, &b| invested[a].partial_cmp(&invested[b]).unwrap()).unwrap();
        invested[top] -= unc;
    }
    pot += invested.iter().sum::<f64>();
    if live.iter().any(|&i| allin[i]) {
        return Err("all-in préflop : aucune décision postflop à résoudre".into());
    }
    let (a, b) = (live[0], live[1]);
    let (oop, ip) = if post_order(pos[a], n) < post_order(pos[b], n) { (a, b) } else { (b, a) };
    let side_of = |p: usize| if p == oop { 0u8 } else { 1u8 };
    let stack_left = |p: usize| h.seats[p].stack - invested[p] - antes[p];
    let eff = stack_left(oop).min(stack_left(ip));

    // ligne postflop et tailles jouées
    let mut line = Vec::new();
    let mut extra_bets: Vec<[Vec<f64>; 2]> = vec![[vec![], vec![]], [vec![], vec![]], [vec![], vec![]]];
    let mut extra_raises: Vec<[Vec<f64>; 2]> = extra_bets.clone();
    let mut street_pot = pot;
    for st in 1..=3u8 {
        let mut put = [0.0f64; 2];
        let mut last_bet = 0.0f64;
        for a in h.actions.iter().filter(|a| a.street == st) {
            let p = a.p as usize;
            if p != oop && p != ip {
                continue;
            }
            let s = side_of(p) as usize;
            let before = street_pot + put[0] + put[1];
            put[s] += a.amount;
            let kind = match a.kind {
                ActKind::Fold => "fold",
                ActKind::Check => "check",
                ActKind::Call => "call",
                ActKind::Bet => "bet",
                ActKind::Raise => "raise",
                _ => continue,
            };
            let kind = if a.allin && matches!(a.kind, ActKind::Bet | ActKind::Raise) { "allin" } else { kind };
            match a.kind {
                ActKind::Bet if !a.allin && street_pot > 0.0 => extra_bets[st as usize - 1][s].push((a.amount / street_pot * 1000.0).round() / 10.0),
                ActKind::Raise if !a.allin && last_bet > 0.0 => extra_raises[st as usize - 1][s].push((put[s] / last_bet * 100.0).round() / 100.0),
                _ => {}
            }
            if matches!(a.kind, ActKind::Bet | ActKind::Raise) {
                last_bet = put[s];
            }
            line.push(LineAction { street: st, side: s as u8, kind: kind.into(), to: put[s] / bb, amount: a.amount / bb, pot_before: before / bb });
        }
        street_pot += put[0] + put[1];
    }
    // les tailles standard n'ont pas besoin d'être ajoutées
    let cfg0 = PostflopConfig::default();
    for st in extra_bets.iter_mut() {
        for v in st.iter_mut() {
            v.retain(|x| !cfg0.bet_sizes[0].iter().any(|b| (b - x).abs() < 1.5));
        }
    }
    for st in extra_raises.iter_mut() {
        for v in st.iter_mut() {
            v.retain(|x| !cfg0.raise_sizes.iter().any(|b| (b - x).abs() < 0.1));
        }
    }
    let hero = h.hero as usize;
    let hero_side = if hero == oop || hero == ip { Some(side_of(hero)) } else { None };
    let config = PostflopConfig {
        board: h.board[..3].iter().map(|&c| card_str(c)).collect(),
        pot: (pot / bb * 100.0).round() / 100.0,
        stack: (eff / bb * 100.0).round() / 100.0,
        oop_label: pos_name(pos[oop], n).into(),
        ip_label: pos_name(pos[ip], n).into(),
        extra_bets,
        extra_raises,
        ..cfg0
    };
    Ok(Spot {
        config,
        line,
        runout: h.board.iter().map(|&c| card_str(c)).collect(),
        hero_side,
        hero_cards: h.seats[hero].cards.map(|c| format!("{}{}", card_str(c[0]), card_str(c[1]))),
        names: [h.seats[oop].name.clone(), h.seats[ip].name.clone()],
        preflop: pre.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(", "),
        pre: pre_actions,
        stacks: {
            let mut v: Vec<(String, f64)> = (0..n).map(|i| (pos_name(pos[i], n).to_string(), (h.seats[i].stack / bb * 10.0).round() / 10.0)).collect();
            let rank = |p: &str| match p { "BTN" => 0, "SB" => 1, _ => 2 };
            v.sort_by_key(|x| rank(&x.0));
            v
        },
    })
}
