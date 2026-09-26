//! Persistance SQLite. Les objets volumineux sont sérialisés en MessagePack.

use crate::analysis::HandFacts;
use crate::model::{Hand, Tournament};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

/// Incrémenter quand l'algorithme d'analyse change : les faits seront recalculés.
pub const FACTS_VERSION: i64 = 1;

pub struct Db {
    pub conn: Connection,
}

impl Db {
    pub fn open(path: &Path) -> Result<Db, String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS tournaments (id TEXT PRIMARY KEY, start INTEGER, data BLOB NOT NULL);
             CREATE TABLE IF NOT EXISTS hands (id TEXT PRIMARY KEY, tid TEXT NOT NULL, ts INTEGER, data BLOB NOT NULL, facts BLOB, fv INTEGER DEFAULT 0);
             CREATE INDEX IF NOT EXISTS hands_tid ON hands(tid);
             CREATE TABLE IF NOT EXISTS players (name TEXT PRIMARY KEY, tags TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '');
             CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS challenges (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS imports (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, sources INTEGER, hands INTEGER, imported INTEGER, duplicates INTEGER, invalid INTEGER, status TEXT, label TEXT DEFAULT '');
             CREATE TABLE IF NOT EXISTS favorites (hand_id TEXT PRIMARY KEY, ts INTEGER, note TEXT NOT NULL DEFAULT '');
             CREATE TABLE IF NOT EXISTS solves (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, kind TEXT NOT NULL, hand_id TEXT, label TEXT NOT NULL DEFAULT '', config TEXT NOT NULL, status TEXT NOT NULL, exploit REAL, iters INTEGER DEFAULT 0, seconds REAL DEFAULT 0, bytes INTEGER DEFAULT 0, fav INTEGER DEFAULT 0, note TEXT NOT NULL DEFAULT '', deleted_at INTEGER);",
        )
        .map_err(|e| e.to_string())?;
        // migrations souples (colonnes ajoutées après coup)
        let _ = conn.execute("ALTER TABLE hands ADD COLUMN batch INTEGER DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE imports ADD COLUMN label TEXT DEFAULT ''", []);
        let _ = conn.execute("CREATE INDEX IF NOT EXISTS hands_batch ON hands(batch)", []);
        let _ = conn.execute("ALTER TABLE solves ADD COLUMN storage TEXT NOT NULL DEFAULT 'river'", []);
        let db = Db { conn };
        db.repair_batches();
        Ok(db)
    }

    /// Un lot qui compte plus de mains que son import n'en a apporté a hérité d'anciennes mains
    /// (numéro d'import réutilisé après une reconstruction de la base). Les mains d'un import
    /// sont insérées d'un bloc à la fin de la table : on garde dans le lot les plus récentes et
    /// on rend les autres anonymes (lot 0), pour que la corbeille ne supprime que le bon import.
    fn repair_batches(&self) {
        let bad: Vec<(i64, i64)> = self
            .conn
            .prepare("SELECT id, imported FROM imports WHERE imported > 0 AND (SELECT COUNT(*) FROM hands WHERE batch = imports.id) > imported")
            .and_then(|mut st| st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect())
            .unwrap_or_default();
        for (id, n) in bad {
            let _ = self.conn.execute(
                "UPDATE hands SET batch = 0 WHERE batch = ?1 AND rowid NOT IN (SELECT rowid FROM hands WHERE batch = ?1 ORDER BY rowid DESC LIMIT ?2)",
                params![id, n],
            );
        }
    }

    /// Contrôle rapide d'intégrité (quelques ms) : faux si la base est endommagée.
    pub fn quick_ok(&self) -> bool {
        self.conn.query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0)).map(|v| v == "ok").unwrap_or(false)
    }

    /// Reporte le journal WAL dans le fichier principal : la base devient autonome sur disque.
    pub fn checkpoint(&self) {
        let _ = self.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    }

    /// Copie cohérente de la base (même pendant l'utilisation).
    pub fn snapshot(&self, dest: &Path) -> Result<(), String> {
        let _ = std::fs::remove_file(dest);
        self.conn.execute("VACUUM INTO ?1", [dest.to_string_lossy().to_string()]).map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn load_tournaments(&self) -> Result<Vec<Tournament>, String> {
        let mut st = self.conn.prepare("SELECT data FROM tournaments").map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| r.get::<_, Vec<u8>>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .filter_map(|b| rmp_serde::from_slice::<Tournament>(&b).ok())
            .collect();
        Ok(rows)
    }

    /// (main, faits éventuels si à jour)
    pub fn load_hands(&self) -> Result<Vec<(Hand, Option<HandFacts>)>, String> {
        let mut st = self.conn.prepare("SELECT data, facts, fv FROM hands").map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| Ok((r.get::<_, Vec<u8>>(0)?, r.get::<_, Option<Vec<u8>>>(1)?, r.get::<_, i64>(2)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>();
        Ok(rows
            .into_iter()
            .filter_map(|(d, f, fv)| {
                let h = rmp_serde::from_slice::<Hand>(&d).ok()?;
                let facts = if fv == FACTS_VERSION { f.and_then(|b| rmp_serde::from_slice::<HandFacts>(&b).ok()) } else { None };
                Some((h, facts))
            })
            .collect())
    }

    pub fn existing_hand_ids(&self) -> Result<std::collections::HashSet<String>, String> {
        let mut st = self.conn.prepare("SELECT id FROM hands").map_err(|e| e.to_string())?;
        let ids = st.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        Ok(ids)
    }

    /// `replace` : tournois dont les mains déjà en base sont remplacées par celles du lot.
    pub fn save_batch(&mut self, ts: &[Tournament], hands: &[(Hand, HandFacts)], batch: i64, replace: &[String]) -> Result<(), String> {
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        {
            for tid in replace {
                tx.execute("DELETE FROM hands WHERE tid = ?1", params![tid]).map_err(|e| e.to_string())?;
            }
            let mut st = tx.prepare("INSERT OR REPLACE INTO tournaments (id, start, data) VALUES (?1, ?2, ?3)").map_err(|e| e.to_string())?;
            for t in ts {
                let b = rmp_serde::to_vec(t).map_err(|e| e.to_string())?;
                st.execute(params![t.id, t.start, b]).map_err(|e| e.to_string())?;
            }
            let mut sh = tx
                .prepare("INSERT OR IGNORE INTO hands (id, tid, ts, data, facts, fv, batch) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
                .map_err(|e| e.to_string())?;
            for (h, f) in hands {
                let b = rmp_serde::to_vec(h).map_err(|e| e.to_string())?;
                let fb = rmp_serde::to_vec(f).map_err(|e| e.to_string())?;
                sh.execute(params![h.id, h.tid, h.ts, b, fb, FACTS_VERSION, batch]).map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn save_facts(&mut self, facts: &[(String, HandFacts)]) -> Result<(), String> {
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut st = tx.prepare("UPDATE hands SET facts=?1, fv=?2 WHERE id=?3").map_err(|e| e.to_string())?;
            for (id, f) in facts {
                let fb = rmp_serde::to_vec(f).map_err(|e| e.to_string())?;
                st.execute(params![fb, FACTS_VERSION, id]).map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn kv_get(&self, key: &str) -> Option<String> {
        self.conn.query_row("SELECT value FROM kv WHERE key=?1", params![key], |r| r.get(0)).optional().ok().flatten()
    }

    pub fn kv_set(&self, key: &str, value: &str) -> Result<(), String> {
        self.conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?1, ?2)", params![key, value]).map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn load_players(&self) -> Result<Vec<(String, Vec<String>, String)>, String> {
        let mut st = self.conn.prepare("SELECT name, tags, notes FROM players").map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .map(|(n, t, no)| (n, serde_json::from_str(&t).unwrap_or_default(), no))
            .collect();
        Ok(rows)
    }

    pub fn save_player(&self, name: &str, tags: &[String], notes: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT OR REPLACE INTO players (name, tags, notes) VALUES (?1, ?2, ?3)",
                params![name, serde_json::to_string(tags).unwrap(), notes],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn load_challenges(&self) -> Result<Vec<(i64, String)>, String> {
        let mut st = self.conn.prepare("SELECT id, data FROM challenges ORDER BY id DESC").map_err(|e| e.to_string())?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        Ok(rows)
    }

    pub fn save_challenge(&self, id: Option<i64>, data: &str) -> Result<i64, String> {
        match id {
            Some(id) => {
                self.conn.execute("UPDATE challenges SET data=?1 WHERE id=?2", params![data, id]).map_err(|e| e.to_string())?;
                Ok(id)
            }
            None => {
                self.conn.execute("INSERT INTO challenges (data) VALUES (?1)", params![data]).map_err(|e| e.to_string())?;
                Ok(self.conn.last_insert_rowid())
            }
        }
    }

    pub fn delete_challenge(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM challenges WHERE id=?1", params![id]).map(|_| ()).map_err(|e| e.to_string())
    }

    /// Crée la ligne d'historique et renvoie son identifiant (= numéro de lot des mains).
    pub fn start_import(&self, ts: i64, label: &str) -> Result<i64, String> {
        // numéro jamais porté par une main existante, même si la table des imports a été perdue
        let id: i64 = self
            .conn
            .query_row("SELECT MAX(COALESCE((SELECT MAX(id) FROM imports), 0), COALESCE((SELECT MAX(batch) FROM hands), 0)) + 1", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        self.conn
            .execute("INSERT INTO imports (id, ts, label, status) VALUES (?1, ?2, ?3, 'en cours')", params![id, ts, label])
            .map_err(|e| e.to_string())?;
        Ok(id)
    }

    pub fn finish_import(&self, id: i64, sources: i64, hands: i64, imported: i64, dup: i64, invalid: i64, status: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE imports SET sources=?1, hands=?2, imported=?3, duplicates=?4, invalid=?5, status=?6 WHERE id=?7",
                params![sources, hands, imported, dup, invalid, status, id],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// Supprime un import : ses mains, les tournois devenus vides, et la ligne d'historique.
    pub fn delete_import(&mut self, id: i64) -> Result<(usize, usize), String> {
        let (imported, in_batch): (i64, i64) = self
            .conn
            .query_row("SELECT imported, (SELECT COUNT(*) FROM hands WHERE batch = ?1) FROM imports WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?;
        if in_batch > imported {
            return Err(format!("suppression refusée : le lot contient {in_batch} mains pour {imported} importées"));
        }
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        let hands = tx.execute("DELETE FROM hands WHERE batch = ?1", params![id]).map_err(|e| e.to_string())?;
        let tours = tx
            .execute("DELETE FROM tournaments WHERE id NOT IN (SELECT DISTINCT tid FROM hands)", [])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM imports WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok((hands, tours))
    }

    /// Supprime des tournois et toutes leurs mains (utilisé pour purger les formats hors Spin).
    pub fn delete_tournaments(&mut self, ids: &[String]) -> Result<usize, String> {
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        let mut n = 0;
        for id in ids {
            tx.execute("DELETE FROM hands WHERE tid = ?1", params![id]).map_err(|e| e.to_string())?;
            n += tx.execute("DELETE FROM tournaments WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(n)
    }

    pub fn load_favorites(&self) -> Result<std::collections::HashMap<String, String>, String> {
        let mut st = self.conn.prepare("SELECT hand_id, note FROM favorites").map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    pub fn set_favorite(&self, hand_id: &str, on: bool, note: &str, ts: i64) -> Result<(), String> {
        if on {
            self.conn
                .execute("INSERT OR REPLACE INTO favorites (hand_id, ts, note) VALUES (?1, ?2, ?3)", params![hand_id, ts, note])
                .map_err(|e| e.to_string())?;
        } else {
            self.conn.execute("DELETE FROM favorites WHERE hand_id = ?1", params![hand_id]).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn imports(&self) -> Result<Vec<serde_json::Value>, String> {
        let mut st = self
            .conn
            .prepare("SELECT ts, sources, hands, imported, duplicates, invalid, status, id, COALESCE(label,''), (SELECT COUNT(*) FROM hands WHERE hands.batch = imports.id) FROM imports ORDER BY id DESC LIMIT 200")
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| {
                Ok(serde_json::json!({
                    "ts": r.get::<_, i64>(0)?, "sources": r.get::<_, i64>(1)?, "hands": r.get::<_, i64>(2)?,
                    "imported": r.get::<_, i64>(3)?, "duplicates": r.get::<_, i64>(4)?, "invalid": r.get::<_, i64>(5)?,
                    "status": r.get::<_, String>(6)?, "id": r.get::<_, i64>(7)?, "label": r.get::<_, String>(8)?,
                    "remaining": r.get::<_, i64>(9)?
                }))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    pub fn wipe(&self) -> Result<(), String> {
        self.conn.execute_batch("DELETE FROM hands; DELETE FROM tournaments; DELETE FROM imports; DELETE FROM favorites; VACUUM;").map_err(|e| e.to_string())
    }

    // ------------------------------------------------------------ historique des solves

    pub fn solve_insert(&self, ts: i64, kind: &str, hand_id: Option<&str>, label: &str, config: &str) -> Result<i64, String> {
        self.conn
            .execute("INSERT INTO solves (ts, kind, hand_id, label, config, status) VALUES (?1, ?2, ?3, ?4, ?5, 'running')", params![ts, kind, hand_id, label, config])
            .map_err(|e| e.to_string())?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn solve_finish(&self, id: i64, status: &str, exploit: Option<f64>, iters: i64, seconds: f64, bytes: i64) -> Result<(), String> {
        self.conn
            .execute("UPDATE solves SET status = ?2, exploit = ?3, iters = ?4, seconds = ?5, bytes = ?6 WHERE id = ?1", params![id, status, exploit, iters, seconds, bytes])
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// Solves restés « en cours » après un arrêt de l'application.
    pub fn solve_mark_interrupted(&self) {
        let _ = self.conn.execute("UPDATE solves SET status = 'interrompu' WHERE status = 'running'", []);
    }

    pub fn solve_config(&self, id: i64) -> Result<(String, String), String> {
        self.conn
            .query_row("SELECT config, status FROM solves WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|_| "solve introuvable".to_string())
    }

    pub fn solves(&self, trash: bool) -> Result<Vec<serde_json::Value>, String> {
        let sql = format!(
            "SELECT id, ts, kind, hand_id, label, config, status, exploit, iters, seconds, bytes, fav, note, deleted_at, storage FROM solves WHERE deleted_at IS {} NULL ORDER BY id DESC",
            if trash { "NOT" } else { "" }
        );
        let mut st = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| {
                let cfg: String = r.get(5)?;
                Ok(serde_json::json!({
                    "id": r.get::<_, i64>(0)?, "ts": r.get::<_, i64>(1)?, "kind": r.get::<_, String>(2)?,
                    "hand_id": r.get::<_, Option<String>>(3)?, "label": r.get::<_, String>(4)?,
                    "config": serde_json::from_str::<serde_json::Value>(&cfg).unwrap_or(serde_json::Value::Null),
                    "status": r.get::<_, String>(6)?, "exploit": r.get::<_, Option<f64>>(7)?, "iters": r.get::<_, i64>(8)?,
                    "seconds": r.get::<_, f64>(9)?, "bytes": r.get::<_, i64>(10)?, "fav": r.get::<_, i64>(11)? != 0,
                    "note": r.get::<_, String>(12)?, "deleted_at": r.get::<_, Option<i64>>(13)?,
                    "storage": r.get::<_, String>(14)?,
                }))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    pub fn solve_update(&self, id: i64, fav: Option<bool>, note: Option<&str>, label: Option<&str>) -> Result<(), String> {
        if let Some(f) = fav {
            self.conn.execute("UPDATE solves SET fav = ?2 WHERE id = ?1", params![id, f as i64]).map_err(|e| e.to_string())?;
        }
        if let Some(n) = note {
            self.conn.execute("UPDATE solves SET note = ?2 WHERE id = ?1", params![id, n]).map_err(|e| e.to_string())?;
        }
        if let Some(l) = label {
            self.conn.execute("UPDATE solves SET label = ?2 WHERE id = ?1", params![id, l]).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn solve_storage(&self, id: i64, storage: &str, bytes: i64) -> Result<(), String> {
        self.conn.execute("UPDATE solves SET storage = ?2, bytes = ?3 WHERE id = ?1", params![id, storage, bytes]).map(|_| ()).map_err(|e| e.to_string())
    }

    /// Corbeille : `ts` = date de suppression, `None` = restauration.
    pub fn solve_trash(&self, id: i64, ts: Option<i64>) -> Result<(), String> {
        self.conn.execute("UPDATE solves SET deleted_at = ?2 WHERE id = ?1", params![id, ts]).map(|_| ()).map_err(|e| e.to_string())
    }

    /// Suppression définitive des solves en corbeille ; renvoie leurs ids (fichiers à effacer).
    pub fn solve_purge(&self) -> Result<Vec<i64>, String> {
        let ids: Vec<i64> = self
            .conn
            .prepare("SELECT id FROM solves WHERE deleted_at IS NOT NULL")
            .and_then(|mut st| st.query_map([], |r| r.get(0))?.collect())
            .map_err(|e| e.to_string())?;
        self.conn.execute("DELETE FROM solves WHERE deleted_at IS NOT NULL", []).map_err(|e| e.to_string())?;
        Ok(ids)
    }
}
