//! Ranges et analyse de range façon Flopzilla : catégories de mains sur un board,
//! équité exacte combo par combo contre une range adverse.
//!
//! Cartes : même codage que le tracker et que postflop-solver (`rank * 4 + suit`,
//! couleurs c d h s).

use crate::eval::eval;
use crate::model::{card_str, Card};
use postflop_solver::Range;
use rayon::prelude::*;
use serde::Serialize;
use std::str::FromStr;

pub const RANKS: &[u8] = b"23456789TJQKA";

/// Lit une range au format solver (`AA,AKs:0.5,QJo,AsKs`). Chaîne vide = range vide.
pub fn parse(s: &str) -> Result<Range, String> {
    let s = s.trim();
    if s.is_empty() {
        return Ok(Range::new());
    }
    Range::from_str(s).map_err(|e| format!("range invalide : {e}"))
}

/// Index de case dans la grille 13×13 (ligne 0 = as). Diagonale = paires,
/// au-dessus = suitées, en dessous = offsuit.
pub fn cell_of(c1: Card, c2: Card) -> usize {
    let (r1, r2) = (12 - (c1 / 4) as usize, 12 - (c2 / 4) as usize);
    let (hi, lo) = if r1 <= r2 { (r1, r2) } else { (r2, r1) };
    if hi == lo {
        hi * 13 + hi
    } else if c1 % 4 == c2 % 4 {
        hi * 13 + lo
    } else {
        lo * 13 + hi
    }
}

pub fn cell_name(cell: usize) -> String {
    let (i, j) = (cell / 13, cell % 13);
    let r = |k: usize| RANKS[12 - k] as char;
    if i == j {
        format!("{}{}", r(i), r(i))
    } else if i < j {
        format!("{}{}s", r(i), r(j))
    } else {
        format!("{}{}o", r(j), r(i))
    }
}

/// Nom d'un combo, carte haute en premier (`AsKd`).
pub fn combo_name(c1: Card, c2: Card) -> String {
    let (a, b) = if c1 > c2 { (c1, c2) } else { (c2, c1) };
    format!("{}{}", card_str(a), card_str(b))
}

pub fn parse_cards(s: &str) -> Result<Vec<Card>, String> {
    let s: String = s.chars().filter(|c| !c.is_whitespace() && *c != ',').collect();
    if s.len() % 2 != 0 {
        return Err(format!("cartes invalides : {s}"));
    }
    let b = s.as_bytes();
    let mut out = Vec::new();
    for k in (0..b.len()).step_by(2) {
        let r = RANKS.iter().position(|&x| x == b[k].to_ascii_uppercase()).ok_or(format!("rang inconnu : {}", b[k] as char))?;
        let su = b"cdhs".iter().position(|&x| x == b[k + 1].to_ascii_lowercase()).ok_or(format!("couleur inconnue : {}", b[k + 1] as char))?;
        let c = (r * 4 + su) as Card;
        if out.contains(&c) {
            return Err(format!("carte en double : {}", card_str(c)));
        }
        out.push(c);
    }
    Ok(out)
}

/// Combos d'une range compatibles avec les cartes mortes (masque), avec leur poids.
pub fn combos(range: &Range, dead: u64) -> Vec<(Card, Card, f32)> {
    let (hands, w) = range.get_hands_weights(dead);
    hands.into_iter().zip(w).filter(|(_, w)| *w > 0.0).map(|((a, b), w)| (a, b, w)).collect()
}

pub fn mask(cards: &[Card]) -> u64 {
    cards.iter().fold(0u64, |m, &c| m | 1 << c)
}

// ---------------------------------------------------------------- catégories

/// Catégories affichées, dans l'ordre de l'interface. Les `made` sont exclusives entre elles,
/// les tirages se cumulent.
pub const MADE: &[&str] = &[
    "Quinte flush",
    "Carré",
    "Full",
    "Couleur",
    "Quinte",
    "Brelan (set)",
    "Brelan",
    "Deux paires",
    "Overpair",
    "Top paire",
    "Paire sous la top",
    "Paire moyenne",
    "Petite paire",
    "Hauteur as",
    "Rien",
];
pub const DRAWS: &[&str] = &["Tirage couleur", "Tirage quinte ouvert", "Ventrale", "Tirage combo", "Backdoor couleur", "Deux overcards"];

