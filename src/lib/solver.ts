// Solver : types, appels Tauri et outils de ranges partagés par l'onglet Solver.
import { call } from "./api";

export interface PostflopConfig {
  board: string;
  pot: number;
  stack: number;
  oop_range: string;
  ip_range: string;
  oop_label: string;
  ip_label: string;
  /** tailles de mise en % du pot, par street [flop, turn, river] */
  bet_sizes: [number[], number[], number[]];
  raise_sizes: number[];
  donk: boolean;
  extra_bets: [number[], number[]][];
  extra_raises: [number[], number[]][];
  precision: number;
  max_iters: number;
  force_allin: number;
  context?: { label: string; tiles: { who: string; stack: number; actions: string[]; chosen: number }[] } | null;
}

export interface JobStatus {
  id: number;
  state: string;
  iter: number;
  max_iters: number;
  exploit: number | null;
  target: number;
  seconds: number;
  memory_mb: number;
  message: string;
  kind: string;
  progress: number;
}

export interface NodeAction {
  kind: "fold" | "check" | "call" | "bet" | "raise" | "allin" | "card" | "none";
  label: string;
  amount?: number;
  pct?: number;
}

export interface GridCell {
  w: number;
  s: number[];
  ev: number;
  eq: number;
}

export interface HandRowN {
  combo: string;
  cell: number;
  weight: number;
  norm: number;
  strategy: number[];
  evs: number[];
  ev: number;
  equity: number;
  eqr: number | null;
}

export interface PlayerSummary {
  equity: number;
  ev: number;
  combos: number;
  eqr: number | null;
  distribution: number[];
}

export interface NodeView {
  board: string[];
  pot: number;
  stacks: [number, number];
  labels: [string, string];
  terminal?: boolean;
  chance?: boolean;
  cards?: { id: number; card: string }[];
  /** carte river pas enregistrée : elle sera re-résolue au clic */
  resolve_on_demand?: boolean;
  resolved_river?: { exploit: number };
  player?: number;
  actions?: NodeAction[];
  freq?: number[];
  grid?: (GridCell | null)[];
  hands?: HandRowN[];
  summary?: PlayerSummary[];
  breakdown?: BreakdownRow[];
  action_ev?: { combos: number; ev: number | null }[];
  blockers?: { card: string; value: number; trash: number }[];
  config: PostflopConfig;
}

export interface BreakdownRow {
  name: string;
  draw: boolean;
  combos: number;
  pct: number;
  strategy: number[];
  ev: number;
  cells: number[];
}

export interface LineAction {
  street: number;
  side: number;
  kind: string;
  to: number;
  amount: number;
  pot_before: number;
}

export interface Spot {
  config: PostflopConfig;
  line: LineAction[];
  runout: string[];
  hero_side: number | null;
  hero_cards: string | null;
  names: [string, string];
  preflop: string;
  pre: { pos: string; stack: number; action: string }[];
  stacks: [string, number][];
}

export interface SolveRow {
  id: number;
  ts: number;
  kind: string;
  hand_id: string | null;
  label: string;
  config: PostflopConfig;
  status: string;
  exploit: number | null;
  iters: number;
  seconds: number;
  bytes: number;
  fav: boolean;
  note: string;
  deleted_at: number | null;
  /** streets enregistrées : "river" (tout), "turn" (river re-résolue à la demande), "flop" */
  storage: string;
}

export interface CategoryRow {
  name: string;
  draw: boolean;
  combos: number;
  pct: number;
  cells: [number, number][];
}

export interface RangeAnalysis {
  board: string[];
  combos_total: number;
  categories: CategoryRow[];
  combos: { combo: string; cell: number; weight: number; equity: number | null; made: number; draws: number[] }[];
  grid: number[];
  grid_equity: (number | null)[];
  equity: number | null;
  vs_equity: number | null;
  distribution: number[];
  vs_distribution: number[];
  exact: boolean;
}

