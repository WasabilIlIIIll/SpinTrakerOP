//! Ranges préflop personnelles et progression du trainer : deux fichiers JSON à côté de la base.
//!
//! L'arbre et la lecture des ranges vivent dans le front (`src/lib/ranges.ts`) ; ici on ne fait
//! que stocker, avec une écriture atomique et une copie de la version précédente (`.bak`).

use crate::AppState;
use std::path::{Path, PathBuf};
use tauri::State;

type R<T> = Result<T, String>;

const RANGES: &str = "ranges.json";
const TRAINER: &str = "trainer.json";

fn dir(state: &AppState) -> PathBuf {
    state.db_path.parent().map(Path::to_path_buf).unwrap_or_default()
}

fn read(path: &Path) -> R<Option<String>> {
    match std::fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Écrit `json` (validé) : fichier temporaire puis renommage, l'ancienne version gardée en `.bak`.
fn write(path: &Path, json: &str) -> R<()> {
    serde_json::from_str::<serde_json::Value>(json).map_err(|e| format!("JSON invalide : {e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    if path.exists() {
        let _ = std::fs::copy(path, path.with_extension("json.bak"));
    }
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ranges_load(state: State<AppState>) -> R<Option<String>> {
    read(&dir(&state).join(RANGES))
}

#[tauri::command]
pub fn ranges_save(state: State<AppState>, json: String) -> R<()> {
    write(&dir(&state).join(RANGES), &json)
}

/// Copie du livre de ranges vers un fichier choisi par l'utilisateur.
#[tauri::command]
pub fn ranges_export(state: State<AppState>, path: String) -> R<()> {
    let src = dir(&state).join(RANGES);
    let json = read(&src)?.ok_or("aucune range enregistrée")?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

/// Lecture d'un fichier de ranges à importer (le front fusionne puis enregistre).
#[tauri::command]
pub fn ranges_import(path: String) -> R<String> {
    let json = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| format!("fichier illisible : {e}"))?;
    Ok(json)
}

#[tauri::command]
pub fn trainer_load(state: State<AppState>) -> R<Option<String>> {
    read(&dir(&state).join(TRAINER))
}

#[tauri::command]
pub fn trainer_save(state: State<AppState>, json: String) -> R<()> {
    write(&dir(&state).join(TRAINER), &json)
}
