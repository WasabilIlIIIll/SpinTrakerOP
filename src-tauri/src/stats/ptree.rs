//! Leak finder postflop : arbre de décision d'un duel (ex. BTN contre BB en pot relancé).
//! Chaque nœud est un moment où un joueur doit agir ; ses branches sont les actions jouées :
//! check, mise (toutes tailles regroupées, avec leur répartition en % du pot), call, relance,
//! fold. Les fréquences du sujet (moi par défaut) sont comparées à une référence : les autres
//! joueurs au même poste, un groupe (tag, joueurs) ou une base de référence importée.

use super::leaks::{Subject, BUCKETS};
use super::Filter;
use crate::analysis::Pos;
use crate::model::{ActKind, STREET_FLOP, STREET_PREFLOP};
use crate::store::{HandRec, Store};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

#[derive(Serialize, Default)]
pub struct PNode {
    /// street de la décision (1 flop, 2 turn, 3 river) ; 0 = fin du coup
    pub street: u8,
    /// poste du joueur qui agit (vide en fin de coup)
    pub actor: String,
    /// le joueur qui agit est au poste analysé
    pub subject: bool,
    /// mains du sujet / de la référence arrivées à ce nœud
    pub n: u32,
    pub r: u32,
    /// résultat moyen du sujet (bb) sur les mains passées par ce nœud
    pub net: f64,
    pub kids: Vec<PEdge>,
}

#[derive(Serialize)]
pub struct PEdge {
    /// "Check" | "Bet" | "Call" | "Raise" | "Fold"
    pub label: String,
    /// répartition par taille : [taille, mains du sujet, mains de la référence]
    pub sizes: Vec<(String, u32, u32)>,
    pub node: PNode,
}

#[derive(Serialize)]
pub struct PotOpt {
    pub key: String,
    pub label: String,
    pub n: u32,
}

#[derive(Serialize)]
pub struct PTree {
    pub pots: Vec<PotOpt>,
    pub pot: String,
    /// poste du dernier relanceur préflop (vide en pot limpé)
    pub aggressor: String,
    pub hands: u32,
    pub ref_hands: u32,
    pub root: PNode,
}

/// Arbre compact d'une base de référence importée (comptes seulement).
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct TNode {
    pub n: u32,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub sizes: BTreeMap<String, u32>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub kids: BTreeMap<String, TNode>,
}

#[derive(Default)]
struct Build {
    street: u8,
    actor: String,
    n: u32,
    r: u32,
    net: f64,
    sizes: BTreeMap<String, (u32, u32)>,
    kids: BTreeMap<String, Build>,
}

/// Référence de l'arbre.
pub enum RefSel {
    None,
    /// les autres joueurs au même poste
    Population,
    /// un ensemble de joueurs (tag, pseudo, groupe)
    Set(HashSet<String>),
    /// arbres d'une base importée (par duel et type de pot)
    File(BTreeMap<String, TNode>),
}

fn pos_label(p: Pos) -> &'static str {
    match p {
        Pos::Btn => "BTN",
        Pos::Sb => "SB",
        Pos::Bb => "BB",
    }
}

/// Taille d'une mise en % du pot avant la mise.
fn bet_size(pct: f64) -> &'static str {
    if pct < 45.0 {
        "⅓"
    } else if pct < 62.0 {
        "½"
    } else if pct < 90.0 {
        "¾"
    } else if pct < 125.0 {
        "Pot"
    } else {
        "Overbet"
    }
}

/// Type de pot préflop et rôle de l'agresseur : "limp", "srp:me", "srp:opp", "3bet:me"…
fn pot_key(r: &HandRec, me: usize) -> Option<String> {
    let pre: Vec<_> = r.h.actions.iter().filter(|a| a.street == STREET_PREFLOP && !a.kind.is_post()).collect();
    if pre.iter().any(|a| a.allin) {
        return None;
    }
    let aggr: Vec<_> = pre.iter().filter(|a| a.kind.is_aggressive()).collect();
    let who = match aggr.last() {
        None => return Some("limp".into()),
        Some(a) if a.p as usize == me => "me",
        Some(_) => "opp",
    };
    let t = match aggr.len() {
        1 => "srp",
        2 => "3bet",
        _ => "4bet",
    };
    Some(format!("{t}:{who}"))
}

fn pot_label(key: &str, me: &str, opp: &str) -> String {
    let (t, who) = key.split_once(':').unwrap_or((key, ""));
    let aggr = if who == "me" { me } else { opp };
    match t {
        "limp" => "Pot limpé".into(),
        "srp" => format!("Pot relancé ({aggr} relance)"),
        "3bet" => format!("Pot 3-bet ({aggr} 3-bet)"),
        _ => format!("Pot 4-bet+ ({aggr})"),
    }
}

