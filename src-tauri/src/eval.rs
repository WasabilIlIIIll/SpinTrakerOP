//! Évaluateur 7 cartes par masques de bits + calcul d'équité (énumération exacte
//! postflop, Monte-Carlo déterministe préflop) avec gestion des side pots.

use crate::model::Card;

#[inline]
fn top_bits(mut m: u32, n: u32) -> u32 {
    // conserve les n bits de poids fort
    let mut out = 0;
    for _ in 0..n {
        if m == 0 {
            break;
        }
        let b = 31 - m.leading_zeros();
        out |= 1 << b;
        m &= !(1 << b);
    }
    out
}

#[inline]
fn straight_top(m: u32) -> Option<u32> {
    let x = m & (m << 1) & (m << 2) & (m << 3) & (m << 4);
    if x != 0 {
        return Some(31 - x.leading_zeros());
    }
    // roue A-2-3-4-5
    if m & 0b1_0000_0000_1111 == 0b1_0000_0000_1111 {
        return Some(3);
    }
    None
}

#[inline]
fn hi(m: u32) -> u32 {
    31 - m.leading_zeros()
}

/// Rang d'une main de 5 à 7 cartes (plus grand = meilleur).
pub fn eval(cards: &[Card]) -> u32 {
    let mut suits = [0u32; 4];
    for &c in cards {
        suits[(c & 3) as usize] |= 1 << (c >> 2);
    }
    for s in suits {
        if s.count_ones() >= 5 {
            if let Some(t) = straight_top(s) {
                return (8 << 26) | t;
            }
            return (5 << 26) | top_bits(s, 5);
        }
    }
    let [a, b, c, d] = suits;
    let all = a | b | c | d;
    let quads = a & b & c & d;
    let trips = ((a & b) & (c | d)) | ((c & d) & (a | b));
    let pairs = (a & b) | (a & c) | (a & d) | (b & c) | (b & d) | (c & d);
    if quads != 0 {
        let q = hi(quads);
        let k = top_bits(all & !(1 << q), 1);
        return (7 << 26) | (q << 16) | k;
    }
    if trips != 0 {
        let t = hi(trips);
        let rest_pairs = pairs & !(1 << t);
        if rest_pairs != 0 {
            return (6 << 26) | (t << 16) | hi(rest_pairs);
        }
    }
    if let Some(t) = straight_top(all) {
        return (4 << 26) | t;
    }
    if trips != 0 {
        let t = hi(trips);
        return (3 << 26) | (t << 16) | top_bits(all & !(1 << t), 2);
    }
    let pc = pairs.count_ones();
    if pc >= 2 {
        let tp = top_bits(pairs, 2);
        return (2 << 26) | (tp << 13) | top_bits(all & !tp, 1);
    }
    if pc == 1 {
        let p = hi(pairs);
        return (1 << 26) | (p << 16) | top_bits(all & !(1 << p), 3);
    }
    top_bits(all, 5)
}

/// Pot (principal ou side pot) : montant et joueurs éligibles (indices dans `hands`).
#[derive(Debug, Clone)]
pub struct Pot {
    pub amount: f64,
    pub eligible: Vec<usize>,
}

struct Rng(u64);
impl Rng {
    #[inline]
    fn next(&mut self) -> u64 {
        // xorshift64*
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    }
}

pub struct EquityResult {
    /// gain espéré (jetons) de chaque joueur sur l'ensemble des pots
    pub expected: Vec<f64>,
    /// variance du gain de chaque joueur
    pub variance: Vec<f64>,
    /// équité brute (part moyenne du pot principal)
    pub equity: Vec<f64>,
}

