//! Spin Tracker OP — cœur de l'application.

pub mod analysis;
pub mod commands;
pub mod db;
pub mod eval;
pub mod import;
pub mod model;
pub mod parser;
pub mod settings;
pub mod ranges;
pub mod solver;
pub mod stats;
pub mod store;

use parking_lot::{Mutex, RwLock};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};

pub struct AppState {
    pub store: Arc<RwLock<store::Store>>,
    pub db: Arc<Mutex<db::Db>>,
    pub db_path: PathBuf,
    pub ready: Arc<AtomicBool>,
    /// message à afficher au démarrage (restauration de sauvegarde…)
    pub notice: Arc<Mutex<Option<String>>>,
    pub solver: Arc<solver::Hub>,
}

#[tauri::command]
fn startup_notice(state: tauri::State<AppState>) -> Option<String> {
    state.notice.lock().take()
}

#[tauri::command]
fn is_ready(state: tauri::State<AppState>) -> bool {
    state.ready.load(Ordering::SeqCst)
}

/// Reprend la base d'une ancienne version (identifiant `com.spintrackerop.app`).
fn migrate_legacy_data(dir: &std::path::Path) {
    if dir.join("spintracker.db").exists() {
        return;
    }
    let Some(parent) = dir.parent() else { return };
    let old = parent.join("com.spintrackerop.app");
    if !old.join("spintracker.db").exists() {
        return;
    }
    for f in ["spintracker.db", "spintracker.db-wal", "spintracker.db-shm"] {
        let (src, dst) = (old.join(f), dir.join(f));
        if src.exists() {
            let _ = std::fs::copy(&src, &dst);
        }
    }
}

/// Sauvegardes automatiques : une par jour, les 7 plus récentes sont conservées.
fn backup_dir(dir: &std::path::Path) -> PathBuf {
    dir.join("sauvegardes")
}

fn latest_backup(dir: &std::path::Path) -> Option<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(backup_dir(dir)).ok()?.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().map(|x| x == "db").unwrap_or(false)).collect();
    v.sort();
    v.pop()
}

fn daily_backup(db: &db::Db, dir: &std::path::Path) {
    let bdir = backup_dir(dir);
    if std::fs::create_dir_all(&bdir).is_err() {
        return;
    }
    let day = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() / 86400).unwrap_or(0);
    let dest = bdir.join(format!("spintracker-{day}.db"));
    if !dest.exists() {
        let _ = db.snapshot(&dest);
    }
    let mut all: Vec<PathBuf> = std::fs::read_dir(&bdir).map(|r| r.filter_map(|e| e.ok().map(|e| e.path())).collect()).unwrap_or_default();
    all.sort();
    while all.len() > 7 {
        let _ = std::fs::remove_file(all.remove(0));
    }
}

/// Ouvre la base ; si elle est illisible, la met de côté et restaure la dernière sauvegarde.
fn open_db_safely(dir: &std::path::Path, db_path: &std::path::Path) -> Result<(db::Db, Option<String>), String> {
    match db::Db::open(db_path) {
        Ok(db) if db.quick_ok() => return Ok((db, None)),
        Ok(db) => drop(db),
        Err(_) => {}
    }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let aside = dir.join(format!("spintracker-endommagee-{stamp}.db"));
    let _ = std::fs::rename(db_path, &aside);
    for ext in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(PathBuf::from(format!("{}{ext}", db_path.display())));
    }
    let note = match latest_backup(dir) {
        Some(b) if std::fs::copy(&b, db_path).is_ok() => format!("Base endommagée : restauration de la sauvegarde {}. L'ancienne base est conservée dans {}.", b.display(), aside.display()),
        _ => format!("Base endommagée et aucune sauvegarde disponible : nouvelle base créée. L'ancienne est conservée dans {}.", aside.display()),
    };
    Ok((db::Db::open(db_path)?, Some(note)))
}

