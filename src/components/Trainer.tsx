// Trainer préflop : 1 à 6 tables, spots tirés au hasard parmi les ranges renseignées.
// Bonne réponse : main suivante. Erreur : la range du spot s'affiche, la main entourée en violet.
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../lib/state";
import { Btn, Help, Panel } from "./ui";
import { HandGrid } from "./HandGrid";
import { PlayingCard } from "./PlayingCard";
import { cls, num } from "../lib/format";
import {
  FORMATS,
  actColors,
  actionTotals,
  cellName,
  dealCell,
  enumerate,
  findBook,
  fmtBB,
  heroReach,
  implicitIndex,
  isDefined,
  rangesApi,
  replay,
  sampleCell,
  spotLabel,
  strategy,
  type Fmt,
  type RangeBook,
  type DepthBook,
  type Spot,
  type TreeSizes,
} from "../lib/ranges";

interface Cfg {
  fmt: Fmt;
  depths: number[];
  tables: number;
  positions: string[];
  /** identifiants de spots exclus */
  off: string[];
  /** fréquence minimale pour qu'une action soit jugée juste */
  threshold: number;
  showMs: number;
  waitClick: boolean;
  fewerTrivial: boolean;
  /** tirage des spots selon la fréquence réelle du coup (sinon uniforme) */
  realistic: boolean;
}

const DEFAULT_CFG: Cfg = { fmt: "spin3", depths: [], tables: 1, positions: [], off: [], threshold: 0.1, showMs: 5000, waitClick: false, fewerTrivial: true, realistic: true };

interface PoolSpot {
  id: string;
  depth: number;
  spot: Spot;
  label: string;
  strat: number[][];
  reach: number[];
  sizes: TreeSizes;
  /** probabilité que le coup arrive jusqu'à ce spot (produit des fréquences des actions) */
  prob: number;
}

interface Deal {
  n: number;
  ps: PoolSpot;
  cell: number;
  cards: [string, string];
  result?: { choice: number; ok: boolean; freq: number; best: number };
}

interface Progress {
  version: 1;
  spots: Record<string, { n: number; ok: number; last: number }>;
  days: Record<string, { n: number; ok: number }>;
}

const spotId = (fmt: Fmt, depth: number, key: string) => `${fmt}|${depth}|${key}`;

function buildPool(book: RangeBook, fmt: Fmt, depths: number[], positions: string[], off: string[]): PoolSpot[] {
  const out: PoolSpot[] = [];
  for (const depth of depths) {
    const db = findBook(book, fmt, depth);
    if (!db) continue;
    for (const sp of enumerate(fmt, depth, db.sizes)) {
      if (!isDefined(db, sp.key)) continue;
      if (positions.length && !positions.includes(sp.hero)) continue;
      const id = spotId(fmt, depth, sp.key);
      if (off.includes(id)) continue;
      const strat = strategy(db, sp);
      if (!strat) continue;
      // spot qu'aucune main n'atteint (ligne jamais jouée) : rien à entraîner
      if (!heroReach(db, fmt, depth, db.sizes, sp.state.history).some((w) => w > 0)) continue;
      out.push({ id, depth, prob: lineProb(db, fmt, depth, sp.state.history), spot: sp, label: `${fmtBB(depth)} bb · ${spotLabel(sp, db.sizes)}`, strat, reach: heroReach(db, fmt, depth, db.sizes, sp.state.history), sizes: db.sizes });
    }
  }
  return out;
}

/** Fréquence d'une ligne : produit des fréquences globales de chaque action jouée
 * (celles du fichier importé quand il les donne, sinon calculées sur les ranges). */
