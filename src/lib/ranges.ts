// Ranges préflop personnelles : arbre d'actions (Spin 3-max / tête-à-tête, tapis symétriques),
// stockage des ranges par spot, et outils du trainer.
//
// Une range de spot = pour chaque action explicite, une range texte pondérée (`AA,AKs:0.5,22+`).
// L'action « implicite » (fold, ou check/call quand le fold n'existe pas) reçoit le reste.

import { invoke } from "@tauri-apps/api/core";
import { RANKS, cellCombos, cellName, gridToString, stringToGrid, type Grid } from "./solver";

export type Fmt = "spin3" | "hu";

export const FORMATS: Record<Fmt, { label: string; short: string; pos: string[] }> = {
  spin3: { label: "Spin & Go 3-max", short: "Spin", pos: ["BTN", "SB", "BB"] },
  hu: { label: "Tête-à-tête (HU)", short: "HU", pos: ["SB", "BB"] },
};

/** Tailles de l'arbre (en bb, « relance à »). */
export interface TreeSizes {
  /** relance d'ouverture par position (pot non relancé) */
  open: Record<string, number>;
  /** positions autorisées à limper quand personne n'a relancé */
  limp: Record<string, boolean>;
  /** relance contre un ou des limpers : relance à `iso` bb (+1 bb par limper supplémentaire) */
  iso: number;
  /** 3-bet : `threeBet` × la relance (+1 relance par joueur qui a payé entre-temps) */
  threeBet: number;
  /** au-delà de cette fraction du tapis, seule la relance à tapis est proposée */
  maxRaiseFrac: number;
  /** nombre de relances non-tapis autorisées (au-delà : tapis seulement) */
  maxRaises: number;
  /** arbre importé : actions de chaque spot (prioritaires sur les tailles ci-dessus) */
  explicit?: Record<string, string[]>;
}

export function defaultSizes(fmt: Fmt): TreeSizes {
  return fmt === "spin3"
    ? { open: { BTN: 2, SB: 3 }, limp: { BTN: false, SB: true }, iso: 3, threeBet: 3, maxRaiseFrac: 0.5, maxRaises: 2 }
    : { open: { SB: 2 }, limp: { SB: true }, iso: 3, threeBet: 3, maxRaiseFrac: 0.5, maxRaises: 2 };
}

export type ActKind = "fold" | "check" | "call" | "raise" | "allin";

export interface Act {
  id: string;
  kind: ActKind;
  label: string;
  /** contribution totale du joueur après l'action (bb) */
  to: number;
}

export interface State {
  fmt: Fmt;
  depth: number;
  put: number[];
  folded: boolean[];
  allin: boolean[];
  acted: boolean[];
  toAct: number;
  raises: number;
  lastTo: number;
  /** joueurs ayant payé la dernière relance (pour le squeeze) */
  callers: number;
  history: string[];
  /** fin de l'action préflop */
  terminal: null | "fold" | "allin" | "flop";
}

const r1 = (x: number) => Math.round(x * 10) / 10;
export const fmtBB = (x: number) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : String(r1(x)));

export function rootState(fmt: Fmt, depth: number): State {
  const n = FORMATS[fmt].pos.length;
  const put = Array(n).fill(0);
  put[n - 2] = Math.min(0.5, depth);
  put[n - 1] = Math.min(1, depth);
  return {
    fmt,
    depth,
    put,
    folded: Array(n).fill(false),
    allin: put.map((p) => p >= depth),
    acted: Array(n).fill(false),
    toAct: 0,
    raises: 0,
    lastTo: 1,
    callers: 0,
    history: [],
    terminal: null,
  };
}

export const nodeKey = (s: State) => s.history.join("-");

