// Trainer préflop : 1 à 6 tables, spots tirés au hasard parmi les ranges renseignées.
// Bonne réponse : main suivante. Erreur : la range du spot s'affiche, la main entourée en violet.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../lib/state";
import { Btn, Help, Loading, Panel } from "./ui";
import { HandGrid } from "./HandGrid";
import { TrainerStats } from "./TrainerStats";
import { ReviewModal } from "./ReviewModal";
import { PaneLeft, PaneRight } from "./Spatial";
import { analyze, linesApi, pendingReview, type Analysis, type Decision, type ReviewEntry } from "../lib/review";
import { cls, num, realDate } from "../lib/format";
import {
  FORMATS,
  potOf,
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
  type Act,
  type DepthBook,
  type Spot,
  type TreeSizes,
} from "../lib/ranges";

interface Cfg {
  /** format entraîné : 3-way, tête-à-tête, ou les deux mélangés */
  fmt: Fmt | "all";
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
  /** raccourcis (touche ou bouton de souris par action) */
  keys?: Partial<KeyMap>;
}

const DEFAULT_CFG: Cfg = { fmt: "spin3", depths: [], tables: 1, positions: [], off: [], threshold: 0.1, showMs: 5000, waitClick: false, fewerTrivial: true, realistic: true };

export interface PoolSpot {
  id: string;
  depth: number;
  spot: Spot;
  label: string;
  strat: number[][];
  reach: number[];
  sizes: TreeSizes;
  /** EV par main du spot, si le fichier la donne */
  ev?: Record<string, number[]>;
  /** probabilité que le coup arrive jusqu'à ce spot (produit des fréquences des actions) */
  prob: number;
}

interface Deal {
  n: number;
  ps: PoolSpot;
  cell: number;
  cards: [string, string];
  /** main réelle rejouée en review */
  note?: string;
  result?: { choice: number; ok: boolean; freq: number; best: number };
}

/** Main réelle à rejouer (review des erreurs). */
interface QItem {
  ps: PoolSpot;
  cell: number;
  cards: [string, string];
  note: string;
}

