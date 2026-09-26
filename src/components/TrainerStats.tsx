// Suivi du trainer : précision jour par jour, faiblesses par position, situation, adversaire
// et profondeur, avec un bouton pour s'entraîner directement sur ce qui coince.
import { useEffect, useMemo, useRef, useState } from "react";
import { Btn, Panel } from "./ui";
import { cls, num } from "../lib/format";
import { FORMATS, fmtBB, replay } from "../lib/ranges";
import type { PoolSpot, Progress } from "./Trainer";

type Dim = "pos" | "situation" | "vs" | "depth" | "spot";

const DIMS: { k: Dim; l: string }[] = [
  { k: "pos", l: "Position" },
  { k: "situation", l: "Situation" },
  { k: "vs", l: "Adversaire" },
  { k: "depth", l: "Profondeur" },
  { k: "spot", l: "Spot" },
];

/** Catégories d'un spot, déduites de l'état du coup au moment de décider. */
export function classify(ps: PoolSpot): Record<Dim, string> {
  const s = ps.spot.state;
  const pos = FORMATS[s.fmt].pos;
  const hero = s.toAct;
  const allinVs = pos.findIndex((_, i) => i !== hero && s.allin[i] && !s.folded[i]);
  // dernier agresseur (relance ou tapis) et dernier limper, d'après l'arbre du spot
  let aggr = -1;
  let limper = -1;
  const acts: string[] = s.history;
  const r = replay(s.fmt, ps.depth, ps.sizes, acts);
  acts.forEach((id, k) => {
    const who = r ? r.states[k].toAct : -1;
    if (id.startsWith("R") || id === "AI") aggr = who;
    else if (id === "C" && r && r.states[k].raises === 0) limper = who;
  });
  let situation: string;
  if (allinVs >= 0) situation = "Contre un tapis";
  else if (s.raises === 0 && limper >= 0 && limper !== hero) situation = "Contre un limp";
  else if (s.raises === 0) situation = "Ouverture";
  else if (s.raises === 1) situation = "Contre une relance";
  else situation = "Contre un 3-bet ou plus";
  const bvb = s.fmt === "spin3" && acts[0] === "F";
  const opp = allinVs >= 0 ? allinVs : aggr >= 0 && aggr !== hero ? aggr : limper >= 0 && limper !== hero ? limper : -1;
  const vs = bvb ? "Blinde contre blinde" : opp >= 0 ? `Contre ${pos[opp]}` : "Premier à parler";
  return { pos: pos[hero], situation, vs, depth: `${fmtBB(ps.depth)} bb`, spot: ps.label };
}

interface Row {
  key: string;
  n: number;
  ok: number;
  ids: string[];
}

