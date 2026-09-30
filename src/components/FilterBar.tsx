import { useState } from "react";
import { useApp } from "../lib/state";
import { Btn, Modal } from "./ui";
import { Icon } from "./Icon";
import { date, fromInputDate, mult, num, todayNaive, toInputDate, cls, nowNaive } from "../lib/format";
import { t } from "../lib/i18n";
import type { Filter } from "../lib/api";

export const SCENARIOS = ["BTN", "SB vs BTN", "SB vs BB", "BB vs BTN", "BB vs SB", "HU SB", "HU BB"];

type Range = { from: number | null; to: number | null };

export const PRESETS: [string, string, () => Range][] = [
  ["all", "Tout", () => ({ from: null, to: null })],
  ["1h", "1 heure", () => ({ from: nowNaive() - 3600, to: null })],
  ["3h", "3 heures", () => ({ from: nowNaive() - 3 * 3600, to: null })],
  ["today", "Aujourd'hui", () => ({ from: todayNaive(), to: null })],
  ["yesterday", "Hier", () => ({ from: todayNaive() - 86400, to: todayNaive() - 1 })],
  ["3d", "3 jours", () => ({ from: todayNaive() - 2 * 86400, to: null })],
  ["7d", "7 jours", () => ({ from: todayNaive() - 6 * 86400, to: null })],
  ["30d", "30 jours", () => ({ from: todayNaive() - 29 * 86400, to: null })],
  ["90d", "3 mois", () => ({ from: todayNaive() - 89 * 86400, to: null })],
  ["365d", "1 an", () => ({ from: todayNaive() - 364 * 86400, to: null })],
];

export function activePreset(f: Filter): string | undefined {
  return PRESETS.find(([, , fn]) => {
    const r = fn();
    return (r.from ?? null) === (f.from ?? null) && (r.to ?? null) === (f.to ?? null);
  })?.[0];
}

function countActive(f: Filter): number {
  let n = 0;
  if (f.from != null || f.to != null) n++;
  n += (f.buyins ?? []).length ? 1 : 0;
  n += (f.rooms ?? []).length ? 1 : 0;
  n += (f.heroes ?? []).length ? 1 : 0;
  n += (f.scenarios ?? []).length ? 1 : 0;
  n += (f.places ?? []).length ? 1 : 0;
  n += (f.weekdays ?? []).length ? 1 : 0;
  n += (f.hours ?? []).length ? 1 : 0;
  if (f.mult_min != null || f.mult_max != null) n++;
  if (f.tables_min != null || f.tables_max != null) n++;
  if (f.opp_tag) n++;
  if (f.opponent) n++;
  return n;
}

/** Bouton unique « Filtres » + résumé des filtres actifs. */
export function FilterBar({ compact }: { compact?: boolean }) {
  const { filter, setFilter, prefs } = useApp();
  const [open, setOpen] = useState(false);
  const n = countActive(filter);
  const preset = activePreset(filter);
  const label = preset ? t(PRESETS.find((p) => p[0] === preset)![1]) : `${filter.from ? date(filter.from) : "…"} → ${filter.to ? date(filter.to) : "…"}`;
  const chips: { key: string; label: string; clear: () => void }[] = [];
  const set = (p: Partial<Filter>) => setFilter({ ...filter, ...p });
  if (filter.from != null || filter.to != null) chips.push({ key: "date", label, clear: () => set({ from: null, to: null }) });
  (filter.buyins ?? []).forEach((b) => chips.push({ key: `b${b}`, label: `${num(b, b % 1 ? 2 : 0)} ${prefs.currency}`, clear: () => set({ buyins: (filter.buyins ?? []).filter((x) => x !== b) }) }));
  (filter.scenarios ?? []).forEach((s) => chips.push({ key: `s${s}`, label: s, clear: () => set({ scenarios: (filter.scenarios ?? []).filter((x) => x !== s) }) }));
  if (filter.opponent) chips.push({ key: "opp", label: `vs ${filter.opponent}`, clear: () => set({ opponent: null }) });
  if (filter.opp_tag) chips.push({ key: "tag", label: `tag ${filter.opp_tag}`, clear: () => set({ opp_tag: null }) });

  return (
    <div className="fbar">
      {!compact && chips.slice(0, 4).map((c) => (
        <span className="chip" key={c.key}>
          {c.label}
          <button onClick={c.clear} title="Retirer ce filtre">
            <Icon name="x" size={12} />
          </button>
        </span>
      ))}
      {chips.length > 4 && <span className="muted small">+{chips.length - 4}</span>}
      <button className={cls("dd-btn", n > 0 && "on")} onClick={() => setOpen(true)}>
        <Icon name="filter" size={14} /> {t("Filtres")}
        {n > 0 && <b className="badge">{n}</b>}
      </button>
      {open && <FilterModal onClose={() => setOpen(false)} />}
    </div>
  );
}

const WEEKDAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

/** Buy-ins proposés même sans spin joué (jusqu'à 500), complétés par ceux de la base. */
const BUYIN_LADDER = [0.25, 0.5, 1, 2, 3, 5, 10, 15, 20, 25, 30, 50, 100, 150, 200, 250, 300, 500];
const MULT_LADDER = [2, 3, 4, 5, 6, 8, 10, 12, 20, 25, 50, 100, 120, 240, 1000, 10000];

type FPage = "period" | "buyin" | "mult" | "days" | "tables" | "opps" | "saved";

/** Pop-up centrale des filtres, rangée en pages. */
export function FilterModal({ onClose }: { onClose: () => void }) {
  const { filter, setFilter, overview, settings, prefs, setPrefs, toast } = useApp();
  const [f, setF] = useState<Filter>(filter);
  const [page, setPage] = useState<FPage>("period");
  const set = (p: Partial<Filter>) => setF({ ...f, ...p });
  const toggle = <T,>(arr: T[] | undefined, v: T) => ((arr ?? []).includes(v) ? (arr ?? []).filter((x) => x !== v) : [...(arr ?? []), v]);
  const preset = activePreset(f);
  const have = new Set(overview?.buyins ?? []);
  const buyins = [...new Set([...BUYIN_LADDER, ...(overview?.buyins ?? [])])].sort((x, y) => x - y);
  const rooms = overview?.rooms ?? [];
  const haveMult = new Set(overview?.multipliers ?? []);
  const mults = [...new Set([...MULT_LADDER, ...(overview?.multipliers ?? [])])].sort((x, y) => x - y);
  const apply = (nf: Filter) => {
    setFilter(nf);
    onClose();
  };
  const count: Record<FPage, number> = {
    period: f.from != null || f.to != null ? 1 : 0,
    buyin: (f.buyins ?? []).length,
    mult: (f.mult_min != null || f.mult_max != null ? 1 : 0) + (f.places ?? []).length,
    days: (f.weekdays ?? []).length + (f.hours ?? []).length,
    tables: (f.tables_min != null ? 1 : 0) + (f.scenarios ?? []).length,
    opps: (f.opponent ? 1 : 0) + (f.opp_tag ? 1 : 0) + (f.rooms ?? []).length + (f.heroes ?? []).length,
    saved: 0,
  };
  const PAGES: [FPage, string, string][] = [
    ["period", "Période", "calendar"],
    ["buyin", "Buy-in", "wallet"],
    ["mult", "Multiplicateurs", "trophy"],
    ["days", "Jours et heures", "clock"],
    ["tables", "Tables et positions", "layers"],
    ["opps", "Adversaires", "users"],
    ["saved", "Filtres enregistrés", "star"],
  ];
  return (
    <Modal
      title={
        <>
          <Icon name="filter" size={16} /> Filtres
        </>
      }
      onClose={onClose}
      wide
    >
      <div className="fpages">
        <nav className="fpages-nav">
          {PAGES.map(([k, l, ic]) => (
            <button key={k} className={cls("fpage", page === k && "on")} onClick={() => setPage(k)}>
              <Icon name={ic} size={15} />
              <span>{l}</span>
              {count[k] > 0 && <b className="badge">{count[k]}</b>}
            </button>
          ))}
        </nav>
        <div className="fpages-body" key={page}>
          {page === "period" && (
            <Section title="Période">
              <div className="fchips">
                {PRESETS.map(([k, l, fn]) => (
                  <button key={k} className={cls("fchip", preset === k && "on")} onClick={() => set(fn())}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="row gap12 wrap" style={{ marginTop: 14 }}>
                <label className="field">
                  Du
                  <input className="inp" type="date" value={f.from ? toInputDate(f.from) : ""} onChange={(e) => set({ from: fromInputDate(e.target.value) })} />
                </label>
                <label className="field">
                  Au
                  <input className="inp" type="date" value={f.to ? toInputDate(f.to) : ""} onChange={(e) => set({ to: fromInputDate(e.target.value, true) })} />
                </label>
              </div>
            </Section>
          )}

          {page === "buyin" && (
            <Section title="Buy-in" help="Aucune sélection = tous les buy-ins. Les buy-ins en gris n'ont encore aucun spin dans ta base.">
              <div className="fchips">
                {buyins.map((b) => (
                  <button
                    key={b}
                    className={cls("fchip", (f.buyins ?? []).includes(b) && "on", !have.has(b) && "fc-none")}
                    onClick={() => set({ buyins: toggle(f.buyins, b) })}
                    title={have.has(b) ? undefined : "Aucun spin à ce buy-in pour l'instant"}
                  >
                    {num(b, b % 1 ? 2 : 0)} {prefs.currency}
                  </button>
                ))}
              </div>
            </Section>
          )}

          {page === "mult" && (
            <>
              <Section title="Multiplicateur minimum" help="Les multiplicateurs en gris ne sont encore jamais sortis dans ta base.">
                <div className="fchips">
                  <button className={cls("fchip", f.mult_min == null && "on")} onClick={() => set({ mult_min: null })}>
                    aucun
                  </button>
                  {mults.map((m) => (
                    <button key={m} className={cls("fchip", f.mult_min === m && "on", !haveMult.has(m) && "fc-none")} onClick={() => set({ mult_min: f.mult_min === m ? null : m })}>
                      {mult(m)}
                    </button>
                  ))}
                </div>
              </Section>
              <Section title="Multiplicateur maximum">
                <div className="fchips">
                  <button className={cls("fchip", f.mult_max == null && "on")} onClick={() => set({ mult_max: null })}>
                    aucun
                  </button>
                  {mults.map((m) => (
                    <button key={m} className={cls("fchip", f.mult_max === m && "on", !haveMult.has(m) && "fc-none")} onClick={() => set({ mult_max: f.mult_max === m ? null : m })}>
                      {mult(m)}
                    </button>
                  ))}
                </div>
              </Section>
              <Section title="Place finale">
                <div className="fchips">
                  {[1, 2, 3].map((k) => (
                    <button key={k} className={cls("fchip", (f.places ?? []).includes(k) && "on")} onClick={() => set({ places: toggle(f.places, k) })}>
                      {k}
                      {k === 1 ? "er" : "e"}
                    </button>
                  ))}
                </div>
              </Section>
            </>
          )}

          {page === "days" && (
            <>
              <Section title="Jour de la semaine">
                <div className="fchips">
                  {WEEKDAYS.map((d, k) => (
                    <button key={k} className={cls("fchip", (f.weekdays ?? []).includes(k) && "on")} onClick={() => set({ weekdays: toggle(f.weekdays, k) })}>
                      {d}
                    </button>
                  ))}
                </div>
              </Section>
              <Section title="Heure de jeu">
                <div className="fchips hours">
                  {Array.from({ length: 24 }, (_, h) => (
                    <button key={h} className={cls("fchip", (f.hours ?? []).includes(h) && "on")} onClick={() => set({ hours: toggle(f.hours, h) })}>
                      {String(h).padStart(2, "0")} h
                    </button>
                  ))}
                </div>
              </Section>
            </>
          )}

          {page === "tables" && (
            <>
              <Section title="Tables simultanées">
                <div className="fchips">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((k) => (
                    <button
                      key={k}
                      className={cls("fchip", f.tables_min === k && f.tables_max === k && "on")}
                      onClick={() => (f.tables_min === k && f.tables_max === k ? set({ tables_min: null, tables_max: null }) : set({ tables_min: k, tables_max: k }))}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </Section>
              <Section title="Position (mains)" help="Filtre les courbes de jetons sur les mains jouées dans ces positions.">
                <div className="fchips">
                  {SCENARIOS.map((sc) => (
                    <button key={sc} className={cls("fchip", (f.scenarios ?? []).includes(sc) && "on")} onClick={() => set({ scenarios: toggle(f.scenarios, sc) })}>
                      {sc}
                    </button>
                  ))}
                </div>
              </Section>
            </>
          )}

          {page === "opps" && (
            <>
              <Section title="Adversaires">
                <div className="col gap12">
                  <label className="field">
                    Contre le joueur
                    <input className="inp" placeholder="pseudo exact" value={f.opponent ?? ""} onChange={(e) => set({ opponent: e.target.value || null })} />
                  </label>
                  <div className="field">
                    Table contenant un
                    <div className="fchips">
                      {(settings?.tags ?? []).map((tg) => (
                        <button key={tg.id} className={cls("fchip", f.opp_tag === tg.id && "on")} onClick={() => set({ opp_tag: f.opp_tag === tg.id ? null : tg.id })}>
                          {tg.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </Section>
              {(rooms.length > 1 || (overview?.heroes.length ?? 0) > 1) && (
                <Section title="Room et pseudo">
                  <div className="fchips">
                    {rooms.map((r) => (
                      <button key={r} className={cls("fchip", (f.rooms ?? []).includes(r) && "on")} onClick={() => set({ rooms: toggle(f.rooms, r) })}>
                        {r}
                      </button>
                    ))}
                    {(overview?.heroes ?? []).map((h) => (
                      <button key={h} className={cls("fchip", (f.heroes ?? []).includes(h) && "on")} onClick={() => set({ heroes: toggle(f.heroes, h) })}>
                        {h}
                      </button>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}

          {page === "saved" && (
            <Section title="Filtres enregistrés" help="Un clic applique le filtre enregistré.">
              <div className="fchips">
                {prefs.savedFilters.map((sf, i) => (
                  <span key={i} className="fchip saved">
                    <button onClick={() => apply(sf.filter)}>{sf.name}</button>
                    <button onClick={() => setPrefs({ savedFilters: prefs.savedFilters.filter((_, j) => j !== i) })} title="Supprimer">
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                ))}
                <button
                  className="fchip"
                  onClick={() => {
                    const name = window.prompt("Nom du filtre ?");
                    if (name) {
                      setPrefs({ savedFilters: [...prefs.savedFilters, { name, filter: f }] });
                      toast("Filtre enregistré");
                    }
                  }}
                >
                  <Icon name="plus" size={11} /> Enregistrer la sélection
                </button>
              </div>
            </Section>
          )}
        </div>
      </div>
      <div className="fmodal-foot">
        <Btn onClick={() => setF({})} icon="refresh">
          Tout réinitialiser
        </Btn>
        <div className="grow" />
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={() => apply(f)}>
          Appliquer
        </Btn>
      </div>
    </Modal>
  );
}

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="fsec">
      <div className="fsec-t" title={help}>
        {title}
      </div>
      {children}
    </div>
  );
}
