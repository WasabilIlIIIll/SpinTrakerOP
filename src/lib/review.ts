// Analyse des mains jouées : chaque décision préflop du héros est replacée dans l'arbre des
// ranges (profondeur la plus proche) et comparée à la stratégie du spot.

import { invoke } from "@tauri-apps/api/core";
import { FORMATS, actions, apply, findBook, nodeKey, rootState, strategy, type Act, type DepthBook, type Fmt, type RangeBook, type Spot } from "./ranges";
import { RANKS } from "./solver";

/** Ligne préflop d'une main (commande `preflop_lines`). */
export interface Line {
  id: string;
  tid: string;
  ts: number;
  n: number;
  /** position du héros dans l'ordre de l'arbre (3 joueurs : BTN, SB, BB ; HU : SB, BB) */
  hero: number;
  /** tapis de départ en bb, par position */
  stacks: number[];
  cards: [string, string] | null;
  /** [position, F|X|C|R, total misé au préflop en bb, à tapis] */
  acts: [number, string, number, boolean][];
}

export const linesApi = {
  get: (ids?: string[]) => invoke<Line[]>("preflop_lines", { ids: ids ?? null }),
};

export interface Decision {
  handId: string;
  ts: number;
  fmt: Fmt;
  depth: number;
  /** tapis effectif réel (bb) */
  eff: number;
  key: string;
  hero: string;
  cell: number;
  cards: [string, string];
  choice: string;
  choiceLabel: string;
  freq: number;
  best: string;
  bestLabel: string;
  ok: boolean;
  /** EV perdue en bb (meilleure action − action jouée), si le fichier donne l'EV */
  evLoss: number | null;
}

export interface Analysis {
  hands: number;
  decisions: Decision[];
  /** mains dont le coup sort de l'arbre (action absente des ranges, ex. un limp non prévu) */
  outOfTree: number;
  /** décisions à un spot sans range renseignée */
  noRange: number;
}

/** Case de la grille pour deux cartes (« As », « Kd »). */
export function cellOf(cards: [string, string]): number {
  const r1 = RANKS.indexOf(cards[0][0]);
  const r2 = RANKS.indexOf(cards[1][0]);
  const hi = Math.min(r1, r2);
  const lo = Math.max(r1, r2);
  if (hi === lo) return hi * 13 + hi;
  return cards[0][1] === cards[1][1] ? hi * 13 + lo : lo * 13 + hi;
}

/** Profondeur des ranges la plus proche du tapis effectif (à égalité, la plus profonde). */
export function nearestDepth(depths: number[], eff: number): number | null {
  if (!depths.length) return null;
  return depths.reduce((b, d) => (Math.abs(d - eff) < Math.abs(b - eff) - 1e-9 || (Math.abs(Math.abs(d - eff) - Math.abs(b - eff)) < 1e-9 && d > b) ? d : b));
}

/** Action de l'arbre correspondant à une action réelle. */
function matchAct(acts: Act[], kind: string, to: number, allin: boolean, depth: number): Act | undefined {
  if (kind === "F") return acts.find((a) => a.kind === "fold");
  if (kind === "X") return acts.find((a) => a.kind === "check");
  if (kind === "C") return acts.find((a) => a.kind === "call") ?? acts.find((a) => a.kind === "check");
  // relance : tapis si le joueur y est ou s'il relance au-delà de 60 % du tapis de l'arbre,
  // sinon la taille de relance la plus proche
  const raises = acts.filter((a) => a.kind === "raise");
  const ai = acts.find((a) => a.kind === "allin");
  if (allin || to >= depth * 0.6 || !raises.length) return ai ?? raises[raises.length - 1];
  return raises.reduce((b, a) => (Math.abs(a.to - to) < Math.abs(b.to - to) ? a : b));
}

