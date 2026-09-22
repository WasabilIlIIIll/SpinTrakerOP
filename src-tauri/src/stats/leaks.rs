//! Leak finder : arbre de décisions préflop par scénario / tapis effectif,
//! matrices de mains, stats postflop, comparaison à une référence.

use super::Filter;
use crate::analysis::{Pos, Scenario};
use crate::model::{ActKind, Action, STREET_FLOP, STREET_PREFLOP, STREET_TURN};
use crate::store::{HandRec, Store};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};

pub const BUCKETS: [(f64, f64, &str); 10] = [
    (20.0, 1e9, "20+"),
    (18.0, 20.0, "18-20"),
    (16.0, 18.0, "16-18"),
    (14.0, 16.0, "14-16"),
    (12.0, 14.0, "12-14"),
    (10.0, 12.0, "10-12"),
    (8.0, 10.0, "8-10"),
    (6.0, 8.0, "6-8"),
    (4.0, 6.0, "4-6"),
    (0.0, 4.0, "0-4"),
];

fn bucket_of(bb: f64) -> usize {
    BUCKETS.iter().position(|(a, b, _)| bb >= *a && bb < *b).unwrap_or(9)
}

#[derive(Default, Clone)]
struct Acc {
    counts: [u32; 4],
    buckets: [[u32; 4]; 10],
    matrix: HashMap<String, [u32; 4]>,
    ev: f64,
}

#[derive(Serialize)]
pub struct NodeOut {
    pub key: String,
    pub label: String,
    pub kind: String,
    pub total: u32,
    pub counts: [u32; 4],
    pub reference: Option<[f64; 4]>,
    pub ref_total: u32,
    pub buckets: Vec<BucketOut>,
    pub matrix: BTreeMap<String, [u32; 4]>,
    /// EV moyen (jetons) de la main après cette décision
    pub ev: f64,
}

#[derive(Serialize)]
pub struct BucketOut {
    pub label: String,
    pub total: u32,
    pub counts: [u32; 4],
    pub reference: Option<[f64; 4]>,
    pub ref_total: u32,
}

#[derive(Serialize)]
pub struct Panel {
    pub scenario: String,
    pub hands: u32,
    pub nodes: Vec<NodeOut>,
}

#[derive(Serialize, Default, Clone)]
pub struct Post {
    pub key: String,
    pub flops: u32,
    pub cbet: [u32; 2],
    pub fold_cbet: [u32; 2],
    pub raise_cbet: [u32; 2],
    pub check_raise: [u32; 2],
    pub donk: [u32; 2],
    pub barrel: [u32; 2],
    pub wtsd: [u32; 2],
    pub wsd: [u32; 2],
    pub agg: u32,
    pub calls: u32,
    pub bets_raises_flop: [u32; 2],
}

#[derive(Serialize)]
pub struct PostOut {
    pub player: Vec<Post>,
    pub reference: Vec<Post>,
}

#[derive(Serialize)]
pub struct LeakReport {
    pub player: String,
    pub hands: u32,
    pub panels: Vec<Panel>,
    pub postflop: PostOut,
}

fn pos_label(p: Pos, n: usize) -> &'static str {
    match (p, n) {
        (Pos::Sb, 2) => "SB",
        (Pos::Bb, 2) => "BB",
        (Pos::Btn, _) => "BTN",
        (Pos::Sb, _) => "SB",
        (Pos::Bb, _) => "BB",
    }
}

fn combo(c: Option<[u8; 2]>) -> Option<String> {
    let [a, b] = c?;
    const R: &[u8] = b"23456789TJQKA";
    let (ra, rb) = (a / 4, b / 4);
    let (hi, lo) = if ra >= rb { (ra, rb) } else { (rb, ra) };
    let mut s = String::new();
    s.push(R[hi as usize] as char);
    s.push(R[lo as usize] as char);
    if hi != lo {
        s.push(if a % 4 == b % 4 { 's' } else { 'o' });
    }
    Some(s)
}