export const solverApi = {
  defaults: () => call<PostflopConfig>("solver_defaults"),
  spotFromHand: (id: string) => call<Spot>("solver_spot_from_hand", { id }),
  start: (config: PostflopConfig, handId: string | null, label: string) => call<number>("solver_start_postflop", { config, handId, label }),
  status: () => call<JobStatus | null>("solver_status"),
  cancel: () => call<void>("solver_cancel"),
  node: (id: number, history: number[]) => call<NodeView>("solver_node", { id, history }),
  history: (trash: boolean) => call<SolveRow[]>("solver_history", { trash }),
  update: (id: number, p: { fav?: boolean; note?: string; label?: string }) => call<void>("solver_update", { id, ...p }),
  trash: (id: number, on: boolean) => call<void>("solver_trash", { id, on }),
  purge: () => call<number>("solver_purge"),
  lighten: (id: number, keepTurn: boolean) => call<number>("solver_lighten", { id, keepTurn }),
  estimate: (config: PostflopConfig) => call<{ memory_mb: number; compressed_mb: number }>("solver_estimate", { config }),
  analyze: (range: string, board: string, dead: string, vs: string) => call<RangeAnalysis>("range_analyze", { range, board, dead, vs }),
  order: () => call<number[]>("range_order"),
};

// ---------------------------------------------------------------- grille 13×13

export const RANKS = "AKQJT98765432";

export function cellName(c: number): string {
  const i = Math.floor(c / 13);
  const j = c % 13;
  if (i === j) return RANKS[i] + RANKS[i];
  return i < j ? `${RANKS[i]}${RANKS[j]}s` : `${RANKS[j]}${RANKS[i]}o`;
}

export function cellCombos(c: number): number {
  const i = Math.floor(c / 13);
  const j = c % 13;
  return i === j ? 6 : i < j ? 4 : 12;
}

/** Range = poids par case (0..1). Sérialisée au format solver : `AA,AKs:0.5,…`. */
export type Grid = number[];

export const emptyGrid = (): Grid => Array(169).fill(0);

export function gridToString(g: Grid): string {
  const parts: string[] = [];
  for (let c = 0; c < 169; c++) {
    const w = g[c];
    if (w <= 0) continue;
    parts.push(w >= 0.999 ? cellName(c) : `${cellName(c)}:${+w.toFixed(3)}`);
  }
  return parts.join(",");
}

/** Lecture d'une range texte simple (cases, `+`, intervalles, poids). Les combos précis
 * (`AsKs`) sont ignorés par la grille ; le texte reste la référence envoyée au solver. */
export function stringToGrid(s: string): Grid | null {
  const g = emptyGrid();
  const idx = (r: string) => RANKS.indexOf(r.toUpperCase());
  const cellOf = (a: number, b: number, kind: string) => (a === b ? a * 13 + a : kind === "s" ? Math.min(a, b) * 13 + Math.max(a, b) : Math.max(a, b) * 13 + Math.min(a, b));
  const set = (a: number, b: number, kind: string, w: number) => {
    if (a === b) g[cellOf(a, a, "")] = w;
    else if (kind === "s" || kind === "o") g[cellOf(a, b, kind)] = w;
    else {
      g[cellOf(a, b, "s")] = w;
      g[cellOf(a, b, "o")] = w;
    }
  };
  for (const raw of s.split(",")) {
    const t = raw.trim();
    if (!t) continue;
    const [body, ws] = t.split(":");
    const w = ws === undefined ? 1 : parseFloat(ws);
    if (!(w >= 0 && w <= 1)) return null;
    const m = body.match(/^([2-9TJQKA])([2-9TJQKA])([so])?(\+)?(?:-([2-9TJQKA])([2-9TJQKA])([so])?)?$/i);
    if (!m) {
      if (/^([2-9TJQKA][cdhs]){2}$/i.test(body)) continue; // combo précis
      return null;
    }
    const a = idx(m[1]);
    const b = idx(m[2]);
    const kind = (m[3] || "").toLowerCase();
    if (m[5]) {
      const a2 = idx(m[5]);
      const b2 = idx(m[6]);
      if (a === b) for (let r = Math.min(a, a2); r <= Math.max(a, a2); r++) set(r, r, "", w);
      else for (let r = Math.min(b, b2); r <= Math.max(b, b2); r++) set(a, r, kind, w);
    } else if (m[4]) {
      if (a === b) for (let r = 0; r <= a; r++) set(r, r, "", w);
      else for (let r = a + 1; r <= b; r++) set(a, r, kind, w);
    } else set(a, b, kind, w);
  }
  return g;
}

