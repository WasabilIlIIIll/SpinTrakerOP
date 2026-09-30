import { useState } from "react";
import { api, type HandRow } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { Btn, Empty, Help, Loading, Pager, Panel, Seg } from "../components/ui";
import { Icon } from "../components/Icon";
import { FilterBar } from "../components/FilterBar";
import { Cards } from "../components/PlayingCard";
import { cls, date, num, signed, tone } from "../lib/format";
import { PaneLeft, PaneRight } from "../components/Spatial";

const SCENARIOS = ["BTN", "SB vs BTN", "SB vs BB", "BB vs BTN", "BB vs SB", "HU SB", "HU BB"];

export function Hands() {
  const { filter, open, bump, toast } = useApp();
  const [scenario, setScenario] = useState<string | null>(null);
  const [allin, setAllin] = useState<boolean | null>(null);
  const [showdown, setShowdown] = useState<boolean | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [hu, setHu] = useState<boolean | null>(null);
  const [combo, setCombo] = useState("");
  const [favorites, setFavorites] = useState<boolean | null>(null);
  const [minPot, setMinPot] = useState<number | null>(null);
  const [sort, setSort] = useState("date");
  const [desc, setDesc] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 100;
  const q = {
    filter,
    scenario,
    allin,
    showdown,
    result,
    hu,
    favorites,
    combo: combo.trim().toUpperCase() || null,
    min_pot_bb: minPot,
    sort,
    desc,
    offset,
    limit,
  };
  const { data, loading } = useQuery(["hands", q], () => api.hands(q));
  const [hover, setHover] = useState<HandRow | null>(null);
  const click = (k: string) => {
    if (k === sort) setDesc(!desc);
    else {
      setSort(k);
      setDesc(true);
    }
    setOffset(0);
  };
  const star = async (id: string, on: boolean) => {
    await api.setFavorite(id, on);
    bump();
    toast(on ? "Main ajoutée aux favoris" : "Retirée des favoris");
  };
  const reset = () => {
    setFavorites(null);
    setScenario(null);
    setAllin(null);
    setShowdown(null);
    setResult(null);
    setHu(null);
    setCombo("");
    setMinPot(null);
    setOffset(0);
  };
  return (
    <div className="page">
      <PaneLeft>
        <div className="pane-title">Sélection</div>
        <FilterBar />
        <div className="pane-title">Mains</div>
        <div className="side-filters">
        <select className="sel" value={scenario ?? ""} onChange={(e) => (setScenario(e.target.value || null), setOffset(0))}>
          <option value="">Toutes positions</option>
          {SCENARIOS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Seg small value={allin === null ? "" : allin ? "y" : "n"} onChange={(v) => setAllin(v === "" ? null : v === "y")} options={[{ v: "", l: "Tout" }, { v: "y", l: "All-in" }, { v: "n", l: "Sans all-in" }]} />
        <Seg small value={showdown === null ? "" : showdown ? "y" : "n"} onChange={(v) => setShowdown(v === "" ? null : v === "y")} options={[{ v: "", l: "Tout" }, { v: "y", l: "Showdown" }, { v: "n", l: "Sans SD" }]} />
        <Seg small value={result ?? ""} onChange={(v) => setResult(v || null)} options={[{ v: "", l: "Tout" }, { v: "won", l: "Gagnées" }, { v: "lost", l: "Perdues" }]} />
        <Seg small value={hu === null ? "" : hu ? "y" : "n"} onChange={(v) => setHu(v === "" ? null : v === "y")} options={[{ v: "", l: "3-max + HU" }, { v: "y", l: "HU" }, { v: "n", l: "3-max" }]} />
        <Seg
          small
          value={favorites === null ? "" : favorites ? "y" : "n"}
          onChange={(v) => (setFavorites(v === "" ? null : v === "y"), setOffset(0))}
          options={[{ v: "", l: "Toutes" }, { v: "y", l: "★ Review" }]}
        />
        <input className="inp" placeholder="Main (AKs, 77…)" value={combo} onChange={(e) => (setCombo(e.target.value), setOffset(0))}  />
        <input className="inp" placeholder="Pot min (bb)" value={minPot ?? ""} onChange={(e) => setMinPot(e.target.value ? +e.target.value : null)}  />
        <Btn small icon="refresh" onClick={reset}>
          Réinitialiser
        </Btn>
        </div>
      </PaneLeft>
      <PaneRight>
        <HandCard h={hover} />
        {data && (
          <div className="side-card">
            <div className="pane-title">Mains listées</div>
            <div className="side-kv">
              <span>Mains</span>
              <b>{num(data.total)}</b>
              <span>Chips réels</span>
              <b className={tone(data.net)}>{signed(data.net, 0)}</b>
              <span>Chips all-in ajustés</span>
              <b className={tone(data.ev)}>{signed(data.ev, 0)}</b>
              {data.complete && data.tournaments > 0 ? (
                <>
                  <span>CEV / tournoi</span>
                  <b className={tone(data.ev)}>{signed(data.ev / data.tournaments, 1)}</b>
                </>
              ) : data.total > 0 ? (
                <>
                  <span>CEV / main</span>
                  <b className={tone(data.ev)}>{signed(data.ev / data.total, 2)}</b>
                </>
              ) : null}
            </div>
            <div className="muted small">
              Totaux de toutes les mains listées. Le CEV par tournoi est le chiffre du tableau de bord ; avec un filtre de main (cartes, scénario, pot…), seule la moyenne par main a un sens.
            </div>
          </div>
        )}
      </PaneRight>
      <Panel pad={false} right={<Pager total={data?.total ?? 0} offset={offset} limit={limit} onChange={setOffset} />}>
        {loading && !data ? (
          <Loading />
        ) : !data || !data.rows.length ? (
          <Empty title="Aucune main" sub="Ajustez les filtres." icon="cards" />
        ) : (
          <div className="tbl-wrap tall">
            <table className="tbl hover">
              <thead>
                <tr>
                  <th />
                  <th className="sortable" onClick={() => click("date")}>
                    Date {sort === "date" ? (desc ? "↓" : "↑") : ""}
                  </th>
                  <th>Cartes</th>
                  <th>Position</th>
                  <th className="r sortable" onClick={() => click("bb")}>
                    Tapis eff.
                  </th>
                  <th>Ligne</th>
                  <th>Board</th>
                  <th className="r sortable" onClick={() => click("pot")}>
                    Pot
                  </th>
                  <th className="r">Équité</th>
                  <th className="r sortable" onClick={() => click("net")}>
                    Chips
                  </th>
                  <th className="r sortable" onClick={() => click("ev")}>
                    CEV <Help text="CEV de la main : résultat en jetons, all-in ajusté : sur un tapis avant la river, le résultat réel est remplacé par l'espérance (équité × pot). Ce n'est pas un montant en euros." />
                  </th>
                  <th className="r sortable" onClick={() => click("luck")}>
                    Écart <Help text="Chips réels − CEV : positif = vous avez gagné plus que votre espérance sur les tapis de cette main." />
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((h) => (
                  <tr key={h.id} onClick={() => open({ type: "hand", id: h.id })} onMouseEnter={() => setHover(h)}>
                    <td>
                      <button
                        className={cls("star", h.fav && "on")}
                        title={h.fav ? "Retirer des favoris" : "Ajouter aux favoris (Review)"}
                        onClick={(e) => {
                          e.stopPropagation();
                          star(h.id, !h.fav);
                        }}
                      >
                        <Icon name="star" size={14} fill={h.fav} />
                      </button>
                    </td>
                    <td className="muted">{date(h.ts, true)}</td>
                    <td>
                      <Cards cards={h.cards} size="xs" />
                    </td>
                    <td>{h.scenario}</td>
                    <td className="r">{num(h.eff_bb, 1)}</td>
                    <td className="mono">{h.line}</td>
                    <td>
                      <Cards cards={h.board} size="xs" />
                    </td>
                    <td className="r">{num(h.pot / h.bb, 1)} bb</td>
                    <td className="r">{h.equity != null ? `${num(h.equity * 100, 0)} %` : ""}</td>
                    <td className={cls("r", tone(h.net))}>{signed(h.net, 0)}</td>
                    <td className={cls("r", tone(h.ev))}>{signed(h.ev, 0)}</td>
                    <td className={cls("r", tone(h.net - h.ev))}>{h.allin != null ? signed(h.net - h.ev, 0) : ""}</td>
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

/** Main survolée, en grand dans le panneau de droite. */
function HandCard({ h }: { h: HandRow | null }) {
  if (!h) return <div className="side-card side-hint">Survole une main pour la voir ici, clique pour la rejouer.</div>;
  return (
    <div className="side-card" key={h.id}>
      <div className="row gap8">
        <b>{h.scenario}</b>
        <span className="muted small">{num(h.eff_bb, 1)} bb</span>
        <div className="grow" />
        <span className="muted small">{date(h.ts, true)}</span>
      </div>
      <div className="row gap12 wrap" style={{ alignItems: "center" }}>
        <Cards cards={h.cards} size="md" />
        {h.board.length > 0 && <Cards cards={h.board} size="sm" />}
      </div>
      <div className="side-kv">
        <span>Ligne</span>
        <b className="mono">{h.line || "–"}</b>
        <span>Pot</span>
        <b>{num(h.pot / h.bb, 1)} bb</b>
        {h.equity != null && (
          <>
            <span>Équité all-in</span>
            <b>{num(h.equity * 100, 0)} %</b>
          </>
        )}
        <span>Chips</span>
        <b className={tone(h.net)}>{signed(h.net, 0)}</b>
        <span>CEV</span>
        <b className={tone(h.ev)}>{signed(h.ev, 0)}</b>
        {h.allin != null && (
          <>
            <span>Écart à l'espérance</span>
            <b className={tone(h.net - h.ev)}>{signed(h.net - h.ev, 0)}</b>
          </>
        )}
      </div>
      {h.fav_note && <div className="muted small">★ {h.fav_note}</div>}
    </div>
  );
}
