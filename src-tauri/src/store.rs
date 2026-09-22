//! Données en mémoire (chargées depuis SQLite) + agrégats par tournoi.

use crate::analysis::{HandFacts, Pos};
use crate::model::{Hand, Tournament};
use crate::settings::Settings;
use crate::stats::players::{compute_player_stats, PStats};
use std::collections::{HashMap, HashSet};

pub struct HandRec {
    pub h: Hand,
    pub f: HandFacts,
    pub t: usize,
}

#[derive(Default, Clone)]
pub struct TInfo {
    pub t: Tournament,
    pub hands: Vec<usize>,
    pub chips: f64,
    pub ev: f64,
    pub ev_var: f64,
    pub place: u8,
    pub winnings: f64,
    pub opponents: Vec<String>,
    pub tables: f64,
    pub day: i64,
    pub hu_opp: Option<String>,
    pub hu_ev: f64,
    pub hu_chips: f64,
    pub total_chips: f64,
    // modèle € (hors rakeback)
    pub p: [f64; 3],
    pub ev_theo: f64,
    pub ev_multi: f64,
    pub ev_eff: f64,
    pub real: f64,
    pub rb: f64,
    /// espérance théorique de gain par place (€)
    pub e_prize: [f64; 3],
}

#[derive(Default)]
pub struct Store {
    pub tours: Vec<TInfo>,
    pub hands: Vec<HandRec>,
    pub tindex: HashMap<String, usize>,
    pub meta: HashMap<String, (Vec<String>, String)>,
    pub settings: Settings,
    pub pstats: HashMap<String, PStats>,
    pub auto_tags: HashMap<String, Vec<String>>,
    pub heroes: HashSet<String>,
    /// mains marquées en favori (id -> note)
    pub favorites: HashMap<String, String>,
}

/// Probabilités de finir 1er/2e/3e (Malmuth-Harville, adversaires à tapis égaux).
pub fn place_probs(hero: f64, total: f64, n: usize) -> [f64; 3] {
    let total = total.max(1.0);
    let h = hero.clamp(0.0, total);
    let p1 = h / total;
    if n <= 2 {
        return [p1, 1.0 - p1, 0.0];
    }
    let others = (n - 1) as f64;
    let x = (total - h) / others;
    // P(2e) = somme sur les adversaires j : P(j 1er) * P(héros 1er parmi le reste)
    let p2 = if total - x > 0.0 { others * (x / total) * (h / (total - x)) } else { 0.0 };
    let p3 = (1.0 - p1 - p2).max(0.0);
    [p1, p2, p3]
}

impl Store {
    pub fn tags_of(&self, name: &str) -> Vec<String> {
        let mut out: Vec<String> = self.meta.get(name).map(|m| m.0.clone()).unwrap_or_default();
        if let Some(a) = self.auto_tags.get(name) {
            for t in a {
                if !out.contains(t) {
                    out.push(t.clone());
                }
            }
        }
        out
    }

    pub fn is_hero(&self, name: &str) -> bool {
        self.heroes.contains(name)
    }

    /// Espérance de gain théorique par place pour un tournoi (normalisée sur le retour réel au joueur).
    pub fn expected_prizes(&self, t: &Tournament) -> [f64; 3] {
        let table = self.settings.table_for(&t.room, t.buyin);
        let rtp_mult = if t.buyin > 0.0 { t.table_size.max(2) as f64 * t.prize_contrib / t.buyin } else { 0.0 };
        match table {
            Some(tab) if !tab.entries.is_empty() => {
                let psum: f64 = tab.entries.iter().map(|e| e.prob).sum::<f64>().max(1e-12);
                let raw: f64 = tab.entries.iter().map(|e| e.prob / psum * e.mult).sum::<f64>().max(1e-12);
                let lambda = if rtp_mult > 0.0 { rtp_mult / raw } else { 1.0 };
                let mut out = [0.0; 3];
                for e in &tab.entries {
                    for k in 0..3 {
                        out[k] += e.prob / psum * e.mult * lambda * t.buyin * e.shares[k];
                    }
                }
                out
            }
            _ => [rtp_mult * t.buyin, 0.0, 0.0],
        }
    }

    pub fn actual_shares(&self, t: &Tournament) -> [f64; 3] {
        let table = self.settings.table_for(&t.room, t.buyin);
        if let Some(tab) = table {
            if let Some(e) = tab.entries.iter().min_by(|a, b| (a.mult - t.multiplier).abs().partial_cmp(&(b.mult - t.multiplier).abs()).unwrap()) {
                if (e.mult - t.multiplier).abs() < 0.01 * t.multiplier.max(1.0) {
                    return e.shares;
                }
            }
            // multiplicateur absent de la table : répartition du palier inférieur le plus proche
            if let Some(e) = tab.entries.iter().filter(|e| e.mult <= t.multiplier).max_by(|a, b| a.mult.partial_cmp(&b.mult).unwrap()) {
                return e.shares;
            }
        }
        [1.0, 0.0, 0.0]
    }

