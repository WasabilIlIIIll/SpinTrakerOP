import { useState } from "react";
import type { LeakReport, NodeOut, Post } from "../lib/api";
import { cls, num } from "../lib/format";
import { Icon } from "./Icon";
import { Modal } from "./ui";

export const ACTIONS: Record<string, (string | null)[]> = {
  open: ["All-in", "Open", "Limp", "Fold"],
  vs_limp: ["All-in", "Iso", "Check/Call", "Fold"],
  vs_raise: ["All-in", "Relance", "Call", "Fold"],
  vs_shove: [null, null, "Call", "Fold"],
};

const ACT_COLORS = ["var(--pos)", "#3b82f6", "var(--gold)", "var(--faint)"];

function pctOf(c: number[], k: number) {
  const t = c.reduce((a, b) => a + b, 0);
  return t ? (c[k] / t) * 100 : 0;
}

function dev(mine: number, ref: number | null | undefined, n: number): string {
  if (ref == null || !isFinite(ref)) return "nr";
  if (n < 8) return "low";
  const d = Math.abs(mine - ref);
  const tol = 4 + 40 / Math.sqrt(n);
  if (d <= tol) return "ok";
  if (d <= tol * 2.2) return "warn";
  return "bad";
}

function Cell({ mine, ref, n, main }: { mine: number; ref?: number | null; n: number; main?: boolean }) {
  const d = dev(mine, ref, n);
  return (
    <span className={cls("lk-c", `dv-${d}`, main && "main")} title={ref != null && isFinite(ref) ? `Référence : ${num(ref, 1)} %` : "Pas de référence"}>
      {num(mine, 0)}
      <small>%</small>
    </span>
  );
}

