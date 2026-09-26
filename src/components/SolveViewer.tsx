// Vue d'un solve façon GTO Wizard : barre des décisions en haut, grille 13×13 à gauche,
// statistiques, graphique des actions et tableaux à droite.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "../lib/state";
import { Help } from "./ui";
import { HandGrid } from "./HandGrid";
import { EquityChart } from "./RangeLab";
import { cls, num } from "../lib/format";
import { actionColors, cellCombos, cellName, solverApi, type HandRowN, type LineAction, type NodeAction, type NodeView, type Spot } from "../lib/solver";

interface Step {
  who: string;
  stack?: number;
  /** actions proposées à ce nœud et action choisie ; pour une carte, `card` */
  actions?: string[];
  colors?: string[];
  chosen?: number;
  card?: string;
}

interface Decision {
  street: string;
  played: string;
  playedFreq: number;
  playedEv: number;
  best: string;
  bestEv: number;
  mix: { label: string; freq: number; color: string }[];
  history: number[];
  steps: Step[];
}

const STREET = ["Flop", "Turn", "River"];
const SUIT_BG: Record<string, string> = { h: "#c8352e", d: "#2360d6", c: "#2f8a45", s: "#4a4d55" };
const SUIT_TX: Record<string, string> = { h: "#ff6b61", d: "#5b9bff", c: "#4cc66d", s: "#d8dae0" };
const SYM: Record<string, string> = { h: "♥", d: "♦", c: "♣", s: "♠" };

function sameCombo(a: string, b: string) {
  const x = a.match(/.{2}/g) ?? [];
  const y = b.match(/.{2}/g) ?? [];
  return x.length === 2 && y.length === 2 && ((x[0] === y[0] && x[1] === y[1]) || (x[0] === y[1] && x[1] === y[0]));
}

/** Action de l'arbre la plus proche de l'action réellement jouée. */
function matchAction(actions: NodeAction[], la: LineAction): number {
  const find = (k: string) => actions.findIndex((a) => a.kind === k);
  if (la.kind === "fold" || la.kind === "check" || la.kind === "call") return find(la.kind);
  if (la.kind === "allin") {
    const i = find("allin");
    if (i >= 0) return i;
  }
  const target = la.kind === "bet" ? la.amount : la.to;
  let best = -1;
  let d = Infinity;
  actions.forEach((a, i) => {
    if ((a.kind === "bet" || a.kind === "raise" || a.kind === "allin") && a.amount != null && Math.abs(a.amount - target) < d) {
      d = Math.abs(a.amount - target);
      best = i;
    }
  });
  return best;
}

/** Libellé court façon GTO Wizard : « Bet 50% », « Raise 7.5 », « Allin 12 ». */
function short(a: NodeAction) {
  if (a.kind === "allin") return `Allin ${num(a.amount ?? 0, 1)}`;
  return a.label;
}

/** Combo avec couleurs (quatre couleurs). */
export function ComboText({ combo }: { combo: string }) {
  const cards = combo.match(/.{2}/g) ?? [];
  return (
    <span className="gw-combo">
      {cards.map((c, i) => (
        <span key={i} style={{ color: SUIT_TX[c[1]] }}>
          {c[0]}
          {SYM[c[1]]}
        </span>
      ))}
    </span>
  );
}

function BigCard({ card }: { card: string }) {
  return (
    <span className="gw-bigcard" style={{ background: SUIT_BG[card[1]] }}>
      {card[0] === "T" ? "10" : card[0]}
    </span>
  );
}