fn straight_mask(m: u32) -> bool {
    // m : bits 0..12 = rangs 2..A ; l'as compte aussi en bas
    let m = (m << 1) | (m >> 12 & 1);
    m & (m << 1) & (m << 2) & (m << 3) & (m << 4) != 0
}

/// Nombre de rangs qui complètent une quinte (outs de rang).
fn straight_outs(m: u32) -> u32 {
    if straight_mask(m) {
        return 0;
    }
    (0..13).filter(|r| m & (1 << r) == 0 && straight_mask(m | 1 << r)).count() as u32
}

/// Catégorie « faite » et tirages d'un combo sur un board de 3 à 5 cartes.
pub fn classify(c1: Card, c2: Card, board: &[Card]) -> (usize, Vec<usize>) {
    let mut all = vec![c1, c2];
    all.extend_from_slice(board);
    let v = eval(&all);
    let class = v >> 26;
    let (h1, h2) = ((c1 / 4) as u32, (c2 / 4) as u32);
    let mut branks: Vec<u32> = board.iter().map(|&c| (c / 4) as u32).collect();
    branks.sort_unstable_by(|a, b| b.cmp(a));
    branks.dedup();
    let top = branks[0];
    let board_counts = |r: u32| board.iter().filter(|&&c| (c / 4) as u32 == r).count();
    let made = match class {
        8 => 0,
        7 => 1,
        6 => 2,
        5 => 3,
        4 => 4,
        3 => {
            if h1 == h2 && board_counts(h1) == 1 {
                5
            } else if board_counts(h1) >= 1 && h1 != h2 || board_counts(h2) >= 1 && h1 != h2 {
                6
            } else {
                // brelan entièrement au board
                if h1 == 12 || h2 == 12 { 13 } else { 14 }
            }
        }
        2 => {
            let hole_pairs = [h1, h2].iter().filter(|&&r| board_counts(r) >= 1).count();
            if h1 == h2 || hole_pairs >= 1 {
                // une paire du board + une paire avec nos cartes : compte comme la paire jouée
                let board_paired = branks.len() < board.len();
                if hole_pairs == 2 || !board_paired {
                    7
                } else {
                    pair_kind(h1, h2, &branks, board)
                }
            } else if h1 == 12 || h2 == 12 {
                13
            } else {
                14
            }
        }
        1 => {
            let involves = h1 == h2 || board_counts(h1) >= 1 || board_counts(h2) >= 1;
            if involves {
                pair_kind(h1, h2, &branks, board)
            } else if h1 == 12 || h2 == 12 {
                13
            } else {
                14
            }
        }
        _ => {
            if h1 == 12 || h2 == 12 {
                13
            } else {
                14
            }
        }
    };

    let mut draws = Vec::new();
    if board.len() < 5 && class < 5 {
        let mut suits = [0u8; 4];
        let mut hole_suit = [false; 4];
        for &c in &all {
            suits[(c % 4) as usize] += 1;
        }
        hole_suit[(c1 % 4) as usize] = true;
        hole_suit[(c2 % 4) as usize] = true;
        let fd = (0..4).any(|s| suits[s] == 4 && hole_suit[s]);
        let rmask = |cs: &[Card]| cs.iter().fold(0u32, |m, &c| m | 1 << (c / 4));
        let outs_all = if class < 4 { straight_outs(rmask(&all)) } else { 0 };
        let outs_board = straight_outs(rmask(board));
        let sd = if outs_all > outs_board { outs_all } else { 0 };
        if fd {
            draws.push(0);
        }
        if sd >= 2 {
            draws.push(1);
        } else if sd == 1 {
            draws.push(2);
        }
        if fd && sd >= 1 {
            draws.push(3);
        }
        if board.len() == 3 && !fd {
            let bd = (0..4).any(|s| suits[s] == 3 && hole_suit[s]);
            if bd {
                draws.push(4);
            }
        }
        if class == 0 && h1 > top && h2 > top {
            draws.push(5);
        }
    }
    (made, draws)
}

