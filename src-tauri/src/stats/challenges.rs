//! Challenges : objectifs (volume, heures, profit, CEV, bankroll…) sur une période.

use super::summary::{summary_of, Summary};
use super::Filter;
use crate::store::Store;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Challenge {
    pub id: Option<i64>,
    pub name: String,
    /// spins | hands | hours | ev_profit | profit | cev | bankroll | rakeback
    pub kind: String,
    pub target: f64,
    pub min_spins: f64,
    pub start: i64,
    pub end: i64,
    pub filter: Filter,
    pub color: String,
    pub abandoned: bool,
}

#[derive(Serialize)]
pub struct DayPoint {
    pub day: i64,
    pub value: f64,
}

#[derive(Serialize)]
pub struct ChallengeView {
    pub challenge: Challenge,
    pub value: f64,
    pub progress: f64,
    /// en_cours | reussi | echoue | abandonne | a_venir
    pub status: String,
    pub days_total: i64,
    pub days_left: f64,
    pub required_per_day: f64,
    pub remaining_per_day: f64,
    pub daily: Vec<DayPoint>,
    pub summary: Summary,
}

fn metric_of(s: &Store, idx: &[usize], kind: &str) -> f64 {
    match kind {
        "spins" => idx.len() as f64,
        "hands" => idx.iter().map(|&i| s.tours[i].hands.len()).sum::<usize>() as f64,
        "hours" => super::summary::union_seconds(s, idx) as f64 / 3600.0,
        "ev_profit" => idx.iter().map(|&i| s.tours[i].ev_theo + s.tours[i].rb).sum(),
        "profit" | "bankroll" => idx.iter().map(|&i| s.tours[i].real + s.tours[i].rb).sum(),
        "rakeback" => idx.iter().map(|&i| s.tours[i].rb).sum(),
        "cev" => {
            if idx.is_empty() {
                0.0
            } else {
                idx.iter().map(|&i| s.tours[i].ev).sum::<f64>() / idx.len() as f64
            }
        }
        _ => idx.len() as f64,
    }
}

pub fn view(s: &Store, c: &Challenge, now: i64) -> ChallengeView {
    let mut f = c.filter.clone();
    f.from = Some(c.start);
    f.to = Some(c.end);
    let sel = f.select(s);
    let summary = summary_of(s, &sel);
    let mut value = metric_of(s, &sel, &c.kind);
    if c.kind == "bankroll" {
        let tx: f64 = s.settings.transactions.iter().map(|t| t.amount).sum();
        let all: f64 = s.tours.iter().map(|t| t.real + t.rb).sum();
        value = s.settings.bankroll_start + tx + all;
    }
    let mut by_day: BTreeMap<i64, Vec<usize>> = BTreeMap::new();
    for &i in &sel {
        by_day.entry(s.tours[i].day).or_default().push(i);
    }
    let d0 = c.start.div_euclid(86400);
    let d1 = c.end.div_euclid(86400);
    let daily: Vec<DayPoint> = (d0..=d1)
        .map(|d| DayPoint {
            day: d,
            value: by_day.get(&d).map(|v| if c.kind == "cev" { metric_of(s, v, "cev") } else { metric_of(s, v, &c.kind) }).unwrap_or(0.0),
        })
        .collect();
    let days_total = (d1 - d0 + 1).max(1);
    let days_left = ((c.end - now) as f64 / 86400.0).max(0.0);
    let progress = if c.target != 0.0 { (value / c.target).clamp(0.0, 1.0) } else { 0.0 };
    let reached = if c.kind == "cev" { value >= c.target && (sel.len() as f64) >= c.min_spins } else { value >= c.target };
    let status = if c.abandoned {
        "abandonne"
    } else if now < c.start {
        "a_venir"
    } else if reached && (c.kind != "cev" || now > c.end) {
        "reussi"
    } else if now > c.end {
        if reached {
            "reussi"
        } else {
            "echoue"
        }
    } else {
        "en_cours"
    };
    let required_per_day = c.target / days_total as f64;
    let remaining_per_day = if days_left > 0.0 { ((c.target - value).max(0.0)) / days_left.ceil().max(1.0) } else { 0.0 };
    ChallengeView {
        challenge: c.clone(),
        value,
        progress,
        status: status.into(),
        days_total,
        days_left,
        required_per_day,
        remaining_per_day,
        daily,
        summary,
    }
}
