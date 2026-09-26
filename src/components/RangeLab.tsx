import { useEffect, useMemo, useState } from "react";
import { useApp } from "../lib/state";
import { Help, Panel, Toggle } from "./ui";
import { PlayingCard } from "./PlayingCard";
import { HandGrid, RangeEditor } from "./HandGrid";
import { cls, num } from "../lib/format";
import { cellName, gridCombos, gridToString, labApi, stringToGrid, topGrid, type Grid, type LabResult } from "../lib/solver";

/** Courbes de distribution d'équité : x = part de la range (0 → 100 %), y = équité. */
export function EquityChart({ series, height = 170 }: { series: { label: string; values: number[]; color: string }[]; height?: number }) {
  const W = 400;
  const H = height;
  const pad = 26;
  const x = (i: number) => pad + (i / 100) * (W - pad - 6);
  const y = (v: number) => H - 18 - v * (H - 28);
  return (
    <div className="eqc">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={pad} x2={W - 6} y1={y(v)} y2={y(v)} className="eqc-grid" />
            <text x={2} y={y(v) + 3} className="eqc-lbl">
              {v * 100}
            </text>
          </g>
        ))}
        {series.map((s) =>
          s.values.length ? <polyline key={s.label} fill="none" stroke={s.color} strokeWidth={2} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} vectorEffect="non-scaling-stroke" /> : null,
        )}
      </svg>
      <div className="row gap12 small">
        {series.map((s) => (
          <span key={s.label}>
            <i className="dot" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
        <span className="muted grow r">mains classées de la plus faible à la plus forte</span>
      </div>
    </div>
  );
}

const SUITS = "shdc";
const RANKS = "AKQJT98765432";

/** Sélecteur des 52 cartes : board (5 max) ou cartes mortes. */
export function CardPicker({ board, dead, onBoard, onDead }: { board: string[]; dead: string[]; onBoard: (b: string[]) => void; onDead: (d: string[]) => void }) {
  const [mode, setMode] = useState<"board" | "dead">("board");
  const click = (c: string) => {
    if (board.includes(c)) return onBoard(board.filter((x) => x !== c));
    if (dead.includes(c)) return onDead(dead.filter((x) => x !== c));
    if (mode === "board") {
      if (board.length >= 5) return;
      onBoard([...board, c]);
    } else onDead([...dead, c]);
  };
  return (
    <div className="col gap8">
      <div className="row gap8 small">
        <button className={cls("fchip", mode === "board" && "on")} onClick={() => setMode("board")}>
          Board
        </button>
        <button className={cls("fchip", mode === "dead" && "on")} onClick={() => setMode("dead")}>
          Cartes mortes
        </button>
        <div className="grow" />
        <button className="fchip" onClick={() => (onBoard([]), onDead([]))}>
          Effacer
        </button>
      </div>
      <div className="cpick">
        {SUITS.split("").map((s) => (
          <div key={s} className="cpick-row">
            {RANKS.split("").map((r) => {
              const c = r + s;
              return (
                <button key={c} className={cls("cpick-c", board.includes(c) && "on", dead.includes(c) && "dead")} onClick={() => click(c)}>
                  <PlayingCard card={c} size="xs" dim={dead.includes(c)} />
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const POS_COLORS: Record<string, string> = { BTN: "#e8a33d", SB: "#4f86d8", BB: "#d84339" };

interface SlotState {
  pos: string;
  grid: Grid;
  active: boolean;
  action: string;
  pct: number | null;
}

const EMPTY = () => Array(169).fill(0);

export function RangeLab({ order }: { order: number[] | null }) {
  const { toast } = useApp();
  const [players, setPlayers] = useState<3 | 2>(3);
  const [slots, setSlots] = useState<SlotState[]>(() => [
    { pos: "BTN", grid: EMPTY(), active: false, action: "Fold", pct: null },
    { pos: "SB", grid: stringToGrid("22+,A2+,K5+,Q8+,J8+,T8+,98,K2s+,Q5s+,J7s+,T7s+,96s+,86s+,75s+,65s,54s") ?? EMPTY(), active: true, action: "Raise", pct: null },
    { pos: "BB", grid: EMPTY(), active: true, action: "Call", pct: null },
  ]);
  const [hero, setHero] = useState(2);
  const [edit, setEdit] = useState(1);
  const [board, setBoard] = useState<string[]>([]);
  const [dead, setDead] = useState<string[]>([]);
  const [hand, setHand] = useState<number | null>(null);
  const [res, setRes] = useState<LabResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [cat, setCat] = useState<number | null>(null);

  const shown = players === 3 ? slots : slots.filter((s) => s.pos !== "BTN");
  const heroIdx = shown.findIndex((s) => s.pos === slots[hero].pos);
  const req = useMemo(
    () => ({
      slots: shown.map((s) => ({ pos: s.pos, range: gridToString(s.grid), active: s.active })),
      hero: heroIdx < 0 ? 0 : heroIdx,
      hand: hand != null ? cellName(hand) : "",
      board: board.join(""),
      dead: dead.join(""),
    }),
    [shown, heroIdx, hand, board, dead],
  );
  const key = JSON.stringify(req);
  useEffect(() => {
    if (!req.slots[req.hero]?.range) {
      setRes(null);
      return;
    }
    const t = window.setTimeout(() => {
      setBusy(true);
      labApi
        .run(req)
        .then((r) => {
          setRes(r);
          setCat(null);
        })
        .catch((e) => toast(String(e), "err"))
        .finally(() => setBusy(false));
    }, 350);
    return () => window.clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSlot = (i: number, p: Partial<SlotState>) => setSlots(slots.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const cur = slots[edit];
  const hl = useMemo(() => (cat != null && res ? new Set(res.categories[cat].cells.map((c) => c[0])) : undefined), [cat, res]);

  return (
    <div className="fz">
      <div className="col gap12">
        <Panel
          title="Positions"
          right={
            <div className="seg seg-sm">
              <button className={cls(players === 3 && "on")} onClick={() => setPlayers(3)}>
                3 joueurs
              </button>
              <button
                className={cls(players === 2 && "on")}
                onClick={() => {
                  setPlayers(2);
                  if (slots[hero].pos === "BTN") setHero(1);
                  if (slots[edit].pos === "BTN") setEdit(1);
                }}
              >
                Tête-à-tête
              </button>
            </div>
          }
        >
          <div className="fz-slots">
            {slots.map((s, i) =>
              players === 2 && s.pos === "BTN" ? null : (
                <div key={s.pos} className={cls("fz-slot", edit === i && "on", !s.active && i !== hero && "off")} onClick={() => setEdit(i)}>
                  <div className="row gap8">
                    <i className="dot" style={{ background: POS_COLORS[s.pos] }} />
                    <b>{s.pos}</b>
                    <input className="inp inp-ghost fz-act" value={s.action} onClick={(e) => e.stopPropagation()} onChange={(e) => setSlot(i, { action: e.target.value })} />
                    <div className="grow" />
                    <label className="small row gap8" onClick={(e) => e.stopPropagation()}>
                      <input type="radio" checked={hero === i} onChange={() => setHero(i)} /> étudiée
                    </label>
                  </div>
                  <div className="row gap8 small muted">
                    <span>
                      {num(gridCombos(s.grid), 0)} combos · {num((gridCombos(s.grid) / 1326) * 100, 1)} %
                    </span>
                    <div className="grow" />
                    {i !== hero && (
                      <span onClick={(e) => e.stopPropagation()}>
                        <Toggle on={s.active} onChange={(v) => setSlot(i, { active: v })} label="dans le coup" />
                      </span>
                    )}
                  </div>
                  {res && (
                    <div className="fz-eq">
                      {(() => {
                        const r = res.slots.find((x) => x.pos === s.pos);
                        return r?.equity != null ? `Équité ${num(r.equity * 100, 1)} %` : s.active || i === hero ? "" : "hors du coup";
                      })()}
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
        </Panel>
        <Panel
          title={
            <>
              <i className="dot" style={{ background: POS_COLORS[cur.pos] }} /> Range {cur.pos} · {cur.action}
            </>
          }
        >
          {order && (
            <div className="row gap8 small" style={{ marginBottom: 10 }}>
              <span className="muted">Top</span>
              <input
                type="range"
                min={0}
                max={100}
                step={0.5}
                value={cur.pct ?? Math.round((gridCombos(cur.grid) / 1326) * 100)}
                onChange={(e) => setSlot(edit, { pct: +e.target.value, grid: topGrid(order, +e.target.value) })}
                className="grow"
              />
              <b style={{ width: 52, textAlign: "right" }}>{num(cur.pct ?? (gridCombos(cur.grid) / 1326) * 100, 1)} %</b>
              <Help text="Classement des 169 mains par équité préflop contre une main aléatoire (30 000 boards). Ce n'est pas une range GTO : c'est un point de départ à retoucher au pinceau." />
            </div>
          )}
          <RangeEditor grid={cur.grid} onChange={(g) => setSlot(edit, { grid: g, pct: null })} color={POS_COLORS[cur.pos]} />
          <RangeText grid={cur.grid} onChange={(g) => setSlot(edit, { grid: g, pct: null })} />
        </Panel>
        <Panel title="Board et cartes mortes">
          <CardPicker board={board} dead={dead} onBoard={setBoard} onDead={setDead} />
        </Panel>
      </div>

      <div className={cls("col gap12", busy && "busy")}>
        <div className="fz-boardline">
          {board.length === 0 ? <span className="muted">Préflop</span> : board.map((c) => <PlayingCard key={c} card={c} size="md" />)}
          {dead.length > 0 && <span className="muted small">· mortes : {dead.join(" ")}</span>}
          <div className="grow" />
          {res && (
            <span className="muted small">
              {res.players} joueurs · {res.exact ? "énumération exacte" : "tirage aléatoire à graine fixe"}
            </span>
          )}
        </div>
        {res ? (
          <>
            <div className="fz-top">
              <Panel title={`Équité par main · ${slots[hero].pos}`} help="Clique une case pour le détail de la main. Couleur : équité de la main contre les ranges des autres positions dans le coup.">
                <HandGrid
                  selected={hand}
                  highlight={hl}
                  onCell={(c) => setHand(hand === c ? null : c)}
                  dim={(c) => res.grid[c] <= 0}
                  render={(c) => {
                    const eq = res.grid_equity[c];
                    if (res.grid[c] <= 0) return null;
                    if (eq == null) return <div className="hg-fill" style={{ height: "100%", background: POS_COLORS[slots[hero].pos], opacity: 0.6 }} />;
                    return <div className="hg-fill" style={{ height: "100%", background: `color-mix(in srgb, #3fa66a ${Math.round(eq * 100)}%, #d84339)` }} />;
                  }}
                />
              </Panel>
              <div className="col gap12">
                <Panel title="Positions">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Position</th>
                        <th className="r">Combos</th>
                        <th className="r">% des mains</th>
                        <th className="r">Équité</th>
                      </tr>
                    </thead>
                    <tbody>
                      {res.slots.map((s) => (
                        <tr key={s.pos} className={cls(s.pos === slots[hero].pos && "hero-row")}>
                          <td>
                            <i className="dot" style={{ background: POS_COLORS[s.pos] }} /> {s.pos} <span className="muted">{slots.find((x) => x.pos === s.pos)?.action}</span>
                          </td>
                          <td className="r">{num(s.combos, 1)}</td>
                          <td className="r">{num(s.pct * 100, 1)} %</td>
                          <td className="r">{s.equity != null ? `${num(s.equity * 100, 1)} %` : "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>
                {res.hand ? (
                  <Panel
                    title={`Main ${res.hand.name}`}
                    right={
                      <button className="icon-btn" onClick={() => setHand(null)} title="Fermer">
                        ×
                      </button>
                    }
                  >
                    <div className="fz-hand">
                      <div>
                        <span>Équité</span>
                        <b>{num(res.hand.equity * 100, 1)} %</b>
                      </div>
                      <div>
                        <span>Gagne</span>
                        <b>{num(res.hand.win * 100, 1)} %</b>
                      </div>
                      <div>
                        <span>Égalité</span>
                        <b>{num(res.hand.tie * 100, 1)} %</b>
                      </div>
                      {res.hand.vs.map(([p, e]) => (
                        <div key={p}>
                          <span>contre {p} seul</span>
                          <b>{num(e * 100, 1)} %</b>
                        </div>
                      ))}
                    </div>
                    {res.hand.outcomes.length > 0 && (
                      <>
                        <div className="muted small" style={{ margin: "12px 0 6px" }}>
                          Ce que {res.hand.name} touche {res.hand.outcomes_street} (toutes les cartes possibles)
                        </div>
                        <div className="cats">
                          {res.hand.outcomes.map((o) => (
                            <div key={o.name + o.draw} className={cls("cat", o.draw && "draw")}>
                              <span>{o.name}</span>
                              <div className="cat-bar">
                                <i style={{ width: `${Math.min(100, o.pct * 100)}%` }} />
                              </div>
                              <b>{num(o.pct * 100, 1)} %</b>
                              <span />
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </Panel>
                ) : (
                  <div className="muted small">Clique une main de la grille (par exemple T2s) pour son équité détaillée et ce qu'elle touche.</div>
                )}
              </div>
            </div>
            {res.categories.length > 0 && (
              <Panel title={`Répartition de la range ${slots[hero].pos} sur le board`} help="Chaque main compte dans une seule catégorie faite ; les tirages se cumulent. Clique une ligne pour la voir sur la grille.">
                <div className="cats">
                  {res.categories.map((c, i) =>
                    c.combos > 0 ? (
                      <button key={c.name} className={cls("cat", cat === i && "on", c.draw && "draw")} onClick={() => setCat(cat === i ? null : i)}>
                        <span>{c.name}</span>
                        <div className="cat-bar">
                          <i style={{ width: `${c.pct * 100}%` }} />
                        </div>
                        <b>{num(c.pct * 100, 1)} %</b>
                        <span className="muted">{num(c.combos, 1)}</span>
                      </button>
                    ) : null,
                  )}
                </div>
              </Panel>
            )}
            {res.distribution.length > 0 && (
              <Panel title="Distribution d'équité">
                <EquityChart series={[{ label: `${slots[hero].pos} contre le champ`, values: res.distribution, color: POS_COLORS[slots[hero].pos] }]} />
              </Panel>
            )}
          </>
        ) : (
          <div className="muted">Remplis la range de la position étudiée.</div>
        )}
      </div>
    </div>
  );
}

function RangeText({ grid, onChange }: { grid: Grid; onChange: (g: Grid) => void }) {
  const str = gridToString(grid);
  const [txt, setTxt] = useState(str);
  useEffect(() => setTxt(str), [str]);
  return (
    <textarea
      className="inp mono"
      rows={2}
      style={{ marginTop: 8 }}
      value={txt}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => {
        const g = stringToGrid(txt);
        if (g) onChange(g);
        else setTxt(str);
      }}
      placeholder="AA-22,AKs,AQo:0.5…"
    />
  );
}
