//! Spin Tracker OP — outil en ligne de commande (import headless, statistiques).
//!
//! Exemples :
//!   spinop-cli import "C:/histo/PMU"     importe un dossier dans la base de l'application
//!   spinop-cli summary                    affiche les indicateurs principaux
//!   spinop-cli kv ui "{...}"              écrit une préférence d'interface

use spin_tracker_op_lib::{import, open_state, stats};
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
        _ => {
            println!("Base : {}", dir.display());
            println!("Usage :\n  spinop-cli import <fichier|dossier|zip>…\n  spinop-cli summary\n  spinop-cli kv <clé> <valeur>");
        }
    }
}
