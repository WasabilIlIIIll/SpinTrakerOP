import { invoke } from "@tauri-apps/api/core";

export interface Filter {
  from?: number | null;
  to?: number | null;
  buyins?: number[];
  rooms?: string[];
  mult_min?: number | null;
  mult_max?: number | null;
  heroes?: string[];
  tables_min?: number | null;
  tables_max?: number | null;
  places?: number[];
  opp_tag?: string | null;
  opponent?: string | null;
  hours?: number[];
  weekdays?: number[];
  scenarios?: string[];
}

export interface ChartNote {
  kind: string;
  label: string;
  x: number;
  y: number;
  x2?: number | null;
  y2?: number | null;
  series: string;
}

export interface Profits {
  real: number;
  real_rb: number;
  ev: number;
  ev_multi: number;
  ev_eff: number;
}

export interface Summary {
  tournaments: number;
  hands: number;
  cev: number;
  cev_ci: number;
  cev_hand: number;
  chips_avg: number;
  rakeback: number;
  buyins: number;
  avg_buyin: number;
  profit: Profits;
  roi: Profits;
  hourly: Profits;
  seconds: number;
  spins_per_hour: number;
  min_cev: number;
  luck_z: number;
  luck_chips: number;
  finish: [number, number, number];
  finish_expected: [number, number, number];
  avg_mult: number;
  expected_mult: number;
  hands_per_spin: number;
  first: number;
  last: number;
  avg_tables: number;
  avg_duration: number;
}

export interface Overview {
  tournaments: number;
  hands: number;
  players: number;
  rooms: string[];
  buyins: number[];
  heroes: string[];
  multipliers: number[];
  first: number | null;
  last: number | null;
  db_path: string;
  version: string;
}

export interface ChipsChart {
  x: number[];
  series: [string, number[]][];
  total_x: number;
  tournaments: number;
  cev: number;
  cev_ci: number;
  min_cev: number;
  hands: number;
  notes: ChartNote[];
}

export interface Swing {
  amount: number;
  from: number;
  to: number;
  from_ts: number;
  to_ts: number;
}

export interface Jackpot {
  index: number;
  ts: number;
  mult: number;
  prize_pool: number;
  won: number;
  place: number;
  tid: string;
}

export interface BankrollChart {
  x: number[];
  ts: number[];
  series: [string, number[]][];
  events: {
    jackpots: Jackpot[];
    upswing: Swing;
    downswing: Swing;
    ev_downswing: Swing;
    peak: [number, number];
    low: [number, number];
    longest_break_even: Swing;
    current_drawdown: number;
    since_peak: number;
    best_day: [number, number];
    worst_day: [number, number];
    best_streak: number;
    worst_streak: number;
  };
  start: number;
  transactions: number;
  notes: ChartNote[];
}

export interface Bar {
  key: string;
  count: number;
  hands: number;
  chips: number;
  chips_ci: number;
  ev: number;
  ev_ci: number;
}

export interface Row {
  key: string;
  sort: number;
  spins: number;
  hands: number;
  profit: number;
  rakeback: number;
  ev: number;
  ev_multi: number;
  ev_eff: number;
  cev: number;
  cev_ci: number;
  roi_ev: number;
  hours: number;
  ev_hour: number;
  real_hour: number;
  spins_hour: number;
  win_pct: number;
}

export interface MultRow {
  mult: number;
  count: number;
  expected: number;
  freq: number;
  expected_freq: number;
  wins: number;
  profit: number;
  cev: number;
}

export interface DayCount {
  day: number;
  spins: number;
  profit: number;
  ev: number;
}

export interface TRow {
  id: string;
  start: number;
  end: number;
  name: string;
  room: string;
  buyin: number;
  multiplier: number;
  prize_pool: number;
  place: number;
  winnings: number;
  profit: number;
  chips: number;
  ev: number;
  ev_profit: number;
  hands: number;
  tables: number;
  opponents: [string, string[]][];
  luck: number;
}

export interface HandRow {
  id: string;
  tid: string;
  ts: number;
  cards: [string, string] | null;
  combo: string;
  board: string[];
  scenario: string;
  bb: number;
  sb: number;
  eff_bb: number;
  net: number;
  ev: number;
  pot: number;
  equity: number | null;
  allin: number | null;
  players: number;
  line: string;
  showdown: boolean;
  fav: boolean;
  fav_note: string;
}

