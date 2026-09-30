// Comparaison préflop : moi à gauche, la référence choisie à droite (Regs, Fish, population, un
// joueur ou une base importée), situation par situation. Un clic montre les grilles de mains :
// les miennes, et celles du groupe (cartes vues à l'abattage) quand il vient de ma base.
import { useMemo, useState } from "react";
import { api, type Filter, type NodeOut } from "../lib/api";
import { useQuery } from "../lib/state";
import { cls, num } from "../lib/format";
import { Empty, Help, Loading } from "./ui";
import { ACTIONS, HandMatrix, kindOf } from "./LeakPanels";
import { PaneRight } from "./Spatial";

const COLORS = ["var(--pos)", "#3b82f6", "var(--gold)", "rgba(255,255,255,0.28)"];
const pct = (c: number[], k: number) => {
  const t = c.reduce((a, b) => a + b, 0);
  return t ? (c[k] / t) * 100 : 0;
};

function Bar({ values, kind }: { values: number[] | null; kind: string }) {
  if (!values) return <div className="cmp-bar empty">–</div>;
  const acts = ACTIONS[kind];
  return (
    <div className="cmp-bar">
      {values.map((v, k) =>
        v > 0.05 && acts[k] ? (
          <i key={k} style={{ width: `${v}%`, background: COLORS[k] }} title={`${acts[k]} ${num(v, 0)} %`}>
            {v >= 14 ? num(v, 0) : ""}
          </i>
        ) : null,
      )}
    </div>
  );
}

export function LeakCompare({
  filter,
  vs,
  reference,
  refLabel,
  scenario,
  kinds,
  minHands,
}: {
  filter: Filter;
  vs: string;
  reference: string;
  refLabel: string;
  scenario: string | null;
  kinds: string[];
  minHands: number;
}) {
  const { data: me, loading } = useQuery(["leakcmp-me", reference, vs, filter], () => api.leakReport("", filter, reference, vs));
  // grilles du groupe : seulement s'il vient de ma base (pas pour une base importée)
  const grpOk = reference !== "none" && reference !== "custom" && !reference.startsWith("file:");
  const [sel, setSel] = useState<string | null>(null);
  const { data: grp } = useQuery(["leakcmp-grp", reference, vs, filter], () => api.leakReport(reference, filter, "none", vs), grpOk && sel != null);
  const rows = useMemo(() => {
    if (!me) return [];
    return me.panels
      .flatMap((p) => p.nodes.map((n) => ({ scen: p.scenario, n })))
      .filter(({ scen, n }) => (!scenario || scen === scenario) && (!kinds.length || kinds.includes(kindOf(n))) && n.total >= minHands)
      .map(({ scen, n }) => {
        const mine = n.counts.map((_, k) => pct(n.counts, k));
        const ref = n.reference && n.reference.some((x) => isFinite(x)) ? n.reference.map((x) => (isFinite(x) ? x : 0)) : null;
        let gap = 0;
        let gapK = -1;
        if (ref)
          ACTIONS[n.kind].forEach((l, i) => {
            if (!l) return;
            const d = mine[i] - ref[i];
            if (Math.abs(d) > Math.abs(gap)) {
              gap = d;
              gapK = i;
            }
          });
        return { key: n.key, scen, node: n, mine, ref, gap, gapK };
      })
      .sort((a, b) => (a.scen === b.scen ? b.node.total - a.node.total : 0));
  }, [me, scenario, kinds, minHands]);
  const cur = rows.find((r) => r.key === sel) ?? null;
  const grpNode: NodeOut | undefined = cur && grp ? grp.panels.flatMap((p) => p.nodes).find((n) => n.key === cur.key) : undefined;
  if (loading && !me) return <Loading h={360} />;
  if (!rows.length) return <Empty title="Rien à comparer" sub="Aucune situation avec assez de mains : change de position, de type de coup ou baisse le minimum de mains." icon="search" />;
  let lastScen = "";
  return (
    <div className="cmp">
      <PaneRight>
        <div className="row gap8">
          <div className="pane-title">Mains jouées</div>
          <Help text="Grilles des mains réellement jouées dans la situation choisie. Les tiennes sont toutes connues ; celles du groupe seulement quand elles ont été montrées à l'abattage." />
        </div>
        {!cur ? (
          <div className="side-card side-hint">Clique une situation pour voir la grille de tes mains, et celle du groupe de référence.</div>
        ) : (
          <>
            <div className="side-card">
              <b>{cur.key.replace("|", " · ")}</b>
            </div>
            <div className="side-card cmp-mx">
              <div className="pane-title">Moi</div>
              <HandMatrix node={cur.node} />
            </div>
            {grpOk && (
              <div className="side-card cmp-mx">
                <div className="pane-title">{refLabel} (abattages)</div>
                {grpNode ? <HandMatrix node={grpNode} /> : <span className="muted small">{grp ? "Aucune main montrée dans cette situation." : "Chargement…"}</span>}
              </div>
            )}
          </>
        )}
      </PaneRight>
      <div className="cmp-head">
        <span>Situation</span>
        <b>Moi</b>
        <b>{refLabel}</b>
        <span className="muted small">Mon écart</span>
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
        const few = r.node.total < 15 || r.node.ref_total < 15;
        return (
          <div key={r.key}>
            {head && <div className="cmp-scen">{r.scen}</div>}
            <button className={cls("cmp-row", sel === r.key && "on")} onClick={() => setSel(sel === r.key ? null : r.key)}>
              <span className="cmp-l">{r.node.label}</span>
              <div className="cmp-cell">
                <Bar values={r.mine} kind={r.node.kind} />
                <small>{num(r.node.total)}</small>
              </div>
              <div className="cmp-cell">
                <Bar values={r.ref} kind={r.node.kind} />
                <small>{r.node.ref_total ? num(r.node.ref_total) : ""}</small>
              </div>
              <span className={cls("cmp-gap", few ? "few" : Math.abs(r.gap) >= 15 ? "big" : Math.abs(r.gap) >= 7 ? "mid" : "")} title={few ? "Échantillon trop faible (moins de 15 mains d'un côté)" : undefined}>
                {r.gapK >= 0 ? `${ACTIONS[r.node.kind][r.gapK]} ${r.gap > 0 ? "+" : ""}${num(r.gap, 0)} pts` : "–"}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
