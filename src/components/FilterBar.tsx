import { useState } from "react";
import { useApp } from "../lib/state";
import { Btn, Modal } from "./ui";
import { Icon } from "./Icon";
import { date, fromInputDate, mult, todayNaive, toInputDate, cls, nowNaive } from "../lib/format";
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
  (filter.buyins ?? []).forEach((b) => chips.push({ key: `b${b}`, label: `${b} ${prefs.currency}`, clear: () => set({ buyins: (filter.buyins ?? []).filter((x) => x !== b) }) }));
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

/** Pop-up centrale regroupant tous les filtres. */
export function FilterModal({ onClose }: { onClose: () => void }) {
  const { filter, setFilter, overview, settings, prefs, setPrefs, toast } = useApp();
  const [f, setF] = useState<Filter>(filter);
  const set = (p: Partial<Filter>) => setF({ ...f, ...p });
  const toggle = <T,>(arr: T[] | undefined, v: T) => ((arr ?? []).includes(v) ? (arr ?? []).filter((x) => x !== v) : [...(arr ?? []), v]);
  const preset = activePreset(f);
  const buyins = overview?.buyins ?? [];
  const rooms = overview?.rooms ?? [];
  const mults = overview?.multipliers ?? [];
  const apply = (nf: Filter) => {
    setFilter(nf);
    onClose();
  };
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
      <div className="fmodal">
        <Section title="Période">
          <div className="fchips">
            {PRESETS.map(([k, l, fn]) => (
              <button key={k} className={cls("fchip", preset === k && "on")} onClick={() => set(fn())}>
                {l}
              </button>
            ))}
          </div>
          <div className="row gap12 wrap" style={{ marginTop: 10 }}>
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

        {buyins.length > 1 && (
          <Section title="Buy-in">
            <div className="fchips">
              {buyins.map((b) => (
                <button key={b} className={cls("fchip", (f.buyins ?? []).includes(b) && "on")} onClick={() => set({ buyins: toggle(f.buyins, b) })}>
                  {b} {prefs.currency}
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title="Position (mains)" help="Filtre les courbes de jetons sur les mains jouées dans ces positions.">
          <div className="fchips">
            {SCENARIOS.map((s) => (
              <button key={s} className={cls("fchip", (f.scenarios ?? []).includes(s) && "on")} onClick={() => set({ scenarios: toggle(f.scenarios, s) })}>
                {s}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Multiplicateur">
          <div className="row gap8">
            <select className="sel" value={f.mult_min ?? ""} onChange={(e) => set({ mult_min: e.target.value ? +e.target.value : null })}>
              <option value="">min</option>
              {mults.map((m) => (
                <option key={m} value={m}>
                  {mult(m)}
                </option>
              ))}
            </select>
            <span className="muted">→</span>
            <select className="sel" value={f.mult_max ?? ""} onChange={(e) => set({ mult_max: e.target.value ? +e.target.value : null })}>
              <option value="">max</option>
              {mults.map((m) => (
                <option key={m} value={m}>
                  {mult(m)}
                </option>
              ))}
            </select>
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

        <Section title="Tables simultanées">
          <div className="fchips">
            {[1, 2, 3, 4, 5, 6].map((k) => (
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

        <Section title="Jour de la semaine">
          <div className="fchips">
            {WEEKDAYS.map((d, k) => (
              <button key={k} className={cls("fchip", (f.weekdays ?? []).includes(k) && "on")} onClick={() => set({ weekdays: toggle(f.weekdays, k) })}>
                {d.slice(0, 3)}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Heure de jeu">
          <div className="fchips hours">
            {Array.from({ length: 24 }, (_, h) => (
              <button key={h} className={cls("fchip", (f.hours ?? []).includes(h) && "on")} onClick={() => set({ hours: toggle(f.hours, h) })}>
                {String(h).padStart(2, "0")}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Adversaires">
          <div className="row gap12 wrap">
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
          <Section title="Room & pseudo">
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

        <Section title="Filtres enregistrés">
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
