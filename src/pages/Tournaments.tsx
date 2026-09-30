import { useState } from "react";
import { api, type Summary, type TRow } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { Loading, Pager, Panel, Priv, Tags, Empty } from "../components/ui";
import { FilterBar } from "../components/FilterBar";
import { cls, date, duration, money, mult, num, pct, signed, tone } from "../lib/format";
import { PaneLeft, PaneRight } from "../components/Spatial";

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
  const [hover, setHover] = useState<TRow | null>(null);
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
      <PaneLeft>
        <div className="pane-title">Sélection</div>
        <FilterBar />
      </PaneLeft>
      <PaneRight>
        <TourDetail t={hover} />
        <SelectionCard s={s} />
      </PaneRight>
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
                  <tr key={t.id} onClick={() => open({ type: "tournament", id: t.id })} onMouseEnter={() => setHover(t)}>
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

/** Ligne survolée, en détail dans le panneau de droite. */
function TourDetail({ t }: { t: TRow | null }) {
  if (!t) return <div className="side-card side-hint">Survole un tournoi pour voir son détail ici, clique pour l'ouvrir.</div>;
  return (
    <div className="side-card" key={t.id}>
      <div className="row gap8">
        <span className={cls("mult", t.multiplier >= 10 && "mult-hi")}>{mult(t.multiplier)}</span>
        <b>{t.place ? `${t.place}${t.place === 1 ? "er" : "e"}` : "?"}</b>
        <div className="grow" />
        <span className="muted small">{date(t.start, true)}</span>
      </div>
      <div className="side-big">
        <span>Profit</span>
        <b className={tone(t.profit)}>
          <Priv k="profit">{money(t.profit)}</Priv>
        </b>
      </div>
      <div className="side-kv">
        <span>Chips</span>
        <b className={tone(t.chips)}>{signed(t.chips, 0)}</b>
        <span>EV chips</span>
        <b className={tone(t.ev)}>{signed(t.ev, 0)}</b>
        <span>Chance</span>
        <b className={tone(t.luck)}>{signed(t.luck, 0)}</b>
        <span>Mains</span>
        <b>{t.hands}</b>
        <span>Durée</span>
        <b>{duration(t.end - t.start)}</b>
        <span>Tables en même temps</span>
        <b>{num(t.tables, 1)}</b>
      </div>
      {t.opponents.length > 0 && (
        <div className="col gap6">
          {t.opponents.map(([n, tags]) => (
            <span key={n} className="opp-mini">
              {n}
              <Tags ids={tags} small />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SelectionCard({ s }: { s: Summary | undefined }) {
  if (!s) return null;
  return (
    <div className="side-card">
      <div className="pane-title">Sélection</div>
      <div className="side-kv">
        <span>Spins</span>
        <b>{num(s.tournaments)}</b>
        <span>CEV</span>
        <b className={tone(s.cev)}>{num(s.cev, 1)}</b>
        <span>EV profit</span>
        <b className={tone(s.profit.ev)}>
          <Priv k="profit">{money(s.profit.ev)}</Priv>
        </b>
        <span>Profit réel</span>
        <b className={tone(s.profit.real)}>
          <Priv k="profit">{money(s.profit.real)}</Priv>
        </b>
        <span>ROI EV</span>
        <b className={tone(s.roi.ev)}>{pct(s.roi.ev)}</b>
        <span>1re place</span>
        <b className={tone(s.finish[0] - s.finish_expected[0])}>{pct(s.finish[0])}</b>
        <span>Multi moyen</span>
        <b>x{num(s.avg_mult, 2)}</b>
        <span>Durée moyenne</span>
        <b>{duration(s.avg_duration)}</b>
      </div>
    </div>
  );
}
