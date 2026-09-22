import { useState } from "react";
import { api } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { Loading, Panel, Seg, Empty } from "../components/ui";
import { FilterBar } from "../components/FilterBar";
import { LeakPanels, PostflopTable, RefLegend, RefSources } from "../components/LeakPanels";
import { cls, num } from "../lib/format";

const SCENARIOS = ["BTN", "SB vs BTN", "SB vs BB", "BB vs BTN", "BB vs SB", "HU SB", "HU BB"];

export function LeakFinder() {
  const { filter, prefs, setPrefs, settings, overview } = useApp();
  const [tab, setTab] = useState<"pre" | "post">("pre");
  const [scenario, setScenario] = useState<string | null>(null);
  const [minHands, setMinHands] = useState(5);
  const hero = overview?.heroes[0] ?? "";
  const { data, loading } = useQuery(["leak", "hero", filter, prefs.leakRef], () => api.leakReport("", filter, prefs.leakRef));
  return (
    <div className="page">
      <div className="page-head">
        <h2>
          Leak finder <span className="muted small">{hero}</span>
        </h2>
        <FilterBar />
      </div>
      <div className="hand-filters">
        <Seg value={tab} onChange={setTab} options={[{ v: "pre", l: "Préflop" }, { v: "post", l: "Postflop" }]} />
        {tab === "pre" && (
          <div className="fchips">
            <button className={cls("fchip", !scenario && "on")} onClick={() => setScenario(null)}>
              Tout
            </button>
            {SCENARIOS.map((s) => (
              <button key={s} className={cls("fchip", scenario === s && "on")} onClick={() => setScenario(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="grow" />
        {tab === "pre" && (
          <label className="row gap8 small muted">
            Mains min
            <select className="sel" value={minHands} onChange={(e) => setMinHands(+e.target.value)}>
              {[1, 3, 5, 10, 25, 50].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        )}
        <select className="sel" value={prefs.leakRef} onChange={(e) => setPrefs({ leakRef: e.target.value })}>
          <option value="population">Référence : population</option>
          {settings?.tags.map((t) => (
            <option key={t.id} value={`tag:${t.id}`}>
              Référence : {t.name}s
            </option>
          ))}
          <option value="custom">Référence : personnalisée</option>
          <option value="none">Sans référence</option>
        </select>
      </div>
      {loading && !data ? (
        <Loading h={400} />
      ) : !data || data.hands === 0 ? (
        <Empty title="Aucune main" sub="Importez vos historiques ou élargissez les filtres." icon="search" />
      ) : (
        <Panel
          title={tab === "pre" ? "Décisions préflop" : "Statistiques postflop"}
          help={
            tab === "pre"
              ? "Chaque encadré est un nœud de décision réel (position + action des adversaires). Les couleurs comparent vos fréquences à la référence choisie : vert = conforme, orange = écart notable, rouge = leak probable, gris = échantillon trop faible."
              : "Vos statistiques postflop comparées à la référence, en pots HU et à 3."
          }
          right={<span className="muted small">{num(data.hands)} mains analysées</span>}
        >
          <RefSources mode={prefs.leakRef} tagName={settings?.tags.find((t) => `tag:${t.id}` === prefs.leakRef)?.name} />
          <RefLegend />
          {tab === "pre" ? <LeakPanels report={data} scenarios={scenario ? [scenario] : undefined} minHands={minHands} /> : <PostflopTable mine={data.postflop.player} reference={data.postflop.reference} />}
        </Panel>
      )}
    </div>
  );
}
