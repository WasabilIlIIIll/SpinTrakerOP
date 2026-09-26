import { useEffect, useMemo, useState } from "react";
import { useApp } from "../lib/state";
import { Btn, Empty, Help, Loading, Panel, Seg, Toggle } from "../components/ui";
import { Icon } from "../components/Icon";
import { Cards } from "../components/PlayingCard";
import { RangeEditor } from "../components/HandGrid";
import { SolveViewer } from "../components/SolveViewer";
import { RangeLab } from "../components/RangeLab";
import { PreflopTab } from "../components/PreflopTab";
import { AllinCalc } from "../components/AllinCalc";
import { cls, date, duration, num } from "../lib/format";
import {
  PRECISIONS,
  PRESETS,
  gridCombos,
  gridToString,
  pending,
  solverApi,
  stringToGrid,
  type JobStatus,
  type PostflopConfig,
  type SolveRow,
  type Spot,
} from "../lib/solver";

type Tab = "postflop" | "preflop" | "ranges" | "history";

export function SolverPage() {
  const { toast } = useApp();
  const [tab, setTab] = useState<Tab>("postflop");
  const [cfg, setCfg] = useState<PostflopConfig | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [handId, setHandId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [order, setOrder] = useState<number[] | null>(null);

  useEffect(() => {
    solverApi.defaults().then((d) => setCfg((c) => c ?? d)).catch((e) => toast(String(e), "err"));
    solverApi.order().then(setOrder).catch(() => {});
    solverApi.status().then(setJob).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // « Solver la main » depuis le Replayer
  useEffect(() => {
    const id = pending.handId;
    if (!id) return;
    pending.handId = null;
    solverApi
      .spotFromHand(id)
      .then((s) => {
        setSpot(s);
        setHandId(id);
        setCfg((c) => ({ ...s.config, oop_range: c?.oop_range ?? "", ip_range: c?.ip_range ?? "" }));
        setOpenId(null);
        setTab("postflop");
      })
      .catch((e) => toast(String(e), "err"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // suivi du calcul
  const running = job?.state === "running";
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      solverApi
        .status()
        .then((j) => {
          setJob(j);
          if (j && j.state !== "running") {
            if (j.state === "erreur") toast(j.message || "Le solve a échoué", "err");
            else if (j.kind === "preflop") toast(j.state === "ok" ? "Solution préflop prête" : "Solution préflop arrêtée avant la précision visée");
            else {
              toast(j.state === "ok" ? "Solve terminé" : "Solve arrêté avant la précision visée");
              setOpenId(j.id);
            }
          }
        })
        .catch(() => {});
    }, 700);
    return () => window.clearInterval(t);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    if (!cfg) return;
    try {
      const label = spot ? `${spot.config.oop_label} vs ${spot.config.ip_label} · ${spot.preflop}` : `${cfg.oop_label} vs ${cfg.ip_label}`;
      await solverApi.start(cfg, handId, label);
      setJob(await solverApi.status());
    } catch (e) {
      toast(String(e), "err");
    }
  };

  return (
    <div className="page solver">
      <div className="page-head">
        <h2>Solver</h2>
        <Seg
          value={tab}
          onChange={setTab}
          options={[
            { v: "postflop", l: "Postflop" },
            { v: "preflop", l: "Préflop" },
            { v: "ranges", l: "Ranges" },
            { v: "history", l: "Historique" },
          ]}
        />
      </div>
      {job && running && <JobBar job={job} />}
      {tab === "postflop" &&
        (openId != null ? (
          <SolveViewer id={openId} spot={spot} onClose={() => setOpenId(null)} />
        ) : !cfg ? (
          <Loading />
        ) : (
          <Setup cfg={cfg} setCfg={setCfg} spot={spot} order={order} running={running} onStart={start} onClearSpot={() => (setSpot(null), setHandId(null))} />
        ))}
      {tab === "preflop" && (
        <PreflopTab
          running={running}
          onStarted={() => solverApi.status().then(setJob).catch(() => {})}
          onPostflop={() => {
            setSpot(null);
            setHandId(null);
            setOpenId(null);
            setTab("postflop");
            solverApi.status().then(setJob).catch(() => {});
          }}
        />
      )}
      {tab === "ranges" && <RangesTab order={order} />}
      {tab === "history" && (
        <History
          onOpen={(r) => {
            setOpenId(r.id);
            if (r.hand_id !== handId) {
              setSpot(null);
              setHandId(null);
              if (r.hand_id)
                solverApi
                  .spotFromHand(r.hand_id)
                  .then((s) => (setSpot(s), setHandId(r.hand_id)))
                  .catch(() => {});
            }
            setTab("postflop");
          }}
          onReuse={(r) => {
            setCfg(r.config);
            setOpenId(null);
            setTab("postflop");
          }}
          version={job?.state}
        />
      )}
    </div>
  );
}

function JobBar({ job }: { job: JobStatus }) {
  const pre = job.kind === "preflop" || job.kind === "tables";
  const done = pre ? job.progress : job.exploit != null && job.exploit > 0 ? Math.min(1, Math.log(100 / job.exploit) / Math.log(100 / job.target)) : 0;
  return (
    <div className="job">
      <div className="row gap12">
        <Icon name="zap" size={16} />
        <b>{job.kind === "tables" ? "Préparation" : pre ? `Préflop n°${job.id}` : `Solve n°${job.id}`}</b>
        <span className="muted">
          {pre ? `${job.message} · ${num(job.progress * 100, 1)} %` : `${job.message} · itération ${job.iter} / ${job.max_iters}`} · {duration(Math.round(job.seconds))}
          {!pre && ` · ${num(job.memory_mb)} Mo`}
        </span>
        <div className="grow" />
        <span>
          {pre ? (
            <>Exploitabilité {job.exploit != null ? `${num(job.exploit * 1000, 2)} mbb/main` : "…"}</>
          ) : (
            <>
              Précision {job.exploit != null ? `${num(job.exploit, 2)} %` : "…"} <span className="muted">/ cible {num(job.target, 2)} % du pot</span>
            </>
          )}
        </span>
        <Btn small kind="danger" icon="x" onClick={() => solverApi.cancel()}>
          Arrêter
        </Btn>
      </div>
      <div className="job-bar">
        <i style={{ width: `${Math.max(2, done * 100)}%` }} />
      </div>
    </div>
  );
}

function sizesStr(v: number[]) {
  return v.join(", ");
}
function parseSizes(s: string): number[] {
  return s
    .split(/[,;\s]+/)
    .map((x) => parseFloat(x.replace("%", "").replace("x", "")))
    .filter((x) => x > 0);
}

function Setup({
  cfg,
  setCfg,
  spot,
  order,
  running,
  onStart,
  onClearSpot,
}: {
  cfg: PostflopConfig;
  setCfg: (c: PostflopConfig) => void;
  spot: Spot | null;
  order: number[] | null;
  running: boolean;
  onStart: () => void;
  onClearSpot: () => void;
}) {
  const { toast } = useApp();
  const [est, setEst] = useState<{ memory_mb: number; compressed_mb: number } | null>(null);
  const set = (p: Partial<PostflopConfig>) => {
    setCfg({ ...cfg, ...p });
    setEst(null);
  };
  const preset = PRESETS.find((p) => JSON.stringify(p.sizes) === JSON.stringify(cfg.bet_sizes) && JSON.stringify(p.raise) === JSON.stringify(cfg.raise_sizes))?.id ?? "perso";
  const boardCards = useMemo(() => (cfg.board.replace(/\s/g, "").match(/.{2}/g) ?? []).map((c) => c[0].toUpperCase() + c[1].toLowerCase()), [cfg.board]);
  const estimate = async () => {
    try {
      setEst(await solverApi.estimate(cfg));
    } catch (e) {
      toast(String(e), "err");
    }
  };
  useEffect(() => {
    if (cfg.oop_range && cfg.ip_range && boardCards.length >= 3) {
      const t = window.setTimeout(() => solverApi.estimate(cfg).then(setEst).catch(() => setEst(null)), 500);
      return () => window.clearTimeout(t);
    }
  }, [cfg]); // eslint-disable-line react-hooks/exhaustive-deps
  // plafond : 25 Go de RAM ; au-delà en 32 bits, l'arbre est stocké compressé (16 bits)
  const heavy = est && est.memory_mb > 25000;
  const tooBig = est && est.compressed_mb > 25000;
  return (
    <div className="col gap16">
      {spot && (
        <Panel
          title={
            <>
              <Icon name="cards" size={15} /> Main importée
            </>
          }
          right={
            <Btn small icon="x" onClick={onClearSpot}>
              Oublier la main
            </Btn>
          }
        >
          <div className="row gap16 wrap">
            <div>
              <div className="muted small">Préflop</div>
              <b>{spot.preflop || "–"}</b>
            </div>
            <div>
              <div className="muted small">Joueurs</div>
              <b>
                {spot.config.oop_label} {spot.names[0]} (OOP) · {spot.config.ip_label} {spot.names[1]} (IP)
              </b>
            </div>
            {spot.hero_cards && (
              <div>
                <div className="muted small">Ta main</div>
                <Cards cards={spot.hero_cards.match(/.{2}/g)} />
              </div>
            )}
            <div>
              <div className="muted small">Board</div>
              <Cards cards={spot.runout} />
            </div>
          </div>
          {(spot.config.extra_bets.some((s) => s[0].length || s[1].length) || spot.config.extra_raises.some((s) => s[0].length || s[1].length)) && (
            <div className="muted small" style={{ marginTop: 10 }}>
              Tailles jouées ajoutées à l'arbre :{" "}
              {spot.config.extra_bets
                .map((s, st) => [...s[0], ...s[1]].map((x) => `${["flop", "turn", "river"][st]} ${x} %`))
                .flat()
                .concat(spot.config.extra_raises.map((s, st) => [...s[0], ...s[1]].map((x) => `relance ${["flop", "turn", "river"][st]} ${x}×`)).flat())
                .join(", ")}
            </div>
          )}
          <div className="note small">
            Les ranges préflop ne sont pas encore calculées par le solver (phase 3) : saisis-les ci-dessous. Le solve ne dit rien de plus juste que les ranges qu'on lui donne.
          </div>
        </Panel>
      )}
      <Panel title="Spot">
        <div className="form-grid">
          <label>
            <span>Board (3 à 5 cartes)</span>
            <input className="inp" value={cfg.board} placeholder="9s7h4d" onChange={(e) => set({ board: e.target.value })} />
          </label>
          <div className="row gap8">{boardCards.length > 0 && <Cards cards={boardCards} size="sm" />}</div>
          <label>
            <span>Pot au début de la street (bb)</span>
            <input className="inp" type="number" step={0.5} value={cfg.pot} onChange={(e) => set({ pot: +e.target.value })} />
          </label>
          <label>
            <span>Tapis effectif restant (bb)</span>
            <input className="inp" type="number" step={0.5} value={cfg.stack} onChange={(e) => set({ stack: +e.target.value })} />
          </label>
          <label>
            <span>Joueur hors position (OOP)</span>
            <select className="sel" value={cfg.oop_label} onChange={(e) => set({ oop_label: e.target.value })}>
              {["SB", "BB", "BTN"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Joueur en position (IP)</span>
            <select className="sel" value={cfg.ip_label} onChange={(e) => set({ ip_label: e.target.value })}>
              {["BTN", "BB", "SB"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>
          SPR {num(cfg.stack / Math.max(0.01, cfg.pot), 2)} · valeurs en bb, sans ICM (chip EV)
        </div>
      </Panel>
      <div className="grid2">
        <RangePanel title={`Range ${cfg.oop_label} (OOP)`} value={cfg.oop_range} onChange={(v) => set({ oop_range: v })} order={order} color="#4f86d8" />
        <RangePanel title={`Range ${cfg.ip_label} (IP)`} value={cfg.ip_range} onChange={(v) => set({ ip_range: v })} order={order} color="#d84339" />
      </div>
      <Panel
        title="Arbre et précision"
        help="Mises en % du pot, relance en multiple de la mise adverse. L'all-in est toujours proposé. Plus il y a de tailles au turn et à la river, plus l'arbre est lourd : depuis le flop, 4 tailles partout peuvent demander 25 Go."
      >
        <div className="col gap12">
          <div className="row gap12 wrap">
            <Seg
              value={preset}
              onChange={(id) => {
                const p = PRESETS.find((x) => x.id === id);
                if (p) set({ bet_sizes: p.sizes, raise_sizes: p.raise });
              }}
              options={[...PRESETS.map((p) => ({ v: p.id, l: p.label })), ...(preset === "perso" ? [{ v: "perso", l: "Perso" }] : [])]}
            />
            <span className="muted small">{PRESETS.find((p) => p.id === preset)?.hint ?? "tailles personnalisées"}</span>
          </div>
          <div className="form-grid">
            {["Flop", "Turn", "River"].map((st, k) => (
              <label key={st}>
                <span>Mises {st} (% du pot)</span>
                <SizesInput
                  value={cfg.bet_sizes[k]}
                  onChange={(v) => {
                    const b = [...cfg.bet_sizes] as PostflopConfig["bet_sizes"];
                    b[k] = v;
                    set({ bet_sizes: b });
                  }}
                />
              </label>
            ))}
            <label>
              <span>Relances (× la mise)</span>
              <SizesInput value={cfg.raise_sizes} onChange={(v) => set({ raise_sizes: v })} />
            </label>
          </div>
          <div className="row gap16 wrap">
            <Toggle on={cfg.donk} onChange={(v) => set({ donk: v })} label="Donk bets (mêmes tailles)" />
            <Seg small value={String(cfg.precision)} onChange={(v) => set({ precision: +v })} options={PRECISIONS.map((p) => ({ v: String(p.v), l: p.l }))} />
            <label className="row gap8 small">
              <span className="muted">Itérations max</span>
              <input className="inp" style={{ width: 80 }} type="number" value={cfg.max_iters} onChange={(e) => set({ max_iters: Math.max(10, +e.target.value) })} />
            </label>
          </div>
        </div>
      </Panel>
      <div className="row gap12 wrap">
        <Btn kind="primary" icon="zap" disabled={running || !cfg.oop_range || !cfg.ip_range || boardCards.length < 3} onClick={onStart}>
          Lancer le solve
        </Btn>
        <Btn icon="info" onClick={estimate}>
          Estimer la mémoire
        </Btn>
        {est && (
          <span className={cls("small", heavy ? "warn" : "muted")}>
            Arbre : {num(est.memory_mb)} Mo{tooBig ? " : au-delà du plafond de 25 Go, même compressé. Réduis les tailles ou les ranges." : heavy ? ` → stocké compressé (${num(est.compressed_mb)} Mo), calcul plus long` : ""}
          </span>
        )}
        {running && <span className="muted small">Un solve est déjà en cours.</span>}
      </div>
    </div>
  );
}

function SizesInput({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const [txt, setTxt] = useState(sizesStr(value));
  useEffect(() => setTxt(sizesStr(value)), [value.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input className="inp" value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={() => onChange(parseSizes(txt))} />;
}

function RangePanel({ title, value, onChange, order, color }: { title: string; value: string; onChange: (v: string) => void; order: number[] | null; color: string }) {
  const [txt, setTxt] = useState(value);
  useEffect(() => setTxt(value), [value]);
  const grid = useMemo(() => stringToGrid(value), [value]);
  return (
    <Panel title={title} right={grid && <span className="muted small">{num(gridCombos(grid), 0)} combos</span>}>
      <div className="col gap8">
        {grid ? (
          <RangeEditor grid={grid} onChange={(g) => onChange(gridToString(g))} order={order} color={color} />
        ) : (
          <div className="note small">Range saisie combo par combo : modifiable seulement en texte.</div>
        )}
        <textarea className="inp mono" rows={3} value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={() => onChange(txt.trim())} placeholder="AA-22,AKs,AQo:0.5…" />
      </div>
    </Panel>
  );
}

const STATUS: Record<string, [string, string]> = {
  ok: ["Convergé", "pos"],
  non_converge: ["Non convergé", "warn"],
  arrete: ["Arrêté", "warn"],
  running: ["En cours", "muted"],
  interrompu: ["Interrompu", "neg"],
  erreur: ["Erreur", "neg"],
};

function History({ onOpen, onReuse, version }: { onOpen: (r: SolveRow) => void; onReuse: (r: SolveRow) => void; version?: string }) {
  const { toast, open } = useApp();
  const [trash, setTrash] = useState(false);
  const [rows, setRows] = useState<SolveRow[] | null>(null);
  const [q, setQ] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const reload = () => solverApi.history(trash).then(setRows).catch((e) => toast(String(e), "err"));
  useEffect(() => {
    reload();
  }, [trash, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return <Loading />;
  const shown = rows.filter((r) => (!favOnly || r.fav) && (!q || `${r.label} ${r.config.board} ${r.note}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <Panel
      title={trash ? "Corbeille des solves" : "Historique des solves"}
      right={
        <div className="row gap8">
          <input className="inp" placeholder="Rechercher (board, label, note)" value={q} onChange={(e) => setQ(e.target.value)} />
          {!trash && <Toggle on={favOnly} onChange={setFavOnly} label="Favoris" />}
          <Btn small icon="trash" onClick={() => setTrash(!trash)}>
            {trash ? "Retour à l'historique" : "Corbeille"}
          </Btn>
          {trash && rows.length > 0 && (
            <Btn
              small
              kind="danger"
              onClick={async () => {
                if (!window.confirm(`Supprimer définitivement ${rows.length} solve(s) et leurs fichiers ?`)) return;
                const n = await solverApi.purge();
                toast(`${n} solve(s) supprimé(s)`);
                reload();
              }}
            >
              Vider la corbeille
            </Btn>
          )}
        </div>
      }
      pad={false}
    >
      {shown.length === 0 ? (
        <Empty title={trash ? "Corbeille vide" : "Aucun solve"} sub={trash ? undefined : "Lance un solve depuis l'onglet Postflop, ou « Solver la main » depuis le Replayer."} icon="zap" />
      ) : (
        <div className="tbl-wrap tall">
          <table className="tbl hover">
            <thead>
              <tr>
                <th />
                <th>Date</th>
                <th>Spot</th>
                <th>Board</th>
                <th className="r">Pot / tapis</th>
                <th>État</th>
                <th className="r">Précision</th>
                <th className="r">Durée</th>
                <th className="r">Fichier</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const [st, tone] = STATUS[r.status] ?? [r.status, "muted"];
                const canOpen = ["ok", "non_converge", "arrete"].includes(r.status);
                return (
                  <tr key={r.id} onClick={() => canOpen && !trash && onOpen(r)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        className={cls("star", r.fav && "on")}
                        onClick={async () => {
                          await solverApi.update(r.id, { fav: !r.fav });
                          reload();
                        }}
                      >
                        <Icon name="star" size={14} fill={r.fav} />
                      </button>
                    </td>
                    <td>{date(r.ts, true)}</td>
                    <td>
                      {r.label}
                      {r.hand_id && (
                        <button
                          className="linkish muted small"
                          style={{ marginLeft: 6 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            open({ type: "hand", id: r.hand_id! });
                          }}
                        >
                          (main)
                        </button>
                      )}
                    </td>
                    <td>
                      <Cards cards={r.config.board.match(/.{2}/g)} size="xs" />
                    </td>
                    <td className="r">
                      {num(r.config.pot, 1)} / {num(r.config.stack, 1)} bb
                    </td>
                    <td className={tone}>{st}</td>
                    <td className="r">{r.exploit != null ? `${num(r.exploit, 2)} %` : "–"}</td>
                    <td className="r">{duration(Math.round(r.seconds))}</td>
                    <td className="r muted" title={r.storage === "turn" ? "Flop et turn enregistrés, river re-résolue à la demande" : r.storage === "flop" ? "Flop seul enregistré" : "Toutes les streets enregistrées"}>
                      {r.bytes ? `${num(r.bytes / 1e6, 1)} Mo` : "–"} {r.storage !== "river" && <span className="small">· {r.storage === "turn" ? "flop+turn" : "flop"}</span>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        className="inp inp-ghost"
                        defaultValue={r.note}
                        placeholder="note…"
                        onBlur={(e) => e.target.value !== r.note && solverApi.update(r.id, { note: e.target.value }).then(reload)}
                      />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row gap8">
                        {!trash && r.storage !== "flop" && r.config.board.length === 6 && (
                          <button
                            className="icon-btn"
                            title="Alléger : ne garder que le flop (turn et river devront être re-résolus)"
                            onClick={async () => {
                              if (!window.confirm("Ne garder que le flop de ce solve ? Les streets suivantes ne seront plus consultables.")) return;
                              try {
                                const b = await solverApi.lighten(r.id, false);
                                toast(`Solve allégé : ${num(b / 1e6, 1)} Mo`);
                                reload();
                              } catch (e) {
                                toast(String(e), "err");
                              }
                            }}
                          >
                            <Icon name="download" size={14} />
                          </button>
                        )}
                        {!trash && (
                          <button className="icon-btn" title="Reprendre ces paramètres" onClick={() => onReuse(r)}>
                            <Icon name="refresh" size={14} />
                          </button>
                        )}
                        <button
                          className="icon-btn"
                          title={trash ? "Restaurer" : "Mettre à la corbeille"}
                          onClick={async () => {
                            await solverApi.trash(r.id, !trash);
                            reload();
                          }}
                        >
                          <Icon name={trash ? "refresh" : "trash"} size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted small" style={{ padding: "10px 16px" }}>
        Précision = exploitabilité mesurée en fin de calcul, en % du pot : ce qu'un adversaire parfait gagnerait au maximum contre la solution. <Help text="Convergé : la précision visée est atteinte. Non convergé : le nombre maximal d'itérations a été atteint avant. Les solves sont stockés dans le dossier de données de l'application (sous-dossier solves)." />
      </div>
    </Panel>
  );
}

function RangesTab({ order }: { order: number[] | null }) {
  const [mode, setMode] = useState<"allin" | "fz">("allin");
  return (
    <div className="col gap12">
      <Seg
        small
        value={mode}
        onChange={setMode}
        options={[
          { v: "allin", l: "Équité à tapis" },
          { v: "fz", l: "Analyse de range (board)" },
        ]}
      />
      {mode === "allin" ? <AllinCalc order={order} /> : <RangeLab order={order} />}
    </div>
  );
}
