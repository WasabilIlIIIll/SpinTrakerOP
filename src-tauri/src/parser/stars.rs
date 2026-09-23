//! Formats texte « façon PokerStars » : PokerStars (Spin & Go) et Unibet (logiciel 2026).
//!
//! PokerStars : `PokerStars Hand #…: Tournament #…, €4.60+€0.40 EUR Hold'em No Limit - Level I (10/20) - 2025/01/01 20:00:00 CET`
//! Unibet     : `Unibet Hand #…, Tournament #…, €0.93 + €0.07 - 25.00/50.00 - No Limit Hold'Em - Total prize €4 - UTC 21:59:56 2026/06/05`
//!
//! Les fichiers « Tournament summary » de PokerStars complètent place, gains et prize pool.
//! Statut : bêta (formats reconstitués d'après la documentation publique des trackers).

use super::common::{cards_in_brackets, first_num, resolve_wins_by_cards};
use super::{days_from_civil, parse_date, parse_num, utc_to_paris, ParsedFile};
use crate::model::*;
use std::collections::BTreeMap;

pub fn looks_like(c: &str) -> bool {
    let head = c.trim_start().lines().next().unwrap_or("");
    (head.contains("Hand #") && (head.starts_with("PokerStars") || head.starts_with("Unibet")))
        || head.starts_with("PokerStars Tournament #")
}

fn room_of(head: &str) -> &'static str {
    if head.starts_with("Unibet") {
        "Unibet"
    } else {
        "PokerStars"
    }
}

/// Pseudo sans suffixe technique (« Pseudo [Unibet_28204e…] » -> « Pseudo »).
fn clean_name(n: &str) -> String {
    let n = n.trim();
    match n.rfind(" [") {
        Some(i) if n.ends_with(']') => n[..i].trim().to_string(),
        _ => n.to_string(),
    }
}

/// Date « AAAA/MM/JJ HH:MM:SS » ou « HH:MM:SS AAAA/MM/JJ » (Unibet), ramenée à l'heure de
/// Paris si elle est donnée en UTC.
fn find_date(s: &str) -> Option<i64> {
    let ts = find_date_raw(s)?;
    Some(if s.contains("UTC") { utc_to_paris(ts) } else { ts })
}

fn find_date_raw(s: &str) -> Option<i64> {
    let toks: Vec<&str> = s.split_whitespace().collect();
    for w in toks.windows(2) {
        let (a, b) = (w[0], w[1]);
        let is_date = |t: &str| t.len() >= 8 && t.chars().filter(|c| *c == '/' || *c == '-').count() == 2 && t.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false);
        let is_time = |t: &str| t.chars().filter(|c| *c == ':').count() == 2 && t.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false);
        if is_date(a) && is_time(b) {
            return parse_date(&format!("{a} {b}"));
        }
        if is_time(a) && is_date(b) {
            return parse_date(&format!("{b} {a}"));
        }
    }
    None
}

fn between<'a>(s: &'a str, a: &str, b: &str) -> Option<&'a str> {
    let i = s.find(a)? + a.len();
    let j = s[i..].find(b).map(|j| j + i).unwrap_or(s.len());
    Some(&s[i..j])
}

struct Head {
    room: &'static str,
    hid: String,
    tcode: String,
    buyin: Vec<f64>,
    sb: f64,
    bb: f64,
    ts: i64,
    prize: f64,
}

fn parse_head(l: &str) -> Option<Head> {
    let room = room_of(l);
    let hid: String = l[l.find("Hand #")? + 6..].chars().take_while(|c| c.is_ascii_digit()).collect();
    if hid.is_empty() {
        return None;
    }
    let tcode: String = between(l, "Tournament #", ",")?.trim().chars().take_while(|c| c.is_ascii_digit()).collect();
    if tcode.is_empty() {
        return None;
    }
    // buy-in : juste après « Tournament #id, »
    let after_t = &l[l.find("Tournament #")?..];
    let seg = after_t.split(',').nth(1).unwrap_or("");
    let seg = seg.split(" - ").next().unwrap_or("");
    let buyin: Vec<f64> = seg.split(['+', '/']).map(|x| parse_num(x.split_whitespace().next().unwrap_or(""))).filter(|v| *v > 0.0).collect();
    // blinds : « (10/20) » ou « - 25.00/50.00 - »
    let blinds = if let Some(b) = between(l, "(", ")").filter(|b| b.contains('/')) {
        b.to_string()
    } else {
        l.split(" - ").find(|p| p.contains('/') && p.chars().all(|c| c.is_ascii_digit() || c == '/' || c == '.' || c == ',' || c == ' ')).unwrap_or("").to_string()
    };
    let bl: Vec<f64> = blinds.split('/').map(parse_num).collect();
    let (sb, bb) = match bl.len() {
        3 => (bl[1], bl[2]),
        2 => (bl[0], bl[1]),
        _ => (0.0, 0.0),
    };
    let prize = between(l, "Total prize", " -").map(parse_num).unwrap_or(0.0);
    Some(Head { room, hid, tcode, buyin, sb, bb, ts: find_date(l).unwrap_or(0), prize })
}