/** Action d'après son identifiant (`F`, `X`, `C`, `R2.5`, `AI`), dans l'état courant. */
function actFromId(s: State, id: string): Act | null {
  const p = s.toAct;
  const max = Math.max(...s.put);
  const pos = FORMATS[s.fmt].pos[p];
  if (id === "F") return { id, kind: "fold", label: "Fold", to: s.put[p] };
  if (id === "X") return { id, kind: "check", label: "Check", to: s.put[p] };
  if (id === "C") {
    const limp = s.raises === 0 && Math.abs(max - 1) < 1e-9 && pos !== "BB";
    return { id, kind: "call", label: limp ? "Limp" : "Call", to: Math.min(s.depth, max) };
  }
  if (id === "AI") return { id, kind: "allin", label: `Allin ${fmtBB(s.depth)}`, to: s.depth };
  const m = /^R(\d+(?:\.\d+)?)$/.exec(id);
  if (m) return { id, kind: "raise", label: `Raise ${m[1]}`, to: +m[1] };
  return null;
}

/** Actions possibles pour le joueur à parler. */
export function actions(s: State, sizes: TreeSizes): Act[] {
  if (s.terminal) return [];
  const ex = sizes.explicit?.[nodeKey(s)];
  if (ex) return ex.map((id) => actFromId(s, id)).filter((a): a is Act => !!a);
  const p = s.toAct;
  const pos = FORMATS[s.fmt].pos[p];
  const max = Math.max(...s.put);
  const toCall = max - s.put[p];
  const out: Act[] = [];
  if (toCall > 1e-9) out.push({ id: "F", kind: "fold", label: "Fold", to: s.put[p] });
  const unraised = s.raises === 0;
  const limpers = s.put.filter((x, i) => i !== p && !s.folded[i] && Math.abs(x - 1) < 1e-9 && FORMATS[s.fmt].pos[i] !== "BB").length;
  if (toCall <= 1e-9) out.push({ id: "X", kind: "check", label: "Check", to: s.put[p] });
  else if (unraised && Math.abs(max - 1) < 1e-9 && pos !== "BB") {
    // pot non relancé : payer la BB = limper, seulement si la position y est autorisée
    if (sizes.limp[pos]) out.push({ id: "C", kind: "call", label: "Limp", to: Math.min(s.depth, max) });
  } else out.push({ id: "C", kind: "call", label: "Call", to: Math.min(s.depth, max) });
  // si payer met déjà à tapis, pas de relance possible
  if (max >= s.depth - 1e-9) return out;
  let raiseTo = 0;
  if (s.raises < sizes.maxRaises) {
    if (unraised) raiseTo = limpers > 0 ? sizes.iso + (limpers - 1) : sizes.open[pos] ?? sizes.iso;
    else raiseTo = sizes.threeBet * s.lastTo + s.callers * s.lastTo;
  }
  if (raiseTo > max + 1e-9 && raiseTo <= sizes.maxRaiseFrac * s.depth + 1e-9 && raiseTo < s.depth - 1e-9) {
    out.push({ id: `R${fmtBB(raiseTo)}`, kind: "raise", label: `Raise ${fmtBB(raiseTo)}`, to: raiseTo });
  }
  out.push({ id: "AI", kind: "allin", label: `Allin ${fmtBB(s.depth)}`, to: s.depth });
  return out;
}

export function apply(s: State, a: Act): State {
  const n = s.put.length;
  const t: State = { ...s, put: [...s.put], folded: [...s.folded], allin: [...s.allin], acted: [...s.acted], history: [...s.history, a.id] };
  const p = s.toAct;
  const max = Math.max(...s.put);
  if (a.kind === "fold") t.folded[p] = true;
  else if (a.kind === "call") {
    t.put[p] = a.to;
    t.callers = s.callers + 1;
  } else if (a.kind === "raise" || (a.kind === "allin" && a.to > max + 1e-9)) {
    t.put[p] = a.to;
    if (a.kind === "raise") t.raises = s.raises + 1;
    t.lastTo = a.to;
    t.callers = 0;
    t.acted = Array(n).fill(false);
  } else if (a.kind === "allin") t.put[p] = a.to;
  if (t.put[p] >= s.depth - 1e-9) t.allin[p] = true;
  t.acted[p] = true;

  const live = [...Array(n).keys()].filter((i) => !t.folded[i]);
  if (live.length === 1) return { ...t, terminal: "fold" };
  const newMax = Math.max(...t.put);
  for (let k = 1; k <= n; k++) {
    const i = (p + k) % n;
    if (t.folded[i] || t.allin[i]) continue;
    if (!t.acted[i] || t.put[i] < newMax - 1e-9) {
      // un seul joueur non à tapis qui a déjà égalisé n'a plus rien à décider
      return { ...t, toAct: i };
    }
  }
  return { ...t, terminal: live.some((i) => t.allin[i]) ? "allin" : "flop" };
}

