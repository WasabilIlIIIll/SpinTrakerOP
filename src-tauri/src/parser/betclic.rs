//! Nouveau format texte de Betclic (logiciel maison depuis fin 2024, fichiers « ExportHH »).
//!
//! Format vérifié sur de vrais exports (Betclic.fr, « Spin & Rush », juin 2026) :
//! ```text
//! *** HEADER ***
//! Site: Betclic.fr
//! Game Mode: Spin
//! Game Name: Spin & Rush 2€
//! Game ID: 01KV6M4YDEAKQ5HX5Q0B4AC1C2
//! Prize pool: 6.00€
//! Multiplier: x3
//! Buy In: 2.00€
//! Hand ID: 01KV6M5BBCK4NDX130BV07J12V
//! Date & Time: 2026-06-15 21:49:19 (UTC)
//! Blinds: 10/20
//! *** PLAYERS ***
//! Seat 2: Pseudo (500) [SB Hero]
//! *** HOLE CARDS ***
//! Pseudo: [Qh As]
//! *** PRE-FLOP ***
//! 21:49:24 - Pseudo: Raises to 50
//! *** SHOWDOWN ***
//! Pseudo shows [Qh As] (High Card) [As Kc Qh 8d 5s]
//! *** SUMMARY ***
//! Autre wins main pot of 1000        (ou « wins 1st side pot of N »)
//! Pseudo finished 3rd                (ou « finished 1st and wins 6.00 EUR »)
//! ------------
//! ```
//! Les mains d'un fichier sont en ordre antichronologique et un tournoi peut être à cheval
//! sur deux exports quotidiens. Variante plus ancienne décrite par le projet vpip-tracker :
//! ```text
//! Hand ID: 123456
//! Game ID: 987654
//! Game Name: Twister 5€
//! Buy In: …
//! Date & Time: 2025-06-11 00:29:42
//! Ante: 0
//! Blinds: 10/20
//! *** PLAYERS ***
//! Seat 1: Pseudo (500) [BTN Hero]
//! *** PRE-FLOP ***
//! 00:29:43 - Pseudo: Posts SB 10
//! 00:29:45 - Pseudo: Raises to 40
//! ---
//! ```
//! Sans lignes de gains, ceux-ci sont reconstitués à partir des tapis de la main suivante
//! ou de l'abattage.

use super::common::{cards_in_brackets, first_num, resolve_wins_by_stacks};
use super::{parse_date_tz, parse_num, ParsedFile};
use crate::model::*;
use std::collections::BTreeMap;

pub fn looks_like(c: &str) -> bool {
    c.contains("Hand ID:") && c.contains("*** PLAYERS ***")
}

/// Valeur d'un en-tête « Clé: valeur », sans tenir compte de la casse de la clé.
fn header<'a>(block: &'a str, key: &str) -> Option<&'a str> {
    block.lines().find_map(|l| {
        let l = l.trim();
        (l.len() >= key.len() && l.is_char_boundary(key.len()) && l[..key.len()].eq_ignore_ascii_case(key)).then(|| l[key.len()..].trim())
    })
}

/// Montant qui suit « of » (« wins 1st side pot of 155 »).
fn amount_after_of(s: &str) -> Option<f64> {
    s.rfind(" of ").and_then(|i| first_num(&s[i + 4..])).or_else(|| first_num(s))
}

struct Raw {
    tid: String,
    name: String,
    buyin: String,
    hand: Hand,
    had_wins: bool,
    prize: f64,
    mult: f64,
    /// place du héros et gain annoncés dans le résumé
    hero_place: u8,
    hero_prize: f64,
}