export function NodeCard({ node, onMatrix }: { node: NodeOut; onMatrix?: (n: NodeOut) => void }) {
  const acts = ACTIONS[node.kind];
  const cols = acts.map((a, k) => ({ a, k })).filter((x) => x.a);
  return (
    <div className="lk-node">
      <div className="lk-nh">
        <span>{node.label}</span>
        {node.ref_total > 0 && <span className="lk-ref" title="Taille de l'échantillon de référence">réf. {node.ref_total >= 1000 ? `${num(node.ref_total / 1000, 1)}k` : node.ref_total}</span>}
        {onMatrix && Object.keys(node.matrix).length > 0 && (
          <button className="icon-btn" title="Voir la grille de mains" onClick={() => onMatrix(node)}>
            <Icon name="layers" size={14} />
          </button>
        )}
      </div>
      <div className="lk-big">
        <div>
          <b>{node.total >= 1000 ? `${num(node.total / 1000, 1)}k` : node.total}</b>
          <span>MAINS</span>
        </div>
        {cols.map(({ a, k }) => (
          <div key={k}>
            <Cell mine={pctOf(node.counts, k)} ref={node.reference?.[k]} n={node.total} main />
            <span>{a!.toUpperCase()}</span>
          </div>
        ))}
      </div>
      <table className="lk-tbl">
        <thead>
          <tr>
            <th>Tapis (bb)</th>
            <th className="r">Mains</th>
            {cols.map(({ a, k }) => (
              <th key={k} className="r">
                {a}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {node.buckets.map((b) => (
            <tr key={b.label}>
              <td>{b.label}</td>
              <td className="r">{b.total >= 1000 ? `${num(b.total / 1000, 1)}k` : b.total}</td>
              {cols.map(({ k }) => (
                <td key={k} className="r">
                  <Cell mine={pctOf(b.counts, k)} ref={b.reference?.[k]} n={b.total} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const RANKS = "AKQJT98765432";

export function HandMatrix({ node }: { node: NodeOut }) {
  const acts = ACTIONS[node.kind];
  const [focus, setFocus] = useState<number | null>(null);
  return (
    <div>
      <div className="hm-legend">
        {acts.map((a, k) =>
          a ? (
            <button key={k} className={cls("hm-lg", focus === k && "on")} onClick={() => setFocus(focus === k ? null : k)}>
              <i style={{ background: ACT_COLORS[k] }} /> {a} <b>{num(pctOf(node.counts, k), 0)} %</b>
            </button>
          ) : null,
        )}
      </div>
      <div className="hm">
        {RANKS.split("").map((r1, i) =>
          RANKS.split("").map((r2, j) => {
            const key = i === j ? r1 + r2 : i < j ? `${r1}${r2}s` : `${r2}${r1}o`;
            const c = node.matrix[key];
            const tot = c ? c.reduce((a, b) => a + b, 0) : 0;
            let bg = "var(--surface2)";
            if (c && tot) {
              let acc = 0;
              const stops: string[] = [];
              c.forEach((v, k) => {
                if (!v) return;
                const from = (acc / tot) * 100;
                acc += v;
                const to = (acc / tot) * 100;
                const col = focus == null || focus === k ? ACT_COLORS[k] : "var(--surface3)";
                stops.push(`${col} ${from}% ${to}%`);
              });
              bg = `linear-gradient(90deg, ${stops.join(",")})`;
            }
            return (
              <div key={key} className={cls("hm-c", tot > 0 && "has")} style={{ background: bg }} title={c ? `${key} : ${acts.map((a, k) => (a ? `${a} ${c[k]}` : "")).filter(Boolean).join(" · ")}` : key}>
                <span>{key}</span>
                {tot > 0 && <small>{tot}</small>}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}

export function LeakPanels({ report, scenarios, minHands = 3 }: { report: LeakReport; scenarios?: string[]; minHands?: number }) {
  const [mx, setMx] = useState<NodeOut | null>(null);
  const panels = report.panels.filter((p) => (!scenarios || scenarios.includes(p.scenario)) && p.nodes.length > 0);
  if (panels.length === 0) return <div className="muted">Aucune décision préflop sur cette sélection.</div>;
  return (
    <div className="lk-panels">
      {panels.map((p) => {
        const nodes = p.nodes.filter((n) => n.total >= minHands);
        if (!nodes.length) return null;
        return (
          <div key={p.scenario} className="lk-sc">
            <div className="lk-sc-h">
              <h4>{p.scenario}</h4>
              <span className="muted small">{num(p.hands)} mains</span>
            </div>
            <div className="lk-nodes">
              {nodes.map((n) => (
                <NodeCard key={n.key} node={n} onMatrix={setMx} />
              ))}
            </div>
          </div>
        );
      })}
      {mx && (
        <Modal title={mx.label} onClose={() => setMx(null)}>
          <HandMatrix node={mx} />
        </Modal>
      )}
    </div>
  );
}

const POST_ROWS: [keyof Post, string, string][] = [
  ["cbet", "C-bet flop", "Mise au flop en tant que dernier relanceur préflop"],
  ["barrel", "2e barrel (turn)", "Mise au turn après une c-bet flop"],
  ["fold_cbet", "Fold vs c-bet", "Se coucher face à une c-bet"],
  ["raise_cbet", "Raise vs c-bet", "Relancer une c-bet"],
  ["check_raise", "Check-raise flop", "Check puis relance face à une c-bet"],
  ["donk", "Donk bet", "Miser avant le relanceur préflop"],
  ["bets_raises_flop", "Agression flop", "Part des actions flop qui sont des mises/relances"],
  ["wtsd", "WTSD", "Aller à l'abattage après avoir vu le flop"],
  ["wsd", "W$SD", "Gagner à l'abattage"],
];

export function PostflopTable({ mine, reference }: { mine: Post[]; reference: Post[] }) {
  const keys = Array.from(new Set([...mine.map((p) => p.key), ...reference.map((p) => p.key)])).sort();
  if (!keys.length) return <div className="muted">Aucun flop vu sur cette sélection.</div>;
  return (
    <div className="post-grid">
      {keys.map((k) => {
        const m = mine.find((p) => p.key === k);
        const r = reference.find((p) => p.key === k);
        return (
          <div key={k} className="lk-node">
            <div className="lk-nh">
              <span>Pots {k}</span>
              <span className="muted small">{m?.flops ?? 0} flops</span>
            </div>
            <table className="lk-tbl">
              <thead>
                <tr>
                  <th>Stat</th>
                  <th className="r">Opp.</th>
                  <th className="r">Joueur</th>
                  <th className="r">Réf.</th>
                </tr>
              </thead>
              <tbody>
                {POST_ROWS.map(([f, l, h]) => {
                  const mv = m ? (m[f] as [number, number]) : [0, 0];
                  const rv = r ? (r[f] as [number, number]) : [0, 0];
                  const mp = mv[1] ? (mv[0] / mv[1]) * 100 : NaN;
                  const rp = rv[1] ? (rv[0] / rv[1]) * 100 : NaN;
                  return (
                    <tr key={f} title={h}>
                      <td>{l}</td>
                      <td className="r muted">{mv[1]}</td>
                      <td className="r">{isFinite(mp) ? <Cell mine={mp} ref={isFinite(rp) ? rp : null} n={mv[1]} /> : "–"}</td>
                      <td className="r muted">{isFinite(rp) ? `${num(rp, 0)}%` : "–"}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td>AF</td>
                  <td className="r muted" />
                  <td className="r">{m ? num(m.calls ? m.agg / m.calls : m.agg, 2) : "–"}</td>
                  <td className="r muted">{r ? num(r.calls ? r.agg / r.calls : r.agg, 2) : "–"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/** Explique d'où viennent les références et comment l'écart est jugé. */
export function RefSources({ mode, tagName }: { mode: string; tagName?: string }) {
  const src =
    mode === "population"
      ? "tous les autres joueurs présents dans vos historiques, dans la même situation et la même tranche de tapis"
      : mode.startsWith("tag:")
        ? `les joueurs portant le tag « ${tagName ?? mode.slice(4)} », dans la même situation et la même tranche de tapis`
        : mode === "custom"
          ? "vos propres cibles, saisies dans Paramètres → Références (par exemple issues d'un solveur)"
          : "aucune (affichage des fréquences brutes)";
  return (
    <div className="ref-src">
      <Icon name="info" size={14} />
      <div>
        <b>Référence : {src}.</b> Spin Tracker OP ne contient aucune solution GTO : les comparaisons sont statistiques, calculées sur vos propres données.
        Un écart est signalé quand il dépasse la tolérance <code>4 % + 40/√n</code> (n = taille de votre échantillon), et en rouge au-delà de 2,2 fois cette
        tolérance ; en dessous de 8 décisions, la case reste grise.
      </div>
    </div>
  );
}

export function RefLegend() {
  return (
    <div className="ref-legend">
      <span>
        <i className="dv-ok" /> proche de la référence
      </span>
      <span>
        <i className="dv-warn" /> écart notable
      </span>
      <span>
        <i className="dv-bad" /> leak probable
      </span>
      <span>
        <i className="dv-low" /> échantillon faible
      </span>
    </div>
  );
}
