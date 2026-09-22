//! Modèle de données brut, tel que produit par les parsers et stocké en base.

use serde::{Deserialize, Serialize};

/// Carte encodée 0..52 : `rank * 4 + suit`, rank 0 = deux .. 12 = as.
pub type Card = u8;

pub const STREET_PREFLOP: u8 = 0;
pub const STREET_FLOP: u8 = 1;
pub const STREET_TURN: u8 = 2;
pub const STREET_RIVER: u8 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActKind {
    Ante,
    SmallBlind,
    BigBlind,
    Fold,
    Check,
    Call,
    Bet,
    Raise,
}

impl ActKind {
    pub fn is_voluntary(self) -> bool {
        matches!(self, ActKind::Call | ActKind::Bet | ActKind::Raise)
    }
    pub fn is_aggressive(self) -> bool {
        matches!(self, ActKind::Bet | ActKind::Raise)
    }
    pub fn is_post(self) -> bool {
        matches!(self, ActKind::Ante | ActKind::SmallBlind | ActKind::BigBlind)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub street: u8,
    /// index du joueur dans `Hand::seats`
    pub p: u8,
    pub kind: ActKind,
    /// jetons ajoutés au pot par cette action
    pub amount: f64,
    /// le joueur est à tapis après cette action
    pub allin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Seat {
    pub name: String,
    pub seat: u8,
    pub stack: f64,
    pub cards: Option<[Card; 2]>,
    /// total investi (tel que déclaré par la room, retours non suivis compris)
    pub bet: f64,
    /// total gagné (pots remportés)
    pub win: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hand {
    pub id: String,
    pub tid: String,
    pub ts: i64,
    pub sb: f64,
    pub bb: f64,
    pub ante: f64,
    pub seats: Vec<Seat>,
    pub button: u8,
    pub hero: u8,
    pub actions: Vec<Action>,
    pub board: Vec<Card>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Tournament {
    pub id: String,
    pub room: String,
    pub code: String,
    pub name: String,
    pub hero: String,
    pub start: i64,
    pub end: i64,
    pub buyin: f64,
    pub rake: f64,
    pub prize_contrib: f64,
    pub bounty: f64,
    pub prize_pool: f64,
    pub multiplier: f64,
    /// 0 = inconnue
    pub place: u8,
    pub winnings: f64,
    pub table_size: u8,
    pub currency: String,
    pub starting_stack: f64,
    pub hands: u32,
    pub source: String,
}

pub fn card_str(c: Card) -> String {
    const R: &[u8] = b"23456789TJQKA";
    const S: &[u8] = b"cdhs";
    let mut s = String::with_capacity(2);
    s.push(R[(c / 4) as usize] as char);
    s.push(S[(c % 4) as usize] as char);
    s
}
