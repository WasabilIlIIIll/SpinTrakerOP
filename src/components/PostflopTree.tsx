// Arbre de décision postflop d'un duel, dessiné comme un vrai arbre : une case par coup joué
// (check, c-bet, donk, barrel, probe, call, relance, check-raise, fold), reliée à la décision
// qui la précède. Chaque case montre ma fréquence, celle de la référence, les tailles de mise
// et le nombre de mains ; un clic déplie la suite. À droite : le détail de la case choisie et
// les plus gros écarts à la référence.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Filter, type PNode, type PTree } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { cls, num } from "../lib/format";
import { Empty, Help, Loading, Seg } from "./ui";
import { PaneLeft, PaneRight } from "./Spatial";

const STREETS = ["", "Flop", "Turn", "River"];
const BUCKETS = ["20+", "18-20", "16-18", "14-16", "12-14", "10-12", "8-10", "6-8", "4-6", "0-4"];
const POS3 = ["BTN", "SB", "BB"];
const POS2 = ["SB", "BB"];
const BOX_W = 214;
const BOX_H = 92;
const GAP_X = 58;
const GAP_Y = 12;

export const ACT_COLOR: Record<string, string> = {
  Check: "#8a8f98",
  Bet: "#f5a524",
  Call: "#22c55e",
  Raise: "#a855f7",
  Fold: "#3b82f6",
};
const SIZE_COLOR: Record<string, string> = { "⅓": "#fcd34d", "½": "#f5a524", "¾": "#f97316", Pot: "#ef4444", Overbet: "#b91c1c", Relance: "#a855f7", Tapis: "#7f1d1d" };

const tot = (n: PNode, ref: boolean) => n.kids.reduce((a, k) => a + (ref ? k.node.r : k.node.n), 0);

/** Écart jugé comme dans le leak finder préflop : 4 % + 40/√n, rouge au-delà de 2,2 fois. */
function dev(mine: number, ref: number, n: number, rn: number): "ok" | "warn" | "bad" | "low" | "nr" {
  if (rn < 10) return "nr";
  if (n < 8) return "low";
  const d = Math.abs(mine - ref);
  const tol = 4 + 40 / Math.sqrt(n);
  return d <= tol ? "ok" : d <= tol * 2.2 ? "warn" : "bad";
}

/** Une case de l'arbre : le coup `label` joué par `actor` à la décision `from`. */
interface VBox {
  id: string;
  path: string[];
  label: string;
  name: string;
  actor: string;
  street: number;
  subject: boolean;
  sizes: [string, number, number][];
  node: PNode;
  mine: number;
  ref: number;
  n: number;
  rn: number;
  kids: VBox[];
  depth: number;
  x: number;
  y: number;
}

interface Hist {
  street: number;
  actor: string;
  label: string;
}

/** Nom du coup dans son contexte (c-bet, donk, barrel, probe, check-raise…). */
function nameOf(label: string, actor: string, street: number, hist: Hist[], aggr: string): string {
  const same = hist.filter((h) => h.street === street);
  const betSeen = same.some((h) => h.label === "Bet" || h.label === "Raise");
  if (label === "Bet") {
    if (street === 1) {
      if (actor === aggr && !betSeen) return "C-bet";
      if (aggr && actor !== aggr && same.length === 0) return "Donk";
      return "Mise";
    }
    const prev = hist.filter((h) => h.street === street - 1);
    const prevBetBy = prev.find((h) => h.label === "Bet")?.actor;
    if (!betSeen && actor === aggr && prevBetBy === aggr) return "Barrel";
    if (!betSeen && aggr && actor !== aggr && prev.length > 0 && prev.every((h) => h.label === "Check")) return "Probe";
    return "Mise";
  }
  if (label === "Raise") return same.some((h) => h.actor === actor && h.label === "Check") ? "Check-raise" : "Relance";
  return label;
}

