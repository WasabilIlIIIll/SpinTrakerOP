import { useMemo, useState, type ReactNode } from "react";
import { api, type Row } from "../lib/api";
import { ALL_STATS_SECTIONS, useApp, useQuery } from "../lib/state";
import { BarChart } from "../components/BarChart";
import { Btn, Dropdown, Loading, Panel, Priv, Seg, Stat } from "../components/ui";
import { Icon } from "../components/Icon";
import { cls, date, duration, money, mult, num, pct, time, tone } from "../lib/format";
import { t } from "../lib/i18n";

const EV_MODES = [
  { v: "ev", l: "EV Profit" },
  { v: "ev_multi", l: "EV Multi" },
  { v: "ev_eff", l: "EV effectif" },
  { v: "real_rb", l: "Réel + RB" },
] as const;
type EvMode = (typeof EV_MODES)[number]["v"];

const GROUPS: [string, string][] = [
  ["month", "Mois"],
  ["week", "Semaine"],
  ["day", "Jour"],
  ["year", "Année"],
  ["buyin", "Buy-in"],
  ["multiplier", "Multiplicateur"],
  ["room", "Room"],
  ["tables", "Tables"],
  ["hour", "Heure"],
  ["weekday", "Jour de semaine"],
];

/** Blocs disponibles : titre et largeur par défaut (sur 6 colonnes). */
export const WIDGETS: Record<string, { title: string; w: number }> = {
  tiles: { title: "Synthèse", w: 6 },
  position: { title: "CEV par position", w: 6 },
  sessions: { title: "Sessions", w: 6 },
  results: { title: "Résultats groupés", w: 3 },
  multipliers: { title: "Multiplicateurs", w: 3 },
  multitabling: { title: "Multi-tabling", w: 2 },
  finishers: { title: "Finishers", w: 2 },
  profile: { title: "CEV par profil de table", w: 2 },
  stack: { title: "Winrate par tapis", w: 3 },
  hours: { title: "Performance par heure", w: 3 },
  weekdays: { title: "Performance par jour", w: 3 },
};

const WIDTHS: [number, string][] = [
  [2, "⅓"],
  [3, "½"],
  [4, "⅔"],
  [6, "Plein"],
];

/** Détails affichés au survol d'une barre issue d'une ligne de résultats. */
function rowDetails(r: Row): string[] {
  return [
    `${num(r.spins)} spins · ${num(r.hands)} mains`,
    `CEV ${num(r.cev, 1)} ± ${num(r.cev_ci, 0)}`,
    `EV profit ${money(r.ev)} · ${money(r.ev_hour)}/h`,
    `Réel + RB ${money(r.profit + r.rakeback)} · ${num(r.hours, 1)} h`,
  ];
}