/// Libellé d'une action adverse dans son contexte (niveau de relance avant elle).
fn act_label(a: &Action, raises_before: u32) -> String {
    match a.kind {
        ActKind::Call => {
            if raises_before == 0 {
                "Limp".into()
            } else {
                "Call".into()
            }
        }
        ActKind::Raise | ActKind::Bet => match (raises_before, a.allin) {
            (0, true) => "Shove".into(),
            (0, false) => "Open".into(),
            (1, true) => "3B all-in".into(),
            (1, false) => "3-bet".into(),
            (_, true) => "4B all-in".into(),
            (_, false) => "4-bet".into(),
        },
        ActKind::Check => "Check".into(),
        _ => "?".into(),
    }
}

struct Decision {
    scenario: Scenario,
    key: String,
    label: String,
    kind: &'static str,
    class: usize,
    bucket: usize,
}

/// Décisions préflop d'un joueur dans une main.
fn decisions(r: &HandRec, pi: usize) -> Vec<Decision> {
    let h = &r.h;
    let n = h.seats.len();
    let pre: Vec<&Action> = h.actions.iter().filter(|a| a.street == STREET_PREFLOP && !a.kind.is_post()).collect();
    let pf = &r.f.players[pi];
    let stack = h.seats[pi].stack;
    let max_opp = (0..n).filter(|&i| i != pi).map(|i| h.seats[i].stack).fold(0.0, f64::max);
    let eff = if h.bb > 0.0 { stack.min(max_opp) / h.bb } else { 0.0 };
    let bucket = bucket_of(eff);
    let mut out = Vec::new();
    let mut raises = vec![0u32; pre.len() + 1];
    let mut rc = 0;
    for (k, a) in pre.iter().enumerate() {
        raises[k] = rc;
        if a.kind.is_aggressive() {
            rc += 1;
        }
    }
    for (j, a) in pre.iter().enumerate() {
        if a.p as usize != pi {
            continue;
        }
        let prior = &pre[..j];
        let own_prev: Vec<usize> = (0..j).filter(|&k| pre[k].p as usize == pi).collect();
        let (label, facing_from) = if let Some(&last_own) = own_prev.last() {
            let own_l = act_label(pre[last_own], raises[last_own]);
            (format!("{own_l} → "), last_own + 1)
        } else {
            (String::new(), 0)
        };
        let others: Vec<(usize, &&Action)> =
            prior.iter().enumerate().skip(facing_from).filter(|(_, x)| x.kind != ActKind::Fold && x.p as usize != pi).collect();
        let last_aggr = others.iter().rev().find(|(_, x)| x.kind.is_aggressive());
        let kind: &'static str = match last_aggr {
            Some((_, x)) if x.allin => "vs_shove",
            Some(_) => "vs_raise",
            None => {
                if others.is_empty() && own_prev.is_empty() {
                    "open"
                } else if others.is_empty() {
                    // ex : limp puis check derrière -> pas de nouvelle décision pertinente
                    "vs_limp"
                } else {
                    "vs_limp"
                }
            }
        };
        let facing = if others.is_empty() {
            if own_prev.is_empty() {
                "Open".to_string()
            } else {
                "vs Check".to_string()
            }
        } else {
            let parts: Vec<String> =
                others.iter().map(|(k, x)| format!("{} {}", pos_label(r.f.players[x.p as usize].pos, n), act_label(x, raises[*k]))).collect();
            format!("vs {}", parts.join(" + "))
        };
        let label = format!("{label}{facing}");
        // cas "vs_limp" où le joueur est SB/BB/BTN : Call = check/complete
        let class = match a.kind {
            ActKind::Raise | ActKind::Bet => {
                if a.allin {
                    0
                } else {
                    1
                }
            }
            ActKind::Call => {
                if kind == "vs_raise" && a.allin {
                    2
                } else {
                    2
                }
            }
            ActKind::Check => 2,
            ActKind::Fold => 3,
            _ => continue,
        };
        let scenario = pf.scenario;
        out.push(Decision { key: format!("{}|{}", scenario.label(), label), scenario, label, kind, class, bucket });
    }
    out
}

fn post_key(r: &HandRec) -> &'static str {
    let seen = r.f.saw_flop.iter().filter(|x| **x).count();
    if seen >= 3 {
        "3-way"
    } else {
        "HU"
    }
}

