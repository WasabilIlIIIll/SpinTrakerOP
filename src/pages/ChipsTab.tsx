import { useMemo } from "react";
import { api } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { LineChart, type LineSeries } from "../components/LineChart";
import { Icon } from "../components/Icon";
import { Dropdown, Empty, Loading, NumInput, Seg, Help } from "../components/ui";
import { cls, num } from "../lib/format";
import { t } from "../lib/i18n";

export const CHIP_SERIES: { key: string; label: string; color: string; help: string; dash?: number[]; main?: boolean }[] = [
  { key: "chips", label: "Chips", color: "--s-chips", help: "Jetons réellement gagnés (cumul).", main: true },
  { key: "chips_sd", label: "Chips (SD)", color: "--s-sd", help: "Jetons gagnés dans les mains allées à l'abattage (showdown).", main: true },
  { key: "chips_nsd", label: "Chips (NSD)", color: "--s-nsd", help: "Jetons gagnés sans abattage.", main: true },
  { key: "ev", label: "EV (chips)", color: "--s-ev", help: "Jetons ajustés all-in : à chaque tapis avant la river, le résultat est remplacé par l'espérance (équité × pot, side pots compris).", main: true },
  { key: "min_cev", label: "CEV min", color: "--s-min", help: "Trajectoire du CEV minimum pour être rentable avec votre rakeback (EV profit = 0).", dash: [6, 4] },
  { key: "luck", label: "Chance all-in", color: "--s-luck", help: "Écart entre jetons réels et EV : au-dessus de 0, vous avez gagné plus d'all-in que prévu." },
  { key: "chips_hu", label: "Chips HU", color: "--s-hu", help: "Jetons gagnés en tête-à-tête uniquement." },
  { key: "chips_3max", label: "Chips 3-max", color: "--s-3max", help: "Jetons gagnés à 3 joueurs uniquement." },
];

export function ChipsTab({ full, onFull }: { full?: boolean; onFull?: () => void }) {
  const { filter, prefs, setPrefs, settings, saveSettings } = useApp();
  const axis = prefs.chipsAxis;
  const { data, loading } = useQuery(["chips", filter, axis], () => api.chipsChart(filter, axis));
  const visible = prefs.chipsSeries;
  const series: LineSeries[] = useMemo(() => {
    if (!data) return [];
    return CHIP_SERIES.filter((s) => visible.includes(s.key)).map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      values: data.series.find((x) => x[0] === s.key)?.[1] ?? [],
      dash: s.dash,
      width: s.key === "ev" || s.key === "chips" ? 1.7 : 1.3,
    }));
  }, [data, visible]);
  const ci = useMemo(() => {
    if (!data || !prefs.showCi || axis === "date" || data.tournaments < 2) return null;
    const n = data.tournaments;
    return {
      lo: (data.cev - data.cev_ci) * n,
      hi: (data.cev + data.cev_ci) * n,
      loLabel: num(data.cev - data.cev_ci, 0),
      hiLabel: num(data.cev + data.cev_ci, 0),
      color: "--s-ev",
    };
  }, [data, prefs.showCi, axis]);
  const notes = useMemo(() => (prefs.showNotes && data ? data.notes : []), [data, prefs.showNotes]);
  const toggle = (k: string) => setPrefs({ chipsSeries: visible.includes(k) ? visible.filter((x) => x !== k) : [...visible, k] });
  const others = CHIP_SERIES.filter((s) => !s.main);

  if (!loading && data && data.tournaments === 0) {
    return <Empty title={t("Aucune donnée")} sub="Aucun spin sur cette sélection : élargissez les filtres ou importez des historiques." icon="filter" />;
  }
  return (
    <div className={cls("chart-card", full && "full")}>
      <div className="chart-stage">
        <div className="ov ov-tr">
          {data && (
            <div className="chart-meta">
              <span>
                CEV <b>{num(data.cev, 1)}</b> ± {num(data.cev_ci, 0)}
              </span>
              <span>
                min <b style={{ color: "var(--s-min)" }}>{num(data.min_cev, 1)}</b>
              </span>
              <span>
                {num(data.hands)} mains · {num(data.tournaments)} spins
              </span>
            </div>
          )}
          <button className={cls("pill", prefs.showNotes && "on")} onClick={() => setPrefs({ showNotes: !prefs.showNotes })} title="Afficher les événements marquants sur la courbe">
            <Icon name="sparkle" size={13} /> Événements
          </button>
          <button className={cls("pill", prefs.showCi && "on")} onClick={() => setPrefs({ showCi: !prefs.showCi })} title="Intervalle de confiance à 95 % du CEV">
            <Icon name="target" size={13} /> IC 95 %
          </button>
          <Seg
            small
            value={axis}
            onChange={(v) => setPrefs({ chipsAxis: v })}
            options={[
              { v: "hands", l: t("Mains") },
              { v: "tournaments", l: t("Tournois") },
              { v: "date", l: t("Date") },
            ]}
          />
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
            data && (
              <LineChart
                x={data.x}
                series={series}
                ci={ci}
                notes={notes}
                xLabel={axis === "hands" ? t("Mains jouées") : axis === "tournaments" ? t("Tournois joués") : undefined}
                dateAxis={axis === "date"}
                yLabel="Chips"
              />
            )
          )}
        </div>
      </div>
      <div className="chart-foot">
        <div className="rb-quick">
          <span>Rakeback</span>
          {settings && <NumInput value={settings.default_rakeback} width={44} min={0} max={100} suffix="%" onChange={(v) => saveSettings({ ...settings, default_rakeback: v })} />}
        </div>
        <div className="legend">
          {CHIP_SERIES.filter((s) => s.main || visible.includes(s.key)).map((s) => (
            <button key={s.key} className={cls("lg", visible.includes(s.key) && "on")} onClick={() => toggle(s.key)}>
              <i style={{ background: `var(${s.color})` }} />
              {s.label}
              <Help text={s.help} />
            </button>
          ))}
          <Dropdown label={<>Autres <b className="badge">{others.length}</b></>} align="right">
            <div className="dd-list">
              {others.map((s) => (
                <button key={s.key} className={cls("dd-item", visible.includes(s.key) && "on")} onClick={() => toggle(s.key)}>
                  <i className="dot" style={{ background: `var(${s.color})` }} /> {s.label}
                  {visible.includes(s.key) && <Icon name="check" size={13} />}
                </button>
              ))}
            </div>
          </Dropdown>
        </div>
      </div>
    </div>
  );
}
