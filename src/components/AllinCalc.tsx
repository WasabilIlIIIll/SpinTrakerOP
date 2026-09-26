// Équité à tapis préflop : un joueur pousse, on étudie le call d'un autre, avec le joueur qui
// reste à parler derrière (sur-call → pot à trois, side pots compris). Tapis exacts, CEV en bb.
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../lib/state";
import { Help, Panel, Toggle } from "./ui";
import { HandGrid, RangeEditor } from "./HandGrid";
import { cls, num } from "../lib/format";
import { allinApi, guardApi, cellName, gridCombos, gridToString, stringToGrid, topGrid, type AllinResult, type Grid } from "../lib/solver";

const POS3 = ["BTN", "SB", "BB"];
const POS2 = ["SB", "BB"];

export function AllinCalc({ order }: { order: number[] | null }) {
  const { toast } = useApp();
  const [players, setPlayers] = useState<3 | 2>(3);
  const [stacks3, setStacks3] = useState([14, 14, 14]);
  const [stacks2, setStacks2] = useState([14, 14]);
  const [ante, setAnte] = useState(0);
  const [shover, setShover] = useState(0);
  const [hero, setHero] = useState(1);
  const [behindOn, setBehindOn] = useState(true);
  const [shoveGrid, setShoveGrid] = useState<Grid>(() => Array(169).fill(0));
  const [shovePct, setShovePct] = useState(14);
  const [behindGrid, setBehindGrid] = useState<Grid>(() => Array(169).fill(0));
  const [behindPct, setBehindPct] = useState(8);
  const [edit, setEdit] = useState<"shove" | "behind">("shove");
  const [res, setRes] = useState<AllinResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [cell, setCell] = useState<number | null>(null);
  const [needTables, setNeedTables] = useState(false);
  const [prep, setPrep] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // ranges initiales en « top X % » dès que le classement est prêt
  useEffect(() => {
    if (!order) return;
    setShoveGrid(topGrid(order, 14));
    setBehindGrid(topGrid(order, 8));
  }, [order]);

  const names = players === 3 ? POS3 : POS2;
  const stacks = players === 3 ? stacks3 : stacks2;
  const setStack = (i: number, v: number) => (players === 3 ? setStacks3(stacks3.map((x, k) => (k === i ? v : x))) : setStacks2(stacks2.map((x, k) => (k === i ? v : x))));
  const sh = Math.min(shover, names.length - 2);
  const he = Math.max(hero, sh + 1) >= names.length ? names.length - 1 : Math.max(hero, sh + 1);
  // le joueur qui parle après le joueur étudié (seulement à 3, si le pousseur n'est pas derrière)
  const behind = players === 3 && he < 2 ? 2 : null;
  const useBehind = behind != null && behindOn;

  const req = useMemo(
    () => ({ stacks, ante, shover: sh, shove_range: gridToString(shoveGrid), hero: he, behind: useBehind ? behind : null, behind_range: gridToString(behindGrid) }),
    [stacks, ante, sh, shoveGrid, he, useBehind, behind, behindGrid],
  );
  const key = JSON.stringify(req);
  useEffect(() => {
    if (!req.shove_range) {
      setRes(null);
      return;
    }
    const t = window.setTimeout(() => {
      setBusy(true);
      allinApi
        .run(req)
        .then((r) => {
          setRes(r);
          setNeedTables(false);
        })
        .catch((e) => {
          if (String(e).includes("TABLES_ABSENTES")) setNeedTables(true);
          else toast(String(e), "err");
        })
        .finally(() => setBusy(false));
    }, 250);
    return () => window.clearTimeout(t);
  }, [key, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // suivi de la préparation des tables à 3 joueurs
  useEffect(() => {
    if (prep == null) return;
    const t = window.setInterval(async () => {
      const [s, j] = await Promise.all([guardApi.state(), import("../lib/solver").then((m) => m.solverApi.status())]);
      if (j?.kind === "tables") setPrep(j.state === "running" ? j.message : null);
      if (!s.running) {
        setPrep(null);
        if (s.tables) setTick((x) => x + 1);
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [prep]);

  const rows = res?.rows ?? [];
  const byName = useMemo(() => new Map(rows.map((r) => [r.name, r])), [rows]);
  const sel = cell != null ? byName.get(cellName(cell)) : undefined;
  const maxGap = Math.max(0.5, ...rows.map((r) => Math.abs(r.ev_call - r.ev_fold)));

  return (
    <div className="fz">
      <div className="col gap12">
        <Panel
          title="Tapis et rôles"
          right={
            <div className="seg seg-sm">
              <button className={cls(players === 3 && "on")} onClick={() => setPlayers(3)}>
                3 joueurs
              </button>
              <button className={cls(players === 2 && "on")} onClick={() => (setPlayers(2), setShover(0), setHero(1))}>
                Tête-à-tête
              </button>
            </div>
          }
        >
          <table className="tbl">
            <thead>
              <tr>
                <th>Position</th>
                <th className="r">Tapis (bb)</th>
                <th>Pousse</th>
                <th>Étudiée</th>
              </tr>
            </thead>
            <tbody>
              {names.map((p, i) => (
                <tr key={p} className={cls(i === he && "hero-row")}>
                  <td>
                    <b>{p}</b>
                    {i === behind && <span className="muted small"> · parle après toi</span>}
                    {i < sh && <span className="muted small"> · a couché</span>}
                  </td>
                  <td className="r">
                    <input className="inp" style={{ width: 80, textAlign: "right" }} type="number" step={0.1} min={0.5} value={stacks[i]} onChange={(e) => setStack(i, +e.target.value)} />
                  </td>
                  <td>
                    <input type="radio" disabled={i >= names.length - 1} checked={i === sh} onChange={() => (setShover(i), hero <= i && setHero(i + 1))} />
                  </td>
                  <td>
                    <input type="radio" disabled={i <= sh} checked={i === he} onChange={() => setHero(i)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row gap16 wrap" style={{ marginTop: 10 }}>
            <label className="row gap8 small">
              <span className="muted">Ante</span>
              <input className="inp" style={{ width: 70 }} type="number" step={0.05} min={0} value={ante} onChange={(e) => setAnte(+e.target.value)} />
            </label>
            {behind != null && <Toggle on={behindOn} onChange={setBehindOn} label={`${names[behind]} peut payer derrière`} />}
          </div>
        </Panel>
        <Panel
          title={
            <div className="row gap8">
              <button className={cls("fchip", edit === "shove" && "on")} onClick={() => setEdit("shove")}>
                Range de tapis {names[sh]} · {num((gridCombos(shoveGrid) / 1326) * 100, 1)} %
              </button>
              {useBehind && (
                <button className={cls("fchip", edit === "behind" && "on")} onClick={() => setEdit("behind")}>
                  Sur-call {names[behind!]} · {num((gridCombos(behindGrid) / 1326) * 100, 1)} %
                </button>
              )}
            </div>
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
                className="grow"
                value={edit === "shove" ? shovePct : behindPct}
                onChange={(e) => {
                  const p = +e.target.value;
                  if (edit === "shove") {
                    setShovePct(p);
                    setShoveGrid(topGrid(order, p));
                  } else {
                    setBehindPct(p);
                    setBehindGrid(topGrid(order, p));
                  }
                }}
              />
              <b style={{ width: 52, textAlign: "right" }}>{num(edit === "shove" ? shovePct : behindPct, 1)} %</b>
              <Help text="Classement des mains par équité préflop contre une main aléatoire. Retouche la range au pinceau si besoin." />
            </div>
          )}
          {edit === "shove" || !useBehind ? (
            <RangeEditor grid={shoveGrid} onChange={setShoveGrid} color="#d84339" />
          ) : (
            <RangeEditor grid={behindGrid} onChange={setBehindGrid} color="#e8a33d" />
          )}
          <RangeText grid={edit === "shove" || !useBehind ? shoveGrid : behindGrid} onChange={edit === "shove" || !useBehind ? setShoveGrid : setBehindGrid} />
        </Panel>
      </div>

      <div className={cls("col gap12", busy && "busy")}>
        {needTables && (
          <Panel title="Tables d'équité à 3 joueurs">
            <div className="col gap8">
              <div className="small">
                Pour tenir compte du joueur derrière, il faut les tables d'équité à 3 joueurs. Elles se préparent une seule fois (environ 2 min 30 sur ton PC, calcul que tu peux couper avec « Couper le solver »), puis tout est instantané.
              </div>
              {prep ? (
                <div className="muted small">{prep}</div>
              ) : (
                <div className="row gap8">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={async () => {
                      try {
                        await guardApi.prepareTables();
                        setPrep("Préparation…");
                      } catch (e) {
                        toast(String(e), "err");
                      }
                    }}
                  >
                    Préparer les tables
                  </button>
                  {behind != null && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setBehindOn(false)}>
                      Ignorer le joueur derrière
                    </button>
                  )}
                </div>
              )}
            </div>
          </Panel>
        )}
        {res && (
          <>
            <div className="kpis kpis-sm">
              <div className="kpi">
                <div className="kpi-l">À payer</div>
                <div className="kpi-v">{num(res.to_call, 2)} bb</div>
              </div>
              <div className="kpi">
                <div className="kpi-l">Pot si tu payes</div>
                <div className="kpi-v">{num(res.pot_if_called, 2)} bb</div>
              </div>
              <div className="kpi">
                <div className="kpi-l">
                  Équité nécessaire <Help text="Cote du pot en tête-à-tête : ce qu'il faut payer ÷ pot final si personne ne suit derrière. Avec un joueur derrière, la couleur de la grille tient compte de son sur-call (pot à trois)." />
                </div>
                <div className="kpi-v">{num(res.need * 100, 1)} %</div>
              </div>
              <div className="kpi">
                <div className="kpi-l">Range de call rentable</div>
                <div className="kpi-v">{num(res.call_pct * 100, 1)} %</div>
              </div>
            </div>
            <div className="fz-top">
              <Panel title={`${names[he]} face au tapis de ${names[sh]}`} help="Vert : payer rapporte plus que coucher (CEV). Rouge : coucher. Plus la couleur est franche, plus l'écart est grand. Clique une main pour le détail.">
                <HandGrid
                  selected={cell}
                  onCell={(c) => setCell(cell === c ? null : c)}
                  render={(c) => {
                    const r = byName.get(cellName(c));
                    if (!r) return null;
                    const d = r.ev_call - r.ev_fold;
                    const a = Math.min(1, Math.abs(d) / maxGap);
                    return <div className="hg-fill" style={{ height: "100%", background: d > 0 ? "#2f9e5a" : "#c8352e", opacity: 0.25 + 0.75 * a }} />;
                  }}
                />
              </Panel>
              <div className="col gap12">
                {sel ? (
                  <Panel title={`Main ${sel.name}`} right={<button className="icon-btn" onClick={() => setCell(null)}>×</button>}>
                    <div className="fz-hand">
                      <div>
                        <span>Équité contre {names[sh]} seul</span>
                        <b className={sel.equity >= res.need ? "pos" : "neg"}>{num(sel.equity * 100, 1)} %</b>
                      </div>
                      <div>
                        <span>Équité nécessaire</span>
                        <b>{num(sel.need * 100, 1)} %</b>
                      </div>
                      {useBehind && (
                        <>
                          <div>
                            <span>{names[behind!]} paye derrière</span>
                            <b>{num(sel.behind_calls * 100, 1)} %</b>
                          </div>
                          <div>
                            <span>Équité à trois</span>
                            <b>{sel.equity3 != null ? `${num(sel.equity3 * 100, 1)} %` : "–"}</b>
                          </div>
                        </>
                      )}
                      <div>
                        <span>CEV si tu payes</span>
                        <b>{num(sel.ev_call, 2)} bb</b>
                      </div>
                      <div>
                        <span>CEV si tu couches</span>
                        <b>{num(sel.ev_fold, 2)} bb</b>
                      </div>
                      <div>
                        <span>Gain à payer</span>
                        <b className={sel.ev_call > sel.ev_fold ? "pos" : "neg"}>
                          {sel.ev_call - sel.ev_fold > 0 ? "+" : ""}
                          {num(sel.ev_call - sel.ev_fold, 2)} bb
                        </b>
                      </div>
                    </div>
                  </Panel>
                ) : (
                  <div className="muted small">Clique une main (par exemple TT) pour son équité, l'équité nécessaire et la CEV de payer ou coucher.</div>
                )}
                <Panel title="Mains classées par gain à payer" pad={false}>
                  <div className="tbl-wrap" style={{ maxHeight: 420 }}>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Main</th>
                          <th className="r">Équité</th>
                          {useBehind && <th className="r">Sur-call</th>}
                          <th className="r">CEV payer</th>
                          <th className="r">Gain vs coucher</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...rows]
                          .sort((a, b) => b.ev_call - b.ev_fold - (a.ev_call - a.ev_fold))
                          .map((r) => (
                            <tr key={r.name}>
                              <td>
                                <b>{r.name}</b>
                              </td>
                              <td className="r">{num(r.equity * 100, 1)} %</td>
                              {useBehind && <td className="r">{num(r.behind_calls * 100, 0)} %</td>}
                              <td className="r">{num(r.ev_call, 2)}</td>
                              <td className={cls("r", r.ev_call > r.ev_fold ? "pos" : "neg")}>
                                {r.ev_call - r.ev_fold > 0 ? "+" : ""}
                                {num(r.ev_call - r.ev_fold, 2)}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </div>
            </div>
            <div className="muted small">
              Équités préflop exactes (énumération de tous les boards) en tête-à-tête ; à trois, tables par tirage à graine fixe (8 000 donnes par triplet de mains). Valeurs en jetons (bb), sans ICM, blinds et antes comprises, mise non suivie
              rendue.
            </div>
          </>
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
    />
  );
}
