import { useState } from "react";
import { api } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { KpiRow } from "../components/KpiRow";
import { Seg, Empty, Btn } from "../components/ui";
import { ChipsTab } from "./ChipsTab";
import { BankrollTab } from "./BankrollTab";
import { StatsTab } from "./StatsTab";
import { t } from "../lib/i18n";

export function Dashboard() {
  const { filter, prefs, setPrefs, overview, go } = useApp();
  const { data: s } = useQuery(["summary", filter], () => api.summary(filter));
  const tab = prefs.dashboardTab;
  const [full, setFull] = useState(false);
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
    <div className="page">
      {!full && <KpiRow s={s} />}
      <div className="tabs-row">
        <Seg
          value={tab}
          onChange={(v) => setPrefs({ dashboardTab: v })}
          options={[
            { v: "chips", l: t("Chips gagnés") },
            { v: "bankroll", l: t("Bankroll") },
            { v: "stats", l: t("Stats") },
          ]}
        />
      </div>
      {tab === "chips" && <ChipsTab full={full} onFull={() => setFull(!full)} />}
      {tab === "bankroll" && <BankrollTab full={full} onFull={() => setFull(!full)} />}
      {tab === "stats" && <StatsTab />}
    </div>
  );
}