    /// Reconstruit tous les agrégats. `hands` doit contenir toutes les mains.
    pub fn rebuild(&mut self, tournaments: Vec<Tournament>, hands: Vec<(Hand, HandFacts)>) {
        // fusion éventuelle de tournois (summary + mains séparés)
        let mut tmap: HashMap<String, Tournament> = HashMap::new();
        for t in tournaments {
            match tmap.get_mut(&t.id) {
                Some(ex) => merge_tournament(ex, t),
                None => {
                    tmap.insert(t.id.clone(), t);
                }
            }
        }
        let mut tours: Vec<TInfo> = tmap.into_values().map(|t| TInfo { t, ..Default::default() }).collect();
        // filet de sécurité : jamais de MTT/freeroll dans les agrégats d'un tracker de Spins
        tours.retain(|t| t.t.starting_stack <= 0.0 || t.t.is_spin());
        tours.sort_by(|a, b| a.t.start.cmp(&b.t.start).then(a.t.id.cmp(&b.t.id)));
        let tindex: HashMap<String, usize> = tours.iter().enumerate().map(|(i, t)| (t.t.id.clone(), i)).collect();

        let mut recs: Vec<HandRec> = hands.into_iter().filter_map(|(h, f)| tindex.get(&h.tid).copied().map(|t| HandRec { h, f, t })).collect();
        recs.sort_by(|a, b| a.t.cmp(&b.t).then(a.h.ts.cmp(&b.h.ts)).then(a.h.id.cmp(&b.h.id)));
        for (i, r) in recs.iter().enumerate() {
            tours[r.t].hands.push(i);
        }
        let mut heroes = HashSet::new();
        for r in &recs {
            heroes.insert(r.h.seats[r.h.hero as usize].name.clone());
        }
        for t in &tours {
            if !t.t.hero.is_empty() {
                heroes.insert(t.t.hero.clone());
            }
        }
        for h in &self.settings.heroes {
            heroes.insert(h.clone());
        }

        for ti in tours.iter_mut() {
            let mut opp = Vec::new();
            let mut total = 0.0;
            for (k, &hi) in ti.hands.iter().enumerate() {
                let r = &recs[hi];
                let hf = &r.f.players[r.h.hero as usize];
                ti.chips += hf.net;
                ti.ev += hf.ev;
                ti.ev_var += hf.ev_var;
                if k == 0 {
                    total = r.h.seats.iter().map(|s| s.stack).sum();
                }
                for (i, s) in r.h.seats.iter().enumerate() {
                    if i != r.h.hero as usize && !opp.contains(&s.name) {
                        opp.push(s.name.clone());
                    }
                }
                if r.h.seats.len() == 2 {
                    if ti.hu_opp.is_none() {
                        ti.hu_opp = r.h.seats.iter().enumerate().find(|(i, _)| *i != r.h.hero as usize).map(|(_, s)| s.name.clone());
                    }
                    ti.hu_ev += hf.ev;
                    ti.hu_chips += hf.net;
                }
            }
            if total <= 0.0 {
                total = ti.t.starting_stack.max(1.0) * ti.t.table_size.max(1) as f64;
            }
            ti.total_chips = total;
            if ti.t.starting_stack <= 0.0 {
                ti.t.starting_stack = total / ti.t.table_size.max(1) as f64;
            }
            ti.opponents = opp;
            ti.day = ti.t.start.div_euclid(86400);
            ti.place = ti.t.place;
            ti.winnings = ti.t.winnings;
            // place inconnue : on la déduit de la dernière main
            if ti.place == 0 {
                if let Some(&last) = ti.hands.last() {
                    let r = &recs[last];
                    let hf = &r.f.players[r.h.hero as usize];
                    if hf.stack_after <= 1e-6 {
                        let busted_before = r.f.players.iter().filter(|p| p.stack_after <= 1e-6).count();
                        ti.place = (r.h.seats.len() as u8).max(busted_before as u8).min(ti.t.table_size.max(2));
                        if ti.place == 0 {
                            ti.place = r.h.seats.len() as u8;
                        }
                    } else if r.f.players.iter().enumerate().all(|(i, p)| i == r.h.hero as usize || p.stack_after <= 1e-6) {
                        ti.place = 1;
                    }
                }
            }
        }

        // tables simultanées (moyenne pondérée par le temps)
        let n = tours.len();
        for i in 0..n {
            let (s, e) = (tours[i].t.start, tours[i].t.end.max(tours[i].t.start + 1));
            let dur = (e - s) as f64;
            let mut acc = 0.0;
            let mut j = i;
            while j > 0 && tours[j - 1].t.start > s - 6 * 3600 {
                j -= 1;
            }
            for k in j..n {
                let (s2, e2) = (tours[k].t.start, tours[k].t.end.max(tours[k].t.start + 1));
                if s2 >= e {
                    break;
                }
                let ov = (e.min(e2) - s.max(s2)).max(0) as f64;
                acc += ov;
            }
            tours[i].tables = (acc / dur).max(1.0);
        }

        self.tours = tours;
        self.hands = recs;
        self.tindex = tindex;
        self.heroes = heroes;
        self.recompute_money();
        self.recompute_players();
    }