export function TrainerStats({
  index,
  progress,
  onTrain,
}: {
  /** tous les spots du format affiché, par identifiant */
  index: Map<string, PoolSpot>;
  progress: Progress;
  onTrain: (spots: PoolSpot[], label: string) => void;
}) {
  const [dim, setDim] = useState<Dim>("situation");
  const [sel, setSel] = useState<string | null>(null);
  const cats = useMemo(() => {
    const m = new Map<string, Record<Dim, string>>();
    index.forEach((ps, id) => m.set(id, classify(ps)));
    return m;
  }, [index]);

  // agrégat par catégorie de la dimension choisie
  const rows: Row[] = useMemo(() => {
    const acc = new Map<string, Row>();
    for (const [id, x] of Object.entries(progress.spots)) {
      const c = cats.get(id);
      if (!c) continue;
      const key = c[dim];
      const r = acc.get(key) ?? { key, n: 0, ok: 0, ids: [] };
      r.n += x.n;
      r.ok += x.ok;
      r.ids.push(id);
      acc.set(key, r);
    }
    return [...acc.values()].sort((a, b) => a.ok / a.n - b.ok / b.n || b.n - a.n);
  }, [progress, cats, dim]);

  // spots de chaque catégorie, même jamais joués (pour « Entraîner »)
  const spotsOf = (key: string) => [...index.entries()].filter(([id]) => cats.get(id)?.[dim] === key).map(([, ps]) => ps);

  // courbe : par jour, filtrée sur la catégorie choisie
  const days = useMemo(() => {
    const out: { day: string; n: number; ok: number }[] = [];
    const keys = Object.keys(progress.days).sort();
    for (const day of keys) {
      if (!sel) {
        const d = progress.days[day];
        if (d.n) out.push({ day, n: d.n, ok: d.ok });
        continue;
      }
      const det = progress.daySpots?.[day];
      if (!det) continue;
      let n = 0;
      let ok = 0;
      for (const [id, [a, b]] of Object.entries(det)) {
        if (cats.get(id)?.[dim] !== sel) continue;
        n += a;
        ok += b;
      }
      if (n) out.push({ day, n, ok });
    }
    return out.slice(-45);
  }, [progress, sel, cats, dim]);

  const tot = Object.values(progress.days).reduce((a, d) => ({ n: a.n + d.n, ok: a.ok + d.ok }), { n: 0, ok: 0 });
  const last7 = Object.entries(progress.days)
    .filter(([d]) => Date.now() - new Date(d + "T12:00:00").getTime() < 7 * 86400000)
    .reduce((a, [, d]) => ({ n: a.n + d.n, ok: a.ok + d.ok }), { n: 0, ok: 0 });
  const pct = (x: { n: number; ok: number }) => (x.n ? `${num((x.ok / x.n) * 100, 0)} %` : "–");

  // faiblesses : spots à moins de 85 % sur au moins 3 mains, les pires d'abord
  const weak = Object.entries(progress.spots)
    .filter(([id, x]) => index.has(id) && x.n >= 3 && x.ok / x.n < 0.85)
    .sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n)
    .map(([id]) => index.get(id)!);

  return (
    <Panel
      title="Suivi de ta précision"
      help="Enregistré sur ton PC (trainer.json). Clique une ligne du tableau pour filtrer la courbe sur cette catégorie. Le détail par catégorie commence avec les mains jouées depuis cette version."
      right={
        <Btn kind="primary" icon="target" disabled={!weak.length} onClick={() => onTrain(weak, "Mes faiblesses")} title="Spots joués au moins 3 fois avec moins de 85 % de réussite">
          Travailler mes faiblesses{weak.length ? ` (${weak.length} spot${weak.length > 1 ? "s" : ""})` : ""}
        </Btn>
      }
    >
      <div className="ts">
        <div className="ts-kpis">
          <div className="tr-kpi">
            <span>Précision totale</span>
            <b>{pct(tot)}</b>
            <small>{num(tot.n)} mains</small>
          </div>
          <div className="tr-kpi">
            <span>Erreurs</span>
            <b>{num(tot.n - tot.ok)}</b>
            <small>sur {num(tot.n)}</small>
          </div>
          <div className="tr-kpi">
            <span>7 derniers jours</span>
            <b>{pct(last7)}</b>
            <small>{num(last7.n)} mains</small>
          </div>
          <div className="tr-kpi">
            <span>Spots travaillés</span>
            <b>{num(Object.keys(progress.spots).length)}</b>
            <small>sur {num(index.size)}</small>
          </div>
        </div>
        <div className="ts-body">
          <div className="ts-chart">
            <div className="ts-chart-h">
              <b>Précision par jour</b>
              <span className="muted small">{sel ? `${DIMS.find((d) => d.k === dim)?.l} : ${sel}` : "toutes les mains"}</span>
              {sel && (
                <button className="fchip" onClick={() => setSel(null)}>
                  Tout afficher
                </button>
              )}
            </div>
            <DailyChart days={days} />
          </div>
          <div className="ts-table">
            <div className="row gap6 wrap">
              {DIMS.map((d) => (
                <button key={d.k} className={cls("fchip", dim === d.k && "on")} onClick={() => (setDim(d.k), setSel(null))}>
                  {d.l}
                </button>
              ))}
            </div>
            {rows.length === 0 ? (
              <div className="muted small" style={{ padding: "18px 4px" }}>
                Joue quelques mains au trainer pour voir apparaître tes points forts et tes faiblesses.
              </div>
            ) : (
              <div className="ts-scroll">
                <table className="tbl hover">
                  <thead>
                    <tr>
                      <th>{DIMS.find((d) => d.k === dim)?.l}</th>
                      <th className="r">Mains</th>
                      <th className="r">Erreurs</th>
                      <th>Précision</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const p = r.ok / r.n;
                      return (
                        <tr key={r.key} className={cls(sel === r.key && "sel")} onClick={() => setSel(sel === r.key ? null : r.key)}>
                          <td>{r.key}</td>
                          <td className="r">{num(r.n)}</td>
                          <td className="r">{num(r.n - r.ok)}</td>
                          <td>
                            <div className="ts-bar">
                              <i style={{ width: `${p * 100}%` }} className={p >= 0.85 ? "good" : p >= 0.7 ? "mid" : "bad"} />
                              <span>{num(p * 100, 0)} %</span>
                            </div>
                          </td>
                          <td className="r">
                            <button
                              className="fchip"
                              onClick={(e) => {
                                e.stopPropagation();
                                onTrain(spotsOf(r.key), r.key);
                              }}
                            >
                              Entraîner
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** Précision quotidienne (une seule échelle, en %) et, dessous, le volume de mains du jour. */
function DailyChart({ days }: { days: { day: string; n: number; ok: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  if (!days.length)
    return (
      <div ref={ref} className="ts-empty muted small">
        Pas encore de mains sur cette sélection.
      </div>
    );
  const H = 190;
  const VH = 46;
  const padL = 40;
  const padR = 12;
  const pts = days.map((d) => (d.ok / d.n) * 100);
  const lo = Math.max(0, Math.floor((Math.min(...pts) - 5) / 10) * 10);
  const hi = 100;
  const n = days.length;
  const x = (i: number) => (n === 1 ? padL + (w - padL - padR) / 2 : padL + (i * (w - padL - padR)) / (n - 1));
  const y = (v: number) => 10 + ((hi - v) / (hi - lo)) * (H - 30);
  const maxN = Math.max(...days.map((d) => d.n));
  const ticks = [lo, (lo + hi) / 2, hi];
  const line = days.map((_, i) => `${i ? "L" : "M"}${x(i)},${y(pts[i])}`).join(" ");
  const bw = Math.max(3, Math.min(18, ((w - padL - padR) / n) * 0.6));
  const label = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const hv = hover != null ? days[hover] : null;
  return (
    <div ref={ref} className="ts-chartbox" onMouseLeave={() => setHover(null)}>
      <svg
        width={w}
        height={H + VH + 18}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const mx = e.clientX - r.left;
          let best = 0;
          for (let i = 1; i < n; i++) if (Math.abs(x(i) - mx) < Math.abs(x(best) - mx)) best = i;
          setHover(best);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} className="ts-grid" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="ts-axis">
              {num(t, 0)} %
            </text>
          </g>
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={8} y2={H + VH + 4} className="ts-cross" />}
        <path d={line} className="ts-line" />
        {days.map((_, i) => (
          <circle key={i} cx={x(i)} cy={y(pts[i])} r={hover === i ? 5.5 : 4} className="ts-dot" />
        ))}
        {/* volume de mains : même axe des jours, sa propre échelle, sous la courbe */}
        {days.map((d, i) => {
          const bh = Math.max(2, (d.n / maxN) * (VH - 6));
          return <rect key={i} x={x(i) - bw / 2} y={H + VH - bh} width={bw} height={bh} rx={2} className={cls("ts-vol", hover === i && "on")} />;
        })}
        <text x={padL - 8} y={H + VH - 2} textAnchor="end" className="ts-axis">
          mains
        </text>
        {days.map((d, i) =>
          n <= 12 || i % Math.ceil(n / 12) === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={H + VH + 15} textAnchor="middle" className="ts-axis">
              {label(d.day)}
            </text>
          ) : null,
        )}
      </svg>
      {hv && hover != null && (
        <div className="bc-tip" style={{ left: Math.min(x(hover) + 12, w - 190), top: Math.max(4, y(pts[hover]) - 10) }}>
          <b>{label(hv.day)}</b>
          <div className="bc-tip-r">
            Précision <span>{num((hv.ok / hv.n) * 100, 1)} %</span>
          </div>
          <div className="bc-tip-r">
            Mains <span>{num(hv.n)}</span>
          </div>
          <div className="bc-tip-r">
            Erreurs <span>{num(hv.n - hv.ok)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
