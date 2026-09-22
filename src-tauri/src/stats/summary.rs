//! Indicateurs principaux (KPI) sur une sélection de tournois.

use super::{mean_ci, Filter};
use crate::store::{place_probs, Store};
use serde::Serialize;

#[derive(Serialize, Default)]
pub struct Profits {
    pub real: f64,
    pub real_rb: f64,
    pub ev: f64,
    pub ev_multi: f64,
    pub ev_eff: f64,
}

#[derive(Serialize, Default)]
pub struct Summary {
    pub tournaments: usize,
    pub hands: usize,
    pub cev: f64,
    pub cev_ci: f64,
    pub cev_hand: f64,
    pub chips_avg: f64,
    pub rakeback: f64,
    pub buyins: f64,
    pub avg_buyin: f64,
    pub profit: Profits,
    pub roi: Profits,
    pub hourly: Profits,
    pub seconds: i64,
    pub spins_per_hour: f64,
    pub min_cev: f64,
    pub luck_z: f64,
    pub luck_chips: f64,
    pub finish: [f64; 3],
    pub finish_expected: [f64; 3],
    pub avg_mult: f64,
    pub expected_mult: f64,
    pub hands_per_spin: f64,
    pub first: i64,
    pub last: i64,
    pub avg_tables: f64,
    pub avg_duration: f64,
}

/// Durée cumulée en tenant compte du multi-tabling (union des intervalles).
pub fn union_seconds(s: &Store, sel: &[usize]) -> i64 {
    let mut iv: Vec<(i64, i64)> = sel.iter().map(|&i| (s.tours[i].t.start, s.tours[i].t.end.max(s.tours[i].t.start))).collect();
    iv.sort();
    let mut total = 0;
    let mut cur: Option<(i64, i64)> = None;
    for (a, b) in iv {
        match cur {
            Some((ca, cb)) if a <= cb => cur = Some((ca, cb.max(b))),
            Some((ca, cb)) => {
                total += cb - ca;
                cur = Some((a, b));
            }
            None => cur = Some((a, b)),
        }
    }
    if let Some((a, b)) = cur {
        total += b - a;
    }
    total
}

