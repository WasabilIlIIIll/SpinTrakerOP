//! Bases de référence du leak finder : statistiques agrégées d'un groupe de joueurs (population,
//! regs, fish…), exportées d'une base Spin Tracker OP et importées par d'autres joueurs pour s'y
//! comparer. Le fichier ne contient que des comptes (aucun pseudo, aucune main) :
//!   - `nodes` : décisions préflop par situation et tranche de tapis ;
//!   - `postflop` : stats postflop (c-bet, fold vs c-bet…) en pots HU et à 3 ;
//!   - `trees` : arbres de décision postflop par duel et type de pot.
//! Les bases importées sont rangées dans `references/` à côté de la base de données.

use super::leaks::{leak_report_vs, Post};
use super::ptree::{duel_key, postflop_tree, to_tnode, RefSel, TNode, DUELS};
use super::Filter;
use crate::store::Store;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const FORMAT: &str = "spin-tracker-op/reference";

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct RefNode {
    /// [tapis, relance, call/check, fold]
    pub counts: [u32; 4],
    #[serde(default)]
    pub buckets: BTreeMap<String, [u32; 4]>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct RefFile {
    pub format: String,
    pub version: u32,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub created: i64,
    #[serde(default)]
    pub hands: u32,
    #[serde(default)]
    pub nodes: BTreeMap<String, RefNode>,
    #[serde(default)]
    pub postflop: Vec<Post>,
    #[serde(default)]
    pub trees: BTreeMap<String, TNode>,
}

#[derive(Serialize)]
pub struct RefInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created: i64,
    pub hands: u32,
    pub situations: usize,
    pub trees: usize,
}

pub fn dir(data: &Path) -> PathBuf {
    data.join("references")
}

/// Identifiant de fichier sûr (lettres, chiffres, tirets).
fn slug(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|x| !x.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if s.is_empty() {
        "reference".into()
    } else {
        s.chars().take(60).collect()
    }
}

/// Construit une base de référence à partir des mains de `who` ("population", "tag:reg",
/// "player:x", "hero"…) sur la sélection.
pub fn build(s: &Store, who: &str, filter: &Filter, name: &str, description: &str) -> RefFile {
    let rep = leak_report_vs(s, if who == "hero" { "" } else { who }, filter, "none", false, "", None);
    let mut nodes = BTreeMap::new();
    for p in &rep.panels {
        for n in &p.nodes {
            nodes.insert(n.key.clone(), RefNode { counts: n.counts, buckets: n.buckets.iter().map(|b| (b.label.clone(), b.counts)).collect() });
        }
    }
    let mut trees = BTreeMap::new();
    let player = if who == "hero" { "" } else { who };
    for (table, me, opp) in DUELS {
        let first = postflop_tree(s, player, filter, "", table, me, opp, "", &[], &RefSel::None);
        for p in &first.pots {
            if p.n < 5 {
                continue;
            }
            let t = postflop_tree(s, player, filter, "", table, me, opp, &p.key, &[], &RefSel::None);
            trees.insert(duel_key(table, me, opp, &p.key), to_tnode(&t.root, &[]));
        }
    }
    RefFile {
        format: FORMAT.into(),
        version: 1,
        name: name.into(),
        description: description.into(),
        created: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0),
        hands: rep.hands,
        nodes,
        postflop: rep.postflop.player,
        trees,
    }
}

pub fn parse(json: &str) -> Result<RefFile, String> {
    let f: RefFile = serde_json::from_str(json).map_err(|e| format!("fichier illisible : {e}"))?;
    if f.format != FORMAT {
        return Err("ce fichier n'est pas une base de référence Spin Tracker OP".into());
    }
    if f.version > 1 {
        return Err("base de référence d'une version plus récente de Spin Tracker OP : mets l'application à jour".into());
    }
    Ok(f)
}

pub fn load(data: &Path, id: &str) -> Option<RefFile> {
    if id.contains(['/', '\\', '.']) {
        return None;
    }
    parse(&std::fs::read_to_string(dir(data).join(format!("{id}.json"))).ok()?).ok()
}

pub fn list(data: &Path) -> Vec<RefInfo> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir(data)) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let Some(id) = p.file_stem().and_then(|x| x.to_str()).map(String::from) else { continue };
            if let Some(f) = std::fs::read_to_string(&p).ok().and_then(|j| parse(&j).ok()) {
                out.push(RefInfo { id, name: f.name, description: f.description, created: f.created, hands: f.hands, situations: f.nodes.len(), trees: f.trees.len() });
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Importe un fichier : validé puis copié dans `references/` ; renvoie son identifiant.
pub fn import(data: &Path, src: &Path) -> Result<String, String> {
    let json = std::fs::read_to_string(src).map_err(|e| e.to_string())?;
    let f = parse(&json)?;
    let d = dir(data);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let base = slug(&f.name);
    let mut id = base.clone();
    let mut k = 2;
    while d.join(format!("{id}.json")).exists() {
        id = format!("{base}-{k}");
        k += 1;
    }
    std::fs::write(d.join(format!("{id}.json")), json).map_err(|e| e.to_string())?;
    Ok(id)
}

pub fn delete(data: &Path, id: &str) -> Result<(), String> {
    if id.contains(['/', '\\', '.']) {
        return Err("identifiant invalide".into());
    }
    std::fs::remove_file(dir(data).join(format!("{id}.json"))).map_err(|e| e.to_string())
}
