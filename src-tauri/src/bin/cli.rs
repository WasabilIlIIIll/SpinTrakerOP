//! Spin Tracker OP — outil en ligne de commande (import headless, statistiques).
//!
//! Exemples :
//!   spinop-cli import "C:/histo/PMU"     importe un dossier dans la base de l'application
//!   spinop-cli summary                    affiche les indicateurs principaux
//!   spinop-cli kv ui "{...}"              écrit une préférence d'interface

use spin_tracker_op_lib::{import, open_state, solver, stats};
use std::path::PathBuf;

fn data_dir() -> PathBuf {
    if let Ok(p) = std::env::var("SPINOP_DATA_DIR") {
        return PathBuf::from(p);
    }
    #[cfg(target_os = "windows")]
    let base = std::env::var("APPDATA").map(PathBuf::from).unwrap_or_default();
    #[cfg(target_os = "macos")]
    let base = std::env::var("HOME").map(|h| PathBuf::from(h).join("Library/Application Support")).unwrap_or_default();
    #[cfg(all(unix, not(target_os = "macos")))]
    let base = std::env::var("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .unwrap_or_default();
    base.join("com.spintrackerop.desktop")
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dir = data_dir();
    let state = match open_state(&dir) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("base inaccessible ({}) : {e}", dir.display());
            std::process::exit(1);
        }
    };
    match args.first().map(|s| s.as_str()) {
        Some("import") if args.len() > 1 => {
            {
                let mut db = state.db.lock();
                let mut st = state.store.write();
                import::load(&mut db, &mut st).ok();
            }
            let paths: Vec<PathBuf> = args[1..].iter().map(PathBuf::from).collect();
            let r = import::run(paths, &state.store, &state.db, &|p| {
                if p.done == p.total {
                    println!("  {} : {}/{}", p.phase, p.done, p.total);
                }
            });
            println!(
                "{} fichiers · {} mains lues · {} importées · {} doublons · {} invalides · {} ms",
                r.sources, r.hands, r.imported, r.duplicates, r.invalid, r.millis
            );
            for e in r.errors.iter().take(10) {
                println!("  ! {e}");
            }
        }
        Some("summary") => {
            {
                let mut db = state.db.lock();
                let mut st = state.store.write();
                import::load(&mut db, &mut st).ok();
            }
            let s = state.store.read();
            let sum = stats::summary::summary(&s, &Default::default());
            println!("Tournois        {}", sum.tournaments);
            println!("Mains           {}", sum.hands);
            println!("CEV             {:.1} ± {:.1}", sum.cev, sum.cev_ci);
            println!("CEV minimum     {:.1}", sum.min_cev);
            println!("Profit réel     {:.2}", sum.profit.real);
            println!("EV Profit       {:.2}", sum.profit.ev);
            println!("EV Multi-profit {:.2}", sum.profit.ev_multi);
            println!("EV effectif     {:.2}", sum.profit.ev_eff);
            println!("Rakeback        {:.2}", sum.rakeback);
            println!("ROI EV          {:.2} %", sum.roi.ev);
            println!("Temps joué      {} s ({:.1} spins/h)", sum.seconds, sum.spins_per_hour);
        }
        Some("diag") => {
            {
                let mut db = state.db.lock();
                let mut st = state.store.write();
                import::load(&mut db, &mut st).ok();
            }
            let s = state.store.read();
            use std::collections::BTreeMap;
            let mut by_size: BTreeMap<u8, usize> = BTreeMap::new();
            let mut by_buyin: BTreeMap<i64, (usize, f64, f64)> = BTreeMap::new();
            let mut by_stack: BTreeMap<i64, usize> = BTreeMap::new();
            let mut by_name: BTreeMap<String, usize> = BTreeMap::new();
            let mut total_chips = 0.0;
            for t in &s.tours {
                *by_size.entry(t.t.table_size).or_default() += 1;
                let e = by_buyin.entry((t.t.buyin * 100.0).round() as i64).or_insert((0, 0.0, 0.0));
                e.0 += 1;
                e.1 += t.chips;
                e.2 += t.ev;
                *by_stack.entry(t.t.starting_stack.round() as i64).or_default() += 1;
                *by_name.entry(t.t.name.clone()).or_default() += 1;
                total_chips += t.chips;
            }
            println!("tournois {} | mains {} | chips totaux {:.0}", s.tours.len(), s.hands.len(), total_chips);
            println!("
-- joueurs par table --");
            for (k, v) in &by_size {
                println!("  {k} joueurs : {v} tournois");
            }
            println!("
-- tapis de départ --");
            for (k, v) in by_stack.iter().rev().take(12) {
                println!("  {k} jetons : {v} tournois");
            }
            println!("
-- buy-ins --");
            for (k, (n, c, e)) in &by_buyin {
                println!("  {:.2} : {} tournois, chips {:.0}, CEV {:.1}", *k as f64 / 100.0, n, c, e / *n as f64);
            }
            println!("
-- noms de tournoi --");
            let mut names: Vec<_> = by_name.into_iter().collect();
            names.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
            for (k, v) in names.iter().take(15) {
                println!("  {v:5} × {k}");
            }
            let incomplete: Vec<_> = s.tours.iter().filter(|t| t.t.hands as usize > t.hands.len()).collect();
            println!("
-- tournois incomplets (mains manquantes) : {} --", incomplete.len());
            for t in incomplete.iter().take(20) {
                println!("  {} | {} | {}/{} mains | source {}", t.t.code, t.t.name, t.hands.len(), t.t.hands, t.t.source);
            }
            println!("
-- 10 tournois aux chips les plus extremes --");
            let mut tt: Vec<_> = s.tours.iter().collect();
            tt.sort_by(|a, b| b.chips.abs().partial_cmp(&a.chips.abs()).unwrap());
            for t in tt.iter().take(10) {
                println!(
                    "  {} | {} | {} joueurs | tapis {:.0} | buy-in {:.2} | chips {:.0} | ev {:.0} | mains {}",
                    t.t.code, t.t.name, t.t.table_size, t.t.starting_stack, t.t.buyin, t.chips, t.ev, t.hands.len()
                );
            }
        }
        Some("check") => {
            {
                let mut db = state.db.lock();
                let mut st = state.store.write();
                import::load(&mut db, &mut st).ok();
            }
            let s = state.store.read();
            let mut bad = 0;
            for r in &s.hands {
                let pot = r.f.pot;
                let sum_ev: f64 = r.f.players.iter().map(|p| p.ev).sum();
                let worst = r.f.players.iter().map(|p| p.ev.abs()).fold(0.0, f64::max);
                if sum_ev.abs() > 0.5 || worst > pot + 1.0 {
                    bad += 1;
                    if bad <= 6 {
                        println!(
                            "main {} | {} joueurs | pot {:.0} | Σev {:.1} | ev {:?} | net {:?} | allin_street {:?} | board {}",
                            r.h.id,
                            r.h.seats.len(),
                            pot,
                            sum_ev,
                            r.f.players.iter().map(|p| p.ev.round()).collect::<Vec<_>>(),
                            r.f.players.iter().map(|p| p.net.round()).collect::<Vec<_>>(),
                            r.f.allin_street,
                            r.h.board.len()
                        );
                        println!("   mises {:?} gains {:?}", r.h.seats.iter().map(|x| x.bet).collect::<Vec<_>>(), r.h.seats.iter().map(|x| x.win).collect::<Vec<_>>());
                    }
                }
            }
            println!("mains incohérentes : {bad} / {}", s.hands.len());
            // continuité des tapis d'une main à la suivante, et chips cohérentes avec la place
            let (mut breaks, mut wrong_place) = (0, 0);
            for t in &s.tours {
                for w in t.hands.windows(2) {
                    let (a, b) = (&s.hands[w[0]], &s.hands[w[1]]);
                    let ok = a.h.seats.iter().enumerate().all(|(i, seat)| {
                        let next = b.h.seats.iter().find(|x| x.name == seat.name).map(|x| x.stack).unwrap_or(0.0);
                        (a.f.players[i].stack_after - next).abs() < 0.5
                    });
                    if !ok {
                        breaks += 1;
                        if breaks <= 3 {
                            println!("rupture de tapis : {} -> {}", a.h.id, b.h.id);
                        }
                    }
                }
                let won_all = t.chips > 0.0 && (t.chips - t.total_chips + t.t.starting_stack).abs() < 1.0;
                if (t.place == 1) != won_all && t.t.place > 0 {
                    wrong_place += 1;
                }
            }
            println!("ruptures de tapis : {breaks} · places incohérentes : {wrong_place}");
        }
        Some("imports") => match state.db.lock().imports() {
            Ok(rows) => rows.iter().for_each(|r| println!("{r}")),
            Err(e) => println!("erreur : {e}"),
        },
        Some("kv") if args.len() > 2 => {
            state.db.lock().kv_set(&args[1], &args[2]).expect("écriture impossible");
            println!("ok");
        }
        // reconstruction des spots postflop (solver) sur toutes les mains de la base
        Some("spots") => {
            {
                let mut db = state.db.lock();
                let mut st = state.store.write();
                import::load(&mut db, &mut st).ok();
            }
            let s = state.store.read();
            let mut ok = 0;
            let mut reasons: std::collections::BTreeMap<String, usize> = Default::default();
            let mut shown = 0;
            for r in &s.hands {
                if r.h.board.len() < 3 {
                    continue;
                }
                match solver::spot::from_hand(&r.h) {
                    Ok(sp) => {
                        ok += 1;
                        if shown < 6 {
                            shown += 1;
                            println!(
                                "{} · {} · pot {} bb · eff {} bb · {} vs {} · ligne {:?}",
                                r.h.id,
                                sp.preflop,
                                sp.config.pot,
                                sp.config.stack,
                                sp.config.oop_label,
                                sp.config.ip_label,
                                sp.line.iter().map(|l| format!("{}{}:{}{:.2}", l.street, if l.side == 0 { "O" } else { "I" }, l.kind, l.to)).collect::<Vec<_>>()
                            );
                        }
                        // contrôle : les mises postflop ne dépassent jamais le tapis effectif
                        let mut put = [[0.0f64; 2]; 4];
                        for l in &sp.line {
                            put[l.street as usize][l.side as usize] = l.to;
                        }
                        let used: f64 = (1..4).map(|st| put[st][0].min(put[st][1]).max(0.0)).sum();
                        if used > sp.config.stack + 0.02 {
                            *reasons.entry("INCOHÉRENCE : mises > tapis effectif".into()).or_default() += 1;
                        }
                    }
                    Err(e) => *reasons.entry(e).or_default() += 1,
                }
            }
            println!("{ok} spots postflop reconstruits");
            for (k, v) in reasons {
                println!("  {v:>6} × {k}");
            }
        }
        // solve complet d'une main : spot, calcul, fichier, relecture de la racine
        Some("solve-hand") if args.len() >= 4 => {
            {
                let mut db = state.db.lock();
                let mut st = state.store.write();
                import::load(&mut db, &mut st).ok();
            }
            let spot = {
                let s = state.store.read();
                let r = s.hands.iter().find(|r| r.h.id == args[1]).expect("main introuvable");
                solver::spot::from_hand(&r.h).expect("spot")
            };
            let mut cfg = spot.config.clone();
            cfg.oop_range = args[2].clone();
            cfg.ip_range = args[3].clone();
            if let Some(p) = args.get(4) {
                cfg.precision = p.parse().unwrap_or(1.0);
            }
            let id = state.solver.start_postflop(state.db.clone(), cfg, Some(args[1].clone()), spot.preflop.clone()).expect("lancement");
            loop {
                std::thread::sleep(std::time::Duration::from_millis(1000));
                let j = state.solver.job.lock().clone().unwrap();
                println!("  it {} · {:.1} s · précision {:?} %", j.iter, j.seconds, j.exploit);
                if j.state != "running" {
                    println!("état : {} {}", j.state, j.message);
                    break;
                }
            }
            // relecture depuis le fichier (et non depuis la mémoire)
            *state.solver.open.lock() = None;
            let (cfg_json, _) = state.db.lock().solve_config(id).unwrap();
            let v = state.solver.with_open(id, &cfg_json, |op| solver::postflop::node_view(&mut op.game, &[], &op.cfg, Some(&mut op.rivers))).expect("relecture");
            println!("actions : {}", v["actions"]);
            println!("fréquences : {}", v["freq"]);
            println!("résumé : {}", v["summary"].as_array().unwrap().iter().map(|x| format!("CEV {:.2} bb, équité {:.3}, EQR {}", x["ev"].as_f64().unwrap(), x["equity"].as_f64().unwrap(), x["eqr"])).collect::<Vec<_>>().join(" | "));
            println!("pot {} bb · fichier {} octets", v["pot"], std::fs::metadata(state.solver.file(id)).map(|m| m.len()).unwrap_or(0));
        }
        // tables d'équité préflop tête-à-tête exactes (assets/hu_equity.bin)
        Some("gen-tables") => {
            let t0 = std::time::Instant::now();
            let t = solver::preflop::classes::compute_hu(&|d, n| eprintln!("  {d} / {n} configurations"));
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/hu_equity.bin");
            std::fs::write(&path, t.to_bytes()).expect("écriture");
            println!("{} écrit en {:.0} s", path.display(), t0.elapsed().as_secs_f64());
        }
        // solution préflop en ligne de commande : spinop-cli preflop 12 12 12 [flops]
        Some("preflop") if args.len() >= 3 => {
            use solver::preflop::{run, tri::TriTables};
            // spinop-cli preflop 12 12 12 [--flops 20]
            let fi = args.iter().position(|x| x == "--flops");
            let flops: usize = fi.and_then(|i| args.get(i + 1)).and_then(|x| x.parse().ok()).unwrap_or(0);
            let stacks: Vec<f64> = args[1..fi.unwrap_or(args.len())].iter().filter_map(|x| x.parse().ok()).collect();
            let t0 = std::time::Instant::now();
            let tri = if stacks.len() == 3 {
                Some(TriTables::load_or_build(&dir, &std::sync::atomic::AtomicBool::new(false), &|d, n| eprintln!("  tables à 3 : {d} / {n}")).expect("tables"))
            } else {
                None
            };
            eprintln!("tables prêtes en {:.0} s", t0.elapsed().as_secs_f64());
            let req = run::PreflopRequest { config: solver::preflop::tree::PreflopConfig { stacks: stacks.clone(), ..Default::default() }, flops, ..Default::default() };
            let cancel = std::sync::atomic::AtomicBool::new(false);
            let sol = run::run(&req, tri.as_ref(), &cancel, &run::Progress { f: &|ph, fr, ex| eprintln!("  {:>5.1} % · {ph} · {}", fr * 100.0, ex.map(|e| format!("expl {e:.4} bb")).unwrap_or_default()) }).expect("solve");
            let root = &sol.nodes[0];
            let freq: Vec<String> = root
                .actions
                .iter()
                .enumerate()
                .map(|(a, act)| {
                    let f: f64 = (0..169).map(|h| solver::preflop::classes::ncombos(h) * root.strategy[a * 169 + h] as f64).sum::<f64>() / 1326.0;
                    format!("{} {:.1} %", act.label, f * 100.0)
                })
                .collect();
            println!("{:?} · {} nœuds · {} it · {:.0} s · exploitabilité {:.4} bb/main · EV {:?}", stacks, sol.nodes.len(), sol.iterations, sol.seconds, sol.exploit, sol.evs.iter().map(|e| format!("{e:.3}")).collect::<Vec<_>>());
            println!("{} : {}", sol.names[0], freq.join(" · "));
        }
        // équité à tapis : spinop-cli allin <top% pousseur BTN> <top% sur-call BB> <main>
        Some("allin") if args.len() >= 4 => {
            use solver::preflop::{allin, tri::TriTables};
            let order = solver::ranges::preflop_order();
            let top = |p: f64| {
                let mut acc = 0.0;
                let mut v = Vec::new();
                for &c in order.iter() {
                    let n = solver::preflop::classes::ncombos(c);
                    if acc + n / 2.0 > 1326.0 * p / 100.0 {
                        break;
                    }
                    v.push(solver::ranges::cell_name(c));
                    acc += n;
                }
                v.join(",")
            };
            let tri = TriTables::load_or_build(&dir, &std::sync::atomic::AtomicBool::new(false), &|_, _| {}).expect("tables");
            let req = allin::AllinRequest { stacks: vec![14.0, 14.0, 14.0], ante: 0.0, shover: 0, shove_range: top(args[1].parse().unwrap()), hero: 1, behind: Some(2), behind_range: top(args[2].parse().unwrap()) };
            let r = allin::run(&req, Some(&tri)).expect("calcul");
            println!("à payer {:.2} bb · pot {:.2} bb · équité nécessaire {:.1} % · call rentable {:.1} % des mains", r.to_call, r.pot_if_called, r.need * 100.0, r.call_pct * 100.0);
            for name in args[3..].iter() {
                let x = r.rows.iter().find(|x| &x.name == name).expect("main");
                println!("{} : équité {:.1} % · BB paye {:.1} % · équité à 3 {:?} · CEV payer {:.2} · coucher {:.2}", x.name, x.equity * 100.0, x.behind_calls * 100.0, x.equity3.map(|e| (e * 1000.0).round() / 10.0), x.ev_call, x.ev_fold);
            }
        }
        Some("lighten") if args.len() >= 3 => {
            let id: i64 = args[1].parse().expect("id");
            let (cfg_json, _) = state.db.lock().solve_config(id).expect("solve");
            let before = std::fs::metadata(state.solver.file(id)).map(|m| m.len()).unwrap_or(0);
            let after = state.solver.lighten(id, &cfg_json, args[2] == "turn").expect("allègement");
            state.db.lock().solve_storage(id, &args[2], after).unwrap();
            println!("{:.0} Mo -> {:.0} Mo", before as f64 / 1e6, after as f64 / 1e6);
            *state.solver.open.lock() = None;
            let v = state.solver.with_open(id, &cfg_json, |op| solver::postflop::node_view(&mut op.game, &[1, 1], &op.cfg, Some(&mut op.rivers)));
            println!("après check-check (carte du turn) : {}", v.map(|v| format!("stored={}", v["stored"])).unwrap_or_else(|e| e));
            let v = state.solver.with_open(id, &cfg_json, |op| solver::postflop::node_view(&mut op.game, &[0, 0, 20, 0, 0, 30], &op.cfg, Some(&mut op.rivers)));
            println!("river re-résolue : {}", v.map(|v| format!("board {} · {}", v["board"], v["resolved_river"])).unwrap_or_else(|e| e));
        }
        _ => {
            println!("Base : {}", dir.display());
            println!("Usage :\n  spinop-cli import <fichier|dossier|zip>…\n  spinop-cli summary\n  spinop-cli kv <clé> <valeur>
  spinop-cli spots");
        }
    }
}
