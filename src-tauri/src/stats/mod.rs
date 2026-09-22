pub mod breakdown;
pub mod challenges;
pub mod charts;
pub mod leaks;
pub mod players;
pub mod summary;

use crate::store::Store;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Filter {
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub buyins: Vec<f64>,
    pub rooms: Vec<String>,
    pub mult_min: Option<f64>,
    pub mult_max: Option<f64>,
    pub heroes: Vec<String>,
    pub tables_min: Option<f64>,
    pub tables_max: Option<f64>,
    pub places: Vec<u8>,
    /// tournois où au moins un adversaire porte ce tag
    pub opp_tag: Option<String>,
    /// tournois contre ce joueur
    pub opponent: Option<String>,
    pub hours: Vec<u8>,
    pub weekdays: Vec<u8>,
}

impl Filter {
    pub fn select(&self, s: &Store) -> Vec<usize> {
        s.tours
            .iter()
            .enumerate()
            .filter(|(_, t)| {
                if let Some(f) = self.from {
                    if t.t.start < f {
                        return false;
                    }
                }
                if let Some(to) = self.to {
                    if t.t.start > to {
                        return false;
                    }
                }
                if !self.buyins.is_empty() && !self.buyins.iter().any(|b| (b - t.t.buyin).abs() < 0.001) {
                    return false;
                }
                if !self.rooms.is_empty() && !self.rooms.contains(&t.t.room) {
                    return false;
                }
                if let Some(m) = self.mult_min {
                    if t.t.multiplier < m {
                        return false;
                    }
                }
                if let Some(m) = self.mult_max {
                    if t.t.multiplier > m {
                        return false;
                    }
                }
                if !self.heroes.is_empty() && !self.heroes.contains(&t.t.hero) {
                    return false;
                }
                if let Some(m) = self.tables_min {
                    if t.tables.round() < m {
                        return false;
                    }
                }
                if let Some(m) = self.tables_max {
                    if t.tables.round() > m {
                        return false;
                    }
                }
                if !self.places.is_empty() && !self.places.contains(&t.place) {
                    return false;
                }
                if let Some(tag) = &self.opp_tag {
                    if !t.opponents.iter().any(|o| s.tags_of(o).contains(tag)) {
                        return false;
                    }
                }
                if let Some(o) = &self.opponent {
                    if !t.opponents.contains(o) {
                        return false;
                    }
                }
                if !self.hours.is_empty() && !self.hours.contains(&(((t.t.start.rem_euclid(86400)) / 3600) as u8)) {
                    return false;
                }
                if !self.weekdays.is_empty() && !self.weekdays.contains(&weekday(t.day)) {
                    return false;
                }
                true
            })
            .map(|(i, _)| i)
            .collect()
    }
}

/// 0 = lundi … 6 = dimanche
pub fn weekday(day: i64) -> u8 {
    // 1970-01-01 était un jeudi (3)
    ((day + 3).rem_euclid(7)) as u8
}

pub fn mean_ci(values: &[f64]) -> (f64, f64) {
    let n = values.len();
    if n == 0 {
        return (0.0, 0.0);
    }
    let m = values.iter().sum::<f64>() / n as f64;
    if n < 2 {
        return (m, 0.0);
    }
    let var = values.iter().map(|v| (v - m) * (v - m)).sum::<f64>() / (n - 1) as f64;
    (m, 1.96 * (var / n as f64).sqrt())
}
