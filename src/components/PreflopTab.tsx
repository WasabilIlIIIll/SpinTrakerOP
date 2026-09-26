// Onglet Préflop : calcul d'une solution (tapis symétriques ou non) et vue façon GTO Wizard.
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../lib/state";
import { Btn, Help, Panel, Toggle } from "./ui";
import { HandGrid } from "./HandGrid";
import { CardPicker } from "./RangeLab";
import { cls, date, duration, num } from "../lib/format";
import { LIBRARY, cellCombos, preColors, preflopApi, solverApi, type PreView, type PreflopRequest, type SolveRow } from "../lib/solver";

const POS3 = ["BTN", "SB", "BB"];
const POS2 = ["SB", "BB"];

export function PreflopTab({ running, onStarted, onPostflop }: { running: boolean; onStarted: () => void; onPostflop: () => void }) {
  const { toast } = useApp();
  const [req, setReq] = useState<PreflopRequest | null>(null);
  const [players, setPlayers] = useState<3 | 2>(3);
  const [exact, setExact] = useState(true);
  const [list, setList] = useState<SolveRow[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    preflopApi.defaults().then(setReq).catch((e) => toast(String(e), "err"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () =>
    solverApi
      .history(false)
      .then((r) => setList(r.filter((x) => x.kind === "preflop" && ["ok", "non_converge", "arrete"].includes(x.status))))
      .catch(() => {});
  useEffect(() => {
    reload();
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  if (open != null) return <PreflopViewer id={open} onBack={() => setOpen(null)} onPostflop={onPostflop} />;
  if (!req) return null;
  const names = players === 3 ? POS3 : POS2;
  const stacks = players === 3 ? (req.config.stacks.length === 3 ? req.config.stacks : [req.config.stacks[0], ...req.config.stacks]) : req.config.stacks.slice(-2);
  const setStacks = (s: number[]) => setReq({ ...req, config: { ...req.config, stacks: s } });
  const start = async () => {
    try {
      const r = { ...req, config: { ...req.config, stacks }, flops: exact ? req.flops || 20 : 0 };
      await preflopApi.start(r, `${stacks.map((s) => num(s, 1)).join("-")}bb${exact ? "" : " (rapide)"}`);
      onStarted();
    } catch (e) {
      toast(String(e), "err");
    }
  };
  const same = list.filter((r) => JSON.stringify((r.config as unknown as PreflopRequest).config?.stacks) === JSON.stringify(stacks));
  return (
    <div className="col gap16">
      <Panel title="Spot préflop" help="Tapis de chaque joueur en bb, symétriques ou non. Tailles : stratégie simplifiée du cahier des charges (open BTN 2 bb, SB 3 bb, iso 3 bb + 1 par limper, 3-bet 3×, puis all-in).">
        <div className="col gap12">
          <div className="row gap12 wrap">
            <div className="seg seg-sm">
              <button className={cls(players === 3 && "on")} onClick={() => setPlayers(3)}>
                3 joueurs
              </button>
              <button className={cls(players === 2 && "on")} onClick={() => setPlayers(2)}>
                Tête-à-tête
              </button>
            </div>
            {names.map((p, i) => (
              <label key={p} className="row gap8 small">
                <b>{p}</b>
                <input className="inp" style={{ width: 80 }} type="number" step={0.5} min={1} value={stacks[i]} onChange={(e) => setStacks(stacks.map((x, k) => (k === i ? +e.target.value : x)))} />
                <span className="muted">bb</span>
              </label>
            ))}
            <label className="row gap8 small">
              <span className="muted">Ante</span>
              <input className="inp" style={{ width: 70 }} type="number" step={0.05} min={0} value={req.config.ante} onChange={(e) => setReq({ ...req, config: { ...req.config, ante: +e.target.value } })} />
            </label>
          </div>
          <div className="row gap16 wrap">
            <div className="seg seg-sm">
              <button className={cls(exact && "on")} onClick={() => setExact(true)}>
                Exact (solves postflop)
              </button>
              <button className={cls(!exact && "on")} onClick={() => setExact(false)}>
                Rapide (flop à l'équité)
              </button>
            </div>
            {exact && (
              <label className="row gap8 small">
                <span className="muted">Flops de l'échantillon</span>
                <input className="inp" style={{ width: 70 }} type="number" min={1} max={100} value={req.flops || 20} onChange={(e) => setReq({ ...req, flops: Math.max(1, +e.target.value) })} />
                <Help text="Les lignes qui voient le flop à deux sont valorisées par de vrais solves postflop sur cet échantillon de flops représentatif (textures pondérées par fréquence). Compte environ 30 s par flop et par ligne sur ton PC : 20 flops ≈ plusieurs heures. Le mode rapide valorise le flop à l'équité (sans réalisation) : quelques secondes, mais pas GTO au flop." />
              </label>
            )}
            <Toggle on={req.config.push_fold} onChange={(v) => setReq({ ...req, config: { ...req.config, push_fold: v } })} label="Push / fold seulement" />
          </div>
          <div className="row gap12">
            <Btn kind="primary" icon="zap" onClick={start} disabled={running}>
              Calculer la solution
            </Btn>
            {same.length > 0 && (
              <Btn icon="play" onClick={() => setOpen(same[0].id)}>
                Ouvrir la solution existante ({date(same[0].ts, true)})
              </Btn>
            )}
          </div>
        </div>
      </Panel>
      <LibraryPanel req={req} list={list} running={running} onStarted={onStarted} />
      <Panel title="Solutions préflop calculées" pad={false}>
        {list.length === 0 ? (
          <div className="muted small" style={{ padding: 16 }}>
            Aucune solution pour l'instant.
          </div>
        ) : (
          <table className="tbl hover">
            <thead>
              <tr>
                <th>Tapis</th>
                <th>Mode</th>
                <th className="r">Exploitabilité</th>
                <th className="r">Durée</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const q = r.config as unknown as PreflopRequest;
                return (
                  <tr key={r.id} onClick={() => setOpen(r.id)}>
                    <td>
                      <b>{q.config.stacks.map((s) => num(s, 1)).join("-")} bb</b>
                      {q.config.ante > 0 && <span className="muted"> · ante {num(q.config.ante, 2)}</span>}
                    </td>
                    <td>{q.config.push_fold ? "push/fold" : q.flops > 0 ? `exact · ${q.flops} flops` : "rapide (flop à l'équité)"}</td>
                    <td className="r">{r.exploit != null ? `${num(r.exploit * 1000, 1)} mbb/main` : "–"}</td>
                    <td className="r">{duration(Math.round(r.seconds))}</td>
                    <td>{date(r.ts, true)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function PreflopViewer({ id, onBack, onPostflop }: { id: number; onBack: () => void; onPostflop: () => void }) {
  const { toast } = useApp();
  const [path, setPath] = useState<number[]>([]);
  const [v, setV] = useState<PreView | null>(null);
  const [cell, setCell] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [mode, setMode] = useState<"strategy" | "ev" | "ranges">("strategy");
  const [rangeOf, setRangeOf] = useState(0);
  const [board, setBoard] = useState<string[]>([]);
  useEffect(() => {
    preflopApi
      .view(id, path)
      .then((x) => {
        setV(x);
        if (x.player != null) setRangeOf(x.player);
      })
      .catch((e) => toast(String(e), "err"));
  }, [id, path]); // eslint-disable-line react-hooks/exhaustive-deps
  const colors = useMemo(() => (v?.actions ? preColors(v.actions) : []), [v]);
  if (!v) return <div className="gw gw-loading">Chargement…</div>;
  const shown = hover ?? cell;
  const g = v.grid;
  const evs = g ? g.map((x) => x.ev) : [];
  const [emin, emax] = evs.length ? [Math.min(...evs), Math.max(...evs)] : [0, 1];
  const solveFlop = async () => {
    try {
      await preflopApi.toPostflop(id, path, board.join(""));
      toast("Solve postflop lancé avec les ranges exactes de cette ligne");
      onPostflop();
    } catch (e) {
      toast(String(e), "err");
    }
  };
  const alive = v.alive?.filter(Boolean).length ?? 0;
  return (
    <div className="gw">
      <div className="gw-top">
        <div className="gw-tile gw-spot">
          <div className="gw-t">
            Spin & Go <span>{v.label}</span>
          </div>
          <div className="gw-sub">préflop · {v.flops_used > 0 ? `postflop réel (${v.flops_used} flops)` : "flop à l'équité"}</div>
          <button className="gw-btn" onClick={onBack}>
            ⚙ Change
          </button>
        </div>
        {v.tiles.map((t, k) => (
          <button key={k} className="gw-tile" onClick={() => setPath(path.slice(0, k))} title="Revenir à cette décision">
            <div className="gw-t">
              {t.who} <span>{num(t.stack, 1)}</span>
            </div>
            {t.actions.map((a, i) => (
              <div key={i} className={cls("gw-act", i === t.chosen && "on")}>
                {a}
              </div>
            ))}
          </button>
        ))}
        {v.actions && (
          <div className="gw-tile cur">
            <div className="gw-t">
              {v.names[v.player!]} <span>{num(v.stack ?? 0, 1)}</span>
            </div>
            {v.actions.map((a, i) => (
              <button key={i} className="gw-act clk" onClick={() => (setPath([...path, i]), setCell(null))}>
                <i style={{ background: colors[i] }} />
                {a.label}
                <b>{num((v.freq?.[i] ?? 0) * 100, 0)}%</b>
              </button>
            ))}
          </div>
        )}
        {v.terminal === "flop" && (
          <div className="gw-tile cur wide">
            <div className="gw-t">
              FLOP <span>{num(v.pot, 1)}</span>
            </div>
            {alive === 2 ? (
              <div className="gw-sub">Choisis 3 cartes ci-dessous puis lance le solve.</div>
            ) : (
              <div className="gw-sub">Pot à 3 joueurs : le moteur multiway arrive en phase 4.</div>
            )}
          </div>
        )}
        {(v.terminal === "fold" || v.terminal === "showdown") && (
          <div className="gw-tile cur">
            <div className="gw-t">{v.terminal === "fold" ? "FIN" : "ALL-IN"}</div>
            <div className="gw-sub">pot {num(v.pot, 1)} bb</div>
          </div>
        )}
      </div>

      {v.terminal === "flop" && alive === 2 && (
        <div className="gw-panel">
          <div className="row gap12 wrap">
            <div style={{ width: 460 }}>
              <CardPicker board={board} dead={[]} onBoard={(b) => setBoard(b.slice(0, 3))} onDead={() => {}} />
            </div>
            <div className="col gap8">
              <div className="gw-sub">
                Ranges exactes atteintes : {v.names.filter((_, i) => v.alive?.[i]).map((n, k) => `${n} ${num(v.combos_alive?.[k] ?? 0, 0)} combos`).join(" · ")}
              </div>
              <div className="gw-sub">Modèle du flop dans ce préflop : {v.flop_model === "postflop" ? "valeurs de vrais solves postflop" : "équité (approché)"}</div>
              <button className="gw-btn big" disabled={board.length !== 3} onClick={solveFlop}>
                ▶ Solver ce flop
              </button>
            </div>
          </div>
        </div>
      )}

      {g && v.actions && (
        <div className="gw-body">
          <div className="gw-panel gw-left">
            <div className="gw-tabs">
              {(
                [
                  ["strategy", "Strategy"],
                  ["ev", "EV"],
                  ["ranges", "Ranges"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} className={cls(mode === k && "on")} onClick={() => setMode(k)}>
                  {l}
                </button>
              ))}
              <div className="grow" />
              {mode === "ranges" && (
                <div className="gw-seg">
                  {v.names.map((n, p) => (
                    <button key={p} className={cls(rangeOf === p && "on")} onClick={() => setRangeOf(p)}>
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <HandGrid
              selected={cell}
              onCell={(c) => setCell(cell === c ? null : c)}
              onHover={setHover}
              dim={(c) => (mode === "ranges" ? v.reach[rangeOf][c] <= 0.001 : g[c].w <= 0.001)}
              render={(c) => {
                if (mode === "ranges") {
                  const w = v.reach[rangeOf][c];
                  return w > 0.001 ? <div className="hg-fill" style={{ height: `${w * 100}%`, background: "#58b6ff" }} /> : null;
                }
                const x = g[c];
                if (x.w <= 0.001) return null;
                if (mode === "ev") {
                  const t = (x.ev - emin) / Math.max(1e-9, emax - emin);
                  return <div className="hg-fill" style={{ height: `${x.w * 100}%`, background: `color-mix(in srgb, #3fa66a ${Math.round(t * 100)}%, #c8352e)` }} />;
                }
                return (
                  <div className="hg-strat" style={{ height: `${Math.max(6, x.w * 100)}%` }}>
                    {x.s.map((f, i) => (f > 0.002 ? <i key={i} style={{ width: `${f * 100}%`, background: colors[i] }} /> : null))}
                  </div>
                );
              }}
            />
            {shown != null && (
              <div className="gw-cellinfo">
                <b>{g[shown].name}</b> · atteinte {num(g[shown].w * 100, 0)} % · EV {num(g[shown].ev, 3)} bb
                <div className="gw-sbar wide">
                  {g[shown].s.map((f, i) => (f > 0.002 ? <i key={i} style={{ width: `${f * 100}%`, background: colors[i] }} /> : null))}
                </div>
                <div className="row gap12 wrap">
                  {v.actions.map((a, i) => (
                    <span key={i}>
                      <i className="gw-dot" style={{ background: colors[i] }} />
                      {a.label} {num(g[shown].s[i] * 100, 0)} % · EV {num(g[shown].evs[i], 3)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="gw-right">
            <div className="gw-panel">
              <div className="gw-h">Actions chart</div>
              <div className="gw-achart">
                {v.actions.map((a, i) => {
                  const f = v.freq?.[i] ?? 0;
                  return (
                    <div key={i} className="gw-abar" style={{ flexGrow: Math.max(0.04, f) }}>
                      <span>{num(f * 100, 0)}%</span>
                      <i style={{ height: `${Math.max(3, f * 100)}%`, background: colors[i] }} />
                      <em>{a.label}</em>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="gw-panel">
              <div className="gw-h">
                Mains · {v.names[v.player!]} · {num(v.combos ?? 0, 0)} combos
              </div>
              <div className="gw-scroll">
                <table className="gw-tbl">
                  <thead>
                    <tr>
                      <th>Main</th>
                      <th>Strategy</th>
                      <th className="r">Range</th>
                      <th className="r">EV</th>
                      {v.actions.map((a, i) => (
                        <th key={i} className="r">
                          <i className="gw-dot" style={{ background: colors[i] }} />
                          {a.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g
                      .map((x, c) => ({ ...x, c }))
                      .filter((x) => x.w > 0.001 && (cell == null || x.c === cell))
                      .sort((a, b) => b.ev - a.ev)
                      .map((x) => {
                        const best = Math.max(...x.evs);
                        return (
                          <tr key={x.c} className="clk" onClick={() => setCell(x.c)}>
                            <td>
                              <b>{x.name}</b> <span className="gw-mut">{cellCombos(x.c)}</span>
                            </td>
                            <td>
                              <div className="gw-sbar">
                                {x.s.map((f, i) => (f > 0.002 ? <i key={i} style={{ width: `${f * 100}%`, background: colors[i] }} /> : null))}
                              </div>
                            </td>
                            <td className="r">{num(x.w, 2)}</td>
                            <td className="r">{num(x.ev, 3)}</td>
                            {x.evs.map((e, i) => (
                              <td key={i} className={cls("r", Math.abs(e - best) < 0.0005 && "b")}>
                                {num(e, 3)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="gw-src">
        Solver préflop Spin Tracker OP (Discounted CFR, 169 mains, équités exactes) · {v.iterations} itérations · exploitabilité {num(v.exploit * 1000, 2)} mbb/main · {duration(Math.round(v.seconds))} · EV en bb par main,
        sans ICM · flop : {v.flops_used > 0 ? `solves postflop réels sur ${v.flops_used} flops pour les lignes à deux, équité pour les lignes à trois (moteur multiway en phase 4)` : "équité (mode rapide)"}
      </div>
    </div>
  );
}

function LibraryPanel({ req, list, running, onStarted }: { req: PreflopRequest; list: SolveRow[]; running: boolean; onStarted: () => void }) {
  const { toast } = useApp();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [flops, setFlops] = useState(20);
  const key = (s: number[]) => s.join("-");
  const done = new Set(list.filter((r) => (r.config as unknown as PreflopRequest).flops > 0).map((r) => key((r.config as unknown as PreflopRequest).config.stacks)));
  const toggle = (k: string) => {
    const n = new Set(sel);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setSel(n);
  };
  const start = async () => {
    const reqs = LIBRARY.filter((s) => sel.has(key(s))).map((s) => ({ ...req, flops, config: { ...req.config, stacks: s, push_fold: false } }));
    try {
      await preflopApi.batch(reqs);
      toast(`${reqs.length} configuration(s) en file`);
      setSel(new Set());
      onStarted();
    } catch (e) {
      toast(String(e), "err");
    }
  };
  return (
    <Panel
      title="Bibliothèque (calcul de nuit)"
      help="Coche les configurations de tapis à calculer en mode exact ; elles passent l'une après l'autre en tâche de fond, et chacune devient instantanée une fois finie. Compte plusieurs heures par configuration (environ 30 s par flop et par ligne qui voit le flop)."
      right={
        <div className="row gap8 small">
          <span className="muted">Flops</span>
          <input className="inp" style={{ width: 64 }} type="number" min={1} max={100} value={flops} onChange={(e) => setFlops(Math.max(1, +e.target.value))} />
          <button className="fchip" onClick={() => setSel(new Set(LIBRARY.map(key).filter((k) => !done.has(k))))}>
            Tout ce qui manque
          </button>
          <Btn small kind="primary" icon="zap" disabled={running || sel.size === 0} onClick={start}>
            Calculer ({sel.size})
          </Btn>
        </div>
      }
    >
      <div className="lib-grid">
        {LIBRARY.map((s) => {
          const k = key(s);
          const ok = done.has(k);
          return (
            <label key={k} className={cls("lib-item", ok && "ok", sel.has(k) && "on")}>
              <input type="checkbox" checked={sel.has(k)} disabled={ok} onChange={() => toggle(k)} />
              <b>{s.join("-")} bb</b>
              <span className="muted small">{s.length === 3 ? "3 joueurs" : "tête-à-tête"}</span>
              {ok && <span className="pos small">calculée</span>}
            </label>
          );
        })}
      </div>
    </Panel>
  );
}
