import { useMemo } from "react";
import { api } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { LineChart, type LineSeries } from "../components/LineChart";
import { Empty, Help, Loading, Priv, Seg, Toggle } from "../components/ui";
import type { BankrollChart as BankrollChartData } from "../lib/api";
import { Icon } from "../components/Icon";
import { cls, date, money, mult, num, tone } from "../lib/format";
import { t } from "../lib/i18n";

export const BR_SERIES = [
  { key: "real_rb", label: "Réel + RB", color: "--s-realrb", help: "Profit réel, rakeback inclus." },
  { key: "real", label: "Profit réel", color: "--s-real", help: "Gains réels − buy-ins, hors rakeback." },
  { key: "ev", label: "EV Profit", color: "--s-evp", help: "Profit attendu à partir de vos chips EV et du multiplicateur MOYEN théorique : supprime la chance aux all-in ET aux multiplicateurs." },
  { key: "ev_multi", label: "EV Multi-profit", color: "--s-evm", help: "Profit attendu à partir de vos chips EV et des multiplicateurs RÉELLEMENT tirés : supprime la chance aux all-in, garde celle des multiplicateurs." },
  { key: "ev_eff", label: "EV Profit effectif", color: "--s-eve", help: "Vos places réelles valorisées au multiplicateur moyen théorique : supprime la chance aux multiplicateurs, garde celle des all-in." },
  { key: "rakeback", label: "Rakeback", color: "--s-rb", help: "Rakeback cumulé." },
];

export function BankrollTab({ full, onFull }: { full?: boolean; onFull?: () => void }) {
  const { filter, prefs, setPrefs } = useApp();
  const axis = prefs.bankrollAxis;
  const { data, loading } = useQuery(["bankroll", filter, axis], () => api.bankrollChart(filter, axis));
  const { data: sum } = useQuery(["summary", filter], () => api.summary(filter));
  const visible = prefs.bankrollSeries;
  const offset = data && prefs.includeBankrollStart ? data.start + data.transactions : 0;
  const series: LineSeries[] = useMemo(() => {
    if (!data) return [];
    return BR_SERIES.filter((s) => visible.includes(s.key)).map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      values: (data.series.find((x) => x[0] === s.key)?.[1] ?? []).map((v) => v + (s.key === "rakeback" ? 0 : offset)),
      width: s.key === "ev" || s.key === "real_rb" ? 1.8 : 1.3,
    }));
  }, [data, visible, offset]);
  const notes = useMemo(() => {
    if (!data || !prefs.showNotes) return [];
    return data.notes.map((n) => ({ ...n, y: n.y + offset, y2: n.y2 == null ? null : n.y2 + offset }));
  }, [data, prefs.showNotes, offset]);
  if (!loading && data && data.x.length <= 1) return <Empty title={t("Aucune donnée")} sub="Aucun spin sur cette sélection." icon="filter" />;
  const ev = data?.events;
  const toggle = (k: string) => setPrefs({ bankrollSeries: visible.includes(k) ? visible.filter((x) => x !== k) : [...visible, k] });
  const fmtY = (v: number) => `${num(v, Math.abs(v) < 100 ? 1 : 0)} ${prefs.currency}`;
  return (
    <div className="br-grid">
      <div className={cls("chart-card", full ? "full" : "with-events")}>
        <div className="chart-top">
          {sum && (
            <div className="br-sum">
              {([
                ["EV Profit", sum.profit.ev, true],
                ["EV Multi", sum.profit.ev_multi, true],
                ["EV effectif", sum.profit.ev_eff, true],
                ["Réel + RB", sum.profit.real_rb, false],
              ] as [string, number, boolean][]).map(([l, v, e]) => (
                <div key={l}>
                  <span>
                    {e && <i className="evdot" />}
                    {l}
                  </span>
                  <b className={tone(v)}>
                    <Priv k="profit">{money(v)}</Priv>
                  </b>
                </div>
              ))}
            </div>
          )}
          <div className="grow" />
          <button className={cls("pill", prefs.showNotes && "on")} onClick={() => setPrefs({ showNotes: !prefs.showNotes })} title="Afficher les événements marquants sur la courbe">
            <Icon name="sparkle" size={13} /> Événements
          </button>
          <Toggle on={prefs.includeBankrollStart} onChange={(v) => setPrefs({ includeBankrollStart: v })} label="Bankroll de départ" />
          <Seg small value={axis} onChange={(v) => setPrefs({ bankrollAxis: v })} options={[{ v: "tournaments", l: t("Tournois") }, { v: "date", l: t("Date") }]} />
          {onFull && (
            <button className="pill" onClick={onFull} title={full ? "Réduire" : "Agrandir le graphique"}>
              <Icon name={full ? "x" : "layers"} size={13} /> {full ? "Réduire" : "Plein écran"}
            </button>
          )}
        </div>
        <div className="chart-area">
          {loading && !data ? (
            <Loading h={380} />
          ) : (
            data && <LineChart x={data.x} series={series} dateAxis={axis === "date"} fmtY={fmtY} notes={notes} xLabel={axis === "date" ? undefined : t("Tournois joués")} yLabel="Profit" />
          )}
        </div>
        <div className="chart-foot">
          <div className="legend">
            {BR_SERIES.map((s) => (
              <button key={s.key} className={cls("lg", visible.includes(s.key) && "on")} onClick={() => toggle(s.key)}>
                <i style={{ background: `var(${s.color})` }} />
                {s.label}
                <Help text={s.help} />
              </button>
            ))}
          </div>
        </div>
      </div>
      {!full && ev && <EventsPanel ev={ev} offset={offset} />}
    </div>
  );
}

