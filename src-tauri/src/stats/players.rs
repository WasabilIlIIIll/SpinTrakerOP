//! Statistiques par joueur (adversaires et héros), utilisées pour les tags
//! automatiques, la liste des joueurs et les profils.

use crate::analysis::Pos;
use crate::model::{ActKind, STREET_FLOP, STREET_PREFLOP};
use crate::store::Store;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Default, Serialize)]
pub struct PStats {
    pub hands: u32,
    pub tournaments: u32,
    pub vpip: u32,
    pub pfr: u32,
    pub btn_opp: u32,
    pub btn_limp: u32,
    pub btn_shove: u32,
    pub btn_raise: u32,
    pub threebet_opp: u32,
    pub threebet: u32,
    pub bb_vs_shove_opp: u32,
    pub bb_vs_shove_call: u32,
    pub post_agg: u32,
    pub post_calls: u32,
    pub saw_flop: u32,
    pub wtsd: u32,
    pub wsd: u32,
    pub cbet_opp: u32,
    pub cbet: u32,
    pub fcbet_opp: u32,
    pub fcbet: u32,
    pub ev: f64,
    pub chips: f64,
    pub last_ts: i64,
    pub first_ts: i64,
    #[serde(skip)]
    pub tset: HashSet<usize>,
    // face au héros
    pub vs_hero_tournaments: u32,
    pub vs_hero_hands: u32,
    pub hero_ev_vs: f64,
    pub hero_chips_vs: f64,
    pub their_ev_vs: f64,
    pub hero_profit_vs: f64,
    pub hero_ev_profit_vs: f64,
    pub hero_wins_vs: u32,
    pub their_wins_vs: u32,
    // face au héros, en tête-à-tête uniquement (attribution non ambiguë)
    pub hu_matches: u32,
    pub hero_profit_hu_vs: f64,
    pub hero_hu_ev: f64,
    pub hero_hu_chips: f64,
}

fn pct(a: u32, b: u32) -> f64 {
    if b == 0 {
        0.0
    } else {
        a as f64 / b as f64 * 100.0
    }
}

impl PStats {
    pub fn stat(&self, key: &str) -> f64 {
        match key {
            "hands" => self.hands as f64,
            "tournaments" => self.tournaments as f64,
            "vpip" => pct(self.vpip, self.hands),
            "pfr" => pct(self.pfr, self.hands),
            "limp_btn" => pct(self.btn_limp, self.btn_opp),
            "shove_btn" => pct(self.btn_shove, self.btn_opp),
            "raise_btn" => pct(self.btn_raise, self.btn_opp),
            "threebet" => pct(self.threebet, self.threebet_opp),
            "call_shove_bb" => pct(self.bb_vs_shove_call, self.bb_vs_shove_opp),
            "af" => {
                if self.post_calls == 0 {
                    self.post_agg as f64
                } else {
                    self.post_agg as f64 / self.post_calls as f64
                }
            }
            "wtsd" => pct(self.wtsd, self.saw_flop),
            "wsd" => pct(self.wsd, self.wtsd),
            "cbet" => pct(self.cbet, self.cbet_opp),
            "fold_cbet" => pct(self.fcbet, self.fcbet_opp),
            "cev" => {
                if self.tournaments == 0 {
                    0.0
                } else {
                    self.ev / self.tournaments as f64
                }
            }
            "cev_vs_hero" => {
                if self.vs_hero_tournaments == 0 {
                    0.0
                } else {
                    self.their_ev_vs / self.vs_hero_tournaments as f64
                }
            }
            "hero_cev_vs" => {
                if self.vs_hero_tournaments == 0 {
                    0.0
                } else {
                    self.hero_ev_vs / self.vs_hero_tournaments as f64
                }
            }
            "cev_hu_vs" => {
                if self.hu_matches == 0 {
                    0.0
                } else {
                    self.hero_hu_ev / self.hu_matches as f64
                }
            }
            "chips_hu_vs" => {
                if self.hu_matches == 0 {
                    0.0
                } else {
                    self.hero_hu_chips / self.hu_matches as f64
                }
            }
            "hu_matches" => self.hu_matches as f64,
            "hero_profit_hu_vs" => self.hero_profit_hu_vs,
            "days_since" => 0.0,
            _ => 0.0,
        }
    }
}