export function gridCombos(g: Grid): number {
  return g.reduce((s, w, c) => s + w * cellCombos(c), 0);
}

// ---------------------------------------------------------------- couleurs d'actions

/** Couleurs façon GTO Wizard : vert = passif, rouges = agressif (plus foncé = plus gros), bleu = fold. */
export function actionColors(actions: NodeAction[]): string[] {
  const aggr = actions.filter((a) => a.kind === "bet" || a.kind === "raise" || a.kind === "allin").length;
  const reds = ["#f28b82", "#e8625a", "#d84339", "#bf2e25", "#9e1f18", "#7d1410"];
  let k = 0;
  return actions.map((a) => {
    if (a.kind === "fold") return "#4f86d8";
    if (a.kind === "check" || a.kind === "call") return "#3fa66a";
    if (a.kind === "allin") return "#6b0d0a";
    const i = aggr <= 1 ? 2 : Math.round((k++ * (reds.length - 2)) / Math.max(1, aggr - 1));
    return reds[Math.min(reds.length - 2, i)];
  });
}

export const PRESETS: { id: string; label: string; sizes: [number[], number[], number[]]; raise: number[]; hint: string }[] = [
  { id: "standard", label: "Standard", sizes: [[33, 55, 100, 150], [55, 100], [55, 100]], raise: [3], hint: "4 tailles au flop, 2 au turn et à la river" },
  { id: "complet", label: "Complet", sizes: [[33, 55, 100, 150], [33, 55, 100, 150], [33, 55, 100, 150]], raise: [3], hint: "4 tailles partout : très lourd depuis le flop (jusqu'à 25 Go)" },
  { id: "leger", label: "Léger", sizes: [[33, 55, 100, 150], [100], [100]], raise: [3], hint: "4 tailles au flop, pot ensuite" },
];

export const PRECISIONS = [
  { v: 1, l: "Rapide · 1 %" },
  { v: 0.3, l: "Standard · 0,3 %" },
  { v: 0.1, l: "Précis · 0,1 %" },
];

/** Spot en attente d'ouverture dans l'onglet Solver (bouton « Solver la main »). */
export const pending: { handId: string | null } = { handId: null };

/** Range « top X % » (en combos) selon l'ordre préflop des 169 cases. */
export function topGrid(order: number[], p: number): Grid {
  const g = emptyGrid();
  let acc = 0;
  for (const c of order) {
    const n = cellCombos(c);
    if (acc + n / 2 > (1326 * p) / 100) break;
    g[c] = 1;
    acc += n;
  }
  return g;
}

export interface LabSlot {
  pos: string;
  range: string;
  active: boolean;
}

export interface LabResult {
  slots: { pos: string; combos: number; pct: number; equity: number | null }[];
  grid: number[];
  grid_equity: (number | null)[];
  equity: number | null;
  exact: boolean;
  categories: CategoryRow[];
  distribution: number[];
  hand: {
    name: string;
    combos: number;
    equity: number;
    win: number;
    tie: number;
    vs: [string, number][];
    outcomes_street: string;
    outcomes: { name: string; draw: boolean; pct: number }[];
  } | null;
  players: number;
}

export const labApi = {
  run: (req: { slots: LabSlot[]; hero: number; hand: string; board: string; dead: string }) => call<LabResult>("range_lab", { req }),
};