function Tabs<T extends string>({ value, onChange, options, right }: { value: T; onChange: (v: T) => void; options: [T, string][]; right?: ReactNode }) {
  return (
    <div className="gw-tabs">
      {options.map(([v, l]) => (
        <button key={v} className={cls(value === v && "on")} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
      <div className="grow" />
      {right}
    </div>
  );
}

function StratBar({ s, colors, wide }: { s: number[]; colors: string[]; wide?: boolean }) {
  return (
    <div className={cls("gw-sbar", wide && "wide")}>
      {s.map((f, i) => (f > 0.002 ? <i key={i} style={{ width: `${f * 100}%`, background: colors[i] }} /> : null))}
    </div>
  );
}

export function SolveViewer({ id, spot, onClose }: { id: number; spot: Spot | null; onClose: () => void }) {
  const { toast } = useApp();
  const [history, setHistory] = useState<number[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [view, setView] = useState<NodeView | null>(null);
  const [loading, setLoading] = useState(false);
  const [left, setLeft] = useState<"strategy" | "ranges" | "breakdown">("strategy");
  const [gridMode, setGridMode] = useState<"strategy" | "ev" | "equity">("strategy");
  const [rangeOf, setRangeOf] = useState(0);
  const [top, setTop] = useState<"overview" | "table" | "equity">("equity");
  const [bottom, setBottom] = useState<"hands" | "summary" | "filters" | "blockers">("hands");
  const [cell, setCell] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [following, setFollowing] = useState(false);
  const [sortKey, setSortKey] = useState<"norm" | "ev" | "equity" | "eqr">("norm");

  useEffect(() => {
    setHistory([]);
    setSteps([]);
    setDecisions(null);
  }, [id]);

  useEffect(() => {
    let stop = false;
    setLoading(true);
    solverApi
      .node(id, history)
      .then((v) => !stop && setView(v))
      .catch((e) => toast(String(e), "err"))
      .finally(() => !stop && setLoading(false));
    return () => {
      stop = true;
    };
  }, [id, history]); // eslint-disable-line react-hooks/exhaustive-deps

  const colors = useMemo(() => (view?.actions ? actionColors(view.actions) : []), [view]);
  const heroCombo = spot?.hero_cards ?? null;
  const spotMatches = !!spot && !!view && spot.config.board.toLowerCase() === view.config.board.toLowerCase();

  const stepFor = (v: NodeView, idx: number): Step => {
    const cols = actionColors(v.actions!);
    return { who: v.labels[v.player!], stack: v.stacks[v.player!], actions: v.actions!.map(short), colors: cols, chosen: idx };
  };
  const play = (idx: number) => {
    if (!view) return;
    if (view.chance) {
      const c = view.cards!.find((x) => x.id === idx)!;
      setSteps([...steps, { who: view.board.length === 3 ? "Turn" : "River", card: c.card }]);
    } else setSteps([...steps, stepFor(view, idx)]);
    setHistory([...history, idx]);
    setCell(null);
  };
  const goto = (k: number) => {
    setHistory(history.slice(0, k));
    setSteps(steps.slice(0, k));
  };

  const follow = async () => {
    if (!spot) return;
    setFollowing(true);
    try {
      const hist: number[] = [];
      const st: Step[] = [];
      const dec: Decision[] = [];
      let v = await solverApi.node(id, hist);
      for (const la of spot.line) {
        while (v.chance && v.cards) {
          const want = spot.runout[v.board.length];
          const c = v.cards.find((x) => x.card === want);
          if (!c) break;
          hist.push(c.id);
          st.push({ who: v.board.length === 3 ? "Turn" : "River", card: want });
          v = await solverApi.node(id, hist);
        }
        if (v.terminal || !v.actions || v.player !== la.side) break;
        const idx = matchAction(v.actions, la);
        if (idx < 0) break;
        const cols = actionColors(v.actions);
        if (heroCombo && spot.hero_side === la.side && v.hands) {
          const row = v.hands.find((h) => sameCombo(h.combo, heroCombo));
          if (row) {
            let bi = 0;
            row.evs.forEach((e, i) => e > row.evs[bi] && (bi = i));
            dec.push({
              street: STREET[v.board.length - 3],
              played: v.actions[idx].label,
              playedFreq: row.strategy[idx],
              playedEv: row.evs[idx],
              best: v.actions[bi].label,
              bestEv: row.evs[bi],
              mix: v.actions.map((a, i) => ({ label: a.label, freq: row.strategy[i], color: cols[i] })),
              history: [...hist],
              steps: [...st],
            });
          }
        }
        st.push(stepFor(v, idx));
        hist.push(idx);
        v = await solverApi.node(id, hist);
      }
      setSteps(st);
      setHistory(hist);
      setDecisions(dec);
      if (!dec.length) toast("Aucune décision du héros retrouvée dans l'arbre", "err");
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setFollowing(false);
    }
  };

  if (!view) return <div className="gw gw-loading">Chargement du solve…</div>;
  const me = view.player ?? 0;
  const bd = view.breakdown ?? [];
  const filterCells = filter ? new Set(bd.find((b) => b.name === filter)?.cells ?? []) : null;
  const hands = (view.hands ?? [])
    .filter((h) => (cell == null || h.cell === cell) && (!filterCells || filterCells.has(h.cell)))
    .sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0) || b.ev - a.ev);
  const shownCell = hover ?? cell;
  const evRange = (() => {
    const g = view.grid?.filter(Boolean) as { ev: number }[] | undefined;
    if (!g?.length) return [0, 1];
    return [Math.min(...g.map((x) => x.ev)), Math.max(...g.map((x) => x.ev))];
  })();
  const flop = view.config.board.match(/.{2}/g)?.slice(0, 3) ?? [];
  const startStreet = (view.config.board.length / 2) as 3 | 4 | 5;

  return (
    <div className="gw">
      {/* ---------------- barre des décisions ---------------- */}
      <div className="gw-top">
        <div className="gw-tile gw-spot">
          <div className="gw-t">
            Spin & Go{" "}
            {spot?.stacks?.length ? (
              <span>{spot.stacks.map((s) => num(s[1], 0)).join("-")}bb</span>
            ) : view.config.context ? (
              <span>{view.config.context.label}</span>
            ) : (
              <span>
                {view.config.oop_label} vs {view.config.ip_label}
              </span>
            )}
          </div>
          <div className="gw-sub">eff. {num(view.config.stack, 1)} bb</div>
          <button className="gw-btn" onClick={onClose}>
            ⚙ Change
          </button>
        </div>
        {!spot &&
          view.config.context?.tiles.map((t, k) => (
            <div key={`c${k}`} className="gw-tile gw-static" title="Décision préflop de la solution (ranges exactes transmises au postflop)">
              <div className="gw-t">
                {t.who} <span>{num(t.stack, 1)}</span>
              </div>
              {t.actions.map((a, i) => (
                <div key={i} className={cls("gw-act", i === t.chosen && "on")}>
                  {a}
                </div>
              ))}
            </div>
          ))}
        {spot?.pre?.map((p, k) => (
          <div key={k} className="gw-tile gw-static" title="Action préflop réellement jouée (le solver préflop arrive en phase 3)">
            <div className="gw-t">
              {p.pos} <span>{num(p.stack, 1)}</span>
            </div>
            <div className="gw-act on">{p.action}</div>
          </div>
        ))}
        <button className="gw-tile gw-flop" onClick={() => goto(0)} title="Revenir au début du solve">
          <div className="gw-t">
            {STREET[startStreet - 3].toUpperCase()} <span>{num(view.config.pot, 1)}</span>
          </div>
          <div className="row gap4">
            {(startStreet === 3 ? flop : view.config.board.match(/.{2}/g) ?? []).map((c) => (
              <BigCard key={c} card={c} />
            ))}
          </div>
        </button>
        {steps.map((s, k) =>
          s.card ? (
            <button key={k} className="gw-tile gw-flop" onClick={() => goto(k + 1)}>
              <div className="gw-t">{s.who.toUpperCase()}</div>
              <BigCard card={s.card} />
            </button>
          ) : (
            <button key={k} className="gw-tile" onClick={() => goto(k + 1)}>
              <div className="gw-t">
                {s.who} <span>{num(s.stack ?? 0, 1)}</span>
              </div>
              {s.actions!.map((a, i) => (
                <div key={i} className={cls("gw-act", i === s.chosen && "on")}>
                  {a}
                </div>
              ))}
            </button>
          ),
        )}
        {view.actions && (
          <div className="gw-tile cur">
            <div className="gw-t">
              {view.labels[me]} <span>{num(view.stacks[me], 1)}</span>
            </div>
            {view.actions.map((a, i) => (
              <button key={i} className="gw-act clk" onClick={() => play(i)}>
                <i style={{ background: colors[i] }} />
                {short(a)}
                <b>{num((view.freq?.[i] ?? 0) * 100, 0)}%</b>
              </button>
            ))}
          </div>
        )}
        {view.chance && (
          <div className="gw-tile cur wide">
            <div className="gw-t">{view.board.length === 3 ? "TURN" : "RIVER"} · choisis la carte</div>
            <div className="gw-cards">
              {view.cards!.map((c) => (
                <button key={c.id} className={cls("gw-mini", spotMatches && spot?.runout[view.board.length] === c.card && "played")} onClick={() => play(c.id)} style={{ color: SUIT_TX[c.card[1]] }}>
                  {c.card[0]}
                  {SYM[c.card[1]]}
                </button>
              ))}
            </div>
            {view.resolve_on_demand && <div className="gw-sub">river re-résolue au clic (quelques secondes)</div>}
          </div>
        )}
        {view.terminal && (
          <div className="gw-tile cur">
            <div className="gw-t">FIN</div>
            <div className="gw-sub">pot {num(view.pot, 1)} bb</div>
          </div>
        )}
        <div className="grow" />
        {spotMatches && (
          <button className="gw-btn big" onClick={follow} disabled={following}>
            {following ? "…" : "▶ Suivre la main jouée"}
          </button>
        )}
      </div>

      {view.resolved_river && <div className="gw-note">River re-résolue depuis les ranges exactes de ce nœud · précision {num(view.resolved_river.exploit, 2)} % du pot.</div>}

      {decisions && decisions.length > 0 && (
        <div className="gw-panel">
          <div className="gw-h">
            Tes décisions face à la solution{" "}
            <Help text="Fréquence que la solution donne à l'action jouée avec ta main exacte, et CEV perdue par rapport à la meilleure action (bb)." />
          </div>
          <table className="gw-tbl">
            <thead>
              <tr>
                <th>Street</th>
                <th>Jouée</th>
                <th>Solution avec ta main</th>
                <th className="r">CEV jouée</th>
                <th className="r">Meilleure</th>
                <th className="r">Perte</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d, k) => {
                const loss = d.bestEv - d.playedEv;
                return (
                  <tr key={k} className="clk" onClick={() => (setHistory(d.history), setSteps(d.steps))}>
                    <td>{d.street}</td>
                    <td>
                      <b>{d.played}</b> <span className="gw-mut">({num(d.playedFreq * 100, 0)} %)</span>
                    </td>
                    <td>
                      <StratBar s={d.mix.map((m) => m.freq)} colors={d.mix.map((m) => m.color)} wide />
                    </td>
                    <td className="r">{num(d.playedEv, 2)}</td>
                    <td className="r">
                      {d.best} · {num(d.bestEv, 2)}
                    </td>
                    <td className={cls("r", loss > 0.05 ? "gw-neg" : "gw-pos")}>{loss > 0.005 ? `−${num(loss, 2)} bb` : "0"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view.actions && (
        <div className={cls("gw-body", loading && "busy")}>
          {/* ---------------- gauche : grille ---------------- */}
          <div className="gw-panel gw-left">
            <Tabs
              value={left}
              onChange={setLeft}
              options={[
                ["strategy", "Strategy"],
                ["ranges", "Ranges"],
                ["breakdown", "Breakdown"],
              ]}
              right={
                left === "strategy" ? (
                  <div className="gw-seg">
                    {(
                      [
                        ["strategy", "Actions"],
                        ["ev", "EV"],
                        ["equity", "EQ"],
                      ] as const
                    ).map(([v, l]) => (
                      <button key={v} className={cls(gridMode === v && "on")} onClick={() => setGridMode(v)}>
                        {l}
                      </button>
                    ))}
                  </div>
                ) : left === "ranges" ? (
                  <div className="gw-seg">
                    {view.labels.map((l, p) => (
                      <button key={p} className={cls(rangeOf === p && "on")} onClick={() => setRangeOf(p)}>
                        {l}
                      </button>
                    ))}
                  </div>
                ) : null
              }
            />
            {left !== "breakdown" ? (
              <div className="gw-gridwrap">
                <HandGrid
                  selected={cell}
                  highlight={filterCells ?? undefined}
                  onCell={(c) => setCell(cell === c ? null : c)}
                  onHover={setHover}
                  dim={(c) => (left === "ranges" && rangeOf !== me ? false : !view.grid?.[c])}
                  render={(c) => {
                    if (left === "ranges" && rangeOf !== me) {
                      // range adverse : poids par case recalculé depuis la distribution n'est pas fourni
                      return null;
                    }
                    const g = view.grid?.[c];
                    if (!g) return null;
                    const h = Math.min(1, g.w / cellCombos(c));
                    if (left === "ranges") return <div className="hg-fill" style={{ height: `${h * 100}%`, background: "#58b6ff" }} />;
                    if (gridMode === "strategy")
                      return (
                        <div className="hg-strat" style={{ height: `${Math.max(6, h * 100)}%` }}>
                          {g.s.map((f, i) => (f > 0.002 ? <i key={i} style={{ width: `${f * 100}%`, background: colors[i] }} /> : null))}
                        </div>
                      );
                    const t = gridMode === "ev" ? (g.ev - evRange[0]) / Math.max(1e-9, evRange[1] - evRange[0]) : g.eq;
                    return <div className="hg-fill" style={{ height: `${Math.max(6, h * 100)}%`, background: `color-mix(in srgb, #3fa66a ${Math.round(t * 100)}%, #c8352e)` }} />;
                  }}
                />
                {left === "ranges" && rangeOf !== me && <div className="gw-sub">La range détaillée de {view.labels[rangeOf]} s'affiche quand c'est à lui de jouer (clique son action précédente).</div>}
              </div>
            ) : (
              <table className="gw-tbl">
                <thead>
                  <tr>
                    <th>Catégorie</th>
                    <th>Stratégie</th>
                    <th className="r">Combos</th>
                    <th className="r">%</th>
                    <th className="r">EV</th>
                  </tr>
                </thead>
                <tbody>
                  {bd.map((b) => (
                    <tr key={b.name} className={cls("clk", filter === b.name && "sel")} onClick={() => setFilter(filter === b.name ? null : b.name)}>
                      <td className={cls(b.draw && "gw-mut")}>{b.name}</td>
                      <td>
                        <StratBar s={b.strategy} colors={colors} />
                      </td>
                      <td className="r">{num(b.combos, 1)}</td>
                      <td className="r">{num(b.pct * 100, 1)}</td>
                      <td className="r">{num(b.ev, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {shownCell != null && view.grid?.[shownCell] && (
              <div className="gw-cellinfo">
                <b>{cellName(shownCell)}</b> · {num(view.grid[shownCell]!.w, 1)} combos · EV {num(view.grid[shownCell]!.ev, 2)} · EQ {num(view.grid[shownCell]!.eq * 100, 1)} %
                <StratBar s={view.grid[shownCell]!.s} colors={colors} wide />
              </div>
            )}
          </div>

          {/* ---------------- droite ---------------- */}
          <div className="gw-right">
            <div className="gw-panel">
              <Tabs
                value={top}
                onChange={setTop}
                options={[
                  ["overview", "Overview"],
                  ["table", "Table"],
                  ["equity", "Equity chart"],
                ]}
              />
              {top === "equity" && (
                <div className="gw-eqwrap">
                  <EquityChart
                    height={190}
                    series={view.summary!.map((s, p) => ({ label: `${view.labels[p]} ${p === 0 ? "OOP" : "IP"}`, values: s.distribution, color: p === 0 ? "#6fd3ff" : "#3fbf6a" }))}
                  />
                  <PlayerStats view={view} me={me} />
                </div>
              )}
              {top === "overview" && <PlayerStats view={view} me={me} wide />}
              {top === "table" && (
                <table className="gw-tbl">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th className="r">Fréquence</th>
                      <th className="r">Combos</th>
                      <th className="r">EV moyenne</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.actions.map((a, i) => (
                      <tr key={i}>
                        <td>
                          <i className="gw-dot" style={{ background: colors[i] }} /> {short(a)}
                        </td>
                        <td className="r">{num((view.freq?.[i] ?? 0) * 100, 1)} %</td>
                        <td className="r">{num(view.action_ev?.[i]?.combos ?? 0, 1)}</td>
                        <td className="r">{view.action_ev?.[i]?.ev != null ? num(view.action_ev[i].ev!, 2) : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="gw-panel">
              <div className="gw-h">Actions chart</div>
              <div className="gw-achart">
                {view.actions.map((a, i) => {
                  const f = view.freq?.[i] ?? 0;
                  return (
                    <div key={i} className="gw-abar" style={{ flexGrow: Math.max(0.04, f) }}>
                      <span>{num(f * 100, 0)}%</span>
                      <i style={{ height: `${Math.max(3, f * 100)}%`, background: colors[i] }} />
                      <em>{short(a)}</em>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="gw-panel">
              <Tabs
                value={bottom}
                onChange={setBottom}
                options={[
                  ["hands", "Hands"],
                  ["summary", "Summary"],
                  ["filters", "Filters"],
                  ["blockers", "Blockers"],
                ]}
                right={
                  (cell != null || filter) && (
                    <button className="gw-btn" onClick={() => (setCell(null), setFilter(null))}>
                      × {[cell != null ? cellName(cell) : null, filter].filter(Boolean).join(" · ")}
                    </button>
                  )
                }
              />
              {bottom === "hands" && <HandsTable hands={hands} actions={view.actions} colors={colors} hero={heroCombo} sortKey={sortKey} onSort={setSortKey} />}
              {bottom === "summary" && <SummaryTable view={view} colors={colors} onCell={setCell} />}
              {bottom === "filters" && (
                <div className="gw-filters">
                  {bd.map((b) => (
                    <button key={b.name} className={cls("gw-chip", filter === b.name && "on", b.draw && "draw")} onClick={() => setFilter(filter === b.name ? null : b.name)}>
                      {b.name} <span>{num(b.pct * 100, 0)}%</span>
                    </button>
                  ))}
                </div>
              )}
              {bottom === "blockers" && <Blockers view={view} />}
            </div>
          </div>
        </div>
      )}
      <div className="gw-src">
        Solver Spin Tracker OP (postflop-solver, Discounted CFR) · solve n°{id} · arbre {view.config.bet_sizes.map((s, k) => `${STREET[k]} ${s.join("/")} %`).join(" · ")} · relance {view.config.raise_sizes.join("/")}× + all-in · valeurs en bb, sans ICM
      </div>
    </div>
  );
}

function PlayerStats({ view, me, wide }: { view: NodeView; me: number; wide?: boolean }) {
  return (
    <div className={cls("gw-pstats", wide && "wide")}>
      {view.summary!.map((s, p) => (
        <div key={p} className={cls("gw-pcard", p === me && "on")}>
          <div className="gw-t">
            {view.labels[p]} <span>{p === 0 ? "OOP" : "IP"}</span>
          </div>
          <div className="gw-kv">
            <div>
              EV <Help text="Part du pot que la range récupère en moyenne depuis ce nœud, en bb (jetons, sans ICM)." />
              <b>{num(s.ev, 2)}</b>
            </div>
            <div>
              Equity<b>{num(s.equity * 100, 2)}%</b>
            </div>
            <div>
              EQR <Help text="Réalisation d'équité : EV ÷ (équité × pot)." />
              <b>{s.eqr != null ? `${num(s.eqr * 100, 0)}%` : "–"}</b>
            </div>
            <div>
              Combos<b>{num(s.combos, 1)}</b>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function HandsTable({ hands, actions, colors, hero, sortKey, onSort }: { hands: HandRowN[]; actions: NodeAction[]; colors: string[]; hero: string | null; sortKey: string; onSort: (k: "norm" | "ev" | "equity" | "eqr") => void }) {
  const [limit, setLimit] = useState(150);
  const rows = hero ? [...hands.filter((h) => sameCombo(h.combo, hero)), ...hands.filter((h) => !sameCombo(h.combo, hero))] : hands;
  const th = (k: "norm" | "ev" | "equity" | "eqr", l: string) => (
    <th className={cls("r clk", sortKey === k && "on")} onClick={() => onSort(k)}>
      {l}
      {sortKey === k ? " ▾" : ""}
    </th>
  );
  return (
    <div className="gw-scroll">
      <table className="gw-tbl">
        <thead>
          <tr>
            <th>Hand</th>
            <th>Strategy</th>
            {th("norm", "Range")}
            {th("ev", "EV")}
            {th("equity", "EQ %")}
            {th("eqr", "EQR %")}
            {actions.map((a, i) => (
              <th key={i} className="r" title={`EV de l'action ${a.label}`}>
                <i className="gw-dot" style={{ background: colors[i] }} />
                {short(a)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((h) => {
            const best = Math.max(...h.evs);
            return (
              <tr key={h.combo} className={cls(hero && sameCombo(h.combo, hero) && "hero", h.norm <= 0 && "gw-dim")}>
                <td>
                  <ComboText combo={h.combo} />
                </td>
                <td>
                  <StratBar s={h.strategy} colors={colors} />
                </td>
                <td className="r">{num(h.weight, 2)}</td>
                <td className="r">{num(h.ev, 2)}</td>
                <td className="r">{num(h.equity * 100, 1)}</td>
                <td className="r">{h.eqr != null ? num(h.eqr * 100, 1) : "–"}</td>
                {h.evs.map((e, i) => (
                  <td key={i} className={cls("r", Math.abs(e - best) < 0.005 && "b", h.strategy[i] < 0.002 && Math.abs(e - best) >= 0.005 && "gw-mut")}>
                    {num(e, 2)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > limit && (
        <button className="gw-btn" style={{ margin: 8 }} onClick={() => setLimit(limit + 300)}>
          {rows.length - limit} mains de plus
        </button>
      )}
    </div>
  );
}

function SummaryTable({ view, colors, onCell }: { view: NodeView; colors: string[]; onCell: (c: number) => void }) {
  const rows = (view.grid ?? []).map((g, c) => ({ g, c })).filter((x) => x.g) as { g: NonNullable<NodeView["grid"]>[number] & object; c: number }[];
  rows.sort((a, b) => b.g.ev - a.g.ev);
  return (
    <div className="gw-scroll">
      <table className="gw-tbl">
        <thead>
          <tr>
            <th>Main</th>
            <th>Strategy</th>
            <th className="r">Combos</th>
            <th className="r">EV</th>
            <th className="r">EQ %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ g, c }) => (
            <tr key={c} className="clk" onClick={() => onCell(c)}>
              <td>
                <b>{cellName(c)}</b>
              </td>
              <td>
                <StratBar s={g.s} colors={colors} />
              </td>
              <td className="r">{num(g.w, 1)}</td>
              <td className="r">{num(g.ev, 2)}</td>
              <td className="r">{num(g.eq * 100, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Blockers({ view }: { view: NodeView }) {
  const [by, setBy] = useState<"value" | "trash">("value");
  const rows = [...(view.blockers ?? [])].sort((a, b) => b[by] - a[by]);
  const opp = view.labels[(view.player ?? 0) ^ 1];
  return (
    <div className="gw-scroll">
      <div className="gw-sub" style={{ padding: "6px 10px" }}>
        Part de la range {opp} retirée si tu tiens la carte : « valeur » = ses mains à 50 % d'équité ou plus, « trash » = les autres.
      </div>
      <table className="gw-tbl">
        <thead>
          <tr>
            <th>Carte</th>
            <th className={cls("r clk", by === "value" && "on")} onClick={() => setBy("value")}>
              Value removal
            </th>
            <th className={cls("r clk", by === "trash" && "on")} onClick={() => setBy("trash")}>
              Trash removal
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.card}>
              <td>
                <ComboText combo={b.card} />
              </td>
              <td className="r">{num(b.value * 100, 1)} %</td>
              <td className="r">{num(b.trash * 100, 1)} %</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
