//! Pipeline d'import : lecture parallèle, parsing, déduplication, analyse, sauvegarde.

use crate::analysis::{analyze, HandFacts};
use crate::db::Db;
use crate::model::{Hand, Tournament};
use crate::parser::{collect_paths, parse_source, read_path};
use crate::store::Store;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Serialize, Default, Clone)]
pub struct ImportResult {
    pub sources: usize,
    pub hands: usize,
    pub imported: usize,
    pub duplicates: usize,
    pub invalid: usize,
    pub tournaments: usize,
    pub errors: Vec<String>,
    pub millis: u128,
}

#[derive(Serialize, Clone)]
pub struct Progress {
    pub phase: String,
    pub done: usize,
    pub total: usize,
}

pub fn run(
    paths: Vec<PathBuf>,
    store: &parking_lot::RwLock<Store>,
    db: &parking_lot::Mutex<Db>,
    progress: &(dyn Fn(Progress) + Sync),
) -> ImportResult {
    let t0 = std::time::Instant::now();
    let files = collect_paths(&paths);
    let total = files.len();
    progress(Progress { phase: "lecture".into(), done: 0, total });
    let done = AtomicUsize::new(0);
    let parsed: Vec<(usize, Result<Vec<crate::parser::ParsedFile>, String>, String)> = files
        .par_iter()
        .flat_map_iter(|p| {
            let sources = read_path(p);
            let d = done.fetch_add(1, Ordering::Relaxed) + 1;
            if d % 25 == 0 || d == total {
                progress(Progress { phase: "lecture".into(), done: d, total });
            }
            sources.into_iter().map(|s| (1usize, parse_source(&s), s.name)).collect::<Vec<_>>()
        })
        .collect();

    let mut res = ImportResult { sources: parsed.len(), ..Default::default() };
    let existing: HashSet<String> = {
        let st = store.read();
        st.hands.iter().map(|r| r.h.id.clone()).collect()
    };
    let mut new_tours: HashMap<String, Tournament> = HashMap::new();
    let mut new_hands: Vec<Hand> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for (_, r, name) in parsed {
        match r {
            Ok(files) => {
                for pf in files {
                    for h in pf.hands {
                        res.hands += 1;
                        if existing.contains(&h.id) || !seen.insert(h.id.clone()) {
                            res.duplicates += 1;
                        } else {
                            new_hands.push(h);
                        }
                    }
                    let t = pf.tournament;
                    match new_tours.get_mut(&t.id) {
                        Some(ex) => crate::store::merge_tournament(ex, t),
                        None => {
                            new_tours.insert(t.id.clone(), t);
                        }
                    }
                }
            }
            Err(e) => {
                res.invalid += 1;
                if res.errors.len() < 50 {
                    let short = name.rsplit(['/', '\\']).next().unwrap_or(&name).to_string();
                    res.errors.push(format!("{short} : {e}"));
                }
            }
        }
    }
    let n_new = new_hands.len();
    progress(Progress { phase: "analyse".into(), done: 0, total: n_new });
    let done = AtomicUsize::new(0);
    let analyzed: Vec<(Hand, HandFacts)> = new_hands
        .into_par_iter()
        .map(|h| {
            let f = analyze(&h);
            let d = done.fetch_add(1, Ordering::Relaxed) + 1;
            if d % 500 == 0 || d == n_new {
                progress(Progress { phase: "analyse".into(), done: d, total: n_new });
            }
            (h, f)
        })
        .collect();
    res.imported = analyzed.len();

    // fusion avec les tournois déjà connus
    let mut st = store.write();
    let mut tours: Vec<Tournament> = std::mem::take(&mut st.tours).into_iter().map(|t| t.t).collect();
    let mut idx: HashMap<String, usize> = tours.iter().enumerate().map(|(i, t)| (t.id.clone(), i)).collect();
    let mut changed: Vec<Tournament> = Vec::new();
    for (id, t) in new_tours {
        match idx.get(&id) {
            Some(&i) => {
                crate::store::merge_tournament(&mut tours[i], t);
                changed.push(tours[i].clone());
            }
            None => {
                idx.insert(id, tours.len());
                changed.push(t.clone());
                tours.push(t);
            }
        }
    }
    res.tournaments = changed.len();
    progress(Progress { phase: "sauvegarde".into(), done: 0, total: 1 });
    {
        let mut dbg = db.lock();
        if let Err(e) = dbg.save_batch(&changed, &analyzed) {
            res.errors.push(format!("base de données : {e}"));
        }
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
        let _ = dbg.log_import(now, res.sources as i64, res.hands as i64, res.imported as i64, res.duplicates as i64, res.invalid as i64, "ok");
    }
    let mut hands: Vec<(Hand, HandFacts)> = std::mem::take(&mut st.hands).into_iter().map(|r| (r.h, r.f)).collect();
    hands.extend(analyzed);
    st.rebuild(tours, hands);
    progress(Progress { phase: "termine".into(), done: 1, total: 1 });
    res.millis = t0.elapsed().as_millis();
    res
}

/// Chargement initial : recalcule les faits manquants ou obsolètes.
pub fn load(db: &mut Db, store: &mut Store) -> Result<(), String> {
    let tours = db.load_tournaments()?;
    let raw = db.load_hands()?;
    let mut stale = Vec::new();
    let hands: Vec<(Hand, HandFacts)> = raw
        .into_par_iter()
        .map(|(h, f)| match f {
            Some(f) => (h, f, false),
            None => {
                let f = analyze(&h);
                (h, f, true)
            }
        })
        .collect::<Vec<_>>()
        .into_iter()
        .map(|(h, f, s)| {
            if s {
                stale.push((h.id.clone(), f.clone()));
            }
            (h, f)
        })
        .collect();
    if !stale.is_empty() {
        db.save_facts(&stale)?;
    }
    store.rebuild(tours, hands);
    Ok(())
}
