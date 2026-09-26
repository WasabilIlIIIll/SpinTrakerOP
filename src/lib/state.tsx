import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type Filter, type Overview, type Settings } from "./api";
import { applyTheme } from "./themes";
import { setLang } from "./i18n";
import { setFormatPrefs } from "./format";

export interface UiPrefs {
  theme: string;
  accent: string | null;
  lang: "fr" | "en";
  currency: string;
  density: "cozy" | "compact";
  fontScale: number;
  radius: number;
  fourColor: boolean;
  animations: boolean;
  kpis: string[];
  kpiModes: Record<string, number>;
  privacy: Record<string, boolean>;
  sidebarCollapsed: boolean;
  chartColors: Record<string, string>;
  themeVars: Record<string, string>;
  chipsSeries: string[];
  bankrollSeries: string[];
  chipsAxis: "hands" | "tournaments" | "date";
  bankrollAxis: "tournaments" | "date";
  replaySpeed: number;
  leakRef: string;
  statsSections: string[];
  statsWidths: Record<string, number>;
  savedFilters: { name: string; filter: Filter }[];
  showCi: boolean;
  showNotes: boolean;
  smoothMulti: boolean;
  includeBankrollStart: boolean;
  dashboardTab: string;
  page: string;
  eventsLayout: "vedette" | "compact" | "liste";
  rangesFmt?: "spin3" | "hu";
  rangesDepth?: number;
  /** réglages du trainer (voir components/Trainer.tsx) */
  trainer?: Record<string, unknown>;
}

export const ALL_KPIS = ["tournaments", "cev", "rakeback", "profit", "roi", "hourly", "time", "luck", "finish", "avg_buyin", "spins_h", "min_cev"];
export const ALL_STATS_SECTIONS = ["tiles", "position", "sessions", "results", "multipliers", "multitabling", "finishers", "profile", "stack", "hours", "weekdays"];

export const DEFAULT_PREFS: UiPrefs = {
  theme: "clair",
  accent: null,
  lang: "fr",
  currency: "€",
  density: "cozy",
  fontScale: 1,
  radius: 12,
  fourColor: true,
  animations: true,
  kpis: ["tournaments", "cev", "rakeback", "profit"],
  kpiModes: {},
  privacy: {},
  sidebarCollapsed: false,
  chartColors: {},
  themeVars: {},
  chipsSeries: ["chips", "chips_sd", "chips_nsd", "ev", "min_cev"],
  bankrollSeries: ["real_rb", "ev", "ev_multi", "ev_eff"],
  chipsAxis: "hands",
  bankrollAxis: "tournaments",
  replaySpeed: 1,
  leakRef: "population",
  statsSections: ALL_STATS_SECTIONS,
  statsWidths: {},
  savedFilters: [],
  showCi: true,
  showNotes: true,
  smoothMulti: false,
  includeBankrollStart: false,
  dashboardTab: "chips",
  page: "dashboard",
  eventsLayout: "vedette",
};

interface Ctx {
  prefs: UiPrefs;
  setPrefs: (p: Partial<UiPrefs>) => void;
  filter: Filter;
  setFilter: (f: Filter) => void;
  version: number;
  bump: () => void;
  overview: Overview | null;
  ready: boolean;
  settings: Settings | null;
  saveSettings: (s: Settings) => Promise<void>;
  toast: (msg: string, kind?: "ok" | "err") => void;
  toasts: { id: number; msg: string; kind: string }[];
  modal: ModalState | null;
  open: (m: ModalState | null) => void;
  page: string;
  go: (p: string) => void;
}

export type ModalState =
  | { type: "hand"; id: string; list?: string[] }
  | { type: "tournament"; id: string }
  | { type: "player"; name: string };

const AppCtx = createContext<Ctx>(null as unknown as Ctx);

