import { useMemo } from "react";
import { api } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { LineChart, type LineSeries } from "../components/LineChart";
import { Empty, Help, Loading, Panel, Priv, Seg, Toggle } from "../components/ui";
import { Icon } from "../components/Icon";
import { cls, date, money, mult, num, tone } from "../lib/format";
import { t } from "../lib/i18n";

export const BR_SERIES = [
  { key: "real", label: "Profit réel", color: "--s-real", help: "Gains réels − buy-ins, hors rakeback." },
  { key: "real_rb", label: "Réel + RB", color: "--s-realrb", help: "Profit réel rakeback inclus." },
  { key: "ev", label: "EV Profit", color: "--s-evp", help: "Profit attendu à partir de vos chips EV et du multiplicateur MOYEN théorique : supprime la chance aux all-in ET aux multiplicateurs." },
  { key: "ev_multi", label: "EV Multi-profit", color: "--s-evm", help: "Profit attendu à partir de vos chips EV et des multiplicateurs RÉELLEMENT tirés : supprime la chance aux all-in, garde celle des multiplicateurs." },
  { key: "ev_eff", label: "EV Profit effectif", color: "--s-eve", help: "Vos places réelles valorisées au multiplicateur moyen théorique : supprime la chance aux multiplicateurs, garde celle des all-in." },
  { key: "rakeback", label: "Rakeback", color: "--s-rb", help: "Rakeback cumulé." },
];

export function BankrollTab() {
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
      width: s.key === "ev" || s.key === "real_rb" ? 1.9 : 1.4,
    }));
  }, [data, visible, offset]);
  const marks = useMemo(
    () => (data ? data.events.jackpots.map((j) => ({ x: axis === "date" ? j.ts : j.index, label: mult(j.mult), color: "--gold" })) : []),
    [data, axis],
  );
  if (!loading && data && data.x.length <= 1) return <Empty title={t("Aucune donnée")} sub={t("Importez vos historiques pour commencer")} icon="upload" />;
  const ev = data?.events;
  const toggle = (k: string) => setPrefs({ bankrollSeries: visible.includes(k) ? visible.filter((x) => x !== k) : [...visible, k] });
  const fmtY = (v: number) => `${num(v, Math.abs(v) < 100 ? 1 : 0)}`;
  const idxLabel = (i: number) => (data && axis === "date" ? date(data.ts[i]) : `#${i}`);
  return (
    <div className="br-grid">
      <div className="chart-card">
        <div className="chart-top">
          {sum && (
            <div className="br-sum">
              {[
                ["EV Profit", sum.profit.ev, true],
                ["EV Multi", sum.profit.ev_multi, true],
                ["EV effectif", sum.profit.ev_eff, true],
                ["Réel + RB", sum.profit.real_rb, false],
              ].map(([l, v, e]) => (
                <div key={l as string}>
                  <span>
                    {e && <i className="evdot" />}
                    {l as string}
                  </span>
                  <b className={tone(v as number)}>
                    <Priv k="profit">{money(v as number)}</Priv>
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
          {loading && !data ? <Loading h={380} /> : data && <LineChart x={data.x} series={series} dateAxis={axis === "date"} fmtY={fmtY} marks={marks} xLabel={axis === "date" ? undefined : t("Tournois joués")} yLabel={prefs.currency} />}
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
      <Panel title={t("Événements marquants")} className="events">
        {ev && (
          <div className="ev-list">
            <Event icon="sparkle" label={t("Plus gros upswing")} value={money(ev.upswing.amount)} tone="pos" sub={`${idxLabel(ev.upswing.from)} → ${idxLabel(ev.upswing.to)} · ${ev.upswing.to - ev.upswing.from} spins`} />
            <Event icon="thumbdown" label={t("Plus gros downswing")} value={money(-ev.downswing.amount)} tone="neg" sub={`${idxLabel(ev.downswing.from)} → ${idxLabel(ev.downswing.to)} · ${ev.downswing.to - ev.downswing.from} spins`} />
            <Event icon="chart" label="Downswing EV" value={money(-ev.ev_downswing.amount)} sub={`${ev.ev_downswing.to - ev.ev_downswing.from} spins`} />
            <Event icon="crown" label={t("Plus haut")} value={money(ev.peak[1] + offset)} tone="pos" sub={idxLabel(ev.peak[0])} />
            <Event icon="skull" label={t("Plus bas")} value={money(ev.low[1] + offset)} tone="neg" sub={idxLabel(ev.low[0])} />
            <Event icon="clock" label={t("Plus longue période break-even")} value={`${num(ev.longest_break_even.amount)} spins`} sub={`${idxLabel(ev.longest_break_even.from)} → ${idxLabel(ev.longest_break_even.to)}`} />
            <Event icon="target" label="Depuis le dernier sommet" value={`${num(ev.since_peak)} spins`} sub={`${money(-ev.current_drawdown)} sous le sommet`} tone={ev.current_drawdown > 0 ? "neg" : "pos"} />
            <Event icon="calendar" label="Meilleure journée" value={money(ev.best_day[1])} tone="pos" sub={date(ev.best_day[0])} />
            <Event icon="calendar" label="Pire journée" value={money(ev.worst_day[1])} tone="neg" sub={date(ev.worst_day[0])} />
            <Event icon="flame" label="Séries" value={`${ev.best_streak} victoires`} sub={`${ev.worst_streak} défaites d'affilée max`} />
            <div className="ev-sep">{t("Jackpots")} ({ev.jackpots.length})</div>
            {ev.jackpots.length === 0 && <div className="muted small">Aucun multiplicateur ≥ seuil (réglable dans Paramètres).</div>}
            {ev.jackpots
              .slice()
              .reverse()
              .map((j) => (
                <button key={j.tid} className="jackpot" onClick={() => open({ type: "tournament", id: j.tid })}>
                  <span className="jp-m">{mult(j.mult)}</span>
                  <span>
                    {date(j.ts, true)}
                    <small>
                      {j.place ? `${j.place}${j.place === 1 ? "er" : "e"}` : "?"} · pool {money(j.prize_pool, 0)}
                    </small>
                  </span>
                  <b className={tone(j.won)}>
                    <Priv k="profit">{money(j.won)}</Priv>
                  </b>
                </button>
              ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Event({ icon, label, value, sub, tone: tn }: { icon: string; label: string; value: string; sub?: string; tone?: string }) {
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