export function StatsTab() {
  const { prefs, setPrefs } = useApp();
  const [edit, setEdit] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const order = prefs.statsSections.filter((id) => WIDGETS[id]);
  const hidden = ALL_STATS_SECTIONS.filter((id) => !order.includes(id));
  const width = (id: string) => prefs.statsWidths[id] ?? WIDGETS[id].w;
  const move = (from: string, to: string) => {
    if (from === to) return;
    const n = order.filter((x) => x !== from);
    n.splice(n.indexOf(to), 0, from);
    setPrefs({ statsSections: n });
  };
  return (
    <div className="stats">
      <div className="row gap8" style={{ justifyContent: "flex-end" }}>
        {edit && hidden.length > 0 && (
          <Dropdown label={<><Icon name="plus" size={13} /> Ajouter un bloc</>} align="right" closeOnClick>
            <div className="dd-list">
              {hidden.map((id) => (
                <button key={id} className="dd-item" onClick={() => setPrefs({ statsSections: [...order, id] })}>
                  {WIDGETS[id].title}
                </button>
              ))}
            </div>
          </Dropdown>
        )}
        {edit && (
          <Btn small icon="refresh" onClick={() => setPrefs({ statsSections: ALL_STATS_SECTIONS, statsWidths: {} })}>
            Disposition par défaut
          </Btn>
        )}
        <Btn small kind={edit ? "primary" : "ghost"} icon={edit ? "check" : "grip"} onClick={() => setEdit(!edit)}>
          {edit ? "Terminer" : "Personnaliser la disposition"}
        </Btn>
      </div>
      <div className={cls("widgets", edit && "editing")}>
        {order.map((id) => (
          <div
            key={id}
            className={cls("widget", drag === id && "dragging")}
            style={{ gridColumn: `span ${width(id)}` }}
            draggable={edit}
            onDragStart={() => setDrag(id)}
            onDragOver={(e) => {
              if (!edit || !drag) return;
              e.preventDefault();
              move(drag, id);
            }}
            onDragEnd={() => setDrag(null)}
          >
            {edit && (
              <div className="widget-bar">
                <Icon name="grip" size={14} />
                <span>{WIDGETS[id].title}</span>
                <div className="grow" />
                {WIDTHS.map(([w, l]) => (
                  <button key={w} className={cls("wbtn", width(id) === w && "on")} onClick={() => setPrefs({ statsWidths: { ...prefs.statsWidths, [id]: w } })}>
                    {l}
                  </button>
                ))}
                <button className="wbtn" title="Masquer ce bloc" onClick={() => setPrefs({ statsSections: order.filter((x) => x !== id) })}>
                  <Icon name="x" size={12} />
                </button>
              </div>
            )}
            <Widget id={id} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Widget({ id }: { id: string }): ReactNode {
  switch (id) {
    case "tiles":
      return <TilesPanel />;
    case "position":
      return <PositionPanel />;
    case "sessions":
      return <SessionsPanel />;
    case "results":
      return <ResultsPanel />;
    case "profile":
      return <ProfilePanel />;
    case "multitabling":
      return <MultiTablingPanel />;
    case "finishers":
      return <FinishersPanel />;
    case "multipliers":
      return <MultipliersPanel />;
    case "stack":
      return <StackPanel />;
    case "hours":
      return <TimePanel group="hour" title="Performance par heure" />;
    case "weekdays":
      return <TimePanel group="weekday" title="Performance par jour" />;
    default:
      return null;
  }
}

function TilesPanel() {
  const { filter } = useApp();
  const [mode, setMode] = useState<EvMode>("ev");
  const { data: s } = useQuery(["summary", filter], () => api.summary(filter));
  const evLabel = EV_MODES.find((m) => m.v === mode)!.l;
  if (!s) return <Loading h={90} />;
  return (
    <div className="tiles-wrap">
      <div className="tiles">
        <Stat label={t("Buy-in moyen")} value={money(s.avg_buyin)} />
        <Stat label={t("Temps joué")} value={duration(s.seconds)} sub={`${num(s.avg_tables, 1)} tables en moyenne`} />
        <Stat label={t("Spins/h")} value={num(s.spins_per_hour, 1)} sub={`${num(s.hands_per_spin, 1)} mains / spin`} />
        <Stat label={<><i className="evdot" />ROI {evLabel}</>} value={pct(s.roi[mode])} tone={tone(s.roi[mode])} k="profit" />
        <Stat label={<><i className="evdot" />{evLabel} /heure</>} value={`${money(s.hourly[mode])} /h`} tone={tone(s.hourly[mode])} k="profit" />
      </div>
      <div className="tiles-mode">
        <Seg small value={mode} onChange={setMode} options={EV_MODES.map((m) => ({ v: m.v, l: m.l }))} />
      </div>
    </div>
  );
}

function SeriesPick({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const opts = [
    ["chips", "Chips réels", "--s-nsd"],
    ["ev", "EV (chips)", "--s-ev"],
  ];
  return (
    <Dropdown label={<><span className="dots2">{value.map((v) => <i key={v} style={{ background: `var(${opts.find((o) => o[0] === v)![2]})` }} />)}</span>{value.length} série{value.length > 1 ? "s" : ""}</>} align="right">
      <div className="dd-list">
        {opts.map(([k, l, c]) => (
          <button key={k} className={cls("dd-item", value.includes(k) && "on")} onClick={() => onChange(value.includes(k) ? (value.length > 1 ? value.filter((x) => x !== k) : value) : [...value, k])}>
            <i className="dot" style={{ background: `var(${c})` }} /> {l} {value.includes(k) && <Icon name="check" size={13} />}
          </button>
        ))}
      </div>
    </Dropdown>
  );
}

function PositionPanel() {
  const { filter } = useApp();
  const [per, setPer] = useState<"hand" | "tournament">("tournament");
  const [ser, setSer] = useState(["chips", "ev"]);
  const { data } = useQuery(["pos", filter, per], () => api.byPosition(filter, per));
  const groups = useMemo(() => {
    if (!data) return [];
    const g = [];
    if (ser.includes("chips")) g.push({ label: "Chips", color: "var(--s-nsd)", values: data.map((d) => d.chips), ci: data.map((d) => d.chips_ci) });
    if (ser.includes("ev")) g.push({ label: "CEV", color: "var(--s-ev)", values: data.map((d) => d.ev), ci: data.map((d) => d.ev_ci) });
    return g;
  }, [data, ser]);
  return (
    <Panel
      title={t("CEV par position")}
      help="Contribution de chaque position au CEV. « Par tournoi » : jetons gagnés dans cette position divisés par le nombre de tournois (la somme des barres CEV = votre CEV). « Par main » : moyenne par main jouée. Barres d'erreur : IC 95 %."
      right={
        <>
          <Seg small value={per} onChange={setPer} options={[{ v: "hand", l: "Par main" }, { v: "tournament", l: "Par tournoi" }]} />
          <SeriesPick value={ser} onChange={setSer} />
        </>
      }
    >
      {data ? (
        <BarChart
          categories={data.map((d) => d.key)}
          sub={data.map((d) => `${num(d.hands)} mains`)}
          details={data.map((d) => [`${num(d.hands)} mains jouées`, `sur ${num(d.count)} spins`, per === "hand" ? "valeurs : jetons par main" : "valeurs : jetons par spin"])}
          groups={groups}
          height={330}
        />
      ) : (
        <Loading h={330} />
      )}
    </Panel>
  );
}

function SessionsPanel() {
  const { filter } = useApp();
  const [gap, setGap] = useState(30);
  const { data } = useQuery(["sessions", filter, gap], () => api.sessions(filter, gap));
  return (
    <Panel
      title="Sessions"
      help="Une session regroupe des spins joués sans pause plus longue que le seuil choisi."
      right={
        <Seg
          small
          value={String(gap)}
          onChange={(v) => setGap(+v)}
          options={[
            { v: "15", l: "Pause 15 min" },
            { v: "30", l: "30 min" },
            { v: "60", l: "1 h" },
          ]}
        />
      }
      pad={false}
    >
      <div className="tbl-wrap" style={{ maxHeight: 330 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Session</th>
              <th className="r">Durée</th>
              <th className="r">Spins</th>
              <th className="r">Tables</th>
              <th className="r">CEV</th>
              <th className="r">
                <i className="evdot" />
                EV profit
              </th>
              <th className="r">EV / h</th>
              <th className="r">Réel + RB</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).slice(0, 200).map((s) => (
              <tr key={s.start}>
                <td>
                  {date(s.start)} <span className="muted small">{time(s.start)} → {time(s.end)}</span>
                </td>
                <td className="r">{duration(s.seconds)}</td>
                <td className="r">{num(s.spins)}</td>
                <td className="r">{num(s.tables, 1)}</td>
                <td className={cls("r", tone(s.cev))}>{num(s.cev, 0)}</td>
                <td className={cls("r", tone(s.ev))}>
                  <Priv k="profit">{money(s.ev)}</Priv>
                </td>
                <td className={cls("r", tone(s.ev_hour))}>
                  <Priv k="profit">{money(s.ev_hour)}</Priv>
                </td>
                <td className={cls("r", tone(s.profit))}>
                  <Priv k="profit">{money(s.profit)}</Priv>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ResultsPanel() {
  const { filter } = useApp();
  const [group, setGroup] = useState("month");
  const [asc, setAsc] = useState(true);
  const { data } = useQuery(["results", filter, group], () => api.resultsBy(filter, group));
  const rows = useMemo(() => (data ? (asc ? data : [...data].reverse()) : []), [data, asc]);
  const total = useMemo(() => {
    if (!data) return null;
    return data.reduce((a, r) => ({ spins: a.spins + r.spins, profit: a.profit + r.profit, rakeback: a.rakeback + r.rakeback, ev: a.ev + r.ev }), { spins: 0, profit: 0, rakeback: 0, ev: 0 });
  }, [data]);
  return (
    <Panel
      title={t("Résultats")}
      right={
        <select value={group} onChange={(e) => setGroup(e.target.value)} className="sel">
          {GROUPS.map(([k, l]) => (
            <option key={k} value={k}>
              Résultat par {l.toLowerCase()}
            </option>
          ))}
        </select>
      }
      pad={false}
    >
      <div className="tbl-wrap" style={{ maxHeight: 330 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th onClick={() => setAsc(!asc)} className="sortable">
                {GROUPS.find((g) => g[0] === group)?.[1]} {asc ? "↑" : "↓"}
              </th>
              <th className="r">Spins</th>
              <th className="r">CEV</th>
              <th className="r">Profit hors RB</th>
              <th className="r">Rakeback</th>
              <th className="r">
                <i className="evdot" />
                EV Profit
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: Row) => (
              <tr key={r.key} title={rowDetails(r).join("\n")}>
                <td>{r.key}</td>
                <td className="r">{num(r.spins)}</td>
                <td className={cls("r", tone(r.cev))}>{num(r.cev, 1)}</td>
                <td className={cls("r", tone(r.profit))}>
                  <Priv k="profit">{money(r.profit)}</Priv>
                </td>
                <td className="r">
                  <Priv k="profit">{money(r.rakeback)}</Priv>
                </td>
                <td className={cls("r", tone(r.ev))}>
                  <Priv k="profit">{money(r.ev)}</Priv>
                </td>
              </tr>
            ))}
          </tbody>
          {total && (
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="r">{num(total.spins)}</td>
                <td />
                <td className={cls("r", tone(total.profit))}>
                  <Priv k="profit">{money(total.profit)}</Priv>
                </td>
                <td className="r">
                  <Priv k="profit">{money(total.rakeback)}</Priv>
                </td>
                <td className={cls("r", tone(total.ev))}>
                  <Priv k="profit">{money(total.ev)}</Priv>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Panel>
  );
}

function ProfilePanel() {
  const { filter } = useApp();
  const { data } = useQuery(["profile", filter], () => api.byProfile(filter));
  const top = (data ?? []).slice(0, 8);
  return (
    <Panel title={t("CEV par profil de table")} help="CEV selon les tags des deux adversaires du tournoi (tags automatiques ou manuels, voir Joueurs → Tags).">
      {data ? (
        top.length ? (
          <BarChart
            categories={top.map((d) => d.key)}
            sub={top.map((d) => `${d.count} spins`)}
            details={top.map((d) => [`${num(d.count)} spins · ${num(d.hands)} mains`, `Chips réels ${num(d.chips, 0)} / spin`])}
            groups={[{ label: "CEV", color: "var(--accent)", values: top.map((d) => d.ev), ci: top.map((d) => d.ev_ci) }]}
            height={300}
            fmt={(v) => num(v, 0)}
          />
        ) : (
          <div className="muted small">Pas assez de données.</div>
        )
      ) : (
        <Loading h={300} />
      )}
    </Panel>
  );
}

function MultiTablingPanel() {
  const { filter } = useApp();
  const [metric, setMetric] = useState<"ev_hour" | "real_hour" | "spins_hour" | "cev">("ev_hour");
  const { data } = useQuery(["results", filter, "tables"], () => api.resultsBy(filter, "tables"));
  const unit = metric === "ev_hour" || metric === "real_hour" ? " €/h" : metric === "spins_hour" ? " spins/h" : "";
  const labels: Record<string, string> = { ev_hour: "EV €/h", real_hour: "Réel €/h", spins_hour: "Spins/h", cev: "CEV" };
  return (
    <Panel
      title={t("Multi-tabling")}
      help="Nombre de tables jouées en même temps (moyenne pondérée par le temps, déduite du chevauchement des tournois). €/h = profit du groupe / (durée des tournois ÷ nombre de tables)."
      right={
        <select className="sel" value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)}>
          <option value="ev_hour">EV Profit en €/h</option>
          <option value="real_hour">Réel + RB en €/h</option>
          <option value="spins_hour">Spins / heure</option>
          <option value="cev">CEV</option>
        </select>
      }
    >
      {data ? (
        <BarChart
          categories={data.map((d) => d.key)}
          sub={data.map((d) => `${d.spins} spins`)}
          details={data.map(rowDetails)}
          groups={[{ label: labels[metric], color: "var(--pos)", values: data.map((d) => d[metric]), ci: metric === "cev" ? data.map((d) => d.cev_ci) : undefined }]}
          height={300}
          fmt={(v) => `${num(v, Math.abs(v) < 10 ? 1 : 0)}${unit}`}
        />
      ) : (
        <Loading h={300} />
      )}
    </Panel>
  );
}

function FinishersPanel() {
  const { filter } = useApp();
  const { data: s } = useQuery(["summary", filter], () => api.summary(filter));
  if (!s) return <Loading h={260} />;
  const n = s.tournaments;
  return (
    <Panel title={t("Finishers")} help="Répartition réelle des places comparée à celle attendue d'après votre CEV (modèle Malmuth-Harville).">
      <BarChart
        categories={["1er", "2e", "3e"]}
        sub={s.finish.map((f) => `${num((f / 100) * n)} spins`)}
        details={s.finish.map((f, i) => [`${num((f / 100) * n)} spins réels`, `${num((s.finish_expected[i] / 100) * n, 0)} attendus d'après le CEV`])}
        groups={[
          { label: "Réel", color: "var(--accent)", values: s.finish },
          { label: "Attendu", color: "var(--faint)", values: s.finish_expected },
        ]}
        height={260}
        fmt={(v) => `${num(v, 1)}%`}
      />
    </Panel>
  );
}

function MultipliersPanel() {
  const { filter } = useApp();
  const { data } = useQuery(["mults", filter], () => api.multipliers(filter));
  return (
    <Panel title={t("Multiplicateurs")} help="Nombre de multiplicateurs tirés comparé au nombre attendu (table de probabilités éditable dans Paramètres)." pad={false}>
      <div className="tbl-wrap" style={{ maxHeight: 320 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Multi</th>
              <th className="r">Réel</th>
              <th className="r">Attendu</th>
              <th className="r">Écart</th>
              <th className="r">Fréq.</th>
              <th className="r">Victoires</th>
              <th className="r">CEV</th>
              <th className="r">Profit</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((m) => (
              <tr key={m.mult}>
                <td>
                  <span className={cls("mult", m.mult >= 10 && "mult-hi")}>{m.mult > 0 ? mult(m.mult) : "x?"}</span>
                </td>
                <td className="r">{num(m.count)}</td>
                <td className="r muted">{num(m.expected, m.expected < 10 ? 2 : 0)}</td>
                <td className={cls("r", tone(m.count - m.expected))}>{signed(m.count - m.expected)}</td>
                <td className="r">
                  {pct(m.freq, 2)} <span className="muted small">/ {pct(m.expected_freq, 2)}</span>
                </td>
                <td className="r">{m.count ? pct((m.wins / m.count) * 100, 0) : "–"}</td>
                <td className={cls("r", tone(m.cev))}>{m.count ? num(m.cev, 0) : "–"}</td>
                <td className={cls("r", tone(m.profit))}>
                  <Priv k="profit">{m.count ? money(m.profit) : "–"}</Priv>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function signed(v: number) {
  return `${v > 0 ? "+" : ""}${num(v, Math.abs(v) < 10 ? 1 : 0)}`;
}

function StackPanel() {
  const { filter } = useApp();
  const { data } = useQuery(["stack", filter], () => api.byStack(filter));
  return (
    <Panel title="Winrate par tapis effectif" help="bb/100 mains selon le tapis effectif en début de main (chips réels et CEV).">
      {data ? (
        <BarChart
          categories={data.map((d) => d.key)}
          sub={data.map((d) => `${num(d.hands)}`)}
          details={data.map((d) => [`${num(d.hands)} mains`, `IC 95 % CEV ± ${num(d.ev_ci, 0)} bb/100`])}
          groups={[
            { label: "Chips", color: "var(--s-nsd)", values: data.map((d) => d.chips) },
            { label: "CEV", color: "var(--s-ev)", values: data.map((d) => d.ev) },
          ]}
          height={280}
          fmt={(v) => num(v, 0)}
        />
      ) : (
        <Loading h={280} />
      )}
    </Panel>
  );
}

function TimePanel({ group, title }: { group: string; title: string }) {
  const { filter } = useApp();
  const [metric, setMetric] = useState<"cev" | "ev_hour" | "spins">("cev");
  const { data } = useQuery(["results", filter, group], () => api.resultsBy(filter, group));
  const labels = { cev: "CEV", ev_hour: "EV €/h", spins: "Spins" };
  return (
    <Panel
      title={title}
      right={
        <Seg
          small
          value={metric}
          onChange={setMetric}
          options={[
            { v: "cev", l: "CEV" },
            { v: "ev_hour", l: "€/h" },
            { v: "spins", l: "Volume" },
          ]}
        />
      }
    >
      {data ? (
        <BarChart
          categories={data.map((d) => (group === "weekday" ? d.key.slice(0, 3) : d.key))}
          details={data.map(rowDetails)}
          groups={[{ label: labels[metric], color: "var(--gold)", values: data.map((d) => d[metric]), ci: metric === "cev" ? data.map((d) => d.cev_ci) : undefined }]}
          height={260}
          fmt={(v) => num(v, 0)}
        />
      ) : (
        <Loading h={260} />
      )}
    </Panel>
  );
}
