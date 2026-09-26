//! Tables à 3 joueurs pour les tapis à 3 (side pots) et le retrait de cartes à 3.
//!
//! Pour chaque triplet de classes (h, v, w) :
//! - `c3` : nombre moyen de paires de combos (v, w) compatibles avec un combo de h, exact ;
//! - la probabilité de chacun des 13 classements finaux possibles (égalités comprises), estimée
//!   par tirage uniforme parmi les triplets de combos compatibles et les boards (graine fixe).
//!
//! Stockage : triplets non ordonnés (a ≤ b ≤ c), environ 818 000 ; fichier mis en cache dans le
//! dossier de données (une seule génération, quelques minutes).

use super::classes::{combos, N};
use crate::eval::eval;
use crate::model::Card;
use rayon::prelude::*;
use std::path::Path;

/// Les 13 classements possibles de 3 joueurs : rang de chacun (0 = meilleur), égalités partagées.
pub const RANKS: [[u8; 3]; 13] = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [2, 0, 1], [1, 2, 0], [2, 1, 0],
    [0, 0, 1], [0, 1, 0], [1, 0, 0],
    [0, 1, 1], [1, 0, 1], [1, 1, 0],
    [0, 0, 0],
];

fn rank_index(r: [u8; 3]) -> usize {
    RANKS.iter().position(|x| *x == r).expect("classement")
}

/// Rangs denses à partir des forces de main (plus grand = meilleur).
pub fn ranks_of(s: [u32; 3]) -> [u8; 3] {
    let mut r = [0u8; 3];
    for i in 0..3 {
        let mut distinct_better: Vec<u32> = (0..3).filter(|&j| s[j] > s[i]).map(|j| s[j]).collect();
        distinct_better.sort_unstable();
        distinct_better.dedup();
        r[i] = distinct_better.len() as u8;
    }
    r
}

/// Index d'un triplet non ordonné a ≤ b ≤ c.
fn tri_index(a: usize, b: usize, c: usize) -> usize {
    // nombre de triplets (x ≤ y ≤ z) avec x < a, puis y < b, puis z < c
    let n = N;
    let before_a: usize = (0..a).map(|x| (n - x) * (n - x + 1) / 2).sum();
    let before_b: usize = (a..b).map(|y| n - y).sum();
    before_a + before_b + (c - b)
}

pub fn n_triples() -> usize {
    N * (N + 1) * (N + 2) / 6
}

pub struct TriTables {
    /// probabilités (×65535) des 13 classements, dans l'ordre trié (a, b, c)
    probs: Vec<[u16; 13]>,
    /// c3 par triplet ordonné compressé : c3[h][v][w] en f32 (calcul exact, rapide)
    c3: Vec<f32>,
}

fn compatible(x: (Card, Card), y: (Card, Card)) -> bool {
    x.0 != y.0 && x.0 != y.1 && x.1 != y.0 && x.1 != y.1
}

/// c3 exact pour tous les triplets ordonnés.
fn compute_c3() -> Vec<f32> {
    let cs = combos();
    let mut out = vec![0f32; N * N * N];
    out.par_chunks_mut(N * N).enumerate().for_each(|(h, slab)| {
        for v in 0..N {
            for w in 0..N {
                let mut n = 0usize;
                for &x in &cs[h] {
                    for &y in &cs[v] {
                        if !compatible(x, y) {
                            continue;
                        }
                        for &z in &cs[w] {
                            if compatible(x, z) && compatible(y, z) {
                                n += 1;
                            }
                        }
                    }
                }
                slab[v * N + w] = (n as f64 / cs[h].len() as f64) as f32;
            }
        }
    });
    out
}

