//! Séries temporelles pour les graphiques (chips & bankroll) + événements marquants.

use super::Filter;
use crate::store::Store;
use serde::Serialize;

#[derive(Serialize, Default)]
pub struct ChipsChart {
    pub x: Vec<f64>,
    pub series: Vec<(String, Vec<f64>)>,
    pub total_x: f64,
    pub tournaments: usize,
    pub cev: f64,
    pub cev_ci: f64,
    pub min_cev: f64,
    /// abscisse (dans l'unité choisie) de chaque fin de tournoi, pour la ligne CEV min
    pub hands: usize,
}

/// Réduit à ~`max` points en conservant min/max de la série de référence par tranche.
fn downsample_idx(reference: &[f64], max: usize) -> Vec<usize> {
    let n = reference.len();
    if n <= max {
        return (0..n).collect();
    }
    let buckets = max / 2;
    let size = n as f64 / buckets as f64;
    let mut out = Vec::with_capacity(max + 2);
    out.push(0);
    for b in 0..buckets {
        let a = (b as f64 * size) as usize;
        let e = (((b + 1) as f64 * size) as usize).min(n);
        if a >= e {
            continue;
        }
        let (mut mi, mut ma) = (a, a);
        for i in a..e {
            if reference[i] < reference[mi] {
                mi = i;
            }
            if reference[i] > reference[ma] {
                ma = i;
            }
        }
        let (x, y) = if mi < ma { (mi, ma) } else { (ma, mi) };
        out.push(x);
        if y != x {
            out.push(y);
        }
    }
    out.push(n - 1);
    out.sort();
    out.dedup();
    out
}

pub fn chips_chart(s: &Store, filter: &Filter, axis: &str, max_points: usize) -> ChipsChart {
    let sel = filter.select(s);
    let sum = super::summary::summary_of(s, &sel);
    let mut x = vec![0.0];
    let mut chips = vec![0.0];
    let mut sd = vec![0.0];
    let mut nsd = vec![0.0];
    let mut ev = vec![0.0];
    let mut luck = vec![0.0];
    let mut minline = vec![0.0];
    let mut hu = vec![0.0];
    let mut tm = vec![0.0];
    let (mut c, mut a, mut b, mut e, mut h3, mut h2) = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    let mut hand_count = 0usize;
    let mut tcount = 0usize;
    for &ti in &sel {
        let t = &s.tours[ti];
        let nh = t.hands.len().max(1);
        for (k, &hi) in t.hands.iter().enumerate() {
            let r = &s.hands[hi];
            let pf = &r.f.players[r.h.hero as usize];
            c += pf.net;
            e += pf.ev;
            if r.f.showdown && !pf.folded {
                a += pf.net;
            } else {
                b += pf.net;
            }
            if r.h.seats.len() == 2 {
                h2 += pf.net;
            } else {
                h3 += pf.net;
            }
            hand_count += 1;
            if axis == "hands" {
                x.push(hand_count as f64);
                chips.push(c);
                sd.push(a);
                nsd.push(b);
                ev.push(e);
                luck.push(c - e);
                minline.push(sum.min_cev * (tcount as f64 + (k + 1) as f64 / nh as f64));
                hu.push(h2);
                tm.push(h3);
            }
        }
        tcount += 1;
        if axis != "hands" {
            x.push(if axis == "date" { t.t.end as f64 } else { tcount as f64 });
            chips.push(c);
            sd.push(a);
            nsd.push(b);
            ev.push(e);
            luck.push(c - e);
            minline.push(sum.min_cev * tcount as f64);
            hu.push(h2);
            tm.push(h3);
        }
    }
    if axis == "date" && x.len() > 1 {
        x[0] = x[1] - 1.0;
    }
    let idx = downsample_idx(&chips, max_points);
    let pick = |v: &Vec<f64>| idx.iter().map(|&i| v[i]).collect::<Vec<f64>>();
    ChipsChart {
        x: pick(&x),
        series: vec![
            ("chips".into(), pick(&chips)),
            ("chips_sd".into(), pick(&sd)),
            ("chips_nsd".into(), pick(&nsd)),
            ("ev".into(), pick(&ev)),
            ("min_cev".into(), pick(&minline)),
            ("luck".into(), pick(&luck)),
            ("chips_hu".into(), pick(&hu)),
            ("chips_3max".into(), pick(&tm)),
        ],
        total_x: *x.last().unwrap_or(&0.0),
        tournaments: sel.len(),
        cev: sum.cev,
        cev_ci: sum.cev_ci,
        min_cev: sum.min_cev,
        hands: hand_count,
    }
}

#[derive(Serialize, Default)]
pub struct Swing {
    pub amount: f64,
    pub from: usize,
    pub to: usize,
    pub from_ts: i64,
    pub to_ts: i64,
}

#[derive(Serialize, Default)]
pub struct Jackpot {
    pub index: usize,
    pub ts: i64,
    pub mult: f64,
    pub prize_pool: f64,
    pub won: f64,
    pub place: u8,
    pub tid: String,
}

#[derive(Serialize, Default)]
pub struct Events {
    pub jackpots: Vec<Jackpot>,
    pub upswing: Swing,
    pub downswing: Swing,
    pub ev_downswing: Swing,
    pub peak: (usize, f64),
    pub low: (usize, f64),
    pub longest_break_even: Swing,
    pub current_drawdown: f64,
    pub since_peak: usize,
    pub best_day: (i64, f64),
    pub worst_day: (i64, f64),
    pub best_streak: usize,
    pub worst_streak: usize,
}