export interface HandDetail {
  id: string;
  tid: string;
  ts: number;
  sb: number;
  bb: number;
  ante: number;
  button: number;
  hero: number;
  seats: {
    name: string;
    seat: number;
    stack: number;
    cards: [string, string] | null;
    tags: string[];
    pos: string;
    net: number;
    ev: number;
    equity: number | null;
    folded: boolean;
  }[];
  actions: { street: number; p: number; kind: string; amount: number; allin: boolean }[];
  board: string[];
  pot: number;
  allin_street: number | null;
  showdown: boolean;
  eff_bb: number;
  index: number;
  count: number;
  prev: string | null;
  next: string | null;
  fav: boolean;
  fav_note: string;
  tournament: { id: string; name: string; multiplier: number; buyin: number; place: number; prize_pool: number };
}

export interface TournamentDetail {
  id: string;
  name: string;
  room: string;
  start: number;
  end: number;
  buyin: number;
  multiplier: number;
  prize_pool: number;
  place: number;
  winnings: number;
  profit: number;
  chips: number;
  ev: number;
  ev_profit: number;
  ev_multi: number;
  p: [number, number, number];
  tables: number;
  hands: number;
  source: string;
  opponents: { name: string; tags: string[] }[];
  curve_chips: number[];
  curve_ev: number[];
}

export interface PlayerRow {
  name: string;
  tags: string[];
  manual_tags: string[];
  notes: string;
  hands: number;
  tournaments: number;
  vpip: number;
  pfr: number;
  limp_btn: number;
  shove_btn: number;
  raise_btn: number;
  threebet: number;
  call_shove_bb: number;
  af: number;
  wtsd: number;
  wsd: number;
  cbet: number;
  fold_cbet: number;
  cev: number;
  cev_vs_hero: number;
  hero_cev_vs: number;
  vs_hero_tournaments: number;
  hero_profit_vs: number;
  hero_ev_profit_vs: number;
  hero_wins_vs: number;
  their_wins_vs: number;
  hu_matches: number;
  hero_profit_hu_vs: number;
  cev_hu_vs: number;
  chips_hu_vs: number;
  last_ts: number;
  first_ts: number;
  is_hero: boolean;
}

export interface PlayerProfile extends PlayerRow {
  together: { id: string; start: number; multiplier: number; place: number; profit: number; ev: number; chips: number; buyin: number }[];
  hero_cev_hu_vs: number;
  hero_cev_hu_vs_ci: number;
  hero_cev_vs_ci: number;
}

export interface NodeOut {
  key: string;
  label: string;
  kind: "open" | "vs_limp" | "vs_raise" | "vs_shove";
  total: number;
  counts: [number, number, number, number];
  reference: [number, number, number, number] | null;
  ref_total: number;
  buckets: { label: string; total: number; counts: [number, number, number, number]; reference: [number, number, number, number] | null; ref_total: number }[];
  matrix: Record<string, [number, number, number, number]>;
  ev: number;
}

export interface Post {
  key: string;
  flops: number;
  cbet: [number, number];
  fold_cbet: [number, number];
  raise_cbet: [number, number];
  check_raise: [number, number];
  donk: [number, number];
  barrel: [number, number];
  wtsd: [number, number];
  wsd: [number, number];
  agg: number;
  calls: number;
  bets_raises_flop: [number, number];
}

export interface LeakReport {
  player: string;
  hands: number;
  panels: { scenario: string; hands: number; nodes: NodeOut[] }[];
  postflop: { player: Post[]; reference: Post[] };
}

export interface MultEntry {
  mult: number;
  prob: number;
  shares: [number, number, number];
}

export interface MultTable {
  id: string;
  name: string;
  room: string;
  buyin: number | null;
  entries: MultEntry[];
}

export interface TagRule {
  stat: string;
  op: string;
  value: number;
}

export interface TagDef {
  id: string;
  name: string;
  color: string;
  icon: string;
  active: boolean;
  auto: boolean;
  mode: "all" | "any";
  rules: TagRule[];
}

export interface Settings {
  default_rakeback: number;
  rakeback: Record<string, number>;
  mult_tables: MultTable[];
  jackpot_threshold: number;
  tags: TagDef[];
  references: Record<string, number>;
  bankroll_start: number;
  transactions: { ts: number; amount: number; note: string }[];
  heroes: string[];
  min_hands_tag: number;
}

