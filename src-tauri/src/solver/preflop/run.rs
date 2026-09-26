//! Calcul complet d'une solution préflop et format de la solution enregistrée.
//!
//! 1. Discounted CFR avec le modèle de départ (flop valorisé à l'équité).
//! 2. Pour chaque ligne qui voit le flop à deux : vrais solves postflop sur l'échantillon de
//!    flops, avec les ranges atteintes à ce moment ; leurs valeurs remplacent le modèle.
//! 3. De nouveau CFR, et ainsi de suite (`rounds` allers-retours).
//! Les lignes qui voient le flop à trois restent au modèle d'équité tant que le moteur
//! multiway (phase 4) n'est pas là : c'est indiqué dans la solution.

use super::cfr::Solver;
use super::classes::{ncombos, N};
use super::oracle::{flop_subset, value_line, FlopLine};
use super::tree::{Node, PreflopConfig, Term, Tree};
use super::tri::TriTables;
use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicBool;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreflopRequest {
    pub config: PreflopConfig,
    /// nombre de flops de l'échantillon postflop (0 = modèle d'équité seul, rapide)
    pub flops: usize,
    pub rounds: usize,
    /// précision visée des solves postflop de valorisation (% du pot)
    pub post_precision: f64,
    /// exploitabilité visée du préflop (bb par main)
    pub target: f64,
    pub max_iters: u32,
}

