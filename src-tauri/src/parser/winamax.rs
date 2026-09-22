//! Parser Winamax (Expresso) — historiques texte + fichiers "summary". Statut : bêta.

use super::{parse_date, parse_num, ParsedFile};
use crate::model::*;

pub fn looks_like(c: &str) -> bool {
    c.starts_with("Winamax Poker") || c.contains("\nWinamax Poker - ")
}

fn card(s: &str) -> Option<Card> {
    let b = s.as_bytes();
    if b.len() != 2 {
        return None;
    }
    let r = b"23456789TJQKA".iter().position(|&x| x == b[0].to_ascii_uppercase())? as u8;
    let su = match b[1].to_ascii_lowercase() {
        b'c' => 0,
        b'd' => 1,
        b'h' => 2,
        b's' => 3,
        _ => return None,
    };
    Some(r * 4 + su)
}

fn cards_in_brackets(s: &str) -> Vec<Card> {
    let mut out = Vec::new();
    let mut rest = s;
    while let Some(a) = rest.find('[') {
        let Some(b) = rest[a..].find(']') else { break };
        out.extend(rest[a + 1..a + b].split_whitespace().filter_map(card));
        rest = &rest[a + b + 1..];
    }
    out
}

fn between<'a>(s: &'a str, a: &str, b: &str) -> Option<&'a str> {
    let i = s.find(a)? + a.len();
    let j = s[i..].find(b)? + i;
    Some(&s[i..j])
}

fn tid_from_table(line: &str) -> Option<String> {
    // Table: 'Expresso(603548617)#0' 3-max ...
    let t = between(line, "'", "'")?;
    let id = between(t, "(", ")")?;
    Some(id.to_string())
}

fn parse_summary(c: &str, source: &str) -> Result<Vec<ParsedFile>, String> {
    let first = c.lines().next().unwrap_or("");
    let code = between(first, "(", ")").ok_or("summary sans identifiant")?.to_string();
    let name = first.split(':').nth(1).unwrap_or("").split('(').next().unwrap_or("").trim().to_string();
    let mut t = Tournament {
        id: format!("wmx:{code}"),
        room: "Winamax".into(),
        code,
        name,
        table_size: 3,
        currency: "EUR".into(),
        source: source.into(),
        ..Default::default()
    };
    let mut duration = 0i64;
    for l in c.lines() {
        let l = l.trim();
        if let Some(v) = l.strip_prefix("Player : ") {
            t.hero = v.trim().to_string();
        } else if let Some(v) = l.strip_prefix("Buy-In : ") {
            let parts: Vec<f64> = v.split('+').map(parse_num).collect();
            let total: f64 = parts.iter().sum();
            t.buyin = total;
            if parts.len() >= 2 {
                t.prize_contrib = parts[0];
                t.rake = parts[1..].iter().sum();
            } else {
                t.prize_contrib = total;
            }
        } else if let Some(v) = l.strip_prefix("Prizepool : ") {
            t.prize_pool = parse_num(v);
        } else if let Some(v) = l.strip_prefix("Tournament started ") {
            t.start = parse_date(v).unwrap_or(0);
        } else if let Some(v) = l.strip_prefix("You played ") {
            let mut n = String::new();
            for ch in v.chars() {
                if ch.is_ascii_digit() {
                    n.push(ch);
                } else if !n.is_empty() {
                    let x: i64 = n.parse().unwrap_or(0);
                    duration += match ch {
                        'h' => x * 3600,
                        'm' => x * 60,
                        's' => x,
                        _ => 0,
                    };
                    n.clear();
                }
            }
        } else if let Some(v) = l.strip_prefix("You finished in ") {
            t.place = v.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0);
        } else if let Some(v) = l.strip_prefix("You won ") {
            t.winnings = parse_num(v);
        } else if let Some(v) = l.strip_prefix("Registered players : ") {
            t.table_size = v.trim().parse().unwrap_or(3);
        }
    }
    t.end = t.start + duration;
    if t.buyin > 0.0 {
        t.multiplier = t.prize_pool / t.buyin;
    }
    Ok(vec![ParsedFile { tournament: t, hands: vec![] }])
}

