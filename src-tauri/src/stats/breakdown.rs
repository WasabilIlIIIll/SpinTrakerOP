//! Ventilations : positions, profils de table, multi-tabling, résultats groupés,
//! multiplicateurs, profondeur de tapis, calendrier.

use super::{mean_ci, weekday, Filter};
use crate::analysis::Scenario;
use crate::store::Store;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize, Default)]
pub struct Bar {
    pub key: String,
    pub count: usize,
    pub hands: usize,
    /// jetons réels
    pub chips: f64,
    pub chips_ci: f64,
    /// jetons EV (all-in ajusté)
    pub ev: f64,
    pub ev_ci: f64,
}

pub fn by_position(s: &Store, f: &Filter, per: &str) -> Vec<Bar> {
    let sel = f.select(s);
    let nt = sel.len().max(1);
    Scenario::ALL
        .iter()
        .map(|sc| {
            let mut chips = Vec::new();
            let mut evs = Vec::new();
            let mut tchips = vec![0.0; sel.len()];
            let mut tev = vec![0.0; sel.len()];
            for (k, &ti) in sel.iter().enumerate() {
                for &hi in &s.tours[ti].hands {
                    let r = &s.hands[hi];
                    let p = &r.f.players[r.h.hero as usize];
                    if p.scenario == *sc {
                        chips.push(p.net);
                        evs.push(p.ev);
                        tchips[k] += p.net;
                        tev[k] += p.ev;
                    }
                }
            }
            let hands = chips.len();
            let (c, cci, e, eci) = if per == "hand" {
                let (c, cci) = mean_ci(&chips);
                let (e, eci) = mean_ci(&evs);
                (c, cci, e, eci)
            } else {
                let (c, cci) = mean_ci(&tchips);
                let (e, eci) = mean_ci(&tev);
                (c, cci, e, eci)
            };
            Bar { key: sc.label().into(), count: nt, hands, chips: c, chips_ci: cci, ev: e, ev_ci: eci }
        })
        .collect()
}

fn primary_tag(s: &Store, name: &str) -> String {
    let tags = s.tags_of(name);
    for td in &s.settings.tags {
        if td.active && tags.contains(&td.id) {
            return td.name.clone();
        }
    }
    "?".into()
}

pub fn by_profile(s: &Store, f: &Filter) -> Vec<Bar> {
    let sel = f.select(s);
    let mut groups: BTreeMap<String, (Vec<f64>, Vec<f64>, usize)> = BTreeMap::new();
    for &ti in &sel {
        let t = &s.tours[ti];
        let mut tags: Vec<String> = t.opponents.iter().take(2).map(|o| primary_tag(s, o)).collect();
        tags.sort();
        let key = if tags.is_empty() { "?".to_string() } else { tags.join(" + ") };
        let g = groups.entry(key).or_default();
        g.0.push(t.chips);
        g.1.push(t.ev);
        g.2 += t.hands.len();
    }
    let mut out: Vec<Bar> = groups
        .into_iter()
        .map(|(k, (c, e, h))| {
            let (cm, cci) = mean_ci(&c);
            let (em, eci) = mean_ci(&e);
            Bar { key: k, count: c.len(), hands: h, chips: cm, chips_ci: cci, ev: em, ev_ci: eci }
        })
        .collect();
    out.sort_by(|a, b| b.count.cmp(&a.count));
    out
}

#[derive(Serialize, Default)]
pub struct Row {
    pub key: String,
    pub sort: f64,
    pub spins: usize,
    pub hands: usize,
    pub profit: f64,
    pub rakeback: f64,
    pub ev: f64,
    pub ev_multi: f64,
    pub ev_eff: f64,
    pub cev: f64,
    pub cev_ci: f64,
    pub roi_ev: f64,
    pub hours: f64,
    pub ev_hour: f64,
    pub real_hour: f64,
    pub spins_hour: f64,
    pub win_pct: f64,
}

const MONTHS: [&str; 12] = ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];