fn parse_block(block: &str) -> Option<Raw> {
    let hid = header(block, "Hand ID:")?.to_string();
    let tcode = header(block, "Game ID:").or_else(|| header(block, "Tournament ID:")).or_else(|| header(block, "Table ID:"))?.to_string();
    let name = header(block, "Game Name:").unwrap_or("Betclic").to_string();
    let buyin = header(block, "Buy In:").or_else(|| header(block, "Buy-In:")).unwrap_or("").to_string();
    let ts = header(block, "Date & Time:").and_then(parse_date_tz).unwrap_or(0);
    let ante = header(block, "Ante:").map(parse_num).unwrap_or(0.0);
    let (sb, bb) = header(block, "Blinds:")
        .map(|b| {
            let p: Vec<f64> = b.split('/').map(parse_num).collect();
            (*p.first().unwrap_or(&0.0), *p.get(1).unwrap_or(&0.0))
        })
        .unwrap_or((0.0, 0.0));
    let prize = ["Prize Pool:", "Prizepool:", "Total Prize:", "Prize:"].iter().find_map(|k| header(block, k)).map(parse_num).unwrap_or(0.0);
    let mult = header(block, "Multiplier:").and_then(first_num).unwrap_or(0.0);
    let mut placed: Vec<(usize, u8, f64)> = Vec::new();

    let mut seats: Vec<Seat> = Vec::new();
    let mut hero: Option<usize> = None;
    let mut button = 0usize;
    let mut section = "";
    let mut street = STREET_PREFLOP;
    let mut board: Vec<Card> = Vec::new();
    let mut actions: Vec<Action> = Vec::new();
    let mut street_put: Vec<f64> = Vec::new();
    let mut remaining: Vec<f64> = Vec::new();
    let mut had_wins = false;

    for raw in block.lines() {
        let l = raw.trim();
        if let Some(st) = l.strip_prefix("***") {
            let tag = st.trim_end_matches('*').trim().to_ascii_uppercase();
            section = if tag.starts_with("PLAYERS") {
                "players"
            } else if tag.starts_with("PRE") {
                street = STREET_PREFLOP;
                "actions"
            } else if tag.starts_with("FLOP") {
                street = STREET_FLOP;
                "actions"
            } else if tag.starts_with("TURN") {
                street = STREET_TURN;
                "actions"
            } else if tag.starts_with("RIVER") {
                street = STREET_RIVER;
                "actions"
            } else if tag.starts_with("SHOW") || tag.starts_with("SUMMARY") {
                // abattage et résumé : cartes montrées, gains et places ; la street ne change pas
                "actions"
            } else if tag.starts_with("HOLE") {
                "hole"
            } else {
                "other"
            };
            if street > STREET_PREFLOP && (tag.starts_with("FLOP") || tag.starts_with("TURN") || tag.starts_with("RIVER")) {
                street_put.iter_mut().for_each(|x| *x = 0.0);
            }
            let cs = cards_in_brackets(l);
            if cs.len() >= board.len() {
                board = cs;
            } else {
                board.extend(cs);
            }
            continue;
        }
        if let Some(b) = l.strip_prefix("Board:").or_else(|| l.strip_prefix("Community Cards:")) {
            let cs = cards_in_brackets(&format!("[{}]", b.trim().trim_matches(|c| c == '[' || c == ']')));
            if cs.len() > board.len() {
                board = cs;
            }
            continue;
        }
        if section == "players" && l.starts_with("Seat") {
            // Seat 1: Pseudo (500, €2.25 bounty) [BTN Hero]
            let Some(colon) = l.find(':') else { continue };
            let rest = &l[colon + 1..];
            let Some(open) = rest.find('(') else { continue };
            let pname = rest[..open].trim().to_string();
            let stack = first_num(&rest[open..]).unwrap_or(0.0);
            let tags = rest.rfind('[').map(|i| rest[i..].to_ascii_uppercase()).unwrap_or_default();
            if tags.contains("HERO") {
                hero = Some(seats.len());
            }
            if tags.contains("BTN") || tags.contains("BUTTON") {
                button = seats.len();
            }
            let seat_no: u8 = l[4..colon].trim().parse().unwrap_or(seats.len() as u8 + 1);
            let cs = cards_in_brackets(rest);
            seats.push(Seat { name: pname, seat: seat_no, stack, cards: if cs.len() == 2 { Some([cs[0], cs[1]]) } else { None }, bet: 0.0, win: 0.0 });
            street_put.push(0.0);
            remaining.push(stack);
            continue;
        }
        if section != "actions" && section != "hole" {
            continue;
        }
        // "00:29:43 - Pseudo: Raises to 40" (l'horodatage est facultatif)
        let body = match l.find(" - ") {
            Some(i) if l[..i].chars().all(|c| c.is_ascii_digit() || c == ':') => &l[i + 3..],
            _ => l,
        };
        // « Pseudo: action » dans les streets, « Pseudo shows/wins/finished … » ailleurs
        let Some((who, what)) = seats
            .iter()
            .enumerate()
            .filter(|(_, s)| body.starts_with(&s.name) && (body[s.name.len()..].starts_with(':') || body[s.name.len()..].starts_with(' ')))
            .max_by_key(|(_, s)| s.name.len())
            .map(|(i, s)| (i, body[s.name.len() + 1..].trim()))
        else {
            continue;
        };
        let w = what.to_ascii_lowercase();
        if section == "hole" {
            let cs = cards_in_brackets(what);
            if cs.len() >= 2 {
                seats[who].cards = Some([cs[0], cs[1]]);
            }
            continue;
        }
        if let Some(rest) = w.strip_prefix("finished ") {
            let place = rest.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0);
            let won = rest.find(" wins ").and_then(|i| first_num(&rest[i + 6..])).unwrap_or(0.0);
            placed.push((who, place, won));
            continue;
        }
        let allin = w.contains("all-in") || w.contains("all in") || w.contains("allin");
        let cs = cards_in_brackets(what);
        if cs.len() >= 2 && (w.starts_with("show") || w.starts_with("dealt") || w.starts_with("cards") || w.starts_with("muck") || w.starts_with("hole")) {
            seats[who].cards = Some([cs[0], cs[1]]);
            continue;
        }
        if w.starts_with("win") || w.starts_with("collect") || w.starts_with("won") {
            if let Some(v) = amount_after_of(what) {
                seats[who].win += v;
                had_wins = true;
            }
            continue;
        }
        let (kind, amount) = if w.starts_with("posts ante") {
            (ActKind::Ante, first_num(what).unwrap_or(0.0))
        } else if w.starts_with("posts sb") || w.starts_with("posts small") {
            (ActKind::SmallBlind, first_num(what).unwrap_or(0.0))
        } else if w.starts_with("posts bb") || w.starts_with("posts big") {
            (ActKind::BigBlind, first_num(what).unwrap_or(0.0))
        } else if w.starts_with("fold") {
            (ActKind::Fold, 0.0)
        } else if w.starts_with("check") {
            (ActKind::Check, 0.0)
        } else if w.starts_with("call") {
            (ActKind::Call, first_num(what).unwrap_or(0.0))
        } else if w.starts_with("bet") {
            (ActKind::Bet, first_num(what).unwrap_or(0.0))
        } else if w.starts_with("raise") {
            // "Raises to 40" = total de la street
            let to = first_num(what.split(" to ").nth(1).unwrap_or(what)).unwrap_or(0.0);
            (ActKind::Raise, (to - street_put[who]).max(0.0))
        } else {
            continue;
        };
        let amount = amount.min(remaining[who]);
        remaining[who] -= amount;
        if kind != ActKind::Ante {
            street_put[who] += amount;
        }
        seats[who].bet += amount;
        actions.push(Action { street, p: who as u8, kind, amount, allin: allin || (remaining[who] <= 1e-9 && amount > 0.0) });
    }
    if seats.len() < 2 {
        return None;
    }
    let hero = hero? as u8;
    let (hero_place, hero_prize) = placed.iter().find(|p| p.0 == hero as usize).map(|p| (p.1, p.2)).unwrap_or((0, 0.0));
    Some(Raw {
        tid: format!("bcl:{tcode}"),
        name,
        buyin,
        hand: Hand { id: format!("bcl:{hid}"), tid: format!("bcl:{tcode}"), ts, sb, bb, ante, seats, button: button as u8, hero, actions, board },
        had_wins,
        prize,
        mult,
        hero_place,
        hero_prize,
    })
}

