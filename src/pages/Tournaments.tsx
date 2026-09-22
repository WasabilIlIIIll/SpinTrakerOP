import { useState } from "react";
import { api } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { Loading, Pager, Panel, Priv, Tags, Empty } from "../components/ui";
import { FilterBar } from "../components/FilterBar";
import { cls, date, duration, money, mult, num, signed, tone } from "../lib/format";
import { KpiRow } from "../components/KpiRow";

const COLS: [string, string, boolean][] = [
  ["start", "Date", false],
  ["multiplier", "Multi", true],
  ["place", "Place", true],
  ["hands", "Mains", true],
  ["chips", "Chips", true],
  ["ev", "EV chips", true],
  ["luck", "Chance", true],
  ["profit", "Profit", true],
];

export function Tournaments() {
  const { filter, open } = useApp();
  const [sort, setSort] = useState("start");
  const [desc, setDesc] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const { data, loading } = useQuery(["tours", filter, sort, desc, offset], () => api.tournaments(filter, sort, desc, offset, limit));
  const { data: s } = useQuery(["summary", filter], () => api.summary(filter));
  const click = (k: string) => {
    if (k === sort) setDesc(!desc);
    else {
      setSort(k);
      setDesc(true);
    }
    setOffset(0);
  };
  return (
    <div className="page">
      <div className="page-head">
        <h2>Tournois</h2>
        <FilterBar />
      </div>
      <KpiRow s={s} compact />
      <Panel pad={false} right={<Pager total={data?.total ?? 0} offset={offset} limit={limit} onChange={setOffset} />} title={`${num(data?.total ?? 0)} spins`}>
        {loading && !data ? (
          <Loading />
        ) : !data || data.rows.length === 0 ? (
          <Empty title="Aucun tournoi" sub="Ajustez les filtres ou importez des historiques." icon="trophy" />
        ) : (
          <div className="tbl-wrap tall">
            <table className="tbl hover">
              <thead>
                <tr>
                  {COLS.map(([k, l, r]) => (
                    <th key={k} className={cls(r && "r", "sortable")} onClick={() => click(k)}>
                      {l} {sort === k ? (desc ? "↓" : "↑") : ""}
                    </th>
                  ))}
                  <th>Adversaires</th>
                  <th className="r">Tables</th>
                  <th className="r">Durée</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((t) => (
                  <tr key={t.id} onClick={() => open({ type: "tournament", id: t.id })}>
                    <td>{date(t.start, true)}</td>
                    <td>
                      <span className={cls("mult", t.multiplier >= 10 && "mult-hi")}>{mult(t.multiplier)}</span>
                    </td>
                    <td className={cls("r", t.place === 1 && "pos")}>{t.place ? `${t.place}${t.place === 1 ? "er" : "e"}` : "?"}</td>
                    <td className="r">{t.hands}</td>
                    <td className={cls("r", tone(t.chips))}>{signed(t.chips, 0)}</td>
                    <td className={cls("r", tone(t.ev))}>{signed(t.ev, 0)}</td>
                    <td className={cls("r", tone(t.luck))}>{signed(t.luck, 0)}</td>
                    <td className={cls("r", tone(t.profit))}>
                      <Priv k="profit">{money(t.profit)}</Priv>
                    </td>
                    <td className="opps">
                      {t.opponents.map(([n, tags]) => (
                        <span key={n} className="opp-mini">
                          {n}
                          <Tags ids={tags} small />
                        </span>
                      ))}
                    </td>
                    <td className="r">{num(t.tables, 1)}</td>
                    <td className="r muted">{duration(t.end - t.start)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
