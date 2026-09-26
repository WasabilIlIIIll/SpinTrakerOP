//! Commandes Tauri du solver. Les calculs lourds passent par `spawn_blocking` pour ne jamais
//! bloquer la fenêtre.

use super::postflop::{self, PostflopConfig};
use super::{now, ranges, spot, JobStatus};
use crate::AppState;
use serde_json::{json, Value};
use tauri::State;

type R<T> = Result<T, String>;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn solver_defaults() -> PostflopConfig {
    PostflopConfig::default()
}

#[tauri::command]
pub fn solver_spot_from_hand(state: State<AppState>, id: String) -> R<spot::Spot> {
    let s = state.store.read();
    let r = s.hands.iter().find(|r| r.h.id == id).ok_or("main introuvable")?;
    spot::from_hand(&r.h)
}

#[tauri::command]
pub fn solver_start_postflop(state: State<AppState>, config: PostflopConfig, hand_id: Option<String>, label: String) -> R<i64> {
    state.solver.start_postflop(state.db.clone(), config, hand_id, label)
}

#[tauri::command]
pub fn solver_status(state: State<AppState>) -> Option<JobStatus> {
    state.solver.job.lock().clone()
}

#[tauri::command]
pub fn solver_cancel(state: State<AppState>) {
    state.solver.cancel();
}

#[tauri::command]
pub async fn solver_node(state: State<'_, AppState>, id: i64, history: Vec<usize>) -> R<Value> {
    let (cfg_json, status) = state.db.lock().solve_config(id)?;
    if status == "running" || status == "interrompu" || status == "erreur" {
        return Err(match status.as_str() {
            "running" => "solve en cours de calcul",
            "interrompu" => "solve interrompu par la fermeture de l'application : relancez-le",
            _ => "ce solve a échoué",
        }
        .into());
    }
    let hub = state.solver.clone();
    blocking(move || {
        hub.with_open(id, &cfg_json, |op| {
            let mut v = postflop::node_view(&mut op.game, &history, &op.cfg, Some(&mut op.rivers))?;
            v["config"] = serde_json::to_value(&op.cfg).unwrap_or(Value::Null);
            Ok(v)
        })
    })
    .await
}

#[tauri::command]
pub fn solver_history(state: State<AppState>, trash: bool) -> R<Vec<Value>> {
    state.db.lock().solves(trash)
}

#[tauri::command]
pub fn solver_update(state: State<AppState>, id: i64, fav: Option<bool>, note: Option<String>, label: Option<String>) -> R<()> {
    state.db.lock().solve_update(id, fav, note.as_deref(), label.as_deref())
}

#[tauri::command]
pub fn solver_trash(state: State<AppState>, id: i64, on: bool) -> R<()> {
    state.db.lock().solve_trash(id, if on { Some(now()) } else { None })
}

/// Vide la corbeille : lignes et fichiers de résultats.
#[tauri::command]
pub fn solver_purge(state: State<AppState>) -> R<usize> {
    let ids = state.db.lock().solve_purge()?;
    let mut open = state.solver.open.lock();
    for id in &ids {
        if open.as_ref().map(|o| o.id) == Some(*id) {
            *open = None;
        }
        let _ = std::fs::remove_file(state.solver.file(*id));
    }
    Ok(ids.len())
}

/// Allège le fichier d'un solve (flop seul, ou flop + turn) pour gagner de la place.
#[tauri::command]
pub async fn solver_lighten(state: State<'_, AppState>, id: i64, keep_turn: bool) -> R<i64> {
    let (cfg_json, status) = state.db.lock().solve_config(id)?;
    if status == "running" {
        return Err("solve en cours de calcul".into());
    }
    let hub = state.solver.clone();
    let bytes = blocking(move || hub.lighten(id, &cfg_json, keep_turn)).await?;
    state.db.lock().solve_storage(id, if keep_turn { "turn" } else { "flop" }, bytes)?;
    Ok(bytes)
}

#[tauri::command]
pub fn solver_preflop_defaults() -> super::preflop::run::PreflopRequest {
    Default::default()
}

#[tauri::command]
pub fn solver_preflop_start(state: State<AppState>, req: super::preflop::run::PreflopRequest, label: String) -> R<i64> {
    state.solver.start_preflop(state.db.clone(), req, label)
}

/// Bibliothèque : plusieurs configurations de tapis calculées à la suite.
#[tauri::command]
pub fn solver_preflop_batch(state: State<AppState>, reqs: Vec<super::preflop::run::PreflopRequest>) -> R<i64> {
    let list = reqs
        .into_iter()
        .map(|r| {
            let label = format!("{}bb", r.config.stacks.iter().map(|s| format!("{}", (s * 10.0).round() / 10.0)).collect::<Vec<_>>().join("-"));
            (r, label)
        })
        .collect();
    state.solver.start_preflop_batch(state.db.clone(), list)
}