impl Default for PreflopRequest {
    fn default() -> Self {
        PreflopRequest { config: PreflopConfig::default(), flops: 20, rounds: 2, post_precision: 1.0, target: 0.005, max_iters: 4000 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActOut {
    pub kind: String,
    pub label: String,
    pub to: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeOut {
    pub player: Option<usize>,
    pub actions: Vec<ActOut>,
    pub children: Vec<usize>,
    /// stratégie moyenne [action][classe]
    pub strategy: Vec<f32>,
    /// EV (bb par main) de chaque action pour le joueur qui parle [action][classe]
    pub ev: Vec<f32>,
    /// atteinte de chaque joueur par classe
    pub reach: Vec<Vec<f32>>,
    pub term: Option<String>,
    pub contrib: Vec<f64>,
    pub alive: Vec<bool>,
    pub pot: f64,
    /// flop : « postflop » (valeurs issues de solves) ou « équité » (modèle)
    pub flop_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Solution {
    pub request: PreflopRequest,
    pub names: Vec<String>,
    pub nodes: Vec<NodeOut>,
    pub iterations: u32,
    /// exploitabilité finale (bb par main, somme des joueurs)
    pub exploit: f64,
    pub evs: Vec<f64>,
    pub seconds: f64,
    pub flops_used: usize,
}

pub struct Progress<'a> {
    pub f: &'a (dyn Fn(&str, f64, Option<f64>) + Sync),
}

/// Bonus de réalisation de chaque joueur (voir `FlopModel`) à partir des valeurs des solves.
fn flop_model(line: &FlopLine, players: [usize; 2], vals: [Vec<f32>; 2]) -> super::cfr::FlopModel {
    let t = super::classes::hu();
    let weights = |p: usize, h: usize| -> (f64, f64) {
        // (masse adverse, équité moyenne) de la classe h du joueur p face à la range de référence
        let op = &line.reach[1 - p];
        let (mut m, mut e) = (0.0f64, 0.0f64);
        for v in 0..N {
            let w = op[v] as f64 * t.cnt[h][v] as f64;
            m += w;
            e += w * t.eq[h][v] as f64;
        }
        (m, if m > 0.0 { e / m } else { 0.5 })
    };
    let mut r = [vec![0f32; N], vec![0f32; N]];
    let mut er = [0.0f64; 2];
    for p in 0..2 {
        let (mut num, mut den) = (0.0f64, 0.0f64);
        for h in 0..N {
            let (m, eq) = weights(p, h);
            r[p][h] = (vals[p][h] as f64 - line.pot * eq) as f32;
            let w = ncombos(h) * line.reach[p][h] as f64 * m;
            num += w * r[p][h] as f64;
            den += w;
        }
        er[p] = if den > 0.0 { num / den } else { 0.0 };
    }
    super::cfr::FlopModel { players, r, k: [er[1], er[0]] }
}

/// Ordre postflop : [OOP, IP] parmi deux joueurs vivants.
fn post_order(names: &[&str], a: usize, b: usize) -> (usize, usize) {
    let rank = |p: usize| match (names.len(), names[p]) {
        (2, "BB") => 0,
        (2, _) => 1,
        (_, "SB") => 0,
        (_, "BB") => 1,
        _ => 2,
    };
    if rank(a) < rank(b) { (a, b) } else { (b, a) }
}

fn cfr_until(s: &mut Solver, req: &PreflopRequest, budget: u32, cancel: &AtomicBool, prog: &Progress, phase: &str, frac: (f64, f64)) -> f64 {
    let mut expl = f64::NAN;
    let start = s.iterations;
    while s.iterations - start < budget {
        if cancel.load(std::sync::atomic::Ordering::SeqCst) {
            break;
        }
        s.step();
        let done = s.iterations - start;
        if done % 50 == 0 || done == budget {
            expl = s.exploitability().1;
            (prog.f)(phase, frac.0 + frac.1 * done as f64 / budget as f64, Some(expl));
            if expl <= req.target && done >= 100 {
                break;
            }
        }
    }
    expl
}

pub fn run(req: &PreflopRequest, tri: Option<&TriTables>, cancel: &AtomicBool, prog: &Progress) -> Result<Solution, String> {
    let t0 = std::time::Instant::now();
    let tree = Tree::build(&req.config)?;
    let names: Vec<&'static str> = tree.names.clone();
    let mut s = Solver::new(tree, tri)?;
    let rounds = if req.flops == 0 { 0 } else { req.rounds.max(1) };
    // chaque phase CFR s'arrête dès la cible atteinte, au plus `max_iters` itérations
    let per = req.max_iters;
    let share = 1.0 / (rounds as f64 * 2.0 + 1.0);
    cfr_until(&mut s, req, per, cancel, prog, "Préflop (flop valorisé à l'équité)", (0.0, share));
    let flops = flop_subset(req.flops.max(1));
    let mut valued: std::collections::HashSet<usize> = Default::default();
    for round in 0..rounds {
        let reaches = s.reaches();
        // lignes qui voient le flop à deux, assez fréquentes pour peser
        let lines: Vec<(usize, usize, usize)> = s
            .tree
            .nodes
            .iter()
            .enumerate()
            .filter_map(|(id, nd)| match nd {
                Node::Terminal { term: Term::Flop, alive, .. } if alive.iter().filter(|a| **a).count() == 2 => {
                    let al: Vec<usize> = (0..alive.len()).filter(|&i| alive[i]).collect();
                    let mass: f64 = (0..N).map(|h| ncombos(h) * reaches[id][al[0]][h] as f64).sum::<f64>() / 1326.0
                        * (0..N).map(|h| ncombos(h) * reaches[id][al[1]][h] as f64).sum::<f64>()
                        / 1326.0;
                    (mass > 0.002).then_some((id, al[0], al[1]))
                }
                _ => None,
            })
            .collect();
        let base = share * (1.0 + 2.0 * round as f64);
        for (k, &(id, a, b)) in lines.iter().enumerate() {
            let Node::Terminal { contrib, pot, .. } = &s.tree.nodes[id] else { unreachable!() };
            let (oop, ip) = post_order(&names, a, b);
            let stacks: Vec<f64> = s.tree.cfg.stacks.iter().map(|x| x - s.tree.cfg.ante).collect();
            let line = FlopLine {
                pot: *pot,
                stack: (stacks[oop] - contrib[oop]).min(stacks[ip] - contrib[ip]),
                reach: [reaches[id][oop].clone(), reaches[id][ip].clone()],
                labels: [names[oop].to_string(), names[ip].to_string()],
            };
            let phase = format!("Postflop : ligne {} / {} ({} vs {}), passe {}", k + 1, lines.len(), names[oop], names[ip], round + 1);
            let frac0 = base + share * k as f64 / lines.len() as f64;
            let vals = value_line(&line, &flops, req.post_precision, cancel, &|f| {
                (prog.f)(&phase, frac0 + share / lines.len() as f64 * f as f64 / flops.len() as f64, None)
            })?;
            s.flop_models.insert(id, flop_model(&line, [oop, ip], vals));
            valued.insert(id);
        }
        cfr_until(&mut s, req, per, cancel, prog, "Préflop (valeurs postflop réelles)", (base + share, share));
    }
    let (evs, expl) = s.exploitability();
    // valeurs par action pour chaque joueur, normalisées par main
    let reaches = s.reaches();
    let values: Vec<std::collections::HashMap<usize, Vec<Vec<f64>>>> = (0..s.n).map(|i| s.node_values(i)).collect();
    let nodes: Vec<NodeOut> = s
        .tree
        .nodes
        .iter()
        .enumerate()
        .map(|(id, nd)| match nd {
            Node::Decision { player, actions, children } => {
                let strat = s.average(id);
                let mass = s.mass_at(*player, &reaches[id]);
                let mut ev = vec![0f32; actions.len() * N];
                if let Some(v) = values[*player].get(&id) {
                    for a in 0..actions.len() {
                        for h in 0..N {
                            ev[a * N + h] = if mass[h] > 0.0 { (v[a][h] / mass[h]) as f32 } else { 0.0 };
                        }
                    }
                }
                NodeOut {
                    player: Some(*player),
                    actions: actions
                        .iter()
                        .map(|a| ActOut { kind: format!("{:?}", a.kind).to_lowercase(), label: a.label.clone(), to: a.to })
                        .collect(),
                    children: children.clone(),
                    strategy: strat,
                    ev,
                    reach: reaches[id].clone(),
                    term: None,
                    contrib: vec![],
                    alive: vec![],
                    pot: 0.0,
                    flop_model: None,
                }
            }
            Node::Terminal { term, contrib, alive, pot, .. } => NodeOut {
                player: None,
                actions: vec![],
                children: vec![],
                strategy: vec![],
                ev: vec![],
                reach: reaches[id].clone(),
                term: Some(format!("{term:?}").to_lowercase()),
                contrib: contrib.clone(),
                alive: alive.clone(),
                pot: *pot,
                flop_model: (*term == Term::Flop).then(|| if valued.contains(&id) { "postflop".into() } else { "équité".into() }),
            },
        })
        .collect();
    Ok(Solution {
        request: req.clone(),
        names: names.iter().map(|x| x.to_string()).collect(),
        nodes,
        iterations: s.iterations,
        exploit: expl,
        evs,
        seconds: t0.elapsed().as_secs_f64(),
        flops_used: if rounds > 0 { flops.len() } else { 0 },
    })
}
