import { useMemo, useState } from "react";
import { api, type Row } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { BarChart } from "../components/BarChart";
import { Dropdown, Loading, Panel, Priv, Seg, Stat } from "../components/ui";
import { Icon } from "../components/Icon";
import { cls, duration, money, mult, num, pct, tone } from "../lib/format";
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

export function StatsTab() {
  const { filter, prefs } = useApp();
  const [mode, setMode] = useState<EvMode>("ev");
  const { data: s } = useQuery(["summary", filter], () => api.summary(filter));
  const sec = prefs.statsSections;
  const evLabel = EV_MODES.find((m) => m.v === mode)!.l;
  return (
    <div className="stats">
      {sec.includes("tiles") && s && (
        <div className="tiles">
          <Stat label={t("Buy-in moyen")} value={money(s.avg_buyin)} />
          <Stat label={t("Temps joué")} value={duration(s.seconds)} sub={`${num(s.avg_tables, 1)} tables en moyenne`} />
          <Stat label={t("Spins/h")} value={num(s.spins_per_hour, 1)} sub={`${num(s.hands_per_spin, 1)} mains / spin`} />
          <Stat
            label={
              <>
                <i className="evdot" />
                ROI {evLabel}
              </>
            }
            value={pct(s.roi[mode])}
            tone={tone(s.roi[mode])}
            k="profit"
          />
          <Stat
            label={
              <>
                <i className="evdot" />
                {evLabel} /heure
              </>
            }
            value={`${money(s.hourly[mode])} /h`}
            tone={tone(s.hourly[mode])}
            k="profit"
          />
          <div className="tiles-mode">
            <Seg small value={mode} onChange={setMode} options={EV_MODES.map((m) => ({ v: m.v, l: m.l }))} />
          </div>
        </div>
      )}
      <div className="stats-grid">
        {sec.includes("position") && <PositionPanel />}
        {sec.includes("results") && <ResultsPanel />}
        {sec.includes("profile") && <ProfilePanel />}
        {sec.includes("multitabling") && <MultiTablingPanel />}
        {sec.includes("finishers") && s && <FinishersPanel finish={s.finish} expected={s.finish_expected} n={s.tournaments} />}
        {sec.includes("multipliers") && <MultipliersPanel />}
        {sec.includes("stack") && <StackPanel />}
        {sec.includes("hours") && <TimePanel group="hour" title="Performance par heure" />}
        {sec.includes("weekdays") && <TimePanel group="weekday" title="Performance par jour" />}
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
    if (ser.includes("ev")) g.push({ label: "EV", color: "var(--s-ev)", values: data.map((d) => d.ev), ci: data.map((d) => d.ev_ci) });
    return g;
  }, [data, ser]);
  return (
    <Panel
      title={t("CEV par position")}
      help="Contribution de chaque position au CEV. « Par tournoi » : jetons gagnés dans cette position divisés par le nombre de tournois (la somme des barres EV = votre CEV). « Par main » : moyenne par main jouée. Barres d'erreur : IC 95 %."
      className="span2"
      right={
        <>
          <Seg small value={per} onChange={setPer} options={[{ v: "hand", l: "Par main" }, { v: "tournament", l: "Par tournoi" }]} />
          <SeriesPick value={ser} onChange={setSer} />
        </>
      }
    >
      {data ? <BarChart categories={data.map((d) => d.key)} sub={data.map((d) => `${num(d.hands)} mains`)} groups={groups} height={330} /> : <Loading h={330} />}
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
    return data.reduce(
      (a, r) => ({ spins: a.spins + r.spins, profit: a.profit + r.profit, rakeback: a.rakeback + r.rakeback, ev: a.ev + r.ev }),
      { spins: 0, profit: 0, rakeback: 0, ev: 0 },
    );
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
              <tr key={r.key}>
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
          <BarChart categories={top.map((d) => d.key)} sub={top.map((d) => `${d.count} spins`)} groups={[{ label: "EV", color: "var(--accent)", values: top.map((d) => d.ev), ci: top.map((d) => d.ev_ci) }]} height={300} fmt={(v) => num(v, 0)} />
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
          groups={[{ label: metric, color: "var(--pos)", values: data.map((d) => d[metric]), ci: metric === "cev" ? data.map((d) => d.cev_ci) : undefined }]}
          height={300}
          fmt={(v) => `${num(v, Math.abs(v) < 10 ? 1 : 0)}${unit}`}
        />
      ) : (
        <Loading h={300} />
      )}
    </Panel>
  );
}

function FinishersPanel({ finish, expected, n }: { finish: number[]; expected: number[]; n: number }) {
  return (
    <Panel title={t("Finishers")} help="Répartition réelle des places comparée à celle attendue d'après votre CEV (modèle Malmuth-Harville).">
      <BarChart
        categories={["1er", "2e", "3e"]}
        sub={finish.map((f) => `${num((f / 100) * n)} spins`)}
        groups={[
          { label: "Réel", color: "var(--accent)", values: finish },
          { label: "Attendu", color: "var(--faint)", values: expected },
        ]}
        height={260}
        fmt={(v) => `${num(v, 1)}%`}
      />
      <div className="legend-inline">
        <span>
          <i style={{ background: "var(--accent)" }} />
          Réel
        </span>
        <span>
          <i style={{ background: "var(--faint)" }} />
          Attendu (CEV)
        </span>
      </div>
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
                  <span className={cls("mult", m.mult >= 10 && "mult-hi")}>{mult(m.mult)}</span>
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
    <Panel title="Winrate par tapis effectif" help="bb/100 mains selon le tapis effectif en début de main (chips réels et EV).">
      {data ? (
        <BarChart
          categories={data.map((d) => d.key)}
          sub={data.map((d) => `${num(d.hands)}`)}
          groups={[
            { label: "Chips", color: "var(--s-nsd)", values: data.map((d) => d.chips) },
            { label: "EV", color: "var(--s-ev)", values: data.map((d) => d.ev) },
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
          groups={[{ label: metric, color: "var(--gold)", values: data.map((d) => d[metric]), ci: metric === "cev" ? data.map((d) => d.cev_ci) : undefined }]}
          height={260}
          fmt={(v) => num(v, 0)}
        />
      ) : (
        <Loading h={260} />
      )}
    </Panel>
  );
}