fn pair_kind(h1: u32, h2: u32, branks: &[u32], board: &[Card]) -> usize {
    let top = branks[0];
    if h1 == h2 {
        let on_board = board.iter().any(|&c| (c / 4) as u32 == h1);
        if !on_board {
            return if h1 > top {
                8
            } else if branks.len() > 1 && h1 > branks[1] {
                10
            } else {
                12
            };
        }
    }
    let r = if board.iter().any(|&c| (c / 4) as u32 == h1) { h1 } else { h2 };
    if r == top {
        9
    } else if branks.len() > 1 && r == branks[1] {
        11
    } else {
        12
    }
}

// ---------------------------------------------------------------- équité

/// Équité de chaque combo de `hero` contre la range `vil` sur `board`, en tenant compte
/// du retrait de cartes. Énumération exacte des runouts si le board a au moins 3 cartes,
/// tirage déterministe de `samples` boards sinon (préflop).
pub fn equities(hero: &[(Card, Card, f32)], vil: &[(Card, Card, f32)], board: &[Card], samples: usize) -> Vec<f64> {
    let bm = mask(board);
    let deck: Vec<Card> = (0..52u8).filter(|c| bm & (1 << c) == 0).collect();
    let need = 5 - board.len();
    let runouts: Vec<Vec<Card>> = match need {
        0 => vec![vec![]],
        1 => deck.iter().map(|&a| vec![a]).collect(),
        2 => {
            let mut v = Vec::with_capacity(deck.len() * deck.len() / 2);
            for i in 0..deck.len() {
                for j in i + 1..deck.len() {
                    v.push(vec![deck[i], deck[j]]);
                }
            }
            v
        }
        _ => {
            let mut x = 0x9E37_79B9_7F4A_7C15u64;
            let mut next = move || {
                x ^= x >> 12;
                x ^= x << 25;
                x ^= x >> 27;
                x.wrapping_mul(0x2545F4914F6CDD1D)
            };
            (0..samples)
                .map(|_| {
                    let mut d = deck.clone();
                    for k in 0..need {
                        let r = k + (next() % (d.len() - k) as u64) as usize;
                        d.swap(k, r);
                    }
                    d[..need].to_vec()
                })
                .collect()
        }
    };
    let n = hero.len();
    // poids adverse du combo identique (compté deux fois dans l'exclusion par carte)
    let same_w: Vec<f64> = hero
        .iter()
        .map(|&(a, b, _)| vil.iter().find(|x| (x.0 == a && x.1 == b) || (x.0 == b && x.1 == a)).map(|x| x.2 as f64).unwrap_or(0.0))
        .collect();
    let (num, den) = runouts
        .par_iter()
        .fold(
            || (vec![0.0f64; n], vec![0.0f64; n]),
            |(mut num, mut den), extra| {
                let mut full = [0u8; 7];
                full[2..2 + board.len()].copy_from_slice(board);
                full[2 + board.len()..].copy_from_slice(extra);
                let em = mask(extra);
                let rank = |a: Card, b: Card, full: &mut [u8; 7]| {
                    full[0] = a;
                    full[1] = b;
                    eval(full)
                };
                let mut vr: Vec<(u32, Card, Card, f64)> = vil
                    .iter()
                    .filter(|(a, b, _)| em & (1 << a | 1 << b) == 0)
                    .map(|&(a, b, w)| (rank(a, b, &mut full), a, b, w as f64))
                    .collect();
                vr.sort_unstable_by_key(|x| x.0);
                let mut hr: Vec<(u32, usize)> = hero
                    .iter()
                    .enumerate()
                    .filter(|(_, (a, b, _))| em & (1 << a | 1 << b) == 0)
                    .map(|(i, &(a, b, _))| (rank(a, b, &mut full), i))
                    .collect();
                hr.sort_unstable_by_key(|x| x.0);
                let mut tot = 0.0;
                let mut tot_card = [0.0f64; 52];
                for &(_, a, b, w) in &vr {
                    tot += w;
                    tot_card[a as usize] += w;
                    tot_card[b as usize] += w;
                }
                // balayage : poids strictement inférieurs et égaux au rang courant
                let (mut less, mut less_card) = (0.0f64, [0.0f64; 52]);
                let mut vi = 0;
                let mut k = 0;
                while k < hr.len() {
                    let r = hr[k].0;
                    while vi < vr.len() && vr[vi].0 < r {
                        let (_, a, b, w) = vr[vi];
                        less += w;
                        less_card[a as usize] += w;
                        less_card[b as usize] += w;
                        vi += 1;
                    }
                    let (mut eq, mut eq_card) = (0.0f64, [0.0f64; 52]);
                    let mut vj = vi;
                    while vj < vr.len() && vr[vj].0 == r {
                        let (_, a, b, w) = vr[vj];
                        eq += w;
                        eq_card[a as usize] += w;
                        eq_card[b as usize] += w;
                        vj += 1;
                    }
                    while k < hr.len() && hr[k].0 == r {
                        let i = hr[k].1;
                        let (a, b, _) = hero[i];
                        let same = same_w[i];
                        let (a, b) = (a as usize, b as usize);
                        let win = less - less_card[a] - less_card[b];
                        let tie = eq - eq_card[a] - eq_card[b] + same;
                        let all = tot - tot_card[a] - tot_card[b] + same;
                        if all > 0.0 {
                            num[i] += win + tie * 0.5;
                            den[i] += all;
                        }
                        k += 1;
                    }
                }
                (num, den)
            },
        )
        .reduce(
            || (vec![0.0f64; n], vec![0.0f64; n]),
            |(mut a, mut b), (c, d)| {
                for i in 0..n {
                    a[i] += c[i];
                    b[i] += d[i];
                }
                (a, b)
            },
        );
    num.iter().zip(&den).map(|(a, b)| if *b > 0.0 { a / b } else { 0.0 }).collect()
}