function build(root: PNode, aggr: string, open: Set<string>): { boxes: VBox[]; w: number; h: number } {
  const all: VBox[] = [];
  const make = (from: PNode, path: string[], hist: Hist[], depth: number): VBox[] => {
    const n = tot(from, false);
    const r = tot(from, true);
    return from.kids.map((k) => {
      const p = [...path, k.label];
      const id = p.join(">");
      const b: VBox = {
        id,
        path: p,
        label: k.label,
        name: nameOf(k.label, from.actor, from.street, hist, aggr),
        actor: from.actor,
        street: from.street,
        subject: from.subject,
        sizes: k.sizes,
        node: k.node,
        mine: n ? (k.node.n / n) * 100 : 0,
        ref: r ? (k.node.r / r) * 100 : 0,
        n: k.node.n,
        rn: k.node.r,
        kids: [],
        depth,
        x: 0,
        y: 0,
      };
      all.push(b);
      if (open.has(id) && k.node.actor) b.kids = make(k.node, p, [...hist, { street: from.street, actor: from.actor, label: k.label }], depth + 1);
      return b;
    });
  };
  const top = make(root, [], [], 1);
  // placement : chaque sous-arbre occupe la hauteur de ses feuilles, le parent au milieu
  let cursor = 0;
  let maxDepth = 0;
  const place = (b: VBox): void => {
    b.x = b.depth * (BOX_W + GAP_X);
    maxDepth = Math.max(maxDepth, b.depth);
    if (!b.kids.length) {
      b.y = cursor;
      cursor += BOX_H + GAP_Y;
      return;
    }
    b.kids.forEach(place);
    b.y = (b.kids[0].y + b.kids[b.kids.length - 1].y) / 2;
  };
  top.forEach(place);
  return { boxes: all, w: (maxDepth + 1) * (BOX_W + GAP_X), h: Math.max(cursor, BOX_H) };
}

/** Cases dépliées par défaut : les branches fréquentes, sur trois niveaux. */
function defaultOpen(root: PNode, levels = 3): Set<string> {
  const out = new Set<string>();
  const all = root.n + root.r;
  const go = (node: PNode, path: string[], d: number) => {
    if (d > levels) return;
    for (const k of node.kids) {
      const p = [...path, k.label];
      if (k.node.actor && k.node.n + k.node.r >= Math.max(15, all * 0.12)) {
        out.add(p.join(">"));
        go(k.node, p, d + 1);
      }
    }
  };
  go(root, [], 1);
  return out;
}

interface Leak {
  id: string;
  path: string[];
  where: string;
  label: string;
  mine: number;
  ref: number;
  n: number;
  level: "warn" | "bad";
}

function findLeaks(t: PTree): Leak[] {
  const out: Leak[] = [];
  const go = (node: PNode, path: string[], hist: Hist[], where: string[]) => {
    if (node.subject && node.kids.length) {
      const n = tot(node, false);
      const r = tot(node, true);
      for (const k of node.kids) {
        const mine = n ? (k.node.n / n) * 100 : 0;
        const ref = r ? (k.node.r / r) * 100 : 0;
        const d = dev(mine, ref, n, r);
        const nm = nameOf(k.label, node.actor, node.street, hist, t.aggressor);
        if (d === "warn" || d === "bad") out.push({ id: [...path, k.label].join(">"), path: [...path, k.label], where: where.join(" → ") || STREETS[node.street], label: `${STREETS[node.street]} · ${nm}`, mine, ref, n, level: d });
      }
    }
    for (const k of node.kids)
      if (k.node.n + k.node.r >= 10)
        go(k.node, [...path, k.label], [...hist, { street: node.street, actor: node.actor, label: k.label }], [...where, `${node.actor} ${nameOf(k.label, node.actor, node.street, hist, t.aggressor)}`]);
  };
  go(t.root, [], [], []);
  return out.sort((a, b) => (a.level === b.level ? Math.abs(b.mine - b.ref) * Math.sqrt(b.n) - Math.abs(a.mine - a.ref) * Math.sqrt(a.n) : a.level === "bad" ? -1 : 1));
}

