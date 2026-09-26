//! Discounted CFR sur l'arbre préflop, stratégies par classe de main (169).
//!
//! Poids de chance : en tête-à-tête `cnt[h][v]` (retrait de cartes exact) ; à 3 joueurs
//! `c3(h, v, w)` exact, y compris quand un joueur a couché (ses cartes restent retirées).
//! Valeurs terminales :
//! - fold : pot au dernier vivant ;
//! - abattage (plus personne ne peut miser) : équité exacte, side pots à 3 ;
//! - flop : modèle `FlopModel` issu des solves postflop (lignes à deux) si présent, sinon partage
//!   du pot à l'équité (modèle de départ, et lignes à trois tant que le moteur multiway manque).

use super::classes::{hu, ncombos, HuTables, N};
use super::tree::{Node, Term, Tree};
use super::tri::{payoff, TriTables, RANKS};
use rayon::prelude::*;
use std::collections::HashMap;

const ALPHA: f64 = 1.5;
const BETA: f64 = 0.5;
const GAMMA: f64 = 2.0;

/// Valeur postflop d'une ligne à deux, à somme nulle par construction.
///
/// Les solves postflop donnent V_p(h), la part du pot finale de chaque classe face à la range
/// adverse de référence. On en tire un bonus de réalisation R_p(h) = V_p(h) − pot × équité(h)
/// et le gain de la paire (h, v) : pot × eq(h, v) + R_a(h) − R_b(v) + K_a, avec K_a = E_ref[R_b].
/// Aux ranges de référence on retrouve exactement V_p ; pour d'autres ranges le jeu reste à
/// somme nulle (le pot est toujours conservé).
#[derive(Clone)]
pub struct FlopModel {
    pub players: [usize; 2],
    pub r: [Vec<f32>; 2],
    pub k: [f64; 2],
}

pub struct Solver<'a> {
    pub tree: Tree,
    pub n: usize,
    hu: &'static HuTables,
    tri: Option<&'a TriTables>,
    regrets: Vec<Vec<f32>>,
    ssum: Vec<Vec<f32>>,
    /// gains à 3 vivants pré-calculés : nœud -> joueur -> c3 × E[gain] sur (h, v, w)
    u3: HashMap<usize, Vec<Vec<f32>>>,
    /// modèle postflop issu des solves : nœud flop à deux -> bonus de réalisation
    pub flop_models: HashMap<usize, FlopModel>,
    pub iterations: u32,
}

fn nact(node: &Node) -> usize {
    match node {
        Node::Decision { actions, .. } => actions.len(),
        _ => 0,
    }
}