interface EvItem {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  onClick?: () => void;
  gold?: boolean;
}

/** Événements marquants, avec trois dispositions au choix. */
function EventsPanel({ ev, offset }: { ev: NonNullable<BankrollChartData>["events"]; offset: number }) {
  const { prefs, setPrefs, open } = useApp();
  const layout = prefs.eventsLayout;
  const items: EvItem[] = [
    { icon: "sparkle", label: "Plus gros upswing", value: money(ev.upswing.amount), tone: "pos", sub: `${ev.upswing.to - ev.upswing.from} spins` },
    { icon: "thumbdown", label: "Plus gros downswing", value: money(-ev.downswing.amount), tone: "neg", sub: `${ev.downswing.to - ev.downswing.from} spins` },
    { icon: "target", label: "Depuis le dernier sommet", value: `${num(ev.since_peak)} spins`, sub: money(-ev.current_drawdown), tone: ev.current_drawdown > 0 ? "neg" : "pos" },
    { icon: "crown", label: "Plus haut", value: money(ev.peak[1] + offset), tone: "pos", sub: `spin #${ev.peak[0]}` },
    { icon: "skull", label: "Plus bas", value: money(ev.low[1] + offset), tone: "neg", sub: `spin #${ev.low[0]}` },
    { icon: "clock", label: "Break-even le plus long", value: `${num(ev.longest_break_even.amount)} spins`, sub: `jusqu'au spin #${ev.longest_break_even.to}` },
    { icon: "calendar", label: "Meilleure journée", value: money(ev.best_day[1]), tone: "pos", sub: date(ev.best_day[0]) },
    { icon: "calendar", label: "Pire journée", value: money(ev.worst_day[1]), tone: "neg", sub: date(ev.worst_day[0]) },
    { icon: "flame", label: "Séries", value: `${ev.best_streak} victoires`, sub: `${ev.worst_streak} défaites d'affilée` },
    ...ev.jackpots
      .slice()
      .reverse()
      .slice(0, 8)
      .map((j) => ({
        icon: "star",
        label: `Jackpot ${mult(j.mult)}`,
        value: money(j.won),
        tone: tone(j.won),
        sub: date(j.ts),
        gold: true,
        onClick: () => open({ type: "tournament", id: j.tid }),
      })),
  ];
  const hero = items.slice(0, 3);
  const rest = items.slice(3);
  return (
    <div className="ev-wrap">
      <div className="ev-head">
        <h3>Événements marquants</h3>
        <Help text="Ces repères sont aussi tracés directement sur la courbe. La disposition choisie est conservée." />
        <div className="grow" />
        <Seg
          small
          value={layout}
          onChange={(v) => setPrefs({ eventsLayout: v })}
          options={[
            { v: "vedette", l: "Vedette" },
            { v: "compact", l: "Compact" },
            { v: "liste", l: "Liste" },
          ]}
        />
      </div>
      {layout === "vedette" ? (
        <div className="ev-hero-wrap">
          <div className="ev-hero">
            {hero.map((i) => (
              <EvCard key={i.label} {...i} big />
            ))}
          </div>
          <div className="ev-mini">
            {rest.map((i) => (
              <EvCard key={i.label + i.sub} {...i} mini />
            ))}
          </div>
        </div>
      ) : layout === "liste" ? (
        <div className="ev-list">
          {items.map((i) => (
            <EvCard key={i.label + i.sub} {...i} mini />
          ))}
        </div>
      ) : (
        <div className="ev-strip">
          {items.map((i) => (
            <EvCard key={i.label + i.sub} {...i} />
          ))}
        </div>
      )}
    </div>
  );
}

function EvCard({ icon, label, value, sub, tone: tn, onClick, gold, big, mini }: EvItem & { big?: boolean; mini?: boolean }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={cls("ev-item", big && "big", mini && "mini", onClick && "jp")} onClick={onClick}>
      <span className={cls("ev-ic", gold && "gold")}>
        <Icon name={icon} size={big ? 18 : 15} />
      </span>
      <div className="ev-t">
        <span>{label}</span>
        {sub && <small>{sub}</small>}
      </div>
      <b className={tn}>
        <Priv k="profit">{value}</Priv>
      </b>
    </Tag>
  );
}