pub fn civil(day: i64) -> (i64, i64, i64) {
    let z = day + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn results_by(s: &Store, f: &Filter, group: &str) -> Vec<Row> {
    let sel = f.select(s);
    let mut g: BTreeMap<String, (f64, Vec<usize>)> = BTreeMap::new();
    for &ti in &sel {
        let t = &s.tours[ti];
        let (y, m, d) = civil(t.day);
        let (key, sort) = match group {
            "day" => (format!("{d:02}/{m:02}/{y}"), t.day as f64),
            "week" => {
                let monday = t.day - weekday(t.day) as i64;
                let (yy, mm, dd) = civil(monday);
                (format!("Sem. {dd:02}/{mm:02}/{yy}"), monday as f64)
            }
            "year" => (format!("{y}"), y as f64),
            "buyin" => (format!("{:.2} €", t.t.buyin), t.t.buyin),
            "multiplier" => (format!("x{}", fmt_mult(t.t.multiplier)), t.t.multiplier),
            "room" => (t.t.room.clone(), 0.0),
            "hour" => {
                let h = (t.t.start.rem_euclid(86400)) / 3600;
                (format!("{h:02}h"), h as f64)
            }
            "weekday" => {
                let w = weekday(t.day);
                (["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"][w as usize].to_string(), w as f64)
            }
            "tables" => {
                let k = t.tables.round().max(1.0);
                (format!("{k} table{}", if k > 1.0 { "s" } else { "" }), k)
            }
            _ => (format!("{} {}", MONTHS[(m - 1) as usize], y % 100), (y * 12 + m) as f64),
        };
        let e = g.entry(key).or_insert((sort, vec![]));
        e.1.push(ti);
    }
    let mut rows: Vec<Row> = g
        .into_iter()
        .map(|(k, (sort, v))| {
            let sm = super::summary::summary_of(s, &v);
            let hours = if group == "tables" {
                // temps réel des tournois / nb de tables
                let k = sort.max(1.0);
                v.iter().map(|&i| (s.tours[i].t.end - s.tours[i].t.start) as f64).sum::<f64>() / 3600.0 / k
            } else {
                sm.seconds as f64 / 3600.0
            };
            let h = hours.max(1e-9);
            Row {
                key: k,
                sort,
                spins: sm.tournaments,
                hands: sm.hands,
                profit: sm.profit.real,
                rakeback: sm.rakeback,
                ev: sm.profit.ev,
                ev_multi: sm.profit.ev_multi,
                ev_eff: sm.profit.ev_eff,
                cev: sm.cev,
                cev_ci: sm.cev_ci,
                roi_ev: sm.roi.ev,
                hours,
                ev_hour: sm.profit.ev / h,
                real_hour: sm.profit.real_rb / h,
                spins_hour: sm.tournaments as f64 / h,
                win_pct: sm.finish[0],
            }
        })
        .collect();
    rows.sort_by(|a, b| a.sort.partial_cmp(&b.sort).unwrap().then(a.key.cmp(&b.key)));
    rows
}

fn fmt_mult(m: f64) -> String {
    if (m - m.round()).abs() < 0.01 {
        format!("{}", m.round() as i64)
    } else {
        format!("{m:.1}")
    }
}

#[derive(Serialize, Default)]
pub struct MultRow {
    pub mult: f64,
    pub count: usize,
    pub expected: f64,
    pub freq: f64,
    pub expected_freq: f64,
    pub wins: usize,
    pub profit: f64,
    pub cev: f64,
}

pub fn multipliers(s: &Store, f: &Filter) -> Vec<MultRow> {
    let sel = f.select(s);
    let n = sel.len();
    let mut map: BTreeMap<i64, MultRow> = BTreeMap::new();
    let mut evs: BTreeMap<i64, Vec<f64>> = BTreeMap::new();
    // fréquences attendues
    for &ti in &sel {
        let t = &s.tours[ti].t;
        if let Some(tab) = s.settings.table_for(&t.room, t.buyin) {
            let psum: f64 = tab.entries.iter().map(|e| e.prob).sum::<f64>().max(1e-12);
            for e in &tab.entries {
                let key = (e.mult * 100.0).round() as i64;
                let r = map.entry(key).or_insert_with(|| MultRow { mult: e.mult, ..Default::default() });
                r.expected += e.prob / psum;
            }
        }
    }
    for &ti in &sel {
        let t = &s.tours[ti];
        let key = (t.t.multiplier * 100.0).round() as i64;
        let r = map.entry(key).or_insert_with(|| MultRow { mult: t.t.multiplier, ..Default::default() });
        r.count += 1;
        if t.place == 1 {
            r.wins += 1;
        }
        r.profit += t.real;
        evs.entry(key).or_default().push(t.ev);
    }
    map.into_iter()
        .map(|(k, mut r)| {
            r.freq = if n > 0 { r.count as f64 / n as f64 * 100.0 } else { 0.0 };
            // `expected` = nombre attendu (somme des probabilités sur les tournois)
            r.expected_freq = if n > 0 { r.expected / n as f64 * 100.0 } else { 0.0 };
            r.cev = evs.get(&k).map(|v| mean_ci(v).0).unwrap_or(0.0);
            r
        })
        .collect()
}

pub fn by_stack(s: &Store, f: &Filter) -> Vec<Bar> {
    let sel = f.select(s);
    let buckets =
        [(0.0, 4.0), (4.0, 6.0), (6.0, 8.0), (8.0, 10.0), (10.0, 12.0), (12.0, 14.0), (14.0, 16.0), (16.0, 18.0), (18.0, 20.0), (20.0, 1e9)];
    buckets
        .iter()
        .map(|&(a, b)| {
            let mut c = Vec::new();
            let mut e = Vec::new();
            for &ti in &sel {
                for &hi in &s.tours[ti].hands {
                    let r = &s.hands[hi];
                    if r.f.eff_bb >= a && r.f.eff_bb < b {
                        let p = &r.f.players[r.h.hero as usize];
                        c.push(p.net / r.h.bb.max(1.0));
                        e.push(p.ev / r.h.bb.max(1.0));
                    }
                }
            }
            let (cm, cci) = mean_ci(&c);
            let (em, eci) = mean_ci(&e);
            let key = if b > 1e8 { format!("{a}+") } else { format!("{a}-{b}") };
            Bar { key, count: c.len(), hands: c.len(), chips: cm * 100.0, chips_ci: cci * 100.0, ev: em * 100.0, ev_ci: eci * 100.0 }
        })
        .collect()
}

#[derive(Serialize)]
pub struct DayCount {
    pub day: i64,
    pub spins: usize,
    pub profit: f64,
    pub ev: f64,
}

pub fn calendar(s: &Store, f: &Filter) -> Vec<DayCount> {
    let sel = f.select(s);
    let mut m: BTreeMap<i64, DayCount> = BTreeMap::new();
    for &ti in &sel {
        let t = &s.tours[ti];
        let d = m.entry(t.day).or_insert(DayCount { day: t.day, spins: 0, profit: 0.0, ev: 0.0 });
        d.spins += 1;
        d.profit += t.real + t.rb;
        d.ev += t.ev_theo + t.rb;
    }
    m.into_values().collect()
}
