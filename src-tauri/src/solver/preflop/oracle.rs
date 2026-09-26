//! Valeur postflop des lignes préflop qui voient le flop à deux : vrais solves postflop
//! (moteur postflop-solver) sur un échantillon de flops représentatif.
//!
//! Échantillon : les 1 755 flops stratégiquement différents (symétries de couleur), triés par
//! texture (monocolore / deux couleurs / arc-en-ciel, puis rangs), et tirés systématiquement à
//! intervalles de fréquence égaux : chaque flop retenu représente la même part des 22 100 flops.

use super::classes::{combos, N};
use crate::model::Card;
use crate::solver::postflop::{build_with_ranges, PostflopConfig, UNIT};
use crate::solver::ranges::cell_of;
use postflop_solver::{compute_exploitability, finalize, solve_step, Range};
use std::sync::atomic::{AtomicBool, Ordering};

/// Flops canoniques (plus petit représentant sous permutation des couleurs) et leur fréquence.
pub fn canonical_flops() -> Vec<([Card; 3], u32)> {
    let mut map: std::collections::BTreeMap<[Card; 3], u32> = Default::default();
    const PERMS: [[u8; 4]; 24] = [
        [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 2, 3, 1], [0, 3, 1, 2], [0, 3, 2, 1],
        [1, 0, 2, 3], [1, 0, 3, 2], [1, 2, 0, 3], [1, 2, 3, 0], [1, 3, 0, 2], [1, 3, 2, 0],
        [2, 0, 1, 3], [2, 0, 3, 1], [2, 1, 0, 3], [2, 1, 3, 0], [2, 3, 0, 1], [2, 3, 1, 0],
        [3, 0, 1, 2], [3, 0, 2, 1], [3, 1, 0, 2], [3, 1, 2, 0], [3, 2, 0, 1], [3, 2, 1, 0],
    ];
    for a in 0..52u8 {
        for b in a + 1..52 {
            for c in b + 1..52 {
                let mut best = [255u8; 3];
                for p in PERMS {
                    let m = |x: Card| (x & !3) | p[(x & 3) as usize];
                    let mut f = [m(a), m(b), m(c)];
                    f.sort_unstable_by(|x, y| y.cmp(x));
                    if f < best {
                        best = f;
                    }
                }
                *map.entry(best).or_default() += 1;
            }
        }
    }
    map.into_iter().collect()
}

/// `k` flops représentatifs, poids égaux.
pub fn flop_subset(k: usize) -> Vec<[Card; 3]> {
    let mut all = canonical_flops();
    let suits = |f: &[Card; 3]| {
        let mut s: Vec<u8> = f.iter().map(|c| c & 3).collect();
        s.sort_unstable();
        s.dedup();
        s.len()
    };
    // texture puis rangs décroissants
    all.sort_by_key(|(f, _)| (suits(f), std::cmp::Reverse(f[0] >> 2), std::cmp::Reverse(f[1] >> 2), std::cmp::Reverse(f[2] >> 2)));
    let total: u32 = all.iter().map(|x| x.1).sum();
    let mut out = Vec::with_capacity(k);
    let mut acc = 0u32;
    let mut next = 0usize;
    for (f, w) in &all {
        acc += w;
        while next < k && (next as f64 + 0.5) * total as f64 / k as f64 <= acc as f64 {
            if out.last() != Some(f) {
                out.push(*f);
            }
            next += 1;
        }
    }
    out
}

/// Range du moteur postflop à partir de poids par classe (plancher pour que chaque main ait une
/// valeur, même si elle n'arrive presque jamais ici).
pub fn range_from_classes(w: &[f32], floor: f32) -> Range {
    let mut r = Range::new();
    for (h, cs) in combos().iter().enumerate() {
        let x = w[h].max(floor).min(1.0);
        for &(a, b) in cs {
            r.set_weight_by_cards(a, b, x);
        }
    }
    r
}

pub struct FlopLine {
    /// pot au flop (bb) et tapis effectif restant (bb)
    pub pot: f64,
    pub stack: f64,
    /// atteintes par classe [OOP, IP]
    pub reach: [Vec<f32>; 2],
    pub labels: [String; 2],
}

/// Tailles de l'arbre de valorisation : une taille + all-in, relance all-in (voir le cahier
/// des charges : c'est ce qui rend le calcul faisable, 33 s par flop mesurées à 12 bb).
pub fn valuation_config(line: &FlopLine, board: &[Card; 3], precision: f64) -> PostflopConfig {
    PostflopConfig {
        board: board.iter().map(|&c| crate::model::card_str(c)).collect(),
        pot: line.pot,
        stack: line.stack,
        oop_label: line.labels[0].clone(),
        ip_label: line.labels[1].clone(),
        bet_sizes: [vec![50.0], vec![50.0], vec![50.0]],
        raise_sizes: vec![],
        donk: false,
        precision,
        max_iters: 400,
        ..Default::default()
    }
}