struct Raw {
    tid: String,
    room: &'static str,
    head_buyin: Vec<f64>,
    prize: f64,
    hand: Hand,
    had_wins: bool,
    max_seats: u8,
}

fn parse_hand(lines: &[&str]) -> Option<Raw> {
    let head = parse_head(lines.first()?)?;
    let mut seats: Vec<Seat> = Vec::new();
    let mut button_seat: Option<u8> = None;
    let mut max_seats = 0u8;
    let mut hero_name: Option<String> = None;
    let mut street = STREET_PREFLOP;
    let mut board: Vec<Card> = Vec::new();
    let mut actions = Vec::new();
    let mut street_put: Vec<f64> = Vec::new();
    let mut remaining: Vec<f64> = Vec::new();
    let mut had_wins = false;
    let mut in_summary = false;

    for raw in &lines[1..] {
        let l = raw.trim();
        if l.starts_with("Table ") {
            if let Some(i) = l.find("-max") {
                let digits: String = l[..i].chars().rev().take_while(|c| c.is_ascii_digit()).collect::<Vec<_>>().into_iter().rev().collect();
                max_seats = digits.parse().unwrap_or(0);
            }
            if let Some(b) = between(l, "Seat #", " ") {
                button_seat = b.parse().ok();
            }
            continue;
        }
        if l.starts_with("*** SUMMARY") {
            in_summary = true;
            continue;
        }
        if in_summary {
            continue;
        }
        if l.starts_with("***") {
            let up = l.to_ascii_uppercase();
            let ns = if up.contains("FLOP") {
                Some(STREET_FLOP)
            } else if up.contains("TURN") {
                Some(STREET_TURN)
            } else if up.contains("RIVER") {
                Some(STREET_RIVER)
            } else {
                None
            };
            if let Some(ns) = ns {
                street = ns;
                street_put.iter_mut().for_each(|x| *x = 0.0);
                board = cards_in_brackets(l);
            }
            continue;
        }
        if l.starts_with("Seat ") && l.contains(':') && l.contains('(') && actions.is_empty() {
            let colon = l.find(':')?;
            let seat_no: u8 = l[5..colon].trim().parse().unwrap_or(0);
            let rest = &l[colon + 1..];
            let open = rest.rfind('(')?;
            let name = clean_name(&rest[..open]);
            let stack = first_num(&rest[open..]).unwrap_or(0.0);
            if rest.to_ascii_lowercase().contains("button") {
                button_seat = Some(seat_no);
            }
            seats.push(Seat { name, seat: seat_no, stack, cards: None, bet: 0.0, win: 0.0 });
            street_put.push(0.0);
            remaining.push(stack);
            continue;
        }
        if let Some(r) = l.strip_prefix("Dealt to ") {
            let n = clean_name(&r[..r.find('[').unwrap_or(r.len())]);
            let cs = cards_in_brackets(r);
            if let Some(k) = seats.iter().position(|s| s.name == n) {
                if cs.len() >= 2 {
                    seats[k].cards = Some([cs[cs.len() - 2], cs[cs.len() - 1]]);
                }
                hero_name = Some(n);
            }
            continue;
        }
        if l.starts_with("Uncalled bet") {
            continue; // la mise rendue est recalculée à partir des contributions
        }
        // acteur : plus long pseudo en tête de ligne, suivi de « : » ou d'une espace
        let Some((k, verb)) = seats
            .iter()
            .enumerate()
            .filter(|(_, s)| l.starts_with(&s.name) && matches!(l[s.name.len()..].chars().next(), Some(':') | Some(' ') | Some('[')))
            .max_by_key(|(_, s)| s.name.len())
            .map(|(k, s)| {
                let mut v = l[s.name.len()..].trim_start();
                if v.starts_with('[') {
                    v = v[v.find(']').map(|i| i + 1).unwrap_or(0)..].trim_start();
                }
                (k, v.trim_start_matches(':').trim())
            })
        else {
            continue;
        };
        let w = verb.to_ascii_lowercase();
        let allin = w.contains("all-in") || w.contains("all in");
        if w.starts_with("shows") || w.starts_with("mucks") {
            let cs = cards_in_brackets(verb);
            if cs.len() >= 2 {
                seats[k].cards = Some([cs[0], cs[1]]);
            }
            continue;
        }
        if w.starts_with("collected") || w.starts_with("wins") || w.starts_with("won") {
            if let Some(v) = first_num(verb) {
                seats[k].win += v;
                had_wins = true;
            }
            continue;
        }
        let (kind, amount) = if w.contains("posts") && w.contains("ante") {
            (ActKind::Ante, first_num(verb).unwrap_or(0.0))
        } else if w.contains("posts small blind") || w.contains("posts the small blind") {
            (ActKind::SmallBlind, first_num(verb).unwrap_or(0.0))
        } else if w.contains("posts big blind") || w.contains("posts the big blind") {
            (ActKind::BigBlind, first_num(verb).unwrap_or(0.0))
        } else if w.starts_with("folds") {
            (ActKind::Fold, 0.0)
        } else if w.starts_with("checks") {
            (ActKind::Check, 0.0)
        } else if w.starts_with("calls") {
            (ActKind::Call, first_num(verb).unwrap_or(0.0))
        } else if w.starts_with("bets") {
            (ActKind::Bet, first_num(verb).unwrap_or(0.0))
        } else if w.starts_with("raises") {
            let to = verb.split(" to ").nth(1).and_then(first_num).unwrap_or(0.0);
            (ActKind::Raise, (to - street_put[k]).max(0.0))
        } else {
            continue;
        };
        let amount = amount.min(remaining[k]);
        remaining[k] -= amount;
        if kind != ActKind::Ante {
            street_put[k] += amount;
        }
        seats[k].bet += amount;
        actions.push(Action { street, p: k as u8, kind, amount, allin: allin || (remaining[k] <= 1e-9 && amount > 0.0) });
    }
    if seats.len() < 2 {
        return None;
    }
    let hero = seats.iter().position(|s| Some(&s.name) == hero_name.as_ref())? as u8;
    let button = match button_seat.and_then(|b| seats.iter().position(|s| s.seat == b)) {
        Some(b) => b,
        None => {
            // à défaut : le bouton précède la small blind (en HU, c'est la small blind)
            let sbp = actions.iter().find(|a| a.kind == ActKind::SmallBlind).map(|a| a.p as usize).unwrap_or(0);
            if seats.len() == 2 {
                sbp
            } else {
                (sbp + seats.len() - 1) % seats.len()
            }
        }
    };
    let tid = format!("{}:{}", if head.room == "Unibet" { "unb" } else { "pst" }, head.tcode);
    Some(Raw {
        tid: tid.clone(),
        room: head.room,
        head_buyin: head.buyin,
        prize: head.prize,
        max_seats: if max_seats > 0 { max_seats } else { seats.len() as u8 },
        had_wins,
        hand: Hand { id: format!("{tid}:{}", head.hid), tid, ts: head.ts, sb: head.sb, bb: head.bb, ante: 0.0, seats, button: button as u8, hero, actions, board },
    })
}

