//! Équité à tapis préflop (onglet Ranges) : un joueur pousse, le joueur étudié décide de payer
//! ou non, un joueur encore à parler derrière peut sur-payer. Tapis exacts, blinds, antes et
//! side pots compris ; valeurs en jetons (bb), sans ICM.
//!
//! Pour chaque main du joueur étudié : équité contre le pousseur seul, équité nécessaire pour
//! payer (cote du pot si personne ne suit derrière), probabilité que le joueur de derrière paye,
//! et CEV de « payer » contre « coucher » en tenant compte de tout ça.

use super::classes::{hu, ncombos, N};
use super::tri::{payoff, TriTables, RANKS};
use crate::solver::ranges::{cell_name, parse};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct AllinRequest {
    /// tapis de départ (bb) dans l'ordre préflop : [BTN, SB, BB] ou [SB, BB]
    pub stacks: Vec<f64>,
    #[serde(default)]
    pub ante: f64,
    /// index du joueur qui pousse
    pub shover: usize,
    pub shove_range: String,
    /// index du joueur étudié (doit parler après le pousseur)
    pub hero: usize,
    /// index du joueur encore à parler derrière (facultatif) et sa range de sur-call
    #[serde(default)]
    pub behind: Option<usize>,
    #[serde(default)]
    pub behind_range: String,
}

#[derive(Debug, Serialize)]
pub struct HandRow {
    pub name: String,
    pub combos: f64,
    /// équité contre la range du pousseur seul
    pub equity: f64,
    /// équité nécessaire pour payer en tête-à-tête (cote du pot)
    pub need: f64,
    /// probabilité que le joueur de derrière paye aussi
    pub behind_calls: f64,
    /// part du pot principal quand on est à trois (équité à 3)
    pub equity3: Option<f64>,
    pub ev_call: f64,
    pub ev_fold: f64,
}

#[derive(Debug, Serialize)]
pub struct AllinResult {
    pub names: Vec<String>,
    pub rows: Vec<HandRow>,
    /// part des mains du joueur étudié pour lesquelles payer est rentable
    pub call_pct: f64,
    pub pot_if_called: f64,
    pub to_call: f64,
    /// équité nécessaire pour payer en tête-à-tête
    pub need: f64,
    pub shove_combos: f64,
    pub behind_combos: f64,
}

fn class_weights(s: &str) -> Result<Vec<f64>, String> {
    let r = parse(s)?;
    let cs = super::classes::combos();
    Ok((0..N).map(|h| cs[h].iter().map(|&(a, b)| r.get_weight_by_cards(a, b) as f64).sum::<f64>() / cs[h].len() as f64).collect())
}

