//! Arbre préflop Spin : 3 joueurs (BTN, SB, BB) ou 2 (SB/BTN, BB), tapis quelconques.
//!
//! Tailles « stratégie simplifiée » validées par Laszlo : une seule taille de relance par
//! décision + all-in. Open BTN 2 bb, open SB 3 bb (2 bb en tête-à-tête, où la SB est le bouton),
//! iso face à des limps 3 bb + 1 bb par limper, 3-bet 3× ; au-delà, all-in seulement. Une relance
//! qui engage plus de 67 % du tapis devient all-in.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PreflopConfig {
    /// tapis de départ en bb, dans l'ordre d'action préflop : [BTN, SB, BB] ou [SB, BB]
    pub stacks: Vec<f64>,
    #[serde(default)]
    pub ante: f64,
    pub open_btn: f64,
    pub open_sb: f64,
    pub open_sb_hu: f64,
    pub iso: f64,
    pub reraise: f64,
    pub allin_threshold: f64,
    /// arbre push/fold pur (fold / all-in seulement)
    #[serde(default)]
    pub push_fold: bool,
}

impl Default for PreflopConfig {
    fn default() -> Self {
        PreflopConfig { stacks: vec![25.0, 25.0, 25.0], ante: 0.0, open_btn: 2.0, open_sb: 3.0, open_sb_hu: 2.0, iso: 3.0, reraise: 3.0, allin_threshold: 0.67, push_fold: false }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Kind {
    Fold,
    Check,
    Call,
    Limp,
    Raise,
    AllIn,
}

#[derive(Debug, Clone, Serialize)]
pub struct Act {
    pub kind: Kind,
    /// total investi par le joueur après l'action (bb, blinds comprises)
    pub to: f64,
    pub label: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Term {
    /// tous les autres ont couché
    Fold,
    /// plus qu'un joueur (au plus) peut encore miser : abattage direct
    Showdown,
    /// au moins deux joueurs ont encore des jetons : on voit le flop
    Flop,
}

#[derive(Debug, Clone, Serialize)]
pub enum Node {
    Decision { player: usize, actions: Vec<Act>, children: Vec<usize> },
    Terminal { term: Term, contrib: Vec<f64>, alive: Vec<bool>, allin: Vec<bool>, pot: f64 },
}

#[derive(Debug, Clone)]
struct State {
    inv: Vec<f64>,
    folded: Vec<bool>,
    allin: Vec<bool>,
    acted: Vec<bool>,
    max_bet: f64,
    raises: u32,
    limpers: u32,
}

pub struct Tree {
    pub cfg: PreflopConfig,
    pub nodes: Vec<Node>,
    /// noms de positions dans l'ordre préflop
    pub names: Vec<&'static str>,
    pub dead: f64,
}

const EPS: f64 = 1e-9;

fn fmt(v: f64) -> String {
    let s = format!("{:.1}", v);
    s.trim_end_matches(".0").to_string()
}

impl Tree {
    pub fn build(cfg: &PreflopConfig) -> Result<Tree, String> {
        let n = cfg.stacks.len();
        if !(2..=3).contains(&n) {
            return Err("2 ou 3 joueurs".into());
        }
        if cfg.stacks.iter().any(|&s| s <= 0.0) {
            return Err("tapis invalides".into());
        }
        let names: Vec<&'static str> = if n == 3 { vec!["BTN", "SB", "BB"] } else { vec!["SB", "BB"] };
        let (sbp, bbp) = (n - 2, n - 1);
        let mut st = State { inv: vec![0.0; n], folded: vec![false; n], allin: vec![false; n], acted: vec![false; n], max_bet: 0.0, raises: 0, limpers: 0 };
        // antes (argent mort) puis blinds
        let stacks: Vec<f64> = cfg.stacks.iter().map(|&s| (s - cfg.ante).max(0.0)).collect();
        let dead: f64 = cfg.stacks.iter().map(|&s| cfg.ante.min(s)).sum();
        st.inv[sbp] = 0.5f64.min(stacks[sbp]);
        st.inv[bbp] = 1.0f64.min(stacks[bbp]);
        for i in 0..n {
            st.allin[i] = stacks[i] - st.inv[i] <= EPS;
        }
        st.max_bet = st.inv[bbp].max(st.inv[sbp]);
        let mut t = Tree { cfg: cfg.clone(), nodes: Vec::new(), names, dead };
        t.grow(&st, 0, &stacks);
        Ok(t)
    }

    fn next_player(&self, st: &State, from: usize) -> Option<usize> {
        let n = st.inv.len();
        for k in 0..n {
            let p = (from + k) % n;
            if st.folded[p] || st.allin[p] {
                continue;
            }
            if !st.acted[p] || st.inv[p] < st.max_bet - EPS {
                return Some(p);
            }
        }
        None
    }

    fn terminal(&mut self, st: &State) -> usize {
        let n = st.inv.len();
        let alive: Vec<bool> = st.folded.iter().map(|f| !f).collect();
        let mut contrib = st.inv.clone();
        // mise non suivie rendue : le plus gros ne met pas plus que le deuxième plus gros vivant
        let mut vals: Vec<f64> = (0..n).filter(|&i| alive[i]).map(|i| contrib[i]).collect();
        vals.sort_by(|a, b| b.partial_cmp(a).unwrap());
        if vals.len() >= 2 {
            let cap = vals[1].max((0..n).filter(|&i| !alive[i]).map(|i| contrib[i]).fold(0.0, f64::max));
            for i in 0..n {
                if alive[i] && contrib[i] > cap {
                    contrib[i] = cap;
                }
            }
        } else {
            // un seul vivant : il récupère ce qui dépasse la plus grosse mise adverse
            let w = (0..n).find(|&i| alive[i]).unwrap();
            let other = (0..n).filter(|&i| i != w).map(|i| contrib[i]).fold(0.0, f64::max);
            contrib[w] = contrib[w].min(other.max(0.0));
        }
        let n_alive = alive.iter().filter(|&&a| a).count();
        let with_chips = (0..n).filter(|&i| alive[i] && !st.allin[i]).count();
        let term = if n_alive == 1 {
            Term::Fold
        } else if with_chips <= 1 {
            Term::Showdown
        } else {
            Term::Flop
        };
        let pot = contrib.iter().sum::<f64>() + self.dead;
        self.nodes.push(Node::Terminal { term, contrib, alive, allin: st.allin.clone(), pot });
        self.nodes.len() - 1
    }

    fn grow(&mut self, st: &State, from: usize, stacks: &[f64]) -> usize {
        let n = st.inv.len();
        let alive = st.folded.iter().filter(|f| !**f).count();
        let p = if alive <= 1 { None } else { self.next_player(st, from) };
        let Some(p) = p else {
            return self.terminal(st);
        };
        // si tous les autres vivants sont à tapis et que p a déjà égalisé, fin de parole
        let others_can_bet = (0..n).any(|i| i != p && !st.folded[i] && !st.allin[i]);
        let rem = stacks[p] - st.inv[p];
        let to_call = (st.max_bet - st.inv[p]).max(0.0);
        let mut acts: Vec<Act> = Vec::new();
        if to_call > EPS {
            acts.push(Act { kind: Kind::Fold, to: st.inv[p], label: "Fold".into() });
        }
        let call_to = st.inv[p] + to_call.min(rem);
        if to_call <= EPS {
            acts.push(Act { kind: Kind::Check, to: st.inv[p], label: "Check".into() });
        } else if !self.cfg.push_fold || rem <= to_call + EPS || st.raises > 0 {
            let limp = st.raises == 0 && (st.max_bet - 1.0).abs() < EPS;
            let kind = if limp { Kind::Limp } else { Kind::Call };
            let label = if rem <= to_call + EPS { format!("Call {}", fmt(call_to)) } else if limp { "Limp".into() } else { "Call".into() };
            acts.push(Act { kind, to: call_to, label });
        }
        let allin_to = st.inv[p] + rem;
        // relancer n'a de sens que si un autre joueur a encore des jetons
        if rem > to_call + EPS && others_can_bet {
            if !self.cfg.push_fold {
                let size = match st.raises {
                    0 if st.limpers == 0 => Some(if self.names[p] == "BTN" {
                        self.cfg.open_btn
                    } else if n == 2 {
                        self.cfg.open_sb_hu
                    } else {
                        self.cfg.open_sb
                    }),
                    0 => Some(self.cfg.iso + st.limpers as f64),
                    1 => Some(st.max_bet * self.cfg.reraise),
                    _ => None,
                };
                if let Some(to) = size {
                    let min_raise = 2.0 * st.max_bet.max(1.0);
                    if to >= min_raise - EPS && to < allin_to - EPS && to < self.cfg.allin_threshold * stacks[p] {
                        acts.push(Act { kind: Kind::Raise, to, label: format!("Raise {}", fmt(to)) });
                    }
                }
            }
            acts.push(Act { kind: Kind::AllIn, to: allin_to, label: format!("Allin {}", fmt(allin_to)) });
        }
        let id = self.nodes.len();
        self.nodes.push(Node::Decision { player: p, actions: acts.clone(), children: vec![] });
        let mut children = Vec::with_capacity(acts.len());
        for a in &acts {
            let mut s = st.clone();
            s.acted[p] = true;
            match a.kind {
                Kind::Fold => s.folded[p] = true,
                Kind::Check => {}
                Kind::Call | Kind::Limp => {
                    s.inv[p] = a.to;
                    if a.kind == Kind::Limp && self.names[p] != "BB" {
                        s.limpers += 1;
                    }
                }
                Kind::Raise | Kind::AllIn => {
                    let raise = a.to > s.max_bet + EPS;
                    s.inv[p] = a.to;
                    if raise {
                        s.max_bet = a.to;
                        s.raises += 1;
                        for i in 0..n {
                            if i != p {
                                s.acted[i] = false;
                            }
                        }
                    }
                }
            }
            if stacks[p] - s.inv[p] <= EPS {
                s.allin[p] = true;
            }
            children.push(self.grow(&s, (p + 1) % n, stacks));
        }
        if let Node::Decision { children: c, .. } = &mut self.nodes[id] {
            *c = children;
        }
        id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn count(t: &Tree) -> (usize, usize, usize, usize) {
        let mut d = 0;
        let (mut f, mut s, mut fl) = (0, 0, 0);
        for n in &t.nodes {
            match n {
                Node::Decision { .. } => d += 1,
                Node::Terminal { term: Term::Fold, .. } => f += 1,
                Node::Terminal { term: Term::Showdown, .. } => s += 1,
                Node::Terminal { term: Term::Flop, .. } => fl += 1,
            }
        }
        (d, f, s, fl)
    }

    #[test]
    fn root_actions_match_spec() {
        let t = Tree::build(&PreflopConfig { stacks: vec![12.0, 12.0, 12.0], ..Default::default() }).unwrap();
        let Node::Decision { player, actions, .. } = &t.nodes[0] else { panic!() };
        assert_eq!(*player, 0);
        let labels: Vec<&str> = actions.iter().map(|a| a.label.as_str()).collect();
        assert_eq!(labels, ["Fold", "Limp", "Raise 2", "Allin 12"]);
        // BTN fold, SB : fold / limp / raise 3 / allin
        let Node::Decision { children, .. } = &t.nodes[0] else { panic!() };
        let Node::Decision { player, actions, .. } = &t.nodes[children[0]] else { panic!() };
        assert_eq!(*player, 1);
        let labels: Vec<&str> = actions.iter().map(|a| a.label.as_str()).collect();
        assert_eq!(labels, ["Fold", "Limp", "Raise 3", "Allin 12"]);
    }

    #[test]
    fn terminals_conserve_chips() {
        for stacks in [vec![25.0, 25.0, 25.0], vec![30.0, 8.0, 37.0], vec![6.0, 12.0]] {
            let t = Tree::build(&PreflopConfig { stacks: stacks.clone(), ante: 0.1, ..Default::default() }).unwrap();
            for n in &t.nodes {
                if let Node::Terminal { contrib, pot, .. } = n {
                    for (i, c) in contrib.iter().enumerate() {
                        assert!(*c <= stacks[i] + 1e-9, "{stacks:?} {contrib:?}");
                    }
                    assert!((pot - contrib.iter().sum::<f64>() - t.dead).abs() < 1e-9);
                }
            }
            let (d, f, s, fl) = count(&t);
            assert!(d > 0 && f > 0 && s > 0, "{stacks:?} {d} {f} {s} {fl}");
        }
    }

    #[test]
    fn push_fold_tree() {
        let t = Tree::build(&PreflopConfig { stacks: vec![10.0, 10.0], push_fold: true, ..Default::default() }).unwrap();
        let (d, f, s, fl) = count(&t);
        // SB : fold / allin ; BB : fold / call
        assert_eq!((d, f, s, fl), (2, 2, 1, 0));
    }
}