/// Calcule l'espérance de gain de chaque main sur les pots donnés.
pub fn equity(hands: &[[Card; 2]], board: &[Card], pots: &[Pot], seed: u64, mc_iters: u32) -> EquityResult {
    let n = hands.len();
    let mut used = 0u64;
    for h in hands {
        used |= 1 << h[0];
        used |= 1 << h[1];
    }
    for &c in board {
        used |= 1 << c;
    }
    let deck: Vec<Card> = (0..52u8).filter(|c| used & (1 << c) == 0).collect();
    let need = 5 - board.len();
    let mut sum = vec![0.0f64; n];
    let mut sum2 = vec![0.0f64; n];
    let mut eqs = vec![0.0f64; n];
    let mut count = 0u64;

    let run = |extra: &[Card], sum: &mut [f64], sum2: &mut [f64], eqs: &mut [f64]| {
        let mut full = [0u8; 7];
        let mut ranks = [0u32; 10];
        let mut buf = [0u8; 7];
        let bl = board.len();
        buf[2..2 + bl].copy_from_slice(board);
        buf[2 + bl..7].copy_from_slice(extra);
        for (i, h) in hands.iter().enumerate() {
            full.copy_from_slice(&buf);
            full[0] = h[0];
            full[1] = h[1];
            if i < 10 {
                ranks[i] = eval(&full);
            }
        }
        let mut won = [0.0f64; 10];
        for (pi, pot) in pots.iter().enumerate() {
            let best = pot.eligible.iter().map(|&e| ranks[e]).max().unwrap_or(0);
            let winners: Vec<usize> = pot.eligible.iter().copied().filter(|&e| ranks[e] == best).collect();
            let share = pot.amount / winners.len() as f64;
            for w in &winners {
                won[*w] += share;
                if pi == 0 {
                    eqs[*w] += 1.0 / winners.len() as f64;
                }
            }
        }
        for i in 0..n.min(10) {
            sum[i] += won[i];
            sum2[i] += won[i] * won[i];
        }
    };

    match need {
        0 => {
            run(&[], &mut sum, &mut sum2, &mut eqs);
            count = 1;
        }
        1 => {
            for &a in &deck {
                run(&[a], &mut sum, &mut sum2, &mut eqs);
                count += 1;
            }
        }
        2 => {
            for i in 0..deck.len() {
                for j in i + 1..deck.len() {
                    run(&[deck[i], deck[j]], &mut sum, &mut sum2, &mut eqs);
                    count += 1;
                }
            }
        }
        _ => {
            let mut rng = Rng(seed | 1);
            let mut d = deck.clone();
            let len = d.len();
            for _ in 0..mc_iters {
                // Fisher-Yates partiel
                for k in 0..need {
                    let r = k + (rng.next() % (len - k) as u64) as usize;
                    d.swap(k, r);
                }
                run(&d[..need], &mut sum, &mut sum2, &mut eqs);
                count += 1;
            }
        }
    }
    let c = count.max(1) as f64;
    let expected: Vec<f64> = sum.iter().map(|s| s / c).collect();
    let variance: Vec<f64> = sum2.iter().zip(&expected).map(|(s2, e)| (s2 / c - e * e).max(0.0)).collect();
    EquityResult { expected, variance, equity: eqs.iter().map(|e| e / c).collect() }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn c(s: &str) -> Card {
        let r = b"23456789TJQKA".iter().position(|&x| x == s.as_bytes()[0]).unwrap() as u8;
        let su = b"cdhs".iter().position(|&x| x == s.as_bytes()[1]).unwrap() as u8;
        r * 4 + su
    }
    fn h(s: &str) -> Vec<Card> {
        s.split(' ').map(c).collect()
    }
    #[test]
    fn ranks() {
        let sf = eval(&h("Ah Kh Qh Jh Th 2c 3d"));
        let quads = eval(&h("Ac Ad Ah As Kd 2c 3d"));
        let fh = eval(&h("Ac Ad Ah Ks Kd 2c 3d"));
        let fl = eval(&h("Ah 9h 7h 4h 2h Kc Kd"));
        let st = eval(&h("5c 6d 7h 8s 9d Kc Kd"));
        let wheel = eval(&h("Ac 2d 3h 4s 5d Kc Qd"));
        let trips = eval(&h("Ac Ad Ah 9s 5d Kc 2d"));
        let tp = eval(&h("Ac Ad Kh Ks 5d 7c 2d"));
        let p = eval(&h("Ac Ad Kh Js 5d 7c 2d"));
        let hc = eval(&h("Ac Qd Kh Js 5d 7c 2d"));
        assert!(sf > quads && quads > fh && fh > fl && fl > st && st > wheel && wheel > trips);
        assert!(trips > tp && tp > p && p > hc);
        // kicker
        assert!(eval(&h("Ac Ad Kh 9s 5d 7c 2d")) > eval(&h("Ac Ad Qh 9s 5d 7c 2d")));
        // deux brelans -> full
        assert_eq!(eval(&h("Ac Ad Ah Ks Kd Kc 3d")) >> 26, 6);
    }
    #[test]
    fn aa_vs_kk() {
        let r = equity(&[[c("Ac"), c("Ad")], [c("Kc"), c("Kd")]], &[], &[Pot { amount: 1000.0, eligible: vec![0, 1] }], 42, 40000);
        assert!((r.equity[0] - 0.82).abs() < 0.015, "{}", r.equity[0]);
    }
}