impl<'a> Solver<'a> {
    pub fn new(tree: Tree, tri: Option<&'a TriTables>) -> Result<Solver<'a>, String> {
        let n = tree.cfg.stacks.len();
        if n == 3 && tri.is_none() {
            return Err("tables à 3 joueurs manquantes".into());
        }
        let regrets: Vec<Vec<f32>> = tree.nodes.iter().map(|nd| vec![0f32; nact(nd) * N]).collect();
        let ssum = regrets.clone();
        let mut s = Solver { tree, n, hu: hu(), tri, regrets, ssum, u3: HashMap::new(), flop_models: HashMap::new(), iterations: 0 };
        if n == 3 {
            s.prepare_u3();
        }
        Ok(s)
    }

    /// Gains des terminaux où les trois joueurs sont encore vivants (side pots compris).
    fn prepare_u3(&mut self) {
        let tri = self.tri.unwrap();
        let dead = self.tree.dead;
        for (id, nd) in self.tree.nodes.iter().enumerate() {
            let Node::Terminal { term, contrib, alive, .. } = nd else { continue };
            if *term == Term::Fold || alive.iter().filter(|a| **a).count() < 3 {
                continue;
            }
            let pays: Vec<[f64; 3]> = RANKS.iter().map(|r| payoff(*r, contrib, alive, dead)).collect();
            let per: Vec<Vec<f32>> = (0..3)
                .map(|i| {
                    let mut t = vec![0f32; N * N * N];
                    t.par_chunks_mut(N * N).enumerate().for_each(|(h, slab)| {
                        for v in 0..N {
                            for w in 0..N {
                                // ordre (i, j, k) -> ordre des joueurs 0, 1, 2
                                let (j, k) = others(i);
                                let mut cls = [0usize; 3];
                                cls[i] = h;
                                cls[j] = v;
                                cls[k] = w;
                                let pr = tri.probs(cls[0], cls[1], cls[2]);
                                let e: f64 = pr.iter().zip(&pays).map(|(p, g)| *p as f64 * g[i]).sum();
                                slab[v * N + w] = tri.c3(h, v, w) * e as f32;
                            }
                        }
                    });
                    t
                })
                .collect();
            self.u3.insert(id, per);
        }
    }

    fn strategy(&self, node: usize) -> Vec<f32> {
        let na = nact(&self.tree.nodes[node]);
        let r = &self.regrets[node];
        let mut s = vec![0f32; na * N];
        for h in 0..N {
            let tot: f32 = (0..na).map(|a| r[a * N + h].max(0.0)).sum();
            for a in 0..na {
                s[a * N + h] = if tot > 0.0 { r[a * N + h].max(0.0) / tot } else { 1.0 / na as f32 };
            }
        }
        s
    }

    pub fn average(&self, node: usize) -> Vec<f32> {
        let na = nact(&self.tree.nodes[node]);
        let r = &self.ssum[node];
        let mut s = vec![0f32; na * N];
        for h in 0..N {
            let tot: f32 = (0..na).map(|a| r[a * N + h]).sum();
            for a in 0..na {
                s[a * N + h] = if tot > 0.0 { r[a * N + h] / tot } else { 1.0 / na as f32 };
            }
        }
        s
    }

    /// Masse de chance adverse pour chaque classe du joueur i (poids × atteintes adverses).
    fn mass(&self, i: usize, reach: &[Vec<f32>]) -> Vec<f64> {
        if self.n == 2 {
            let j = 1 - i;
            (0..N).map(|h| (0..N).map(|v| reach[j][v] as f64 * self.hu.cnt[h][v] as f64).sum()).collect()
        } else {
            let tri = self.tri.unwrap();
            let (j, k) = others(i);
            (0..N)
                .into_par_iter()
                .map(|h| {
                    let mut s = 0.0f64;
                    for v in 0..N {
                        if reach[j][v] == 0.0 {
                            continue;
                        }
                        let mut inner = 0.0f32;
                        for w in 0..N {
                            inner += reach[k][w] * tri.c3(h, v, w);
                        }
                        s += reach[j][v] as f64 * inner as f64;
                    }
                    s
                })
                .collect()
        }
    }

    /// Valeurs contrefactuelles du joueur i à un terminal.
    fn terminal(&self, id: usize, i: usize, reach: &[Vec<f32>]) -> Vec<f64> {
        let Node::Terminal { term, contrib, alive, pot, .. } = &self.tree.nodes[id] else { unreachable!() };
        let c_i = contrib[i];
        let n_alive = alive.iter().filter(|a| **a).count();
        if !alive[i] || *term == Term::Fold {
            let u = if alive[i] { pot - c_i } else { -c_i };
            return self.mass(i, reach).into_iter().map(|m| m * u).collect();
        }
        // modèle postflop issu des solves (lignes à deux)
        let model = if *term == Term::Flop { self.flop_models.get(&id).filter(|m| m.players.contains(&i)) } else { None };
        if let Some(m) = model {
            let me = if m.players[0] == i { 0 } else { 1 };
            let (ri, ro, k) = (&m.r[me], &m.r[1 - me], m.k[me]);
            let o = m.players[1 - me];
            let pair = |h: usize, v: usize| self.hu.eq[h][v] as f64 * pot + ri[h] as f64 - ro[v] as f64 + k - c_i;
            if self.n == 2 {
                return (0..N).map(|h| (0..N).map(|v| reach[o][v] as f64 * self.hu.cnt[h][v] as f64 * pair(h, v)).sum()).collect();
            }
            let tri = self.tri.unwrap();
            let f = (0..3).find(|&x| x != i && x != o).unwrap();
            return (0..N)
                .into_par_iter()
                .map(|h| {
                    let mut s = 0.0f64;
                    for v in 0..N {
                        if reach[o][v] == 0.0 {
                            continue;
                        }
                        let mut w = 0.0f32;
                        for x in 0..N {
                            w += reach[f][x] * tri.c3(h, v, x);
                        }
                        s += reach[o][v] as f64 * w as f64 * pair(h, v);
                    }
                    s
                })
                .collect();
        }
        if self.n == 2 {
            let j = 1 - i;
            return (0..N)
                .map(|h| (0..N).map(|v| reach[j][v] as f64 * self.hu.cnt[h][v] as f64 * (self.hu.eq[h][v] as f64 * pot - c_i)).sum())
                .collect();
        }
        let tri = self.tri.unwrap();
        let (j, k) = others(i);
        if n_alive == 3 {
            let u = &self.u3[&id][i];
            return (0..N)
                .into_par_iter()
                .map(|h| {
                    let mut s = 0.0f64;
                    for v in 0..N {
                        if reach[j][v] == 0.0 {
                            continue;
                        }
                        let row = &u[(h * N + v) * N..(h * N + v + 1) * N];
                        let inner: f32 = row.iter().zip(&reach[k]).map(|(a, b)| a * b).sum();
                        s += reach[j][v] as f64 * inner as f64;
                    }
                    s
                })
                .collect();
        }
        // deux vivants (i et a), le troisième (f) a couché : ses cartes restent retirées
        let (a, f) = if alive[j] { (j, k) } else { (k, j) };
        (0..N)
            .into_par_iter()
            .map(|h| {
                let mut s = 0.0f64;
                for v in 0..N {
                    if reach[a][v] == 0.0 {
                        continue;
                    }
                    let mut m = 0.0f32;
                    for w in 0..N {
                        m += reach[f][w] * tri.c3(h, v, w);
                    }
                    s += reach[a][v] as f64 * m as f64 * (self.hu.eq[h][v] as f64 * pot - c_i);
                }
                s
            })
            .collect()
    }

    fn cfr(&mut self, node: usize, i: usize, reach: &mut Vec<Vec<f32>>, t: f64) -> Vec<f64> {
        let (player, children) = match &self.tree.nodes[node] {
            Node::Terminal { .. } => return self.terminal(node, i, reach),
            Node::Decision { player, children, .. } => (*player, children.clone()),
        };
        let na = children.len();
        let sigma = self.strategy(node);
        if player == i {
            let mut vals = Vec::with_capacity(na);
            for (a, &c) in children.iter().enumerate() {
                let _ = a;
                vals.push(self.cfr(c, i, reach, t));
            }
            let mut v = vec![0f64; N];
            for a in 0..na {
                for h in 0..N {
                    v[h] += sigma[a * N + h] as f64 * vals[a][h];
                }
            }
            let pos = t.powf(ALPHA) / (t.powf(ALPHA) + 1.0);
            let neg = t.powf(BETA) / (t.powf(BETA) + 1.0);
            let sw = (t / (t + 1.0)).powf(GAMMA);
            let r = &mut self.regrets[node];
            let ss = &mut self.ssum[node];
            for a in 0..na {
                for h in 0..N {
                    let k = a * N + h;
                    let d = if r[k] > 0.0 { pos } else { neg };
                    r[k] = (r[k] as f64 * d + (vals[a][h] - v[h])) as f32;
                    ss[k] = (ss[k] as f64 * sw + reach[i][h] as f64 * sigma[k] as f64) as f32;
                }
            }
            v
        } else {
            let saved = reach[player].clone();
            let mut v = vec![0f64; N];
            for (a, &c) in children.iter().enumerate() {
                for h in 0..N {
                    reach[player][h] = saved[h] * sigma[a * N + h];
                }
                let r = self.cfr(c, i, reach, t);
                for h in 0..N {
                    v[h] += r[h];
                }
            }
            reach[player] = saved;
            v
        }
    }

    /// Une itération (chaque joueur met à jour ses regrets à tour de rôle).
    pub fn step(&mut self) {
        self.iterations += 1;
        let t = self.iterations as f64;
        for i in 0..self.n {
            let mut reach = vec![vec![1f32; N]; self.n];
            self.cfr(0, i, &mut reach, t);
        }
    }

    /// Valeur (moyenne ou meilleure réponse) du joueur i avec les stratégies moyennes des autres.
    fn eval(&self, node: usize, i: usize, reach: &mut Vec<Vec<f32>>, br: bool, out: &mut Option<&mut HashMap<usize, Vec<Vec<f64>>>>) -> Vec<f64> {
        let (player, children) = match &self.tree.nodes[node] {
            Node::Terminal { .. } => return self.terminal(node, i, reach),
            Node::Decision { player, children, .. } => (*player, children.clone()),
        };
        let avg = self.average(node);
        if player == i {
            let vals: Vec<Vec<f64>> = children.iter().map(|&c| self.eval(c, i, reach, br, out)).collect();
            if let Some(o) = out.as_deref_mut() {
                o.insert(node, vals.clone());
            }
            (0..N)
                .map(|h| {
                    if br {
                        vals.iter().map(|x| x[h]).fold(f64::MIN, f64::max)
                    } else {
                        (0..children.len()).map(|a| avg[a * N + h] as f64 * vals[a][h]).sum()
                    }
                })
                .collect()
        } else {
            let saved = reach[player].clone();
            let mut v = vec![0f64; N];
            for (a, &c) in children.iter().enumerate() {
                for h in 0..N {
                    reach[player][h] = saved[h] * avg[a * N + h];
                }
                let r = self.eval(c, i, reach, br, out);
                for h in 0..N {
                    v[h] += r[h];
                }
            }
            reach[player] = saved;
            v
        }
    }

    /// Normalisation : masse totale des donnes (toutes classes, atteintes = 1).
    fn total_mass(&self, i: usize) -> f64 {
        let reach = vec![vec![1f32; N]; self.n];
        self.mass(i, &reach).iter().enumerate().map(|(h, m)| ncombos(h) * m).sum()
    }

    /// Espérance de chaque joueur (bb par main) avec les stratégies moyennes, et exploitabilité
    /// (somme des gains de la meilleure réponse de chaque joueur), en bb par main.
    pub fn exploitability(&self) -> (Vec<f64>, f64) {
        let mut evs = Vec::new();
        let mut expl = 0.0;
        for i in 0..self.n {
            let tm = self.total_mass(i);
            let mut reach = vec![vec![1f32; N]; self.n];
            let cur = self.eval(0, i, &mut reach, false, &mut None);
            let brv = self.eval(0, i, &mut reach, true, &mut None);
            let ev: f64 = (0..N).map(|h| ncombos(h) * cur[h]).sum::<f64>() / tm;
            let bv: f64 = (0..N).map(|h| ncombos(h) * brv[h]).sum::<f64>() / tm;
            evs.push(ev);
            expl += (bv - ev).max(0.0);
        }
        (evs, expl)
    }

    /// Valeurs par action (bb par main, par classe) à chaque nœud du joueur i, et atteintes.
    pub fn node_values(&self, i: usize) -> HashMap<usize, Vec<Vec<f64>>> {
        let mut map = HashMap::new();
        let mut reach = vec![vec![1f32; N]; self.n];
        self.eval(0, i, &mut reach, false, &mut Some(&mut map));
        map
    }

    /// Atteintes de chaque joueur à chaque nœud (stratégies moyennes).
    pub fn reaches(&self) -> Vec<Vec<Vec<f32>>> {
        let mut out = vec![Vec::new(); self.tree.nodes.len()];
        let mut stack = vec![(0usize, vec![vec![1f32; N]; self.n])];
        while let Some((id, r)) = stack.pop() {
            if let Node::Decision { player, children, .. } = &self.tree.nodes[id] {
                let avg = self.average(id);
                for (a, &c) in children.iter().enumerate() {
                    let mut rr = r.clone();
                    for h in 0..N {
                        rr[*player][h] *= avg[a * N + h];
                    }
                    stack.push((c, rr));
                }
            }
            out[id] = r;
        }
        out
    }

    /// Masse adverse au nœud pour normaliser les valeurs (EV par main).
    pub fn mass_at(&self, i: usize, reach: &[Vec<f32>]) -> Vec<f64> {
        self.mass(i, reach)
    }
}

pub fn others(i: usize) -> (usize, usize) {
    match i {
        0 => (1, 2),
        1 => (0, 2),
        _ => (0, 1),
    }
}

#[cfg(test)]
mod tests {
    use super::super::tree::{PreflopConfig, Tree};
    use super::*;
    use crate::solver::ranges::cell_name;