export interface Challenge {
  id?: number | null;
  name: string;
  kind: string;
  target: number;
  min_spins: number;
  start: number;
  end: number;
  filter: Filter;
  color: string;
  abandoned: boolean;
}

export interface ChallengeView {
  challenge: Challenge;
  value: number;
  progress: number;
  status: "en_cours" | "reussi" | "echoue" | "abandonne" | "a_venir";
  days_total: number;
  days_left: number;
  required_per_day: number;
  remaining_per_day: number;
  daily: { day: number; value: number }[];
  summary: Summary;
}

export interface ImportResult {
  sources: number;
  hands: number;
  imported: number;
  duplicates: number;
  invalid: number;
  tournaments: number;
  errors: string[];
  millis: number;
  batch: number;
}

export interface ImportRow {
  id: number;
  ts: number;
  sources: number;
  hands: number;
  imported: number;
  duplicates: number;
  invalid: number;
  status: string;
  label: string;
  remaining: number;
}

export interface TagsOverviewRow {
  id: string;
  players: number;
  tournaments: number;
  cev: number;
  cev_ci: number;
  cev_hu: number;
  cev_hu_ci: number;
  hu_matches: number;
}

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!inTauri) return Promise.reject(new Error("Spin Tracker OP doit être lancé via l'application desktop (npm run app)."));
  return invoke<T>(cmd, args);
}

export const api = {
  isReady: () => call<boolean>("is_ready"),
  overview: () => call<Overview>("overview"),
  importPaths: (paths: string[]) => call<ImportResult>("import_paths", { paths }),
  summary: (filter: Filter) => call<Summary>("get_summary", { filter }),
  chipsChart: (filter: Filter, axis: string) => call<ChipsChart>("chips_chart", { filter, axis, maxPoints: 3500 }),
  bankrollChart: (filter: Filter, axis: string) => call<BankrollChart>("bankroll_chart", { filter, axis }),
  byPosition: (filter: Filter, per: string) => call<Bar[]>("by_position", { filter, per }),
  byProfile: (filter: Filter) => call<Bar[]>("by_profile", { filter }),
  byStack: (filter: Filter) => call<Bar[]>("by_stack", { filter }),
  resultsBy: (filter: Filter, group: string) => call<Row[]>("results_by", { filter, group }),
  multipliers: (filter: Filter) => call<MultRow[]>("multipliers", { filter }),
  calendar: (filter: Filter) => call<DayCount[]>("calendar", { filter }),
  tournaments: (filter: Filter, sort: string, desc: boolean, offset: number, limit: number) =>
    call<{ total: number; rows: TRow[] }>("tournaments", { filter, sort, desc, offset, limit }),
  hands: (q: Record<string, unknown>) => call<{ total: number; rows: HandRow[]; net: number; ev: number }>("hands", { q }),
  handDetail: (id: string) => call<HandDetail>("hand_detail", { id }),
  tournamentDetail: (id: string) => call<TournamentDetail>("tournament_detail", { id }),
  players: (q: Record<string, unknown>) => call<{ total: number; rows: PlayerRow[] }>("players", { q }),
  playerProfile: (name: string) => call<PlayerProfile>("player_profile", { name }),
  savePlayerMeta: (name: string, tags: string[], notes: string) => call<void>("save_player_meta", { name, tags, notes }),
  tagsOverview: () => call<TagsOverviewRow[]>("tags_overview"),
  leakReport: (player: string, filter: Filter, reference: string) => call<LeakReport>("leak_report", { player, filter, reference }),
  getSettings: () => call<Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),
  defaultSettings: () => call<Settings>("default_settings"),
  getUi: () => call<string | null>("get_ui"),
  setUi: (value: string) => call<void>("set_ui", { value }),
  challenges: (now: number) => call<ChallengeView[]>("challenges_list", { now }),
  saveChallenge: (challenge: Challenge) => call<number>("save_challenge", { challenge }),
  deleteChallenge: (id: number) => call<void>("delete_challenge", { id }),
  imports: () => call<ImportRow[]>("imports_history"),
  deleteImport: (id: number) => call<{ hands: number; tournaments: number }>("delete_import", { id }),
  setFavorite: (id: string, on: boolean, note?: string) => call<void>("set_favorite", { id, on, note }),
  wipe: () => call<void>("wipe_database"),
  backup: (path: string) => call<void>("backup_database", { path }),
  exportCsv: (filter: Filter, path: string) => call<number>("export_csv", { filter, path }),
};
