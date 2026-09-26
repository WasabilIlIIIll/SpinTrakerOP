//! Laboratoire de ranges façon Flopzilla, à 2 ou 3 joueurs (BTN / SB / BB).
//!
//! - équité de chaque case de la range étudiée contre les ranges actives des autres positions ;
//!   exacte en tête-à-tête dès le flop, estimée par tirage (graine fixe) préflop ou à 3 joueurs ;
//! - détail d'une main : victoire / égalité, équité contre chaque adversaire, et répartition de ce
//!   qu'elle touche au flop (préflop) ou à la river (flop / turn), par énumération complète.

use super::ranges::{self, cell_name, cell_of, classify, combos, mask, parse, parse_cards, DRAWS, MADE};
use crate::eval::eval;
use crate::model::Card;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct Slot {
    pub pos: String,
    pub range: String,
    pub active: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LabRequest {
    pub slots: Vec<Slot>,
    /// index de la position étudiée
    pub hero: usize,
    /// main détaillée : case (`T2s`) ou combo (`Th2h`)
    #[serde(default)]
    pub hand: String,
    #[serde(default)]
    pub board: String,
    #[serde(default)]
    pub dead: String,
}

#[derive(Serialize)]
pub struct SlotInfo {
    pub pos: String,
    pub combos: f64,
    /// part des 1 326 combos
    pub pct: f64,
    pub equity: Option<f64>,
}

#[derive(Serialize)]
pub struct Outcome {
    pub name: String,
    pub draw: bool,
    pub pct: f64,
}

#[derive(Serialize)]
pub struct HandDetail {
    pub name: String,
    pub combos: usize,
    pub equity: f64,
    pub win: f64,
    pub tie: f64,
    /// équité contre chaque adversaire actif seul (tête-à-tête)
    pub vs: Vec<(String, f64)>,
    /// ce que la main touche : au flop si le board est vide, à la river sinon
    pub outcomes_street: String,
    pub outcomes: Vec<Outcome>,
    pub exact: bool,
}

#[derive(Serialize)]
pub struct LabResult {
    pub slots: Vec<SlotInfo>,
    pub grid: Vec<f64>,
    pub grid_equity: Vec<Option<f64>>,
    pub equity: Option<f64>,
    pub exact: bool,
    pub categories: Vec<ranges::CategoryRow>,
    pub distribution: Vec<f64>,
    pub hand: Option<HandDetail>,
    pub players: usize,
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// Tirage pondéré d'un combo dans une range (tableau cumulé).
fn pick(cum: &[f64], rng: &mut Rng) -> usize {
    let t = rng.unit() * cum[cum.len() - 1];
    cum.partition_point(|&c| c <= t).min(cum.len() - 1)
}

/// Équité multiway par tirage : gain moyen (part du pot) de `hero` contre un combo tiré dans
/// chaque range adverse, board complété au hasard. Renvoie (équité, victoire seule, égalité).
fn mc_equity(hero: (Card, Card), vils: &[Vec<(Card, Card, f32)>], board: &[Card], dead: u64, samples: usize, seed: u64) -> Option<(f64, f64, f64)> {
    let cums: Vec<Vec<f64>> = vils
        .iter()
        .map(|v| {
            let mut acc = 0.0;
            v.iter().map(|x| {
                acc += x.2 as f64;
                acc
            }).collect()
        })
        .collect();
    if cums.iter().any(|c| c.is_empty() || *c.last().unwrap() <= 0.0) {
        return None;
    }
    let base = dead | mask(board) | 1u64 << hero.0 | 1u64 << hero.1;
    let deck: Vec<Card> = (0..52u8).filter(|c| base & (1u64 << c) == 0).collect();
    let need = 5 - board.len();
    let mut rng = Rng(seed | 1);
    let (mut eq, mut win, mut tie, mut n) = (0.0, 0.0, 0.0, 0usize);
    let mut cards = [0u8; 7];
    cards[2..2 + board.len()].copy_from_slice(board);
    let mut tries = 0;
    while n < samples && tries < samples * 20 {
        tries += 1;
        let mut used = base;
        let mut opp = [(0u8, 0u8); 2];
        let mut ok = true;
        for (k, v) in vils.iter().enumerate() {
            let (a, b, _) = v[pick(&cums[k], &mut rng)];
            let m = 1u64 << a | 1u64 << b;
            if used & m != 0 {
                ok = false;
                break;
            }
            used |= m;
            opp[k] = (a, b);
        }
        if !ok {
            continue;
        }
        // compléter le board
        let mut filled = 0;
        while filled < need {
            let c = deck[(rng.next() % deck.len() as u64) as usize];
            if used & (1u64 << c) != 0 {
                continue;
            }
            used |= 1u64 << c;
            cards[2 + board.len() + filled] = c;
            filled += 1;
        }
        cards[0] = hero.0;
        cards[1] = hero.1;
        let h = eval(&cards);
        let mut best_opp = 0;
        let mut ties = 0;
        for o in opp.iter().take(vils.len()) {
            cards[0] = o.0;
            cards[1] = o.1;
            let r = eval(&cards);
            if r > best_opp {
                best_opp = r;
                ties = 0;
            }
            if r == h {
                ties += 1;
            }
        }
        if h > best_opp {
            eq += 1.0;
            win += 1.0;
        } else if h == best_opp {
            eq += 1.0 / (1 + ties) as f64;
            tie += 1.0;
        }
        n += 1;
    }
    if n == 0 {
        return None;
    }
    let n = n as f64;
    Some((eq / n, win / n, tie / n))
}

/// Répartition des catégories finales d'une main : sur tous les flops (board vide) ou tous les
/// runouts jusqu'à la river (board de 3 ou 4 cartes). Énumération exacte.
fn outcomes(hand: (Card, Card), board: &[Card], dead: u64) -> (String, Vec<Outcome>) {
    let base = dead | mask(board) | 1u64 << hand.0 | 1u64 << hand.1;
    let deck: Vec<Card> = (0..52u8).filter(|c| base & (1u64 << c) == 0).collect();
    let mut made = vec![0.0f64; MADE.len()];
    let mut draws = vec![0.0f64; DRAWS.len()];
    let mut total = 0.0;
    let mut add = |b: &[Card]| {
        let (m, d) = classify(hand.0, hand.1, b);
        made[m] += 1.0;
        for x in d {
            draws[x] += 1.0;
        }
        total += 1.0;
    };
    let street;
    match board.len() {
        0 => {
            street = "au flop";
            for i in 0..deck.len() {
                for j in i + 1..deck.len() {
                    for k in j + 1..deck.len() {
                        add(&[deck[i], deck[j], deck[k]]);
                    }
                }
            }
        }
        3 => {
            street = "à la river";
            for i in 0..deck.len() {
                for j in i + 1..deck.len() {
                    add(&[board[0], board[1], board[2], deck[i], deck[j]]);
                }
            }
        }
        4 => {
            street = "à la river";
            for &c in &deck {
                add(&[board[0], board[1], board[2], board[3], c]);
            }
        }
        _ => {
            street = "sur ce board";
            add(board);
        }
    }
    let mut out: Vec<Outcome> = MADE
        .iter()
        .zip(&made)
        .filter(|(_, &c)| c > 0.0)
        .map(|(n, &c)| Outcome { name: n.to_string(), draw: false, pct: c / total })
        .collect();
    if board.len() < 3 {
        out.extend(DRAWS.iter().zip(&draws).filter(|(_, &c)| c > 0.0).map(|(n, &c)| Outcome { name: n.to_string(), draw: true, pct: c / total }));
    }
    (street.to_string(), out)
}

/// Combos d'une case (`T2s`) ou d'un combo précis (`Th2h`), hors cartes mortes.
fn hand_combos(hand: &str, dead: u64) -> Result<Vec<(Card, Card)>, String> {
    let h = hand.trim();
    if h.len() == 4 && h.chars().nth(1).map(|c| "cdhsCDHS".contains(c)).unwrap_or(false) {
        let c = parse_cards(h)?;
        if dead & (1u64 << c[0] | 1u64 << c[1]) != 0 {
            return Err("cette main utilise une carte déjà sortie".into());
        }
        return Ok(vec![(c[0], c[1])]);
    }
    let r = parse(h)?;
    Ok(combos(&r, dead).into_iter().map(|(a, b, _)| (a, b)).collect())
}

pub fn run(req: &LabRequest) -> Result<LabResult, String> {
    let board = parse_cards(&req.board)?;
    if board.len() == 1 || board.len() == 2 || board.len() > 5 {
        return Err("le board doit compter 0, 3, 4 ou 5 cartes".into());
    }
    let dead_c = parse_cards(&req.dead)?;
    let dm = mask(&board) | mask(&dead_c);
    let hero_slot = req.slots.get(req.hero).ok_or("position étudiée inconnue")?;
    let parsed: Vec<Vec<(Card, Card, f32)>> = req.slots.iter().map(|s| parse(&s.range).map(|r| combos(&r, dm))).collect::<Result<_, _>>()?;
    let vil_idx: Vec<usize> = (0..req.slots.len()).filter(|&i| i != req.hero && req.slots[i].active && !parsed[i].is_empty()).collect();
    let vils: Vec<Vec<(Card, Card, f32)>> = vil_idx.iter().map(|&i| parsed[i].clone()).collect();
    let hero = &parsed[req.hero];
    let players = 1 + vils.len();
    let exact = vils.len() == 1 && board.len() >= 3;

    // équité par combo de la range étudiée
    let eqs: Option<Vec<f64>> = if vils.is_empty() || hero.is_empty() {
        None
    } else if exact {
        Some(ranges::equities(hero, &vils[0], &board, 0))
    } else {
        let per = if vils.len() == 1 { 1500 } else { 2500 };
        Some(
            hero.par_iter()
                .enumerate()
                .map(|(i, &(a, b, _))| mc_equity((a, b), &vils, &board, dm, per, 0x5151 + i as u64).map(|x| x.0).unwrap_or(0.0))
                .collect(),
        )
    };
    let mut grid = vec![0.0f64; 169];
    let mut geq = vec![(0.0f64, 0.0f64); 169];
    for (i, &(a, b, w)) in hero.iter().enumerate() {
        let c = cell_of(a, b);
        grid[c] += w as f64;
        if let Some(e) = &eqs {
            geq[c].0 += e[i] * w as f64;
            geq[c].1 += w as f64;
        }
    }
    let wsum: f64 = hero.iter().map(|x| x.2 as f64).sum();
    let equity = eqs.as_ref().map(|e| e.iter().zip(hero).map(|(q, x)| q * x.2 as f64).sum::<f64>() / wsum.max(1e-12));

    // équité de chaque adversaire contre le reste du champ (pour la ligne de chaque position)
    let mut slots: Vec<SlotInfo> = req
        .slots
        .iter()
        .zip(&parsed)
        .map(|(s, c)| {
            let n: f64 = c.iter().map(|x| x.2 as f64).sum();
            SlotInfo { pos: s.pos.clone(), combos: n, pct: n / 1326.0, equity: None }
        })
        .collect();
    slots[req.hero].equity = equity;
    if players == 2 && exact {
        let v = &vils[0];
        let e = ranges::equities(v, hero, &board, 0);
        let w: f64 = v.iter().map(|x| x.2 as f64).sum();
        slots[vil_idx[0]].equity = Some(e.iter().zip(v).map(|(q, x)| q * x.2 as f64).sum::<f64>() / w.max(1e-12));
    } else if let Some(eq) = equity {
        if players == 2 {
            slots[vil_idx[0]].equity = Some(1.0 - eq);
        }
    }

    // catégories et distribution (range étudiée)
    let categories = if board.len() >= 3 {
        ranges::analyze(&hero_slot.range, &req.board, &req.dead, "")?.categories
    } else {
        vec![]
    };
    let distribution = match &eqs {
        Some(e) => {
            let mut v: Vec<(f64, f64)> = e.iter().copied().zip(hero.iter().map(|x| x.2 as f64)).collect();
            v.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
            let tot: f64 = v.iter().map(|x| x.1).sum();
            let (mut acc, mut k) = (0.0, 0);
            (0..=100)
                .map(|p| {
                    let t = tot * p as f64 / 100.0;
                    while k < v.len() - 1 && acc + v[k].1 < t {
                        acc += v[k].1;
                        k += 1;
                    }
                    v[k].0
                })
                .collect()
        }
        None => vec![],
    };

    // détail d'une main
    let hand = if req.hand.trim().is_empty() {
        None
    } else {
        let hc = hand_combos(&req.hand, dm)?;
        if hc.is_empty() {
            return Err("aucun combo de cette main n'est disponible (cartes sorties)".into());
        }
        let name = if hc.len() == 1 { ranges::combo_name(hc[0].0, hc[0].1) } else { cell_name(cell_of(hc[0].0, hc[0].1)) };
        let per = (60_000 / hc.len()).max(4000);
        let res: Vec<(f64, f64, f64)> = hc
            .par_iter()
            .enumerate()
            .filter_map(|(i, &h)| if vils.is_empty() { None } else { mc_equity(h, &vils, &board, dm, per, 0xA11 + i as u64) })
            .collect();
        let k = res.len().max(1) as f64;
        let (eq, win, tie) = res.iter().fold((0.0, 0.0, 0.0), |a, x| (a.0 + x.0 / k, a.1 + x.1 / k, a.2 + x.2 / k));
        let vs = vil_idx
            .iter()
            .map(|&i| {
                let one = vec![parsed[i].clone()];
                let e: f64 = hc.iter().enumerate().filter_map(|(j, &h)| mc_equity(h, &one, &board, dm, per, 0xB22 + j as u64).map(|x| x.0)).sum::<f64>() / hc.len() as f64;
                (req.slots[i].pos.clone(), e)
            })
            .collect();
        let (outcomes_street, outcomes) = if board.len() < 5 {
            // moyenne sur les combos de la case
            let parts: Vec<(String, Vec<Outcome>)> = hc.iter().map(|&h| outcomes(h, &board, dm)).collect();
            let street = parts[0].0.clone();
            let mut acc: Vec<Outcome> = vec![];
            for (_, list) in &parts {
                for o in list {
                    match acc.iter_mut().find(|x| x.name == o.name && x.draw == o.draw) {
                        Some(x) => x.pct += o.pct / parts.len() as f64,
                        None => acc.push(Outcome { name: o.name.clone(), draw: o.draw, pct: o.pct / parts.len() as f64 }),
                    }
                }
            }
            let order = |o: &Outcome| if o.draw { 100 + DRAWS.iter().position(|d| *d == o.name).unwrap_or(0) } else { MADE.iter().position(|d| *d == o.name).unwrap_or(0) };
            acc.sort_by_key(order);
            (street, acc)
        } else {
            ("sur ce board".into(), vec![])
        };
        Some(HandDetail { name, combos: hc.len(), equity: eq, win, tie, vs, outcomes_street, outcomes, exact: false })
    };

    Ok(LabResult {
        slots,
        grid,
        grid_equity: geq.iter().map(|(s, w)| if *w > 0.0 { Some(s / w) } else { None }).collect(),
        equity,
        exact,
        categories,
        distribution,
        hand,
        players,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slot(pos: &str, r: &str) -> Slot {
        Slot { pos: pos.into(), range: r.into(), active: true }
    }

    #[test]
    fn three_way_aa_vs_two_random() {
        // AA contre deux mains aléatoires : ~73,4 % (valeur de référence connue)
        let req = LabRequest {
            slots: vec![slot("BTN", "AA"), slot("SB", "22+,A2+,K2+,Q2+,J2+,T2+,92+,82+,72+,62+,52+,42+,32"), slot("BB", "22+,A2+,K2+,Q2+,J2+,T2+,92+,82+,72+,62+,52+,42+,32")],
            hero: 0,
            hand: "AA".into(),
            board: String::new(),
            dead: String::new(),
        };
        let r = run(&req).unwrap();
        let h = r.hand.unwrap();
        assert!((h.equity - 0.734).abs() < 0.01, "{}", h.equity);
        assert_eq!(r.players, 3);
    }

    #[test]
    fn flop_hit_odds() {
        // une main non appariée touche au moins une paire au flop ~32,4 % du temps (paire exacte ~29 %)
        let (street, o) = outcomes((parse_cards("Ts").unwrap()[0], parse_cards("2s").unwrap()[0]), &[], 0);
        assert_eq!(street, "au flop");
        let fd = o.iter().find(|x| x.name == "Tirage couleur").unwrap().pct;
        // tirage couleur au flop avec deux cartes assorties : 10,9 %
        assert!((fd - 0.109).abs() < 0.003, "{fd}");
    }
}