fn postflop(r: &HandRec, pi: usize, acc: &mut HashMap<&'static str, Post>) {
    if !r.f.saw_flop[pi] {
        return;
    }
    let h = &r.h;
    let key = post_key(r);
    let p = acc.entry(key).or_insert_with(|| Post { key: key.into(), ..Default::default() });
    p.flops += 1;
    let pre: Vec<&Action> = h.actions.iter().filter(|a| a.street == STREET_PREFLOP && a.kind.is_aggressive()).collect();
    let pfr = pre.last().map(|a| a.p as usize);
    let flop: Vec<&Action> = h.actions.iter().filter(|a| a.street == STREET_FLOP).collect();
    let turn: Vec<&Action> = h.actions.iter().filter(|a| a.street == STREET_TURN).collect();
    let mut bet_seen = false;
    let mut cbet_by: Option<usize> = None;
    let mut my_first = true;
    let mut i_checked = false;
    let mut faced_cbet = false;
    for a in &flop {
        let who = a.p as usize;
        if who == pi {
            if my_first {
                my_first = false;
                if Some(pi) == pfr && !bet_seen {
                    p.cbet[1] += 1;
                    if a.kind == ActKind::Bet {
                        p.cbet[0] += 1;
                    }
                }
                if Some(pi) != pfr && !bet_seen && pfr.is_some() {
                    p.donk[1] += 1;
                    if a.kind == ActKind::Bet {
                        p.donk[0] += 1;
                    }
                }
            }
            if cbet_by.is_some() && cbet_by != Some(pi) && !faced_cbet {
                faced_cbet = true;
                p.fold_cbet[1] += 1;
                p.raise_cbet[1] += 1;
                if a.kind == ActKind::Fold {
                    p.fold_cbet[0] += 1;
                }
                if a.kind == ActKind::Raise {
                    p.raise_cbet[0] += 1;
                }
                if i_checked {
                    p.check_raise[1] += 1;
                    if a.kind == ActKind::Raise {
                        p.check_raise[0] += 1;
                    }
                }
            }
            if a.kind == ActKind::Check {
                i_checked = true;
            }
            p.bets_raises_flop[1] += 1;
            if a.kind.is_aggressive() {
                p.bets_raises_flop[0] += 1;
            }
        }
        if a.kind == ActKind::Bet && !bet_seen {
            if Some(who) == pfr {
                cbet_by = Some(who);
            }
            bet_seen = true;
        } else if a.kind.is_aggressive() {
            bet_seen = true;
        }
    }
    if cbet_by == Some(pi) {
        if let Some(a) = turn.iter().find(|a| a.p as usize == pi) {
            p.barrel[1] += 1;
            if a.kind == ActKind::Bet {
                p.barrel[0] += 1;
            }
        }
    }
    let pf = &r.f.players[pi];
    p.wtsd[1] += 1;
    if r.f.showdown && !pf.folded {
        p.wtsd[0] += 1;
        p.wsd[1] += 1;
        if pf.net > 0.0 {
            p.wsd[0] += 1;
        }
    }
    for a in h.actions.iter().filter(|a| a.street >= STREET_FLOP && a.p as usize == pi) {
        if a.kind.is_aggressive() {
            p.agg += 1;
        } else if a.kind == ActKind::Call {
            p.calls += 1;
        }
    }
}

