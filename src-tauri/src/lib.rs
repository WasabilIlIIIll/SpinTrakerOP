//! Spin Tracker OP — cœur de l'application.

pub mod analysis;
pub mod commands;
pub mod db;
pub mod eval;
pub mod import;
pub mod model;
pub mod parser;
pub mod settings;
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
}

#[tauri::command]
fn is_ready(state: tauri::State<AppState>) -> bool {
    state.ready.load(Ordering::SeqCst)
}

pub fn open_state(dir: &std::path::Path) -> Result<AppState, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let db_path = dir.join("spintracker.db");
    let db = db::Db::open(&db_path)?;
    let mut st = store::Store::default();
    if let Some(js) = db.kv_get("settings") {
        if let Ok(s) = serde_json::from_str::<settings::Settings>(&js) {
            st.settings = s;
        }
    }
    for (n, tags, notes) in db.load_players().unwrap_or_default() {
        st.meta.insert(n, (tags, notes));
    }
    Ok(AppState { store: Arc::new(RwLock::new(st)), db: Arc::new(Mutex::new(db)), db_path, ready: Arc::new(AtomicBool::new(false)) })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            commands::wipe_database,
            commands::backup_database,
            commands::export_csv,
            commands::scenarios,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Spin Tracker OP");
}
