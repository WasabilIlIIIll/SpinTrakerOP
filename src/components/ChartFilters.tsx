import { useApp } from "../lib/state";
import { Icon } from "./Icon";
import { cls, nowNaive, todayNaive } from "../lib/format";
import type { Filter } from "../lib/api";

export const SCENARIOS = ["BTN", "SB vs BTN", "SB vs BB", "BB vs BTN", "BB vs SB", "HU SB", "HU BB"];

const PERIODS: [string, string, () => { from: number | null; to: number | null }][] = [
  ["all", "Tout", () => ({ from: null, to: null })],
  ["1h", "1 h", () => ({ from: nowNaive() - 3600, to: null })],
  ["3h", "3 h", () => ({ from: nowNaive() - 3 * 3600, to: null })],
  ["today", "Auj.", () => ({ from: todayNaive(), to: null })],
  ["3d", "3 j", () => ({ from: todayNaive() - 2 * 86400, to: null })],
  ["7d", "7 j", () => ({ from: todayNaive() - 6 * 86400, to: null })],
  ["30d", "30 j", () => ({ from: todayNaive() - 29 * 86400, to: null })],
  ["90d", "3 mois", () => ({ from: todayNaive() - 89 * 86400, to: null })],
  ["365d", "1 an", () => ({ from: todayNaive() - 364 * 86400, to: null })],
];

/** Filtres rapides posés directement au-dessus du graphique. */
export function ChartFilters({ scenarios = false, full, onFull }: { scenarios?: boolean; full?: boolean; onFull?: () => void }) {
  const { filter, setFilter, overview, prefs } = useApp();
  const set = (p: Partial<Filter>) => setFilter({ ...filter, ...p });
  const activePeriod = PERIODS.find(([, , f]) => {
    const r = f();
    return (r.from ?? null) === (filter.from ?? null) && (r.to ?? null) === (filter.to ?? null);
  })?.[0];
  const toggle = <T,>(arr: T[] | undefined, v: T) => ((arr ?? []).includes(v) ? (arr ?? []).filter((x) => x !== v) : [...(arr ?? []), v]);
  const buyins = overview?.buyins ?? [];
  return (
    <div className="cf">
      <div className="cf-group">
        {PERIODS.map(([k, l, f]) => (
          <button key={k} className={cls("cf-chip", activePeriod === k && "on")} onClick={() => set(f())}>
            {l}
          </button>
        ))}
      </div>
      {buyins.length > 1 && (
        <div className="cf-group">
          {buyins.map((b) => (
            <button key={b} className={cls("cf-chip", (filter.buyins ?? []).includes(b) && "on")} onClick={() => set({ buyins: toggle(filter.buyins, b) })}>
              {b} {prefs.currency}
            </button>
          ))}
        </div>
      )}
      {scenarios && (
        <div className="cf-group">
          {SCENARIOS.map((s) => (
            <button
              key={s}
              className={cls("cf-chip", (filter.scenarios ?? []).includes(s) && "on")}
              onClick={() => set({ scenarios: toggle(filter.scenarios, s) })}
              title={`N'afficher que les mains en ${s}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {onFull && (
        <button className="cf-full" onClick={onFull} title={full ? "Réduire" : "Agrandir le graphique"}>
          <Icon name={full ? "x" : "layers"} size={14} />
          {full ? "Réduire" : "Plein écran"}
        </button>
      )}
    </div>
  );
}
