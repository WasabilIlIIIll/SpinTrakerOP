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
