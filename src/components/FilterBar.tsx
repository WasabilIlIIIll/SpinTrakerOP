import { useState } from "react";
import { useApp } from "../lib/state";
import { Dropdown, Btn } from "./ui";
import { Icon } from "./Icon";
import { date, fromInputDate, mult, todayNaive, toInputDate, cls } from "../lib/format";
import { t } from "../lib/i18n";
import type { Filter } from "../lib/api";

function presetRange(p: string): { from: number | null; to: number | null } {
  const today = todayNaive();
  const d = new Date(today * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (p) {
    case "today":
      return { from: today, to: today + 86399 };
    case "yesterday":
      return { from: today - 86400, to: today - 1 };
    case "7d":
      return { from: today - 6 * 86400, to: null };
    case "30d":
      return { from: today - 29 * 86400, to: null };
    case "month":
      return { from: Date.UTC(y, m, 1) / 1000, to: null };
    case "lastmonth":
      return { from: Date.UTC(y, m - 1, 1) / 1000, to: Date.UTC(y, m, 1) / 1000 - 1 };
    case "year":
      return { from: Date.UTC(y, 0, 1) / 1000, to: null };
    default:
      return { from: null, to: null };
  }
}

const PRESETS: [string, string][] = [
  ["all", "Tout"],
  ["today", "Aujourd'hui"],
  ["yesterday", "Hier"],
  ["7d", "7 derniers jours"],
  ["30d", "30 derniers jours"],
  ["month", "Ce mois"],
  ["lastmonth", "Mois dernier"],
  ["year", "Cette année"],
];

export function FilterBar() {
  const { filter, setFilter, overview, prefs, setPrefs, toast } = useApp();
  const [preset, setPreset] = useState("all");
  const [cFrom, setCFrom] = useState("");
  const [cTo, setCTo] = useState("");
  const set = (p: Partial<Filter>) => setFilter({ ...filter, ...p });
  const dateLabel =
    preset === "custom"
      ? `${filter.from ? date(filter.from) : "…"} → ${filter.to ? date(filter.to) : "…"}`
      : t(PRESETS.find((p) => p[0] === preset)?.[1] ?? "Tout");
  const buyins = overview?.buyins ?? [];
  const rooms = overview?.rooms ?? [];
  const mults = overview?.multipliers ?? [];
  const active: { key: string; label: string; clear: () => void }[] = [];
  (filter.buyins ?? []).forEach((b) => active.push({ key: `b${b}`, label: `${b} ${prefs.currency}`, clear: () => set({ buyins: (filter.buyins ?? []).filter((x) => x !== b) }) }));
  (filter.rooms ?? []).forEach((r) => active.push({ key: `r${r}`, label: r, clear: () => set({ rooms: (filter.rooms ?? []).filter((x) => x !== r) }) }));
  if (filter.mult_min != null || filter.mult_max != null)
    active.push({ key: "m", label: `${filter.mult_min != null ? mult(filter.mult_min) : "x…"} – ${filter.mult_max != null ? mult(filter.mult_max) : "x…"}`, clear: () => set({ mult_min: null, mult_max: null }) });
  if (filter.tables_min != null || filter.tables_max != null)
    active.push({ key: "t", label: `${filter.tables_min ?? 1}–${filter.tables_max ?? "∞"} tables`, clear: () => set({ tables_min: null, tables_max: null }) });
  if (filter.opp_tag) active.push({ key: "tag", label: `vs ${filter.opp_tag}`, clear: () => set({ opp_tag: null }) });
  if (filter.opponent) active.push({ key: "opp", label: `vs ${filter.opponent}`, clear: () => set({ opponent: null }) });
  (filter.heroes ?? []).forEach((h) => active.push({ key: `h${h}`, label: h, clear: () => set({ heroes: (filter.heroes ?? []).filter((x) => x !== h) }) }));

  const toggle = <T,>(arr: T[] | undefined, v: T) => ((arr ?? []).includes(v) ? (arr ?? []).filter((x) => x !== v) : [...(arr ?? []), v]);

  return (
    <div className="fbar">
      <Dropdown label={<><Icon name="calendar" size={14} /> {t("Date")} : {dateLabel}</>} align="right">
        {(close) => (
          <div className="dd-list">
            {PRESETS.map(([k, l]) => (
              <button
                key={k}
                className={cls("dd-item", preset === k && "on")}
                onClick={() => {
                  setPreset(k);
                  set(presetRange(k));
                  close();
                }}
              >
                {t(l)}
              </button>
            ))}
            <div className="dd-sep" />
            <div className="dd-custom">
              <label>
                Du <input type="date" value={cFrom || (filter.from ? toInputDate(filter.from) : "")} onChange={(e) => setCFrom(e.target.value)} />
              </label>
              <label>
                Au <input type="date" value={cTo || (filter.to ? toInputDate(filter.to) : "")} onChange={(e) => setCTo(e.target.value)} />
              </label>
              <Btn
                kind="primary"
                small
                onClick={() => {
                  setPreset("custom");
                  set({ from: fromInputDate(cFrom), to: fromInputDate(cTo, true) });
                  close();
                }}
              >
                {t("Appliquer")}
              </Btn>
            </div>
          </div>
        )}
      </Dropdown>
      {active.map((a) => (
        <span className="chip" key={a.key}>
          {a.label}
          <button onClick={a.clear}>
            <Icon name="x" size={12} />
          </button>
        </span>
      ))}
      <Dropdown label={<><Icon name="filter" size={14} /> {t("Filtres")}</>} align="right">
        <div className="fpanel">
          <div className="fsec">
            <div className="fsec-t">Buy-in</div>
            <div className="fchips">
              {buyins.length === 0 && <span className="muted">–</span>}
              {buyins.map((b) => (
                <button key={b} className={cls("fchip", (filter.buyins ?? []).includes(b) && "on")} onClick={() => set({ buyins: toggle(filter.buyins, b) })}>
                  {b} {prefs.currency}
                </button>
              ))}
            </div>
          </div>
          {rooms.length > 1 && (
            <div className="fsec">
              <div className="fsec-t">Room</div>
              <div className="fchips">
                {rooms.map((r) => (
                  <button key={r} className={cls("fchip", (filter.rooms ?? []).includes(r) && "on")} onClick={() => set({ rooms: toggle(filter.rooms, r) })}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(overview?.heroes.length ?? 0) > 1 && (
            <div className="fsec">
              <div className="fsec-t">Pseudo</div>
              <div className="fchips">
                {overview!.heroes.map((r) => (
                  <button key={r} className={cls("fchip", (filter.heroes ?? []).includes(r) && "on")} onClick={() => set({ heroes: toggle(filter.heroes, r) })}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="fsec">
            <div className="fsec-t">{t("Multiplicateurs")}</div>
            <div className="row gap8">
              <select value={filter.mult_min ?? ""} onChange={(e) => set({ mult_min: e.target.value ? +e.target.value : null })}>
                <option value="">min</option>
                {mults.map((m) => (
                  <option key={m} value={m}>
                    {mult(m)}
                  </option>
                ))}
              </select>
              <span className="muted">→</span>
              <select value={filter.mult_max ?? ""} onChange={(e) => set({ mult_max: e.target.value ? +e.target.value : null })}>
                <option value="">max</option>
                {mults.map((m) => (
                  <option key={m} value={m}>
                    {mult(m)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="fsec">
            <div className="fsec-t">Tables simultanées</div>
            <div className="fchips">
              {[1, 2, 3, 4, 5, 6].map((k) => (
                <button
                  key={k}
                  className={cls("fchip", filter.tables_min === k && filter.tables_max === k && "on")}
                  onClick={() => (filter.tables_min === k && filter.tables_max === k ? set({ tables_min: null, tables_max: null }) : set({ tables_min: k, tables_max: k }))}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div className="fsec">
            <div className="fsec-t">Place finale</div>
            <div className="fchips">
              {[1, 2, 3].map((k) => (
                <button key={k} className={cls("fchip", (filter.places ?? []).includes(k) && "on")} onClick={() => set({ places: toggle(filter.places, k) })}>
                  {k}
                  {k === 1 ? "er" : "e"}
                </button>
              ))}
            </div>
          </div>
          <div className="fsec">
            <div className="fsec-t">Jour de la semaine</div>
            <div className="fchips">
              {["L", "M", "M", "J", "V", "S", "D"].map((d, k) => (
                <button key={k} className={cls("fchip", (filter.weekdays ?? []).includes(k) && "on")} onClick={() => set({ weekdays: toggle(filter.weekdays, k) })}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="fsec">
            <div className="fsec-t">Filtres enregistrés</div>
            <div className="fchips">
              {prefs.savedFilters.map((sf, i) => (
                <span key={i} className="fchip saved">
                  <button onClick={() => setFilter(sf.filter)}>{sf.name}</button>
                  <button onClick={() => setPrefs({ savedFilters: prefs.savedFilters.filter((_, j) => j !== i) })}>
                    <Icon name="x" size={11} />
                  </button>
                </span>
              ))}
              <button
                className="fchip"
                onClick={() => {
                  const name = window.prompt("Nom du filtre ?");
                  if (name) {
                    setPrefs({ savedFilters: [...prefs.savedFilters, { name, filter }] });
                    toast("Filtre enregistré");
                  }
                }}
              >
                <Icon name="plus" size={11} /> Enregistrer
              </button>
            </div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Btn
              small
              onClick={() => {
                setPreset("all");
                setFilter({});
              }}
            >
              {t("Réinitialiser")}
            </Btn>
          </div>
        </div>
      </Dropdown>
    </div>
  );
}