fn sample_probs(a: usize, b: usize, c: usize, samples: usize) -> [u16; 13] {
    let cs = combos();
    let mut x = 0x9E37_79B9_7F4A_7C15u64 ^ ((a * N * N + b * N + c) as u64).wrapping_mul(0xD1B5_4A32_D192_ED03);
    let mut rnd = move || {
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    };
    let mut counts = [0u32; 13];
    let mut done = 0;
    let mut tries = 0;
    let mut hand = [[0u8; 7]; 3];
    while done < samples && tries < samples * 50 {
        tries += 1;
        let p = [cs[a][(rnd() % cs[a].len() as u64) as usize], cs[b][(rnd() % cs[b].len() as u64) as usize], cs[c][(rnd() % cs[c].len() as u64) as usize]];
        if !compatible(p[0], p[1]) || !compatible(p[0], p[2]) || !compatible(p[1], p[2]) {
            continue;
        }
        let mut used = 0u64;
        for q in &p {
            used |= 1u64 << q.0 | 1u64 << q.1;
        }
        let mut board = [0u8; 5];
        let mut k = 0;
        while k < 5 {
            let card = (rnd() % 52) as u8;
            if used & (1u64 << card) != 0 {
                continue;
            }
            used |= 1u64 << card;
            board[k] = card;
            k += 1;
        }
        let mut s = [0u32; 3];
        for i in 0..3 {
            hand[i][0] = p[i].0;
            hand[i][1] = p[i].1;
            hand[i][2..].copy_from_slice(&board);
            s[i] = eval(&hand[i]);
        }
        counts[rank_index(ranks_of(s))] += 1;
        done += 1;
    }
    let mut out = [0u16; 13];
    if done > 0 {
        for i in 0..13 {
            out[i] = ((counts[i] as f64 / done as f64) * 65535.0).round() as u16;
        }
    }
    out
}

impl TriTables {
    pub fn build(samples: usize, cancel: &std::sync::atomic::AtomicBool, progress: &(dyn Fn(usize, usize) + Sync)) -> Result<TriTables, String> {
        let mut list = Vec::with_capacity(n_triples());
        for a in 0..N {
            for b in a..N {
                for c in b..N {
                    list.push((a, b, c));
                }
            }
        }
        let total = list.len();
        let done = std::sync::atomic::AtomicUsize::new(0);
        let probs: Vec<[u16; 13]> = list
            .par_iter()
            .map(|&(a, b, c)| {
                if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                    return [0u16; 13];
                }
                let r = sample_probs(a, b, c, samples);
                let d = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                if d % 20_000 == 0 {
                    progress(d, total);
                }
                r
            })
            .collect();
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("arrêté".into());
        }
        Ok(TriTables { probs, c3: compute_c3() })
    }

    pub fn exists(dir: &Path) -> bool {
        std::fs::metadata(dir.join("tables").join("tri_v1.bin")).map(|m| m.len() as usize == n_triples() * 26).unwrap_or(false)
    }

    pub fn load_or_build(dir: &Path, cancel: &std::sync::atomic::AtomicBool, progress: &(dyn Fn(usize, usize) + Sync)) -> Result<TriTables, String> {
        let path = dir.join("tables").join("tri_v1.bin");
        if let Ok(b) = std::fs::read(&path) {
            if b.len() == n_triples() * 26 {
                let probs = b
                    .chunks_exact(26)
                    .map(|ch| {
                        let mut a = [0u16; 13];
                        for i in 0..13 {
                            a[i] = u16::from_le_bytes([ch[2 * i], ch[2 * i + 1]]);
                        }
                        a
                    })
                    .collect();
                return Ok(TriTables { probs, c3: compute_c3() });
            }
        }
        let t = TriTables::build(8000, cancel, progress)?;
        let _ = std::fs::create_dir_all(path.parent().unwrap());
        let mut out = Vec::with_capacity(n_triples() * 26);
        for p in &t.probs {
            for x in p {
                out.extend_from_slice(&x.to_le_bytes());
            }
        }
        std::fs::write(&path, out).map_err(|e| e.to_string())?;
        Ok(t)
    }

    #[inline]
    pub fn c3(&self, h: usize, v: usize, w: usize) -> f32 {
        self.c3[(h * N + v) * N + w]
    }

    /// Probabilités des 13 classements pour les joueurs dans l'ordre (h, v, w).
    pub fn probs(&self, h: usize, v: usize, w: usize) -> [f32; 13] {
        // tri avec la permutation : pos[k] = joueur d'origine à la k-ième place triée
        let mut idx = [(h, 0usize), (v, 1), (w, 2)];
        idx.sort_by_key(|x| x.0);
        let p = &self.probs[tri_index(idx[0].0, idx[1].0, idx[2].0)];
        let mut out = [0f32; 13];
        for (k, r) in RANKS.iter().enumerate() {
            let q = p[k];
            if q == 0 {
                continue;
            }
            // rangs dans l'ordre d'origine
            let mut orig = [0u8; 3];
            for s in 0..3 {
                orig[idx[s].1] = r[s];
            }
            out[rank_index(orig)] += q as f32 / 65535.0;
        }
        out
    }
}