pub fn run(req: &AllinRequest, tri: Option<&TriTables>) -> Result<AllinResult, String> {
    let n = req.stacks.len();
    if !(2..=3).contains(&n) || req.shover >= n || req.hero >= n || req.hero == req.shover {
        return Err("positions invalides".into());
    }
    let names: Vec<String> = if n == 3 { vec!["BTN".into(), "SB".into(), "BB".into()] } else { vec!["SB".into(), "BB".into()] };
    let behind = req.behind.filter(|&b| b < n && b != req.hero && b != req.shover);
    if behind.is_some() && tri.is_none() {
        return Err("tables à 3 joueurs indisponibles".into());
    }
    // mises déjà engagées : antes (mortes) et blinds
    let ante: Vec<f64> = req.stacks.iter().map(|&s| req.ante.min(s)).collect();
    let stack: Vec<f64> = (0..n).map(|i| req.stacks[i] - ante[i]).collect();
    let mut posted = vec![0f64; n];
    posted[n - 2] = 0.5f64.min(stack[n - 2]);
    posted[n - 1] = 1.0f64.min(stack[n - 1]);
    let dead_antes: f64 = ante.iter().sum();
    let (s, h) = (req.shover, req.hero);
    let shove = stack[s];
    // contributions finales selon qui paye
    let contrib = |callers: &[usize]| -> Vec<f64> {
        let mut c = posted.clone();
        c[s] = shove;
        for &p in callers {
            c[p] = stack[p].min(shove.max(callers.iter().map(|&q| stack[q].min(shove)).fold(0.0, f64::max)));
        }
        c
    };
    let sr = class_weights(&req.shove_range)?;
    let br = match behind {
        Some(_) => class_weights(&req.behind_range)?,
        None => vec![0.0; N],
    };
    let t = hu();
    // pot et cote en tête-à-tête (le joueur de derrière couche)
    let c2 = contrib(&[h]);
    // mise non suivie rendue au pousseur
    let mut c2e = c2.clone();
    if c2e[s] > c2e[h] {
        c2e[s] = c2e[h].max(posted[s]);
    }
    let pot2 = c2e.iter().sum::<f64>() + dead_antes;
    let to_call = c2e[h] - posted[h];
    let need = to_call / pot2;
    let mut rows = Vec::with_capacity(N);
    let mut call_w = 0.0;
    for hc in 0..N {
        let ev_fold = -posted[h] - ante[h];
        // masses de chance (retrait de cartes) : pousseur v, joueur de derrière w
        let (mut eq_num, mut m2) = (0.0f64, 0.0f64);
        for v in 0..N {
            let w = sr[v] * t.cnt[hc][v] as f64;
            eq_num += w * t.eq[hc][v] as f64;
            m2 += w;
        }
        if m2 <= 0.0 {
            continue;
        }
        let equity = eq_num / m2;
        let (ev_call, behind_calls, equity3) = match behind {
            None => (equity * pot2 - c2e[h] - ante[h], 0.0, None),
            Some(b) => {
                let tri = tri.unwrap();
                let c3 = contrib(&[h, b]);
                let alive = [true; 3];
                // ordre des joueurs dans les tables : (0, 1, 2) = positions ; on place h, s, b
                let pays: Vec<[f64; 3]> = RANKS.iter().map(|r| payoff(*r, &c3, &alive, dead_antes)).collect();
                let (mut tot, mut call_mass, mut ev) = (0.0f64, 0.0f64, 0.0f64);
                let (mut e3n, mut e3d) = (0.0f64, 0.0f64);
                for v in 0..N {
                    if sr[v] <= 0.0 {
                        continue;
                    }
                    for w in 0..N {
                        let mass = sr[v] * tri.c3(hc, v, w) as f64;
                        if mass <= 0.0 {
                            continue;
                        }
                        tot += mass;
                        let pc = br[w];
                        // le joueur de derrière couche : tête-à-tête, sa blind reste dans le pot
                        let hu_ev = t.eq[hc][v] as f64 * pot2 - c2e[h] - ante[h];
                        ev += mass * (1.0 - pc) * hu_ev;
                        if pc > 0.0 {
                            let mut cls = [0usize; 3];
                            cls[h] = hc;
                            cls[s] = v;
                            cls[b] = w;
                            let pr = tri.probs(cls[0], cls[1], cls[2]);
                            let g: f64 = pr.iter().zip(&pays).map(|(p, x)| *p as f64 * x[h]).sum();
                            ev += mass * pc * (g - ante[h]);
                            call_mass += mass * pc;
                            // part du pot principal (égalités partagées)
                            let share: f64 = RANKS
                                .iter()
                                .zip(pr.iter())
                                .map(|(r, p)| {
                                    let best = *r.iter().min().unwrap();
                                    if r[h] == best {
                                        *p as f64 / r.iter().filter(|&&x| x == best).count() as f64
                                    } else {
                                        0.0
                                    }
                                })
                                .sum();
                            e3n += mass * pc * share;
                            e3d += mass * pc;
                        }
                    }
                }
                (ev / tot, call_mass / tot, if e3d > 0.0 { Some(e3n / e3d) } else { None })
            }
        };
        if ev_call > ev_fold {
            call_w += ncombos(hc);
        }
        rows.push(HandRow { name: cell_name(hc), combos: ncombos(hc), equity, need, behind_calls, equity3, ev_call, ev_fold });
    }
    let combos = |w: &[f64]| (0..N).map(|x| w[x] * ncombos(x)).sum::<f64>();
    Ok(AllinResult {
        names,
        rows,
        call_pct: call_w / 1326.0,
        pot_if_called: pot2,
        to_call,
        need,
        shove_combos: combos(&sr),
        behind_combos: combos(&br),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tête-à-tête 10 bb, la SB pousse tout : la BB paye si EV(call) > EV(fold) ; AA gagne,
    /// 72o perd. Cote : 9 bb pour gagner 20 → 45 %.
    #[test]
    fn heads_up_call_odds() {
        let req = AllinRequest { stacks: vec![10.0, 10.0], ante: 0.0, shover: 0, shove_range: "22+,A2+,K2+,Q2+,J2+,T2+,92+,82+,72+,62+,52+,42+,32".into(), hero: 1, behind: None, behind_range: String::new() };
        let r = run(&req, None).unwrap();
        assert!((r.need - 0.45).abs() < 1e-9, "{}", r.need);
        let aa = r.rows.iter().find(|x| x.name == "AA").unwrap();
        assert!(aa.ev_call > aa.ev_fold);
        let s = r.rows.iter().find(|x| x.name == "72o").unwrap();
        assert!(s.ev_call < s.ev_fold);
        // EV(call) = équité × 20 − 10 (en partant de la blind postée)
        assert!((aa.ev_call - (aa.equity * 20.0 - 10.0)).abs() < 1e-9);
    }
}