/** Rejoue un historique d'identifiants d'actions. */
export function replay(fmt: Fmt, depth: number, sizes: TreeSizes, history: string[]): { states: State[]; acts: Act[][] } | null {
  let s = rootState(fmt, depth);
  const states = [s];
  const acts: Act[][] = [];
  for (const id of history) {
    const as = actions(s, sizes);
    const a = as.find((x) => x.id === id);
    if (!a) return null;
    acts.push(as);
    s = apply(s, a);
    states.push(s);
  }
  return { states, acts };
}

export interface Spot {
  key: string;
  state: State;
  acts: Act[];
  /** position qui décide */
  hero: string;
}

/** Tous les nœuds de décision de l'arbre. */
export function enumerate(fmt: Fmt, depth: number, sizes: TreeSizes): Spot[] {
  const out: Spot[] = [];
  const walk = (s: State) => {
    if (s.terminal || out.length > 2000) return;
    const as = actions(s, sizes);
    out.push({ key: nodeKey(s), state: s, acts: as, hero: FORMATS[fmt].pos[s.toAct] });
    for (const a of as) walk(apply(s, a));
  };
  walk(rootState(fmt, depth));
  return out;
}

/** Description lisible d'un spot : « BTN Raise 2 · SB ? ». */
export function spotLabel(sp: Spot, sizes: TreeSizes): string {
  const pos = FORMATS[sp.state.fmt].pos;
  const r = replay(sp.state.fmt, sp.state.depth, sizes, sp.state.history);
  if (!r) return sp.key;
  const parts = sp.state.history.map((id, k) => {
    const who = pos[r.states[k].toAct];
    const a = r.acts[k].find((x) => x.id === id)!;
    return `${who} ${a.label}`;
  });
  return parts.length ? `${parts.join(" · ")} · ${sp.hero} ?` : `${sp.hero} ouvre`;
}

// ---------------------------------------------------------------- livre de ranges

export interface DepthBook {
  fmt: Fmt;
  depth: number;
  sizes: TreeSizes;
  /** origine des ranges (fichier importé) */
  source?: string;
  /** mains qui atteignent chaque spot, quand le fichier importé les donne (sinon calculées
   * à partir des décisions précédentes du joueur) */
  reach?: Record<string, string>;
  /** fréquences globales de chaque action d'après le fichier importé (0-1) */
  freq?: Record<string, Record<string, number>>;
  /** clé de spot -> action -> range texte */
  nodes: Record<string, Record<string, string>>;
  updated: number;
}

export interface RangeBook {
  version: 1;
  books: DepthBook[];
}

export const emptyBook = (): RangeBook => ({ version: 1, books: [] });

export function findBook(b: RangeBook, fmt: Fmt, depth: number): DepthBook | undefined {
  return b.books.find((x) => x.fmt === fmt && Math.abs(x.depth - depth) < 1e-9);
}

/** Action qui reçoit le reste des fréquences. */
export function implicitIndex(acts: Act[]): number {
  const f = acts.findIndex((a) => a.kind === "fold");
  if (f >= 0) return f;
  const p = acts.findIndex((a) => a.kind === "check" || a.kind === "call");
  return p >= 0 ? p : 0;
}

/** Stratégie d'un spot : 169 × actions (somme 1), ou null si le spot n'est pas renseigné. */
export function strategy(book: DepthBook | undefined, sp: Spot): number[][] | null {
  const node = book?.nodes[sp.key];
  // un spot enregistré vide = 100 % action implicite (ex. fold)
  if (!node) return null;
  const imp = implicitIndex(sp.acts);
  const grids: (Grid | null)[] = sp.acts.map((a, i) => (i === imp ? null : node[a.id] ? stringToGrid(node[a.id]) : null));
  const out: number[][] = [];
  for (let c = 0; c < 169; c++) {
    const row = sp.acts.map((_, i) => (i === imp ? 0 : grids[i]?.[c] ?? 0));
    const sum = row.reduce((a, b) => a + b, 0);
    if (sum > 1) for (let i = 0; i < row.length; i++) row[i] /= sum;
    row[imp] = Math.max(0, 1 - Math.min(1, sum));
    out.push(row);
  }
  return out;
}

