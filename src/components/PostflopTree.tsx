// Arbre de décision postflop d'un duel : colonnes successives (flop → turn → river), chaque
// colonne = un joueur qui doit agir, ses actions avec leur fréquence, celle de la référence
// (les autres joueurs au même poste) et le résultat moyen. Les écarts marqués signalent les
// leaks probables ; la liste à droite pointe les plus gros.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Filter, type PNode } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { cls, num } from "../lib/format";
import { Empty, Help, Loading, Seg } from "./ui";
import { PaneLeft, PaneRight } from "./Spatial";

const STREETS = ["Préflop", "Flop", "Turn", "River"];
const BUCKETS = ["20+", "18-20", "16-18", "14-16", "12-14", "10-12", "8-10", "6-8", "4-6", "0-4"];
const POS3 = ["BTN", "SB", "BB"];
const POS2 = ["SB", "BB"];

export const ACT_COLOR: Record<string, string> = {
  Check: "#8a8f98",
  "Bet ⅓": "#f6c453",
  "Bet ½": "#f5a524",
  "Bet ¾": "#f97316",
  "Bet pot": "#ef4444",
  Overbet: "#dc2626",
  "All-in": "#9f1239",
  Call: "#22c55e",
  "Call all-in": "#15803d",
  Raise: "#a855f7",
  "Raise all-in": "#7e22ce",
  Fold: "#3b82f6",
};

const tot = (n: PNode, ref: boolean) => n.kids.reduce((a, k) => a + (ref ? k.node.r : k.node.n), 0);

/** Écart jugé comme dans le leak finder préflop : 4 % + 40/√n, rouge au-delà de 2,2 fois. */
function dev(mine: number, ref: number, n: number, rn: number): "ok" | "warn" | "bad" | "low" | "nr" {
  if (rn < 10) return "nr";
  if (n < 8) return "low";
  const d = Math.abs(mine - ref);
  const tol = 4 + 40 / Math.sqrt(n);
  return d <= tol ? "ok" : d <= tol * 2.2 ? "warn" : "bad";
}

function nodeAt(root: PNode, path: string[]): PNode | null {
  let n: PNode | undefined = root;
  for (const l of path) {
    n = n?.kids.find((k) => k.label === l)?.node;
    if (!n) return null;
  }
  return n ?? null;
}

interface Leak {
  path: string[];
  where: string;
  label: string;
  mine: number;
  ref: number;
  n: number;
  level: "warn" | "bad";
}

/** Tous les écarts notables du sujet dans l'arbre, du plus fort au plus faible. */
function findLeaks(root: PNode): Leak[] {
  const out: Leak[] = [];
  const go = (node: PNode, path: string[], where: string[]) => {
    if (node.subject && node.kids.length) {
      const n = tot(node, false);
      const r = tot(node, true);
      for (const k of node.kids) {
        const mine = n ? (k.node.n / n) * 100 : 0;
        const ref = r ? (k.node.r / r) * 100 : 0;
        const d = dev(mine, ref, n, r);
        if (d === "warn" || d === "bad") out.push({ path, where: where.join(" → ") || "Première décision", label: `${node.actor} ${k.label}`, mine, ref, n, level: d });
      }
    }
    for (const k of node.kids) if (k.node.n + k.node.r >= 10) go(k.node, [...path, k.label], [...where, `${node.actor} ${k.label}`]);
  };
  go(root, [], []);
  return out.sort((a, b) => (a.level === b.level ? Math.abs(b.mine - b.ref) * Math.sqrt(b.n) - Math.abs(a.mine - a.ref) * Math.sqrt(a.n) : a.level === "bad" ? -1 : 1));
}

