//! Outils partagés par les parsers texte : cartes, montants, et reconstitution des gains
//! quand un format ne les indique pas de façon fiable.

use crate::eval::eval;
use crate::model::*;

/// "Ah", "AH", "10h", "Th", "A♥" -> carte
pub fn card(tok: &str) -> Option<Card> {
    let t = tok.trim().trim_matches(|c: char| c == ',' || c == '[' || c == ']');
    if t.len() < 2 {
        return None;
    }
    let mut chars: Vec<char> = t.chars().collect();
    let suit_ch = chars.pop()?;
    let rank_s: String = chars.into_iter().collect();
    let rank = match rank_s.to_ascii_uppercase().as_str() {
        "2" => 0,
        "3" => 1,
        "4" => 2,
        "5" => 3,
        "6" => 4,
        "7" => 5,
        "8" => 6,
        "9" => 7,
        "T" | "10" => 8,
        "J" => 9,
        "Q" => 10,
        "K" => 11,
        "A" => 12,
        _ => return None,
    };
    let suit = match suit_ch {
        'c' | 'C' | '♣' => 0,
        'd' | 'D' | '♦' => 1,
        'h' | 'H' | '♥' => 2,
        's' | 'S' | '♠' => 3,
        _ => return None,
    };
    Some(rank * 4 + suit)
}

/// Toutes les cartes présentes entre crochets dans une ligne.
pub fn cards_in_brackets(s: &str) -> Vec<Card> {
    let mut out = Vec::new();
    let mut rest = s;
    while let Some(a) = rest.find('[') {
        let Some(b) = rest[a..].find(']') else { break };
        out.extend(rest[a + 1..a + b].split(|c: char| c.is_whitespace() || c == ',').filter_map(card));
        rest = &rest[a + b + 1..];
    }
    out
}

/// Premier nombre d'une chaîne ("to 40 and is all-in" -> 40), séparateurs de milliers tolérés.
pub fn first_num(s: &str) -> Option<f64> {
    let mut buf = String::new();
    let mut started = false;
    for ch in s.chars() {
        if ch.is_ascii_digit() || (started && (ch == '.' || ch == ',')) {
            buf.push(ch);
            started = true;
        } else if started && (ch == ' ' || ch == '\u{a0}' || ch == '\u{202f}') {
            // "1 000" : espace de milliers suivi d'un chiffre
            continue;
        } else if started {
            break;
        }
    }
    if buf.is_empty() {
        return None;
    }
    Some(super::parse_num(&buf))
}

/// Contributions de chaque joueur dans une main.
fn contributions(h: &Hand) -> Vec<f64> {
    let mut c = vec![0.0; h.seats.len()];
    for a in &h.actions {
        c[a.p as usize] += a.amount;
    }
    c
}

/// Attribue les pots d'une main à partir des actions et des cartes, quand le format
/// n'indique pas les gains : joueur seul restant, ou abattage avec toutes les cartes connues.
/// Renvoie false si la main ne peut pas être résolue.
pub fn resolve_wins_by_cards(h: &mut Hand) -> bool {
    let n = h.seats.len();
    let contrib = contributions(h);
    let mut folded = vec![false; n];
    for a in &h.actions {
        if a.kind == ActKind::Fold {
            folded[a.p as usize] = true;
        }
    }
    // mise non suivie rendue au plus gros contributeur
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|a, b| contrib[*b].partial_cmp(&contrib[*a]).unwrap());
    let mut eff = contrib.clone();
    if n >= 2 {
        eff[order[0]] -= contrib[order[0]] - contrib[order[1]];
    }
    let live: Vec<usize> = (0..n).filter(|&i| !folded[i]).collect();
    for s in h.seats.iter_mut() {
        s.win = 0.0;
    }
    if live.len() == 1 {
        h.seats[live[0]].win = eff.iter().sum();
        return true;
    }
    if h.board.len() < 5 || live.iter().any(|&i| h.seats[i].cards.is_none()) {
        return false;
    }
    let ranks: Vec<u32> = live
        .iter()
        .map(|&i| {
            let c = h.seats[i].cards.unwrap();
            let mut all = vec![c[0], c[1]];
            all.extend_from_slice(&h.board[..5]);
            eval(&all)
        })
        .collect();
    let mut levels: Vec<f64> = live.iter().map(|&i| eff[i]).collect();
    levels.sort_by(|a, b| a.partial_cmp(b).unwrap());
    levels.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
    let mut prev = 0.0;
    for lv in levels {
        let amount: f64 = eff.iter().map(|&c| c.min(lv) - c.min(prev)).sum();
        let elig: Vec<usize> = (0..live.len()).filter(|&k| eff[live[k]] >= lv - 1e-9).collect();
        if let Some(best) = elig.iter().map(|&k| ranks[k]).max() {
            let winners: Vec<usize> = elig.iter().copied().filter(|&k| ranks[k] == best).collect();
            for &k in &winners {
                h.seats[live[k]].win += amount / winners.len() as f64;
            }
        }
        prev = lv;
    }
    true
}

/// Reconstitue les gains à partir de l'évolution des tapis entre deux mains consécutives
/// d'un même tournoi (méthode exacte quand la main suivante existe).
/// `hands` doit être trié chronologiquement. La dernière main est résolue par les cartes.
pub fn resolve_wins_by_stacks(hands: &mut [Hand]) {
    for k in 0..hands.len() {
        let next: Option<Vec<(String, f64)>> = hands.get(k + 1).map(|h2| h2.seats.iter().map(|s| (s.name.clone(), s.stack)).collect());
        let h = &mut hands[k];
        let contrib = contributions(h);
        match next {
            Some(nx) => {
                for (i, s) in h.seats.iter_mut().enumerate() {
                    let after = nx.iter().find(|(n, _)| *n == s.name).map(|(_, st)| *st).unwrap_or(0.0);
                    // tapis après = tapis avant − mis au pot + gagné
                    s.win = (after - s.stack + contrib[i]).max(0.0);
                }
            }
            None => {
                resolve_wins_by_cards(h);
            }
        }
    }
}