function lineProb(db: DepthBook, fmt: Fmt, depth: number, history: string[]): number {
  const r = replay(fmt, depth, db.sizes, history);
  if (!r) return 0;
  let p = 1;
  for (let k = 0; k < history.length; k++) {
    const s = r.states[k];
    const key = history.slice(0, k).join("-");
    const acts = r.acts[k];
    const i = acts.findIndex((a) => a.id === history[k]);
    const given = db.freq?.[key]?.[history[k]];
    if (given !== undefined) p *= given;
    else {
      const sp: Spot = { key, state: s, acts, hero: FORMATS[fmt].pos[s.toAct] };
      const st = strategy(db, sp);
      if (st) p *= actionTotals(st, heroReach(db, fmt, depth, db.sizes, history.slice(0, k))).freq[i];
    }
  }
  return p;
}

let dealNo = 0;

function pickSpot(pool: PoolSpot[], realistic: boolean): PoolSpot {
  if (!realistic) return pool[Math.floor(Math.random() * pool.length)];
  // un minimum pour que les lignes rares restent possibles
  const w = pool.map((p) => Math.max(p.prob, 0.002));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= w[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function newDeal(pool: PoolSpot[], fewerTrivial: boolean, realistic: boolean): Deal | null {
  for (let tries = 0; tries < 30; tries++) {
    const ps = pickSpot(pool, realistic);
    const imp = implicitIndex(ps.spot.acts);
    const cell = sampleCell((c) => {
      const w = ps.reach[c];
      if (w <= 0) return 0;
      // main « évidente » : une seule action à 99 % et c'est le fold (ou le check)
      const trivial = ps.strat[c][imp] >= 0.99;
      return fewerTrivial && trivial ? w * 0.2 : w;
    });
    if (cell == null) continue;
    return { n: ++dealNo, ps, cell, cards: dealCell(cell) };
  }
  return null;
}

export function Trainer({ book }: { book: RangeBook }) {
  const { prefs, setPrefs } = useApp();
  const cfg: Cfg = { ...DEFAULT_CFG, ...((prefs.trainer as Partial<Cfg>) ?? {}) };
  const setCfg = (p: Partial<Cfg>) => setPrefs({ trainer: { ...cfg, ...p } });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress>({ version: 1, spots: {}, days: {} });
  const [last, setLast] = useState<{ n: number; ok: number } | null>(null);
  useEffect(() => {
    rangesApi
      .trainerLoad()
      .then((j) => j && setProgress({ version: 1, spots: {}, days: {}, ...JSON.parse(j) }))
      .catch(() => {});
  }, []);

  const depthsWith = [...new Set(book.books.filter((b) => b.fmt === cfg.fmt && Object.keys(b.nodes).length).map((b) => b.depth))].sort((a, b) => b - a);
  const depths = cfg.depths.filter((d) => depthsWith.includes(d));
  const useDepths = depths.length ? depths : depthsWith;
  const pool = useMemo(() => buildPool(book, cfg.fmt, useDepths, cfg.positions, cfg.off), [book, cfg.fmt, useDepths.join(","), cfg.positions.join(","), cfg.off.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const allSpots = useMemo(() => buildPool(book, cfg.fmt, useDepths, cfg.positions, []), [book, cfg.fmt, useDepths.join(","), cfg.positions.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (running && pool.length)
    return (
      <Session
        pool={pool}
        cfg={cfg}
        progress={progress}
        setProgress={setProgress}
        onStop={(s) => {
          setRunning(false);
          setLast(s);
        }}
      />
    );

  const pos = FORMATS[cfg.fmt].pos;
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const tot = Object.values(progress.spots).reduce((a, x) => ({ n: a.n + x.n, ok: a.ok + x.ok }), { n: 0, ok: 0 });
  const today = progress.days[new Date().toISOString().slice(0, 10)];
  const weak = Object.entries(progress.spots)
    .filter(([id, x]) => x.n >= 5 && id.startsWith(cfg.fmt + "|"))
    .map(([id, x]) => ({ id, ...x, pct: x.ok / x.n, label: allSpots.find((p) => p.id === id)?.label ?? id.split("|").slice(1).join(" · ") }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 8);

  return (
    <div className="grid2 tr-setup">
      <Panel title="Nouvelle session">
        <div className="col gap16">
          <Row label="Format">
            <div className="seg seg-sm">
              {(Object.keys(FORMATS) as Fmt[]).map((f) => (
                <button key={f} className={cls(cfg.fmt === f && "on")} onClick={() => setCfg({ fmt: f, positions: [], depths: [] })}>
                  {FORMATS[f].label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Profondeurs" help="Seules les profondeurs qui ont des ranges sont proposées. Aucune sélection = toutes.">
            {depthsWith.length === 0 ? (
              <span className="muted small">Aucune range pour ce format : crée-les dans l'onglet « Ranges préflop » ou importe un fichier.</span>
            ) : (
              <div className="row gap6 wrap">
                {depthsWith.map((d) => (
                  <button key={d} className={cls("fchip", depths.includes(d) && "on")} onClick={() => setCfg({ depths: toggle(depths, d) })}>
                    {fmtBB(d)} bb
                  </button>
                ))}
              </div>
            )}
          </Row>
          <Row label="Tables">
            <div className="row gap6">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button key={n} className={cls("fchip", cfg.tables === n && "on")} onClick={() => setCfg({ tables: n })}>
                  {n}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Positions" help="Aucune sélection = aléatoire sur toutes les positions : chaque table tire son propre spot.">
            <div className="row gap6">
              <button className={cls("fchip", cfg.positions.length === 0 && "on")} onClick={() => setCfg({ positions: [] })}>
                Aléatoire
              </button>
              {pos.map((p) => (
                <button key={p} className={cls("fchip", cfg.positions.includes(p) && "on")} onClick={() => setCfg({ positions: toggle(cfg.positions, p) })}>
                  {p}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Réponse juste" help="Une action est juste si la range la joue au moins à cette fréquence, ou si c'est l'action la plus jouée pour la main.">
            <div className="row gap6">
              {[0.05, 0.1, 0.25, 0.5].map((t) => (
                <button key={t} className={cls("fchip", cfg.threshold === t && "on")} onClick={() => setCfg({ threshold: t })}>
                  ≥ {t * 100} %
                </button>
              ))}
            </div>
          </Row>
          <Row label="Après une erreur">
            <div className="row gap6 wrap">
              {[3000, 5000, 8000].map((ms) => (
                <button key={ms} className={cls("fchip", !cfg.waitClick && cfg.showMs === ms && "on")} onClick={() => setCfg({ showMs: ms, waitClick: false })}>
                  {ms / 1000} s
                </button>
              ))}
              <button className={cls("fchip", cfg.waitClick && "on")} onClick={() => setCfg({ waitClick: true })}>
                attendre un clic
              </button>
            </div>
          </Row>
          <Row label="Tirage des spots" help="Réaliste : chaque spot sort selon la fréquence réelle du coup (un open BTN bien plus souvent qu'une ligne 4-bet rare). Uniforme : tous les spots cochés à égalité.">
            <div className="row gap6">
              <button className={cls("fchip", cfg.realistic && "on")} onClick={() => setCfg({ realistic: true })}>
                Réaliste
              </button>
              <button className={cls("fchip", !cfg.realistic && "on")} onClick={() => setCfg({ realistic: false })}>
                Uniforme
              </button>
            </div>
          </Row>
          <label className="row gap8 small">
            <input type="checkbox" checked={cfg.fewerTrivial} onChange={(e) => setCfg({ fewerTrivial: e.target.checked })} />
            Moins de mains évidentes (folds purs 5 fois moins souvent)
          </label>
          <div className="row gap12">
            <Btn kind="primary" icon="play" disabled={!pool.length} onClick={() => setRunning(true)}>
              Lancer ({pool.length} spot{pool.length > 1 ? "s" : ""})
            </Btn>
            <span className="muted small">Raccourcis : 1-5 ou F / C / R / A sur la table survolée, Espace pour passer.</span>
          </div>
          {last && last.n > 0 && (
            <div className="tr-last">
              Dernière session : <b>{last.n}</b> mains · <b className={last.ok / last.n >= 0.8 ? "pos" : "neg"}>{num((last.ok / last.n) * 100, 0)} %</b> de bonnes réponses
            </div>
          )}
        </div>
      </Panel>
      <div className="col gap16">
        <Panel title="Progression" help="Enregistrée sur ton PC (trainer.json, à côté de la base).">
          <div className="row gap24 wrap">
            <div className="tr-kpi">
              <span>Total</span>
              <b>{tot.n ? `${num((tot.ok / tot.n) * 100, 0)} %` : "–"}</b>
              <small>{num(tot.n)} mains</small>
            </div>
            <div className="tr-kpi">
              <span>Aujourd'hui</span>
              <b>{today?.n ? `${num((today.ok / today.n) * 100, 0)} %` : "–"}</b>
              <small>{num(today?.n ?? 0)} mains</small>
            </div>
          </div>
          {weak.length > 0 && (
            <>
              <div className="muted small" style={{ margin: "12px 0 6px" }}>
                Spots les plus difficiles (5 mains minimum)
              </div>
              <table className="tbl">
                <tbody>
                  {weak.map((w) => (
                    <tr key={w.id}>
                      <td>{w.label}</td>
                      <td className="r muted">{w.n}</td>
                      <td className={cls("r", w.pct >= 0.8 ? "pos" : "neg")}>{num(w.pct * 100, 0)} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Panel>
        <Panel title={`Spots (${pool.length}/${allSpots.length})`} help="Décoche les spots à exclure de l'entraînement.">
          {allSpots.length === 0 ? (
            <div className="muted small">Aucun spot renseigné pour cette sélection.</div>
          ) : (
            <div className="tr-spots">
              {allSpots.map((p) => (
                <label key={p.id} className="row gap8 small">
                  <input type="checkbox" checked={!cfg.off.includes(p.id)} onChange={() => setCfg({ off: toggle(cfg.off, p.id) })} />
                  {p.label}
                </label>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="tr-row">
      <span className="tr-lbl">
        {label} {help && <Help text={help} />}
      </span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- session

function Session({
  pool,
  cfg,
  progress,
  setProgress,
  onStop,
}: {
  pool: PoolSpot[];
  cfg: Cfg;
  progress: Progress;
  setProgress: (p: Progress) => void;
  onStop: (s: { n: number; ok: number }) => void;
}) {
  const [deals, setDeals] = useState<(Deal | null)[]>(() => Array.from({ length: cfg.tables }, () => newDeal(pool, cfg.fewerTrivial, cfg.realistic)));
  const [score, setScore] = useState({ n: 0, ok: 0, streak: 0, best: 0 });
  const prog = useRef(progress);
  const saveT = useRef<number | undefined>(undefined);
  const timers = useRef<number[]>([]);
  const hovered = useRef(0);
  const dealsRef = useRef(deals);
  dealsRef.current = deals;

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(saveT.current);
      rangesApi.trainerSave(JSON.stringify(prog.current)).catch(() => {});
    },
    [],
  );

  const next = (t: number) => setDeals((ds) => ds.map((d, i) => (i === t ? newDeal(pool, cfg.fewerTrivial, cfg.realistic) : d)));

  const answer = (t: number, choice: number) => {
    const d = dealsRef.current[t];
    if (!d || d.result) return;
    const row = d.ps.strat[d.cell];
    const best = Math.max(...row);
    const freq = row[choice];
    const ok = freq >= cfg.threshold - 1e-9 || freq >= best - 1e-9;
    setDeals((ds) => ds.map((x, i) => (i === t && x ? { ...x, result: { choice, ok, freq, best } } : x)));
    setScore((s) => {
      const streak = ok ? s.streak + 1 : 0;
      return { n: s.n + 1, ok: s.ok + (ok ? 1 : 0), streak, best: Math.max(s.best, streak) };
    });
    // progression
    const p = prog.current;
    const day = new Date().toISOString().slice(0, 10);
    const sp = p.spots[d.ps.id] ?? { n: 0, ok: 0, last: 0 };
    const dy = p.days[day] ?? { n: 0, ok: 0 };
    prog.current = {
      ...p,
      spots: { ...p.spots, [d.ps.id]: { n: sp.n + 1, ok: sp.ok + (ok ? 1 : 0), last: Math.floor(Date.now() / 1000) } },
      days: { ...p.days, [day]: { n: dy.n + 1, ok: dy.ok + (ok ? 1 : 0) } },
    };
    setProgress(prog.current);
    window.clearTimeout(saveT.current);
    saveT.current = window.setTimeout(() => rangesApi.trainerSave(JSON.stringify(prog.current)).catch(() => {}), 1500);
    if (ok) timers.current.push(window.setTimeout(() => next(t), 650));
    else if (!cfg.waitClick) timers.current.push(window.setTimeout(() => next(t), cfg.showMs));
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const t = dealsRef.current.length === 1 ? 0 : hovered.current;
      const d = dealsRef.current[t];
      if (!d) return;
      if (e.key === " " || e.key === "Enter") {
        if (d.result) {
          e.preventDefault();
          next(t);
        }
        return;
      }
      const acts = d.ps.spot.acts;
      let i = -1;
      if (e.key >= "1" && e.key <= "9") i = +e.key - 1;
      else {
        const kind = { f: "fold", c: "call", x: "check", r: "raise", a: "allin" }[e.key.toLowerCase()];
        if (kind) i = acts.findIndex((a) => a.kind === kind || (kind === "call" && a.kind === "check"));
      }
      if (i >= 0 && i < acts.length) {
        e.preventDefault();
        answer(t, i);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cols = cfg.tables <= 1 ? 1 : cfg.tables <= 4 ? 2 : 3;
  return (
    <div className="col gap12">
      <div className="tr-head">
        <div className="tr-kpi">
          <span>Mains</span>
          <b>{score.n}</b>
        </div>
        <div className="tr-kpi">
          <span>Justes</span>
          <b className={score.n && score.ok / score.n >= 0.8 ? "pos" : score.n ? "neg" : ""}>{score.n ? `${num((score.ok / score.n) * 100, 0)} %` : "–"}</b>
        </div>
        <div className="tr-kpi">
          <span>Série</span>
          <b>{score.streak}</b>
          <small>record {score.best}</small>
        </div>
        <div className="grow" />
        <Btn icon="x" onClick={() => onStop({ n: score.n, ok: score.ok })}>
          Terminer
        </Btn>
      </div>
      <div className={cls("tr-tables", `c${cols}`)}>
        {deals.map((d, t) => (
          <div key={t} onMouseEnter={() => (hovered.current = t)}>
            {d ? <Table deal={d} cfg={cfg} compact={cfg.tables > 2} onAnswer={(i) => answer(t, i)} onNext={() => next(t)} /> : <div className="tr-table tr-empty">Aucune main disponible</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- table

const SEATS3 = ["s-hero", "s-left", "s-right"];
const SEATS2 = ["s-hero", "s-top"];

function Table({ deal, cfg, compact, onAnswer, onNext }: { deal: Deal; cfg: Cfg; compact: boolean; onAnswer: (i: number) => void; onNext: () => void }) {
  const { ps, cards, cell, result } = deal;
  const sp = ps.spot;
  const fmt = sp.state.fmt;
  const pos = FORMATS[fmt].pos;
  const n = pos.length;
  const hero = sp.state.toAct;
  const colors = actColors(sp.acts);
  const r = replay(fmt, ps.depth, ps.sizes, sp.state.history);
  // dernière action de chaque joueur
  const lastAct: (string | null)[] = Array(n).fill(null);
  if (r)
    sp.state.history.forEach((id, k) => {
      const who = r.states[k].toAct;
      lastAct[who] = r.acts[k].find((a) => a.id === id)?.label ?? id;
    });
  const pot = sp.state.put.reduce((a, b) => a + b, 0);
  const seatCls = n === 3 ? SEATS3 : SEATS2;
  const dealer = pos.indexOf(n === 3 ? "BTN" : "SB");
  return (
    <div className={cls("tr-table", compact && "compact", result && (result.ok ? "ok" : "ko"))}>
      <div className="tr-spot">{ps.label}</div>
      <div className="tr-felt">
        {pos.map((p, i) => {
          const rel = (i - hero + n) % n;
          const put = sp.state.put[i];
          if (i === hero)
            return (
              <div key={p} className="tr-seat s-hero me">
                {put > 0 && <div className="tr-bet tr-bet-hero">{fmtBB(put)}</div>}
                <div className="tr-cards">
                  <PlayingCard card={cards[0]} size={compact ? "md" : "lg"} />
                  <PlayingCard card={cards[1]} size={compact ? "md" : "lg"} />
                </div>
                <div className="tr-info">
                  <div className="tr-name">
                    {p}
                    {i === dealer && <i className="tr-dealer">D</i>}
                  </div>
                  <div className="tr-stack">{fmtBB(ps.depth - put)} bb</div>
                </div>
              </div>
            );
          return (
            <div key={p} className={cls("tr-seat", seatCls[rel], sp.state.folded[i] && "folded")}>
              <div className="tr-name">
                {p}
                {i === dealer && <i className="tr-dealer">D</i>}
              </div>
              <div className="tr-stack">{fmtBB(ps.depth - put)} bb</div>
              {lastAct[i] && <div className="tr-last-act">{lastAct[i]}</div>}
              {put > 0 && !sp.state.folded[i] && <div className="tr-bet">{fmtBB(put)}</div>}
            </div>
          );
        })}
        <div className="tr-pot">Pot {fmtBB(pot)} bb</div>
        {result?.ok && (
          <div className="tr-flash">
            ✓ {sp.acts[result.choice].label}
            {result.freq < result.best - 1e-9 && <small> (mixte {num(result.freq * 100, 0)} %)</small>}
          </div>
        )}
      </div>
      <div className="tr-actions">
        {sp.acts.map((a, i) => (
          <button
            key={a.id}
            className={cls("tr-act", result && result.choice === i && (result.ok ? "good" : "bad"))}
            style={{ background: colors[i] }}
            disabled={!!result}
            onClick={() => onAnswer(i)}
            title={`${a.label} (touche ${i + 1})`}
            aria-label={a.label}
          >
            {a.label}
          </button>
        ))}
      </div>
        {result && !result.ok && (
          <div className="tr-review">
            <div className="tr-review-h">
              <b>{cellName(cell)}</b> · tu as joué <span className="neg">{sp.acts[result.choice].label}</span> ({num(result.freq * 100, 0)} %)
            </div>
            <div className="tr-review-s">
              {sp.acts.map((a, i) =>
                ps.strat[cell][i] > 0.004 ? (
                  <span key={a.id}>
                    <i className="gw-dot" style={{ background: colors[i] }} />
                    {a.label} {num(ps.strat[cell][i] * 100, 0)} %
                  </span>
                ) : null,
              )}
            </div>
            <div className="gw tr-grid">
              <HandGrid
                highlight={new Set([cell])}
                dim={(c) => ps.reach[c] <= 0.001}
                render={(c) =>
                  ps.reach[c] > 0.001 ? (
                    <div className="hg-strat" style={{ height: `${Math.max(6, ps.reach[c] * 100)}%` }}>
                      {ps.strat[c].map((f, i) => (f > 0.002 ? <i key={i} style={{ width: `${f * 100}%`, background: colors[i] }} /> : null))}
                    </div>
                  ) : null
                }
              />
            </div>
            {cfg.waitClick ? (
              <button className="gw-btn big" onClick={onNext}>
                Main suivante (Espace)
              </button>
            ) : (
              <div className="tr-timer" style={{ animationDuration: `${cfg.showMs}ms` }} />
            )}
          </div>
        )}
    </div>
  );
}