/** Enregistre une stratégie 169 × actions dans le livre (l'action implicite n'est pas stockée). */
export function storeStrategy(book: DepthBook, sp: Spot, strat: number[][]): DepthBook {
  const imp = implicitIndex(sp.acts);
  const node: Record<string, string> = {};
  sp.acts.forEach((a, i) => {
    if (i === imp) return;
    const g = strat.map((row) => Math.round(row[i] * 1000) / 1000);
    if (g.some((w) => w > 0)) node[a.id] = gridToString(g);
  });
  const nodes = { ...book.nodes, [sp.key]: node };
  return { ...book, nodes, updated: Math.floor(Date.now() / 1000) };
}

export function isDefined(book: DepthBook | undefined, key: string): boolean {
  return !!book && key in book.nodes;
}

/** Fréquence globale de chaque action (pondérée par les combos atteignant le spot). */
export function actionTotals(strat: number[][], reach: number[]): { freq: number[]; combos: number[]; total: number } {
  const n = strat[0]?.length ?? 0;
  const combos = Array(n).fill(0);
  let total = 0;
  for (let c = 0; c < 169; c++) {
    const w = reach[c] * cellCombos(c);
    total += w;
    for (let i = 0; i < n; i++) combos[i] += w * strat[c][i];
  }
  return { freq: combos.map((x) => (total > 0 ? x / total : 0)), combos, total };
}

/** Range du héros arrivant au spot : produit de ses fréquences aux décisions précédentes. */
export function heroReach(book: DepthBook | undefined, fmt: Fmt, depth: number, sizes: TreeSizes, history: string[]): number[] {
  const given = book?.reach?.[history.join("-")];
  if (given !== undefined) return stringToGrid(given) ?? Array(169).fill(0);
  const reach = Array(169).fill(1);
  const r = replay(fmt, depth, sizes, history);
  if (!r) return reach;
  const hero = r.states[r.states.length - 1].toAct;
  for (let k = 0; k < history.length; k++) {
    const s = r.states[k];
    if (s.toAct !== hero) continue;
    const sp: Spot = { key: nodeKey(s), state: s, acts: r.acts[k], hero: FORMATS[fmt].pos[hero] };
    const st = strategy(book, sp);
    if (!st) continue;
    const i = sp.acts.findIndex((a) => a.id === history[k]);
    for (let c = 0; c < 169; c++) reach[c] *= st[c][i];
  }
  return reach;
}

// ---------------------------------------------------------------- couleurs

export function actColors(acts: Act[]): string[] {
  const raises = acts.filter((a) => a.kind === "raise").length;
  let k = 0;
  return acts.map((a) => {
    if (a.kind === "fold") return "#3d6fb5";
    if (a.kind === "check" || a.kind === "call") return "#4caf62";
    if (a.kind === "allin") return "#7a1712";
    const reds = ["#e5483f", "#c7362e"];
    return reds[Math.min(reds.length - 1, raises > 1 ? k++ : 0)];
  });
}

// ---------------------------------------------------------------- cartes

const SUITS = "shdc";

/** Deux cartes réelles pour une case de la grille (couleurs tirées au hasard). */
export function dealCell(c: number): [string, string] {
  const i = Math.floor(c / 13);
  const j = c % 13;
  const s1 = Math.floor(Math.random() * 4);
  if (i === j) {
    let s2 = Math.floor(Math.random() * 3);
    if (s2 >= s1) s2++;
    return [RANKS[i] + SUITS[s1], RANKS[i] + SUITS[s2]];
  }
  const hi = Math.min(i, j);
  const lo = Math.max(i, j);
  if (i < j) return [RANKS[hi] + SUITS[s1], RANKS[lo] + SUITS[s1]];
  let s2 = Math.floor(Math.random() * 3);
  if (s2 >= s1) s2++;
  return [RANKS[hi] + SUITS[s1], RANKS[lo] + SUITS[s2]];
}

