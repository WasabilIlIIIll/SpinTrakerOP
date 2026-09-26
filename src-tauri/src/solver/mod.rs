//! Solver GTO de Spin Tracker OP (voir le cahier des charges du solver).
//!
//! - `ranges`   : ranges, analyseur façon Flopzilla (catégories, équité exacte).
//! - `postflop` : arbre Spin et lecture des nœuds, sur le moteur postflop-solver (fork AGPL).
//! - `spot`     : reconstruction d'un spot postflop depuis une main importée.
//! - ce module  : tâche de fond (un solve à la fois), fichiers de résultats, cache du solve ouvert.

pub mod commands;
pub mod lab;
pub mod postflop;
pub mod multiway;
pub mod preflop;
pub mod ranges;
pub mod spot;

use crate::db::Db;
use parking_lot::Mutex;
use postflop_solver::{compute_exploitability, finalize, load_data_from_file, save_data_to_file, solve_step, BoardState, PostFlopGame};
use postflop::PostflopConfig;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

/// Plafond fixé par Laszlo : le solver n'utilise jamais plus de 25 Go de RAM. Un arbre plus gros
/// en 32 bits est stocké compressé (16 bits, précision toujours mesurée) ; au-delà, refus.
pub const MAX_MEMORY: u64 = 25_000_000_000;

#[derive(Debug, Clone, Serialize, Default)]
pub struct JobStatus {
    pub id: i64,
    pub state: String,
    pub iter: u32,
    pub max_iters: u32,
    /// exploitabilité en % du pot (None avant la première mesure)
    pub exploit: Option<f64>,
    pub target: f64,
    pub seconds: f64,
    pub memory_mb: f64,
    pub message: String,
    /// « postflop » ou « preflop »
    pub kind: String,
    /// avancement global 0..1 (préflop)
    pub progress: f64,
}

pub struct Hub {
    pub dir: PathBuf,
    pub job: Mutex<Option<JobStatus>>,
    cancel: AtomicBool,
    /// mode session : tout nouveau calcul est refusé (bouton « Couper le solver »)
    pub locked: AtomicBool,
    /// solve ouvert dans l'interface
    pub open: Mutex<Option<Opened>>,
    /// tables à 3 joueurs (chargées une fois)
    tri: Mutex<Option<Arc<preflop::tri::TriTables>>>,
    /// solution préflop ouverte
    pub open_pre: Mutex<Option<(i64, Arc<preflop::run::Solution>)>>,
}

pub struct Opened {
    pub id: i64,
    pub cfg: PostflopConfig,
    pub game: PostFlopGame,
    /// rivers re-résolues à la demande (solve enregistré sans river)
    pub rivers: postflop::Rivers,
}

pub fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

impl Hub {
    pub fn new(data_dir: &std::path::Path) -> Hub {
        let dir = data_dir.join("solves");
        let _ = std::fs::create_dir_all(&dir);
        Hub { dir, job: Mutex::new(None), cancel: AtomicBool::new(false), locked: AtomicBool::new(false), open: Mutex::new(None), tri: Mutex::new(None), open_pre: Mutex::new(None) }
    }

    pub fn file(&self, id: i64) -> PathBuf {
        self.dir.join(format!("{id}.bin"))
    }

    /// Refus de tout calcul en mode session.
    pub fn guard(&self) -> Result<(), String> {
        if self.locked.load(Ordering::SeqCst) {
            return Err("mode session actif : le solver est coupé. Désactive-le dans le menu pour calculer.".into());
        }
        Ok(())
    }

