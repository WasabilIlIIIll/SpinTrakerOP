import { useMemo } from "react";
import { api } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { LineChart, type LineSeries } from "../components/LineChart";
import { ChartFilters } from "../components/ChartFilters";
import { Empty, Help, Loading, Priv, Seg, Toggle } from "../components/ui";
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
  const { filter, prefs, setPrefs, open } = useApp();
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
      <div className={cls("chart-card", full && "full")}>
        <ChartFilters full={full} onFull={onFull} />
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
          <Toggle on={prefs.includeBankrollStart} onChange={(v) => setPrefs({ includeBankrollStart: v })} label="Bankroll de départ" />
          <Seg small value={axis} onChange={(v) => setPrefs({ bankrollAxis: v })} options={[{ v: "tournaments", l: t("Tournois") }, { v: "date", l: t("Date") }]} />
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
          <div className="grow" />
          <button className={cls("lg", prefs.showNotes && "on")} onClick={() => setPrefs({ showNotes: !prefs.showNotes })}>
            <Icon name="sparkle" size={13} /> Événements
          </button>
        </div>
      </div>
      {!full && ev && (
        <div className="ev-strip">
          <Ev icon="sparkle" label="Plus gros upswing" value={money(ev.upswing.amount)} tone="pos" sub={`${ev.upswing.to - ev.upswing.from} spins`} />
          <Ev icon="thumbdown" label="Plus gros downswing" value={money(-ev.downswing.amount)} tone="neg" sub={`${ev.downswing.to - ev.downswing.from} spins`} />
          <Ev icon="crown" label="Plus haut" value={money(ev.peak[1] + offset)} tone="pos" sub={`spin #${ev.peak[0]}`} />
          <Ev icon="skull" label="Plus bas" value={money(ev.low[1] + offset)} tone="neg" sub={`spin #${ev.low[0]}`} />
          <Ev icon="clock" label="Break-even le plus long" value={`${num(ev.longest_break_even.amount)} spins`} sub={`jusqu'au spin #${ev.longest_break_even.to}`} />
          <Ev icon="target" label="Depuis le dernier sommet" value={`${num(ev.since_peak)} spins`} sub={money(-ev.current_drawdown)} tone={ev.current_drawdown > 0 ? "neg" : "pos"} />
          <Ev icon="calendar" label="Meilleure journée" value={money(ev.best_day[1])} tone="pos" sub={date(ev.best_day[0])} />
          <Ev icon="calendar" label="Pire journée" value={money(ev.worst_day[1])} tone="neg" sub={date(ev.worst_day[0])} />
          <Ev icon="flame" label="Séries" value={`${ev.best_streak} victoires`} sub={`${ev.worst_streak} défaites d'affilée`} />
          {ev.jackpots
            .slice()
            .reverse()
            .slice(0, 6)
            .map((j) => (
              <button key={j.tid} className="ev-item jp" onClick={() => open({ type: "tournament", id: j.tid })}>
                <span className="ev-ic gold">
                  <Icon name="star" size={15} />
                </span>
                <div className="ev-t">
                  <span>Jackpot {mult(j.mult)}</span>
                  <small>{date(j.ts)}</small>
                </div>
                <b className={tone(j.won)}>
                  <Priv k="profit">{money(j.won)}</Priv>
                </b>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function Ev({ icon, label, value, sub, tone: tn }: { icon: string; label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="ev-item">
      <span className="ev-ic">
        <Icon name={icon} size={15} />
      </span>
      <div className="ev-t">
        <span>{label}</span>
        {sub && <small>{sub}</small>}
      </div>
      <b className={tn}>
        <Priv k="profit">{value}</Priv>
      </b>
    </div>
  );
}