/// Résumé de tournoi PokerStars.
fn parse_summary(c: &str, source: &str) -> Result<Vec<ParsedFile>, String> {
    let first = c.trim_start().lines().next().unwrap_or("");
    let code: String = between(first, "Tournament #", ",").unwrap_or("").chars().take_while(|c| c.is_ascii_digit()).collect();
    if code.is_empty() {
        return Err("résumé PokerStars sans identifiant".into());
    }
    let mut t = Tournament { id: format!("pst:{code}"), room: "PokerStars".into(), code, name: "Spin & Go".into(), currency: "EUR".into(), table_size: 3, source: source.into(), ..Default::default() };
    for l in c.lines().map(str::trim) {
        if let Some(v) = l.strip_prefix("Buy-In:") {
            let parts: Vec<f64> = v.split(['/', '+']).map(parse_num).filter(|x| *x > 0.0).collect();
            t.buyin = parts.iter().sum();
            if parts.len() >= 2 {
                t.rake = parts[1..].iter().sum();
                t.prize_contrib = parts[0];
            }
        } else if let Some(v) = l.strip_prefix("Total Prize Pool:") {
            t.prize_pool = parse_num(v.split_whitespace().next().unwrap_or(""));
        } else if l.ends_with("players") {
            t.table_size = first_num(l).unwrap_or(3.0) as u8;
        } else if let Some(v) = l.strip_prefix("You finished in ") {
            t.place = v.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0);
        } else if l.starts_with("Tournament started") {
            t.start = find_date(l).unwrap_or(0);
        } else if l.starts_with("1:") && l.contains('(') {
            // « 1: Pseudo (Pays), €10.00 (100%) » : utile si le héros a gagné
            if t.winnings == 0.0 {
                if let Some(v) = l.split("),").nth(1) {
                    t.winnings = parse_num(v.split_whitespace().next().unwrap_or(""));
                }
            }
        }
    }
    if t.place != 1 {
        t.winnings = 0.0;
    }
    if t.buyin > 0.0 {
        t.multiplier = t.prize_pool / t.buyin;
    }
    Ok(vec![ParsedFile { tournament: t, hands: vec![] }])
}