pub fn open_state(dir: &std::path::Path) -> Result<AppState, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    migrate_legacy_data(dir);
    let db_path = dir.join("spintracker.db");
    let (db, recovery_note) = open_db_safely(dir, &db_path)?;
    daily_backup(&db, dir);
    db.solve_mark_interrupted();
    let mut st = store::Store::default();
    if let Some(js) = db.kv_get("settings") {
        if let Ok(s) = serde_json::from_str::<settings::Settings>(&js) {
            st.settings = s;
        }
    }
    st.settings.add_missing_tables();
    for (n, tags, notes) in db.load_players().unwrap_or_default() {
        st.meta.insert(n, (tags, notes));
    }
    st.favorites = db.load_favorites().unwrap_or_default();
    Ok(AppState {
        store: Arc::new(RwLock::new(st)),
        db: Arc::new(Mutex::new(db)),
        db_path,
        ready: Arc::new(AtomicBool::new(false)),
        notice: Arc::new(Mutex::new(recovery_note)),
        solver: Arc::new(solver::Hub::new(dir)),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // calculs du solver : on laisse toujours deux cœurs à l'interface
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    let _ = rayon::ThreadPoolBuilder::new().num_threads(cores.saturating_sub(2).max(1)).build_global();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // SPINOP_DATA_DIR permet un mode portable (clé USB) ou une base de test.
            let dir = match std::env::var("SPINOP_DATA_DIR") {
                Ok(d) => PathBuf::from(d),
                Err(_) => app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(".")),
            };
            let state = open_state(&dir).map_err(|e| Box::<dyn std::error::Error>::from(e))?;
            let (store, dbc, ready) = (state.store.clone(), state.db.clone(), state.ready.clone());
            app.manage(state);
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut s = store::Store::default();
                {
                    let cur = store.read();
                    s.settings = cur.settings.clone();
                    s.meta = cur.meta.clone();
                    s.favorites = cur.favorites.clone();
                }
                let r = import::load(&mut dbc.lock(), &mut s);
                *store.write() = s;
                ready.store(true, Ordering::SeqCst);
                let _ = handle.emit("store-ready", r.err());
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            is_ready,
            startup_notice,
            commands::overview,
            commands::import_paths,
            commands::get_summary,
            commands::chips_chart,
            commands::bankroll_chart,
            commands::by_position,
            commands::by_profile,
            commands::by_stack,
            commands::results_by,
            commands::multipliers,
            commands::calendar,
            commands::sessions,
            commands::tournaments,
            commands::hands,
            commands::hand_detail,
            commands::tournament_detail,
            commands::players,
            commands::player_profile,
            commands::save_player_meta,
            commands::tags_overview,
            commands::leak_report,
            commands::get_settings,
            commands::save_settings,
            commands::default_settings,
            commands::get_ui,
            commands::set_ui,
            commands::challenges_list,
            commands::save_challenge,
            commands::delete_challenge,
            commands::imports_history,
            commands::delete_import,
            commands::set_favorite,
            commands::wipe_database,
            commands::backup_database,
            commands::export_csv,
            commands::scenarios,
            ranges::ranges_load,
            ranges::ranges_save,
            ranges::ranges_export,
            ranges::ranges_import,
            ranges::trainer_load,
            ranges::trainer_save,
            solver::commands::solver_defaults,
            solver::commands::solver_spot_from_hand,
            solver::commands::solver_start_postflop,
            solver::commands::solver_status,
            solver::commands::solver_cancel,
            solver::commands::solver_node,
            solver::commands::solver_history,
            solver::commands::solver_update,
            solver::commands::solver_trash,
            solver::commands::solver_purge,
            solver::commands::solver_estimate,
            solver::commands::range_analyze,
            solver::commands::range_order,
            solver::commands::range_lab,
            solver::commands::allin_calc,
            solver::commands::solver_kill_all,
            solver::commands::solver_lock,
            solver::commands::solver_state,
            solver::commands::solver_prepare_tables,
            solver::commands::app_restart,
            solver::commands::solver_lighten,
            solver::commands::solver_preflop_defaults,
            solver::commands::solver_preflop_start,
            solver::commands::solver_preflop_batch,
            solver::commands::solver_preflop_view,
            solver::commands::solver_preflop_to_postflop,
        ])
        .build(tauri::generate_context!())
        .expect("erreur au lancement de Spin Tracker OP")
        .run(|handle, event| {
            // à la fermeture, tout est reporté dans le fichier principal de la base
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = handle.try_state::<AppState>() {
                    state.db.lock().checkpoint();
                }
            }
        });
}
