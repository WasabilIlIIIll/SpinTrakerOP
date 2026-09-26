//! Lecture d'une solution préflop pour l'interface : on suit un chemin d'actions depuis la
//! racine, on renvoie les tuiles de la barre du haut et le nœud atteint.

use super::classes::{ncombos, N};
use super::run::Solution;
use crate::solver::postflop::PostflopConfig;
use crate::solver::ranges::cell_name;
use serde_json::{json, Value};

fn fmt(v: f64) -> String {
    let s = format!("{:.1}", v);
    s.trim_end_matches(".0").to_string()
}

/// Nom court d'une configuration de tapis (« 12-12-12bb »).
pub fn stacks_label(sol: &Solution) -> String {
    format!("{}bb", sol.request.config.stacks.iter().map(|s| fmt(*s)).collect::<Vec<_>>().join("-"))
}

/// Tuiles des décisions déjà prises et investissements courants.
fn walk(sol: &Solution, path: &[usize]) -> Result<(usize, Vec<Value>, Vec<f64>), String> {
    let cfg = &sol.request.config;
    let n = cfg.stacks.len();
    let mut inv = vec![0f64; n];
    inv[n - 2] = 0.5f64.min(cfg.stacks[n - 2] - cfg.ante);
    inv[n - 1] = 1.0f64.min(cfg.stacks[n - 1] - cfg.ante);
    let mut node = 0usize;
    let mut tiles = Vec::new();
    for &a in path {
        let nd = &sol.nodes[node];
        let Some(p) = nd.player else {
            return Err("chemin invalide".into());
        };
        let act = nd.actions.get(a).ok_or("action inconnue")?;
        tiles.push(json!({
            "who": sol.names[p],
            "stack": cfg.stacks[p] - cfg.ante - inv[p],
            "actions": nd.actions.iter().map(|x| x.label.clone()).collect::<Vec<_>>(),
            "chosen": a,
        }));
        if act.kind != "fold" {
            inv[p] = act.to;
        }
        node = nd.children[a];
    }
    Ok((node, tiles, inv))
}

pub fn view(sol: &Solution, path: &[usize]) -> Result<Value, String> {
    let (id, tiles, inv) = walk(sol, path)?;
    let cfg = &sol.request.config;
    let nd = &sol.nodes[id];
    let mut v = json!({
        "names": sol.names,
        "stacks": cfg.stacks,
        "label": stacks_label(sol),
        "tiles": tiles,
        "pot": inv.iter().sum::<f64>() + cfg.ante * cfg.stacks.len() as f64,
        "iterations": sol.iterations,
        "exploit": sol.exploit,
        "evs": sol.evs,
        "flops_used": sol.flops_used,
        "seconds": sol.seconds,
        "reach": nd.reach,
    });
    if let Some(p) = nd.player {
        let na = nd.actions.len();
        let tot: f64 = (0..N).map(|h| ncombos(h) * nd.reach[p][h] as f64).sum();
        let freq: Vec<f64> = (0..na)
            .map(|a| if tot > 0.0 { (0..N).map(|h| ncombos(h) * nd.reach[p][h] as f64 * nd.strategy[a * N + h] as f64).sum::<f64>() / tot } else { 0.0 })
            .collect();
        let grid: Vec<Value> = (0..N)
            .map(|h| {
                let s: Vec<f32> = (0..na).map(|a| nd.strategy[a * N + h]).collect();
                let e: Vec<f32> = (0..na).map(|a| nd.ev[a * N + h]).collect();
                let ev: f32 = s.iter().zip(&e).map(|(x, y)| x * y).sum();
                json!({ "name": cell_name(h), "w": nd.reach[p][h], "s": s, "evs": e, "ev": ev })
            })
            .collect();
        v["player"] = json!(p);
        v["stack"] = json!(cfg.stacks[p] - cfg.ante - inv[p]);
        v["actions"] = json!(nd.actions);
        v["freq"] = json!(freq);
        v["grid"] = json!(grid);
        v["combos"] = json!(tot);
    } else {
        v["terminal"] = json!(nd.term);
        v["contrib"] = json!(nd.contrib);
        v["alive"] = json!(nd.alive);
        v["pot"] = json!(nd.pot);
        v["flop_model"] = json!(nd.flop_model);
        let alive: Vec<usize> = (0..nd.alive.len()).filter(|&i| nd.alive[i]).collect();
        v["combos_alive"] = json!(alive.iter().map(|&i| (0..N).map(|h| ncombos(h) * nd.reach[i][h] as f64).sum::<f64>()).collect::<Vec<_>>());
    }
    Ok(v)
}

/// Spot postflop issu d'une ligne préflop qui voit le flop à deux : ranges exactes atteintes.
pub fn postflop_config(sol: &Solution, path: &[usize], board: &str) -> Result<PostflopConfig, String> {
    let (id, tiles, _) = walk(sol, path)?;
    let nd = &sol.nodes[id];
    if nd.term.as_deref() != Some("flop") {
        return Err("cette ligne ne voit pas le flop".into());
    }
    let alive: Vec<usize> = (0..nd.alive.len()).filter(|&i| nd.alive[i]).collect();
    if alive.len() != 2 {
        return Err("pot à 3 joueurs : le moteur multiway arrive en phase 4".into());
    }
    let n = sol.names.len();
    let rank = |p: usize| match (n, sol.names[p].as_str()) {
        (2, "BB") => 0,
        (2, _) => 1,
        (_, "SB") => 0,
        (_, "BB") => 1,
        _ => 2,
    };
    let (oop, ip) = if rank(alive[0]) < rank(alive[1]) { (alive[0], alive[1]) } else { (alive[1], alive[0]) };
    let range = |p: usize| {
        (0..N)
            .filter(|&h| nd.reach[p][h] > 0.001)
            .map(|h| if nd.reach[p][h] >= 0.999 { cell_name(h) } else { format!("{}:{:.3}", cell_name(h), nd.reach[p][h]) })
            .collect::<Vec<_>>()
            .join(",")
    };
    let cfg = &sol.request.config;
    let left = |p: usize| cfg.stacks[p] - cfg.ante - nd.contrib[p];
    Ok(PostflopConfig {
        board: board.to_string(),
        pot: (nd.pot * 100.0).round() / 100.0,
        stack: (left(oop).min(left(ip)) * 100.0).round() / 100.0,
        oop_range: range(oop),
        ip_range: range(ip),
        oop_label: sol.names[oop].clone(),
        ip_label: sol.names[ip].clone(),
        context: Some(json!({ "label": stacks_label(sol), "tiles": tiles })),
        ..Default::default()
    })
}
