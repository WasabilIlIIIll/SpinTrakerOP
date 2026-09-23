//! Parsers Winamax, Betclic (nouveau format) et Unibet, sur des historiques synthétiques
//! construits d'après les formats documentés publiquement (aucune donnée personnelle).

use spin_tracker_op_lib::{import, open_state};
use std::path::PathBuf;

struct Expect {
    dir: &'static str,
    room: &'static str,
    hero: &'static str,
    hands: usize,
    buyin: f64,
    prize_pool: f64,
}

fn check(e: Expect) {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(e.dir);
    let tmp = std::env::temp_dir().join(format!("sto-fmt-{}-{}", e.dir, std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let state = open_state(&tmp).unwrap();
    let r = import::run(vec![dir], &state.store, &state.db, &|_| {});
    assert_eq!(r.invalid, 0, "{} : fichiers invalides {:?}", e.dir, r.errors);
    assert_eq!(r.skipped, 0, "{} : tournoi écarté à tort {:?}", e.dir, r.errors);
    let s = state.store.read();
    assert_eq!(s.tours.len(), 1, "{} : un tournoi attendu", e.dir);
    let t = &s.tours[0];
    assert_eq!(t.t.room, e.room);
    assert_eq!(t.t.hero, e.hero);
    assert_eq!(t.hands.len(), e.hands, "{} : nombre de mains", e.dir);
    assert!((t.t.buyin - e.buyin).abs() < 1e-6, "{} : buy-in {}", e.dir, t.t.buyin);
    assert!((t.t.prize_pool - e.prize_pool).abs() < 1e-6, "{} : prize pool {}", e.dir, t.t.prize_pool);
    assert_eq!(t.t.starting_stack, 500.0);
    for &hi in &t.hands {
        let h = &s.hands[hi];
        let sum: f64 = h.f.players.iter().map(|p| p.net).sum();
        assert!(sum.abs() < 0.01, "{} main {} : somme des nets = {}", e.dir, h.h.id, sum);
    }
    for w in t.hands.windows(2) {
        let (a, b) = (&s.hands[w[0]], &s.hands[w[1]]);
        for (i, seat) in a.h.seats.iter().enumerate() {
            let after = a.f.players[i].stack_after;
            let next = b.h.seats.iter().find(|x| x.name == seat.name).map(|x| x.stack).unwrap_or(0.0);
            assert!((after - next).abs() < 0.01, "{} : tapis de {} incohérent ({} puis {})", e.dir, seat.name, after, next);
        }
    }
    // le héros gagne le tournoi : +1000 jetons, 1re place
    assert!((t.chips - 1000.0).abs() < 0.01, "{} : chips du héros {}", e.dir, t.chips);
    assert_eq!(t.place, 1, "{} : place", e.dir);
    // le tapis QQ vs AK est ajusté : l'EV diffère du réel
    let ai = t.hands.iter().filter(|&&hi| s.hands[hi].f.allin_street.is_some()).count();
    assert!(ai >= 2, "{} : tapis ajustés {}", e.dir, ai);
    println!("{} ok : {} mains, chips {:.0}, EV {:.0}", e.dir, t.hands.len(), t.chips, t.ev);
    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn winamax() {
    check(Expect { dir: "winamax", room: "Winamax", hero: "MrTest", hands: 3, buyin: 5.0, prize_pool: 10.0 });
}

#[test]
fn betclic_new_format() {
    check(Expect { dir: "betclic", room: "Betclic", hero: "HeroB", hands: 3, buyin: 5.0, prize_pool: 0.0 });
}

#[test]
fn unibet() {
    check(Expect { dir: "unibet", room: "Unibet", hero: "HeroU", hands: 3, buyin: 5.0, prize_pool: 10.0 });
}

#[test]
fn betclic_spin_rush() {
    check(Expect { dir: "betclic_spin", room: "Betclic", hero: "HeroB", hands: 3, buyin: 5.0, prize_pool: 10.0 });
}

#[test]
fn betclic_spin_rush_details() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/betclic_spin");
    let tmp = std::env::temp_dir().join(format!("sto-fmt-bcl2-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let state = open_state(&tmp).unwrap();
    import::run(vec![dir], &state.store, &state.db, &|_| {});
    let s = state.store.read();
    let t = &s.tours[0];
    // 19:00 UTC le 1er septembre = 21:00 à Paris (heure d'été)
    assert_eq!(t.t.start.rem_euclid(86400), 21 * 3600);
    assert_eq!(t.t.place, 1);
    assert!((t.winnings - 10.0).abs() < 1e-6, "gains {}", t.winnings);
    assert!((t.t.multiplier - 2.0).abs() < 1e-6);
    let _ = std::fs::remove_dir_all(&tmp);
}