#[derive(Serialize)]
pub struct CategoryRow {
    pub name: String,
    pub draw: bool,
    pub combos: f64,
    pub pct: f64,
    /// cases de la grille concernées (poids par case)
    pub cells: Vec<(usize, f64)>,
}

#[derive(Serialize)]
pub struct ComboRow {
    pub combo: String,
    pub cell: usize,
    pub weight: f64,
    pub equity: Option<f64>,
    pub made: usize,
    pub draws: Vec<usize>,
}

#[derive(Serialize)]
pub struct Analysis {
    pub board: Vec<String>,
    pub combos_total: f64,
    pub categories: Vec<CategoryRow>,
    pub combos: Vec<ComboRow>,
    /// poids par case 13×13 après retrait des cartes du board
    pub grid: Vec<f64>,
    /// équité moyenne de la case (si une range adverse est donnée)
    pub grid_equity: Vec<Option<f64>>,
    pub equity: Option<f64>,
    pub vs_equity: Option<f64>,
    /// courbe de distribution d'équité : 101 points (percentiles pondérés)
    pub distribution: Vec<f64>,
    pub vs_distribution: Vec<f64>,
    pub exact: bool,
}

fn distribution(eqs: &[f64], weights: &[f64]) -> Vec<f64> {
    let mut v: Vec<(f64, f64)> = eqs.iter().copied().zip(weights.iter().copied()).filter(|x| x.1 > 0.0).collect();
    if v.is_empty() {
        return vec![];
    }
    v.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    let tot: f64 = v.iter().map(|x| x.1).sum();
    let mut out = Vec::with_capacity(101);
    let (mut acc, mut k) = (0.0, 0);
    for p in 0..=100 {
        let target = tot * p as f64 / 100.0;
        while k < v.len() - 1 && acc + v[k].1 < target {
            acc += v[k].1;
            k += 1;
        }
        out.push(v[k].0);
    }
    out
}

