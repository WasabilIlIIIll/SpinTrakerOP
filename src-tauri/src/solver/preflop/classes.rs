//! Les 169 classes de mains préflop (index = case de la grille 13×13) et les tables d'équité
//! tête-à-tête entre classes, exactes (énumération de tous les boards).
//!
//! `eq[h][v]` : équité moyenne d'un combo de `h` contre un combo de `v`, sur toutes les paires
//! de combos compatibles. `cnt[h][v]` : nombre moyen de combos de `v` compatibles avec un combo
//! de `h` (retrait de cartes). Symétries de couleur exploitées : chaque configuration n'est
//! énumérée qu'une fois.

use crate::eval::eval;
use crate::model::Card;
use crate::solver::ranges::cell_of;
use rayon::prelude::*;
use std::collections::HashMap;
use std::sync::OnceLock;

pub const N: usize = 169;

/// Combos de chaque classe.
pub fn combos() -> &'static Vec<Vec<(Card, Card)>> {
    static C: OnceLock<Vec<Vec<(Card, Card)>>> = OnceLock::new();
    C.get_or_init(|| {
        let mut v = vec![Vec::new(); N];
        for a in 0..52u8 {
            for b in 0..a {
                v[cell_of(a, b)].push((a, b));
            }
        }
        v
    })
}

pub fn ncombos(h: usize) -> f64 {
    combos()[h].len() as f64
}

/// Forme canonique d'une paire de mains sous permutation des couleurs.
fn canon(x: (Card, Card), y: (Card, Card)) -> [u8; 4] {
    const PERMS: [[u8; 4]; 24] = [
        [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 2, 3, 1], [0, 3, 1, 2], [0, 3, 2, 1],
        [1, 0, 2, 3], [1, 0, 3, 2], [1, 2, 0, 3], [1, 2, 3, 0], [1, 3, 0, 2], [1, 3, 2, 0],
        [2, 0, 1, 3], [2, 0, 3, 1], [2, 1, 0, 3], [2, 1, 3, 0], [2, 3, 0, 1], [2, 3, 1, 0],
        [3, 0, 1, 2], [3, 0, 2, 1], [3, 1, 0, 2], [3, 1, 2, 0], [3, 2, 0, 1], [3, 2, 1, 0],
    ];
    let mut best = [255u8; 4];
    for p in PERMS {
        let m = |c: Card| (c & !3) | p[(c & 3) as usize];
        let (a, b) = (m(x.0), m(x.1));
        let (c, d) = (m(y.0), m(y.1));
        let k = [a.max(b), a.min(b), c.max(d), c.min(d)];
        if k < best {
            best = k;
        }
    }
    best
}

/// Équité exacte (victoire + moitié des égalités) de `x` contre `y` sur les 1 712 304 boards.
fn exact(x: (Card, Card), y: (Card, Card)) -> f64 {
    let used = 1u64 << x.0 | 1u64 << x.1 | 1u64 << y.0 | 1u64 << y.1;
    let deck: Vec<Card> = (0..52u8).filter(|c| used & (1u64 << c) == 0).collect();
    let n = deck.len();
    let (mut win, mut tie, mut tot) = (0u64, 0u64, 0u64);
    let mut hx = [0u8; 7];
    let mut hy = [0u8; 7];
    hx[0] = x.0;
    hx[1] = x.1;
    hy[0] = y.0;
    hy[1] = y.1;
    for a in 0..n {
        for b in a + 1..n {
            for c in b + 1..n {
                for d in c + 1..n {
                    for e in d + 1..n {
                        let bd = [deck[a], deck[b], deck[c], deck[d], deck[e]];
                        hx[2..].copy_from_slice(&bd);
                        hy[2..].copy_from_slice(&bd);
                        let (rx, ry) = (eval(&hx), eval(&hy));
                        if rx > ry {
                            win += 1;
                        } else if rx == ry {
                            tie += 1;
                        }
                        tot += 1;
                    }
                }
            }
        }
    }
    (win as f64 + tie as f64 * 0.5) / tot as f64
}

pub struct HuTables {
    pub eq: Vec<[f32; N]>,
    pub cnt: Vec<[f32; N]>,
}