/// Le duel au flop : (siège au poste analysé, siège adverse) si exactement ces deux joueurs
/// ont vu le flop.
fn duel(r: &HandRec, table: &str, me_pos: &str, opp_pos: &str) -> Option<(usize, usize)> {
    let n = r.h.seats.len();
    if (table == "hu") != (n == 2) {
        return None;
    }
    let seen: Vec<usize> = (0..n).filter(|&i| r.f.saw_flop.get(i).copied().unwrap_or(false)).collect();
    if seen.len() != 2 {
        return None;
    }
    let lab = |i: usize| pos_label(r.f.players[i].pos);
    let me = *seen.iter().find(|&&i| lab(i) == me_pos)?;
    let opp = *seen.iter().find(|&&i| i != me && lab(i) == opp_pos)?;
    Some((me, opp))
}

fn eff_bucket(r: &HandRec, a: usize, b: usize) -> usize {
    let bb = r.h.bb.max(1e-9);
    let eff = r.h.seats[a].stack.min(r.h.seats[b].stack) / bb;
    BUCKETS.iter().position(|(lo, hi, _)| eff >= *lo && eff < *hi).unwrap_or(9)
}

/// Parcourt les actions postflop d'une main et les ajoute à l'arbre.
fn walk(root: &mut Build, r: &HandRec, me: usize, subject: bool) {
    let mut pot: f64 = r.h.actions.iter().filter(|a| a.street == STREET_PREFLOP).map(|a| a.amount).sum();
    let net = if subject { r.f.players[me].net / r.h.bb.max(1e-9) } else { 0.0 };
    let mut node = root;
    let add = |b: &mut Build| {
        if subject {
            b.n += 1;
            b.net += net;
        } else {
            b.r += 1;
        }
    };
    add(node);
    for a in r.h.actions.iter().filter(|a| a.street >= STREET_FLOP) {
        let (label, size): (&str, &str) = match a.kind {
            ActKind::Check => ("Check", ""),
            ActKind::Fold => ("Fold", ""),
            ActKind::Call => ("Call", if a.allin { "Tapis" } else { "" }),
            ActKind::Bet => ("Bet", if a.allin { "Tapis" } else { bet_size(a.amount / pot.max(1e-9) * 100.0) }),
            ActKind::Raise => ("Raise", if a.allin { "Tapis" } else { "Relance" }),
            _ => continue,
        };
        pot += a.amount;
        if node.actor.is_empty() {
            node.actor = pos_label(r.f.players[a.p as usize].pos).into();
            node.street = a.street;
        }
        node = node.kids.entry(label.to_string()).or_default();
        if !size.is_empty() {
            let e = node.sizes.entry(size.to_string()).or_default();
            if subject {
                e.0 += 1;
            } else {
                e.1 += 1;
            }
        }
        add(node);
    }
}

/// Ajoute les comptes d'une base importée comme référence.
fn merge_file(b: &mut Build, t: &TNode) {
    b.r += t.n;
    for (k, v) in &t.sizes {
        b.sizes.entry(k.clone()).or_default().1 += v;
    }
    for (l, k) in &t.kids {
        merge_file(b.kids.entry(l.clone()).or_default(), k);
    }
}

const ORDER: [&str; 5] = ["Check", "Bet", "Call", "Raise", "Fold"];
const SIZES: [&str; 8] = ["⅓", "½", "¾", "Pot", "Overbet", "Relance", "Tapis", ""];

fn finish(b: Build, me_pos: &str) -> PNode {
    let mut kids: Vec<PEdge> = b
        .kids
        .into_iter()
        .map(|(label, mut k)| {
            let mut sizes: Vec<(String, u32, u32)> = std::mem::take(&mut k.sizes).into_iter().map(|(s, (n, r))| (s, n, r)).collect();
            sizes.sort_by_key(|x| SIZES.iter().position(|s| *s == x.0).unwrap_or(99));
            PEdge { label, sizes, node: finish(k, me_pos) }
        })
        .collect();
    kids.sort_by_key(|e| ORDER.iter().position(|x| *x == e.label).unwrap_or(99));
    PNode { street: b.street, subject: b.actor == me_pos, actor: b.actor, n: b.n, r: b.r, net: if b.n > 0 { b.net / b.n as f64 } else { 0.0 }, kids }
}

/// Arbre compact (comptes du sujet) pour l'export d'une base de référence.
pub fn to_tnode(p: &PNode, sizes: &[(String, u32, u32)]) -> TNode {
    TNode {
        n: p.n,
        sizes: sizes.iter().filter(|s| s.1 > 0).map(|s| (s.0.clone(), s.1)).collect(),
        kids: p.kids.iter().filter(|e| e.node.n >= 2).map(|e| (e.label.clone(), to_tnode(&e.node, &e.sizes))).collect(),
    }
}

