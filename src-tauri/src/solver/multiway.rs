//! Moteur postflop à 3 joueurs (phase 4) : Discounted CFR vectoriel, arbre complet
//! flop → turn → river, tapis asymétriques (side pots), tailles des pots à 3 du cahier des
//! charges (33 / 55 / 100 % + all-in, relance 3× + all-in, fold).
//!
//! Retrait de cartes : exact entre le joueur évalué et chacun des deux adversaires, et avec le
//! board ; le retrait mutuel entre les deux adversaires n'est pas compté (sinon chaque abattage
//! coûte ~500 fois plus). L'écart est mesuré par un test contre une énumération exacte.

use crate::eval::eval;
use crate::model::{card_str, Card};
use crate::solver::ranges::{self, cell_of};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

pub const UNIT: f64 = 100.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MwConfig {
    pub board: String,
    /// pot au début de la street (bb)
    pub pot: f64,
    /// tapis restants (bb), dans l'ordre de parole postflop
    pub stacks: [f64; 3],
    pub ranges: [String; 3],
    pub labels: [String; 3],
    /// tailles de mise par street (% du pot)
    pub bet_sizes: [Vec<f64>; 3],
    pub raise_sizes: Vec<f64>,
    pub allin_threshold: f64,
    /// relances maximum par street avant « all-in seulement »
    pub max_raises: u32,
    pub precision: f64,
    pub max_iters: u32,
}