/** Tirage d'une case selon des poids par combo (`weight(c) × combos`). */
export function sampleCell(weight: (c: number) => number): number | null {
  let total = 0;
  const w: number[] = [];
  for (let c = 0; c < 169; c++) {
    const x = Math.max(0, weight(c)) * cellCombos(c);
    w.push(x);
    total += x;
  }
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (let c = 0; c < 169; c++) {
    r -= w[c];
    if (r <= 0) return c;
  }
  return 168;
}

export { cellName, cellCombos };

// ---------------------------------------------------------------- stockage

export const rangesApi = {
  load: () => invoke<string | null>("ranges_load"),
  save: (json: string) => invoke<void>("ranges_save", { json }),
  exportTo: (path: string) => invoke<void>("ranges_export", { path }),
  importFrom: (path: string) => invoke<string>("ranges_import", { path }),
  trainerLoad: () => invoke<string | null>("trainer_load"),
  trainerSave: (json: string) => invoke<void>("trainer_save", { json }),
};

/** Coup rejoué à une autre profondeur : même suite d'actions, une relance absente étant
 * remplacée par la relance la plus proche (ex. SB raise 2.5 à 25 bb -> raise 2 à 13 bb).
 * S'arrête avant une action impossible ou qui termine le coup. */
export function mapHistory(fmt: Fmt, depth: number, sizes: TreeSizes, h: string[]): string[] {
  let s = rootState(fmt, depth);
  const out: string[] = [];
  for (const id of h) {
    const as = actions(s, sizes);
    let a = as.find((x) => x.id === id);
    if (!a && id.startsWith("R")) {
      const want = parseFloat(id.slice(1));
      const rs = as.filter((x) => x.kind === "raise");
      if (rs.length) a = rs.reduce((b, x) => (Math.abs(x.to - want) < Math.abs(b.to - want) ? x : b));
    }
    if (!a) break;
    const t = apply(s, a);
    if (t.terminal) break;
    out.push(a.id);
    s = t;
  }
  return out;
}

/** Export de ranges « simplifiées » : `{ depths: { "25": { "ROOT": { hero, actions, hand_action } … } } }`,
 * une action par main. Converti en livre : l'arbre du fichier devient l'arbre du livre. */
export function fromSimpleExport(j: unknown): RangeBook | null {
  const d = (j as { depths?: Record<string, Record<string, { hero: string; actions: Record<string, unknown>; hand_action?: Record<string, string> }>> })?.depths;
  if (!d || typeof d !== "object") return null;
  const meta = j as { source?: string; note?: string };
  const norm = (id: string) => (id === "RAI" ? "AI" : id);
  const keyOf = (k: string) => (k === "ROOT" ? "" : k.split("-").map(norm).join("-"));
  const books: DepthBook[] = [];
  for (const [ds, nodes] of Object.entries(d)) {
    const depth = parseFloat(ds);
    if (!(depth > 0)) continue;
    const fmt: Fmt = Object.values(nodes).some((n) => n.hero === "BTN") ? "spin3" : "hu";
    const explicit: Record<string, string[]> = {};
    for (const [k, n] of Object.entries(nodes)) explicit[keyOf(k)] = Object.keys(n.actions ?? {}).map(norm);
    const out: Record<string, Record<string, string>> = {};
    const reach: Record<string, string> = {};
    const freq: Record<string, Record<string, number>> = {};
    for (const [k, n] of Object.entries(nodes)) {
      const key = keyOf(k);
      reach[key] = Object.keys(n.hand_action ?? {}).join(",");
      freq[key] = Object.fromEntries(
        Object.entries(n.actions ?? {}).map(([id, a]) => [norm(id), Math.max(0, Number((a as { freq_pct?: number }).freq_pct ?? 0)) / 100]),
      );
      const acts = explicit[key];
      // action implicite (reste) : fold, sinon check / call
      const imp = acts.includes("F") ? "F" : acts.find((a) => a === "X" || a === "C") ?? acts[0];
      const lists: Record<string, string[]> = {};
      for (const [hand, a] of Object.entries(n.hand_action ?? {})) {
        const id = norm(a);
        if (id !== imp) (lists[id] ??= []).push(hand);
      }
      out[key] = Object.fromEntries(Object.entries(lists).map(([id, hs]) => [id, hs.join(",")]));
    }
    books.push({
      fmt,
      depth,
      sizes: { ...defaultSizes(fmt), explicit },
      source: [meta.source?.trim().replace(/^-\s*/, ""), meta.note].filter(Boolean).join(" · "),
      nodes: out,
      reach,
      freq,
      updated: Math.floor(Date.now() / 1000),
    });
  }
  return books.length ? { version: 1, books } : null;
}