pub fn compute_player_stats(s: &Store) -> HashMap<String, PStats> {
    let mut m: HashMap<String, PStats> = HashMap::new();
    for r in &s.hands {
        let h = &r.h;
        let n = h.seats.len();
        let hero = h.hero as usize;
        // pré-calculs préflop
        let pre: Vec<_> = h.actions.iter().filter(|a| a.street == STREET_PREFLOP && !a.kind.is_post()).collect();
        let mut vpip = vec![false; n];
        let mut pfr = vec![false; n];
        let mut raises_before = 0u32;
        let mut threebet_opp = vec![false; n];
        let mut threebet = vec![false; n];
        let mut last_raiser: Option<usize> = None;
        let mut shove_seen = false;
        let mut bb_vs_shove = vec![(false, false); n];
        let mut first_act = vec![None; n];
        for a in &pre {
            let p = a.p as usize;
            if first_act[p].is_none() {
                first_act[p] = Some((a.kind, a.allin, raises_before));
            }
            if raises_before == 1 && !threebet_opp[p] && last_raiser != Some(p) {
                threebet_opp[p] = true;
                if a.kind == ActKind::Raise {
                    threebet[p] = true;
                }
            }
            if r.f.players[p].pos == Pos::Bb && shove_seen && a.kind != ActKind::Check {
                bb_vs_shove[p].0 = true;
                if a.kind == ActKind::Call {
                    bb_vs_shove[p].1 = true;
                }
            }
            if a.kind.is_voluntary() {
                vpip[p] = true;
            }
            if a.kind == ActKind::Raise || a.kind == ActKind::Bet {
                pfr[p] = true;
                raises_before += 1;
                last_raiser = Some(p);
                if a.allin {
                    shove_seen = true;
                }
            }
        }
        // postflop
        let mut agg = vec![0u32; n];
        let mut calls = vec![0u32; n];
        let mut cbet_opp = vec![false; n];
        let mut cbet = vec![false; n];
        let mut fc_opp = vec![false; n];
        let mut fc = vec![false; n];
        let flop: Vec<_> = h.actions.iter().filter(|a| a.street == STREET_FLOP).collect();
        if let Some(pr) = last_raiser {
            let mut bet_made = false;
            let mut cbet_made = false;
            for a in &flop {
                let p = a.p as usize;
                if !bet_made && p == pr {
                    cbet_opp[p] = true;
                    if a.kind == ActKind::Bet {
                        cbet[p] = true;
                        cbet_made = true;
                    }
                }
                if cbet_made && p != pr && !fc_opp[p] {
                    fc_opp[p] = true;
                    if a.kind == ActKind::Fold {
                        fc[p] = true;
                    }
                }
                if a.kind.is_aggressive() {
                    bet_made = true;
                    if p != pr {
                        // donk / relance : plus d'opportunité de fold to cbet pour la suite
                        if !cbet_made {
                            break;
                        }
                    }
                }
            }
        }
        for a in h.actions.iter().filter(|a| a.street >= STREET_FLOP) {
            let p = a.p as usize;
            if a.kind.is_aggressive() {
                agg[p] += 1;
            } else if a.kind == ActKind::Call {
                calls[p] += 1;
            }
        }
        let hero_name = &h.seats[hero].name;
        for (i, seat) in h.seats.iter().enumerate() {
            let st = m.entry(seat.name.clone()).or_default();
            let pf = &r.f.players[i];
            st.hands += 1;
            if vpip[i] {
                st.vpip += 1;
            }
            if pfr[i] {
                st.pfr += 1;
            }
            if n == 3 && pf.pos == Pos::Btn {
                if let Some((k, allin, rb)) = first_act[i] {
                    if rb == 0 {
                        st.btn_opp += 1;
                        match k {
                            ActKind::Call => st.btn_limp += 1,
                            ActKind::Raise | ActKind::Bet => {
                                if allin {
                                    st.btn_shove += 1
                                } else {
                                    st.btn_raise += 1
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
            if threebet_opp[i] {
                st.threebet_opp += 1;
                if threebet[i] {
                    st.threebet += 1;
                }
            }
            if bb_vs_shove[i].0 {
                st.bb_vs_shove_opp += 1;
                if bb_vs_shove[i].1 {
                    st.bb_vs_shove_call += 1;
                }
            }
            st.post_agg += agg[i];
            st.post_calls += calls[i];
            if r.f.saw_flop[i] {
                st.saw_flop += 1;
                if r.f.showdown && !pf.folded {
                    st.wtsd += 1;
                    if pf.net > 0.0 {
                        st.wsd += 1;
                    }
                }
            }
            if cbet_opp[i] {
                st.cbet_opp += 1;
                if cbet[i] {
                    st.cbet += 1;
                }
            }
            if fc_opp[i] {
                st.fcbet_opp += 1;
                if fc[i] {
                    st.fcbet += 1;
                }
            }
            st.ev += pf.ev;
            st.chips += pf.net;
            if h.ts > st.last_ts {
                st.last_ts = h.ts;
            }
            if st.first_ts == 0 || h.ts < st.first_ts {
                st.first_ts = h.ts;
            }
            st.tset.insert(r.t);
            if i != hero {
                st.vs_hero_hands += 1;
            }
            let _ = hero_name;
        }
    }
    // niveau tournoi, face au héros
    for (ti, t) in s.tours.iter().enumerate() {
        for o in &t.opponents {
            if let Some(st) = m.get_mut(o) {
                st.vs_hero_tournaments += 1;
                st.hero_ev_vs += t.ev;
                st.hero_chips_vs += t.chips;
                st.hero_profit_vs += t.real;
                st.hero_ev_profit_vs += t.ev_theo;
                if t.place == 1 {
                    st.hero_wins_vs += 1;
                }
                let _ = ti;
            }
        }
        // tête-à-tête : le résultat du spin est attribuable sans ambiguïté à cet adversaire
        if let Some(hu) = &t.hu_opp {
            if let Some(st) = m.get_mut(hu.as_str()) {
                st.hu_matches += 1;
                st.hero_profit_hu_vs += t.real;
                st.hero_hu_ev += t.hu_ev;
                st.hero_hu_chips += t.hu_chips;
            }
        }
        // EV des adversaires dans ce tournoi
        let mut their: HashMap<&str, f64> = HashMap::new();
        for &hi in &t.hands {
            let r = &s.hands[hi];
            for (i, seat) in r.h.seats.iter().enumerate() {
                if i != r.h.hero as usize {
                    *their.entry(seat.name.as_str()).or_default() += r.f.players[i].ev;
                }
            }
        }
        for (name, ev) in their {
            if let Some(st) = m.get_mut(name) {
                st.their_ev_vs += ev;
            }
        }
        // vainqueur adverse : celui qui reste en dernière main avec tous les jetons
        if t.place > 1 {
            if let Some(&last) = t.hands.last() {
                let r = &s.hands[last];
                if let Some((i, _)) = r.f.players.iter().enumerate().max_by(|a, b| a.1.stack_after.partial_cmp(&b.1.stack_after).unwrap()) {
                    if i != r.h.hero as usize {
                        if let Some(st) = m.get_mut(&r.h.seats[i].name) {
                            st.their_wins_vs += 1;
                        }
                    }
                }
            }
        }
    }
    for st in m.values_mut() {
        st.tournaments = st.tset.len() as u32;
    }
    m
}