pub fn parse(c: &str, source: &str) -> Result<Vec<ParsedFile>, String> {
    if c.contains("Tournament summary") {
        return parse_summary(c, source);
    }
    let mut blocks: Vec<Vec<&str>> = Vec::new();
    for l in c.lines() {
        if l.starts_with("Winamax Poker - ") {
            blocks.push(Vec::new());
        }
        if let Some(b) = blocks.last_mut() {
            b.push(l.trim_end());
        }
    }
    let mut by_t: Vec<ParsedFile> = Vec::new();
    for b in blocks {
        let Some(h) = parse_hand(&b) else { continue };
        let (tid, hero, name, buy, hand) = h;
        match by_t.iter_mut().find(|p| p.tournament.id == tid) {
            Some(p) => p.hands.push(hand),
            None => {
                let parts: Vec<f64> = buy.split('+').map(parse_num).collect();
                let total: f64 = parts.iter().sum();
                let t = Tournament {
                    id: tid.clone(),
                    room: "Winamax".into(),
                    code: tid.trim_start_matches("wmx:").into(),
                    name,
                    hero,
                    start: hand.ts,
                    end: hand.ts,
                    buyin: total,
                    prize_contrib: *parts.first().unwrap_or(&total),
                    rake: parts.iter().skip(1).sum(),
                    table_size: 3,
                    currency: "EUR".into(),
                    starting_stack: hand.seats[hand.hero as usize].stack,
                    source: source.into(),
                    ..Default::default()
                };
                by_t.push(ParsedFile { tournament: t, hands: vec![hand] });
            }
        }
    }
    for p in &mut by_t {
        p.tournament.hands = p.hands.len() as u32;
        if let Some(last) = p.hands.last() {
            p.tournament.end = last.ts;
        }
    }
    if by_t.is_empty() {
        return Err("aucune main de tournoi Winamax".into());
    }
    Ok(by_t)
}

type HandOut = (String, String, String, String, Hand);

