//! Détection du format et lecture des fichiers (fichiers, dossiers, archives zip).

pub mod betclic;
pub mod common;
pub mod ipoker;
pub mod stars;
pub mod winamax;

use crate::model::{Hand, Tournament};
use std::io::Read;
use std::path::{Path, PathBuf};

pub struct ParsedFile {
    pub tournament: Tournament,
    pub hands: Vec<Hand>,
}

/// Contenu brut d'une source à parser.
pub struct RawSource {
    pub name: String,
    pub content: String,
}

/// "1 010", "0,35€", "€4.65", "N/A" -> nombre
pub fn parse_num(s: &str) -> f64 {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '0'..='9' | '-' => out.push(ch),
            ',' | '.' => out.push('.'),
            _ => {}
        }
    }
    // "1.234.56" improbable ; on garde le dernier séparateur comme décimal
    if out.matches('.').count() > 1 {
        let last = out.rfind('.').unwrap();
        let (a, b) = out.split_at(last);
        out = format!("{}{}", a.replace('.', ""), b);
    }
    out.parse().unwrap_or(0.0)
}

/// Jours depuis 1970-01-01 (algorithme de Howard Hinnant).
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// Heure UTC -> heure de Paris (CET/CEST, changement d'heure européen à 01:00 UTC le
/// dernier dimanche de mars et d'octobre). Les horodatages de l'application sont en heure
/// locale naïve, comme les historiques PMU.
pub fn utc_to_paris(ts: i64) -> i64 {
    let y = 1970 + ts.div_euclid(31_556_952);
    let last_sunday = |m: i64| {
        let d = days_from_civil(y, m, 31);
        d - (d + 4).rem_euclid(7)
    };
    let (a, b) = (last_sunday(3) * 86400 + 3600, last_sunday(10) * 86400 + 3600);
    ts + if ts >= a && ts < b { 7200 } else { 3600 }
}

/// Comme `parse_date`, en convertissant en heure de Paris les dates marquées UTC/GMT.
pub fn parse_date_tz(s: &str) -> Option<i64> {
    let ts = parse_date(s)?;
    let u = s.to_ascii_uppercase();
    Some(if u.contains("UTC") || u.contains("GMT") { utc_to_paris(ts) } else { ts })
}

/// "2026-09-19 22:26:13" ou "2026/09/19 22:26:13" -> secondes (heure locale naïve)
pub fn parse_date(s: &str) -> Option<i64> {
    let s = s.trim();
    let nums: Vec<i64> = s.split(|c: char| !c.is_ascii_digit()).filter(|x| !x.is_empty()).take(6).filter_map(|x| x.parse().ok()).collect();
    if nums.len() < 3 {
        return None;
    }
    let (y, mo, d) = (nums[0], nums[1], nums[2]);
    let h = *nums.get(3).unwrap_or(&0);
    let mi = *nums.get(4).unwrap_or(&0);
    let se = *nums.get(5).unwrap_or(&0);
    Some(days_from_civil(y, mo, d) * 86400 + h * 3600 + mi * 60 + se)
}

pub fn parse_source(src: &RawSource) -> Result<Vec<ParsedFile>, String> {
    let c = src.content.trim_start_matches('\u{feff}');
    if ipoker::looks_like(c) {
        return ipoker::parse(c, &src.name).map(|p| vec![p]);
    }
    if winamax::looks_like(c) {
        return winamax::parse(c, &src.name);
    }
    if betclic::looks_like(c) {
        return betclic::parse(c, &src.name);
    }
    if stars::looks_like(c) {
        return stars::parse(c, &src.name);
    }
    // PokerStars écrit l'historique dans la langue choisie : seuls les fichiers en anglais sont lus
    // (comme PokerTracker, Holdem Manager, DriveHUD)
    if c.trim_start().starts_with("PokerStars Game #") {
        return Err("ancien format PokerStars (avant 2009), antérieur aux Spin & Go : ignoré".into());
    }
    if c.trim_start().starts_with("PokerStars") {
        return Err("historique PokerStars dans une autre langue que l'anglais : dans PokerStars, Réglages › Historique de jeu › Historique des mains, choisis la langue « English » (le logiciel peut rester en français), puis réimporte".into());
    }
    Err("format non reconnu".into())
}

fn is_candidate(p: &Path) -> bool {
    matches!(p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(), Some("xml") | Some("txt"))
}

fn read_text(bytes: Vec<u8>) -> String {
    match String::from_utf8(bytes) {
        Ok(s) => s,
        Err(e) => {
            // repli latin-1
            e.into_bytes().iter().map(|&b| b as char).collect()
        }
    }
}