pub fn parse(c: &str, source: &str) -> Result<Vec<ParsedFile>, String> {
    let c = c.trim_start_matches('\u{feff}');
    if c.trim_start().starts_with("PokerStars Tournament #") {
        return parse_summary(c, source);
    }
    let mut blocks: Vec<Vec<&str>> = Vec::new();
    for l in c.lines() {
        let t = l.trim_start();
        if (t.starts_with("PokerStars Hand #") || t.starts_with("Unibet Hand #")) && t.contains("Tournament #") {
            blocks.push(Vec::new());
        }
        if let Some(b) = blocks.last_mut() {
            b.push(l);
        }
    }
    let mut by_t: BTreeMap<String, Vec<Raw>> = BTreeMap::new();
    for b in &blocks {
        if let Some(r) = parse_hand(b) {
            by_t.entry(r.tid.clone()).or_default().push(r);
        }
    }
    if by_t.is_empty() {
        return Err("aucune main de tournoi reconnue".into());
    }
    let mut out = Vec::new();
    for (tid, mut raws) in by_t {
        raws.sort_by(|a, b| a.hand.ts.cmp(&b.hand.ts).then(a.hand.id.cmp(&b.hand.id)));
        let f = &raws[0];
        let total: f64 = f.head_buyin.iter().sum();
        let (rake, prize_contrib) = if f.head_buyin.len() >= 2 {
            let mn = f.head_buyin.iter().cloned().fold(f64::MAX, f64::min);
            (mn, total - mn)
        } else {
            (0.0, total)
        };
        let prize = raws.iter().map(|r| r.prize).fold(0.0, f64::max);
        let room = f.room;
        let max_seats = raws.iter().map(|r| r.max_seats).max().unwrap_or(3);
        let hero_name = f.hand.seats[f.hand.hero as usize].name.clone();
        let starting_stack = f.hand.seats[f.hand.hero as usize].stack;
        let (start, end) = (f.hand.ts, raws.last().map(|r| r.hand.ts).unwrap_or(0));
        let mut hands: Vec<Hand> = Vec::new();
        for mut r in raws {
            if !r.had_wins {
                resolve_wins_by_cards(&mut r.hand);
            }
            hands.push(r.hand);
        }
        let t = Tournament {
            id: tid.clone(),
            room: room.into(),
            code: tid.split(':').nth(1).unwrap_or("").into(),
            name: if room == "Unibet" { "Unibet Spin".into() } else { "Spin & Go".into() },
            hero: hero_name,
            start,
            end,
            buyin: total,
            rake,
            prize_contrib,
            bounty: 0.0,
            prize_pool: prize,
            multiplier: if total > 0.0 && prize > 0.0 { prize / total } else { 0.0 },
            place: 0,
            winnings: 0.0,
            table_size: max_seats,
            currency: "EUR".into(),
            starting_stack,
            hands: hands.len() as u32,
            source: source.into(),
        };
        out.push(ParsedFile { tournament: t, hands });
    }
    let _ = days_from_civil;
    Ok(out)
}