    /// Arrête tout calcul en cours, attend sa fin (au plus `wait`) et libère la mémoire des arbres.
    /// Renvoie vrai si plus rien ne tourne.
    pub fn kill_all(&self, wait: std::time::Duration) -> bool {
        self.cancel.store(true, Ordering::SeqCst);
        let t0 = Instant::now();
        while self.is_running() && t0.elapsed() < wait {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let stopped = !self.is_running();
        *self.open.lock() = None;
        *self.open_pre.lock() = None;
        if stopped {
            *self.tri.lock() = None;
        }
        stopped
    }

    pub fn tables_ready(&self) -> bool {
        self.tri.lock().is_some() || preflop::tri::TriTables::exists(self.dir.parent().unwrap_or(&self.dir))
    }

    /// Prépare les tables à 3 joueurs en tâche de fond (une seule fois, annulable).
    pub fn start_tables(self: &Arc<Self>) -> Result<(), String> {
        self.guard()?;
        if self.is_running() {
            return Err("un calcul est déjà en cours".into());
        }
        self.cancel.store(false, Ordering::SeqCst);
        *self.job.lock() = Some(JobStatus { state: "running".into(), kind: "tables".into(), message: "Tables d'équité à 3 joueurs".into(), ..Default::default() });
        let hub = self.clone();
        std::thread::spawn(move || {
            let t0 = Instant::now();
            let r = hub.tri_tables(&|d, n| {
                if let Some(j) = hub.job.lock().as_mut() {
                    j.progress = d as f64 / n as f64;
                    j.seconds = t0.elapsed().as_secs_f64();
                    j.message = format!("Tables d'équité à 3 joueurs (une seule fois) : {} %", d * 100 / n);
                }
            });
            if let Some(j) = hub.job.lock().as_mut() {
                j.state = match &r {
                    Ok(_) => "ok".into(),
                    Err(_) if hub.cancel.load(Ordering::SeqCst) => "arrete".into(),
                    Err(_) => "erreur".into(),
                };
                j.message = r.err().unwrap_or_default();
                j.progress = 1.0;
                j.seconds = t0.elapsed().as_secs_f64();
            }
        });
        Ok(())
    }

    pub fn is_running(&self) -> bool {
        self.job.lock().as_ref().map(|j| j.state == "running").unwrap_or(false)
    }

    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    /// Lance un solve postflop en tâche de fond. Retourne l'id de l'historique.
    pub fn start_postflop(self: &Arc<Self>, db: Arc<Mutex<Db>>, cfg: PostflopConfig, hand_id: Option<String>, label: String) -> Result<i64, String> {
        self.guard()?;
        if self.is_running() {
            return Err("un solve est déjà en cours : attendez sa fin ou arrêtez-le".into());
        }
        // validation immédiate (ranges, board, tailles) avant de créer l'entrée d'historique
        let mut game = postflop::build(&cfg)?;
        let (mem, mem_c) = game.memory_usage();
        if mem_c > MAX_MEMORY {
            return Err(format!("arbre trop gros : {:.1} Go même compressé (plafond 25 Go). Réduisez les tailles ou les ranges.", mem_c as f64 / 1e9));
        }
        let compress = mem > MAX_MEMORY;
        let used = if compress { mem_c } else { mem };
        let cfg_json = serde_json::to_string(&cfg).map_err(|e| e.to_string())?;
        let id = db.lock().solve_insert(now(), "postflop", hand_id.as_deref(), &label, &cfg_json)?;
        self.cancel.store(false, Ordering::SeqCst);
        *self.job.lock() = Some(JobStatus {
            id,
            state: "running".into(),
            max_iters: cfg.max_iters,
            target: cfg.precision,
            memory_mb: used as f64 / 1e6,
            message: "Construction de l'arbre".into(),
            kind: "postflop".into(),
            ..Default::default()
        });
        let hub = self.clone();
        std::thread::spawn(move || {
            let t0 = Instant::now();
            game.allocate_memory(compress);
            let pot = game.tree_config().starting_pot as f32;
            let target = pot * (cfg.precision as f32) / 100.0;
            let mut exploit = f32::MAX;
            let mut iters = 0;
            let mut cancelled = false;
            for i in 0..cfg.max_iters {
                if hub.cancel.load(Ordering::SeqCst) {
                    cancelled = true;
                    break;
                }
                solve_step(&game, i);
                iters = i + 1;
                if iters % 10 == 0 || iters == cfg.max_iters {
                    exploit = compute_exploitability(&game);
                    if let Some(j) = hub.job.lock().as_mut() {
                        j.iter = iters;
                        j.exploit = Some((exploit / pot * 100.0) as f64);
                        j.seconds = t0.elapsed().as_secs_f64();
                        j.message = "Calcul".into();
                    }
                    if exploit <= target {
                        break;
                    }
                }
            }
            if exploit == f32::MAX && iters > 0 {
                exploit = compute_exploitability(&game);
            }
            finalize(&mut game);
            let pct = if exploit.is_finite() && exploit < f32::MAX { (exploit / pot * 100.0) as f64 } else { f64::NAN };
            let status = if cancelled {
                "arrete"
            } else if exploit <= target {
                "ok"
            } else {
                "non_converge"
            };
            if let Some(j) = hub.job.lock().as_mut() {
                j.message = "Enregistrement".into();
            }
            // depuis un flop, la river pèse ~97 % du fichier (1,7 Go mesuré contre 44 Mo sans elle) :
            // on enregistre flop + turn, la river est re-résolue à la demande depuis les ranges exactes
            let storage = if game.tree_config().initial_state == BoardState::Flop {
                let _ = game.set_target_storage_mode(BoardState::Turn);
                "turn"
            } else {
                "river"
            };
            let path = hub.file(id);
            let saved = save_data_to_file(&game, "", &path, Some(3));
            let _ = game.set_target_storage_mode(BoardState::River);
            let bytes = std::fs::metadata(&path).map(|m| m.len() as i64).unwrap_or(0);
            let secs = t0.elapsed().as_secs_f64();
            let (state, msg) = match saved {
                Ok(()) => (status.to_string(), String::new()),
                Err(e) => ("erreur".to_string(), format!("enregistrement impossible : {e}")),
            };
            {
                let db = db.lock();
                let _ = db.solve_finish(id, &state, if pct.is_nan() { None } else { Some(pct) }, iters as i64, secs, bytes);
                let _ = db.solve_storage(id, storage, bytes);
            }
            *hub.open.lock() = Some(Opened { id, cfg, game, rivers: Default::default() });
            if let Some(j) = hub.job.lock().as_mut() {
                j.state = state;
                j.iter = iters;
                j.exploit = if pct.is_nan() { None } else { Some(pct) };
                j.seconds = secs;
                j.message = msg;
            }
        });
        Ok(id)
    }

    /// Charge (ou garde) le solve `id` et exécute `f` sur son arbre.
    pub fn with_open<T>(&self, id: i64, cfg_json: &str, f: impl FnOnce(&mut Opened) -> Result<T, String>) -> Result<T, String> {
        let mut open = self.open.lock();
        if open.as_ref().map(|o| o.id) != Some(id) {
            if self.job.lock().as_ref().map(|j| j.id == id && j.state == "running").unwrap_or(false) {
                return Err("solve en cours de calcul".into());
            }
            let cfg: PostflopConfig = serde_json::from_str(cfg_json).map_err(|e| format!("paramètres illisibles : {e}"))?;
            *open = None; // libère la mémoire de l'arbre précédent avant de charger
            let (game, _memo): (PostFlopGame, String) = load_data_from_file(self.file(id), Some(MAX_MEMORY)).map_err(|e| format!("fichier de solve illisible : {e}"))?;
            *open = Some(Opened { id, cfg, game, rivers: Default::default() });
        }
        f(open.as_mut().unwrap())
    }

    /// Réécrit le fichier d'un solve en ne gardant que le flop (`keep_turn = false`) ou le flop et
    /// le turn. Irréversible : les streets retirées devront être re-résolues. Renvoie la taille.
    pub fn lighten(&self, id: i64, cfg_json: &str, keep_turn: bool) -> Result<i64, String> {
        let path = self.file(id);
        let tmp = self.dir.join(format!("{id}.tmp"));
        self.with_open(id, cfg_json, |op| {
            let game = &mut op.game;
            let mode = if keep_turn { BoardState::Turn } else { BoardState::Flop };
            game.set_target_storage_mode(mode)?;
            let r = save_data_to_file(game, "", &tmp, Some(3));
            let _ = game.set_target_storage_mode(game.storage_mode());
            r
        })?;
        // l'arbre complet en mémoire ne correspond plus au fichier : on le relâche
        *self.open.lock() = None;
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        Ok(std::fs::metadata(&path).map(|m| m.len() as i64).unwrap_or(0))
    }

    pub fn pre_file(&self, id: i64) -> PathBuf {
        self.dir.join(format!("{id}.pre"))
    }

    pub fn tri_tables(&self, progress: &(dyn Fn(usize, usize) + Sync)) -> Result<Arc<preflop::tri::TriTables>, String> {
        let mut t = self.tri.lock();
        if let Some(x) = t.as_ref() {
            return Ok(x.clone());
        }
        let data = self.dir.parent().unwrap_or(&self.dir).to_path_buf();
        let x = Arc::new(preflop::tri::TriTables::load_or_build(&data, &self.cancel, progress)?);
        *t = Some(x.clone());
        Ok(x)
    }

    /// Lance le calcul d'une solution préflop en tâche de fond.
    pub fn start_preflop(self: &Arc<Self>, db: Arc<Mutex<Db>>, req: preflop::run::PreflopRequest, label: String) -> Result<i64, String> {
        self.start_preflop_batch(db, vec![(req, label)])
    }

    /// File de solutions préflop (bibliothèque) : calculées l'une après l'autre, chacune
    /// enregistrée dans l'historique dès qu'elle est finie. Renvoie l'id de la première.
    pub fn start_preflop_batch(self: &Arc<Self>, db: Arc<Mutex<Db>>, reqs: Vec<(preflop::run::PreflopRequest, String)>) -> Result<i64, String> {
        self.guard()?;
        if self.is_running() {
            return Err("un calcul est déjà en cours : attendez sa fin ou arrêtez-le".into());
        }
        if reqs.is_empty() {
            return Err("aucune configuration".into());
        }
        for (r, _) in &reqs {
            preflop::tree::Tree::build(&r.config)?;
        }
        let first = {
            let (r, l) = &reqs[0];
            db.lock().solve_insert(now(), "preflop", None, l, &serde_json::to_string(r).map_err(|e| e.to_string())?)?
        };
        self.cancel.store(false, Ordering::SeqCst);
        *self.job.lock() = Some(JobStatus { id: first, state: "running".into(), kind: "preflop".into(), message: "Préparation".into(), target: reqs[0].0.target, ..Default::default() });
        let hub = self.clone();
        std::thread::spawn(move || {
            let total = reqs.len();
            for (k, (req, label)) in reqs.into_iter().enumerate() {
                if hub.cancel.load(Ordering::SeqCst) {
                    break;
                }
                let id = if k == 0 {
                    first
                } else {
                    match serde_json::to_string(&req).map_err(|e| e.to_string()).and_then(|c| db.lock().solve_insert(now(), "preflop", None, &label, &c)) {
                        Ok(i) => i,
                        Err(_) => break,
                    }
                };
                if let Some(j) = hub.job.lock().as_mut() {
                    j.id = id;
                    j.state = "running".into();
                    j.exploit = None;
                    j.progress = 0.0;
                }
                let prefix = if total > 1 { format!("Bibliothèque {}/{} · {} · ", k + 1, total, label) } else { String::new() };
                let (state, _) = hub.run_preflop(&db, id, &req, &prefix);
                if state == "erreur" && total == 1 {
                    return;
                }
            }
        });
        Ok(first)
    }

    fn run_preflop(&self, db: &Arc<Mutex<Db>>, id: i64, req: &preflop::run::PreflopRequest, prefix: &str) -> (String, String) {
        let t0 = Instant::now();
        let set = |msg: &str, p: f64, e: Option<f64>| {
            if let Some(j) = self.job.lock().as_mut() {
                j.message = format!("{prefix}{msg}");
                j.progress = p;
                if e.is_some() {
                    j.exploit = e;
                }
                j.seconds = t0.elapsed().as_secs_f64();
            }
        };
        let tri = if req.config.stacks.len() == 3 {
            match self.tri_tables(&|d, n| set(&format!("Tables d'équité à 3 joueurs (une seule fois) : {} %", d * 100 / n), 0.0, None)) {
                Ok(t) => Some(t),
                Err(e) => {
                    let _ = db.lock().solve_finish(id, "erreur", None, 0, 0.0, 0);
                    if let Some(j) = self.job.lock().as_mut() {
                        j.state = "erreur".into();
                        j.message = e.clone();
                    }
                    return ("erreur".into(), e);
                }
            }
        } else {
            None
        };
        let res = preflop::run::run(req, tri.as_deref(), &self.cancel, &preflop::run::Progress { f: &|m, p, e| set(m, p, e) });
        let secs = t0.elapsed().as_secs_f64();
        let (state, msg, expl, iters, bytes) = match res {
            Ok(sol) => {
                let bytes = rmp_serde::to_vec(&sol).map_err(|e| e.to_string()).and_then(|b| std::fs::write(self.pre_file(id), &b).map(|_| b.len() as i64).map_err(|e| e.to_string()));
                let cancelled = self.cancel.load(Ordering::SeqCst);
                let st = if cancelled { "arrete" } else if sol.exploit <= req.target * 4.0 { "ok" } else { "non_converge" };
                let (e, it) = (sol.exploit, sol.iterations);
                *self.open_pre.lock() = Some((id, Arc::new(sol)));
                match bytes {
                    Ok(b) => (st.to_string(), String::new(), Some(e), it, b),
                    Err(err) => ("erreur".to_string(), err, Some(e), it, 0),
                }
            }
            Err(e) => (if self.cancel.load(Ordering::SeqCst) { "arrete" } else { "erreur" }.to_string(), e, None, 0, 0),
        };
        let _ = db.lock().solve_finish(id, &state, expl, iters as i64, secs, bytes);
        if let Some(j) = self.job.lock().as_mut() {
            j.state = state.clone();
            j.message = msg.clone();
            j.exploit = expl;
            j.iter = iters;
            j.seconds = secs;
            j.progress = 1.0;
        }
        (state, msg)
    }

    pub fn load_pre(&self, id: i64) -> Result<Arc<preflop::run::Solution>, String> {
        let mut o = self.open_pre.lock();
        if let Some((i, s)) = o.as_ref() {
            if *i == id {
                return Ok(s.clone());
            }
        }
        let b = std::fs::read(self.pre_file(id)).map_err(|_| "solution préflop introuvable".to_string())?;
        let s: preflop::run::Solution = rmp_serde::from_slice(&b).map_err(|e| format!("solution illisible : {e}"))?;
        let s = Arc::new(s);
        *o = Some((id, s.clone()));
        Ok(s)
    }
}
