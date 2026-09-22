//! Test d'intégration sur les historiques d'exemple (dossier `maintest/` à la racine).

use spin_tracker_op_lib::{import, stats};
use std::path::PathBuf;

#[test]
fn import_samples() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("maintest");
    if !dir.exists() {
        eprintln!("pas d'échantillons, test ignoré");
        return;
    }
    let tmp = std::env::temp_dir().join(format!("sto-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let state = spin_tracker_op_lib::open_state(&tmp).unwrap();
    let res = import::run(vec![dir.clone()], &state.store, &state.db, &|_| {});
    println!("import: {} sources, {} mains, {} importées, {} invalides, {} ms", res.sources, res.hands, res.imported, res.invalid, res.millis);
    for e in &res.errors {
        println!("  err {e}");
    }
    assert!(res.imported > 1000);
    let s = state.store.read();
    // chaque tournoi : jetons réels = variation de tapis, somme des nets de la table = 0
    for t in &s.tours {
        for &hi in &t.hands {
            let r = &s.hands[hi];
            let sum: f64 = r.f.players.iter().map(|p| p.net).sum();
            assert!(sum.abs() < 0.01, "main {} somme nets = {}", r.h.id, sum);
            let evsum: f64 = r.f.players.iter().map(|p| p.ev).sum();
            assert!(evsum.abs() < 0.5, "main {} somme ev = {}", r.h.id, evsum);
        }
        // tapis de fin cohérent avec la main suivante
        for w in t.hands.windows(2) {
            let (a, b) = (&s.hands[w[0]], &s.hands[w[1]]);
            let ha = &a.h.seats[a.h.hero as usize].name;
            if let Some(ib) = b.h.seats.iter().position(|x| &x.name == ha) {
                let after = a.f.players[a.h.hero as usize].stack_after;
                assert!(
                    (after - b.h.seats[ib].stack).abs() < 0.01,
                    "tapis incohérent {} -> {} ({} vs {})",
                    a.h.id,
                    b.h.id,
                    after,
                    b.h.seats[ib].stack
                );
            }
        }
    }
    let sum = stats::summary::summary(&s, &Default::default());
    println!(
        "tournois {} mains {} CEV {:.1} ±{:.1} CEV/main {:.2} profit réel {:.2} EV {:.2} EVmulti {:.2} EVeff {:.2} RB {:.2} min CEV {:.1} temps {}s spins/h {:.1} places {:?} attendu {:?} luck z {:.2}",
        sum.tournaments, sum.hands, sum.cev, sum.cev_ci, sum.cev_hand, sum.profit.real, sum.profit.ev, sum.profit.ev_multi, sum.profit.ev_eff,
        sum.rakeback, sum.min_cev, sum.seconds, sum.spins_per_hour, sum.finish, sum.finish_expected, sum.luck_z
    );
    for t in s.tours.iter().filter(|t| t.t.place == 0) {
        println!("place déduite {} -> {} gains {}", t.t.code, t.place, t.winnings);
    }
    let pos = stats::breakdown::by_position(&s, &Default::default(), "hand");
    for b in pos {
        println!("{:10} mains {:4} chips {:7.1} ev {:7.1}", b.key, b.hands, b.chips, b.ev);
    }
    let lr = stats::leaks::leak_report(&s, "", &Default::default(), "population", false);
    for p in &lr.panels {
        for n in p.nodes.iter().take(3) {
            println!("[{}] {} ({}) {:?} ref {:?}", p.scenario, n.label, n.kind, n.counts, n.reference);
        }
    }
    let _ = std::fs::remove_dir_all(&tmp);
}
