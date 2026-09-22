//! Faits dérivés d'une main : résultat réel, résultat all-in ajusté (EV), positions…

use crate::eval::{equity, Pot};
use crate::model::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
pub enum Pos {
    Btn,
    Sb,
    Bb,
}

/// Scénario de position (vue d'un joueur), comme dans les trackers Spin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
pub enum Scenario {
    Btn,
    SbVsBtn,
    SbVsBb,
    BbVsBtn,
    BbVsSb,
    HuSb,
    HuBb,
}

impl Scenario {
    pub const ALL: [Scenario; 7] =
        [Scenario::Btn, Scenario::SbVsBtn, Scenario::SbVsBb, Scenario::BbVsBtn, Scenario::BbVsSb, Scenario::HuSb, Scenario::HuBb];
    pub fn label(self) -> &'static str {
        match self {
            Scenario::Btn => "BTN",
            Scenario::SbVsBtn => "SB vs BTN",
            Scenario::SbVsBb => "SB vs BB",
            Scenario::BbVsBtn => "BB vs BTN",
            Scenario::BbVsSb => "BB vs SB",
            Scenario::HuSb => "HU SB",
            Scenario::HuBb => "HU BB",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerFacts {
    pub contrib: f64,
    pub net: f64,
    pub ev: f64,
    pub ev_var: f64,
    pub pos: Pos,
    pub scenario: Scenario,
    pub folded: bool,
    /// jetons en début de main
    pub stack: f64,
    pub stack_after: f64,
    /// équité au moment du tapis (si all-in ajusté)
    pub allin_equity: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandFacts {
    pub players: Vec<PlayerFacts>,
    pub showdown: bool,
    /// street à laquelle le tapis a été figé (all-in ajusté), None sinon
    pub allin_street: Option<u8>,
    pub pot: f64,
    /// tapis effectif en BB (héros vs plus gros adversaire)
    pub eff_bb: f64,
    pub n: u8,
    pub saw_flop: Vec<bool>,
}

fn first_index_of(h: &Hand, kind: ActKind) -> Option<u8> {
    h.actions.iter().find(|a| a.kind == kind && a.street == STREET_PREFLOP).map(|a| a.p)
}

pub fn positions(h: &Hand) -> Vec<Pos> {
    let n = h.seats.len();
    let mut pos = vec![Pos::Btn; n];
    let sb = first_index_of(h, ActKind::SmallBlind);
    let bb = first_index_of(h, ActKind::BigBlind);
    if n == 2 {
        // en HU le bouton poste la small blind
        let sbp = sb.unwrap_or(h.button) as usize;
        for (i, p) in pos.iter_mut().enumerate() {
            *p = if i == sbp { Pos::Sb } else { Pos::Bb };
        }
        return pos;
    }
    let btn = h.button as usize;
    let sbp = sb.map(|x| x as usize).unwrap_or((btn + 1) % n);
    let bbp = bb.map(|x| x as usize).unwrap_or((sbp + 1) % n);
    for (i, p) in pos.iter_mut().enumerate() {
        *p = if i == sbp {
            Pos::Sb
        } else if i == bbp {
            Pos::Bb
        } else {
            Pos::Btn
        };
    }
    pos
}

pub fn analyze(h: &Hand) -> HandFacts {
    let n = h.seats.len();
    let pos = positions(h);
    let mut contrib = vec![0.0f64; n];
    let mut folded = vec![false; n];
    let mut last_voluntary: Option<usize> = None;
    let mut saw_flop = vec![false; n];
    for (i, a) in h.actions.iter().enumerate() {
        contrib[a.p as usize] += a.amount;
        if a.kind == ActKind::Fold {
            folded[a.p as usize] = true;
        }
        if !a.kind.is_post() {
            last_voluntary = Some(i);
        }
        if a.street >= STREET_FLOP {
            saw_flop[a.p as usize] = true;
        }
    }
    // si le board a un flop, tous les non-couchés préflop l'ont vu
    if h.board.len() >= 3 {
        let mut folded_pre = vec![false; n];
        for a in &h.actions {
            if a.street == STREET_PREFLOP && a.kind == ActKind::Fold {
                folded_pre[a.p as usize] = true;
            }
        }
        for i in 0..n {
            if !folded_pre[i] {
                saw_flop[i] = true;
            }
        }
    }

    // mise non suivie rendue au plus gros contributeur
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|a, b| contrib[*b].partial_cmp(&contrib[*a]).unwrap());
    let uncalled = if n >= 2 { contrib[order[0]] - contrib[order[1]] } else { 0.0 };
    let mut eff = contrib.clone();
    if n >= 2 {
        eff[order[0]] -= uncalled;
    }
    let pot: f64 = eff.iter().sum();
    let sum_win: f64 = h.seats.iter().map(|s| s.win).sum();
    // selon la room, `win` inclut ou non la mise rendue
    let win_includes_return = uncalled > 0.0 && (sum_win - pot - uncalled).abs() < 0.5 && (sum_win - pot).abs() > 0.5;
    let wins: Vec<f64> = h
        .seats
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let mut w = s.win;
            if win_includes_return && i == order[0] {
                w -= uncalled;
            }
            w
        })
        .collect();
    let net: Vec<f64> = (0..n).map(|i| wins[i] - eff[i]).collect();
    let live: Vec<usize> = (0..n).filter(|&i| !folded[i]).collect();
    let showdown = live.len() >= 2;

