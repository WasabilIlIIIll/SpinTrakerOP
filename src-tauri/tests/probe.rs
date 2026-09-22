//! Sondes de cohérence supplémentaires sur les échantillons.
use spin_tracker_op_lib::{import, open_state, stats};
use std::path::PathBuf;

#[test]
fn probe() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("maintest");
    if !dir.exists() {
        return;
    }
    let tmp = std::env::temp_dir().join(format!("sto-probe-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let state = open_state(&tmp).unwrap();
    import::run(vec![dir], &state.store, &state.db, &|_| {});
    let s = state.store.read();
    let f = Default::default();

    // multi-tabling
    for r in stats::breakdown::results_by(&s, &f, "tables") {
        println!("{:10} spins {:3} ev/h {:6.2} réel/h {:6.2} cev {:6.1} h {:.2}", r.key, r.spins, r.ev_hour, r.real_hour, r.cev, r.hours);
    }
    // multiplicateurs
    for m in stats::breakdown::multipliers(&s, &f) {
        println!(
            "x{:<6} réel {:3} attendu {:6.2} freq {:5.2}% vs {:5.2}% profit {:7.2}",
            m.mult, m.count, m.expected, m.freq, m.expected_freq, m.profit
        );
    }
    // bankroll
    let b = stats::charts::bankroll_chart(&s, &f, "tournaments");
    println!(
        "bankroll pts {} up {:.2} down {:.2} peak {:.2} break-even {} jackpots {}",
        b.x.len(),
        b.events.upswing.amount,
        b.events.downswing.amount,
        b.events.peak.1,
        b.events.longest_break_even.amount,
        b.events.jackpots.len()
    );
    // joueurs
    let mut ps: Vec<_> = s.pstats.iter().filter(|(n, _)| !s.is_hero(n)).collect();
    ps.sort_by_key(|(_, p)| std::cmp::Reverse(p.hands));
    for (n, p) in ps.iter().take(5) {
        println!(
            "{:16} mains {:3} vpip {:4.0} pfr {:4.0} limp_btn {:4.0} tags {:?} cev/vous {:.0}",
            n,
            p.hands,
            p.stat("vpip"),
            p.stat("pfr"),
            p.stat("limp_btn"),
            s.tags_of(n),
            p.stat("cev_vs_hero")
        );
    }
    // profils de table
    for b in stats::breakdown::by_profile(&s, &f) {
        println!("profil {:20} {:3} spins ev {:7.1}", b.key, b.count, b.ev);
    }
    // postflop héros
    let lr = stats::leaks::leak_report(&s, "", &f, "population", true);
    for p in &lr.postflop.player {
        println!("postflop {} flops {} cbet {:?} foldcbet {:?} wtsd {:?}", p.key, p.flops, p.cbet, p.fold_cbet, p.wtsd);
    }
    // une main avec all-in : vérifier l'équité
    let with_ai = s.hands.iter().filter(|h| h.f.allin_street.is_some()).count();
    println!("mains all-in ajustées : {} / {}", with_ai, s.hands.len());
    let _ = std::fs::remove_dir_all(&tmp);
}