fn parse_hand(lines: &[&str]) -> Option<HandOut> {
    let head = lines.first()?;
    if !head.contains("Tournament") {
        return None;
    }
    let name = between(head, "Tournament \"", "\"").unwrap_or("Expresso").to_string();
    let buy = between(head, "buyIn: ", " level").unwrap_or("").to_string();
    let hid = between(head, "HandId: #", " ").unwrap_or("").to_string();
    let blinds = between(head, "(", ")").unwrap_or("");
    let bl: Vec<f64> = blinds.split('/').map(parse_num).collect();
    let (ante, sb, bb) = match bl.len() {
        3 => (bl[0], bl[1], bl[2]),
        2 => (0.0, bl[0], bl[1]),
        _ => (0.0, 0.0, 0.0),
    };
    let ts = head.rsplit(" - ").next().and_then(parse_date).unwrap_or(0);
    let table = lines.get(1)?;
    let tid = format!("wmx:{}", tid_from_table(table)?);
    let btn_seat: u8 = between(table, "Seat #", " is").and_then(|s| s.parse().ok()).unwrap_or(0);

    let mut seats: Vec<Seat> = Vec::new();
    let mut i = 2;
    while i < lines.len() && lines[i].starts_with("Seat ") && !lines[i].contains("***") {
        let l = lines[i];
        let num: u8 = between(l, "Seat ", ":").and_then(|s| s.trim().parse().ok()).unwrap_or(0);
        let rest = &l[l.find(':')? + 1..];
        let open = rest.rfind('(')?;
        let pname = rest[..open].trim().to_string();
        let stack = parse_num(rest[open + 1..].split(|c| c == ',' || c == ')').next().unwrap_or("0"));
        seats.push(Seat { name: pname, seat: num, stack, cards: None, bet: 0.0, win: 0.0 });
        i += 1;
    }
    if seats.len() < 2 {
        return None;
    }
    let button = seats.iter().position(|s| s.seat == btn_seat).unwrap_or(0) as u8;
    let mut hero_name = String::new();
    let mut actions = Vec::new();
    let mut board = Vec::new();
    let mut street = STREET_PREFLOP;
    let mut street_put = vec![0.0; seats.len()];
    let mut remaining: Vec<f64> = seats.iter().map(|s| s.stack).collect();
    let find = |seats: &Vec<Seat>, l: &str| -> Option<(usize, usize)> {
        // plus long nom correspondant en tête de ligne
        let mut best: Option<(usize, usize)> = None;
        for (k, s) in seats.iter().enumerate() {
            if l.starts_with(&s.name) && l[s.name.len()..].starts_with(' ') {
                if best.map(|b| s.name.len() > b.1).unwrap_or(true) {
                    best = Some((k, s.name.len()));
                }
            }
        }
        best
    };
    let mut in_summary = false;
    for l in &lines[i..] {
        if l.starts_with("*** SUMMARY") {
            in_summary = true;
            continue;
        }
        if in_summary {
            continue;
        }
        if let Some(r) = l.strip_prefix("Dealt to ") {
            let n = r[..r.rfind('[').unwrap_or(r.len())].trim();
            hero_name = n.to_string();
            let cs = cards_in_brackets(r);
            if let Some(k) = seats.iter().position(|s| s.name == n) {
                if cs.len() == 2 {
                    seats[k].cards = Some([cs[0], cs[1]]);
                }
            }
            continue;
        }
        if l.starts_with("*** FLOP") || l.starts_with("*** TURN") || l.starts_with("*** RIVER") {
            street = if l.starts_with("*** FLOP") {
                STREET_FLOP
            } else if l.starts_with("*** TURN") {
                STREET_TURN
            } else {
                STREET_RIVER
            };
            let cs = cards_in_brackets(l);
            board = cs;
            street_put.iter_mut().for_each(|x| *x = 0.0);
            continue;
        }
        if l.starts_with("***") {
            continue;
        }
        let Some((k, nl)) = find(&seats, l) else { continue };
        let verb = l[nl..].trim();
        let allin = verb.contains("all-in");
        let (kind, amount) = if verb.starts_with("posts small blind") {
            (ActKind::SmallBlind, parse_num(&verb[17..]))
        } else if verb.starts_with("posts big blind") {
            (ActKind::BigBlind, parse_num(&verb[15..]))
        } else if verb.starts_with("posts ante") {
            (ActKind::Ante, parse_num(&verb[10..]))
        } else if verb.starts_with("folds") {
            (ActKind::Fold, 0.0)
        } else if verb.starts_with("checks") {
            (ActKind::Check, 0.0)
        } else if verb.starts_with("calls") {
            (ActKind::Call, parse_num(verb[5..].split(" and").next().unwrap_or("")))
        } else if verb.starts_with("bets") {
            (ActKind::Bet, parse_num(verb[4..].split(" and").next().unwrap_or("")))
        } else if verb.starts_with("raises") {
            let to = verb.split(" to ").nth(1).map(|x| parse_num(x.split(" and").next().unwrap_or(""))).unwrap_or(0.0);
            (ActKind::Raise, (to - street_put[k]).max(0.0))
        } else if verb.starts_with("shows") {
            let cs = cards_in_brackets(verb);
            if cs.len() >= 2 {
                seats[k].cards = Some([cs[0], cs[1]]);
            }
            continue;
        } else if verb.starts_with("collected") {
            seats[k].win += parse_num(verb[9..].split(" from").next().unwrap_or(""));
            continue;
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
    let hero = seats.iter().position(|s| s.name == hero_name)? as u8;
    Some((tid.clone(), hero_name, name, buy, Hand { id: format!("wmx:{hid}"), tid, ts, sb, bb, ante, seats, button, hero, actions, board }))
}