/// CEV pour lequel l'EV profit (rakeback compris) est nul.
pub fn break_even_cev(s: &Store, sel: &[usize]) -> f64 {
    if sel.is_empty() {
        return 0.0;
    }
    let f = |c: f64| -> f64 {
        sel.iter()
            .map(|&i| {
                let t = &s.tours[i];
                let size = t.t.table_size.max(2) as usize;
                let p = place_probs(t.t.starting_stack + c, t.total_chips, size);
                p[0] * t.e_prize[0] + p[1] * t.e_prize[1] + p[2] * t.e_prize[2] - t.t.buyin + t.rb
            })
            .sum()
    };
    let s0 = sel.iter().map(|&i| s.tours[i].t.starting_stack).sum::<f64>() / sel.len() as f64;
    let (mut lo, mut hi) = (-s0, 2.0 * s0);
    if f(lo) > 0.0 {
        return lo;
    }
    if f(hi) < 0.0 {
        return hi;
    }
    for _ in 0..60 {
        let mid = (lo + hi) / 2.0;
        if f(mid) > 0.0 {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    (lo + hi) / 2.0
}

pub fn summary(s: &Store, filter: &Filter) -> Summary {
    let sel = filter.select(s);
    summary_of(s, &sel)
}

pub fn summary_of(s: &Store, sel: &[usize]) -> Summary {
    let mut out = Summary::default();
    let n = sel.len();
    out.tournaments = n;
    if n == 0 {
        return out;
    }
    let evs: Vec<f64> = sel.iter().map(|&i| s.tours[i].ev).collect();
    let (cev, ci) = mean_ci(&evs);
    out.cev = cev;
    out.cev_ci = ci;
    out.hands = sel.iter().map(|&i| s.tours[i].hands.len()).sum();
    out.cev_hand = if out.hands > 0 { evs.iter().sum::<f64>() / out.hands as f64 } else { 0.0 };
    out.chips_avg = sel.iter().map(|&i| s.tours[i].chips).sum::<f64>() / n as f64;
    out.rakeback = sel.iter().map(|&i| s.tours[i].rb).sum();
    out.buyins = sel.iter().map(|&i| s.tours[i].t.buyin).sum();
    out.avg_buyin = out.buyins / n as f64;
    let sum = |f: &dyn Fn(usize) -> f64| sel.iter().map(|&i| f(i)).sum::<f64>();
    out.profit = Profits {
        real: sum(&|i| s.tours[i].real),
        real_rb: sum(&|i| s.tours[i].real + s.tours[i].rb),
        ev: sum(&|i| s.tours[i].ev_theo + s.tours[i].rb),
        ev_multi: sum(&|i| s.tours[i].ev_multi + s.tours[i].rb),
        ev_eff: sum(&|i| s.tours[i].ev_eff + s.tours[i].rb),
    };
    let b = out.buyins.max(1e-9);
    out.roi = Profits {
        real: out.profit.real / b * 100.0,
        real_rb: out.profit.real_rb / b * 100.0,
        ev: out.profit.ev / b * 100.0,
        ev_multi: out.profit.ev_multi / b * 100.0,
        ev_eff: out.profit.ev_eff / b * 100.0,
    };
    out.seconds = union_seconds(s, sel);
    let h = (out.seconds as f64 / 3600.0).max(1e-9);
    out.hourly = Profits {
        real: out.profit.real / h,
        real_rb: out.profit.real_rb / h,
        ev: out.profit.ev / h,
        ev_multi: out.profit.ev_multi / h,
        ev_eff: out.profit.ev_eff / h,
    };
    out.spins_per_hour = n as f64 / h;
    out.min_cev = break_even_cev(s, sel);
    let var: f64 = sel.iter().map(|&i| s.tours[i].ev_var).sum();
    let chips: f64 = sel.iter().map(|&i| s.tours[i].chips).sum();
    let ev: f64 = evs.iter().sum();
    out.luck_chips = chips - ev;
    out.luck_z = if var > 0.0 { (chips - ev) / var.sqrt() } else { 0.0 };
    let mut fin = [0.0; 3];
    let mut fe = [0.0; 3];
    for &i in sel {
        let t = &s.tours[i];
        if (1..=3).contains(&t.place) {
            fin[(t.place - 1) as usize] += 1.0;
        }
        let pg = place_probs(t.t.starting_stack + cev, t.total_chips, t.t.table_size.max(2) as usize);
        for k in 0..3 {
            fe[k] += pg[k];
        }
    }
    out.finish = fin.map(|x| x / n as f64 * 100.0);
    out.finish_expected = fe.map(|x| x / n as f64 * 100.0);
    out.avg_mult = sel.iter().map(|&i| s.tours[i].t.multiplier).sum::<f64>() / n as f64;
    out.expected_mult = sel
        .iter()
        .map(|&i| {
            let t = &s.tours[i].t;
            if t.buyin > 0.0 {
                t.table_size.max(2) as f64 * t.prize_contrib / t.buyin
            } else {
                0.0
            }
        })
        .sum::<f64>()
        / n as f64;
    out.hands_per_spin = out.hands as f64 / n as f64;
    out.first = sel.iter().map(|&i| s.tours[i].t.start).min().unwrap_or(0);
    out.last = sel.iter().map(|&i| s.tours[i].t.start).max().unwrap_or(0);
    out.avg_tables = sel.iter().map(|&i| s.tours[i].tables).sum::<f64>() / n as f64;
    out.avg_duration = sel.iter().map(|&i| (s.tours[i].t.end - s.tours[i].t.start) as f64).sum::<f64>() / n as f64;
    out
}