    /// Recalcule les montants € (dépend des paramètres rakeback / multiplicateurs).
    pub fn recompute_money(&mut self) {
        let n = self.tours.len();
        for i in 0..n {
            let t = self.tours[i].t.clone();
            let e_prize = self.expected_prizes(&t);
            let shares = self.actual_shares(&t);
            let ti = &mut self.tours[i];
            let size = t.table_size.max(2) as usize;
            let s0 = t.starting_stack.max(1.0);
            let p = place_probs(s0 + ti.ev, ti.total_chips, size);
            ti.p = p;
            ti.e_prize = e_prize;
            ti.ev_theo = p[0] * e_prize[0] + p[1] * e_prize[1] + p[2] * e_prize[2] - t.buyin;
            ti.ev_multi = t.prize_pool * (p[0] * shares[0] + p[1] * shares[1] + p[2] * shares[2]) - t.buyin;
            ti.ev_eff = match ti.place {
                1..=3 => e_prize[(ti.place - 1) as usize] - t.buyin,
                _ => p[0] * e_prize[0] + p[1] * e_prize[1] + p[2] * e_prize[2] - t.buyin,
            };
            // gains réels : si non renseignés mais place connue, on reconstruit
            if ti.winnings <= 0.0 && ti.t.winnings <= 0.0 && (1..=3).contains(&ti.place) && t.prize_pool > 0.0 {
                ti.winnings = t.prize_pool * shares[(ti.place - 1) as usize];
            }
            ti.real = ti.winnings - t.buyin;
        }
        for i in 0..n {
            let room = self.tours[i].t.room.clone();
            let rb = self.settings.rakeback_for(&room) * self.tours[i].t.rake;
            self.tours[i].rb = rb;
        }
    }

    pub fn recompute_players(&mut self) {
        self.pstats = compute_player_stats(self);
        let mut auto: HashMap<String, Vec<String>> = HashMap::new();
        for (name, st) in &self.pstats {
            if self.heroes.contains(name) {
                continue;
            }
            let mut tags = Vec::new();
            for td in self.settings.tags.iter().filter(|t| t.active && t.auto && !t.rules.is_empty()) {
                let test = |r: &crate::settings::TagRule| {
                    let v = st.stat(&r.stat);
                    match r.op.as_str() {
                        ">=" => v >= r.value,
                        ">" => v > r.value,
                        "<=" => v <= r.value,
                        "<" => v < r.value,
                        "=" | "==" => (v - r.value).abs() < 1e-9,
                        "!=" => (v - r.value).abs() >= 1e-9,
                        _ => false,
                    }
                };
                let ok = if td.mode == "any" { td.rules.iter().any(test) } else { td.rules.iter().all(test) };
                if ok {
                    tags.push(td.id.clone());
                }
            }
            if !tags.is_empty() {
                auto.insert(name.clone(), tags);
            }
        }
        self.auto_tags = auto;
    }

    pub fn hero_pos(&self, hi: usize) -> Pos {
        let r = &self.hands[hi];
        r.f.players[r.h.hero as usize].pos
    }
}

pub fn merge_tournament(a: &mut Tournament, b: Tournament) {
    macro_rules! take {
        ($f:ident, $zero:expr) => {
            if a.$f == $zero && b.$f != $zero {
                a.$f = b.$f.clone();
            }
        };
    }
    take!(place, 0);
    take!(winnings, 0.0);
    take!(prize_pool, 0.0);
    take!(multiplier, 0.0);
    take!(buyin, 0.0);
    take!(rake, 0.0);
    take!(prize_contrib, 0.0);
    take!(starting_stack, 0.0);
    if a.hero.is_empty() {
        a.hero = b.hero.clone();
    }
    if a.name.is_empty() {
        a.name = b.name.clone();
    }
    if b.start > 0 && (a.start == 0 || b.start < a.start) {
        a.start = b.start;
    }
    a.end = a.end.max(b.end);
    a.hands = a.hands.max(b.hands);
}
