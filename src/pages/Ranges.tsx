// Onglet Ranges : ranges préflop personnelles (vue et éditeur façon GTO Wizard) + trainer.
import { useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useApp } from "../lib/state";
import { Btn, Help, Modal, Seg } from "../components/ui";
import { HandGrid } from "../components/HandGrid";
import { Trainer } from "../components/Trainer";
import { cls, num } from "../lib/format";
import { gridToString, stringToGrid } from "../lib/solver";
import {
  FORMATS,
  actColors,
  actionTotals,
  actions,
  cellCombos,
  cellName,
  defaultSizes,
  emptyBook,
  findBook,
  fmtBB,
  heroReach,
  implicitIndex,
  isDefined,
  mapHistory,
  nodeKey,
  parseBook,
  rangesApi,
  replay,
  storeStrategy,
  strategy,
  type DepthBook,
  type Fmt,
  type RangeBook,
  type Spot,
  type TreeSizes,
} from "../lib/ranges";

/** Livre de ranges partagé par la vue et le trainer, enregistré avec un léger différé. */
export function useRangeBook() {
  const { toast } = useApp();
  const [book, setBook] = useState<RangeBook | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    rangesApi
      .load()
      .then((j) => setBook(parseBook(j)))
      .catch((e) => {
        toast(String(e), "err");
        setBook(emptyBook());
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (b: RangeBook, now = false) => {
    setBook(b);
    window.clearTimeout(timer.current);
    const go = () => rangesApi.save(JSON.stringify(b)).catch((e) => toast(`Ranges non enregistrées : ${e}`, "err"));
    if (now) go();
    else timer.current = window.setTimeout(go, 500);
  };
  return { book, update };
}

export function RangesPage() {
  const [tab, setTab] = useState<"ranges" | "trainer">("ranges");
  const { book, update } = useRangeBook();
  return (
    <div className="page">
      <div className="page-head">
        <h2>Ranges</h2>
        <Seg
          value={tab}
          onChange={setTab}
          options={[
            { v: "ranges", l: "Ranges préflop" },
            { v: "trainer", l: "Trainer" },
          ]}
        />
        {book && <BookMenu book={book} update={update} />}
      </div>
      {!book ? null : tab === "ranges" ? <RangeView book={book} update={update} /> : <Trainer book={book} />}
    </div>
  );
}

function BookMenu({ book, update }: { book: RangeBook; update: (b: RangeBook, now?: boolean) => void }) {
  const { toast } = useApp();
  const exp = async () => {
    const path = await saveDialog({ defaultPath: "ranges-spin-tracker-op.json", filters: [{ name: "Ranges", extensions: ["json"] }] });
    if (!path) return;
    try {
      await rangesApi.save(JSON.stringify(book));
      await rangesApi.exportTo(path);
      toast("Ranges exportées");
    } catch (e) {
      toast(String(e), "err");
    }
  };
  const imp = async () => {
    const path = await openDialog({ multiple: false, filters: [{ name: "Ranges", extensions: ["json"] }] });
    if (!path || Array.isArray(path)) return;
    try {
      const incoming = parseBook(await rangesApi.importFrom(path));
      if (!incoming.books.length) return toast("Aucune range dans ce fichier", "err");
      // fusion : les spots du fichier importé remplacent ceux de même clé
      const books = [...book.books];
      let spots = 0;
      for (const b of incoming.books) {
        const i = books.findIndex((x) => x.fmt === b.fmt && Math.abs(x.depth - b.depth) < 1e-9);
        spots += Object.keys(b.nodes).length;
        if (i < 0) books.push(b);
        else books[i] = { ...books[i], sizes: b.sizes, nodes: { ...books[i].nodes, ...b.nodes }, updated: b.updated };
      }
      update({ version: 1, books }, true);
      toast(`${spots} spots importés`);
    } catch (e) {
      toast(String(e), "err");
    }
  };
  return (
    <div className="row gap8">
      <Btn small icon="upload" onClick={imp} title="Importer un fichier de ranges (.json) : les spots importés remplacent ceux de même nom">
        Importer
      </Btn>
      <Btn small icon="download" onClick={exp} title="Exporter toutes tes ranges dans un fichier .json">
        Exporter
      </Btn>
    </div>
  );
}

// ---------------------------------------------------------------- vue / éditeur


const DEPTHS = [25, 22, 19, 16, 13, 10, 7, 5];

function RangeView({ book, update }: { book: RangeBook; update: (b: RangeBook, now?: boolean) => void }) {
  const { prefs, setPrefs, toast } = useApp();
  const fmt: Fmt = prefs.rangesFmt ?? "spin3";
  const depth: number = prefs.rangesDepth ?? 25;
  const [history, setHistory] = useState<string[]>([]);
  const [cell, setCell] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [edit, setEdit] = useState(false);
  const [brush, setBrush] = useState(0);
  const [weight, setWeight] = useState(1);
  const [sizesOpen, setSizesOpen] = useState(false);
  const [paste, setPaste] = useState<number | null>(null);
  const db = findBook(book, fmt, depth);
  const sizes: TreeSizes = db?.sizes ?? defaultSizes(fmt);
  const pos = FORMATS[fmt].pos;

  // changement de format : les positions changent, on repart du début du coup
  useEffect(() => {
    setHistory([]);
    setCell(null);
  }, [fmt]);
  // tailles modifiées : on garde la partie du coup qui existe encore
  useEffect(() => setHistory((h) => mapHistory(fmt, depth, sizes, h)), [JSON.stringify(sizes)]); // eslint-disable-line react-hooks/exhaustive-deps

  const r = replay(fmt, depth, sizes, history) ?? replay(fmt, depth, sizes, [])!;
  const cur = r.states[r.states.length - 1];
  const acts = cur.terminal ? [] : actions(cur, sizes);
  const spot: Spot | null = cur.terminal ? null : { key: nodeKey(cur), state: cur, acts, hero: pos[cur.toAct] };
  const strat = spot ? strategy(db, spot) : null;
  const defined = spot ? isDefined(db, spot.key) : false;
  const reach = useMemo(() => (spot ? heroReach(db, fmt, depth, sizes, history) : Array(169).fill(1)), [db, fmt, depth, sizes, history, spot]);
  const colors = actColors(acts);
  const view = strat ?? Array.from({ length: 169 }, () => acts.map((_, i) => (i === implicitIndex(acts) ? 1 : 0)));
  const computed = spot ? actionTotals(view, reach) : null;
  // fréquences du solveur données par le fichier importé : prioritaires sur le calcul à partir
  // de l'action dominante de chaque main, qui les déformerait
  const fileFreq = spot ? db?.freq?.[spot.key] : undefined;
  const totals = computed && fileFreq ? { ...computed, freq: acts.map((a) => fileFreq[a.id] ?? 0) } : computed;
  const shown = hover ?? cell;
  useEffect(() => setBrush(Math.min(brush, Math.max(0, acts.length - 1))), [acts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const depthsOf = (f: Fmt) => [...new Set([...DEPTHS, ...book.books.filter((b) => b.fmt === f).map((b) => b.depth)])].sort((a, b) => b - a);
  const hasRanges = (f: Fmt, d: number) => {
    const b = findBook(book, f, d);
    return !!b && Object.keys(b.nodes).length > 0;
  };

  const ensureBook = (): DepthBook => db ?? { fmt, depth, sizes: defaultSizes(fmt), nodes: {}, updated: 0 };
  const putBook = (nb: DepthBook, now = false) => {
    const i = book.books.findIndex((b) => b.fmt === fmt && Math.abs(b.depth - depth) < 1e-9);
    const books = i < 0 ? [...book.books, nb] : book.books.map((b, k) => (k === i ? nb : b));
    update({ version: 1, books }, now);
  };
  const setStrat = (s: number[][]) => {
    if (!spot) return;
    const nb = storeStrategy(ensureBook(), spot, s);
    // spot modifié à la main : les fréquences du fichier importé ne s'appliquent plus
    if (nb.freq?.[spot.key]) nb.freq = Object.fromEntries(Object.entries(nb.freq).filter(([k]) => k !== spot.key));
    putBook(nb);
  };

  // pinceau : l'action choisie reçoit `weight`, les autres se partagent le reste
  const paintCell = (c: number, base: number[][]) => {
    const row = [...base[c]];
    const others = row.reduce((a, x, i) => (i === brush ? a : a + x), 0);
    const rest = 1 - weight;
    for (let i = 0; i < row.length; i++) {
      if (i === brush) row[i] = weight;
      else if (others > 1e-9) row[i] = (row[i] / others) * rest;
      else row[i] = i === implicitIndex(acts) && brush !== i ? rest : 0;
    }
    const next = base.map((x, k) => (k === c ? row : x));
    return next;
  };
  const draft = useRef<number[][] | null>(null);
  const onPaint = (c: number, first: boolean) => {
    if (!edit || !spot) return;
    if (first || !draft.current) draft.current = view;
    draft.current = paintCell(c, draft.current);
    setStrat(draft.current);
  };

  const applyText = (i: number, text: string) => {
    const g = stringToGrid(text);
    if (!g) return toast("Range illisible : format attendu AA,AKs:0.5,22+,A2s+,KTo-K8o", "err");
    const next = view.map((row, c) => {
      const out = [...row];
      const w = g[c];
      const others = out.reduce((a, x, k) => (k === i ? a : a + x), 0);
      out[i] = w;
      for (let k = 0; k < out.length; k++) if (k !== i) out[k] = others > 1e-9 ? (out[k] / others) * (1 - w) : k === implicitIndex(acts) ? 1 - w : 0;
      return out;
    });
    setStrat(next);
    setPaste(null);
  };

  // changement de profondeur : on reste sur le même coup (ex. BTN Raise 2 · SB Call · BB ?)
  const onDepth = (d: number) => {
    const nsizes = findBook(book, fmt, d)?.sizes ?? defaultSizes(fmt);
    const kept = mapHistory(fmt, d, nsizes, history);
    if (kept.length < history.length) toast(`Ce coup n'existe pas à ${fmtBB(d)} bb : retour à la dernière décision possible`);
    setHistory(kept);
    setPrefs({ rangesDepth: d });
  };
  const depthList = depthsOf(fmt);
  const di = depthList.indexOf(depth);

  return (
    <div className="gw">
      <div className="gw-top">
        <div className="gw-tile gw-spot">
          <div className="gw-t">
            {FORMATS[fmt].short} <span>{pos.map(() => fmtBB(depth)).join("-")}bb</span>
          </div>
          <div className="gw-seg">
            {(Object.keys(FORMATS) as Fmt[]).map((f) => (
              <button key={f} className={cls(fmt === f && "on")} onClick={() => setPrefs({ rangesFmt: f })}>
                {FORMATS[f].short}
              </button>
            ))}
          </div>
          <div className="gw-depth">
            <button className="gw-btn" disabled={di <= 0} onClick={() => onDepth(depthList[di - 1])} title="Plus profond (même coup)">
              ‹
            </button>
            <select className="gw-sel" value={depth} onChange={(e) => onDepth(+e.target.value)} title="Profondeur (tapis symétriques) : le coup affiché est conservé">
              {depthList.map((d) => (
                <option key={d} value={d}>
                  {fmtBB(d)} bb {hasRanges(fmt, d) ? "●" : ""}
                </option>
              ))}
            </select>
            <button className="gw-btn" disabled={di < 0 || di >= depthList.length - 1} onClick={() => onDepth(depthList[di + 1])} title="Moins profond (même coup)">
              ›
            </button>
          </div>
          <button className="gw-btn" onClick={() => setSizesOpen(true)}>
            ⚙ Tailles
          </button>
        </div>
        {history.map((id, k) => {
          const s = r.states[k];
          return (
            <button key={k} className="gw-tile" onClick={() => (setHistory(history.slice(0, k)), setCell(null))} title="Revenir à cette décision">
              <div className="gw-t">
                {pos[s.toAct]} <span>{fmtBB(depth - s.put[s.toAct])}</span>
              </div>
              {r.acts[k].map((a) => (
                <div key={a.id} className={cls("gw-act", a.id === id && "on")}>
                  {a.label}
                </div>
              ))}
            </button>
          );
        })}
        {spot ? (
          <div className="gw-tile cur">
            <div className="gw-t">
              {spot.hero} <span>{fmtBB(depth - cur.put[cur.toAct])}</span>
            </div>
            {acts.map((a, i) => (
              <button key={a.id} className="gw-act clk" onClick={() => (setHistory([...history, a.id]), setCell(null))}>
                <i style={{ background: colors[i] }} />
                {a.label}
                <b>{totals ? `${num(totals.freq[i] * 100, 0)}%` : ""}</b>
              </button>
            ))}
          </div>
        ) : (
          <div className="gw-tile cur">
            <div className="gw-t">{cur.terminal === "fold" ? "Fin du coup" : cur.terminal === "allin" ? "Tapis" : "Flop"}</div>
            <div className="gw-sub">pot {fmtBB(cur.put.reduce((a, b) => a + b, 0))} bb</div>
          </div>
        )}
        {spot &&
          pos
            .map((_, i) => (cur.toAct + i) % pos.length)
            .slice(1)
            .filter((i) => !cur.folded[i] && !cur.allin[i] && (cur.put[i] < Math.max(...cur.put) || !cur.acted[i]))
            .map((i) => (
              <div key={i} className="gw-tile gw-static">
                <div className="gw-t">
                  {pos[i]} <span>{fmtBB(depth - cur.put[i])}</span>
                </div>
                <div className="gw-sub">à parler</div>
              </div>
            ))}
      </div>

      {spot && (
        <div className="gw-body">
          <div className="gw-panel gw-left">
            <div className="gw-tabs">
              <button className={cls(!edit && "on")} onClick={() => setEdit(false)}>
                Stratégie
              </button>
              <button className={cls(edit && "on")} onClick={() => setEdit(true)}>
                ✎ Modifier
              </button>
              <div className="grow" />
              <span className="gw-sub">{defined ? `${num(totals?.total ?? 0, 0)} combos atteignent ce spot` : "spot non renseigné"}</span>
            </div>
            {edit && (
              <div className="gw-brush">
                {acts.map((a, i) => (
                  <button key={a.id} className={cls("gw-chip", brush === i && "on")} onClick={() => setBrush(i)} style={brush === i ? { background: colors[i], color: "#fff" } : undefined}>
                    <i className="gw-dot" style={{ background: colors[i] }} />
                    {a.label}
                  </button>
                ))}
                <span className="gw-sep" />
                {[1, 0.75, 0.5, 0.25].map((w) => (
                  <button key={w} className={cls("gw-chip", weight === w && "on")} onClick={() => setWeight(w)}>
                    {w * 100} %
                  </button>
                ))}
                <span className="gw-sep" />
                <button className="gw-chip" onClick={() => setPaste(brush)} title="Coller une range texte pour l'action choisie">
                  Coller
                </button>
                <button
                  className="gw-chip"
                  onClick={() => {
                    const g = view.map((row) => row[brush]);
                    navigator.clipboard.writeText(gridToString(g)).then(() => toast(`Range « ${acts[brush].label} » copiée`));
                  }}
                >
                  Copier
                </button>
                <button className="gw-chip" onClick={() => setStrat(view.map((_, c) => paintCell(c, view)[c]))} title="Applique le pinceau à toutes les mains">
                  Tout
                </button>
                <button className="gw-chip" onClick={() => putBook({ ...ensureBook(), nodes: Object.fromEntries(Object.entries(ensureBook().nodes).filter(([k]) => k !== spot.key)) }, true)}>
                  Effacer le spot
                </button>
                <Help text="Choisis une action et un poids puis peins la grille (clic ou glisser). L'action choisie reçoit le poids, les autres se partagent le reste. « Coller » accepte le format texte standard : AA,AKs:0.5,22+,A2s+,KTo-K8o. Tout est enregistré automatiquement." />
              </div>
            )}
            <div className="gw-gridwrap">
              <HandGrid
                selected={cell}
                onCell={edit ? undefined : (c) => setCell(cell === c ? null : c)}
                onHover={setHover}
                onPaint={edit ? onPaint : undefined}
                dim={(c) => reach[c] <= 0.001}
                render={(c) => {
                  if (!defined && !edit) return null;
                  const w = reach[c];
                  if (w <= 0.001 && !edit) return null;
                  return (
                    <div className="hg-strat" style={{ height: `${Math.max(edit ? 100 : 6, w * 100)}%` }}>
                      {view[c].map((f, i) => (f > 0.002 ? <i key={i} style={{ width: `${f * 100}%`, background: colors[i] }} /> : null))}
                    </div>
                  );
                }}
              />
            </div>
            {!defined && !edit && (
              <div className="gw-note">
                Ce spot n'a pas encore de range. Clique sur <b>✎ Modifier</b> pour la peindre ou la coller, ou importe un fichier de ranges.
              </div>
            )}
            {shown != null && (
              <div className="gw-cellinfo">
                <b>{cellName(shown)}</b> · {cellCombos(shown)} combos · atteinte {num(reach[shown] * 100, 0)} %
                <div className="gw-sbar wide">
                  {view[shown].map((f, i) => (f > 0.002 ? <i key={i} style={{ width: `${f * 100}%`, background: colors[i] }} /> : null))}
                </div>
                <div className="row gap12 wrap">
                  {acts.map((a, i) => (
                    <span key={a.id}>
                      <i className="gw-dot" style={{ background: colors[i] }} />
                      {a.label} {num(view[shown][i] * 100, 0)} %
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="gw-right">
            <div className="gw-boxes">
              {acts.map((a, i) => (
                <div key={a.id} className="gw-box" style={{ background: colors[i], flexGrow: 1 }}>
                  <div className="gw-box-l">{a.label}</div>
                  <div className="gw-box-v">
                    <b>{defined && totals ? `${num(totals.freq[i] * 100, 1)}%` : "–"}</b>
                    {fileFreq ? (
                      <span>
                        <small>solveur</small>
                      </span>
                    ) : (
                      <span>
                        {defined && totals ? num(totals.combos[i], 1) : ""}
                        <small>combos</small>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {defined && totals && (
              <div className="gw-sbar wide big">
                {acts.map((a, i) => (totals.freq[i] > 0.001 ? <i key={a.id} style={{ width: `${totals.freq[i] * 100}%`, background: colors[i] }} /> : null))}
              </div>
            )}
            <div className="gw-panel">
              <div className="gw-h">
                Mains · {spot.hero}
                <span className="gw-mut">{cell != null ? `filtre ${cellName(cell)}` : "clique une case pour filtrer"}</span>
              </div>
              <div className="gw-scroll">
                <table className="gw-tbl">
                  <thead>
                    <tr>
                      <th>Main</th>
                      <th>Stratégie</th>
                      <th className="r">Range</th>
                      {acts.map((a, i) => (
                        <th key={a.id} className="r">
                          <i className="gw-dot" style={{ background: colors[i] }} />
                          {a.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 169 }, (_, c) => c)
                      .filter((c) => reach[c] > 0.001 && (cell == null || c === cell))
                      .sort((a, b) => view[a][implicitIndex(acts)] - view[b][implicitIndex(acts)] || a - b)
                      .map((c) => (
                        <tr key={c} className={cls("clk", cell === c && "sel")} onClick={() => setCell(cell === c ? null : c)}>
                          <td>
                            <b>{cellName(c)}</b> <span className="gw-mut">{cellCombos(c)}</span>
                          </td>
                          <td>
                            <div className="gw-sbar">
                              {view[c].map((f, i) => (f > 0.002 ? <i key={i} style={{ width: `${f * 100}%`, background: colors[i] }} /> : null))}
                            </div>
                          </td>
                          <td className="r">{num(reach[c], 2)}</td>
                          {view[c].map((f, i) => (
                            <td key={i} className="r">
                              {f > 0.0005 ? `${num(f * 100, 0)}%` : <span className="gw-mut">–</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="gw-src">
        {db?.source ? `Ranges importées : ${db.source} (grille : action dominante de chaque main ; pourcentages : fréquences du solveur)` : "Ranges personnelles"} · {FORMATS[fmt].label} · tapis {fmtBB(depth)} bb symétriques ·{" "}
        {sizes.explicit
          ? `arbre du fichier (${Object.keys(sizes.explicit).length} spots, tailles propres à chaque spot)`
          : `open ${Object.entries(sizes.open).map(([p, v]) => `${p} ${fmtBB(v)}`).join(", ")} · 3-bet ${fmtBB(sizes.threeBet)}× · au-delà de ${sizes.maxRaises} relances ou ${num(sizes.maxRaiseFrac * 100, 0)} % du tapis : tapis seulement`}
      </div>
      {paste != null && spot && <PasteModal action={acts[paste].label} initial={gridToString(view.map((row) => row[paste]))} onClose={() => setPaste(null)} onApply={(t) => applyText(paste, t)} />}
      {sizesOpen && (
        <SizesModal
          fmt={fmt}
          sizes={sizes}
          onClose={() => setSizesOpen(false)}
          onSave={(s) => {
            const b = ensureBook();
            if (Object.keys(b.nodes).length && !confirm("Changer les tailles modifie l'arbre : les spots dont les actions changent de nom ne seront plus reliés à leurs ranges. Continuer ?")) return;
            putBook({ ...b, sizes: s }, true);
            setSizesOpen(false);
          }}
        />
      )}
    </div>
  );
}

function PasteModal({ action, initial, onClose, onApply }: { action: string; initial: string; onClose: () => void; onApply: (t: string) => void }) {
  const [t, setT] = useState(initial);
  return (
    <Modal title={`Range « ${action} »`} onClose={onClose}>
      <div className="col gap12">
        <div className="muted small">
          Mains séparées par des virgules, poids optionnel après « : » (0 à 1). Exemples : <code>AA,KK,AKs</code>, <code>22+</code>, <code>A2s+</code>, <code>KTo-K8o</code>, <code>A5s:0.5</code>.
        </div>
        <textarea className="inp" rows={8} value={t} onChange={(e) => setT(e.target.value)} style={{ fontFamily: "var(--font-m, monospace)", width: "100%" }} />
        <div className="row gap8">
          <div className="grow" />
          <Btn onClick={onClose}>Annuler</Btn>
          <Btn kind="primary" onClick={() => onApply(t)}>
            Appliquer
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function SizesModal({ fmt, sizes, onClose, onSave }: { fmt: Fmt; sizes: TreeSizes; onClose: () => void; onSave: (s: TreeSizes) => void }) {
  const [s, setS] = useState<TreeSizes>(sizes);
  const openers = FORMATS[fmt].pos.filter((p) => p !== "BB");
  const n = (v: number, f: (x: number) => void, step = 0.5) => <input className="inp" type="number" step={step} min={0} value={v} onChange={(e) => f(+e.target.value)} style={{ width: 80 }} />;
  return (
    <Modal title="Tailles de l'arbre" onClose={onClose}>
      <div className="col gap12">
        {s.explicit && (
          <div className="tr-last">
            Arbre importé : les actions et tailles de ses {Object.keys(s.explicit).length} spots viennent du fichier. Les réglages ci-dessous ne s'appliquent qu'aux spots absents du fichier.
          </div>
        )}
        {openers.map((p) => (
          <div key={p} className="row gap12">
            <b style={{ width: 40 }}>{p}</b>
            <span className="muted small">open à</span>
            {n(s.open[p] ?? 2, (v) => setS({ ...s, open: { ...s.open, [p]: v } }))}
            <span className="muted small">bb</span>
            <label className="row gap8 small">
              <input type="checkbox" checked={!!s.limp[p]} onChange={(e) => setS({ ...s, limp: { ...s.limp, [p]: e.target.checked } })} />
              limp autorisé
            </label>
          </div>
        ))}
        <div className="row gap12">
          <span className="muted small" style={{ width: 170 }}>
            Relance contre un limp
          </span>
          {n(s.iso, (v) => setS({ ...s, iso: v }))}
          <span className="muted small">bb (+1 par limper en plus)</span>
        </div>
        <div className="row gap12">
          <span className="muted small" style={{ width: 170 }}>
            3-bet
          </span>
          {n(s.threeBet, (v) => setS({ ...s, threeBet: v }))}
          <span className="muted small">× la relance (+1× par joueur qui a payé)</span>
        </div>
        <div className="row gap12">
          <span className="muted small" style={{ width: 170 }}>
            Relances hors tapis
          </span>
          {n(s.maxRaises, (v) => setS({ ...s, maxRaises: Math.max(0, Math.round(v)) }), 1)}
          <span className="muted small">puis tapis seulement</span>
        </div>
        <div className="row gap12">
          <span className="muted small" style={{ width: 170 }}>
            Relance max
          </span>
          {n(Math.round(s.maxRaiseFrac * 100), (v) => setS({ ...s, maxRaiseFrac: v / 100 }), 5)}
          <span className="muted small">% du tapis (au-delà : tapis)</span>
        </div>
        <div className="row gap8">
          <Btn small onClick={() => setS({ ...defaultSizes(fmt), explicit: s.explicit })}>
            Par défaut
          </Btn>
          <div className="grow" />
          <Btn onClick={onClose}>Annuler</Btn>
          <Btn kind="primary" onClick={() => onSave(s)}>
            Enregistrer
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