/// Analyse complète : catégories sur le board, équité contre `vs` si fourni.
pub fn analyze(range: &str, board: &str, dead: &str, vs: &str) -> Result<Analysis, String> {
    let r = parse(range)?;
    let board = parse_cards(board)?;
    if board.len() == 1 || board.len() == 2 || board.len() > 5 {
        return Err("le board doit compter 0, 3, 4 ou 5 cartes".into());
    }
    let dead_c = parse_cards(dead)?;
    let dm = mask(&board) | mask(&dead_c);
    let hero = combos(&r, dm);
    let total: f64 = hero.iter().map(|x| x.2 as f64).sum();
    let vs_r = parse(vs)?;
    let vil = combos(&vs_r, dm);
    let eqs = if !vil.is_empty() && !hero.is_empty() { Some(equities(&hero, &vil, &board, 10_000)) } else { None };
    let vs_eqs = if eqs.is_some() { Some(equities(&vil, &hero, &board, 10_000)) } else { None };

    let mut grid = vec![0.0f64; 169];
    let mut geq = vec![(0.0f64, 0.0f64); 169];
    let mut made_acc: Vec<(f64, Vec<f64>)> = MADE.iter().map(|_| (0.0, vec![0.0; 169])).collect();
    let mut draw_acc: Vec<(f64, Vec<f64>)> = DRAWS.iter().map(|_| (0.0, vec![0.0; 169])).collect();
    let mut rows = Vec::with_capacity(hero.len());
    for (i, &(a, b, w)) in hero.iter().enumerate() {
        let cell = cell_of(a, b);
        let w = w as f64;
        grid[cell] += w;
        let (made, draws) = if board.len() >= 3 { classify(a, b, &board) } else { (usize::MAX, vec![]) };
        if made != usize::MAX {
            made_acc[made].0 += w;
            made_acc[made].1[cell] += w;
            for &d in &draws {
                draw_acc[d].0 += w;
                draw_acc[d].1[cell] += w;
            }
        }
        let eq = eqs.as_ref().map(|e| e[i]);
        if let Some(e) = eq {
            geq[cell].0 += e * w;
            geq[cell].1 += w;
        }
        rows.push(ComboRow { combo: combo_name(a, b), cell, weight: w, equity: eq, made, draws });
    }
    let mk = |names: &[&str], acc: Vec<(f64, Vec<f64>)>, draw: bool| -> Vec<CategoryRow> {
        names
            .iter()
            .zip(acc)
            .map(|(n, (c, cells))| CategoryRow {
                name: n.to_string(),
                draw,
                combos: c,
                pct: if total > 0.0 { c / total } else { 0.0 },
                cells: cells.into_iter().enumerate().filter(|x| x.1 > 0.0).collect(),
            })
            .collect()
    };
    let mut categories = if board.len() >= 3 { mk(MADE, made_acc, false) } else { vec![] };
    if board.len() >= 3 && board.len() < 5 {
        categories.extend(mk(DRAWS, draw_acc, true));
    }
    let weights: Vec<f64> = hero.iter().map(|x| x.2 as f64).collect();
    let vweights: Vec<f64> = vil.iter().map(|x| x.2 as f64).collect();
    let avg = |e: &Vec<f64>, w: &[f64]| {
        let t: f64 = w.iter().sum();
        if t > 0.0 {
            Some(e.iter().zip(w).map(|(a, b)| a * b).sum::<f64>() / t)
        } else {
            None
        }
    };
    Ok(Analysis {
        board: board.iter().map(|&c| card_str(c)).collect(),
        combos_total: total,
        categories,
        grid,
        grid_equity: geq.iter().map(|(s, w)| if *w > 0.0 { Some(s / w) } else { None }).collect(),
        equity: eqs.as_ref().and_then(|e| avg(e, &weights)),
        vs_equity: vs_eqs.as_ref().and_then(|e| avg(e, &vweights)),
        distribution: eqs.as_ref().map(|e| distribution(e, &weights)).unwrap_or_default(),
        vs_distribution: vs_eqs.as_ref().map(|e| distribution(e, &vweights)).unwrap_or_default(),
        combos: rows,
        exact: board.len() >= 3,
    })
}