// ---------------------------------------------------------------- préflop

export interface PreflopConfig {
  stacks: number[];
  ante: number;
  open_btn: number;
  open_sb: number;
  open_sb_hu: number;
  iso: number;
  reraise: number;
  allin_threshold: number;
  push_fold: boolean;
}

export interface PreflopRequest {
  config: PreflopConfig;
  flops: number;
  rounds: number;
  post_precision: number;
  target: number;
  max_iters: number;
}

export interface PreTile {
  who: string;
  stack: number;
  actions: string[];
  chosen: number;
}

export interface PreView {
  names: string[];
  stacks: number[];
  label: string;
  tiles: PreTile[];
  pot: number;
  iterations: number;
  exploit: number;
  evs: number[];
  flops_used: number;
  seconds: number;
  reach: number[][];
  player?: number;
  stack?: number;
  actions?: { kind: string; label: string; to: number }[];
  freq?: number[];
  grid?: { name: string; w: number; s: number[]; evs: number[]; ev: number }[];
  combos?: number;
  terminal?: string;
  contrib?: number[];
  alive?: boolean[];
  flop_model?: string | null;
  combos_alive?: number[];
}

export const preflopApi = {
  defaults: () => call<PreflopRequest>("solver_preflop_defaults"),
  start: (req: PreflopRequest, label: string) => call<number>("solver_preflop_start", { req, label }),
  view: (id: number, path: number[]) => call<PreView>("solver_preflop_view", { id, path }),
  toPostflop: (id: number, path: number[], board: string) => call<number>("solver_preflop_to_postflop", { id, path, board }),
  batch: (reqs: PreflopRequest[]) => call<number>("solver_preflop_batch", { reqs }),
};

/** Configurations de la bibliothèque : ordre [BTN, SB, BB] ou [SB, BB] (bb). */
export const LIBRARY: number[][] = [
  [25, 25, 25], [20, 20, 20], [17, 17, 17], [15, 15, 15], [12, 12, 12], [10, 10, 10], [8, 8, 8],
  [35, 20, 20], [20, 35, 20], [20, 20, 35], [30, 30, 15], [30, 15, 30], [15, 30, 30], [40, 20, 15], [15, 20, 40],
  [25, 25], [20, 20], [15, 15], [12, 12], [10, 10], [8, 8], [6, 6],
];

/** Couleurs des actions préflop : fold bleu, check/call/limp vert, relances rouges, all-in rouge sombre. */
export function preColors(actions: { kind: string }[]): string[] {
  return actions.map((a) => (a.kind === "fold" ? "#4f86d8" : a.kind === "check" || a.kind === "call" || a.kind === "limp" ? "#3fa66a" : a.kind === "allin" ? "#8e1a14" : "#d84339"));
}

// ---------------------------------------------------------------- équité à tapis

export interface AllinRow {
  name: string;
  combos: number;
  equity: number;
  need: number;
  behind_calls: number;
  equity3: number | null;
  ev_call: number;
  ev_fold: number;
}

export interface AllinResult {
  names: string[];
  rows: AllinRow[];
  call_pct: number;
  pot_if_called: number;
  to_call: number;
  need: number;
  shove_combos: number;
  behind_combos: number;
}

export const allinApi = {
  run: (req: { stacks: number[]; ante: number; shover: number; shove_range: string; hero: number; behind: number | null; behind_range: string }) => call<AllinResult>("allin_calc", { req }),
};

// ---------------------------------------------------------------- sécurité : couper le solver

export const guardApi = {
  killAll: () => call<{ stopped: boolean }>("solver_kill_all"),
  lock: (on: boolean) => call<void>("solver_lock", { on }),
  state: () => call<{ locked: boolean; running: boolean; tables: boolean }>("solver_state"),
  prepareTables: () => call<void>("solver_prepare_tables"),
  restart: () => call<void>("app_restart"),
};