/// Calcule les tables tête-à-tête (plusieurs minutes : à faire une fois, voir `save`).
pub fn compute_hu(progress: &(dyn Fn(usize, usize) + Sync)) -> HuTables {
    let cs = combos();
    // configurations canoniques à énumérer
    let mut pats: HashMap<[u8; 4], ((Card, Card), (Card, Card))> = HashMap::new();
    for h in 0..N {
        for v in 0..N {
            for &x in &cs[h] {
                for &y in &cs[v] {
                    if x.0 == y.0 || x.0 == y.1 || x.1 == y.0 || x.1 == y.1 {
                        continue;
                    }
                    pats.entry(canon(x, y)).or_insert((x, y));
                }
            }
        }
    }
    let list: Vec<([u8; 4], ((Card, Card), (Card, Card)))> = pats.into_iter().collect();
    let total = list.len();
    let done = std::sync::atomic::AtomicUsize::new(0);
    let values: HashMap<[u8; 4], f64> = list
        .par_iter()
        .map(|(k, (x, y))| {
            let e = exact(*x, *y);
            let d = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            if d % 500 == 0 {
                progress(d, total);
            }
            (*k, e)
        })
        .collect();
    let mut eq = vec![[0f32; N]; N];
    let mut cnt = vec![[0f32; N]; N];
    for h in 0..N {
        for v in 0..N {
            let (mut s, mut n) = (0.0f64, 0usize);
            for &x in &cs[h] {
                for &y in &cs[v] {
                    if x.0 == y.0 || x.0 == y.1 || x.1 == y.0 || x.1 == y.1 {
                        continue;
                    }
                    s += values[&canon(x, y)];
                    n += 1;
                }
            }
            eq[h][v] = if n > 0 { (s / n as f64) as f32 } else { 0.5 };
            cnt[h][v] = (n as f64 / cs[h].len() as f64) as f32;
        }
    }
    HuTables { eq, cnt }
}

impl HuTables {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(N * N * 4);
        for row in &self.eq {
            for x in row {
                out.extend_from_slice(&x.to_le_bytes());
            }
        }
        out
    }

    /// Relit l'équité ; les comptes de compatibilité se recalculent instantanément.
    pub fn from_bytes(b: &[u8]) -> Option<HuTables> {
        if b.len() != N * N * 4 {
            return None;
        }
        let cs = combos();
        let mut eq = vec![[0f32; N]; N];
        let mut cnt = vec![[0f32; N]; N];
        for h in 0..N {
            for v in 0..N {
                let k = (h * N + v) * 4;
                eq[h][v] = f32::from_le_bytes([b[k], b[k + 1], b[k + 2], b[k + 3]]);
                let n = cs[h]
                    .iter()
                    .map(|&x| cs[v].iter().filter(|&&y| !(x.0 == y.0 || x.0 == y.1 || x.1 == y.0 || x.1 == y.1)).count())
                    .sum::<usize>();
                cnt[h][v] = (n as f64 / cs[h].len() as f64) as f32;
            }
        }
        Some(HuTables { eq, cnt })
    }
}

/// Tables livrées avec l'application (générées par `spinop-cli gen-tables`).
pub fn hu() -> &'static HuTables {
    static T: OnceLock<HuTables> = OnceLock::new();
    T.get_or_init(|| HuTables::from_bytes(include_bytes!("../../../assets/hu_equity.bin")).expect("table d'équité HU invalide"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solver::ranges::cell_name;

    fn idx(name: &str) -> usize {
        (0..N).find(|&c| cell_name(c) == name).unwrap()
    }

    #[test]
    fn classes_and_counts() {
        let cs = combos();
        assert_eq!(cs.iter().map(|c| c.len()).sum::<usize>(), 1326);
        assert_eq!(cs[idx("AA")].len(), 6);
        assert_eq!(cs[idx("AKs")].len(), 4);
        assert_eq!(cs[idx("AKo")].len(), 12);
        let t = hu();
        // AA contre AA : un seul combo compatible par combo ; AA contre KK : 6
        assert!((t.cnt[idx("AA")][idx("AA")] - 1.0).abs() < 1e-6);
        assert!((t.cnt[idx("AA")][idx("KK")] - 6.0).abs() < 1e-6);
    }

    #[test]
    fn known_equities() {
        // valeurs de référence connues (énumération complète)
        let t = hu();
        let e = |a: &str, b: &str| t.eq[idx(a)][idx(b)] as f64;
        assert!((e("AA", "KK") - 0.8195).abs() < 0.001, "{}", e("AA", "KK"));
        assert!((e("AKo", "22") - 0.4734).abs() < 0.002, "{}", e("AKo", "22"));
        assert!((e("AA", "AA") - 0.5).abs() < 1e-6);
        for h in 0..N {
            for v in 0..N {
                assert!((t.eq[h][v] + t.eq[v][h] - 1.0).abs() < 1e-5);
            }
        }
    }
}