export function PostflopTree({ player, vs, filter, subjectLabel }: { player: string; vs: string; filter: Filter; subjectLabel: string }) {
  const { prefs, setPrefs } = useApp();
  const cfg = { table: "3max", me: "BTN", opp: "BB", pot: "", buckets: [] as string[], ...(prefs.ptree ?? {}) };
  const setCfg = (p: Partial<typeof cfg>) => setPrefs({ ptree: { ...cfg, ...p } });
  const [path, setPath] = useState<string[]>([]);
  const q = { player, filter, vs, table: cfg.table, mePos: cfg.me, oppPos: cfg.opp, pot: cfg.pot, buckets: cfg.buckets };
  const { data, loading } = useQuery(["ptree", q], () => api.postflopTree(q));
  useEffect(() => setPath([]), [cfg.table, cfg.me, cfg.opp, cfg.pot, player, vs, cfg.buckets.join(",")]);
  const leaks = useMemo(() => (data ? findLeaks(data.root) : []), [data]);
  const cols = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = cols.current;
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [path.length]);
  const poss = cfg.table === "hu" ? POS2 : POS3;
  const columns: { node: PNode; path: string[] }[] = [];
  if (data) {
    for (let i = 0; i <= path.length; i++) {
      const n = nodeAt(data.root, path.slice(0, i));
      if (!n || !n.actor) break;
      columns.push({ node: n, path: path.slice(0, i) });
    }
  }
  const cur = data ? nodeAt(data.root, path) : null;
  return (
    <>
      <PaneLeft>
        <div className="pane-title">Duel analysé</div>
        <div className="side-card">
          <div className="side-ctl">
            <span>Table</span>
            <Seg small value={cfg.table} onChange={(v) => setCfg({ table: v, me: v === "hu" ? "SB" : "BTN", opp: "BB", pot: "" })} options={[{ v: "3max", l: "3-max" }, { v: "hu", l: "Tête-à-tête" }]} />
          </div>
          <div className="side-ctl">
            <span>Poste analysé ({subjectLabel})</span>
            <div className="fchips">
              {poss.map((p) => (
                <button key={p} className={cls("fchip", cfg.me === p && "on")} onClick={() => setCfg({ me: p, opp: cfg.opp === p ? poss.find((x) => x !== p)! : cfg.opp, pot: "" })}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="side-ctl">
            <span>Contre</span>
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
          </div>
        </div>
      </PaneLeft>
      <PaneRight>
        {data && (
          <div className="side-card">
            <div className="pane-title">Échantillon</div>
            <div className="side-kv">
              <span>{subjectLabel}</span>
              <b>{num(data.hands)} mains</b>
              <span>Référence</span>
              <b>{num(data.ref_hands)} mains</b>
              {cur && cur.n > 0 && (
                <>
                  <span>Résultat moyen ici</span>
                  <b className={cur.net >= 0 ? "pos" : "neg"}>{num(cur.net, 2)} bb</b>
                </>
              )}
            </div>
          </div>
        )}
        <div className="side-card">
          <div className="row gap8">
            <div className="pane-title">Écarts à la référence</div>
            <Help text="Décisions où ta fréquence s'écarte de celle des autres joueurs au même poste, au même endroit de l'arbre (tolérance 4 % + 40/√n). Clique pour y aller." />
          </div>
          {!leaks.length ? (
            <span className="muted small">{data ? "Aucun écart notable sur cet échantillon." : "…"}</span>
          ) : (
            <div className="pt-leaks">
              {leaks.slice(0, 12).map((l, i) => (
                <button key={i} className={cls("pt-leak", l.level)} onClick={() => setPath(l.path)}>
                  <span className="pt-leak-w">{l.where}</span>
                  <b>{l.label}</b>
                  <span>
                    {num(l.mine, 0)} % <span className="muted">au lieu de {num(l.ref, 0)} % · {num(l.n)} mains</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </PaneRight>
      {loading && !data ? (
        <Loading h={360} />
      ) : !data || data.hands + data.ref_hands === 0 ? (
        <Empty title="Aucun duel" sub="Aucune main de ce duel sur la sélection : change de poste, de pot ou élargis les filtres." icon="search" />
      ) : (
        <div className="pt">
          <div className="pt-path">
            <button className={cls("pt-crumb", !path.length && "on")} onClick={() => setPath([])}>
              {data.pots.find((p) => p.key === data.pot)?.label ?? "Flop"}
            </button>
            {path.map((l, i) => (
              <button key={i} className={cls("pt-crumb", i === path.length - 1 && "on")} onClick={() => setPath(path.slice(0, i + 1))}>
                {nodeAt(data.root, path.slice(0, i))?.actor} {l}
              </button>
            ))}
          </div>
          <div className="pt-cols" ref={cols}>
            {columns.map(({ node, path: p }, ci) => {
              const n = tot(node, false);
              const r = tot(node, true);
              const newStreet = ci === 0 || columns[ci - 1].node.street !== node.street;
              return (
                <div key={ci} className={cls("pt-col", node.subject && "me")}>
                  <div className="pt-col-h">
                    {newStreet && <span className="pt-street">{STREETS[node.street]}</span>}
                    <b>{node.actor}</b>
                    {node.subject && <span className="pt-me">{subjectLabel}</span>}
                    <div className="grow" />
                    <span className="muted small">
                      {num(n)} <span title="Mains de la référence">/ {num(r)}</span>
                    </span>
                  </div>
                  <div className="pt-bar">
                    {node.kids.map((k) =>
                      k.node.n > 0 ? <i key={k.label} style={{ width: `${(k.node.n / Math.max(1, n)) * 100}%`, background: ACT_COLOR[k.label] ?? "#888" }} title={k.label} /> : null,
                    )}
                  </div>
                  <div className="pt-bar ref">
                    {node.kids.map((k) =>
                      k.node.r > 0 ? <i key={k.label} style={{ width: `${(k.node.r / Math.max(1, r)) * 100}%`, background: ACT_COLOR[k.label] ?? "#888" }} title={`${k.label} (référence)`} /> : null,
                    )}
                  </div>
                  {node.kids.map((k) => {
                    const mine = n ? (k.node.n / n) * 100 : 0;
                    const ref = r ? (k.node.r / r) * 100 : 0;
                    const d = node.subject ? dev(mine, ref, n, r) : "nr";
                    const open = path[ci] === k.label;
                    const end = !k.node.actor;
                    return (
                      <button key={k.label} className={cls("pt-opt", open && "on", end && "end")} disabled={end} onClick={() => setPath([...p, k.label])}>
                        <i style={{ background: ACT_COLOR[k.label] ?? "#888" }} />
                        <span className="pt-opt-l">{k.label}</span>
                        <b className={cls("lk-c", `dv-${d}`)}>{n ? `${num(mine, 0)} %` : "–"}</b>
                        <span className="pt-ref">{r ? `${num(ref, 0)} %` : "–"}</span>
                        <span className="pt-n">{num(k.node.n)}</span>
                        {!end && <span className="pt-go">›</span>}
                      </button>
                    );
                  })}
                  <div className="pt-foot">
                    <span>
                      <b>%</b> {subjectLabel} · <span className="muted">% référence · mains</span>
                    </span>
                  </div>
                </div>
              );
            })}
            {cur && !cur.actor && (
              <div className="pt-col pt-endcol">
                <b>Fin du coup</b>
                <span className="muted small">{num(cur.n)} mains · résultat moyen</span>
                <b className={cur.net >= 0 ? "pos" : "neg"}>{num(cur.net, 2)} bb</b>
              </div>
            )}
          </div>
          <div className="pt-legend">
            {Object.entries(ACT_COLOR).map(([l, c]) => (
              <span key={l}>
                <i style={{ background: c }} />
                {l}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