/// Tous les duels possibles : (table, poste analysé, poste adverse).
pub const DUELS: [(&str, &str, &str); 8] = [
    ("3max", "BTN", "SB"),
    ("3max", "BTN", "BB"),
    ("3max", "SB", "BTN"),
    ("3max", "SB", "BB"),
    ("3max", "BB", "BTN"),
    ("3max", "BB", "SB"),
    ("hu", "SB", "BB"),
    ("hu", "BB", "SB"),
];

pub fn duel_key(table: &str, me: &str, opp: &str, pot: &str) -> String {
    format!("{table}|{me}|{opp}|{pot}")
}

/// `table` : "3max" | "hu" ; `me_pos` / `opp_pos` : "BTN" | "SB" | "BB" ;
/// `pot` : clé de `pot_key` (vide = le plus fréquent) ; `buckets` : tranches de tapis effectif.
#[allow(clippy::too_many_arguments)]
pub fn postflop_tree(s: &Store, player: &str, filter: &Filter, vs: &str, table: &str, me_pos: &str, opp_pos: &str, pot: &str, buckets: &[String], reference: &RefSel) -> PTree {
    let subject = Subject::parse(s, player);
    let sel: HashSet<usize> = filter.select(s).into_iter().collect();
    let bset: Vec<usize> = buckets.iter().filter_map(|b| BUCKETS.iter().position(|x| x.2 == b)).collect();
    // premier passage : duels retenus et types de pot
    let mut rows: Vec<(usize, usize, bool, String)> = Vec::new();
    let mut pots: BTreeMap<String, u32> = BTreeMap::new();
    for (hi, r) in s.hands.iter().enumerate() {
        if !sel.contains(&r.t) {
            continue;
        }
        let Some((me, opp)) = duel(r, table, me_pos, opp_pos) else { continue };
        if !bset.is_empty() && !bset.contains(&eff_bucket(r, me, opp)) {
            continue;
        }
        // le filtre « contre » porte sur l'adversaire du duel
        if !(vs.is_empty() || vs == "all") && !vs_one(s, r, opp, vs) {
            continue;
        }
        let is_subject = subject.seats(s, r, &sel).contains(&me);
        let Some(pk) = pot_key(r, me) else { continue };
        if is_subject {
            *pots.entry(pk.clone()).or_default() += 1;
        } else {
            // la référence exclut le héros ; groupe : seulement ses membres au poste analysé
            let name = &r.h.seats[me].name;
            let keep = match reference {
                RefSel::Population => !s.is_hero(name),
                RefSel::Set(set) => set.contains(name) && !s.is_hero(name),
                _ => false,
            };
            if !keep {
                continue;
            }
        }
        rows.push((hi, me, is_subject, pk));
    }
    let pot = if !pot.is_empty() && pots.contains_key(pot) {
        pot.to_string()
    } else {
        pots.iter().max_by_key(|(_, n)| **n).map(|(k, _)| k.clone()).unwrap_or_else(|| "srp:me".into())
    };
    let mut root = Build::default();
    let (mut hands, mut ref_hands) = (0, 0);
    for (hi, me, is_subject, pk) in &rows {
        if *pk != pot {
            continue;
        }
        if *is_subject {
            hands += 1;
        } else {
            ref_hands += 1;
        }
        walk(&mut root, &s.hands[*hi], *me, *is_subject);
    }
    if let RefSel::File(trees) = reference {
        if let Some(t) = trees.get(&duel_key(table, me_pos, opp_pos, &pot)) {
            ref_hands += t.n;
            merge_file(&mut root, t);
        }
    }
    let aggressor = match pot.split_once(':') {
        Some((_, "me")) => me_pos.to_string(),
        Some((_, "opp")) => opp_pos.to_string(),
        _ => String::new(),
    };
    let mut pv: Vec<PotOpt> = pots.into_iter().map(|(k, n)| PotOpt { label: pot_label(&k, me_pos, opp_pos), key: k, n }).collect();
    pv.sort_by(|a, b| b.n.cmp(&a.n));
    PTree { pots: pv, pot, aggressor, hands, ref_hands, root: finish(root, me_pos) }
}

/// Le joueur `i` correspond au filtre « contre ».
fn vs_one(s: &Store, r: &HandRec, i: usize, vs: &str) -> bool {
    let name = &r.h.seats[i].name;
    if vs == "hero" {
        s.is_hero(name)
    } else if let Some(tag) = vs.strip_prefix("tag:") {
        !s.is_hero(name) && s.tags_of(name).iter().any(|t| t == tag)
    } else if let Some(n) = vs.strip_prefix("player:") {
        name == n
    } else {
        true
    }
}
