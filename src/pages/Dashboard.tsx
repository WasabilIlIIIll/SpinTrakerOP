import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { KpiRow } from "../components/KpiRow";
import { Empty, Btn } from "../components/ui";
import { FilterBar } from "../components/FilterBar";
import { PaneLeft, PaneRight, PaneTop } from "../components/Spatial";
import { cls } from "../lib/format";
import { ChipsTab } from "./ChipsTab";
import { BankrollTab } from "./BankrollTab";
import { StatsTab } from "./StatsTab";
import { t } from "../lib/i18n";

export function Dashboard() {
  const { filter, prefs, setPrefs, overview, go } = useApp();
  const { data: s } = useQuery(["summary", filter], () => api.summary(filter));
  const tab = prefs.dashboardTab;
  const [full, setFull] = useState(false);
  // plein écran : le graphique prend toute la fenêtre, panneaux latéraux masqués
  useEffect(() => {
    const root = document.documentElement;
    if (full && tab !== "stats") root.dataset.focus = "on";
    else delete root.dataset.focus;
    return () => {
      delete root.dataset.focus;
    };
  }, [full, tab]);
  if (overview && overview.tournaments === 0) {
    return (
      <div className="page">
        <Empty
          title="Bienvenue sur Spin Tracker OP"
          sub="Importez vos historiques de mains (PMU/iPoker XML, Winamax) pour voir votre CEV, votre EV profit, vos leaks et bien plus."
          icon="spade"
          action={
            <Btn kind="primary" icon="upload" onClick={() => go("import")}>
              {t("Importer des fichiers")}
            </Btn>
          }
        />
      </div>
    );
  }
  return (
    <div className="page dash">
      <PaneLeft>
        <div className="pane-title">Sélection</div>
        <FilterBar />
      </PaneLeft>
      <PaneRight>
        <div className="pane-title">Chiffres clés</div>
        <div className="dash-kpis">
          <KpiRow s={s} />
        </div>
      </PaneRight>
      <PaneTop>
        <div className="bubble">
          {(
            [
              ["chips", t("Chips gagnés")],
              ["bankroll", t("Bankroll")],
              ["stats", t("Stats")],
            ] as const
          ).map(([v, l]) => (
            <button key={v} className={cls(tab === v && "on")} onClick={() => setPrefs({ dashboardTab: v })}>
              {l}
            </button>
          ))}
        </div>
      </PaneTop>
      <div className={cls("dash-body", tab !== "stats" && "dash-fill")} key={tab}>
        {tab === "chips" && <ChipsTab full={full} onFull={() => setFull(!full)} />}
        {tab === "bankroll" && <BankrollTab full={full} onFull={() => setFull(!full)} />}
        {tab === "stats" && <StatsTab />}
      </div>
    </div>
  );
}