/// Les 169 cases classées de la plus forte à la plus faible selon leur équité préflop contre
/// une main aléatoire (sert au curseur « top X % »). Calculé une fois par lancement.
pub fn preflop_order() -> &'static Vec<usize> {
    static ORDER: std::sync::OnceLock<Vec<usize>> = std::sync::OnceLock::new();
    ORDER.get_or_init(|| {
        let all = combos(&Range::ones(), 0);
        // 30 000 boards : en dessous, le tirage inverse des cases voisines (32o / 42o)
        let eq = equities(&all, &all, &[], 30_000);
        let mut cell = vec![(0.0f64, 0.0f64); 169];
        for (i, &(a, b, _)) in all.iter().enumerate() {
            let c = cell_of(a, b);
            cell[c].0 += eq[i];
            cell[c].1 += 1.0;
        }
        let mut order: Vec<usize> = (0..169).collect();
        order.sort_by(|&x, &y| (cell[y].0 / cell[y].1).partial_cmp(&(cell[x].0 / cell[x].1)).unwrap());
        order
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cells() {
        let c = |s: &str| parse_cards(s).unwrap();
        assert_eq!(cell_name(cell_of(c("As")[0], c("Ks")[0])), "AKs");
        assert_eq!(cell_name(cell_of(c("Kd")[0], c("As")[0])), "AKo");
        assert_eq!(cell_name(cell_of(c("7d")[0], c("7s")[0])), "77");
        assert_eq!(cell_name(0), "AA");
        assert_eq!(cell_name(168), "22");
    }

    #[test]
    fn equity_exact_matches_tracker() {
        // AA contre KK sur un flop neutre : comparaison avec l'énumération du tracker
        let board = parse_cards("2c7h9d").unwrap();
        let hero = vec![(parse_cards("As").unwrap()[0], parse_cards("Ad").unwrap()[0], 1.0)];
        let vil = vec![(parse_cards("Ks").unwrap()[0], parse_cards("Kd").unwrap()[0], 1.0)];
        let e = equities(&hero, &vil, &board, 0)[0];
        let r = crate::eval::equity(
            &[[hero[0].0, hero[0].1], [vil[0].0, vil[0].1]],
            &board,
            &[crate::eval::Pot { amount: 1.0, eligible: vec![0, 1] }],
            1,
            0,
        );
        assert!((e - r.equity[0]).abs() < 1e-9, "{e} vs {}", r.equity[0]);
    }

    #[test]
    fn equity_range_is_symmetric() {
        let board = parse_cards("Ts9s4d").unwrap();
        let bm = mask(&board);
        let h = combos(&parse("QQ+,AK,T9s,87s").unwrap(), bm);
        let v = combos(&parse("22+,A2s+,KTo+").unwrap(), bm);
        let eh = equities(&h, &v, &board, 0);
        let ev = equities(&v, &h, &board, 0);
        let wavg = |e: &[f64], c: &[(Card, Card, f32)], other: &[(Card, Card, f32)]| {
            // pondération par le nombre de combos adverses compatibles
            let mut s = 0.0;
            let mut t = 0.0;
            for (i, x) in c.iter().enumerate() {
                let n: f64 = other.iter().filter(|y| y.0 != x.0 && y.0 != x.1 && y.1 != x.0 && y.1 != x.1).map(|y| y.2 as f64).sum();
                s += e[i] * x.2 as f64 * n;
                t += x.2 as f64 * n;
            }
            s / t
        };
        let a = wavg(&eh, &h, &v);
        let b = wavg(&ev, &v, &h);
        assert!((a + b - 1.0).abs() < 1e-9, "{a} + {b}");
    }

    #[test]
    fn preflop_order_is_sane() {
        let o = preflop_order();
        assert_eq!(cell_name(o[0]), "AA");
        assert_eq!(cell_name(o[168]), "32o");
    }

    #[test]
    fn categories() {
        let b = parse_cards("Kh7d2c").unwrap();
        let c = |s: &str| parse_cards(s).unwrap();
        let k = |s: &str| classify(c(s)[0], c(s)[1], &b);
        assert_eq!(MADE[k("AsAd").0], "Overpair");
        assert_eq!(MADE[k("KsQd").0], "Top paire");
        assert_eq!(MADE[k("7s7c").0], "Brelan (set)");
        assert_eq!(MADE[k("9s9c").0], "Paire sous la top");
        assert_eq!(MADE[k("7s6s").0], "Paire moyenne");
        assert_eq!(MADE[k("AsQd").0], "Hauteur as");
        let b2 = parse_cards("9h8h2c").unwrap();
        let (_, d) = classify(c("Th")[0], c("Jh")[0], &b2);
        assert!(d.contains(&0) && d.contains(&1) && d.contains(&3), "{d:?}");
        let (_, d) = classify(c("Tc")[0], c("6d")[0], &b2);
        assert!(d.contains(&2) && !d.contains(&1), "{d:?}");
    }
}