/** Lecture tolérante d'un livre (fichier importé, export simplifié ou ancienne version). */
export function parseBook(json: string | null): RangeBook {
  if (!json) return emptyBook();
  try {
    const raw = JSON.parse(json);
    const simple = fromSimpleExport(raw);
    if (simple) return simple;
    const b = raw as RangeBook;
    if (!b || !Array.isArray(b.books)) return emptyBook();
    b.books = b.books
      .filter((x) => (x.fmt === "spin3" || x.fmt === "hu") && x.depth > 0)
      .map((x) => ({ ...x, sizes: { ...defaultSizes(x.fmt), ...(x.sizes ?? {}) }, nodes: x.nodes ?? {}, updated: x.updated ?? 0 }));
    return { version: 1, books: b.books };
  } catch {
    return emptyBook();
  }
}

// ---------------------------------------------------------------- comparaison de ranges

/** Dernière décision du joueur `p` dans l'historique (indice), ou -1 s'il n'a pas encore parlé. */
export function lastDecision(fmt: Fmt, depth: number, sizes: TreeSizes, history: string[], p: number): number {
  const r = replay(fmt, depth, sizes, history);
  if (!r) return -1;
  for (let k = history.length - 1; k >= 0; k--) if (r.states[k].toAct === p) return k;
  return -1;
}

/** Range du joueur `p` au spot : mains qui atteignent sa dernière décision × fréquence de
 * l'action qu'il y a choisie. Un joueur qui n'a pas encore parlé a toutes ses mains. */
export function playerRange(book: DepthBook | undefined, fmt: Fmt, depth: number, sizes: TreeSizes, history: string[], p: number): number[] {
  const k = lastDecision(fmt, depth, sizes, history, p);
  if (k < 0) return Array(169).fill(1);
  const r = replay(fmt, depth, sizes, history.slice(0, k + 1))!;
  const s = r.states[k];
  const sp: Spot = { key: nodeKey(s), state: s, acts: r.acts[k], hero: FORMATS[fmt].pos[p] };
  const reach = heroReach(book, fmt, depth, sizes, history.slice(0, k));
  const st = strategy(book, sp);
  if (!st) return reach;
  const i = sp.acts.findIndex((a) => a.id === history[k]);
  return reach.map((w, c) => w * st[c][i]);
}

/** Nombre de combos du joueur `p` au spot : 1326 × produit des fréquences de ses actions.
 * `exact` : toutes ces fréquences viennent du solveur (fichier importé) et non d'un calcul
 * sur les actions dominantes. */
export function playerCombos(book: DepthBook | undefined, fmt: Fmt, depth: number, sizes: TreeSizes, history: string[], p: number): { combos: number; exact: boolean } {
  const r = replay(fmt, depth, sizes, history);
  if (!r) return { combos: 0, exact: false };
  let f = 1;
  let exact = true;
  for (let k = 0; k < history.length; k++) {
    const s = r.states[k];
    if (s.toAct !== p) continue;
    const key = history.slice(0, k).join("-");
    const given = book?.freq?.[key]?.[history[k]];
    if (given !== undefined) f *= given;
    else {
      exact = false;
      const sp: Spot = { key, state: s, acts: r.acts[k], hero: FORMATS[fmt].pos[p] };
      const st = strategy(book, sp);
      const i = sp.acts.findIndex((a) => a.id === history[k]);
      if (st) f *= actionTotals(st, heroReach(book, fmt, depth, sizes, history.slice(0, k))).freq[i];
    }
  }
  return { combos: 1326 * f, exact };
}
