//! Commandes Tauri exposées au front.

use crate::analysis::Scenario;
use crate::import::{self, ImportResult, Progress};
use crate::model::card_str;
use crate::settings::Settings;
use crate::stats::breakdown::{self, Bar, DayCount, MultRow, Row};
use crate::stats::challenges::{self, Challenge, ChallengeView};
use crate::stats::charts::{self, BankrollChart, ChipsChart};
use crate::stats::leaks::{self, LeakReport};
use crate::stats::summary::{self, Summary};
use crate::stats::{mean_ci, Filter};
use crate::AppState;
use std::collections::HashSet;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{Emitter, State};

type R<T> = Result<T, String>;

#[tauri::command]
pub fn overview(state: State<AppState>) -> R<Value> {
    let s = state.store.read();
    let mut rooms: Vec<String> = s.tours.iter().map(|t| t.t.room.clone()).collect();
    rooms.sort();
    rooms.dedup();
    let mut buyins: Vec<f64> = s.tours.iter().map(|t| (t.t.buyin * 100.0).round() / 100.0).collect();
    buyins.sort_by(|a, b| a.partial_cmp(b).unwrap());
    buyins.dedup();
    let mut heroes: Vec<String> = s.heroes.iter().cloned().collect();
    heroes.sort();
    let mut mults: Vec<f64> = s.tours.iter().map(|t| t.t.multiplier).collect();
    mults.sort_by(|a, b| a.partial_cmp(b).unwrap());
    mults.dedup_by(|a, b| (*a - *b).abs() < 0.01);
    Ok(json!({
        "tournaments": s.tours.len(),
        "hands": s.hands.len(),
        "players": s.pstats.len(),
        "rooms": rooms,
        "buyins": buyins,
        "heroes": heroes,
        "multipliers": mults,
        "first": s.tours.first().map(|t| t.t.start),
        "last": s.tours.last().map(|t| t.t.start),
        "db_path": state.db_path.to_string_lossy(),
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

#[tauri::command]
pub async fn import_paths(app: tauri::AppHandle, state: State<'_, AppState>, paths: Vec<String>, room: Option<String>) -> R<ImportResult> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    let store = state.store.clone();
    let db = state.db.clone();
    let res = tauri::async_runtime::spawn_blocking(move || {
        let emit = |p: Progress| {
            let _ = app.emit("import-progress", p);
        };
        import::run_with(paths, room.filter(|r| !r.is_empty()), &store, &db, &emit)
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(res)
}

#[tauri::command]
pub fn get_summary(state: State<AppState>, filter: Filter) -> Summary {
    summary::summary(&state.store.read(), &filter)
}

#[tauri::command]
pub fn chips_chart(state: State<AppState>, filter: Filter, axis: String, max_points: Option<usize>) -> ChipsChart {
    charts::chips_chart(&state.store.read(), &filter, &axis, max_points.unwrap_or(3000))
}

#[tauri::command]
pub fn bankroll_chart(state: State<AppState>, filter: Filter, axis: String) -> BankrollChart {
    charts::bankroll_chart(&state.store.read(), &filter, &axis)
}

#[tauri::command]
pub fn by_position(state: State<AppState>, filter: Filter, per: String) -> Vec<Bar> {
    breakdown::by_position(&state.store.read(), &filter, &per)
}

#[tauri::command]
pub fn by_profile(state: State<AppState>, filter: Filter) -> Vec<Bar> {
    breakdown::by_profile(&state.store.read(), &filter)
}

#[tauri::command]
pub fn by_stack(state: State<AppState>, filter: Filter) -> Vec<Bar> {
    breakdown::by_stack(&state.store.read(), &filter)
}

#[tauri::command]
pub fn results_by(state: State<AppState>, filter: Filter, group: String) -> Vec<Row> {
    breakdown::results_by(&state.store.read(), &filter, &group)
}

#[tauri::command]
pub fn multipliers(state: State<AppState>, filter: Filter) -> Vec<MultRow> {
    breakdown::multipliers(&state.store.read(), &filter)
}

#[tauri::command]
pub fn sessions(state: State<AppState>, filter: Filter, gap_minutes: Option<i64>) -> Vec<breakdown::Session> {
    breakdown::sessions(&state.store.read(), &filter, gap_minutes.unwrap_or(30) * 60)
}

#[tauri::command]
pub fn calendar(state: State<AppState>, filter: Filter) -> Vec<DayCount> {
    breakdown::calendar(&state.store.read(), &filter)
}

#[derive(Serialize)]
pub struct TRow {
    pub id: String,
    pub start: i64,
    pub end: i64,
    pub name: String,
    pub room: String,
    pub buyin: f64,
    pub multiplier: f64,
    pub prize_pool: f64,
    pub place: u8,
    pub winnings: f64,
    pub profit: f64,
    pub chips: f64,
    pub ev: f64,
    pub ev_profit: f64,
    pub hands: usize,
    pub tables: f64,
    pub opponents: Vec<(String, Vec<String>)>,
    pub luck: f64,
}

#[tauri::command]
pub fn tournaments(state: State<AppState>, filter: Filter, sort: Option<String>, desc: Option<bool>, offset: usize, limit: usize) -> Value {
    let s = state.store.read();
    let mut sel = filter.select(&s);
    let key = sort.unwrap_or_else(|| "start".into());
    let desc = desc.unwrap_or(true);
    let val = |i: usize| -> f64 {
        let t = &s.tours[i];
        match key.as_str() {
            "multiplier" => t.t.multiplier,
            "profit" => t.real,
            "chips" => t.chips,
            "ev" => t.ev,
            "hands" => t.hands.len() as f64,
            "luck" => t.chips - t.ev,
            "place" => t.place as f64,
            _ => t.t.start as f64,
        }
    };
    sel.sort_by(|a, b| val(*a).partial_cmp(&val(*b)).unwrap());
    if desc {
        sel.reverse();
    }
    let total = sel.len();
    let rows: Vec<TRow> = sel
        .iter()
        .skip(offset)
        .take(limit)
        .map(|&i| {
            let t = &s.tours[i];
            TRow {
                id: t.t.id.clone(),
                start: t.t.start,
                end: t.t.end,
                name: t.t.name.clone(),
                room: t.t.room.clone(),
                buyin: t.t.buyin,
                multiplier: t.t.multiplier,
                prize_pool: t.t.prize_pool,
                place: t.place,
                winnings: t.winnings,
                profit: t.real,
                chips: t.chips,
                ev: t.ev,
                ev_profit: t.ev_theo,
                hands: t.hands.len(),
                tables: t.tables,
                opponents: t.opponents.iter().map(|o| (o.clone(), s.tags_of(o))).collect(),
                luck: t.chips - t.ev,
            }
        })
        .collect();
    json!({ "total": total, "rows": rows })
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct HandQuery {
    pub filter: Filter,
    pub tid: Option<String>,
    pub scenario: Option<String>,
    pub allin: Option<bool>,
    pub showdown: Option<bool>,
    pub result: Option<String>,
    pub min_pot_bb: Option<f64>,
    pub combo: Option<String>,
    pub opponent: Option<String>,
    pub min_bb: Option<f64>,
    pub max_bb: Option<f64>,
    pub hu: Option<bool>,
    pub favorites: Option<bool>,
    pub sort: Option<String>,
    pub desc: Option<bool>,
    pub offset: usize,
    pub limit: usize,
}

fn hand_combo(c: Option<[u8; 2]>) -> String {
    match c {
        None => String::new(),
        Some([a, b]) => {
            const R: &[u8] = b"23456789TJQKA";
            let (ra, rb) = (a / 4, b / 4);
            let (hi, lo) = if ra >= rb { (ra, rb) } else { (rb, ra) };
            let mut s = format!("{}{}", R[hi as usize] as char, R[lo as usize] as char);
            if hi != lo {
                s.push(if a % 4 == b % 4 { 's' } else { 'o' });
            }
            s
        }
    }
}

fn hero_line(r: &crate::store::HandRec) -> String {
    use crate::model::ActKind::*;
    let hero = r.h.hero;
    let mut parts = Vec::new();
    for st in 0..4u8 {
        let acts: Vec<&str> =
            r.h.actions
                .iter()
                .filter(|a| a.street == st && a.p == hero && !a.kind.is_post())
                .map(|a| match (a.kind, a.allin) {
                    (Raise, true) | (Bet, true) => "A",
                    (Call, true) => "C",
                    (Raise, _) => "R",
                    (Bet, _) => "B",
                    (Call, _) => "C",
                    (Check, _) => "X",
                    (Fold, _) => "F",
                    _ => "",
                })
                .collect();
        if acts.is_empty() {
            break;
        }
        parts.push(acts.join(""));
    }
    parts.join(" / ")
}

#[tauri::command]
pub fn hands(state: State<AppState>, q: HandQuery) -> Value {
    let s = state.store.read();
    let tsel: Vec<usize> = match &q.tid {
        Some(t) => s.tindex.get(t).map(|i| vec![*i]).unwrap_or_default(),
        None => q.filter.select(&s),
    };
    let mut ids: Vec<usize> = Vec::new();
    let all_hands: usize = tsel.iter().map(|&ti| s.tours[ti].hands.len()).sum();
    for ti in tsel {
        for &hi in &s.tours[ti].hands {
            let r = &s.hands[hi];
            let p = &r.f.players[r.h.hero as usize];
            if let Some(sc) = &q.scenario {
                if p.scenario.label() != sc {
                    continue;
                }
            }
            if let Some(a) = q.allin {
                if r.f.allin_street.is_some() != a {
                    continue;
                }
            }
            if let Some(sd) = q.showdown {
                if (r.f.showdown && !p.folded) != sd {
                    continue;
                }
            }
            if let Some(res) = &q.result {
                if res == "won" && p.net <= 0.0 || res == "lost" && p.net >= 0.0 {
                    continue;
                }
            }
            if let Some(m) = q.min_pot_bb {
                if r.f.pot / r.h.bb.max(1.0) < m {
                    continue;
                }
            }
            if let Some(c) = &q.combo {
                if !c.is_empty() && hand_combo(r.h.seats[r.h.hero as usize].cards) != *c {
                    continue;
                }
            }
            if let Some(o) = &q.opponent {
                if !r.h.seats.iter().any(|x| &x.name == o) {
                    continue;
                }
            }
            if let Some(m) = q.min_bb {
                if r.f.eff_bb < m {
                    continue;
                }
            }
            if let Some(m) = q.max_bb {
                if r.f.eff_bb >= m {
                    continue;
                }
            }
            if let Some(hu) = q.hu {
                if (r.h.seats.len() == 2) != hu {
                    continue;
                }
            }
            if let Some(f) = q.favorites {
                if s.favorites.contains_key(&r.h.id) != f {
                    continue;
                }
            }
            ids.push(hi);
        }
    }
    let key = q.sort.clone().unwrap_or_else(|| "date".into());
    if key != "date" {
        let v = |i: usize| -> f64 {
            let r = &s.hands[i];
            let p = &r.f.players[r.h.hero as usize];
            match key.as_str() {
                "pot" => r.f.pot,
                "net" => p.net,
                "ev" => p.ev,
                "luck" => p.net - p.ev,
                "bb" => r.f.eff_bb,
                _ => r.h.ts as f64,
            }
        };
        ids.sort_by(|a, b| v(*a).partial_cmp(&v(*b)).unwrap());
    }
    if q.desc.unwrap_or(q.tid.is_none()) {
        ids.reverse();
    }
    let total = ids.len();
    let limit = if q.limit == 0 { 200 } else { q.limit };
    let rows: Vec<Value> = ids
        .iter()
        .skip(q.offset)
        .take(limit)
        .map(|&hi| {
            let r = &s.hands[hi];
            let p = &r.f.players[r.h.hero as usize];
            json!({
                "id": r.h.id, "tid": r.h.tid, "ts": r.h.ts,
                "cards": r.h.seats[r.h.hero as usize].cards.map(|c| [card_str(c[0]), card_str(c[1])]),
                "combo": hand_combo(r.h.seats[r.h.hero as usize].cards),
                "board": r.h.board.iter().map(|c| card_str(*c)).collect::<Vec<_>>(),
                "scenario": p.scenario.label(), "bb": r.h.bb, "sb": r.h.sb, "eff_bb": r.f.eff_bb,
                "net": p.net, "ev": p.ev, "pot": r.f.pot, "equity": p.allin_equity,
                "allin": r.f.allin_street, "players": r.h.seats.len(), "line": hero_line(r),
                "showdown": r.f.showdown && !p.folded,
                "fav": s.favorites.contains_key(&r.h.id),
                "fav_note": s.favorites.get(&r.h.id).cloned().unwrap_or_default(),
            })
        })
        .collect();
    let sums = ids.iter().fold((0.0, 0.0), |acc, &hi| {
        let r = &s.hands[hi];
        let p = &r.f.players[r.h.hero as usize];
        (acc.0 + p.net, acc.1 + p.ev)
    });
    // nombre de tournois couverts : le CEV (chips EV par tournoi) n'a de sens que si toutes
    // leurs mains sont retenues
    let tours: HashSet<usize> = ids.iter().map(|&hi| s.hands[hi].t).collect();
    json!({ "total": total, "rows": rows, "net": sums.0, "ev": sums.1, "tournaments": tours.len(), "complete": total == all_hands })
}

#[tauri::command]
pub fn hand_detail(state: State<AppState>, id: String) -> R<Value> {
    let s = state.store.read();
    let hi = s.hands.iter().position(|r| r.h.id == id).ok_or("main introuvable")?;
    let r = &s.hands[hi];
    let t = &s.tours[r.t];
    let pos_in_t = t.hands.iter().position(|x| *x == hi).unwrap_or(0);
    let prev = if pos_in_t > 0 { Some(s.hands[t.hands[pos_in_t - 1]].h.id.clone()) } else { None };
    let next = t.hands.get(pos_in_t + 1).map(|x| s.hands[*x].h.id.clone());
    Ok(json!({
        "id": r.h.id, "tid": r.h.tid, "ts": r.h.ts, "sb": r.h.sb, "bb": r.h.bb, "ante": r.h.ante,
        "button": r.h.button, "hero": r.h.hero,
        "seats": r.h.seats.iter().enumerate().map(|(i, x)| json!({
            "name": x.name, "seat": x.seat, "stack": x.stack,
            "cards": x.cards.map(|c| [card_str(c[0]), card_str(c[1])]),
            "tags": s.tags_of(&x.name),
            "pos": format!("{:?}", r.f.players[i].pos).to_uppercase(),
            "net": r.f.players[i].net, "ev": r.f.players[i].ev, "equity": r.f.players[i].allin_equity,
            "folded": r.f.players[i].folded,
        })).collect::<Vec<_>>(),
        "actions": r.h.actions.iter().map(|a| json!({
            "street": a.street, "p": a.p, "kind": format!("{:?}", a.kind), "amount": a.amount, "allin": a.allin
        })).collect::<Vec<_>>(),
        "board": r.h.board.iter().map(|c| card_str(*c)).collect::<Vec<_>>(),
        "pot": r.f.pot, "allin_street": r.f.allin_street, "showdown": r.f.showdown, "eff_bb": r.f.eff_bb,
        "index": pos_in_t + 1, "count": t.hands.len(), "prev": prev, "next": next,
        "fav": s.favorites.contains_key(&r.h.id), "fav_note": s.favorites.get(&r.h.id).cloned().unwrap_or_default(),
        "tournament": { "id": t.t.id, "name": t.t.name, "multiplier": t.t.multiplier, "buyin": t.t.buyin, "place": t.place, "prize_pool": t.t.prize_pool },
    }))
}

#[tauri::command]
pub fn tournament_detail(state: State<AppState>, id: String) -> R<Value> {
    let s = state.store.read();
    let &ti = s.tindex.get(&id).ok_or("tournoi introuvable")?;
    let t = &s.tours[ti];
    let mut chips = vec![t.t.starting_stack];
    let mut ev = vec![t.t.starting_stack];
    let (mut c, mut e) = (t.t.starting_stack, t.t.starting_stack);
    for &hi in &t.hands {
        let r = &s.hands[hi];
        let p = &r.f.players[r.h.hero as usize];
        c += p.net;
        e += p.ev;
        chips.push(c);
        ev.push(e);
    }
    Ok(json!({
        "id": t.t.id, "name": t.t.name, "room": t.t.room, "start": t.t.start, "end": t.t.end,
        "buyin": t.t.buyin, "multiplier": t.t.multiplier, "prize_pool": t.t.prize_pool, "place": t.place,
        "winnings": t.winnings, "profit": t.real, "chips": t.chips, "ev": t.ev, "ev_profit": t.ev_theo,
        "ev_multi": t.ev_multi, "p": t.p, "tables": t.tables, "hands": t.hands.len(), "source": t.t.source,
        "opponents": t.opponents.iter().map(|o| json!({"name": o, "tags": s.tags_of(o)})).collect::<Vec<_>>(),
        "curve_chips": chips, "curve_ev": ev,
    }))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct PlayerQuery {
    pub search: String,
    pub tag: Option<String>,
    pub min_hands: u32,
    pub sort: Option<String>,
    pub desc: Option<bool>,
    pub offset: usize,
    pub limit: usize,
    pub include_hero: bool,
}

fn player_json(s: &crate::store::Store, name: &str, st: &crate::stats::players::PStats) -> Value {
    json!({
        "name": name, "tags": s.tags_of(name), "manual_tags": s.meta.get(name).map(|m| m.0.clone()).unwrap_or_default(),
        "notes": s.meta.get(name).map(|m| m.1.clone()).unwrap_or_default(),
        "hands": st.hands, "tournaments": st.tournaments,
        "vpip": st.stat("vpip"), "pfr": st.stat("pfr"), "limp_btn": st.stat("limp_btn"), "shove_btn": st.stat("shove_btn"),
        "raise_btn": st.stat("raise_btn"), "threebet": st.stat("threebet"), "call_shove_bb": st.stat("call_shove_bb"),
        "af": st.stat("af"), "wtsd": st.stat("wtsd"), "wsd": st.stat("wsd"), "cbet": st.stat("cbet"), "fold_cbet": st.stat("fold_cbet"),
        "cev": st.stat("cev"), "cev_vs_hero": st.stat("cev_vs_hero"), "hero_cev_vs": st.stat("hero_cev_vs"),
        "vs_hero_tournaments": st.vs_hero_tournaments, "hero_profit_vs": st.hero_profit_vs, "hero_ev_profit_vs": st.hero_ev_profit_vs,
        "hu_matches": st.hu_matches, "hero_profit_hu_vs": st.hero_profit_hu_vs, "cev_hu_vs": st.stat("cev_hu_vs"), "chips_hu_vs": st.stat("chips_hu_vs"),
        "hero_wins_vs": st.hero_wins_vs, "their_wins_vs": st.their_wins_vs,
        "last_ts": st.last_ts, "first_ts": st.first_ts, "is_hero": s.is_hero(name),
    })
}

#[tauri::command]
pub fn players(state: State<AppState>, q: PlayerQuery) -> Value {
    let s = state.store.read();
    let search = q.search.to_lowercase();
    let mut list: Vec<(&String, &crate::stats::players::PStats)> = s
        .pstats
        .iter()
        .filter(|(n, st)| {
            (q.include_hero || !s.is_hero(n))
                && st.hands >= q.min_hands
                && (search.is_empty() || n.to_lowercase().contains(&search))
                && q.tag.as_ref().map(|t| s.tags_of(n).contains(t)).unwrap_or(true)
        })
        .collect();
    let key = q.sort.clone().unwrap_or_else(|| "tournaments".into());
    list.sort_by(|a, b| {
        let va = if key == "last_ts" {
            a.1.last_ts as f64
        } else if key == "hero_profit_vs" {
            a.1.hero_profit_vs
        } else if key == "hero_ev_profit_vs" {
            a.1.hero_ev_profit_vs
        } else if key == "vs_hero_tournaments" {
            a.1.vs_hero_tournaments as f64
        } else {
            a.1.stat(&key)
        };
        let vb = if key == "last_ts" {
            b.1.last_ts as f64
        } else if key == "hero_profit_vs" {
            b.1.hero_profit_vs
        } else if key == "hero_ev_profit_vs" {
            b.1.hero_ev_profit_vs
        } else if key == "vs_hero_tournaments" {
            b.1.vs_hero_tournaments as f64
        } else {
            b.1.stat(&key)
        };
        va.partial_cmp(&vb).unwrap().then(a.0.cmp(b.0))
    });
    if q.desc.unwrap_or(true) {
        list.reverse();
    }
    let total = list.len();
    let limit = if q.limit == 0 { 100 } else { q.limit };
    let rows: Vec<Value> = list.iter().skip(q.offset).take(limit).map(|(n, st)| player_json(&s, n, st)).collect();
    json!({ "total": total, "rows": rows })
}

#[tauri::command]
pub fn player_profile(state: State<AppState>, name: String) -> R<Value> {
    let s = state.store.read();
    let st = s.pstats.get(&name).ok_or("joueur inconnu")?;
    let mut v = player_json(&s, &name, st);
    // tournois ensemble
    let together: Vec<Value> = s
        .tours
        .iter()
        .rev()
        .filter(|t| t.opponents.contains(&name))
        .take(100)
        .map(|t| json!({"id": t.t.id, "start": t.t.start, "multiplier": t.t.multiplier, "place": t.place, "profit": t.real, "ev": t.ev, "chips": t.chips, "buyin": t.t.buyin}))
        .collect();
    let hu: Vec<f64> = s.tours.iter().filter(|t| t.hu_opp.as_deref() == Some(name.as_str())).map(|t| t.hu_ev).collect();
    let (hu_cev, hu_ci) = mean_ci(&hu);
    let evs: Vec<f64> = s.tours.iter().filter(|t| t.opponents.contains(&name)).map(|t| t.ev).collect();
    let (cev, ci) = mean_ci(&evs);
    v["together"] = json!(together);
    v["hu_matches"] = json!(hu.len());
    v["hero_cev_hu_vs"] = json!(hu_cev);
    v["hero_cev_hu_vs_ci"] = json!(hu_ci);
    v["hero_cev_vs_ci"] = json!(ci);
    v["hero_cev_vs"] = json!(cev);
    Ok(v)
}

#[tauri::command]
pub fn save_player_meta(state: State<AppState>, name: String, tags: Vec<String>, notes: String) -> R<()> {
    state.db.lock().save_player(&name, &tags, &notes)?;
    let mut s = state.store.write();
    s.meta.insert(name, (tags, notes));
    Ok(())
}

#[tauri::command]
pub fn tags_overview(state: State<AppState>) -> Value {
    let s = state.store.read();
    let rows: Vec<Value> = s
        .settings
        .tags
        .iter()
        .map(|td| {
            let players = s.pstats.keys().filter(|n| !s.is_hero(n) && s.tags_of(n).contains(&td.id)).count();
            let evs: Vec<f64> = s.tours.iter().filter(|t| t.opponents.iter().any(|o| s.tags_of(o).contains(&td.id))).map(|t| t.ev).collect();
            let hu: Vec<f64> = s
                .tours
                .iter()
                .filter(|t| t.hu_opp.as_ref().map(|o| s.tags_of(o).contains(&td.id)).unwrap_or(false))
                .map(|t| t.hu_ev)
                .collect();
            let (cev, ci) = mean_ci(&evs);
            let (hcev, hci) = mean_ci(&hu);
            json!({"id": td.id, "players": players, "tournaments": evs.len(), "cev": cev, "cev_ci": ci, "cev_hu": hcev, "cev_hu_ci": hci, "hu_matches": hu.len()})
        })
        .collect();
    json!(rows)
}

#[tauri::command]
pub fn leak_report(state: State<AppState>, player: String, filter: Filter, reference: String) -> LeakReport {
    leaks::leak_report(&state.store.read(), &player, &filter, &reference, true)
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    state.store.read().settings.clone()
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: Settings) -> R<()> {
    let js = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    state.db.lock().kv_set("settings", &js)?;
    let mut s = state.store.write();
    let heroes_changed = s.settings.heroes != settings.heroes;
    s.settings = settings;
    if heroes_changed {
        for h in s.settings.heroes.clone() {
            s.heroes.insert(h);
        }
    }
    s.recompute_money();
    s.recompute_players();
    Ok(())
}

#[tauri::command]
pub fn default_settings() -> Settings {
    Settings::default()
}

#[tauri::command]
pub fn get_ui(state: State<AppState>) -> Option<String> {
    state.db.lock().kv_get("ui")
}

#[tauri::command]
pub fn set_ui(state: State<AppState>, value: String) -> R<()> {
    state.db.lock().kv_set("ui", &value)
}

#[tauri::command]
pub fn challenges_list(state: State<AppState>, now: i64) -> R<Vec<ChallengeView>> {
    let rows = state.db.lock().load_challenges()?;
    let s = state.store.read();
    Ok(rows
        .into_iter()
        .filter_map(|(id, d)| {
            let mut c: Challenge = serde_json::from_str(&d).ok()?;
            c.id = Some(id);
            Some(challenges::view(&s, &c, now))
        })
        .collect())
}

#[tauri::command]
pub fn save_challenge(state: State<AppState>, challenge: Challenge) -> R<i64> {
    let js = serde_json::to_string(&challenge).map_err(|e| e.to_string())?;
    state.db.lock().save_challenge(challenge.id, &js)
}

#[tauri::command]
pub fn delete_challenge(state: State<AppState>, id: i64) -> R<()> {
    state.db.lock().delete_challenge(id)
}

#[tauri::command]
pub fn imports_history(state: State<AppState>) -> R<Vec<Value>> {
    state.db.lock().imports()
}

/// Supprime un import et toutes les mains qu'il avait ajoutées.
#[tauri::command]
pub fn delete_import(state: State<AppState>, id: i64) -> R<Value> {
    let (hands, tours) = state.db.lock().delete_import(id)?;
    let mut s = state.store.write();
    let mut fresh = crate::store::Store {
        settings: s.settings.clone(),
        meta: s.meta.clone(),
        favorites: s.favorites.clone(),
        ..Default::default()
    };
    crate::import::load(&mut state.db.lock(), &mut fresh)?;
    *s = fresh;
    Ok(json!({ "hands": hands, "tournaments": tours }))
}

#[tauri::command]
pub fn set_favorite(state: State<AppState>, id: String, on: bool, note: Option<String>) -> R<()> {
    let note = note.unwrap_or_default();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    state.db.lock().set_favorite(&id, on, &note, now)?;
    let mut s = state.store.write();
    if on {
        s.favorites.insert(id, note);
    } else {
        s.favorites.remove(&id);
    }
    Ok(())
}

#[tauri::command]
pub fn wipe_database(state: State<AppState>) -> R<()> {
    state.db.lock().wipe()?;
    let mut s = state.store.write();
    s.favorites.clear();
    s.rebuild(vec![], vec![]);
    Ok(())
}

#[tauri::command]
pub fn backup_database(state: State<AppState>, path: String) -> R<()> {
    let db = state.db.lock();
    db.conn.execute("VACUUM INTO ?1", [path]).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_csv(state: State<AppState>, filter: Filter, path: String) -> R<usize> {
    let s = state.store.read();
    let sel = filter.select(&s);
    let mut out = String::from(
        "id;date;room;name;buyin;multiplier;prize_pool;place;winnings;profit;rakeback;chips;ev_chips;ev_profit;ev_multi;ev_effectif;hands;tables\n",
    );
    for &i in &sel {
        let t = &s.tours[i];
        let (y, m, d) = breakdown::civil(t.day);
        let sec = t.t.start.rem_euclid(86400);
        out.push_str(&format!(
            "{};{:04}-{:02}-{:02} {:02}:{:02};{};{};{:.2};{};{:.2};{};{:.2};{:.2};{:.4};{:.0};{:.1};{:.4};{:.4};{:.4};{};{:.2}\n",
            t.t.id,
            y,
            m,
            d,
            sec / 3600,
            (sec % 3600) / 60,
            t.t.room,
            t.t.name,
            t.t.buyin,
            t.t.multiplier,
            t.t.prize_pool,
            t.place,
            t.winnings,
            t.real,
            t.rb,
            t.chips,
            t.ev,
            t.ev_theo,
            t.ev_multi,
            t.ev_eff,
            t.hands.len(),
            t.tables
        ));
    }
    std::fs::write(&path, out).map_err(|e| e.to_string())?;
    Ok(sel.len())
}

#[tauri::command]
pub fn scenarios() -> Vec<&'static str> {
    Scenario::ALL.iter().map(|s| s.label()).collect()
}