export function PostflopTree({ vs, filter, reference, refLabel }: { vs: string; filter: Filter; reference: string; refLabel: string }) {
  const { prefs, setPrefs } = useApp();
  const cfg = { table: "3max", me: "BTN", opp: "BB", pot: "", buckets: [] as string[], ...(prefs.ptree ?? {}) };
  const setCfg = (p: Partial<typeof cfg>) => setPrefs({ ptree: { ...cfg, ...p } });
  const q = { player: "", filter, vs, table: cfg.table, mePos: cfg.me, oppPos: cfg.opp, pot: cfg.pot, buckets: cfg.buckets, reference };
  const { data, loading } = useQuery(["ptree", q], () => api.postflopTree(q));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (data) {
      setOpen(defaultOpen(data.root));
      setSel(null);
    }
  }, [data]);
  const layout = useMemo(() => (data ? build(data.root, data.aggressor, open) : null), [data, open]);
  const leaks = useMemo(() => (data ? findLeaks(data) : []), [data]);
  const cur = layout?.boxes.find((b) => b.id === sel) ?? null;
  const poss = cfg.table === "hu" ? POS2 : POS3;

  // déplacer l'arbre à la souris (glisser le fond)
  const view = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const onDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".ptn")) return;
    const el = view.current;
    if (!el) return;
    drag.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
    const move = (ev: MouseEvent) => {
      if (!drag.current || !view.current) return;
      view.current.scrollLeft = drag.current.l - (ev.clientX - drag.current.x);
      view.current.scrollTop = drag.current.t - (ev.clientY - drag.current.y);
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  // ouvrir un chemin (depuis la liste des écarts) : toutes ses cases dépliées
  const reveal = (path: string[]) => {
    const n = new Set(open);
    for (let i = 1; i < path.length; i++) n.add(path.slice(0, i).join(">"));
    setOpen(n);
    setSel(path.join(">"));
  };
  const toggle = (b: VBox) => {
    setSel(b.id);
    if (!b.node.actor) return;
    const n = new Set(open);
    if (n.has(b.id)) {
      for (const k of [...n]) if (k === b.id || k.startsWith(`${b.id}>`)) n.delete(k);
    } else n.add(b.id);
    setOpen(n);
  };
  const potLabel = data?.pots.find((p) => p.key === data.pot)?.label ?? "";
  const rootN = data ? data.root.n : 0;

  return (
    <>
      <PaneLeft>
        <div className="pane-title">Duel analysé</div>
        <div className="side-card">
          <div className="side-ctl">
            <span>Table</span>
            <Seg small value={cfg.table} onChange={(v) => setCfg({ table: v, me: v === "hu" ? "SB" : "BTN", opp: "BB", pot: "" })} options={[{ v: "3max", l: "3-way" }, { v: "hu", l: "Tête-à-tête" }]} />
          </div>
          <div className="side-ctl">
            <span>Ma position</span>
            <div className="fchips">
              {poss.map((p) => (
                <button key={p} className={cls("fchip", cfg.me === p && "on")} onClick={() => setCfg({ me: p, opp: cfg.opp === p ? poss.find((x) => x !== p)! : cfg.opp, pot: "" })}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="side-ctl">
            <span>Contre le joueur en</span>
            <div className="fchips">
              {poss
                .filter((p) => p !== cfg.me)
                .map((p) => (
                  <button key={p} className={cls("fchip", cfg.opp === p && "on")} onClick={() => setCfg({ opp: p, pot: "" })}>
                    {p}
                  </button>
                ))}
            </div>
          </div>
          {data && data.pots.length > 0 && (
            <div className="side-ctl">
              <span>Pot</span>
              <div className="col gap6">
                {data.pots.map((p) => (
                  <button key={p.key} className={cls("fchip", data.pot === p.key && "on")} onClick={() => setCfg({ pot: p.key })}>
                    {p.label} <span className="muted">· {num(p.n)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="side-ctl">
            <span>Tapis effectif (bb)</span>
            <div className="fchips">
              {BUCKETS.map((b) => (
                <button key={b} className={cls("fchip", cfg.buckets.includes(b) && "on")} onClick={() => setCfg({ buckets: cfg.buckets.includes(b) ? cfg.buckets.filter((x) => x !== b) : [...cfg.buckets, b] })}>
                  {b}
                </button>
              ))}
            </div>
            {reference.startsWith("file:") && cfg.buckets.length > 0 && <span className="muted small">Les tranches de tapis ne filtrent que tes mains : la base importée est prise en entier.</span>}
          </div>
        </div>
      </PaneLeft>
      <PaneRight>
        {cur ? (
          <div className="side-card">
            <div className="pane-title">
              {STREETS[cur.street]} · {cur.actor}
              {cur.subject ? " (toi)" : ""}
            </div>
            <b className="ptd-name">{cur.name}</b>
            <div className="side-kv">
              <span>Moi</span>
              <b>
                {num(cur.mine, 0)} % <span className="muted">· {num(cur.n)} mains</span>
              </b>
              <span>{refLabel}</span>
              <b>{cur.rn ? `${num(cur.ref, 0)} % · ${num(cur.rn)} mains` : "–"}</b>
              {cur.n > 0 && (
                <>
                  <span>Mon résultat moyen ensuite</span>
                  <b className={cur.node.net >= 0 ? "pos" : "neg"}>{num(cur.node.net, 2)} bb</b>
                </>
              )}
            </div>
            {cur.sizes.length > 0 && (
              <table className="lk-tbl">
                <thead>
                  <tr>
                    <th>Taille</th>
                    <th className="r">Moi</th>
                    <th className="r">Réf.</th>
                  </tr>
                </thead>
                <tbody>
                  {cur.sizes.map(([s, n, r]) => (
                    <tr key={s}>
                      <td>
                        <i className="gw-dot" style={{ background: SIZE_COLOR[s] ?? "#888" }} />
                        {s === "⅓" || s === "½" || s === "¾" ? `${s} pot` : s}
                      </td>
                      <td className="r">{cur.n ? `${num((n / cur.n) * 100, 0)} %` : "–"}</td>
                      <td className="r">{cur.rn ? `${num((r / cur.rn) * 100, 0)} %` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="side-card side-hint">Clique une case pour voir son détail (tailles de mise, résultat) et déplier la suite du coup.</div>
        )}
        <div className="side-card">
          <div className="row gap8">
            <div className="pane-title">Mes plus gros écarts</div>
            <Help text={`Décisions où ta fréquence s'écarte de la référence (${refLabel}) au même endroit de l'arbre. Tolérance 4 % + 40/√n : orange = écart notable, rouge = fort. Clique pour aller à la case.`} />
          </div>
          {!leaks.length ? (
            <span className="muted small">{data ? "Aucun écart notable sur cet échantillon." : "…"}</span>
          ) : (
            <div className="pt-leaks">
              {leaks.slice(0, 12).map((l, i) => (
                <button key={i} className={cls("pt-leak", l.level)} onClick={() => reveal(l.path)}>
                  <span className="pt-leak-w">{l.where}</span>
                  <b>{l.label}</b>
                  <span>
                    {num(l.mine, 0)} % <span className="muted">contre {num(l.ref, 0)} % · {num(l.n)} mains</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </PaneRight>
      {loading && !data ? (
        <Loading h={360} />
      ) : !data || !layout || data.hands + data.ref_hands === 0 ? (
        <Empty title="Aucun duel" sub="Aucune main de ce duel sur la sélection : change de position, de pot ou élargis les filtres." icon="search" />
      ) : (
        <div className="ptv-wrap">
          <div className="ptv-bar">
            <b>
              {cfg.me} contre {cfg.opp}
            </b>
            <span className="muted">
              {potLabel} · {num(rootN)} mains · référence : {refLabel} ({num(data.ref_hands)})
            </span>
            <div className="grow" />
            <button className="pill" onClick={() => setOpen(defaultOpen(data.root, 6))}>
              Tout déplier
            </button>
            <button className="pill" onClick={() => setOpen(new Set())}>
              Replier
            </button>
            <button className="pill" onClick={() => setZoom(Math.max(0.5, zoom - 0.1))} title="Dézoomer">
              −
            </button>
            <button className="pill" onClick={() => setZoom(Math.min(1.3, zoom + 0.1))} title="Zoomer">
              +
            </button>
          </div>
          <div className="ptv" ref={view} onMouseDown={onDown}>
            <div style={{ width: (layout.w + 40) * zoom, height: (layout.h + 40) * zoom }}>
              <div className="ptv-canvas" style={{ width: layout.w + 40, height: layout.h + 40, transform: `scale(${zoom})` }}>
                <svg className="ptv-lines" width={layout.w + 40} height={layout.h + 40}>
                  {layout.boxes.map((b) =>
                    b.kids.map((k) => {
                      const x1 = b.x + BOX_W;
                      const y1 = b.y + BOX_H / 2;
                      const x2 = k.x;
                      const y2 = k.y + BOX_H / 2;
                      const mx = (x1 + x2) / 2;
                      return <path key={k.id} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} stroke={ACT_COLOR[k.label] ?? "#888"} strokeOpacity={0.35 + Math.min(0.55, k.mine / 100)} strokeWidth={1.5 + Math.min(5, (k.mine / 100) * 6)} fill="none" />;
                    }),
                  )}
                  {/* départ : le flop */}
                  {layout.boxes
                    .filter((b) => b.depth === 1)
                    .map((b) => (
                      <path key={`r-${b.id}`} d={`M${BOX_W - 20},${layout.h / 2} C${(BOX_W - 20 + b.x) / 2},${layout.h / 2} ${(BOX_W - 20 + b.x) / 2},${b.y + BOX_H / 2} ${b.x},${b.y + BOX_H / 2}`} stroke={ACT_COLOR[b.label] ?? "#888"} strokeOpacity={0.35 + Math.min(0.55, b.mine / 100)} strokeWidth={1.5 + Math.min(5, (b.mine / 100) * 6)} fill="none" />
                    ))}
                </svg>
                <div className="ptn-root" style={{ top: layout.h / 2 - 44, width: BOX_W - 20 }}>
                  <span className="pt-street">Flop</span>
                  <b>{data.root.actor} parle</b>
                  <span className="muted small">{potLabel}</span>
                  <span className="small">
                    {num(rootN)} mains <span className="muted">· réf. {num(data.ref_hands)}</span>
                  </span>
                </div>
                {layout.boxes.map((b) => {
                  const level = b.subject ? devOf(b, data) : "nr";
                  const isOpen = open.has(b.id);
                  const end = !b.node.actor;
                  const bet = b.sizes.filter((s) => s[1] > 0);
                  const bn = bet.reduce((a, s) => a + s[1], 0);
                  return (
                    <button
                      key={b.id}
                      className={cls("ptn", b.subject && "me", sel === b.id && "sel", end && "end")}
                      style={{ left: b.x, top: b.y, width: BOX_W, height: BOX_H, ["--c" as string]: ACT_COLOR[b.label] ?? "#888" }}
                      onClick={() => toggle(b)}
                    >
                      <span className="ptn-h">
                        <span>
                          {b.actor} · {STREETS[b.street]}
                        </span>
                        {b.subject && <span className="pt-me">toi</span>}
                      </span>
                      <span className="ptn-m">
                        <b className="ptn-name">{b.name}</b>
                        <b className={cls("ptn-pct lk-c", `dv-${level}`)}>{num(b.mine, 0)} %</b>
                        <span className="ptn-ref">{b.rn ? `réf ${num(b.ref, 0)} %` : ""}</span>
                      </span>
                      {bn > 0 ? (
                        <span className="ptn-sizes" title={bet.map((s) => `${s[0]} ${num((s[1] / bn) * 100, 0)} %`).join(" · ")}>
                          {bet.map((s) => (
                            <i key={s[0]} style={{ width: `${(s[1] / bn) * 100}%`, background: SIZE_COLOR[s[0]] ?? "#888" }} />
                          ))}
                        </span>
                      ) : (
                        <span className="ptn-sizes none" />
                      )}
                      <span className="ptn-f">
                        <span>{num(b.n)} mains</span>
                        {end ? (
                          b.n > 0 && <b className={b.node.net >= 0 ? "pos" : "neg"}>{num(b.node.net, 1)} bb</b>
                        ) : (
                          <span className="ptn-next">
                            {b.node.actor} {isOpen ? "−" : "+"}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="pt-legend">
            {Object.entries(ACT_COLOR).map(([l, c]) => (
              <span key={l}>
                <i style={{ background: c }} />
                {l === "Bet" ? "Mise (c-bet, donk, barrel, probe)" : l === "Raise" ? "Relance / check-raise" : l}
              </span>
            ))}
            <span className="muted">Tailles : </span>
            {Object.entries(SIZE_COLOR)
              .filter(([s]) => s !== "Relance")
              .map(([s, c]) => (
                <span key={s}>
                  <i style={{ background: c }} />
                  {s}
                </span>
              ))}
          </div>
        </div>
      )}
    </>
  );
}

/** Niveau d'écart d'une case (décision du sujet) par rapport à la référence. */
function devOf(b: VBox, t: PTree): ReturnType<typeof dev> {
  // totaux de la décision parente
  let node: PNode = t.root;
  for (const l of b.path.slice(0, -1)) node = node.kids.find((k) => k.label === l)!.node;
  return dev(b.mine, b.ref, tot(node, false), tot(node, true));
}