#[derive(Serialize, Default)]
pub struct BankrollChart {
    pub x: Vec<f64>,
    pub ts: Vec<i64>,
    pub series: Vec<(String, Vec<f64>)>,
    pub events: Events,
    pub start: f64,
    pub transactions: f64,
}

fn swings(v: &[f64], ts: &[i64]) -> (Swing, Swing, Swing) {
    // (plus gros upswing, plus gros downswing, plus longue période sans nouveau sommet)
    let mut up = Swing::default();
    let mut down = Swing::default();
    let mut be = Swing::default();
    let (mut lo_i, mut hi_i) = (0usize, 0usize);
    let mut peak_i = 0usize;
    for i in 0..v.len() {
        if v[i] < v[lo_i] {
            lo_i = i;
        }
        if v[i] - v[lo_i] > up.amount {
            up = Swing { amount: v[i] - v[lo_i], from: lo_i, to: i, from_ts: ts[lo_i], to_ts: ts[i] };
        }
        if v[i] > v[hi_i] {
            hi_i = i;
        }
        if v[hi_i] - v[i] > down.amount {
            down = Swing { amount: -(v[hi_i] - v[i]), from: hi_i, to: i, from_ts: ts[hi_i], to_ts: ts[i] };
            down.amount = v[hi_i] - v[i];
        }
        if v[i] > v[peak_i] + 1e-9 {
            if i - peak_i > be.to - be.from {
                be = Swing { amount: (i - peak_i) as f64, from: peak_i, to: i, from_ts: ts[peak_i], to_ts: ts[i] };
            }
            peak_i = i;
        }
    }
    let last = v.len().saturating_sub(1);
    if last > peak_i && last - peak_i > be.to - be.from {
        be = Swing { amount: (last - peak_i) as f64, from: peak_i, to: last, from_ts: ts[peak_i], to_ts: ts[last] };
    }
    (up, down, be)
}

pub fn bankroll_chart(s: &Store, filter: &Filter, axis: &str) -> BankrollChart {
    let sel = filter.select(s);
    let mut x = vec![0.0];
    let mut tss = vec![sel.first().map(|&i| s.tours[i].t.start).unwrap_or(0)];
    let names = ["real", "real_rb", "ev", "ev_multi", "ev_eff", "rakeback"];
    let mut series: Vec<Vec<f64>> = names.iter().map(|_| vec![0.0]).collect();
    let mut acc = [0.0f64; 6];
    let mut jackpots = Vec::new();
    let mut days: std::collections::BTreeMap<i64, f64> = Default::default();
    let (mut streak, mut best_streak, mut worst_streak, mut last_win): (usize, usize, usize, Option<bool>) = (0, 0, 0, None);
    for (k, &i) in sel.iter().enumerate() {
        let t = &s.tours[i];
        acc[0] += t.real;
        acc[1] += t.real + t.rb;
        acc[2] += t.ev_theo + t.rb;
        acc[3] += t.ev_multi + t.rb;
        acc[4] += t.ev_eff + t.rb;
        acc[5] += t.rb;
        for j in 0..6 {
            series[j].push(acc[j]);
        }
        x.push(if axis == "date" { t.t.end as f64 } else { (k + 1) as f64 });
        tss.push(t.t.end);
        *days.entry(t.day).or_default() += t.real + t.rb;
        if t.t.multiplier >= s.settings.jackpot_threshold {
            jackpots.push(Jackpot {
                index: k + 1,
                ts: t.t.start,
                mult: t.t.multiplier,
                prize_pool: t.t.prize_pool,
                won: t.winnings,
                place: t.place,
                tid: t.t.id.clone(),
            });
        }
        let win = t.place == 1;
        if last_win == Some(win) {
            streak += 1;
        } else {
            streak = 1;
        }
        last_win = Some(win);
        if win {
            best_streak = best_streak.max(streak);
        } else {
            worst_streak = worst_streak.max(streak);
        }
    }
    if axis == "date" && x.len() > 1 {
        x[0] = x[1] - 1.0;
    }
    let (up, down, be) = swings(&series[1], &tss);
    let (_, evdown, _) = swings(&series[2], &tss);
    let v = series[1].clone();
    let (mut pk, mut lw) = ((0usize, 0.0f64), (0usize, 0.0f64));
    for (i, &y) in v.iter().enumerate() {
        if y > pk.1 {
            pk = (i, y);
        }
        if y < lw.1 {
            lw = (i, y);
        }
    }
    let cur = *v.last().unwrap_or(&0.0);
    let best_day = days.iter().max_by(|a, b| a.1.partial_cmp(b.1).unwrap()).map(|(d, v)| (*d * 86400, *v)).unwrap_or_default();
    let worst_day = days.iter().min_by(|a, b| a.1.partial_cmp(b.1).unwrap()).map(|(d, v)| (*d * 86400, *v)).unwrap_or_default();
    let tx: f64 = s.settings.transactions.iter().map(|t| t.amount).sum();
    BankrollChart {
        x,
        ts: tss,
        series: names.iter().map(|n| n.to_string()).zip(series).collect(),
        events: Events {
            jackpots,
            upswing: up,
            downswing: down,
            ev_downswing: evdown,
            peak: pk,
            low: lw,
            longest_break_even: be,
            current_drawdown: pk.1 - cur,
            since_peak: v.len().saturating_sub(1).saturating_sub(pk.0),
            best_day,
            worst_day,
            best_streak,
            worst_streak,
        },
        start: s.settings.bankroll_start,
        transactions: tx,
    }
}