pub fn parse(c: &str, source: &str) -> Result<Vec<ParsedFile>, String> {
    // les mains sont séparées par une ligne de tirets
    let mut blocks: Vec<String> = Vec::new();
    let mut cur = String::new();
    for l in c.lines() {
        if l.trim().len() >= 3 && l.trim().chars().all(|ch| ch == '-') {
            if !cur.trim().is_empty() {
                blocks.push(std::mem::take(&mut cur));
            }
            continue;
        }
        if l.trim_start().starts_with("Hand ID:") && cur.contains("Hand ID:") {
            blocks.push(std::mem::take(&mut cur));
        }
        cur.push_str(l);
        cur.push('\n');
    }
    if !cur.trim().is_empty() {
        blocks.push(cur);
    }
    let mut by_t: BTreeMap<String, (Vec<Raw>, String)> = BTreeMap::new();
    for b in &blocks {
        if let Some(r) = parse_block(b) {
            by_t.entry(r.tid.clone()).or_insert_with(|| (Vec::new(), String::new())).0.push(r);
        }
    }
    if by_t.is_empty() {
        return Err("aucune main Betclic reconnue".into());
    }
    let mut out = Vec::new();
    for (tid, (mut raws, _)) in by_t {
        raws.sort_by(|a, b| a.hand.ts.cmp(&b.hand.ts).then(a.hand.id.cmp(&b.hand.id)));
        let any_wins = raws.iter().any(|r| r.had_wins);
        let first = &raws[0];
        let parts: Vec<f64> = first.buyin.split('+').map(parse_num).filter(|v| *v > 0.0).collect();
        let total: f64 = parts.iter().sum();
        let (rake, prize_contrib) = match parts.len() {
            0 => (0.0, 0.0),
            // Betclic n'indique pas le rake (annoncé entre 3 et 6 % selon le multiplicateur) : 5 %
            1 => (parts[0] * 0.05, parts[0] * 0.95),
            _ => {
                let mn = parts.iter().cloned().fold(f64::MAX, f64::min);
                (mn, total - mn)
            }
        };
        let prize = raws.iter().map(|r| r.prize).fold(0.0, f64::max);
        let mult = raws.iter().map(|r| r.mult).fold(0.0, f64::max);
        let (place, winnings) = raws.iter().find(|r| r.hero_place > 0).map(|r| (r.hero_place, r.hero_prize)).unwrap_or((0, 0.0));
        let hero_name = first.hand.seats[first.hand.hero as usize].name.clone();
        let table_size = raws.iter().map(|r| r.hand.seats.len()).max().unwrap_or(3) as u8;
        let starting_stack = first.hand.seats[first.hand.hero as usize].stack;
        let (start, end) = (first.hand.ts, raws.last().map(|r| r.hand.ts).unwrap_or(first.hand.ts));
        let name = first.name.clone();
        let mut hands: Vec<Hand> = raws.into_iter().map(|r| r.hand).collect();
        if !any_wins {
            resolve_wins_by_stacks(&mut hands);
        }
        let t = Tournament {
            id: tid.clone(),
            room: "Betclic".into(),
            code: tid.trim_start_matches("bcl:").into(),
            name,
            hero: hero_name,
            start,
            end,
            buyin: total,
            rake,
            prize_contrib,
            bounty: 0.0,
            prize_pool: prize,
            multiplier: if mult > 0.0 { mult } else if total > 0.0 && prize > 0.0 { prize / total } else { 0.0 },
            place,
            winnings,
            table_size,
            currency: "EUR".into(),
            starting_stack,
            hands: hands.len() as u32,
            source: source.into(),
        };
        out.push(ParsedFile { tournament: t, hands });
    }
    Ok(out)
}
