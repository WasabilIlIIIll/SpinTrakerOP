//! Parser du format XML iPoker (PMU, Betclic/Unibet réseau iPoker, …).
//!
//! Sémantique des actions vérifiée sur des historiques réels :
//! - `type="23"` (raise) : `sum` = montant total de la street ("raise to")
//! - tous les autres types : `sum` = jetons ajoutés au pot
//! - l'attribut `bet` d'un joueur inclut les mises non suivies, `win` ne les inclut pas.

use super::{parse_date, parse_num, ParsedFile};
use crate::model::*;

fn parse_card(s: &str) -> Option<Card> {
    let s = s.trim();
    if s.len() < 2 {
        return None;
    }
    let (suit, rank) = s.split_at(1);
    let suit = match suit {
        "C" | "c" => 0,
        "D" | "d" => 1,
        "H" | "h" => 2,
        "S" | "s" => 3,
        _ => return None,
    };
    let rank = match rank.to_ascii_uppercase().as_str() {
        "2" => 0,
        "3" => 1,
        "4" => 2,
        "5" => 3,
        "6" => 4,
        "7" => 5,
        "8" => 6,
        "9" => 7,
        "10" | "T" => 8,
        "J" => 9,
        "Q" => 10,
        "K" => 11,
        "A" => 12,
        _ => return None,
    };
    Some(rank * 4 + suit)
}

fn parse_cards(s: &str) -> Vec<Card> {
    s.split_whitespace().filter_map(parse_card).collect()
}

fn child_text<'a>(node: roxmltree::Node<'a, 'a>, name: &str) -> &'a str {
    node.children().find(|c| c.has_tag_name(name)).and_then(|c| c.text()).unwrap_or("").trim()
}

pub fn looks_like(content: &str) -> bool {
    content.contains("<session") && content.contains("<game ") || content.contains("<session sessioncode")
}