export interface Progress {
  version: 1;
  spots: Record<string, { n: number; ok: number; last: number }>;
  days: Record<string, { n: number; ok: number }>;
  /** détail par jour et par spot : [mains, justes] (courbe filtrable par catégorie) */
  daySpots?: Record<string, Record<string, [number, number]>>;
  /** analyses des mains jouées (import ou base entière), les plus récentes d'abord */
  reviews?: ReviewEntry[];
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
      out.push({ id, depth, prob: lineProb(db, fmt, depth, sp.state.history), spot: sp, label: `${FORMATS[fmt].short} · ${fmtBB(depth)} bb · ${spotLabel(sp, db.sizes)}`, strat, reach: heroReach(db, fmt, depth, db.sizes, sp.state.history), sizes: db.sizes, ev: db.ev?.[sp.key] });
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

/** Date du jour à l'heure de l'ordinateur (AAAA-MM-JJ). */
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

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
  // la progression enregistrée doit être lue AVANT toute session : sinon une session partie
  // d'une progression vide l'écraserait (bug corrigé le 30/09/2026). En cas d'échec de lecture,
  // rien n'est jamais réécrit.
  const [loaded, setLoaded] = useState<"no" | "ok" | "err">("no");
  const [last, setLast] = useState<{ n: number; ok: number } | null>(null);
  /** session ciblée (faiblesses ou catégorie) lancée depuis le suivi */
  const [custom, setCustom] = useState<{ pool: PoolSpot[]; label: string } | null>(null);
  /** review : erreurs réelles rejouées une par une, sur une table */
  const [review, setReview] = useState<{ queue: QItem[]; label: string } | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const { toast } = useApp();
  const startReview = (items: Decision[], label: string) => {
    const cache = new Map<string, Map<string, PoolSpot>>();
    const queue: QItem[] = [];
    for (const d of items) {
      const k = `${d.fmt}|${d.depth}`;
      if (!cache.has(k)) cache.set(k, new Map(buildPool(book, d.fmt, [d.depth], [], []).map((p) => [p.id, p])));
      const ps = cache.get(k)!.get(`${d.fmt}|${d.depth}|${d.key}`);
      if (!ps) continue;
      queue.push({
        ps,
        cell: d.cell,
        cards: d.cards,
        note: `Main réelle du ${realDate(d.ts)} · tapis effectif ${fmtBB(d.eff)} bb · tu avais joué ${d.choiceLabel}`,
      });
    }
    if (!queue.length) return toast("Ces spots n'existent plus dans tes ranges", "err");
    setReview({ queue, label });
    setRunning(true);
  };
  // erreurs transmises par l'import (une fois la progression lue)
  useEffect(() => {
    if (loaded === "no") return;
    if (pendingReview.items?.length) {
      const items = pendingReview.items;
      pendingReview.items = null;
      startReview(items, pendingReview.label || "Review");
    }
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const analyseAll = async () => {
    setAnalysing(true);
    try {
      const a = analyze(await linesApi.get(), book, cfg.threshold);
      setAnalysis(a);
      if (a.decisions.length) {
        const entry: ReviewEntry = {
          ts: Math.floor(Date.now() / 1000),
          label: "Toute la base",
          decisions: a.decisions.length,
          ok: a.decisions.filter((d) => d.ok).length,
          evLoss: a.decisions.reduce((x, d) => x + (d.evLoss ?? 0), 0),
          errors: a.decisions.filter((d) => !d.ok),
        };
        const next = { ...progress, reviews: [entry, ...(progress.reviews ?? [])].slice(0, 20) };
        setProgress(next);
        if (loaded === "ok") rangesApi.trainerSave(JSON.stringify(next)).catch(() => {});
      }
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setAnalysing(false);
    }
  };
  useEffect(() => {
    rangesApi
      .trainerLoad()
      .then((j) => {
        if (j) setProgress({ version: 1, spots: {}, days: {}, ...JSON.parse(j) });
        setLoaded("ok");
      })
      .catch(() => {
        setLoaded("err");
        toast("Progression du trainer illisible : elle ne sera pas modifiée", "err");
      });
  }, []);

  const fmts: Fmt[] = cfg.fmt === "all" ? (Object.keys(FORMATS) as Fmt[]) : [cfg.fmt];
  const depthsWith = [...new Set(book.books.filter((b) => fmts.includes(b.fmt) && Object.keys(b.nodes).length).map((b) => b.depth))].sort((a, b) => b - a);
  const depths = cfg.depths.filter((d) => depthsWith.includes(d));
  const useDepths = depths.length ? depths : depthsWith;
  const poolOf = (positions: string[], off: string[]) => fmts.flatMap((f) => buildPool(book, f, useDepths, positions, off));
  const pool = useMemo(() => poolOf(cfg.positions, cfg.off), [book, cfg.fmt, useDepths.join(","), cfg.positions.join(","), cfg.off.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const allSpots = useMemo(() => poolOf(cfg.positions, []), [book, cfg.fmt, useDepths.join(","), cfg.positions.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  // tous les spots du format (toutes profondeurs et positions) : base du suivi
  const index = useMemo(() => new Map(fmts.flatMap((f) => buildPool(book, f, depthsWith, [], [])).map((p) => [p.id, p])), [book, cfg.fmt, depthsWith.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const sessionPool = review ? review.queue.map((q) => q.ps) : custom?.pool.length ? custom.pool : pool;
  if (running && loaded === "no") return <Loading />;
  if (running && sessionPool.length)
    return (
      <Session
        canSave={loaded === "ok"}
        pool={sessionPool}
        label={review?.label ?? custom?.label}
        queue={review?.queue}
        cfg={review ? { ...cfg, tables: 1 } : cfg}
        progress={progress}
        setProgress={setProgress}
        onStop={(s) => {
          setRunning(false);
          setCustom(null);
          setReview(null);
          setLast(s);
        }}
      />
    );

  const pos = [...new Set(fmts.flatMap((f) => FORMATS[f].pos))];
  const FMT_CHOICES: [Cfg["fmt"], string][] = [
    ["spin3", "3-way"],
    ["hu", "HU"],
    ["all", "Les deux"],
  ];
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div className="col gap16">
      <PaneLeft>
        <div className="pane-title">Nouvelle session</div>
        <div className="tr-side">

        <div className="col gap16">
          <Row label="Format" help="3-way : les spots à trois joueurs (BTN, SB, BB). HU : le tête-à-tête (SB contre BB). Les deux : spots des deux formats mélangés.">
            <div className="tr-fmt">
              {FMT_CHOICES.map(([f, l]) => (
                <button key={f} className={cls(cfg.fmt === f && "on")} onClick={() => setCfg({ fmt: f, positions: [], depths: [] })}>
                  {l}
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
          <Row label="Raccourcis" help="Comme dans Jurojin : clique une case puis appuie sur la touche ou le bouton de souris voulu (Échap = aucun). Ils agissent sur la table sous la souris. Les touches 1 à 9 choisissent aussi l'action dans l'ordre des boutons.">
            <KeyEditor keys={{ ...DEFAULT_KEYS, ...(cfg.keys ?? {}) }} onChange={(k) => setCfg({ keys: k })} />
          </Row>
          <label className="row gap8 small">
            <input type="checkbox" checked={cfg.fewerTrivial} onChange={(e) => setCfg({ fewerTrivial: e.target.checked })} />
            Moins de mains évidentes (folds purs 5 fois moins souvent)
          </label>
        </div>
        </div>
      </PaneLeft>
      <div className="tr-launch">
        <div className="col gap6">
          <b className="tr-launch-t">
            <span className="tr-fmt-badge">{cfg.fmt === "all" ? "3-way + HU" : FORMATS[cfg.fmt].short}</span> {useDepths.length ? useDepths.map((d) => fmtBB(d)).join(", ") + " bb" : "aucune profondeur"} · {cfg.tables} table{cfg.tables > 1 ? "s" : ""}
          </b>
          <span className="muted small">Raccourcis sur la table sous la souris · touches 1 à 9 = boutons dans l'ordre · Espace = main suivante après une erreur.</span>
          {last && last.n > 0 && (
            <span className="small">
              Dernière session : <b>{last.n}</b> mains · <b className={last.ok / last.n >= 0.8 ? "pos" : "neg"}>{num((last.ok / last.n) * 100, 0)} %</b> de bonnes réponses
            </span>
          )}
        </div>
        <div className="grow" />
        <Btn kind="primary" icon="play" disabled={!pool.length} onClick={() => setRunning(true)}>
          Lancer ({pool.length} spot{pool.length > 1 ? "s" : ""})
        </Btn>
      </div>
      <div className="col gap16">
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
      <PaneRight>
        <div className="side-card">
          <div className="row gap8">
            <div className="pane-title">Tes décisions en jeu</div>
            <Help text="Tes mains réelles comparées à tes ranges, décision par décision, à la profondeur de range la plus proche du tapis effectif. Chaque import est analysé automatiquement ; tu peux aussi analyser toute ta base." />
          </div>
          <Btn small icon="search" onClick={analyseAll} disabled={analysing || loaded === "no"}>
            {analysing ? "Analyse…" : "Analyser toute ma base"}
          </Btn>
          {!(progress.reviews ?? []).length ? (
            <div className="muted small">Aucune analyse pour l'instant : importe tes mains, ou analyse toute ta base.</div>
          ) : (
            <div className="tr-revs">
              {(progress.reviews ?? []).map((r, i) => (
                <div key={i} className="tr-rev">
                  <div className="row gap8">
                    <b className="tr-rev-l">{r.label}</b>
                    <div className="grow" />
                    <b className={r.ok / r.decisions >= 0.85 ? "pos" : "neg"}>{num((r.ok / Math.max(1, r.decisions)) * 100, 0)} %</b>
                  </div>
                  <span className="muted small">
                    {realDate(r.ts)} · {num(r.decisions)} décisions · {num(r.errors.length)} erreurs{r.evLoss > 0 ? ` · ${num(r.evLoss, 2)} bb perdus` : ""}
                  </span>
                  {r.errors.length > 0 && (
                    <button className="fchip" onClick={() => startReview(r.errors, `Review : ${r.label}`)}>
                      Rejouer les erreurs
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </PaneRight>
      {analysis && (
        <ReviewModal
          a={analysis}
          book={book}
          title="Tes décisions préflop sur toute ta base"
          onClose={() => setAnalysis(null)}
          onReplay={(errors) => {
            setAnalysis(null);
            startReview(errors, "Review : toute la base");
          }}
        />
      )}
      <TrainerStats
        index={index}
        progress={progress}
        onTrain={(spots, label) => {
          if (!spots.length) return;
          setCustom({ pool: spots, label });
          setRunning(true);
        }}
      />
    </div>
  );
}

function KeyEditor({ keys, onChange }: { keys: KeyMap; onChange: (k: KeyMap) => void }) {
  const [wait, setWait] = useState<KeyAction | null>(null);
  useEffect(() => {
    if (!wait) return;
    const set = (code: string) => {
      // une touche ne sert qu'à une action
      const next = { ...keys };
      for (const k of Object.keys(next) as KeyAction[]) if (next[k] === code) next[k] = "";
      next[wait] = code;
      onChange(next);
      setWait(null);
    };
    const key = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code === "Escape") {
        onChange({ ...keys, [wait]: "" });
        setWait(null);
      } else set(e.code);
    };
    const mouse = (e: MouseEvent) => {
      if (e.button === 0) return;
      e.preventDefault();
      e.stopPropagation();
      set(`Mouse${e.button}`);
    };
    const block = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", key, true);
    window.addEventListener("mouseup", mouse, true);
    window.addEventListener("contextmenu", block, true);
    window.addEventListener("auxclick", block, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("mouseup", mouse, true);
      window.removeEventListener("contextmenu", block, true);
      window.removeEventListener("auxclick", block, true);
    };
  }, [wait, keys]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="tr-keyed">
      {(Object.keys(KEY_LABELS) as KeyAction[]).map((k) => (
        <div key={k} className="tr-keyrow">
          <span className={cls("tr-keylbl", k)}>{KEY_LABELS[k]}</span>
          <button className={cls("tr-keybox", wait === k && "wait")} onMouseDown={(e) => e.button === 0 && setWait(wait === k ? null : k)}>
            {wait === k ? "Appuie…" : keyName(keys[k])}
          </button>
        </div>
      ))}
      <button className="fchip" onClick={() => onChange(DEFAULT_KEYS)}>
        Réglage Jurojin
      </button>
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

// ---------------------------------------------------------------- raccourcis

/** Raccourcis façon Jurojin : une touche (code clavier) ou un bouton de souris par action. */
export type KeyAction = "fold" | "call" | "raise" | "allin";
export type KeyMap = Record<KeyAction, string>;

/** Réglage de Laszlo dans Jurojin : clic droit = se coucher/vérifier, XButton1 = tapis,
 * XButton2 = miser/relancer, pas de raccourci pour payer. */
export const DEFAULT_KEYS: KeyMap = { fold: "Mouse2", call: "", raise: "Mouse4", allin: "Mouse3" };

export const KEY_LABELS: Record<KeyAction, string> = { fold: "Se coucher / Vérifier", call: "Payer", raise: "Miser / Relancer", allin: "All-in" };

export function keyName(k: string): string {
  if (!k) return "Aucun";
  const mouse: Record<string, string> = { Mouse1: "Clic molette", Mouse2: "Clic droit", Mouse3: "XButton1", Mouse4: "XButton2" };
  if (mouse[k]) return mouse[k];
  if (k.startsWith("Key")) return k.slice(3);
  if (k.startsWith("Digit")) return k.slice(5);
  if (k.startsWith("Numpad")) return `Pavé ${k.slice(6)}`;
  const named: Record<string, string> = { Space: "Espace", Enter: "Entrée", ShiftLeft: "Maj", ShiftRight: "Maj droite", ControlLeft: "Ctrl", AltLeft: "Alt", Tab: "Tab" };
  return named[k] ?? k;
}

/** Action du spot déclenchée par un raccourci (comme sur une table : se coucher devient
 * vérifier quand on peut checker, relancer devient tapis quand seul le tapis reste). */
function actionFor(acts: Act[], what: KeyAction): number {
  const find = (...kinds: string[]) => {
    for (const k of kinds) {
      const i = acts.findIndex((a) => a.kind === k);
      if (i >= 0) return i;
    }
    return -1;
  };
  if (what === "fold") return find("fold", "check");
  if (what === "call") return find("call", "check");
  if (what === "raise") return find("raise", "allin");
  return find("allin");
}

// ---------------------------------------------------------------- session

/** Limites d'allongement du feutre (largeur / hauteur) : en deçà ou au-delà la table
 * paraîtrait écrasée ou étirée ; entre les deux, elle remplit toute sa case. */
const FELT_MIN = 1.45;
const FELT_MAX = 2.5;

/** Taille de police d'une table (tout le décor est en em) et hauteur du bandeau + boutons. */
const fontFor = (w: number, h: number) => Math.max(6, Math.min(20, Math.min(w / 42, h / 21)));
const chromeFor = (fs: number) => fs * 4.3 + 22;

/** Découpage de la zone en cases pour `n` tables : on garde celui qui laisse les plus
 * grandes tables, chaque table remplissant sa case dans les limites d'allongement. */
function fit(n: number, W: number, H: number, gap = 10): { cols: number; w: number; h: number } {
  let best = { cols: 1, w: 0, h: 0, area: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (W - (cols - 1) * gap) / cols;
    const ch = (H - (rows - 1) * gap) / rows;
    const chrome = chromeFor(fontFor(cw, ch));
    let w = cw;
    let felt = ch - chrome;
    if (felt <= 40) continue;
    if (w / felt > FELT_MAX) w = felt * FELT_MAX;
    if (w / felt < FELT_MIN) felt = w / FELT_MIN;
    const area = w * (felt + chrome);
    if (area > best.area * 1.01) best = { cols, w, h: felt + chrome, area };
  }
  return { cols: best.cols, w: Math.floor(best.w), h: Math.floor(best.h) };
}

function Session({
  canSave,
  pool,
  label,
  queue,
  cfg,
  progress,
  setProgress,
  onStop,
}: {
  canSave: boolean;
  pool: PoolSpot[];
  label?: string;
  queue?: QItem[];
  cfg: Cfg;
  progress: Progress;
  setProgress: (p: Progress) => void;
  onStop: (s: { n: number; ok: number }) => void;
}) {
  const qi = useRef(0);
  const fromQueue = (): Deal | null => {
    const q = queue?.[qi.current++];
    return q ? { n: ++dealNo, ps: q.ps, cell: q.cell, cards: q.cards, note: q.note } : null;
  };
  const [deals, setDeals] = useState<(Deal | null)[]>(() =>
    queue ? [fromQueue()] : Array.from({ length: cfg.tables }, () => newDeal(pool, cfg.fewerTrivial, cfg.realistic)),
  );
  const [score, setScore] = useState({ n: 0, ok: 0, streak: 0, best: 0 });
  const prog = useRef(progress);
  const saveT = useRef<number | undefined>(undefined);
  const timers = useRef<number[]>([]);
  const hovered = useRef(0);
  const dealsRef = useRef(deals);
  dealsRef.current = deals;
  const keys: KeyMap = { ...DEFAULT_KEYS, ...(cfg.keys ?? {}) };
  const keysRef = useRef(keys);
  keysRef.current = keys;

  // toutes les tables à l'écran, sans défilement
  const area = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const measure = () => {
      const el = area.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // bas du panneau central (moins sa marge intérieure) : les tables tiennent sans défiler
      const sc = el.closest(".pane-scroll") as HTMLElement | null;
      const bottom = sc ? sc.getBoundingClientRect().bottom - parseFloat(getComputedStyle(sc).paddingBottom || "0") : window.innerHeight - 14;
      setBox({ w: r.width, h: Math.max(200, bottom - r.top - 2) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (area.current) {
      ro.observe(area.current);
      const sc = area.current.closest(".pane-scroll");
      if (sc) ro.observe(sc);
    }
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const { cols, w, h } = fit(cfg.tables, box.w, box.h);

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(saveT.current);
      (canSave ? rangesApi.trainerSave(JSON.stringify(prog.current)) : Promise.resolve()).catch(() => {});
    },
    [],
  );

  const next = (t: number) => {
    const nd = queue ? fromQueue() : null;
    setDeals((ds) => ds.map((d, i) => (i === t ? (queue ? nd : newDeal(pool, cfg.fewerTrivial, cfg.realistic)) : d)));
  };
  const reviewDone = !!queue && deals.every((d) => d == null);

  const answer = (t: number, choice: number) => {
    const d = dealsRef.current[t];
    if (!d || d.result || choice < 0) return;
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
    const day = localDay();
    const sp = p.spots[d.ps.id] ?? { n: 0, ok: 0, last: 0 };
    const dy = p.days[day] ?? { n: 0, ok: 0 };
    prog.current = {
      ...p,
      spots: { ...p.spots, [d.ps.id]: { n: sp.n + 1, ok: sp.ok + (ok ? 1 : 0), last: Math.floor(Date.now() / 1000) } },
      days: { ...p.days, [day]: { n: dy.n + 1, ok: dy.ok + (ok ? 1 : 0) } },
      daySpots: (() => {
        const ds = { ...(p.daySpots ?? {}) };
        const today = { ...(ds[day] ?? {}) };
        const [n0, ok0] = today[d.ps.id] ?? [0, 0];
        today[d.ps.id] = [n0 + 1, ok0 + (ok ? 1 : 0)];
        ds[day] = today;
        return ds;
      })(),
    };
    setProgress(prog.current);
    window.clearTimeout(saveT.current);
    saveT.current = window.setTimeout(() => (canSave ? rangesApi.trainerSave(JSON.stringify(prog.current)) : Promise.resolve()).catch(() => {}), 1500);
    if (ok) timers.current.push(window.setTimeout(() => next(t), 650));
    else if (!cfg.waitClick) timers.current.push(window.setTimeout(() => next(t), cfg.showMs));
  };

  /** Raccourci reçu (touche ou bouton de souris) sur la table `t`. */
  const shortcut = (t: number, code: string): boolean => {
    const d = dealsRef.current[t];
    if (!d) return false;
    const what = (Object.keys(keysRef.current) as KeyAction[]).find((k) => keysRef.current[k] === code);
    if (!what) return false;
    if (d.result) {
      if (!d.result.ok && cfg.waitClick) next(t);
      return true;
    }
    answer(t, actionFor(d.ps.spot.acts, what));
    return true;
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const t = dealsRef.current.length === 1 ? 0 : hovered.current;
      const d = dealsRef.current[t];
      if (!d) return;
      if (shortcut(t, e.code)) return e.preventDefault();
      if (e.key === " " || e.key === "Enter") {
        if (d.result) {
          e.preventDefault();
          next(t);
        }
        return;
      }
      if (e.key >= "1" && e.key <= "9" && +e.key <= d.ps.spot.acts.length) {
        e.preventDefault();
        answer(t, +e.key - 1);
      }
    };
    // boutons de souris : clic droit, molette, XButton1 / XButton2 (sans retour arrière du navigateur)
    const mouse = (e: MouseEvent) => {
      if (e.button === 0) return;
      const el = (e.target as HTMLElement | null)?.closest?.("[data-table]");
      if (!el) return;
      e.preventDefault();
      if (e.type === "mouseup") shortcut(+el.getAttribute("data-table")!, `Mouse${e.button}`);
    };
    const block = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("[data-table]")) e.preventDefault();
    };
    window.addEventListener("keydown", k);
    window.addEventListener("mousedown", mouse, true);
    window.addEventListener("mouseup", mouse, true);
    window.addEventListener("auxclick", block, true);
    window.addEventListener("contextmenu", block, true);
    return () => {
      window.removeEventListener("keydown", k);
      window.removeEventListener("mousedown", mouse, true);
      window.removeEventListener("mouseup", mouse, true);
      window.removeEventListener("auxclick", block, true);
      window.removeEventListener("contextmenu", block, true);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = score.n ? score.ok / score.n : 0;
  return (
    <div className="col gap8 tr-session">
      <PaneRight>
        <div className="pane-title">Session</div>
        <div className="tr-score">
          <div className="wg-big">
            <span>Mains</span>
            <b>{score.n}</b>
          </div>
          <div className="wg-big">
            <span>Justes</span>
            <b className={score.n ? (pct >= 0.8 ? "pos" : "neg") : ""}>{score.n ? `${num(pct * 100, 0)} %` : "–"}</b>
          </div>
          <div className="wg-big">
            <span>Série</span>
            <b>{score.streak}</b>
            <small>record {score.best}</small>
          </div>
        </div>
        {score.n > 0 && (
          <div className="wg-bar">
            <i style={{ width: `${pct * 100}%`, background: pct >= 0.8 ? "var(--pos)" : "var(--neg)" }} />
          </div>
        )}
        {label && (
          <div className="side-card">
            <span className="muted small">Entraînement ciblé</span>
            <b>{label}</b>
            <span className="muted small">{pool.length} spots</span>
          </div>
        )}
        <div className="side-card">
          <div className="pane-title">Raccourcis</div>
          <div className="side-kv">
            {(Object.keys(KEY_LABELS) as KeyAction[])
              .filter((k) => keys[k])
              .map((k) => (
                <Fragment key={k}>
                  <span>{KEY_LABELS[k]}</span>
                  <b>
                    <kbd>{keyName(keys[k])}</kbd>
                  </b>
                </Fragment>
              ))}
          </div>
          <span className="muted small">Touches 1 à 9 = boutons dans l'ordre · Espace = main suivante.</span>
        </div>
        <Btn icon="x" onClick={() => onStop({ n: score.n, ok: score.ok })}>
          Terminer la session
        </Btn>
      </PaneRight>
      {reviewDone && (
        <div className="tr-done">
          <b>Review terminée</b>
          <span>
            {num(score.ok)} bonne{score.ok > 1 ? "s" : ""} réponse{score.ok > 1 ? "s" : ""} sur {num(score.n)} · {score.n ? `${num((score.ok / score.n) * 100, 0)} %` : ""}
          </span>
          <Btn kind="primary" onClick={() => onStop({ n: score.n, ok: score.ok })}>
            Terminer
          </Btn>
        </div>
      )}
      <div ref={area} className="tr-area" style={{ height: reviewDone ? 0 : box.h }}>
        <div className="tr-tables" style={{ gridTemplateColumns: `repeat(${cols}, ${w}px)` }}>
          {deals.map((d, t) => (
            <div key={t} data-table={t} onMouseEnter={() => (hovered.current = t)}>
              {d ? (
                <Table deal={d} cfg={cfg} width={w} height={h} onAnswer={(i) => answer(t, i)} onNext={() => next(t)} />
              ) : (
                <div className="pk pk-empty" style={{ width: w, height: h }}>
                  Aucune main disponible
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- table

/** Couleurs des jetons : corps, bord (face latérale) et inserts du pourtour. */
const CHIP: Record<string, { body: string; side: string; ins: string; core: string }> = {
  c05: { body: "#f1f4f8", side: "#c3cad4", ins: "#2f6fd6", core: "#dfe6ef" },
  c1: { body: "#d6322b", side: "#9c1d18", ins: "#ffffff", core: "#bf2923" },
  c5: { body: "#1f9a54", side: "#12693a", ins: "#ffffff", core: "#18864a" },
  c25: { body: "#24272e", side: "#101216", ins: "#f2c94c", core: "#30343d" },
};

/** Pile de jetons vue de trois quarts : chaque jeton a sa tranche (épaisseur) et le dessus
 * avec les inserts du pourtour, l'anneau central et un reflet. */
function ChipPile({ kinds }: { kinds: string[] }) {
  const rx = 18;
  const ry = 8.2;
  const t = 5.6; // épaisseur d'un jeton
  const n = kinds.length;
  const H = ry * 2 + t + (n - 1) * t + 1;
  const cx = 20;
  return (
    <svg className="pk-pile" viewBox={`0 0 40 ${H}`} style={{ height: `${(H / 40) * 2.7}em` }}>
      {kinds.map((k, i) => {
        const c = CHIP[k];
        const cy = H - ry - t - 0.5 - i * t; // centre du dessus du jeton i (0 = en bas)
        const side = `M${cx - rx},${cy} A${rx},${ry} 0 0 0 ${cx + rx},${cy} L${cx + rx},${cy + t} A${rx},${ry} 0 0 1 ${cx - rx},${cy + t} Z`;
        const edge = `M${cx - rx},${cy + t / 2} A${rx},${ry} 0 0 0 ${cx + rx},${cy + t / 2}`;
        return (
          <g key={i}>
            <path d={side} fill={c.side} />
            <path d={edge} fill="none" stroke={c.ins} strokeWidth={t * 0.62} strokeDasharray="4.2 5.6" opacity={0.9} />
            <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={c.body} />
            <ellipse cx={cx} cy={cy} rx={rx - 2.1} ry={ry - 1} fill="none" stroke={c.ins} strokeWidth={2.4} strokeDasharray="4.6 5.2" />
            <ellipse cx={cx} cy={cy} rx={rx * 0.58} ry={ry * 0.58} fill={c.core} stroke={c.ins} strokeWidth={0.7} strokeDasharray="1.4 1.3" />
            <ellipse cx={cx - 4} cy={cy - 2.4} rx={rx * 0.5} ry={ry * 0.32} fill="#fff" opacity={0.13} />
          </g>
        );
      })}
    </svg>
  );
}

/** Mise en jetons (25, 5, 1 et ½ bb), une pile par valeur, montant écrit dessous. */
function Chips({ bb, className }: { bb: number; className?: string }) {
  const den: [number, string][] = [
    [25, "c25"],
    [5, "c5"],
    [1, "c1"],
    [0.5, "c05"],
  ];
  let rest = Math.round(bb * 2) / 2;
  const piles: string[][] = [];
  for (const [v, c] of den) {
    const k = Math.floor(rest / v + 1e-9);
    rest -= k * v;
    if (k > 0) piles.push(Array(Math.min(k, 10)).fill(c));
  }
  return (
    <div className={cls("pk-chips", className)}>
      <div className="pk-piles">
        {piles.map((p, i) => (
          <ChipPile key={i} kinds={p} />
        ))}
      </div>
      <span className="pk-amt">{fmtBB(bb)} bb</span>
    </div>
  );
}

const SUIT: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

function TCard({ card }: { card?: string }) {
  if (!card) return <span className="pk-card back" />;
  return (
    <span className={cls("pk-card", `s-${card[1]}`)}>
      <b>{card[0] === "T" ? "10" : card[0]}</b>
      <i>{SUIT[card[1]]}</i>
    </span>
  );
}

// positions relatives au héros (en bas) : siège, mise et bouton dealer, en % du feutre
const LAYOUT3 = [
  { seat: [50, 85], bet: [50, 55], btn: [63, 60] },
  { seat: [13, 30], bet: [30, 45], btn: [22, 47] },
  { seat: [87, 30], bet: [70, 45], btn: [78, 47] },
];
const LAYOUT2 = [
  { seat: [50, 85], bet: [50, 58], btn: [63, 62] },
  { seat: [50, 17], bet: [50, 34], btn: [63, 30] },
];
/** position du pot (au-dessus de la mise du héros, sous les adversaires) */
const POT3 = [50, 37];
const POT2 = [50, 46];

function Table({ deal, cfg, width, height, onAnswer, onNext }: { deal: Deal; cfg: Cfg; width: number; height: number; onAnswer: (i: number) => void; onNext: () => void }) {
  const { ps, cards, cell, result } = deal;
  const sp = ps.spot;
  const fmt = sp.state.fmt;
  const pos = FORMATS[fmt].pos;
  const n = pos.length;
  const hero = sp.state.toAct;
  const colors = actColors(sp.acts);
  const r = replay(fmt, ps.depth, ps.sizes, sp.state.history);
  const lastAct: (string | null)[] = Array(n).fill(null);
  if (r)
    sp.state.history.forEach((id, k) => {
      const who = r.states[k].toAct;
      lastAct[who] = r.acts[k].find((a) => a.id === id)?.label ?? id;
    });
  const pot = potOf(sp.state, ps.sizes);
  // EV de la main (ranges qui la donnent) et EV perdue par l'action choisie
  const handEv = ps.ev?.[cellName(cell)];
  const evLost = (() => {
    if (!handEv || !result) return null;
    const played = sp.acts.map((_, i) => handEv[i + 1]).filter((x, i) => x != null && Number.isFinite(x) && ps.strat[cell][i] > 0.004);
    const mine = handEv[result.choice + 1];
    if (!played.length || mine == null || !Number.isFinite(mine)) return null;
    return Math.max(0, Math.max(...played) - mine);
  })();
  const layout = n === 3 ? LAYOUT3 : LAYOUT2;
  const dealer = pos.indexOf(n === 3 ? "BTN" : "SB");
  const at = (xy: number[]) => ({ left: `${xy[0]}%`, top: `${xy[1]}%` });
  // tout le décor est en em : il suit la taille de la table
  const fs = fontFor(width, height);
  return (
    <div className={cls("pk", result && (result.ok ? "ok" : "ko"))} style={{ width, height, fontSize: fs }}>
      <div className="pk-spot">
        {ps.label}
        {deal.note && <span className="pk-note"> · {deal.note}</span>}
      </div>
      <div className="pk-felt">
        <div className="pk-rail">
          <div className="pk-cloth">
            <img className="pk-logo" src="/logo.png" alt="" />
          </div>
        </div>
        <div className="pk-pot" style={at(n === 3 ? POT3 : POT2)}>
          <span className="pk-pot-l">Pot {fmtBB(pot)} bb</span>
        </div>
        {pos.map((p, i) => {
          const rel = (i - hero + n) % n;
          const L = layout[rel];
          const put = sp.state.put[i];
          const folded = sp.state.folded[i];
          const me = i === hero;
          return (
            <div key={p}>
              {put > 0 && (
                <div className={cls("pk-at", folded && "gone")} style={at(L.bet)}>
                  <Chips bb={put} />
                </div>
              )}
              {i === dealer && (
                <div className="pk-at" style={at(L.btn)}>
                  <span className="pk-dealer">D</span>
                </div>
              )}
              <div className={cls("pk-seat", me && "me", folded && "folded")} style={at(L.seat)}>
                {me ? (
                  <div className="pk-hand">
                    <TCard card={cards[0]} />
                    <TCard card={cards[1]} />
                  </div>
                ) : (
                  !folded && (
                    <div className="pk-hand small">
                      <TCard />
                      <TCard />
                    </div>
                  )
                )}
                <div className="pk-plate">
                  <b>{p}</b>
                  <span>{fmtBB(ps.depth - put)} bb</span>
                </div>
                {!me && lastAct[i] && <div className={cls("pk-act", folded ? "fold" : /allin/i.test(lastAct[i]!) ? "ai" : /raise/i.test(lastAct[i]!) ? "raise" : "call")}>{lastAct[i]}</div>}
              </div>
            </div>
          );
        })}
        {result?.ok && (
          <div className="pk-flash">
            ✓ {sp.acts[result.choice].label}
            {result.freq < result.best - 1e-9 && <small> (mixte {num(result.freq * 100, 0)} %)</small>}
          </div>
        )}
      </div>
      <div className="pk-actions">
        {sp.acts.map((a, i) => (
          <button
            key={a.id}
            className={cls("pk-btn", result && result.choice === i && (result.ok ? "good" : "bad"))}
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
        <div className="pk-review">
          <div className="pk-review-h">
            <b>{cellName(cell)}</b> · tu as joué <span className="neg">{sp.acts[result.choice].label}</span> ({num(result.freq * 100, 0)} %)
          </div>
          <div className="pk-review-s">
            {sp.acts.map((a, i) =>
              ps.strat[cell][i] > 0.004 ? (
                <span key={a.id}>
                  <i className="gw-dot" style={{ background: colors[i] }} />
                  {a.label} {num(ps.strat[cell][i] * 100, 0)} %
                  {handEv?.[i + 1] != null && <span className="pk-ev"> · EV {num(handEv[i + 1], 2)}</span>}
                </span>
              ) : null,
            )}
          </div>
          {evLost != null && evLost > 0.0005 && <div className="pk-evloss">Ta décision coûte {num(evLost, 2)} bb d'EV par rapport à la meilleure action</div>}
          <div className="gw pk-grid">
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
            <div className="pk-timer" style={{ animationDuration: `${cfg.showMs}ms` }} />
          )}
        </div>
      )}
    </div>
  );
}
