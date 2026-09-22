import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { Modal, Loading, Priv, Seg, Stat, Tags, TagChip, Btn } from "./ui";
import { Replayer } from "./Replayer";
import { LineChart } from "./LineChart";
import { Cards } from "./PlayingCard";
import { LeakPanels, PostflopTable, RefLegend } from "./LeakPanels";
import { ago, cls, date, duration, money, mult, num, pct, signed, tone } from "../lib/format";

export function Modals() {
  const { modal, open } = useApp();
  if (!modal) return null;
  const close = () => open(null);
  if (modal.type === "hand") return <HandModal id={modal.id} onClose={close} />;
  if (modal.type === "tournament") return <TournamentModal id={modal.id} onClose={close} />;
  return <PlayerModal name={modal.name} onClose={close} />;
}

function HandModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [cur, setCur] = useState(id);
  useEffect(() => setCur(id), [id]);
  return (
    <Modal title="Replayer" onClose={onClose} wide="xl">
      <Replayer id={cur} onNav={setCur} />
    </Modal>
  );
}

function TournamentModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { open } = useApp();
  const { data: t } = useQuery(["tdetail", id], () => api.tournamentDetail(id));
  const { data: hands } = useQuery(["thands", id], () => api.hands({ tid: id, limit: 500, desc: false }));
  const x = useMemo(() => (t ? t.curve_chips.map((_, i) => i) : []), [t]);
  const series = useMemo(
    () =>
      t
        ? [
            { key: "c", label: "Tapis", color: "--s-chips", values: t.curve_chips, width: 2 },
            { key: "e", label: "Tapis EV", color: "--s-ev", values: t.curve_ev, width: 1.5 },
          ]
        : [],
    [t],
  );
  return (
    <Modal
      title={
        t ? (
          <>
            <span className={cls("mult", t.multiplier >= 10 && "mult-hi")}>{mult(t.multiplier)}</span> {t.name} <span className="muted">· {date(t.start, true)}</span>
          </>
        ) : (
          "Tournoi"
        )
      }
      onClose={onClose}
      wide
    >
      {!t ? (
        <Loading />
      ) : (
        <div className="col gap16">
          <div className="tiles tiles-6">
            <Stat label="Place" value={t.place ? `${t.place}${t.place === 1 ? "er" : "e"}` : "?"} tone={t.place === 1 ? "pos" : ""} />
            <Stat label="Gains" value={money(t.winnings)} k="profit" />
            <Stat label="Profit" value={money(t.profit)} tone={tone(t.profit)} k="profit" />
            <Stat label="Chips / EV" value={`${signed(t.chips, 0)} / ${signed(t.ev, 0)}`} tone={tone(t.ev)} />
            <Stat label="EV Profit" value={money(t.ev_profit)} tone={tone(t.ev_profit)} k="profit" />
            <Stat label="Durée" value={duration(t.end - t.start)} sub={`${t.hands} mains · ${num(t.tables, 1)} tables`} />
          </div>
          <div className="row gap8 wrap">
            {t.opponents.map((o) => (
              <button key={o.name} className="opp" onClick={() => open({ type: "player", name: o.name })}>
                {o.name} <Tags ids={o.tags} small />
              </button>
            ))}
            <span className="muted small">
              P(1er/2e/3e) : {pct(t.p[0] * 100, 0)} / {pct(t.p[1] * 100, 0)} / {pct(t.p[2] * 100, 0)}
            </span>
          </div>
          <div style={{ height: 220 }}>
            <LineChart x={x} series={series} height={220} xLabel="Main" />
          </div>
          <div className="tbl-wrap" style={{ maxHeight: 330 }}>
            <table className="tbl hover">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Heure</th>
                  <th>Cartes</th>
                  <th>Position</th>
                  <th className="r">Tapis eff.</th>
                  <th>Ligne</th>
                  <th>Board</th>
                  <th className="r">Résultat</th>
                  <th className="r">EV</th>
                </tr>
              </thead>
              <tbody>
                {(hands?.rows ?? []).map((h, i) => (
                  <tr key={h.id} onClick={() => open({ type: "hand", id: h.id })}>
                    <td className="muted">{i + 1}</td>
                    <td className="muted">{date(h.ts, true).slice(11)}</td>
                    <td>
                      <Cards cards={h.cards} size="xs" />
                    </td>
                    <td>{h.scenario}</td>
                    <td className="r">{num(h.eff_bb, 1)} bb</td>
                    <td className="mono">{h.line}</td>
                    <td>
                      <Cards cards={h.board} size="xs" />
                    </td>
                    <td className={cls("r", tone(h.net))}>{signed(h.net, 0)}</td>
                    <td className={cls("r", tone(h.ev))}>{h.allin != null ? signed(h.ev, 0) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted small">Source : {t.source}</div>
        </div>
      )}
    </Modal>
  );
}

function PlayerModal({ name, onClose }: { name: string; onClose: () => void }) {
  const { settings, filter, prefs, bump, toast, open } = useApp();
  const { data: p } = useQuery(["pprofile", name], () => api.playerProfile(name));
  const [tab, setTab] = useState<"sum" | "pre" | "post" | "tourn">("sum");
  const [ref, setRef] = useState(prefs.leakRef);
  const { data: lr } = useQuery(["leak", name, ref, tab === "pre" || tab === "post"], () => api.leakReport(name, p?.is_hero ? filter : {}, ref), tab === "pre" || tab === "post");
  const [notes, setNotes] = useState("");
  const [manual, setManual] = useState<string[]>([]);
  useEffect(() => {
    if (p) {
      setNotes(p.notes);
      setManual(p.manual_tags);
    }
  }, [p]);
  const save = async (tags: string[], n: string) => {
    await api.savePlayerMeta(name, tags, n);
    bump();
    toast("Joueur mis à jour");
  };
  return (
    <Modal
      wide="xl"
      onClose={onClose}
      title={
        <div className="row gap8">
          <b>{name}</b>
          {p && <Tags ids={p.tags} />}
        </div>
      }
      right={
        p && (
          <div className="pstrip">
            <span>
              Mains <b>{num(p.hands)}</b>
            </span>
            <span>
              Spins ensemble <b>{num(p.vs_hero_tournaments)}</b>
            </span>
            <span>
              CEV HU <b className={tone(p.hero_cev_hu_vs)}>{num(p.hero_cev_hu_vs, 0)}</b>
              <small> ± {num(p.hero_cev_hu_vs_ci, 0)}</small>
            </span>
            <span>
              CEV <b className={tone(p.hero_cev_vs)}>{num(p.hero_cev_vs, 0)}</b>
              <small> ± {num(p.hero_cev_vs_ci, 0)}</small>
            </span>
            <span>
              Vu <b>{ago(p.last_ts)}</b>
            </span>
          </div>
        )
      }
    >
      {!p ? (
        <Loading />
      ) : (
        <div className="col gap16">
          <div className="row gap8 wrap">
            <Seg
              value={tab}
              onChange={setTab}
              options={[
                { v: "sum", l: "Résumé" },
                { v: "pre", l: "Préflop" },
                { v: "post", l: "Postflop" },
                { v: "tourn", l: "Tournois ensemble" },
              ]}
            />
            <div className="grow" />
            {(tab === "pre" || tab === "post") && (
              <select className="sel" value={ref} onChange={(e) => setRef(e.target.value)}>
                <option value="population">Réf. : population</option>
                {settings?.tags.map((t) => (
                  <option key={t.id} value={`tag:${t.id}`}>
                    Réf. : {t.name}
                  </option>
                ))}
                <option value="custom">Réf. : personnalisée</option>
                <option value="none">Sans référence</option>
              </select>
            )}
          </div>
          {tab === "sum" && (
            <div className="pgrid">
              <div className="col gap16">
                <div className="tiles tiles-4">
                  <Stat label="VPIP" value={pct(p.vpip, 0)} />
                  <Stat label="PFR" value={pct(p.pfr, 0)} />
                  <Stat label="Limp BTN" value={pct(p.limp_btn, 0)} />
                  <Stat label="Shove BTN" value={pct(p.shove_btn, 0)} />
                  <Stat label="3-bet" value={pct(p.threebet, 0)} />
                  <Stat label="Call vs shove (BB)" value={pct(p.call_shove_bb, 0)} />
                  <Stat label="AF" value={num(p.af, 2)} />
                  <Stat label="WTSD / W$SD" value={`${num(p.wtsd, 0)} / ${num(p.wsd, 0)} %`} />
                </div>
                <div className="tiles tiles-4">
                  <Stat label="Votre profit contre lui" value={money(p.hero_profit_vs)} tone={tone(p.hero_profit_vs)} k="profit" />
                  <Stat label="Votre EV profit contre lui" value={money(p.hero_ev_profit_vs)} tone={tone(p.hero_ev_profit_vs)} k="profit" />
                  <Stat label="Son CEV contre vous" value={num(p.cev_vs_hero, 0)} tone={tone(p.cev_vs_hero)} />
                  <Stat label="Victoires vous / lui" value={`${p.hero_wins_vs} / ${p.their_wins_vs}`} sub={`${p.hu_matches} HU joués`} />
                </div>
              </div>
              <div className="col gap12">
                <div className="fsec-t">Tags manuels</div>
                <div className="fchips">
                  {settings?.tags.map((t) => (
                    <button
                      key={t.id}
                      className={cls("fchip", manual.includes(t.id) && "on")}
                      onClick={() => {
                        const n = manual.includes(t.id) ? manual.filter((x) => x !== t.id) : [...manual, t.id];
                        setManual(n);
                        save(n, notes);
                      }}
                    >
                      <TagChip tag={t} small /> {t.name}
                    </button>
                  ))}
                </div>
                <div className="muted small">Les tags automatiques ({p.tags.filter((x) => !manual.includes(x)).join(", ") || "aucun"}) sont calculés par les règles.</div>
                <div className="fsec-t">Notes</div>
                <textarea className="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Tendances, reads, exploits…" rows={6} />
                <div className="row gap8">
                  <Btn kind="primary" small onClick={() => save(manual, notes)}>
                    Enregistrer la note
                  </Btn>
                  <Btn small icon="cards" onClick={() => open(null)}>
                    Fermer
                  </Btn>
                </div>
                <div className="muted small">
                  Vu la première fois {date(p.first_ts)} · dernière {date(p.last_ts)}
                </div>
              </div>
            </div>
          )}
          {tab === "pre" && (lr ? <><RefLegend /><LeakPanels report={lr} /></> : <Loading />)}
          {tab === "post" && (lr ? <PostflopTable mine={lr.postflop.player} reference={lr.postflop.reference} /> : <Loading />)}
          {tab === "tourn" && (
            <div className="tbl-wrap" style={{ maxHeight: 460 }}>
              <table className="tbl hover">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Multi</th>
                    <th className="r">Place</th>
                    <th className="r">Chips</th>
                    <th className="r">EV</th>
                    <th className="r">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {p.together.map((t) => (
                    <tr key={t.id} onClick={() => open({ type: "tournament", id: t.id })}>
                      <td>{date(t.start, true)}</td>
                      <td>
                        <span className={cls("mult", t.multiplier >= 10 && "mult-hi")}>{mult(t.multiplier)}</span>
                      </td>
                      <td className="r">{t.place || "?"}</td>
                      <td className={cls("r", tone(t.chips))}>{signed(t.chips, 0)}</td>
                      <td className={cls("r", tone(t.ev))}>{signed(t.ev, 0)}</td>
                      <td className={cls("r", tone(t.profit))}>
                        <Priv k="profit">{money(t.profit)}</Priv>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
