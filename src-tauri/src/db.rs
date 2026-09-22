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
             CREATE TABLE IF NOT EXISTS favorites (hand_id TEXT PRIMARY KEY, ts INTEGER, note TEXT NOT NULL DEFAULT '');",
        )
        .map_err(|e| e.to_string())?;
        // migrations souples (colonnes ajoutées après coup)
        let _ = conn.execute("ALTER TABLE hands ADD COLUMN batch INTEGER DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE imports ADD COLUMN label TEXT DEFAULT ''", []);
        let _ = conn.execute("CREATE INDEX IF NOT EXISTS hands_batch ON hands(batch)", []);
        Ok(Db { conn })
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

    pub fn save_batch(&mut self, ts: &[Tournament], hands: &[(Hand, HandFacts)], batch: i64) -> Result<(), String> {
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        {
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
        self.conn
            .execute("INSERT INTO imports (ts, label, status) VALUES (?1, ?2, 'en cours')", params![ts, label])
            .map_err(|e| e.to_string())?;
        Ok(self.conn.last_insert_rowid())
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
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        let hands = tx.execute("DELETE FROM hands WHERE batch = ?1", params![id]).map_err(|e| e.to_string())?;
        let tours = tx
            .execute("DELETE FROM tournaments WHERE id NOT IN (SELECT DISTINCT tid FROM hands)", [])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM imports WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok((hands, tours))
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
}
