// Mes ranges contre mon jeu : pour chaque spot de mes ranges, la grille de la range (fichier)
// à côté de la grille de ce que j'ai réellement joué (mains de la base replacées dans l'arbre,
// à la profondeur la plus proche du tapis effectif).
import { useMemo, useState } from "react";
import { useApp } from "../lib/state";
import { analyze, linesApi, type Analysis } from "../lib/review";
import { FORMATS, actColors, actionTotals, actions, cellName, findBook, fmtBB, heroReach, replay, spotLabel, strategy, type Fmt, type RangeBook, type Spot } from "../lib/ranges";
import { cls, num } from "../lib/format";
import { Btn, Empty, Help } from "./ui";
import { HandGrid } from "./HandGrid";
import { PaneLeft, PaneRight } from "./Spatial";

// analyse gardée d'un affichage à l'autre (elle porte sur toute la base)
let cache: { a: Analysis; at: number } | null = null;

interface SpotAgg {
  id: string;
  fmt: Fmt;
  depth: number;
  key: string;
  hero: string;
  n: number;
  ok: number;
  /** par case : nombre de fois chaque action (id) */
  cells: Map<number, Map<string, number>>;
}

export function RangeVsPlay({ book }: { book: RangeBook | null }) {
  const { toast } = useApp();
  const [a, setA] = useState<Analysis | null>(cache?.a ?? null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [fmt, setFmt] = useState<Fmt>("spin3");
  const [hover, setHover] = useState<number | null>(null);
  const run = async () => {
    if (!book) return;
    setBusy(true);
    try {
      const res = analyze(await linesApi.get(), book, 0.1);
      cache = { a: res, at: Date.now() };
      setA(res);
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setBusy(false);
    }
  };
  const spots = useMemo(() => {
    const m = new Map<string, SpotAgg>();
    for (const d of a?.decisions ?? []) {
      const id = `${d.fmt}|${d.depth}|${d.key}`;
      let s = m.get(id);
      if (!s) m.set(id, (s = { id, fmt: d.fmt, depth: d.depth, key: d.key, hero: d.hero, n: 0, ok: 0, cells: new Map() }));
      s.n++;
      if (d.ok) s.ok++;
      const c = s.cells.get(d.cell) ?? new Map<string, number>();
      c.set(d.choice, (c.get(d.choice) ?? 0) + 1);
      s.cells.set(d.cell, c);
    }
    return [...m.values()].sort((x, y) => y.n - x.n);
  }, [a]);
  const list = spots.filter((s) => s.fmt === fmt);
  // libellé lisible de chaque spot (ex. « BTN Raise 2 · SB ? »)
  const labels = useMemo(() => {
    const out = new Map<string, string>();
    if (!book) return out;
    for (const s of spots) {
      const db = findBook(book, s.fmt, s.depth);
      const h = s.key ? s.key.split("-") : [];
      const r = db && replay(s.fmt, s.depth, db.sizes, h);
      if (!db || !r) continue;
      const st = r.states[r.states.length - 1];
      out.set(s.id, spotLabel({ key: s.key, state: st, acts: actions(st, db.sizes), hero: s.hero }, db.sizes));
    }
    return out;
  }, [spots, book]);
  const cur = spots.find((s) => s.id === sel) ?? list[0] ?? null;

  // spot de l'arbre : actions, stratégie, atteinte
  const view = useMemo(() => {
    if (!cur || !book) return null;
    const db = findBook(book, cur.fmt, cur.depth);
    if (!db) return null;
    const history = cur.key ? cur.key.split("-") : [];
    const r = replay(cur.fmt, cur.depth, db.sizes, history);
    if (!r) return null;
    const st = r.states[r.states.length - 1];
    const acts = actions(st, db.sizes);
    const sp: Spot = { key: cur.key, state: st, acts, hero: FORMATS[cur.fmt].pos[st.toAct] };
    const strat = strategy(db, sp);
    const reach = heroReach(db, cur.fmt, cur.depth, db.sizes, history);
    return { acts, strat, reach, colors: actColors(acts), label: spotLabel(sp, db.sizes) };
  }, [cur, book]);

  const played = (c: number) => {
    const m = cur?.cells.get(c);
    if (!m || !view) return null;
    const t = [...m.values()].reduce((x, y) => x + y, 0);
    return { t, f: view.acts.map((ac) => (m.get(ac.id) ?? 0) / t) };
  };
  const rangeFreq = view?.strat ? actionTotals(view.strat, view.reach).freq : null;
  const playFreq = view && cur ? view.acts.map((ac) => [...cur.cells.values()].reduce((x, m) => x + (m.get(ac.id) ?? 0), 0) / Math.max(1, cur.n)) : null;
  const maxT = cur ? Math.max(1, ...[...cur.cells.values()].map((m) => [...m.values()].reduce((x, y) => x + y, 0))) : 1;

  if (!book) return <Empty title="Aucune range" sub="Crée ou importe tes ranges dans l'onglet Ranges." icon="target" />;
  if (!a)
    return (
      <div className="rvp-start">
        <b>Compare tes ranges à ce que tu joues vraiment</b>
        <span className="muted">
          Chaque décision préflop de ta base est replacée dans l'arbre de tes ranges (profondeur la plus proche de ton tapis effectif). Pour chaque spot, tu vois ta range à côté de tes mains réelles.
        </span>
        <Btn kind="primary" icon="search" onClick={run} disabled={busy}>
          {busy ? "Analyse de toute la base…" : "Analyser mes mains"}
        </Btn>
      </div>
    );
  return (
    <div className="rvp">
      <PaneLeft>
        {cur && view && (
          <div className="side-card">
            <div className="pane-title">Ce spot</div>
            <b>{view.label}</b>
            <div className="side-kv">
              <span>Décisions</span>
              <b>{num(cur.n)}</b>
              <span>Conformes à la range</span>
              <b className={cur.ok / cur.n >= 0.85 ? "pos" : "neg"}>{num((cur.ok / cur.n) * 100, 0)} %</b>
            </div>
            <table className="lk-tbl">
              <thead>
                <tr>
                  <th>Action</th>
                  <th className="r">Range</th>
                  <th className="r">Joué</th>
                </tr>
              </thead>
              <tbody>
                {view.acts.map((ac, i) => (
                  <tr key={ac.id}>
                    <td>
                      <i className="gw-dot" style={{ background: view.colors[i] }} />
                      {ac.label}
                    </td>
                    <td className="r">{rangeFreq ? `${num(rangeFreq[i] * 100, 0)} %` : "–"}</td>
                    <td className="r">
                      <b>{playFreq ? `${num(playFreq[i] * 100, 0)} %` : "–"}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <span className="muted small">« Range » : fréquences de ta range sur les mains qui atteignent ce spot ; « Joué » : sur tes mains réelles.</span>
          </div>
        )}
        {hover != null && cur && view && (
          <div className="side-card">
            <b>{cellName(hover)}</b>
            <span className="small">
              Range :{" "}
              {view.strat
                ? view.acts
                    .map((ac, i) => (view.strat![hover][i] > 0.004 ? `${ac.label} ${num(view.strat![hover][i] * 100, 0)} %` : ""))
                    .filter(Boolean)
                    .join(" · ")
                : "–"}
            </span>
            <span className="small">
              Joué :{" "}
              {played(hover)
                ? view.acts
                    .map((ac, i) => (played(hover)!.f[i] > 0 ? `${ac.label} ${num(played(hover)!.f[i] * 100, 0)} %` : ""))
                    .filter(Boolean)
                    .join(" · ") + ` (${played(hover)!.t} fois)`
                : "jamais"}
            </span>
          </div>
        )}
      </PaneLeft>
      <PaneRight>
        <div className="pane-title">Spots joués</div>
        <div className="seg seg-sm">
          {(Object.keys(FORMATS) as Fmt[]).map((f) => (
            <button key={f} className={cls(fmt === f && "on")} onClick={() => (setFmt(f), setSel(null))}>
              {FORMATS[f].short}
            </button>
          ))}
        </div>
        <div className="rvp-list side">
          {list.map((s) => (
            <button key={s.id} className={cls("rvp-spot", cur?.id === s.id && "on")} onClick={() => setSel(s.id)}>
              <span>
                {fmtBB(s.depth)} bb · {labels.get(s.id) ?? `${s.hero} ${s.key}`}
              </span>
              <small className={s.ok / s.n >= 0.85 ? "pos" : "neg"}>
                {num((s.ok / s.n) * 100, 0)} % · {num(s.n)}
              </small>
            </button>
          ))}
        </div>
        <Btn small icon="refresh" onClick={run} disabled={busy}>
          {busy ? "Analyse…" : "Relancer l'analyse"}
        </Btn>
      </PaneRight>
      {!cur || !view ? (
        <Empty title="Aucun spot" sub="Aucune de tes mains ne tombe dans les spots de tes ranges pour ce format." icon="target" />
      ) : (
        <div className="rvp-grids gw">
          <div className="rvp-col">
            <div className="rvp-h">
              <b>Ta range</b>
              <Help text="La stratégie de ton fichier de ranges pour ce spot. Hauteur de la case = part de la main qui atteint le spot." />
            </div>
            <div className="gw-gridwrap">
              <HandGrid
                onHover={setHover}
                dim={(c) => view.reach[c] <= 0.001}
                render={(c) =>
                  view.strat && view.reach[c] > 0.001 ? (
                    <div className="hg-strat" style={{ height: `${Math.max(6, view.reach[c] * 100)}%` }}>
                      {view.strat[c].map((f, i) => (f > 0.002 ? <i key={i} style={{ width: `${f * 100}%`, background: view.colors[i] }} /> : null))}
                    </div>
                  ) : null
                }
              />
            </div>
          </div>
          <div className="rvp-col">
            <div className="rvp-h">
              <b>Ton jeu</b>
              <Help text="Tes mains réelles dans ce spot : couleur = actions jouées, hauteur = nombre de fois (relatif à la main la plus jouée). Case entourée = au moins une décision hors de ta range." />
            </div>
            <div className="gw-gridwrap">
              <HandGrid
                onHover={setHover}
                highlight={new Set([...cur.cells.keys()].filter((c) => view.strat && view.acts.some((ac, i) => (cur.cells.get(c)!.get(ac.id) ?? 0) > 0 && view.strat![c][i] < 0.1 && view.strat![c][i] < Math.max(...view.strat![c]) - 1e-9)))}
                dim={(c) => !cur.cells.has(c)}
                render={(c) => {
                  const p = played(c);
                  if (!p) return null;
                  return (
                    <div className="hg-strat" style={{ height: `${Math.max(12, Math.sqrt(p.t / maxT) * 100)}%` }}>
                      {p.f.map((f, i) => (f > 0 ? <i key={i} style={{ width: `${f * 100}%`, background: view.colors[i] }} /> : null))}
                    </div>
                  );
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