export function analyze(lines: Line[], book: RangeBook, threshold = 0.1): Analysis {
  const res: Analysis = { hands: 0, decisions: [], outOfTree: 0, noRange: 0 };
  const depthsOf: Record<Fmt, number[]> = {
    spin3: book.books.filter((b) => b.fmt === "spin3").map((b) => b.depth),
    hu: book.books.filter((b) => b.fmt === "hu").map((b) => b.depth),
  };
  for (const ln of lines) {
    if (!ln.cards) continue;
    const fmt: Fmt = ln.n === 3 ? "spin3" : "hu";
    // tapis effectif du héros : le sien, plafonné par le plus gros tapis adverse
    const others = ln.stacks.filter((_, i) => i !== ln.hero);
    const eff = Math.min(ln.stacks[ln.hero], Math.max(...others));
    const depth = nearestDepth(depthsOf[fmt], eff);
    if (depth == null) continue;
    const db = findBook(book, fmt, depth) as DepthBook;
    res.hands++;
    let s = rootState(fmt, depth);
    let out = false;
    for (const [p, kind, to, allin] of ln.acts) {
      if (s.terminal) break;
      if (p !== s.toAct) {
        out = true;
        break;
      }
      const acts = actions(s, db.sizes);
      const a = matchAct(acts, kind, to, allin, depth);
      if (!a) {
        out = true;
        break;
      }
      if (p === ln.hero) {
        const sp: Spot = { key: nodeKey(s), state: s, acts, hero: FORMATS[fmt].pos[p] };
        const st = strategy(db, sp);
        if (!st) res.noRange++;
        else {
          const cell = cellOf(ln.cards);
          const row = st[cell];
          const i = acts.indexOf(a);
          const bi = row.indexOf(Math.max(...row));
          const ev = db.ev?.[sp.key]?.[cellName(cell)];
          const evA = ev ? ev[i + 1] : null;
          const evBest = ev ? Math.max(...ev.slice(1).filter((x, k) => x != null && !Number.isNaN(x) && row[k] > 0.004)) : null;
          res.decisions.push({
            handId: ln.id,
            ts: ln.ts,
            fmt,
            depth,
            eff: Math.round(eff * 10) / 10,
            key: sp.key,
            hero: sp.hero,
            cell,
            cards: ln.cards,
            choice: a.id,
            choiceLabel: a.label,
            freq: row[i],
            best: acts[bi].id,
            bestLabel: acts[bi].label,
            ok: row[i] >= threshold - 1e-9 || row[i] >= row[bi] - 1e-9,
            evLoss: evA != null && evBest != null && Number.isFinite(evA) && Number.isFinite(evBest) ? Math.max(0, evBest - evA) : null,
          });
        }
      }
      s = apply(s, a);
    }
    if (out) res.outOfTree++;
  }
  return res;
}

function cellName(c: number): string {
  const i = Math.floor(c / 13);
  const j = c % 13;
  if (i === j) return RANKS[i] + RANKS[i];
  return i < j ? `${RANKS[i]}${RANKS[j]}s` : `${RANKS[j]}${RANKS[i]}o`;
}

// ---------------------------------------------------------------- review en attente

/** Erreurs à rejouer, transmises de l'import (ou du suivi) à l'onglet Ranges. */
export const pendingReview: { items: Decision[] | null; label: string } = { items: null, label: "" };

// ---------------------------------------------------------------- libellés et historique

/** « 22 bb · BTN Raise 2 · SB ? » pour une décision. */
export function decisionLabel(d: Decision, book: RangeBook): string {
  const db = findBook(book, d.fmt, d.depth);
  if (!db) return d.key;
  let s = rootState(d.fmt, d.depth);
  const parts: string[] = [];
  for (const id of d.key ? d.key.split("-") : []) {
    const a = actions(s, db.sizes).find((x) => x.id === id);
    if (!a) break;
    parts.push(`${FORMATS[d.fmt].pos[s.toAct]} ${a.label}`);
    s = apply(s, a);
  }
  const pre = d.fmt === "hu" ? "HU " : "";
  return `${pre}${d.depth} bb · ${parts.length ? parts.join(" · ") + " · " : ""}${d.hero} ?`;
}

export interface ReviewEntry {
  ts: number;
  label: string;
  decisions: number;
  ok: number;
  evLoss: number;
  errors: Decision[];
}

/** Ajoute une analyse à l'historique du trainer (trainer.json), 20 dernières gardées. */
export async function saveReview(e: ReviewEntry, load: () => Promise<string | null>, save: (j: string) => Promise<void>) {
  const cur = JSON.parse((await load()) ?? "{}") as { reviews?: ReviewEntry[] };
  const reviews = [e, ...(cur.reviews ?? [])].slice(0, 20);
  await save(JSON.stringify({ version: 1, spots: {}, days: {}, ...cur, reviews }));
}