/// Liste les fichiers candidats sous un ensemble de chemins (fichiers, dossiers, zip).
pub fn collect_paths(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for p in paths {
        if p.is_dir() {
            for e in walkdir::WalkDir::new(p).into_iter().filter_map(|e| e.ok()) {
                let ep = e.path();
                if ep.is_file() && (is_candidate(ep) || is_zip(ep)) {
                    out.push(ep.to_path_buf());
                }
            }
        } else if p.is_file() {
            out.push(p.clone());
        }
    }
    out.sort();
    out.dedup();
    out
}

fn is_zip(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("zip")).unwrap_or(false)
}

/// Lit un fichier (ou toutes les entrées d'un zip) en sources brutes.
pub fn read_path(p: &Path) -> Vec<RawSource> {
    let name = p.to_string_lossy().to_string();
    if is_zip(p) {
        let mut out = Vec::new();
        if let Ok(f) = std::fs::File::open(p) {
            if let Ok(mut z) = zip::ZipArchive::new(f) {
                for i in 0..z.len() {
                    if let Ok(mut entry) = z.by_index(i) {
                        let en = entry.name().to_string();
                        if !is_candidate(Path::new(&en)) {
                            continue;
                        }
                        let mut buf = Vec::new();
                        if entry.read_to_end(&mut buf).is_ok() {
                            out.push(RawSource { name: format!("{name}!{en}"), content: read_text(buf) });
                        }
                    }
                }
            }
        }
        return out;
    }
    match std::fs::read(p) {
        Ok(b) => vec![RawSource { name, content: read_text(b) }],
        Err(_) => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nums() {
        assert_eq!(parse_num("1 010"), 1010.0);
        assert_eq!(parse_num("0,35€"), 0.35);
        assert_eq!(parse_num("N/A"), 0.0);
        assert_eq!(parse_date("1970-01-02 00:00:01"), Some(86401));
    }
}

/// Dossier d'historiques d'une room trouvé sur ce PC.
#[derive(serde::Serialize)]
pub struct HhFolder {
    pub room: String,
    pub path: String,
    pub files: usize,
}

/// Dossiers d'historiques par défaut des rooms prises en charge (Windows).
/// Winamax : `%APPDATA%\winamax\documents\accounts\<pseudo>\history` (nouveau logiciel) ou
/// `Documents\Winamax Poker\accounts\<pseudo>\history` ; PokerStars : `%LOCALAPPDATA%\PokerStars(.FR)\
/// HandHistory|TournSummary\<pseudo>` (historiques en anglais) ; Unibet.fr et PMU (logiciel iPoker) :
/// `<Program Files>\Unibet.fr|PMU Poker\data\<pseudo>\History`.
pub fn known_folders() -> Vec<HhFolder> {
    let env = |k: &str| std::env::var(k).map(PathBuf::from).ok();
    let mut cands: Vec<(&str, PathBuf, &str)> = Vec::new();
    if let Some(a) = env("APPDATA") {
        cands.push(("Winamax", a.join("winamax").join("documents").join("accounts"), "history"));
    }
    if let Some(u) = env("USERPROFILE") {
        cands.push(("Winamax", u.join("Documents").join("Winamax Poker").join("accounts"), "history"));
    }
    if let Some(l) = env("LOCALAPPDATA") {
        for site in ["PokerStars.FR", "PokerStars"] {
            cands.push(("PokerStars", l.join(site).join("HandHistory"), ""));
            cands.push(("PokerStars", l.join(site).join("TournSummary"), ""));
        }
    }
    for pf in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"] {
        if let Some(p) = env(pf) {
            cands.push(("Unibet", p.join("Unibet.fr").join("data"), "History"));
            cands.push(("PMU", p.join("PMU Poker").join("data"), "History"));
        }
    }
    let mut out: Vec<HhFolder> = Vec::new();
    for (room, base, sub) in cands {
        let Ok(rd) = std::fs::read_dir(&base) else { continue };
        for e in rd.flatten() {
            let dir = if sub.is_empty() { e.path() } else { e.path().join(sub) };
            if !dir.is_dir() {
                continue;
            }
            let files = walkdir::WalkDir::new(&dir).into_iter().filter_map(|x| x.ok()).filter(|x| x.path().is_file() && is_candidate(x.path())).count();
            let path = dir.to_string_lossy().to_string();
            if files > 0 && !out.iter().any(|f| f.path == path) {
                out.push(HhFolder { room: room.into(), path, files });
            }
        }
    }
    out
}