    fn pct_of(s: &Solver, node: usize, action: usize) -> f64 {
        let avg = s.average(node);
        (0..N).map(|h| ncombos(h) * avg[action * N + h] as f64).sum::<f64>() / 1326.0
    }

    /// Push/fold tête-à-tête à 10 bb : la SB pousse ~58 % des mains, la BB paye ~37 %
    /// (équilibre de Nash publié) ; l'exploitabilité doit tomber sous 0,01 bb.
    #[test]
    fn heads_up_push_fold_10bb() {
        let tree = Tree::build(&PreflopConfig { stacks: vec![10.0, 10.0], push_fold: true, ..Default::default() }).unwrap();
        let mut s = Solver::new(tree, None).unwrap();
        for _ in 0..2000 {
            s.step();
        }
        let (evs, expl) = s.exploitability();
        let push = pct_of(&s, 0, 1);
        let Node::Decision { children, .. } = &s.tree.nodes[0] else { panic!() };
        let bb_node = children[1];
        let call = pct_of(&s, bb_node, 1);
        println!("push {push:.3} call {call:.3} expl {expl:.5} evs {evs:?}");
        assert!(expl < 0.01, "exploitabilité {expl}");
        assert!((push - 0.58).abs() < 0.03, "push {push}");
        assert!((call - 0.37).abs() < 0.03, "call {call}");
        assert!((evs[0] + evs[1]).abs() < 1e-6, "somme nulle {evs:?}");
        // mains évidentes
        let avg = s.average(0);
        let idx = |n: &str| (0..N).find(|&c| cell_name(c) == n).unwrap();
        assert!(avg[N + idx("AA")] > 0.99);
        assert!(avg[N + idx("72o")] < 0.01);
    }
}