#[tauri::command]
pub async fn solver_preflop_view(state: State<'_, AppState>, id: i64, path: Vec<usize>) -> R<Value> {
    let hub = state.solver.clone();
    blocking(move || {
        let sol = hub.load_pre(id)?;
        super::preflop::view::view(&sol, &path)
    })
    .await
}

/// Lance le solve postflop d'une ligne préflop (ranges exactes atteintes au flop).
#[tauri::command]
pub fn solver_preflop_to_postflop(state: State<AppState>, id: i64, path: Vec<usize>, board: String, bet_sizes: Option<[Vec<f64>; 3]>, precision: Option<f64>) -> R<i64> {
    let sol = state.solver.load_pre(id)?;
    let mut cfg = super::preflop::view::postflop_config(&sol, &path, &board)?;
    if let Some(b) = bet_sizes {
        cfg.bet_sizes = b;
    }
    if let Some(p) = precision {
        cfg.precision = p;
    }
    let tiles = cfg.context.as_ref().and_then(|c| c["tiles"].as_array().cloned()).unwrap_or_default();
    let line: Vec<String> = tiles.iter().map(|t| format!("{} {}", t["who"].as_str().unwrap_or(""), t["actions"][t["chosen"].as_u64().unwrap_or(0) as usize].as_str().unwrap_or(""))).collect();
    let label = format!("{} · {}", super::preflop::view::stacks_label(&sol), line.join(", "));
    state.solver.start_postflop(state.db.clone(), cfg, None, label)
}

#[tauri::command]
pub async fn range_analyze(state: State<'_, AppState>, range: String, board: String, dead: String, vs: String) -> R<ranges::Analysis> {
    state.solver.guard()?;
    blocking(move || ranges::analyze(&range, &board, &dead, &vs)).await
}

/// Laboratoire de ranges à 2 ou 3 joueurs (Flopzilla multiway).
#[tauri::command]
pub async fn range_lab(state: State<'_, AppState>, req: super::lab::LabRequest) -> R<super::lab::LabResult> {
    state.solver.guard()?;
    blocking(move || super::lab::run(&req)).await
}

/// Équité à tapis préflop : payer ou non face à un all-in, joueur de derrière compris.
#[tauri::command]
pub async fn allin_calc(state: State<'_, AppState>, req: super::preflop::allin::AllinRequest) -> R<super::preflop::allin::AllinResult> {
    let hub = state.solver.clone();
    blocking(move || {
        hub.guard()?;
        if req.behind.is_some() && !hub.tables_ready() {
            return Err("TABLES_ABSENTES".into());
        }
        let tri = if req.behind.is_some() { Some(hub.tri_tables(&|_, _| {})?) } else { None };
        super::preflop::allin::run(&req, tri.as_deref())
    })
    .await
}

/// « Couper le solver » : arrête tout calcul, libère la mémoire et active le mode session.
#[tauri::command]
pub async fn solver_kill_all(state: State<'_, AppState>) -> R<Value> {
    state.solver.locked.store(true, std::sync::atomic::Ordering::SeqCst);
    let hub = state.solver.clone();
    let stopped = tauri::async_runtime::spawn_blocking(move || hub.kill_all(std::time::Duration::from_secs(15))).await.map_err(|e| e.to_string())?;
    Ok(json!({ "stopped": stopped }))
}

#[tauri::command]
pub fn solver_lock(state: State<AppState>, on: bool) {
    state.solver.locked.store(on || !super::ENABLED, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
pub fn solver_state(state: State<AppState>) -> Value {
    json!({
        "locked": state.solver.locked.load(std::sync::atomic::Ordering::SeqCst),
        "running": state.solver.is_running(),
        "tables": state.solver.tables_ready(),
    })
}

#[tauri::command]
pub fn solver_prepare_tables(state: State<AppState>) -> R<()> {
    state.solver.start_tables()
}

/// Dernier recours : redémarre l'application (plus aucun calcul ne peut survivre).
#[tauri::command]
pub fn app_restart(app: tauri::AppHandle, state: State<AppState>) {
    state.db.lock().checkpoint();
    app.restart();
}

#[tauri::command]
pub async fn range_order() -> R<Vec<usize>> {
    blocking(|| Ok(ranges::preflop_order().clone())).await
}

/// Estimation mémoire d'un arbre avant de lancer le solve.
#[tauri::command]
pub async fn solver_estimate(config: PostflopConfig) -> R<Value> {
    blocking(move || {
        let g = postflop::build(&config)?;
        let (m, mc) = g.memory_usage();
        Ok(json!({ "memory_mb": m as f64 / 1e6, "compressed_mb": mc as f64 / 1e6 }))
    })
    .await
}