/// `reference` : "population" | "tag:<id>" | "custom" | "none"
pub fn leak_report(s: &Store, player: &str, filter: &Filter, reference: &str, min_matrix: bool) -> LeakReport {
    let ref_mode = reference;
    let is_hero = player.is_empty() || s.is_hero(player);
    let sel: HashSet<usize> = filter.select(s).into_iter().collect();
    let ref_players: Option<HashSet<String>> = if let Some(tag) = reference.strip_prefix("tag:") {
        Some(s.pstats.keys().filter(|n| s.tags_of(n).iter().any(|t| t == tag)).cloned().collect())
    } else {
        None
    };
    let mut mine: BTreeMap<String, (Scenario, String, &'static str, Acc)> = BTreeMap::new();
    let mut refs: HashMap<String, Acc> = HashMap::new();
    let mut hands = 0u32;
    let mut scen_hands: HashMap<Scenario, u32> = HashMap::new();
    let mut post_me: HashMap<&'static str, Post> = HashMap::new();
    let mut post_ref: HashMap<&'static str, Post> = HashMap::new();
    let use_pop = reference == "population" || ref_players.is_some();
    for r in &s.hands {
        let me: Option<usize> = if is_hero {
            if sel.contains(&r.t) {
                Some(r.h.hero as usize)
            } else {
                None
            }
        } else {
            r.h.seats.iter().position(|x| x.name == player)
        };
        if let Some(pi) = me {
            hands += 1;
            *scen_hands.entry(r.f.players[pi].scenario).or_default() += 1;
            let cards = r.h.seats[pi].cards;
            let ev_after = r.f.players[pi].ev;
            for d in decisions(r, pi) {
                let e = mine.entry(d.key.clone()).or_insert_with(|| (d.scenario, d.label.clone(), d.kind, Acc::default()));
                e.3.counts[d.class] += 1;
                e.3.buckets[d.bucket][d.class] += 1;
                e.3.ev += ev_after;
                if min_matrix {
                    if let Some(c) = combo(cards) {
                        e.3.matrix.entry(c).or_default()[d.class] += 1;
                    }
                }
            }
            postflop(r, pi, &mut post_me);
        }
        if use_pop {
            for (i, seat) in r.h.seats.iter().enumerate() {
                if Some(i) == me || s.is_hero(&seat.name) && is_hero {
                    continue;
                }
                if let Some(rp) = &ref_players {
                    if !rp.contains(&seat.name) {
                        continue;
                    }
                }
                for d in decisions(r, i) {
                    let e = refs.entry(d.key).or_default();
                    e.counts[d.class] += 1;
                    e.buckets[d.bucket][d.class] += 1;
                }
                postflop(r, i, &mut post_ref);
            }
        }
    }
    let custom = &s.settings.references;
    let to_pct = |c: &[u32; 4]| -> Option<[f64; 4]> {
        let t: u32 = c.iter().sum();
        if t == 0 {
            None
        } else {
            Some(c.map(|x| x as f64 / t as f64 * 100.0))
        }
    };
    let custom_ref = |key: &str, b: &str| -> Option<[f64; 4]> {
        let mut out = [f64::NAN; 4];
        let mut any = false;
        for k in 0..4 {
            if let Some(v) = custom.get(&format!("{key}|{k}|{b}")) {
                out[k] = *v;
                any = true;
            }
        }
        if any {
            Some(out)
        } else {
            None
        }
    };
    let mut panels: Vec<Panel> =
        Scenario::ALL.iter().map(|sc| Panel { scenario: sc.label().into(), hands: *scen_hands.get(sc).unwrap_or(&0), nodes: vec![] }).collect();
    for (key, (sc, label, kind, acc)) in mine {
        let total: u32 = acc.counts.iter().sum();
        let rf = refs.get(&key);
        let (refv, ref_total) = if ref_mode == "custom" {
            (custom_ref(&key, "all"), 0)
        } else {
            (rf.and_then(|r| to_pct(&r.counts)), rf.map(|r| r.counts.iter().sum()).unwrap_or(0))
        };
        let buckets = (0..10)
            .filter(|&b| acc.buckets[b].iter().sum::<u32>() > 0)
            .map(|b| {
                let (r, rt) = if ref_mode == "custom" {
                    (custom_ref(&key, BUCKETS[b].2), 0)
                } else {
                    (rf.and_then(|r| to_pct(&r.buckets[b])), rf.map(|r| r.buckets[b].iter().sum()).unwrap_or(0))
                };
                BucketOut { label: BUCKETS[b].2.into(), total: acc.buckets[b].iter().sum(), counts: acc.buckets[b], reference: r, ref_total: rt }
            })
            .collect();
        let pi = Scenario::ALL.iter().position(|x| *x == sc).unwrap();
        panels[pi].nodes.push(NodeOut {
            key,
            label,
            kind: kind.into(),
            total,
            counts: acc.counts,
            reference: refv,
            ref_total,
            buckets,
            matrix: acc.matrix.into_iter().collect(),
            ev: if total > 0 { acc.ev / total as f64 } else { 0.0 },
        });
    }
    for p in &mut panels {
        p.nodes.sort_by(|a, b| b.total.cmp(&a.total));
    }
    let mut pm: Vec<Post> = post_me.into_values().collect();
    pm.sort_by(|a, b| a.key.cmp(&b.key));
    let mut pr: Vec<Post> = post_ref.into_values().collect();
    pr.sort_by(|a, b| a.key.cmp(&b.key));
    LeakReport { player: player.into(), hands, panels, postflop: PostOut { player: pm, reference: pr } }
}