impl Default for MwConfig {
    fn default() -> Self {
        MwConfig {
            board: String::new(),
            pot: 3.0,
            stacks: [11.0, 11.0, 11.0],
            ranges: [String::new(), String::new(), String::new()],
            labels: ["SB".into(), "BB".into(), "BTN".into()],
            bet_sizes: [vec![33.0, 55.0, 100.0], vec![33.0, 55.0, 100.0], vec![33.0, 55.0, 100.0]],
            raise_sizes: vec![3.0],
            allin_threshold: 0.67,
            max_raises: 2,
            precision: 0.3,
            max_iters: 1000,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub enum Act {
    Fold,
    Check,
    Call,
    Bet(i32),
    Raise(i32),
    AllIn(i32),
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Kind {
    Player(u8),
    Chance,
    Terminal,
}

#[derive(Debug, Clone)]
struct Node {
    kind: Kind,
    /// cartes du board à ce nœud (3 à 5)
    board: [Card; 5],
    nboard: u8,
    actions: Vec<Act>,
    /// cartes distribuées par les enfants d'un nœud de hasard
    cards: Vec<Card>,
    children: Vec<u32>,
    /// mises totales postflop (unités) et joueurs couchés / à tapis
    contrib: [i32; 3],
    folded: [bool; 3],
    /// décalage dans le stockage des regrets / stratégies
    offset: usize,
}

#[derive(Clone)]
struct St {
    street_bet: [i32; 3],
    contrib: [i32; 3],
    folded: [bool; 3],
    allin: [bool; 3],
    acted: [bool; 3],
    raises: u32,
    to_act: usize,
}

pub struct Game {
    pub cfg: MwConfig,
    nodes: Vec<Node>,
    /// combos par joueur (hors board initial) et poids initiaux
    pub hands: [Vec<(Card, Card)>; 3],
    pub init: [Vec<f32>; 3],
    pot0: i32,
    stacks: [i32; 3],
    regrets: Vec<f32>,
    ssum: Vec<f32>,
    /// rangs des mains par board complet (5 cartes) : clé = masque du board
    ranks: parking_lot::Mutex<HashMap<u64, std::sync::Arc<[Vec<u32>; 3]>>>,
    pub iterations: u32,
}

struct SyncPtr(*mut f32);
unsafe impl Sync for SyncPtr {}
unsafe impl Send for SyncPtr {}

fn pct(p: f64, pot: i32) -> i32 {
    (pot as f64 * p / 100.0).round() as i32
}

impl Game {
    pub fn new(cfg: &MwConfig) -> Result<Game, String> {
        let board = ranges::parse_cards(&cfg.board)?;
        if !(3..=5).contains(&board.len()) {
            return Err("le board doit compter 3, 4 ou 5 cartes".into());
        }
        let bm = ranges::mask(&board);
        let mut hands: [Vec<(Card, Card)>; 3] = Default::default();
        let mut init: [Vec<f32>; 3] = Default::default();
        for p in 0..3 {
            let r = ranges::parse(&cfg.ranges[p])?;
            let c = ranges::combos(&r, bm);
            if c.is_empty() {
                return Err(format!("range vide pour {}", cfg.labels[p]));
            }
            hands[p] = c.iter().map(|x| (x.0, x.1)).collect();
            init[p] = c.iter().map(|x| x.2).collect();
        }
        let stacks = [
            (cfg.stacks[0] * UNIT).round() as i32,
            (cfg.stacks[1] * UNIT).round() as i32,
            (cfg.stacks[2] * UNIT).round() as i32,
        ];
        let mut g = Game {
            cfg: cfg.clone(),
            nodes: Vec::new(),
            hands,
            init,
            pot0: (cfg.pot * UNIT).round() as i32,
            stacks,
            regrets: Vec::new(),
            ssum: Vec::new(),
            ranks: parking_lot::Mutex::new(HashMap::new()),
            iterations: 0,
        };
        let mut b = [0u8; 5];
        b[..board.len()].copy_from_slice(&board);
        let st = St { street_bet: [0; 3], contrib: [0; 3], folded: [false; 3], allin: [stacks[0] <= 0, stacks[1] <= 0, stacks[2] <= 0], acted: [false; 3], raises: 0, to_act: 0 };
        g.grow(&st, b, board.len() as u8);
        Ok(g)
    }

    /// Mémoire nécessaire (octets) : regrets + stratégies cumulées.
    pub fn memory(&self) -> u64 {
        let mut n = 0u64;
        for nd in &self.nodes {
            if let Kind::Player(p) = nd.kind {
                n += (nd.actions.len() * self.hands[p as usize].len()) as u64;
            }
        }
        n * 8
    }

    pub fn allocate(&mut self) -> Result<(), String> {
        let mem = self.memory();
        if mem > crate::solver::MAX_MEMORY {
            return Err(format!("arbre à 3 joueurs trop gros : {:.1} Go (plafond 25 Go). Réduis les tailles ou les ranges.", mem as f64 / 1e9));
        }
        let mut off = 0usize;
        for i in 0..self.nodes.len() {
            if let Kind::Player(p) = self.nodes[i].kind {
                self.nodes[i].offset = off;
                off += self.nodes[i].actions.len() * self.hands[p as usize].len();
            }
        }
        self.regrets = vec![0.0; off];
        self.ssum = vec![0.0; off];
        Ok(())
    }

    fn pot_now(&self, st: &St) -> i32 {
        self.pot0 + st.contrib.iter().sum::<i32>()
    }

    fn next_player(&self, st: &St, from: usize) -> Option<usize> {
        let max = *st.street_bet.iter().max().unwrap();
        for k in 0..3 {
            let p = (from + k) % 3;
            if st.folded[p] || st.allin[p] {
                continue;
            }
            if !st.acted[p] || st.street_bet[p] < max {
                return Some(p);
            }
        }
        None
    }

    fn push(&mut self, kind: Kind, st: &St, board: [Card; 5], nboard: u8) -> usize {
        self.nodes.push(Node { kind, board, nboard, actions: vec![], cards: vec![], children: vec![], contrib: st.contrib, folded: st.folded, offset: 0 });
        self.nodes.len() - 1
    }

    fn grow(&mut self, st: &St, board: [Card; 5], nboard: u8) -> usize {
        let alive = st.folded.iter().filter(|f| !**f).count();
        if alive <= 1 {
            return self.push(Kind::Terminal, st, board, nboard);
        }
        match self.next_player(st, st.to_act) {
            Some(p) => self.grow_player(st, p, board, nboard),
            None => {
                // fin de street
                let can_bet = (0..3).filter(|&i| !st.folded[i] && !st.allin[i]).count();
                if nboard == 5 {
                    return self.push(Kind::Terminal, st, board, nboard);
                }
                let mut ns = st.clone();
                ns.street_bet = [0; 3];
                ns.acted = [false; 3];
                ns.raises = 0;
                ns.to_act = 0;
                if can_bet <= 1 {
                    // plus de décision possible : tous les runouts jusqu'à la river
                    ns.acted = [true; 3];
                }
                let id = self.push(Kind::Chance, st, board, nboard);
                let used: u64 = board[..nboard as usize].iter().fold(0u64, |m, &c| m | 1u64 << c);
                let cards: Vec<Card> = (0..52u8).filter(|c| used & (1u64 << c) == 0).collect();
                let mut ch = Vec::with_capacity(cards.len());
                for &c in &cards {
                    let mut b = board;
                    b[nboard as usize] = c;
                    ch.push(self.grow(&ns, b, nboard + 1) as u32);
                }
                self.nodes[id].cards = cards;
                self.nodes[id].children = ch;
                id
            }
        }
    }

    fn grow_player(&mut self, st: &St, p: usize, board: [Card; 5], nboard: u8) -> usize {
        let max = *st.street_bet.iter().max().unwrap();
        let to_call = max - st.street_bet[p];
        let rem = self.stacks[p] - st.contrib[p];
        let pot = self.pot_now(st);
        let others_can_bet = (0..3).any(|i| i != p && !st.folded[i] && !st.allin[i]);
        let mut acts = Vec::new();
        if to_call > 0 {
            acts.push(Act::Fold);
            acts.push(Act::Call);
        } else {
            acts.push(Act::Check);
        }
        let allin_to = st.street_bet[p] + rem;
        if rem > to_call && others_can_bet {
            let thr = (self.cfg.allin_threshold * (st.contrib[p] + rem) as f64) as i32;
            let street = (nboard - 3) as usize;
            let mut sizes: Vec<i32> = Vec::new();
            if to_call == 0 {
                for &b in &self.cfg.bet_sizes[street] {
                    sizes.push(pct(b, pot));
                }
            } else if st.raises < self.cfg.max_raises {
                for &r in &self.cfg.raise_sizes {
                    sizes.push((max as f64 * r).round() as i32);
                }
            }
            sizes.sort_unstable();
            sizes.dedup();
            for to in sizes {
                let add = to - st.street_bet[p];
                let min_ok = if to_call == 0 { to >= 100.min(allin_to) } else { to >= 2 * max };
                if add > 0 && to < allin_to && st.contrib[p] + add < thr && min_ok {
                    acts.push(if to_call == 0 { Act::Bet(to) } else { Act::Raise(to) });
                }
            }
            acts.push(Act::AllIn(allin_to));
        }
        let id = self.push(Kind::Player(p as u8), st, board, nboard);
        let mut ch = Vec::with_capacity(acts.len());
        for &a in &acts {
            let mut s = st.clone();
            s.acted[p] = true;
            s.to_act = (p + 1) % 3;
            match a {
                Act::Fold => s.folded[p] = true,
                Act::Check => {}
                Act::Call => {
                    let add = to_call.min(rem);
                    s.street_bet[p] += add;
                    s.contrib[p] += add;
                }
                Act::Bet(to) | Act::Raise(to) | Act::AllIn(to) => {
                    let add = to - s.street_bet[p];
                    s.street_bet[p] = to;
                    s.contrib[p] += add;
                    if to > max {
                        s.raises += if max > 0 { 1 } else { 0 };
                        for i in 0..3 {
                            if i != p {
                                s.acted[i] = false;
                            }
                        }
                    }
                }
            }
            if self.stacks[p] - s.contrib[p] <= 0 {
                s.allin[p] = true;
            }
            ch.push(self.grow(&s, board, nboard) as u32);
        }
        self.nodes[id].actions = acts;
        self.nodes[id].children = ch;
        id
    }

    fn board_ranks(&self, board: &[Card; 5]) -> std::sync::Arc<[Vec<u32>; 3]> {
        let key = board.iter().fold(0u64, |m, &c| m | 1u64 << c);
        if let Some(r) = self.ranks.lock().get(&key) {
            return r.clone();
        }
        let mut out: [Vec<u32>; 3] = Default::default();
        let mut cards = [0u8; 7];
        cards[2..].copy_from_slice(board);
        for p in 0..3 {
            out[p] = self.hands[p]
                .iter()
                .map(|&(a, b)| {
                    if key & (1u64 << a | 1u64 << b) != 0 {
                        0
                    } else {
                        cards[0] = a;
                        cards[1] = b;
                        eval(&cards) + 1
                    }
                })
                .collect();
        }
        let arc = std::sync::Arc::new(out);
        self.ranks.lock().insert(key, arc.clone());
        arc
    }

    /// Pour chaque main x du joueur i : masses adverses (retrait de cartes avec x) des mains de j
    /// strictement plus faibles, égales et totales, sur un board complet.
    fn lower_equal(&self, i: usize, j: usize, ranks: &[Vec<u32>; 3], reach_j: &[f32]) -> (Vec<f64>, Vec<f64>, Vec<f64>) {
        let hi = &self.hands[i];
        let hj = &self.hands[j];
        let ri = &ranks[i];
        let rj = &ranks[j];
        let n = hi.len();
        // total et par carte
        let mut tot = 0.0f64;
        let mut tot_c = [0.0f64; 52];
        for (y, &(a, b)) in hj.iter().enumerate() {
            let w = reach_j[y] as f64;
            if w == 0.0 || rj[y] == 0 {
                continue;
            }
            tot += w;
            tot_c[a as usize] += w;
            tot_c[b as usize] += w;
        }
        // combo identique (mêmes deux cartes) chez j
        let mut same = vec![0.0f64; n];
        {
            let mut idx: HashMap<(Card, Card), usize> = HashMap::with_capacity(hj.len());
            for (y, &(a, b)) in hj.iter().enumerate() {
                idx.insert((a.max(b), a.min(b)), y);
            }
            for (x, &(a, b)) in hi.iter().enumerate() {
                if let Some(&y) = idx.get(&(a.max(b), a.min(b))) {
                    if rj[y] != 0 {
                        same[x] = reach_j[y] as f64;
                    }
                }
            }
        }
        let mut oi: Vec<usize> = (0..n).filter(|&x| ri[x] != 0).collect();
        oi.sort_unstable_by_key(|&x| ri[x]);
        let mut oj: Vec<usize> = (0..hj.len()).filter(|&y| rj[y] != 0 && reach_j[y] != 0.0).collect();
        oj.sort_unstable_by_key(|&y| rj[y]);
        let mut low = vec![0.0f64; n];
        let mut eq = vec![0.0f64; n];
        let mut all = vec![0.0f64; n];
        let (mut l, mut lc) = (0.0f64, [0.0f64; 52]);
        let mut p = 0;
        let mut k = 0;
        while k < oi.len() {
            let r = ri[oi[k]];
            while p < oj.len() && rj[oj[p]] < r {
                let y = oj[p];
                let (a, b) = hj[y];
                let w = reach_j[y] as f64;
                l += w;
                lc[a as usize] += w;
                lc[b as usize] += w;
                p += 1;
            }
            let (mut e, mut ec) = (0.0f64, [0.0f64; 52]);
            let mut q = p;
            while q < oj.len() && rj[oj[q]] == r {
                let y = oj[q];
                let (a, b) = hj[y];
                let w = reach_j[y] as f64;
                e += w;
                ec[a as usize] += w;
                ec[b as usize] += w;
                q += 1;
            }
            while k < oi.len() && ri[oi[k]] == r {
                let x = oi[k];
                let (a, b) = (hi[x].0 as usize, hi[x].1 as usize);
                low[x] = l - lc[a] - lc[b];
                eq[x] = e - ec[a] - ec[b] + same[x];
                all[x] = tot - tot_c[a] - tot_c[b] + same[x];
                k += 1;
            }
        }
        (low, eq, all)
    }

    /// Masse adverse (retrait de cartes avec chaque main de i) sans condition de rang.
    fn mass_vs(&self, i: usize, j: usize, reach_j: &[f32], board_mask: u64) -> Vec<f64> {
        let hj = &self.hands[j];
        let mut tot = 0.0f64;
        let mut tc = [0.0f64; 52];
        let mut idx: HashMap<(Card, Card), f64> = HashMap::with_capacity(hj.len());
        for (y, &(a, b)) in hj.iter().enumerate() {
            if board_mask & (1u64 << a | 1u64 << b) != 0 {
                continue;
            }
            let w = reach_j[y] as f64;
            tot += w;
            tc[a as usize] += w;
            tc[b as usize] += w;
            idx.insert((a.max(b), a.min(b)), w);
        }
        self.hands[i]
            .iter()
            .map(|&(a, b)| {
                if board_mask & (1u64 << a | 1u64 << b) != 0 {
                    return 0.0;
                }
                tot - tc[a as usize] - tc[b as usize] + idx.get(&(a.max(b), a.min(b))).copied().unwrap_or(0.0)
            })
            .collect()
    }

    fn terminal(&self, nd: &Node, i: usize, reach: &[Vec<f32>; 3]) -> Vec<f64> {
        let (j, k) = match i {
            0 => (1, 2),
            1 => (0, 2),
            _ => (0, 1),
        };
        let bm: u64 = nd.board[..nd.nboard as usize].iter().fold(0u64, |m, &c| m | 1u64 << c);
        let n = self.hands[i].len();
        let c = nd.contrib;
        let pot = self.pot0 + c.iter().sum::<i32>();
        let alive: Vec<usize> = (0..3).filter(|&p| !nd.folded[p]).collect();
        let blocked = |x: usize| {
            let (a, b) = self.hands[i][x];
            bm & (1u64 << a | 1u64 << b) != 0
        };
        if nd.folded[i] || alive.len() == 1 {
            let u = if nd.folded[i] { -c[i] } else { pot - c[i] } as f64;
            let mj = self.mass_vs(i, j, &reach[j], bm);
            let mk = self.mass_vs(i, k, &reach[k], bm);
            return (0..n).map(|x| if blocked(x) { 0.0 } else { u * mj[x] * mk[x] }).collect();
        }
        // abattage (river) : couches de side pots entre joueurs vivants
        debug_assert!(nd.nboard == 5);
        let ranks = self.board_ranks(&nd.board);
        let (lj, ej, tj) = self.lower_equal(i, j, &ranks, &reach[j]);
        let (lk, ek, tk) = self.lower_equal(i, k, &ranks, &reach[k]);
        let mut levels: Vec<i32> = alive.iter().map(|&p| c[p]).collect();
        levels.sort_unstable();
        levels.dedup();
        let mut out = vec![0.0f64; n];
        for x in 0..n {
            if ranks[i][x] == 0 {
                continue;
            }
            let mass = tj[x] * tk[x];
            let mut won = 0.0f64;
            let mut prev = 0;
            for (li, &lv) in levels.iter().enumerate() {
                let mut layer: f64 = (0..3).map(|p| ((c[p].min(lv) - prev).max(0)) as f64).sum();
                if li == 0 {
                    layer += self.pot0 as f64;
                }
                prev = lv;
                if c[i] < lv {
                    continue;
                }
                let je = !nd.folded[j] && c[j] >= lv;
                let ke = !nd.folded[k] && c[k] >= lv;
                let share = match (je, ke) {
                    (false, false) => mass,
                    (true, false) => (lj[x] + 0.5 * ej[x]) * tk[x],
                    (false, true) => (lk[x] + 0.5 * ek[x]) * tj[x],
                    (true, true) => lj[x] * lk[x] + 0.5 * (ej[x] * lk[x] + lj[x] * ek[x]) + ej[x] * ek[x] / 3.0,
                };
                won += layer * share;
            }
            // mises des couchés au-delà du dernier niveau vivant : au meilleur vivant
            let extra: f64 = (0..3).map(|p| ((c[p] - prev).max(0)) as f64).sum();
            if extra > 0.0 {
                let je = !nd.folded[j];
                let ke = !nd.folded[k];
                let share = match (je, ke) {
                    (false, false) => mass,
                    (true, false) => (lj[x] + 0.5 * ej[x]) * tk[x],
                    (false, true) => (lk[x] + 0.5 * ek[x]) * tj[x],
                    (true, true) => lj[x] * lk[x] + 0.5 * (ej[x] * lk[x] + lj[x] * ek[x]) + ej[x] * ek[x] / 3.0,
                };
                won += extra * share;
            }
            out[x] = won - c[i] as f64 * mass;
        }
        out
    }

    fn strategy_at(&self, nd: &Node, p: usize, sum: bool) -> Vec<f32> {
        let na = nd.actions.len();
        let nh = self.hands[p].len();
        let src = if sum { &self.ssum } else { &self.regrets };
        let r = &src[nd.offset..nd.offset + na * nh];
        let mut s = vec![0f32; na * nh];
        for h in 0..nh {
            let tot: f32 = (0..na).map(|a| if sum { r[a * nh + h] } else { r[a * nh + h].max(0.0) }).sum();
            for a in 0..na {
                let v = if sum { r[a * nh + h] } else { r[a * nh + h].max(0.0) };
                s[a * nh + h] = if tot > 0.0 { v / tot } else { 1.0 / na as f32 };
            }
        }
        s
    }

    /// Parcours : valeurs contrefactuelles de i. `mode` 0 = mise à jour CFR, 1 = évaluation avec la
    /// stratégie moyenne, 2 = meilleure réponse de i.
    fn walk(&self, id: usize, i: usize, reach: &[Vec<f32>; 3], t: f64, mode: u8, rg: &SyncPtr, ss: &SyncPtr) -> Vec<f64> {
        let nd = &self.nodes[id];
        match nd.kind {
            Kind::Terminal => self.terminal(nd, i, reach),
            Kind::Chance => {
                let nh = self.hands[i].len();
                let res: Vec<Vec<f64>> = nd
                    .children
                    .par_iter()
                    .zip(nd.cards.par_iter())
                    .map(|(&ch, &c)| {
                        let mut r2 = reach.clone();
                        for p in 0..3 {
                            for (h, &(a, b)) in self.hands[p].iter().enumerate() {
                                if a == c || b == c {
                                    r2[p][h] = 0.0;
                                }
                            }
                        }
                        let mut v = self.walk(ch as usize, i, &r2, t, mode, rg, ss);
                        for (h, &(a, b)) in self.hands[i].iter().enumerate() {
                            if a == c || b == c {
                                v[h] = 0.0;
                            }
                        }
                        v
                    })
                    .collect();
                // chaque carte a la même probabilité, retirée des mains déjà distribuées
                let norm = (52 - nd.nboard as usize - 6) as f64;
                let mut out = vec![0f64; nh];
                for v in res {
                    for h in 0..nh {
                        out[h] += v[h];
                    }
                }
                out.iter_mut().for_each(|x| *x /= norm);
                out
            }
            Kind::Player(p) => {
                let p = p as usize;
                let na = nd.actions.len();
                let nh = self.hands[p].len();
                let sigma = self.strategy_at(nd, p, mode != 0);
                if p == i {
                    let vals: Vec<Vec<f64>> = nd.children.iter().map(|&c| self.walk(c as usize, i, reach, t, mode, rg, ss)).collect();
                    let mut v = vec![0f64; nh];
                    if mode == 2 {
                        for h in 0..nh {
                            v[h] = (0..na).map(|a| vals[a][h]).fold(f64::MIN, f64::max);
                        }
                        return v;
                    }
                    for a in 0..na {
                        for h in 0..nh {
                            v[h] += sigma[a * nh + h] as f64 * vals[a][h];
                        }
                    }
                    if mode == 0 {
                        let pos = t.powf(1.5) / (t.powf(1.5) + 1.0);
                        let neg = 0.5;
                        let sw = (t / (t + 1.0)).powi(2);
                        // SAFETY : chaque nœud n'est mis à jour que par son propre parcours
                        unsafe {
                            for a in 0..na {
                                for h in 0..nh {
                                    let k = nd.offset + a * nh + h;
                                    let r = rg.0.add(k);
                                    let d = if *r > 0.0 { pos } else { neg };
                                    *r = (*r as f64 * d + vals[a][h] - v[h]) as f32;
                                    let s = ss.0.add(k);
                                    *s = (*s as f64 * sw + reach[i][h] as f64 * sigma[a * nh + h] as f64) as f32;
                                }
                            }
                        }
                    }
                    v
                } else {
                    let mut v = vec![0f64; self.hands[i].len()];
                    for (a, &c) in nd.children.iter().enumerate() {
                        let mut r2 = reach.clone();
                        for h in 0..nh {
                            r2[p][h] *= sigma[a * nh + h];
                        }
                        let x = self.walk(c as usize, i, &r2, t, mode, rg, ss);
                        for h in 0..v.len() {
                            v[h] += x[h];
                        }
                    }
                    v
                }
            }
        }
    }

    pub fn step(&mut self) {
        self.iterations += 1;
        let t = self.iterations as f64;
        let rg = SyncPtr(self.regrets.as_mut_ptr());
        let ss = SyncPtr(self.ssum.as_mut_ptr());
        let reach = self.init.clone();
        for i in 0..3 {
            self.walk(0, i, &reach, t, 0, &rg, &ss);
        }
    }

    /// Normalisation : masse totale des donnes pour le joueur i.
    fn total_mass(&self, i: usize) -> f64 {
        let (j, k) = match i {
            0 => (1, 2),
            1 => (0, 2),
            _ => (0, 1),
        };
        let nd = &self.nodes[0];
        let bm: u64 = nd.board[..nd.nboard as usize].iter().fold(0u64, |m, &c| m | 1u64 << c);
        let mj = self.mass_vs(i, j, &self.init[j], bm);
        let mk = self.mass_vs(i, k, &self.init[k], bm);
        (0..self.hands[i].len()).map(|x| self.init[i][x] as f64 * mj[x] * mk[x]).sum()
    }

    /// (EV de chaque joueur en bb, exploitabilité en % du pot de départ)
    pub fn exploitability(&self) -> ([f64; 3], f64) {
        let rg = SyncPtr(std::ptr::null_mut());
        let ss = SyncPtr(std::ptr::null_mut());
        let mut evs = [0.0; 3];
        let mut ex = 0.0;
        for i in 0..3 {
            let tm = self.total_mass(i);
            let cur = self.walk(0, i, &self.init, 1.0, 1, &rg, &ss);
            let br = self.walk(0, i, &self.init, 1.0, 2, &rg, &ss);
            let e: f64 = (0..cur.len()).map(|x| self.init[i][x] as f64 * cur[x]).sum::<f64>() / tm;
            let b: f64 = (0..br.len()).map(|x| self.init[i][x] as f64 * br[x]).sum::<f64>() / tm;
            evs[i] = e / UNIT;
            ex += (b - e).max(0.0);
        }
        (evs, ex / self.pot0 as f64 * 100.0)
    }

    pub fn solve(&mut self, cancel: &AtomicBool, progress: &dyn Fn(u32, Option<f64>)) -> f64 {
        let mut ex = f64::NAN;
        for _ in 0..self.cfg.max_iters {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            self.step();
            if self.iterations % 10 == 0 {
                ex = self.exploitability().1;
                progress(self.iterations, Some(ex));
                if ex <= self.cfg.precision {
                    break;
                }
            } else {
                progress(self.iterations, None);
            }
        }
        if ex.is_nan() {
            ex = self.exploitability().1;
        }
        ex
    }

    /// Vue d'un nœud pour l'interface (mêmes champs que la vue tête-à-tête, 3 joueurs).
    pub fn view(&self, history: &[usize]) -> Result<Value, String> {
        let mut id = 0usize;
        let mut reach = self.init.clone();
        for &a in history {
            let nd = &self.nodes[id];
            match nd.kind {
                Kind::Terminal => return Err("chemin invalide".into()),
                Kind::Chance => {
                    let k = nd.cards.iter().position(|&c| c as usize == a).ok_or("carte impossible")?;
                    for p in 0..3 {
                        for (h, &(x, y)) in self.hands[p].iter().enumerate() {
                            if x as usize == a || y as usize == a {
                                reach[p][h] = 0.0;
                            }
                        }
                    }
                    id = nd.children[k] as usize;
                }
                Kind::Player(p) => {
                    let p = p as usize;
                    if a >= nd.actions.len() {
                        return Err("action inconnue".into());
                    }
                    let s = self.strategy_at(nd, p, true);
                    let nh = self.hands[p].len();
                    for h in 0..nh {
                        reach[p][h] *= s[a * nh + h];
                    }
                    id = nd.children[a] as usize;
                }
            }
        }
        let nd = &self.nodes[id];
        let pot = self.pot0 + nd.contrib.iter().sum::<i32>();
        let board: Vec<String> = nd.board[..nd.nboard as usize].iter().map(|&c| card_str(c)).collect();
        let stacks: Vec<f64> = (0..3).map(|p| (self.stacks[p] - nd.contrib[p]) as f64 / UNIT).collect();
        let mut v = json!({ "board": board, "pot": pot as f64 / UNIT, "stacks": stacks, "labels": self.cfg.labels, "folded": nd.folded, "multiway": true });
        match nd.kind {
            Kind::Terminal => {
                v["terminal"] = json!(true);
            }
            Kind::Chance => {
                v["chance"] = json!(true);
                v["cards"] = json!(nd.cards.iter().map(|&c| json!({"id": c, "card": card_str(c)})).collect::<Vec<_>>());
            }
            Kind::Player(p) => {
                let p = p as usize;
                let na = nd.actions.len();
                let nh = self.hands[p].len();
                let strat = self.strategy_at(nd, p, true);
                // EV de chaque action (bb par main) : valeurs des enfants divisées par la masse adverse
                let rg = SyncPtr(std::ptr::null_mut());
                let (j, k) = match p {
                    0 => (1, 2),
                    1 => (0, 2),
                    _ => (0, 1),
                };
                let bm: u64 = nd.board[..nd.nboard as usize].iter().fold(0u64, |m, &c| m | 1u64 << c);
                let mj = self.mass_vs(p, j, &reach[j], bm);
                let mk = self.mass_vs(p, k, &reach[k], bm);
                let vals: Vec<Vec<f64>> = nd.children.iter().map(|&c| self.walk(c as usize, p, &reach, 1.0, 1, &rg, &rg)).collect();
                let tot: f64 = (0..nh).map(|h| reach[p][h] as f64).sum();
                let mut freq = vec![0f64; na];
                let mut grid_w = vec![0f64; 169];
                let mut grid_s = vec![vec![0f64; na]; 169];
                let mut grid_ev = vec![0f64; 169];
                let mut hands = Vec::new();
                for h in 0..nh {
                    let (a, b) = self.hands[p][h];
                    if bm & (1u64 << a | 1u64 << b) != 0 {
                        continue;
                    }
                    let w = reach[p][h] as f64;
                    let m = mj[h] * mk[h];
                    let evs: Vec<f64> = (0..na).map(|x| if m > 0.0 { vals[x][h] / m / UNIT } else { 0.0 }).collect();
                    let s: Vec<f64> = (0..na).map(|x| strat[x * nh + h] as f64).collect();
                    let ev: f64 = s.iter().zip(&evs).map(|(x, y)| x * y).sum();
                    if w > 0.0 {
                        let cell = cell_of(a, b);
                        grid_w[cell] += w;
                        grid_ev[cell] += w * ev;
                        for x in 0..na {
                            freq[x] += w * s[x];
                            grid_s[cell][x] += w * s[x];
                        }
                        hands.push(json!({ "combo": ranges::combo_name(a, b), "cell": cell, "weight": w, "norm": w, "strategy": s, "evs": evs, "ev": ev, "equity": null, "eqr": null }));
                    }
                }
                if tot > 0.0 {
                    freq.iter_mut().for_each(|f| *f /= tot);
                }
                let grid: Vec<Value> = (0..169)
                    .map(|c| if grid_w[c] <= 0.0 { Value::Null } else { json!({ "w": grid_w[c], "s": grid_s[c].iter().map(|x| x / grid_w[c]).collect::<Vec<_>>(), "ev": grid_ev[c] / grid_w[c], "eq": 0.0 }) })
                    .collect();
                let acts: Vec<Value> = nd
                    .actions
                    .iter()
                    .map(|a| match *a {
                        Act::Fold => json!({"kind": "fold", "label": "Fold"}),
                        Act::Check => json!({"kind": "check", "label": "Check"}),
                        Act::Call => json!({"kind": "call", "label": "Call"}),
                        Act::Bet(x) => {
                            let pr = x as f64 / pot as f64 * 100.0;
                            json!({"kind": "bet", "label": format!("Bet {}%", pr.round()), "amount": x as f64 / UNIT, "pct": pr})
                        }
                        Act::Raise(x) => json!({"kind": "raise", "label": format!("Raise {}", x as f64 / UNIT), "amount": x as f64 / UNIT}),
                        Act::AllIn(x) => json!({"kind": "allin", "label": "All-in", "amount": x as f64 / UNIT}),
                    })
                    .collect();
                v["player"] = json!(p);
                v["actions"] = json!(acts);
                v["freq"] = json!(freq);
                v["grid"] = json!(grid);
                v["hands"] = json!(hands);
            }
        }
        Ok(v)
    }

    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(board: &str, ranges: [&str; 3], stacks: [f64; 3]) -> MwConfig {
        MwConfig {
            board: board.into(),
            pot: 3.0,
            stacks,
            ranges: [ranges[0].into(), ranges[1].into(), ranges[2].into()],
            bet_sizes: [vec![50.0], vec![50.0], vec![50.0]],
            raise_sizes: vec![],
            precision: 0.5,
            max_iters: 2000,
            ..Default::default()
        }
    }

    /// River à 3, tapis égaux : convergence, somme nulle des gains (hors pot de départ).
    #[test]
    fn river_three_way_converges() {
        let c = cfg("Ks9d6h3c2s", ["AA,KK,99,AK,KQ,QJ,JT,T8", "AK,KQ,KJ,QQ,JJ,T9,87", "A9,K9,99,66,33,QT,54"], [10.0, 10.0, 10.0]);
        let mut g = Game::new(&c).unwrap();
        g.allocate().unwrap();
        let cancel = AtomicBool::new(false);
        let ex = g.solve(&cancel, &|_, _| {});
        let (evs, _) = g.exploitability();
        println!("exploitabilité {ex:.3} % du pot, EV {evs:?}");
        assert!(ex <= 0.5, "{ex}");
        // les EV (gains nets postflop, pot de départ inclus) somment au pot de départ, aux
        // effets de retrait de cartes entre adversaires près
        let s: f64 = evs.iter().sum();
        assert!((s - 3.0).abs() < 0.15, "somme {s}");
    }

    /// Side pot : un joueur court à tapis, les deux autres profonds.
    #[test]
    fn river_side_pot_runs() {
        let c = cfg("Ks9d6h3c2s", ["AA,KK,AK,KQ,QJ", "AK,KQ,QQ,JJ,T9", "A9,K9,99,QT,54"], [2.0, 10.0, 10.0]);
        let mut g = Game::new(&c).unwrap();
        g.allocate().unwrap();
        let cancel = AtomicBool::new(false);
        let ex = g.solve(&cancel, &|_, _| {});
        assert!(ex <= 0.5, "{ex}");
    }
}
