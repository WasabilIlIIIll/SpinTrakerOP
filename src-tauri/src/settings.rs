//! Paramètres de calcul (persistés en base, clé `settings`).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultEntry {
    pub mult: f64,
    /// probabilité (0..1)
    pub prob: f64,
    /// répartition du prize pool 1er/2e/3e (somme = 1)
    pub shares: [f64; 3],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultTable {
    pub id: String,
    pub name: String,
    pub room: String,
    /// buy-in concerné (None = tous)
    pub buyin: Option<f64>,
    pub entries: Vec<MultEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagRule {
    pub stat: String,
    pub op: String,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagDef {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub active: bool,
    pub auto: bool,
    /// "all" | "any"
    pub mode: String,
    pub rules: Vec<TagRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Txn {
    pub ts: i64,
    pub amount: f64,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub default_rakeback: f64,
    pub rakeback: HashMap<String, f64>,
    pub mult_tables: Vec<MultTable>,
    pub jackpot_threshold: f64,
    pub tags: Vec<TagDef>,
    /// références du leak finder : "noeud|action|tranche" -> %
    pub references: HashMap<String, f64>,
    pub bankroll_start: f64,
    pub transactions: Vec<Txn>,
    pub heroes: Vec<String>,
    pub min_hands_tag: u32,
}

fn e(mult: f64, prob: f64) -> MultEntry {
    let shares = if mult >= 10.0 { [0.75, 0.15, 0.10] } else { [1.0, 0.0, 0.0] };
    MultEntry { mult, prob, shares }
}

pub fn default_tables() -> Vec<MultTable> {
    vec![
        MultTable {
            id: "ipoker-twister".into(),
            name: "Twister (PMU / iPoker)".into(),
            room: "PMU".into(),
            buyin: None,
            entries: vec![
                e(2.0, 0.55499),
                e(3.0, 0.29),
                e(4.0, 0.09),
                e(5.0, 0.05),
                e(10.0, 0.0135),
                e(25.0, 0.0014),
                e(100.0, 0.0001),
                e(1000.0, 0.00001),
            ],
        },
        MultTable {
            // Betclic ne publie sa grille qu'en image : fréquences observées sur ~800 Spin & Rush
            // (x2 ≈ 47 %, « 1 chance sur 2 de jouer x3 ou plus »), jackpots d'après l'annonce x5000.
            id: "betclic-spin-rush".into(),
            name: "Spin & Rush (Betclic, estimée)".into(),
            room: "Betclic".into(),
            buyin: None,
            entries: vec![
                MultEntry { mult: 2.0, prob: 0.47, shares: [1.0, 0.0, 0.0] },
                MultEntry { mult: 3.0, prob: 0.335, shares: [1.0, 0.0, 0.0] },
                MultEntry { mult: 4.0, prob: 0.12, shares: [1.0, 0.0, 0.0] },
                MultEntry { mult: 5.0, prob: 0.055, shares: [1.0, 0.0, 0.0] },
                MultEntry { mult: 10.0, prob: 0.0145, shares: [1.0, 0.0, 0.0] },
                // observé : 3e place payée 10 % du prize pool à partir de x20
                MultEntry { mult: 20.0, prob: 0.004, shares: [0.8, 0.1, 0.1] },
                MultEntry { mult: 100.0, prob: 0.0004, shares: [0.8, 0.1, 0.1] },
                MultEntry { mult: 1000.0, prob: 0.00004, shares: [0.8, 0.1, 0.1] },
                MultEntry { mult: 5000.0, prob: 0.000005, shares: [0.8, 0.1, 0.1] },
            ],
        },
        MultTable {
            id: "winamax-expresso".into(),
            name: "Expresso (Winamax)".into(),
            room: "Winamax".into(),
            buyin: None,
            entries: vec![
                MultEntry { mult: 2.0, prob: 0.56, shares: [1.0, 0.0, 0.0] },
                MultEntry { mult: 3.0, prob: 0.30, shares: [1.0, 0.0, 0.0] },
                MultEntry { mult: 4.0, prob: 0.075, shares: [1.0, 0.0, 0.0] },
                MultEntry { mult: 6.0, prob: 0.049, shares: [1.0, 0.0, 0.0] },
                MultEntry { mult: 10.0, prob: 0.015, shares: [1.0, 0.0, 0.0] },
                MultEntry { mult: 100.0, prob: 0.00089, shares: [0.8, 0.1, 0.1] },
                MultEntry { mult: 1000.0, prob: 0.0001, shares: [0.8, 0.1, 0.1] },
                MultEntry { mult: 10000.0, prob: 0.00001, shares: [0.8, 0.1, 0.1] },
            ],
        },
    ]
}

fn rule(stat: &str, op: &str, value: f64) -> TagRule {
    TagRule { stat: stat.into(), op: op.into(), value }
}

pub fn default_tags() -> Vec<TagDef> {
    vec![
        TagDef {
            id: "reg".into(),
            name: "Reg".into(),
            color: "#e5484d".into(),
            icon: "crown".into(),
            active: true,
            auto: true,
            mode: "all".into(),
            rules: vec![rule("hands", ">=", 50.0), rule("limp_btn", "<=", 5.0)],
        },
        TagDef {
            id: "agressif".into(),
            name: "Agressif".into(),
            color: "#c084fc".into(),
            icon: "flame".into(),
            active: true,
            auto: true,
            mode: "all".into(),
            rules: vec![rule("vpip", ">=", 55.0), rule("pfr", ">=", 25.0)],
        },
        TagDef {
            id: "fish".into(),
            name: "Fish".into(),
            color: "#3b82f6".into(),
            icon: "fish".into(),
            active: true,
            auto: true,
            mode: "any".into(),
            rules: vec![rule("hands", "<", 50.0), rule("limp_btn", ">", 5.0)],
        },
    ]
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            default_rakeback: 10.0,
            rakeback: HashMap::new(),
            mult_tables: default_tables(),
            jackpot_threshold: 10.0,
            tags: default_tags(),
            references: HashMap::new(),
            bankroll_start: 0.0,
            transactions: vec![],
            heroes: vec![],
            min_hands_tag: 0,
        }
    }
}

impl Settings {
    /// Ajoute les grilles par défaut des rooms apparues depuis l'enregistrement des réglages.
    pub fn add_missing_tables(&mut self) {
        for t in default_tables() {
            if !self.mult_tables.iter().any(|m| m.id == t.id || m.room.eq_ignore_ascii_case(&t.room)) {
                self.mult_tables.push(t);
            }
        }
    }

    pub fn rakeback_for(&self, room: &str) -> f64 {
        *self.rakeback.get(room).unwrap_or(&self.default_rakeback) / 100.0
    }

    pub fn table_for(&self, room: &str, buyin: f64) -> Option<&MultTable> {
        self.mult_tables
            .iter()
            .filter(|t| t.room.eq_ignore_ascii_case(room))
            .find(|t| t.buyin.map(|b| (b - buyin).abs() < 0.001).unwrap_or(false))
            .or_else(|| self.mult_tables.iter().find(|t| t.room.eq_ignore_ascii_case(room) && t.buyin.is_none()))
            .or_else(|| self.mult_tables.first())
    }
}