pub fn parse(content: &str, source: &str) -> Result<ParsedFile, String> {
    let doc = roxmltree::Document::parse(content).map_err(|e| format!("XML invalide: {e}"))?;
    let root = doc.root_element();
    let general = root.children().find(|c| c.has_tag_name("general")).ok_or("balise <general> manquante")?;

    let hero = child_text(general, "nickname").to_string();
    let tcode = child_text(general, "tournamentcode").to_string();
    if tcode.is_empty() {
        return Err("pas un tournoi (cash game ignoré)".into());
    }
    let name = {
        let n = child_text(general, "tournamentname");
        if n.is_empty() {
            child_text(general, "tablename").to_string()
        } else {
            n.to_string()
        }
    };
    let table_size = child_text(general, "tablesize").parse::<u8>().unwrap_or(3);
    let currency = child_text(general, "tournamentcurrency").to_string();

    // "0€ + 0,35€ + 4,65€"  -> [bounty?, rake, prize]
    let parts: Vec<f64> = child_text(general, "buyin").split('+').map(parse_num).collect();
    let total = {
        let t = parse_num(child_text(general, "totalbuyin"));
        if t > 0.0 {
            t
        } else {
            parts.iter().sum()
        }
    };
    let nonzero: Vec<f64> = parts.iter().copied().filter(|v| *v > 0.0).collect();
    let (rake, prize_contrib) = match nonzero.len() {
        0 => (0.0, total),
        1 => (0.0, nonzero[0]),
        _ => {
            let mx = nonzero.iter().cloned().fold(f64::MIN, f64::max);
            let mn = nonzero.iter().cloned().fold(f64::MAX, f64::min);
            (mn, mx)
        }
    };
    let bounty = (total - rake - prize_contrib).max(0.0);

    let prize_pool = parse_num(child_text(general, "rewarddrawn"));
    let place = child_text(general, "place").parse::<u8>().unwrap_or(0);
    let winnings = parse_num(child_text(general, "win"));
    let start = parse_date(child_text(general, "startdate")).unwrap_or(0);
    let duration = {
        let d = child_text(general, "duration");
        let p: Vec<i64> = d.split(':').filter_map(|x| x.parse().ok()).collect();
        if p.len() == 3 {
            p[0] * 3600 + p[1] * 60 + p[2]
        } else {
            0
        }
    };

    // le XML iPoker est identique d'un skin à l'autre : la room se déduit du contenu ou du
    // chemin (comme dans fpdb). Laissée vide si rien ne l'indique : l'import la déduit alors
    // du pseudo du héros (déjà vu sur une room), PMU par défaut.
    let mut lower = source.to_lowercase();
    if content.get(..4096.min(content.len())).unwrap_or(content).to_lowercase().contains("betclic") {
        lower.push_str(" betclic");
    }
    let room = ["betclic", "unibet", "pmu", "fdj", "barriere", "partouche", "netbet", "bwin", "redbet"]
        .iter()
        .find(|k| lower.contains(*k))
        .map(|k| match *k {
            "betclic" => "Betclic",
            "unibet" => "Unibet",
            "fdj" => "FDJ",
            "barriere" => "Barrière",
            "partouche" => "Partouche",
            "netbet" => "NetBet",
            "bwin" => "Bwin",
            "redbet" => "Redbet",
            _ => "PMU",
        })
        .unwrap_or("")
        .to_string();
    let tid = format!("ipk:{tcode}");
    let mut hands = Vec::new();
    let mut starting_stack = 0.0;

    for game in root.children().filter(|c| c.has_tag_name("game")) {
        let gamecode = game.attribute("gamecode").unwrap_or("").to_string();
        let ggen = match game.children().find(|c| c.has_tag_name("general")) {
            Some(g) => g,
            None => continue,
        };
        let ts = parse_date(child_text(ggen, "startdate")).unwrap_or(start);
        let sb = parse_num(child_text(ggen, "smallblind"));
        let bb = parse_num(child_text(ggen, "bigblind"));
        let ante = parse_num(child_text(ggen, "ante"));
        let players_node = match ggen.children().find(|c| c.has_tag_name("players")) {
            Some(p) => p,
            None => continue,
        };
        let mut seats: Vec<Seat> = Vec::new();
        let mut button = 0u8;
        let mut hero_idx: Option<u8> = None;
        let mut pl: Vec<(u8, Seat, bool, bool)> = Vec::new();
        for p in players_node.children().filter(|c| c.has_tag_name("player")) {
            let name = p.attribute("name").unwrap_or("").to_string();
            let seat = p.attribute("seat").and_then(|s| s.parse().ok()).unwrap_or(0);
            let is_dealer = p.attribute("dealer") == Some("1");
            let is_hero = !p.attribute("reg_code").unwrap_or("").is_empty() || name == hero;
            pl.push((
                seat,
                Seat {
                    name,
                    seat,
                    stack: parse_num(p.attribute("chips").unwrap_or("0")),
                    cards: None,
                    bet: parse_num(p.attribute("bet").unwrap_or("0")),
                    win: parse_num(p.attribute("win").unwrap_or("0")),
                },
                is_dealer,
                is_hero,
            ));
        }
        pl.sort_by_key(|x| x.0);
        for (i, (_, s, d, h)) in pl.into_iter().enumerate() {
            if d {
                button = i as u8;
            }
            if h && hero_idx.is_none() {
                hero_idx = Some(i as u8);
            }
            seats.push(s);
        }
        let hero_idx = match hero_idx {
            Some(h) => h,
            None => continue,
        };
        if hands.is_empty() {
            starting_stack = seats[hero_idx as usize].stack;
        }
        let idx_of = |n: &str| seats.iter().position(|s| s.name == n).map(|i| i as u8);

        let mut actions = Vec::new();
        let mut board: Vec<Card> = Vec::new();
        let mut remaining: Vec<f64> = seats.iter().map(|s| s.stack).collect();
        let mut street_put: Vec<f64> = vec![0.0; seats.len()];
        let mut last_street = 0u8;
        let mut hole: Vec<Option<[Card; 2]>> = vec![None; seats.len()];

        let mut rounds: Vec<_> = game.children().filter(|c| c.has_tag_name("round")).collect();
        rounds.sort_by_key(|r| r.attribute("no").and_then(|n| n.parse::<u32>().ok()).unwrap_or(0));
        for r in rounds {
            let no: u32 = r.attribute("no").and_then(|n| n.parse().ok()).unwrap_or(0);
            let street = match no {
                0 | 1 => STREET_PREFLOP,
                2 => STREET_FLOP,
                3 => STREET_TURN,
                _ => STREET_RIVER,
            };
            if street != last_street {
                street_put.iter_mut().for_each(|x| *x = 0.0);
                last_street = street;
            }
            let mut acts: Vec<_> = r.children().filter(|c| c.has_tag_name("action")).collect();
            acts.sort_by_key(|a| a.attribute("no").and_then(|n| n.parse::<u32>().ok()).unwrap_or(0));
            for c in r.children().filter(|c| c.has_tag_name("cards")) {
                let t = c.attribute("type").unwrap_or("");
                let cards = parse_cards(c.text().unwrap_or(""));
                match t {
                    "Pocket" => {
                        if let Some(pi) = c.attribute("player").and_then(idx_of) {
                            if cards.len() == 2 {
                                hole[pi as usize] = Some([cards[0], cards[1]]);
                            }
                        }
                    }
                    "Flop" | "Turn" | "River" => board.extend(cards),
                    _ => {}
                }
            }
            for a in acts {
                let pi = match a.attribute("player").and_then(idx_of) {
                    Some(p) => p,
                    None => continue,
                };
                let sum = parse_num(a.attribute("sum").unwrap_or("0"));
                let t: u32 = a.attribute("type").and_then(|t| t.parse().ok()).unwrap_or(0);
                let u = pi as usize;
                let (kind, amount) = match t {
                    0 => (ActKind::Fold, 0.0),
                    1 => (ActKind::SmallBlind, sum),
                    2 => (ActKind::BigBlind, sum),
                    3 => (ActKind::Call, sum),
                    4 => (ActKind::Check, 0.0),
                    5 => (ActKind::Bet, sum),
                    6 | 23 => (ActKind::Raise, (sum - street_put[u]).max(0.0)),
                    7 => {
                        // tapis : relance si dépasse la plus grosse mise de la street
                        let maxput = street_put.iter().cloned().fold(0.0, f64::max);
                        if street_put[u] + sum > maxput + 1e-9 {
                            if maxput > 0.0 {
                                (ActKind::Raise, sum)
                            } else {
                                (ActKind::Bet, sum)
                            }
                        } else {
                            (ActKind::Call, sum)
                        }
                    }
                    15 => (ActKind::Ante, sum),
                    _ => continue,
                };
                let amount = amount.min(remaining[u]);
                remaining[u] -= amount;
                street_put[u] += if kind == ActKind::Ante { 0.0 } else { amount };
                actions.push(Action { street, p: pi, kind, amount, allin: remaining[u] <= 1e-9 && amount > 0.0 });
            }
        }
        for (i, h) in hole.into_iter().enumerate() {
            seats[i].cards = h;
        }
        hands.push(Hand { id: format!("ipk:{gamecode}"), tid: tid.clone(), ts, sb, bb, ante, seats, button, hero: hero_idx, actions, board });
    }

    let tournament = Tournament {
        id: tid,
        room,
        code: tcode,
        name,
        hero,
        start,
        end: start + duration,
        buyin: total,
        rake,
        prize_contrib,
        bounty,
        prize_pool,
        multiplier: if total > 0.0 { prize_pool / total } else { 0.0 },
        place,
        winnings,
        table_size,
        currency,
        starting_stack,
        hands: hands.len() as u32,
        source: source.to_string(),
    };
    Ok(ParsedFile { tournament, hands })
}