/// Gains nets de chaque joueur pour un classement donné, avec side pots.
/// `alive[i]` faux = joueur couché (ne peut rien gagner) ; `dead` = argent mort (antes).
pub fn payoff(ranks: [u8; 3], contrib: &[f64], alive: &[bool], dead: f64) -> [f64; 3] {
    let mut won = [0f64; 3];
    let mut levels: Vec<f64> = (0..3).filter(|&i| alive[i]).map(|i| contrib[i]).collect();
    levels.sort_by(|a, b| a.partial_cmp(b).unwrap());
    levels.dedup_by(|a, b| (*a - *b).abs() < 1e-12);
    let mut prev = 0.0;
    let mut first = true;
    for &lv in &levels {
        // chaque couche : ce que chaque joueur a mis entre prev et lv
        let mut layer: f64 = (0..3).map(|i| (contrib[i].min(lv) - prev).max(0.0)).sum();
        if first {
            layer += dead;
            first = false;
        }
        let elig: Vec<usize> = (0..3).filter(|&i| alive[i] && contrib[i] >= lv - 1e-12).collect();
        let best = elig.iter().map(|&i| ranks[i]).min().unwrap();
        let winners: Vec<usize> = elig.into_iter().filter(|&i| ranks[i] == best).collect();
        for &w in &winners {
            won[w] += layer / winners.len() as f64;
        }
        prev = lv;
    }
    // mises des couchés au-dessus du plus haut niveau vivant : au meilleur vivant
    let top: f64 = (0..3).map(|i| (contrib[i] - prev).max(0.0)).sum();
    if top > 0.0 {
        let best = (0..3).filter(|&i| alive[i]).map(|i| ranks[i]).min().unwrap();
        let winners: Vec<usize> = (0..3).filter(|&i| alive[i] && ranks[i] == best).collect();
        for &w in &winners {
            won[w] += top / winners.len() as f64;
        }
    }
    [won[0] - contrib[0], won[1] - contrib[1], won[2] - contrib[2]]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_is_dense() {
        let mut k = 0;
        for a in 0..N {
            for b in a..N {
                for c in b..N {
                    assert_eq!(tri_index(a, b, c), k);
                    k += 1;
                }
            }
        }
        assert_eq!(k, n_triples());
    }

    #[test]
    fn ranks_and_payoffs() {
        assert_eq!(ranks_of([5, 9, 5]), [1, 0, 1]);
        assert_eq!(ranks_of([7, 7, 7]), [0, 0, 0]);
        // side pot : joueur 0 à tapis pour 5, les deux autres 10 ; 0 gagne, 1 bat 2
        let p = payoff([0, 1, 2], &[5.0, 10.0, 10.0], &[true; 3], 0.0);
        assert_eq!(p, [10.0, 0.0, -10.0]);
        // égalité à trois : chacun récupère sa mise
        let p = payoff([0, 0, 0], &[4.0, 4.0, 4.0], &[true; 3], 0.3);
        assert!((p[0] - 0.1).abs() < 1e-9 && (p.iter().sum::<f64>() - 0.3).abs() < 1e-9);
        // somme nulle hors argent mort
        let p = payoff([1, 0, 2], &[12.0, 3.0, 12.0], &[true; 3], 0.0);
        assert!(p.iter().sum::<f64>().abs() < 1e-9, "{p:?}");
    }
}
