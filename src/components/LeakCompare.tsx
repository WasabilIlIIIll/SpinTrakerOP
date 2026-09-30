// Comparaison préflop côte à côte : à gauche un joueur (moi par défaut), à droite un autre
// (un tag comme les Regs, un joueur, un groupe…), chacun avec son filtre « contre ». Pour chaque
// situation réelle (ex. SB vs BTN Open), les fréquences des deux et l'écart ; un clic montre les
// deux grilles de mains observées (cartes connues : toutes pour moi, abattages pour les autres).
import { useMemo, useState } from "react";
import { api, type Filter, type NodeOut } from "../lib/api";
import { useQuery } from "../lib/state";
import { cls, num } from "../lib/format";
import { Empty, Help, Loading } from "./ui";
import { ACTIONS, HandMatrix } from "./LeakPanels";
import { PaneRight } from "./Spatial";

const COLORS = ["var(--pos)", "#3b82f6", "var(--gold)", "rgba(255,255,255,0.28)"];
const pct = (c: number[], k: number) => {
  const t = c.reduce((a, b) => a + b, 0);
  return t ? (c[k] / t) * 100 : 0;
};

function Bar({ node }: { node?: NodeOut }) {
  if (!node || !node.total) return <div className="cmp-bar empty">–</div>;
  const acts = ACTIONS[node.kind];
  return (
    <div className="cmp-bar">
      {node.counts.map((c, k) =>
        c > 0 && acts[k] ? (
          <i key={k} style={{ width: `${pct(node.counts, k)}%`, background: COLORS[k] }} title={`${acts[k]} ${num(pct(node.counts, k), 0)} %`}>
            {pct(node.counts, k) >= 14 ? `${num(pct(node.counts, k), 0)}` : ""}
          </i>
        ) : null,
      )}
    </div>
  );
}

export function LeakCompare({
  filter,
  left,
  leftVs,
  right,
  rightVs,
  leftLabel,
  rightLabel,
  scenario,
  minHands,
}: {
  filter: Filter;
  left: string;
  leftVs: string;
  right: string;
  rightVs: string;
  leftLabel: string;
  rightLabel: string;
  scenario: string | null;
  minHands: number;
}) {
  const { data: a, loading: la } = useQuery(["leakcmp", left, leftVs, filter], () => api.leakReport(left === "hero" ? "" : left, filter, "none", leftVs));
  const { data: b, loading: lb } = useQuery(["leakcmp", right, rightVs, filter], () => api.leakReport(right === "hero" ? "" : right, filter, "none", rightVs));
  const [sel, setSel] = useState<string | null>(null);
  const rows = useMemo(() => {
    if (!a || !b) return [];
    const byKey = (r: typeof a) => new Map(r.panels.flatMap((p) => p.nodes.map((n) => [n.key, n] as [string, NodeOut])));
    const A = byKey(a);
    const B = byKey(b);
    const keys = [...new Set([...A.keys(), ...B.keys()])].filter((k) => !scenario || k.startsWith(`${scenario}|`));
    return keys
      .map((k) => {
        const x = A.get(k);
        const y = B.get(k);
        const kind = (x ?? y)!.kind;
        // plus gros écart entre les deux, sur les actions possibles
        let gap = 0;
        let gapK = -1;
        if (x?.total && y?.total) {
          ACTIONS[kind].forEach((l, i) => {
            if (!l) return;
            const d = pct(x.counts, i) - pct(y.counts, i);
            if (Math.abs(d) > Math.abs(gap)) {
              gap = d;
              gapK = i;
            }
          });
        }
        return { key: k, scen: k.split("|")[0], label: (x ?? y)!.label, kind, x, y, gap, gapK, n: (x?.total ?? 0) + (y?.total ?? 0) };
      })
      .filter((r) => (r.x?.total ?? 0) >= minHands || (r.y?.total ?? 0) >= minHands)
      .sort((p, q) => (p.scen === q.scen ? q.n - p.n : p.scen.localeCompare(q.scen)));
  }, [a, b, scenario, minHands]);
  const cur = rows.find((r) => r.key === sel) ?? null;
  if ((la && !a) || (lb && !b)) return <Loading h={360} />;
  if (!rows.length) return <Empty title="Rien à comparer" sub="Aucune situation commune avec assez de mains : élargis les filtres ou baisse le minimum de mains." icon="search" />;
  let lastScen = "";
  return (
    <div className="cmp">
      <PaneRight>
        <div className="row gap8">
          <div className="pane-title">Mains jouées</div>
          <Help text="Grilles des mains réellement jouées dans la situation choisie. Pour toi toutes les mains sont connues ; pour les autres joueurs, seulement celles montrées à l'abattage : leur grille est une estimation." />
        </div>
        {!cur ? (
          <div className="side-card side-hint">Clique une situation pour voir les deux grilles de mains côte à côte.</div>
        ) : (
          <>
            <div className="side-card">
              <b>{cur.key.replace("|", " · ")}</b>
            </div>
            <div className="side-card cmp-mx">
              <div className="pane-title">{leftLabel}</div>
              {cur.x ? <HandMatrix node={cur.x} /> : <span className="muted small">Jamais dans cette situation.</span>}
            </div>
            <div className="side-card cmp-mx">
              <div className="pane-title">{rightLabel}</div>
              {cur.y ? <HandMatrix node={cur.y} /> : <span className="muted small">Jamais dans cette situation.</span>}
            </div>
          </>
        )}
      </PaneRight>
      <div className="cmp-head">
        <span />
        <b>{leftLabel}</b>
        <b>{rightLabel}</b>
        <span className="muted small">Plus gros écart</span>
      </div>
      <div className="cmp-legend">
        {["All-in", "Relance / Open", "Call / Limp", "Fold"].map((l, k) => (
          <span key={l}>
            <i style={{ background: COLORS[k] }} />
            {l}
          </span>
        ))}
      </div>
      {rows.map((r) => {
        const head = r.scen !== lastScen;
        lastScen = r.scen;
        return (
          <div key={r.key}>
            {head && <div className="cmp-scen">{r.scen}</div>}
            <button className={cls("cmp-row", sel === r.key && "on")} onClick={() => setSel(sel === r.key ? null : r.key)}>
              <span className="cmp-l">{r.label}</span>
              <div className="cmp-cell">
                <Bar node={r.x} />
                <small>{num(r.x?.total ?? 0)}</small>
              </div>
              <div className="cmp-cell">
                <Bar node={r.y} />
                <small>{num(r.y?.total ?? 0)}</small>
              </div>
              <span className={cls("cmp-gap", Math.min(r.x?.total ?? 0, r.y?.total ?? 0) < 15 ? "few" : Math.abs(r.gap) >= 15 ? "big" : Math.abs(r.gap) >= 7 ? "mid" : "")} title={Math.min(r.x?.total ?? 0, r.y?.total ?? 0) < 15 ? "Échantillon trop faible (moins de 15 mains d'un côté)" : undefined}>
                {r.gapK >= 0 ? `${ACTIONS[r.kind][r.gapK]} ${r.gap > 0 ? "+" : ""}${num(r.gap, 0)} pts` : "–"}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