    // --- all-in ajusté ---
    let mut ev = net.clone();
    let mut ev_var = vec![0.0; n];
    let mut allin_eq = vec![None; n];
    let mut allin_street = None;
    if showdown {
        let last_street = last_voluntary.map(|i| h.actions[i].street).unwrap_or(STREET_PREFLOP);
        let board_known = match last_street {
            STREET_PREFLOP => 0,
            STREET_FLOP => 3,
            STREET_TURN => 4,
            _ => 5,
        };
        let any_allin = h.actions.iter().any(|a| a.allin);
        let all_cards = live.iter().all(|&i| h.seats[i].cards.is_some());
        if any_allin && board_known < 5 && h.board.len() == 5 && all_cards {
            // construction des pots par paliers
            let mut levels: Vec<f64> = live.iter().map(|&i| eff[i]).collect();
            levels.sort_by(|a, b| a.partial_cmp(b).unwrap());
            levels.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
            let mut pots = Vec::new();
            let mut prev = 0.0;
            for lv in levels {
                let amount: f64 = eff.iter().map(|&c| c.min(lv) - c.min(prev)).sum();
                let eligible: Vec<usize> = live.iter().enumerate().filter(|(_, &i)| eff[i] >= lv - 1e-9).map(|(k, _)| k).collect();
                if amount > 0.0 {
                    pots.push(Pot { amount, eligible });
                }
                prev = lv;
            }
            let hands: Vec<[Card; 2]> = live.iter().map(|&i| h.seats[i].cards.unwrap()).collect();
            let seed = h.id.bytes().fold(0xcbf29ce484222325u64, |acc, b| (acc ^ b as u64).wrapping_mul(0x100000001b3));
            let iters = if live.len() == 2 { 25_000 } else { 20_000 };
            let r = equity(&hands, &h.board[..board_known], &pots, seed, iters);
            for (k, &i) in live.iter().enumerate() {
                ev[i] = r.expected[k] - eff[i];
                ev_var[i] = r.variance[k];
                allin_eq[i] = Some(r.equity[k]);
            }
            allin_street = Some(last_street);
        }
    }

    // scénarios
    let btn_idx = pos.iter().position(|p| *p == Pos::Btn);
    let first_pre_action = |p: usize| h.actions.iter().find(|a| a.street == STREET_PREFLOP && !a.kind.is_post() && a.p as usize == p).map(|a| a.kind);
    let btn_folded_first = btn_idx.map(|b| first_pre_action(b) == Some(ActKind::Fold)).unwrap_or(true);
    let players = (0..n)
        .map(|i| {
            let scenario = if n == 2 {
                if pos[i] == Pos::Sb {
                    Scenario::HuSb
                } else {
                    Scenario::HuBb
                }
            } else {
                match pos[i] {
                    Pos::Btn => Scenario::Btn,
                    Pos::Sb => {
                        if btn_folded_first {
                            Scenario::SbVsBb
                        } else {
                            Scenario::SbVsBtn
                        }
                    }
                    Pos::Bb => {
                        if btn_folded_first {
                            Scenario::BbVsSb
                        } else {
                            Scenario::BbVsBtn
                        }
                    }
                }
            };
            PlayerFacts {
                contrib: eff[i],
                net: net[i],
                ev: ev[i],
                ev_var: ev_var[i],
                pos: pos[i],
                scenario,
                folded: folded[i],
                stack: h.seats[i].stack,
                stack_after: h.seats[i].stack + net[i],
                allin_equity: allin_eq[i],
            }
        })
        .collect();
    let hero = h.hero as usize;
    let max_opp = (0..n).filter(|&i| i != hero).map(|i| h.seats[i].stack).fold(0.0, f64::max);
    let eff_bb = if h.bb > 0.0 { h.seats[hero].stack.min(max_opp) / h.bb } else { 0.0 };
    HandFacts { players, showdown, allin_street, pot, eff_bb, n: n as u8, saw_flop }
}