/// Valeur de chaque classe (part finale du pot, bb) pour OOP et IP, moyenne sur les flops.
pub fn value_line(line: &FlopLine, flops: &[[Card; 3]], precision: f64, cancel: &AtomicBool, progress: &dyn Fn(usize)) -> Result<[Vec<f32>; 2], String> {
    let mut sum = [vec![0f64; N], vec![0f64; N]];
    let mut cnt = [vec![0f64; N], vec![0f64; N]];
    for (k, f) in flops.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Err("arrêté".into());
        }
        let cfg = valuation_config(line, f, precision);
        let ranges = [range_from_classes(&line.reach[0], 1e-3), range_from_classes(&line.reach[1], 1e-3)];
        let mut g = build_with_ranges(&cfg, ranges)?;
        g.allocate_memory(false);
        let target = g.tree_config().starting_pot as f32 * precision as f32 / 100.0;
        for i in 0..cfg.max_iters {
            if cancel.load(Ordering::SeqCst) {
                return Err("arrêté".into());
            }
            solve_step(&g, i);
            if i % 10 == 9 && compute_exploitability(&g) <= target {
                break;
            }
        }
        finalize(&mut g);
        g.cache_normalized_weights();
        for p in 0..2 {
            let ev = g.expected_values(p);
            // pondération par les poids normalisés (retrait de cartes face à la range adverse) :
            // c'est ce qui conserve le pot entre les deux joueurs
            let nw = g.normalized_weights(p).to_vec();
            let w0 = g.weights(p).to_vec();
            for (x, &(a, b)) in g.private_cards(p).iter().enumerate() {
                let h = cell_of(a, b);
                let w = if w0[x] > 0.0 { nw[x] as f64 / w0[x] as f64 } else { 0.0 };
                sum[p][h] += w * ev[x] as f64 / UNIT;
                cnt[p][h] += w;
            }
        }
        progress(k + 1);
    }
    let out = |p: usize| -> Vec<f64> { (0..N).map(|h| if cnt[p][h] > 0.0 { sum[p][h] / cnt[p][h] } else { 0.0 }).collect() };
    let (mut vo, mut vi) = (out(0), out(1));
    // Conservation du pot. Sur un échantillon de flops, les classes bloquées par le board (KK sur
    // un flop à roi n'a plus que 3 combos) sont sur-représentées par la pondération préflop : la
    // somme des valeurs dépasse le pot (+10 % mesuré sur un seul flop). On recale chaque joueur
    // pour que la valeur totale, pondérée par la distribution jointe des mains, égale le pot ;
    // les écarts entre mains d'un même joueur (ce qui décide la stratégie) sont conservés.
    let t = super::classes::hu();
    let joint = |p: usize, v: &[f64]| {
        let (me, op) = (&line.reach[p], &line.reach[1 - p]);
        let (mut num, mut den) = (0.0f64, 0.0f64);
        for h in 0..N {
            let m: f64 = super::classes::ncombos(h) * me[h] as f64 * (0..N).map(|x| op[x] as f64 * t.cnt[h][x] as f64).sum::<f64>();
            num += m * v[h];
            den += m;
        }
        if den > 0.0 { num / den } else { 0.0 }
    };
    let (zo, zi) = (joint(0, &vo), joint(1, &vi));
    let z = zo + zi;
    if z > 0.0 {
        let gap = line.pot - z;
        for x in vo.iter_mut() {
            *x += gap * zo / z;
        }
        for x in vi.iter_mut() {
            *x += gap * zi / z;
        }
    }
    Ok([vo.into_iter().map(|x| x as f32).collect(), vi.into_iter().map(|x| x as f32).collect()])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flops_are_canonical_and_weighted() {
        let all = canonical_flops();
        assert_eq!(all.len(), 1755);
        assert_eq!(all.iter().map(|x| x.1).sum::<u32>(), 22100);
        let sub = flop_subset(20);
        assert_eq!(sub.len(), 20);
        // les trois textures sont représentées à peu près selon leur fréquence (rainbow ~40 %)
        let rainbow = sub.iter().filter(|f| {
            let mut s: Vec<u8> = f.iter().map(|c| c & 3).collect();
            s.dedup();
            s.len() == 3 && f[0] & 3 != f[2] & 3
        }).count();
        assert!((6..=10).contains(&rainbow), "{rainbow}");
    }
}

#[cfg(test)]
mod conservation {
    use super::*;
    use crate::solver::preflop::classes::{hu, ncombos};

    /// Les valeurs par classe renvoyées doivent redonner le pot quand on les pondère par la
    /// distribution jointe des mains (retrait de cartes compris).
    #[test]
    fn values_conserve_pot() {
        let w = |r: &str| {
            let g = crate::solver::ranges::parse(r).unwrap();
            let mut out = vec![0f32; N];
            for (h, cs) in combos().iter().enumerate() {
                out[h] = g.get_weight_by_cards(cs[0].0, cs[0].1);
            }
            out
        };
        let line = FlopLine { pot: 2.0, stack: 9.0, reach: [w("22+,A2+,K2+,Q5+,J7+,T7+,97+,86+,75+,65,54"), w("22+,A2+,K2+,Q2+,J2+,T2+,92+,82+,72+,62+,52+,42+,32")], labels: ["BB".into(), "SB".into()] };
        let cancel = AtomicBool::new(false);
        let flops = flop_subset(1);
        let [vo, vi] = value_line(&line, &flops, 0.5, &cancel, &|_| {}).unwrap();
        let t = hu();
        let (mut num, mut den) = (0.0f64, 0.0f64);
        for h in 0..N {
            for v in 0..N {
                let m = ncombos(h) * line.reach[0][h] as f64 * line.reach[1][v] as f64 * t.cnt[h][v] as f64;
                num += m * (vo[h] as f64 + vi[v] as f64);
                den += m;
            }
        }
        let s = num / den;
        println!("somme des valeurs {s:.4} pour un pot de {}", line.pot);
        assert!((s - line.pot).abs() < 0.05, "{s}");
    }
}