export function useApp() {
  return useContext(AppCtx);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<UiPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>({});
  const [version, setVersion] = useState(0);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);

  const saveTimer = useRef<number | undefined>(undefined);

  const toast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  // préférences UI
  useEffect(() => {
    api
      .getUi()
      .then((s) => {
        if (s) {
          try {
            const raw = JSON.parse(s);
            // migration des anciens identifiants de thème
            const map: Record<string, string> = { highroller: "nuit", ivory: "clair", felt: "tapis", royal: "vegas" };
            if (raw.theme && map[raw.theme]) raw.theme = map[raw.theme];
            // nouveau bloc « Sessions » : ajouté aux dispositions existantes
            if (Array.isArray(raw.statsSections) && raw.statsWidths === undefined && !raw.statsSections.includes("sessions")) {
              const i = raw.statsSections.indexOf("position");
              raw.statsSections.splice(i >= 0 ? i + 1 : 0, 0, "sessions");
            }
            const p = { ...DEFAULT_PREFS, ...raw };
            setPrefsState(p);
          } catch {
            /* préférences corrompues : valeurs par défaut */
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const setPrefs = useCallback((p: Partial<UiPrefs>) => {
    setPrefsState((old) => {
      const next = { ...old, ...p };
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => api.setUi(JSON.stringify(next)).catch(() => {}), 400);
      return next;
    });
  }, []);

  useEffect(() => {
    if (prefs.theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => applyTheme(prefs.theme, prefs.accent, { ...prefs.themeVars, ...prefs.chartColors });
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [prefs]);

  useEffect(() => {
    applyTheme(prefs.theme, prefs.accent, { ...prefs.themeVars, ...prefs.chartColors });
    setLang(prefs.lang);
    setFormatPrefs(prefs.currency, prefs.lang === "fr" ? "fr-FR" : "en-US");
    const root = document.documentElement;
    root.style.setProperty("--radius", `${prefs.radius}px`);
    root.style.fontSize = `${14 * prefs.fontScale}px`;
    root.dataset.density = prefs.density;
    root.dataset.anim = prefs.animations ? "on" : "off";
  }, [prefs]);

  // attente du chargement de la base
  useEffect(() => {
    let stop = false;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("store-ready", () => {
          setReady(true);
          setVersion((v) => v + 1);
        }).then((u) => (unlisten = u)),
      )
      .catch(() => {});
    const poll = () =>
      api
        .isReady()
        .then((r) => {
          if (r) {
            setReady(true);
            setVersion((v) => v + 1);
          } else if (!stop) window.setTimeout(poll, 250);
        })
        .catch(() => {});
    poll();
    return () => {
      stop = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    api
      .startupNotice()
      .then((n) => n && window.setTimeout(() => window.alert(n), 300))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!ready) return;
    api.overview().then(setOverview).catch(() => {});
    api.getSettings().then(setSettings).catch(() => {});
  }, [ready, version]);

  const saveSettings = useCallback(
    async (s: Settings) => {
      await api.saveSettings(s);
      setSettings(s);
      setVersion((v) => v + 1);
    },
    [],
  );

  const go = useCallback((p: string) => setPrefs({ page: p }), [setPrefs]);

  const value = useMemo<Ctx>(
    () => ({
      prefs,
      setPrefs,
      filter,
      setFilter,
      version,
      bump: () => setVersion((v) => v + 1),
      overview,
      ready: ready && loaded,
      settings,
      saveSettings,
      toast,
      toasts,
      modal,
      open: setModal,
      page: prefs.page,
      go,
    }),
    [prefs, setPrefs, filter, version, overview, ready, loaded, settings, saveSettings, toast, toasts, modal, go],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

// ---- requêtes avec cache ----
const cache = new Map<string, unknown>();

export function useQuery<T>(key: unknown[], fn: () => Promise<T>, enabled = true): { data: T | undefined; loading: boolean; error: string | null } {
  const { version, ready } = useApp();
  const k = JSON.stringify([version, ...key]);
  const [state, setState] = useState<{ k: string; data: T | undefined; loading: boolean; error: string | null }>(() => ({
    k,
    data: cache.get(k) as T | undefined,
    loading: !cache.has(k),
    error: null,
  }));
  useEffect(() => {
    if (!enabled || !ready) return;
    if (cache.has(k)) {
      setState({ k, data: cache.get(k) as T, loading: false, error: null });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, k, loading: true }));
    fn()
      .then((d) => {
        if (cache.size > 300) cache.clear();
        cache.set(k, d);
        if (alive) setState({ k, data: d, loading: false, error: null });
      })
      .catch((e) => alive && setState({ k, data: undefined, loading: false, error: String(e) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, enabled, ready]);
  return { data: state.data, loading: state.loading, error: state.error };
}

export function clearCache() {
  cache.clear();
}
