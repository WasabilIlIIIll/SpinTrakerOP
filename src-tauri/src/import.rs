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
    /// tournois écartés car hors format Spin (MTT, freeroll, SNG…)
    pub skipped: usize,
    pub errors: Vec<String>,
    pub millis: u128,
    /// numéro de lot : permet de supprimer cet import depuis l'historique
    pub batch: i64,
}

#[derive(Serialize, Clone)]
pub struct Progress {
    pub phase: String,
    pub done: usize,
    pub total: usize,
}

pub fn run(paths: Vec<PathBuf>, store: &parking_lot::RwLock<Store>, db: &parking_lot::Mutex<Db>, progress: &(dyn Fn(Progress) + Sync)) -> ImportResult {
    run_with(paths, None, store, db, progress)
}

/// `room` : room imposée aux fichiers iPoker (sinon détectée : contenu, chemin, pseudo du héros).
pub fn run_with(
    paths: Vec<PathBuf>,
    room: Option<String>,
    store: &parking_lot::RwLock<Store>,
    db: &parking_lot::Mutex<Db>,
    progress: &(dyn Fn(Progress) + Sync),
) -> ImportResult {
    let t0 = std::time::Instant::now();
    let files = collect_paths(&paths);
    // libellé lisible de l'import (dossier ou nom de fichier)
    let label = match paths.len() {
        0 => String::new(),
        1 => paths[0].file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
        n => format!("{} sources", n),
    };
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

    // room des XML iPoker non identifiée : celle où le pseudo du héros a déjà été vu
    let hero_room: HashMap<String, String> = {
        let mut seen: HashMap<String, HashSet<String>> = HashMap::new();
        let st = store.read();
        let known = st.tours.iter().map(|t| &t.t).filter(|t| !t.id.starts_with("ipk:"));
        let fresh = parsed.iter().filter_map(|(_, r, _)| r.as_ref().ok()).flatten().map(|pf| &pf.tournament);
        for t in known.chain(fresh).filter(|t| !t.room.is_empty()) {
            seen.entry(t.hero.clone()).or_default().insert(t.room.clone());
        }
        seen.into_iter().filter(|(_, r)| r.len() == 1).map(|(h, r)| (h, r.into_iter().next().unwrap())).collect()
    };
    // tournois déjà en base mais lus par une version antérieure du parser, incomplète
    // (Betclic sans prize pool ni place) : un réimport les remplace au lieu de les ignorer
    let refresh: HashSet<String> = {
        let st = store.read();
        parsed
            .iter()
            .filter_map(|(_, r, _)| r.as_ref().ok())
            .flatten()
            .map(|pf| &pf.tournament)
            .filter(|t| t.id.starts_with("bcl:") && t.prize_pool > 0.0)
            .filter(|t| st.tindex.get(&t.id).map(|&i| st.tours[i].t.prize_pool <= 0.0).unwrap_or(false))
            .map(|t| t.id.clone())
            .collect()
    };
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
                    // les tapis de départ ne sont connus qu'après lecture des mains
                    let mut t0 = pf.tournament.clone();
                    if t0.starting_stack <= 0.0 {
                        if let Some(h) = pf.hands.first() {
                            t0.starting_stack = h.seats[h.hero as usize].stack;
                        }
                    }
                    if !t0.is_spin() {
                        res.skipped += 1;
                        if res.errors.len() < 50 {
                            res.errors.push(format!("{} : hors format Spin ({} joueurs, tapis {:.0}) — ignoré", t0.name, t0.table_size, t0.starting_stack));
                        }
                        continue;
                    }
                    for h in pf.hands {
                        res.hands += 1;
                        if (existing.contains(&h.id) && !refresh.contains(&h.tid)) || !seen.insert(h.id.clone()) {
                            res.duplicates += 1;
                        } else {
                            new_hands.push(h);
                        }
                    }
                    let mut t = pf.tournament;
                    if let Some(r) = &room {
                        if t.id.starts_with("ipk:") {
                            t.room = r.clone();
                        }
                    }
                    if t.room.is_empty() {
                        t.room = hero_room.get(&t.hero).cloned().unwrap_or_else(|| "PMU".into());
                    }
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
            Some(&i) if refresh.contains(&id) => {
                tours[i] = t;
                changed.push(tours[i].clone());
            }
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
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
        let batch = dbg.start_import(now, &label).unwrap_or(0);
        res.batch = batch;
        let replace: Vec<String> = refresh.iter().cloned().collect();
        if let Err(e) = dbg.save_batch(&changed, &analyzed, batch, &replace) {
            res.errors.push(format!("base de données : {e}"));
        }
        let _ = dbg.finish_import(batch, res.sources as i64, res.hands as i64, res.imported as i64, res.duplicates as i64, res.invalid as i64, "ok");
        // l'import est écrit dans le fichier principal : rien ne dépend plus du journal WAL
        dbg.checkpoint();
    }
    let mut hands: Vec<(Hand, HandFacts)> =
        std::mem::take(&mut st.hands).into_iter().filter(|r| !refresh.contains(&r.h.tid)).map(|r| (r.h, r.f)).collect();
    hands.extend(analyzed);
    st.rebuild(tours, hands);
    progress(Progress { phase: "termine".into(), done: 1, total: 1 });
    res.millis = t0.elapsed().as_millis();
    res
}

/// Chargement initial : recalcule les faits manquants ou obsolètes, et purge les
/// tournois hors format Spin importés par une version antérieure.
pub fn load(db: &mut Db, store: &mut Store) -> Result<(), String> {
    let mut tours = db.load_tournaments()?;
    let mut raw = db.load_hands()?;
    // tapis de départ éventuellement absent : on le complète depuis la première main
    let mut first_stack: HashMap<String, f64> = HashMap::new();
    for (h, _) in &raw {
        first_stack.entry(h.tid.clone()).or_insert_with(|| h.seats[h.hero as usize].stack);
    }
    let bad: HashSet<String> = tours
        .iter()
        .filter(|t| {
            let mut t2 = (*t).clone();
            if t2.starting_stack <= 0.0 {
                t2.starting_stack = first_stack.get(&t2.id).copied().unwrap_or(0.0);
            }
            !t2.is_spin()
        })
        .map(|t| t.id.clone())
        .collect();
    if !bad.is_empty() {
        let ids: Vec<String> = bad.iter().cloned().collect();
        let _ = db.delete_tournaments(&ids);
        tours.retain(|t| !bad.contains(&t.id));
        raw.retain(|(h, _)| !bad.contains(&h.tid));
    }
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
