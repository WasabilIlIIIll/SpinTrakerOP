// Leak finder : c'est toujours MOI qui suis analysé, comparé à une référence choisie une fois
// pour toutes les vues (population, Regs, Fish, un joueur, ou une base importée).
//  - Préflop : mes décisions, situation par situation, avec l'écart à la référence ;
//  - Arbre postflop : un duel (ex. BTN contre BB en pot relancé) en arbre de décision ;
//  - Stats postflop : c-bet, fold vs c-bet, WTSD…, face à la référence ;
//  - Comparer : moi à gauche, la référence à droite, et les grilles de mains ;
//  - Mes ranges : mes ranges face à ce que je joue vraiment.
import { useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api, type NodeOut } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { Btn, Empty, Help, Loading, Modal, Panel } from "../components/ui";
import { FilterBar } from "../components/FilterBar";
import { HandMatrix, KINDS, LeakPanels, PostflopTable, RefLegend, RefSources } from "../components/LeakPanels";
import { PostflopTree } from "../components/PostflopTree";
import { LeakCompare } from "../components/LeakCompare";
import { RangeVsPlay } from "../components/RangeVsPlay";
import { WhoPicker, plural, whoLabel } from "../components/WhoPicker";
import { PaneLeft, PaneRight, PaneTop } from "../components/Spatial";
import { Icon } from "../components/Icon";
import { useRangeBook } from "./Ranges";
import { cls, date, num } from "../lib/format";

const SCENARIOS = ["BTN", "SB vs BTN", "SB vs BB", "BB vs BTN", "BB vs SB", "HU SB", "HU BB"];

type Mode = "pre" | "post" | "tree" | "cmp" | "rvp";
const MODES: [Mode, string, string][] = [
  ["pre", "Préflop", "Mes décisions préflop comparées à la référence"],
  ["tree", "Arbre postflop", "Un duel postflop en arbre de décision"],
  ["post", "Stats postflop", "Mes statistiques postflop face à la référence"],
  ["cmp", "Comparer", "Moi à gauche, la référence à droite"],
  ["rvp", "Mes ranges", "Mes ranges face à ce que je joue vraiment"],
];

export interface LeakPrefs {
  mode: Mode;
  vs: string;
  scenario: string | null;
  kinds: string[];
  minHands: number;
}

const DEFAULTS: LeakPrefs = { mode: "pre", vs: "all", scenario: null, kinds: [], minHands: 5 };

export function LeakFinder() {
  const { filter, prefs, setPrefs, settings, version } = useApp();
  const lp: LeakPrefs = { ...DEFAULTS, ...(prefs.leak ?? {}) };
  const set = (p: Partial<LeakPrefs>) => setPrefs({ leak: { ...lp, ...p } });
  const tags = (settings?.tags ?? []).filter((t) => t.active);
  const { data: refs } = useQuery(["refs", version], () => api.refList());
  const [manage, setManage] = useState(false);
  const [sel, setSel] = useState<NodeOut | null>(null);
  const reference = prefs.leakRef || "population";
  const refLabel = whoLabel(reference, tags, refs ?? []);
  const vs = lp.vs === "all" ? "" : lp.vs;
  const needReport = lp.mode === "pre" || lp.mode === "post";
  const { data, loading } = useQuery(["leak", vs, filter, reference], () => api.leakReport("", filter, reference, vs), needReport);
  const { book } = useRangeBook();
  const refChoices: [string, string][] = [
    ["population", "Population"],
    ...tags.map((t) => [`tag:${t.id}`, plural(t.name)] as [string, string]),
    ...(refs ?? []).map((r) => [`file:${r.id}`, r.name] as [string, string]),
  ];
  return (
    <div className="page">
      <PaneTop>
        <div className="bubble">
          {MODES.map(([m, l, tip]) => (
            <button key={m} className={cls(lp.mode === m && "on")} onClick={() => set({ mode: m })} title={tip}>
              {l}
            </button>
          ))}
        </div>
      </PaneTop>
      <PaneLeft>
        {lp.mode !== "rvp" && (
          <>
            <div className="row gap8">
              <div className="pane-title">Me comparer à</div>
              <Help text="La référence de toutes les vues du leak finder. Population, Regs, Fish : les autres joueurs de ta base. Une base importée : les statistiques d'un grand nombre de mains (plus fiable). Tu peux aussi choisir un joueur précis." />
            </div>
            <div className="fchips">
              {refChoices.map(([v, l]) => (
                <button key={v} className={cls("fchip", reference === v && "on", v.startsWith("file:") && "lf-file")} onClick={() => setPrefs({ leakRef: v })}>
                  {v.startsWith("file:") && <Icon name="folder" size={11} />} {l}
                </button>
              ))}
            </div>
            <WhoPicker value={reference.startsWith("player") ? reference : ""} onChange={(v) => setPrefs({ leakRef: v.startsWith("player") ? v : "population" })} searchOnly />
            <button className="lf-manage" onClick={() => setManage(true)}>
              <Icon name="download" size={13} /> Importer / exporter des bases de référence
            </button>
            <div className="pane-title">Mes mains contre</div>
            <div className="fchips">
              {[["all", "Tout le monde"] as [string, string], ...tags.map((t) => [`tag:${t.id}`, plural(t.name)] as [string, string])].map(([v, l]) => (
                <button key={v} className={cls("fchip", lp.vs === v && "on")} onClick={() => set({ vs: v })}>
                  {l}
                </button>
              ))}
            </div>
          </>
        )}
        {(lp.mode === "pre" || lp.mode === "cmp") && (
          <>
            <div className="pane-title">Ma position</div>
            <div className="fchips">
              <button className={cls("fchip", !lp.scenario && "on")} onClick={() => set({ scenario: null })}>
                Toutes
              </button>
              {SCENARIOS.map((s) => (
                <button key={s} className={cls("fchip", lp.scenario === s && "on")} onClick={() => set({ scenario: s })}>
                  {s}
                </button>
              ))}
            </div>
            <div className="pane-title">Type de coup</div>
            <div className="fchips">
              <button className={cls("fchip", !lp.kinds.length && "on")} onClick={() => set({ kinds: [] })}>
                Tous
              </button>
              {KINDS.map(([k, l]) => (
                <button key={k} className={cls("fchip", lp.kinds.includes(k) && "on")} onClick={() => set({ kinds: lp.kinds.includes(k) ? lp.kinds.filter((x) => x !== k) : [...lp.kinds, k] })}>
                  {l}
                </button>
              ))}
            </div>
            <label className="side-ctl">
              <span>Mains minimum par situation</span>
              <select className="sel" value={lp.minHands} onChange={(e) => set({ minHands: +e.target.value })}>
                {[1, 3, 5, 10, 25, 50].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {lp.mode !== "rvp" && (
          <>
            <div className="pane-title">Sélection</div>
            <FilterBar />
          </>
        )}
      </PaneLeft>

      {lp.mode === "pre" && (
        <PaneRight>
          <div className="row gap8">
            <div className="pane-title">Mes mains</div>
            <Help text="Clique une situation au centre : la grille montre ce que tu as joué avec chaque main (couleur = action, chiffre = nombre de fois)." />
          </div>
          {sel ? (
            <div className="side-card cmp-mx">
              <b>{sel.key.replace("|", " · ")}</b>
              <HandMatrix node={sel} />
            </div>
          ) : (
            <div className="side-card side-hint">Clique une situation pour voir la grille de tes mains.</div>
          )}
        </PaneRight>
      )}

      {lp.mode === "tree" && <PostflopTree vs={vs} filter={filter} reference={reference} refLabel={refLabel} />}
      {lp.mode === "cmp" && <LeakCompare filter={filter} vs={vs} reference={reference} refLabel={refLabel} scenario={lp.scenario} kinds={lp.kinds} minHands={lp.minHands} />}
      {lp.mode === "rvp" && <RangeVsPlay book={book} />}
      {needReport &&
        (loading && !data ? (
          <Loading h={400} />
        ) : !data || data.hands === 0 ? (
          <Empty title="Aucune main" sub="Importez vos historiques ou élargissez les filtres." icon="search" />
        ) : (
          <Panel
            title={`${lp.mode === "pre" ? "Mes décisions préflop" : "Mes statistiques postflop"}${lp.vs !== "all" ? ` contre les ${whoLabel(lp.vs, tags)}` : ""}`}
            right={<span className="muted small">{num(data.hands)} mains</span>}
          >
            <RefSources label={refLabel} />
            <RefLegend />
            {lp.mode === "pre" ? (
              <LeakPanels report={data} scenarios={lp.scenario ? [lp.scenario] : undefined} kinds={lp.kinds} minHands={lp.minHands} selected={sel?.key} onSelect={(n) => setSel(sel?.key === n.key ? null : n)} />
            ) : (
              <PostflopTable mine={data.postflop.player} reference={data.postflop.reference} />
            )}
          </Panel>
        ))}
      {manage && <RefManager onClose={() => setManage(false)} />}
    </div>
  );
}

/** Import / export des bases de référence (statistiques agrégées, sans pseudo ni main). */
function RefManager({ onClose }: { onClose: () => void }) {
  const { filter, settings, toast, bump, version, prefs, setPrefs } = useApp();
  const { data: refs } = useQuery(["refs", version], () => api.refList());
  const [who, setWho] = useState("population");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const tags = (settings?.tags ?? []).filter((t) => t.active);
  const imp = async () => {
    const path = await openDialog({ multiple: false, filters: [{ name: "Base de référence", extensions: ["json"] }] });
    if (!path || Array.isArray(path)) return;
    try {
      const id = await api.refImport(path);
      bump();
      setPrefs({ leakRef: `file:${id}` });
      toast("Base de référence importée");
    } catch (e) {
      toast(String(e), "err");
    }
  };
  const exp = async () => {
    const nm = name.trim() || `${whoLabel(who, tags)} ${date(Math.floor(Date.now() / 1000))}`;
    const path = await saveDialog({ defaultPath: `reference-${nm.replace(/[^\w-]+/g, "-")}.json`, filters: [{ name: "Base de référence", extensions: ["json"] }] });
    if (!path) return;
    setBusy(true);
    try {
      const n = await api.refExport(who === "hero" ? "" : who, filter, nm, `Exportée de Spin Tracker OP · ${whoLabel(who, tags)}`, path);
      toast(`Base exportée : ${num(n)} mains de ${whoLabel(who, tags)}`);
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setBusy(false);
    }
  };
  const del = async (id: string) => {
    if (!window.confirm("Retirer cette base de référence de l'application ? (le fichier d'origine n'est pas touché)")) return;
    try {
      await api.refDelete(id);
      if (prefs.leakRef === `file:${id}`) setPrefs({ leakRef: "population" });
      bump();
    } catch (e) {
      toast(String(e), "err");
    }
  };
  return (
    <Modal title="Bases de référence" onClose={onClose} wide>
      <div className="col gap16">
        <div className="muted small">
          Une base de référence contient les statistiques d'un groupe de joueurs (fréquences préflop par situation et tapis, stats postflop, arbres de décision postflop), sans aucun pseudo
          ni aucune main. Importe la base d'un joueur qui a beaucoup de volume pour comparer ton jeu à des chiffres solides ; exporte la tienne pour la partager.
        </div>
        <div className="side-card">
          <div className="row gap8">
            <b>Bases importées</b>
            <div className="grow" />
            <Btn small icon="upload" onClick={imp}>
              Importer un fichier…
            </Btn>
          </div>
          {!refs?.length ? (
            <span className="muted small">Aucune base importée pour l'instant.</span>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th className="r">Mains</th>
                  <th className="r">Situations</th>
                  <th className="r">Arbres</th>
                  <th>Créée le</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {refs.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.name}</b> <span className="muted small">{r.description}</span>
                    </td>
                    <td className="r">{num(r.hands)}</td>
                    <td className="r">{num(r.situations)}</td>
                    <td className="r">{num(r.trees)}</td>
                    <td>{r.created ? date(r.created) : "–"}</td>
                    <td className="r">
                      <button className="icon-btn" title="Retirer" onClick={() => del(r.id)}>
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="side-card">
          <b>Exporter une base</b>
          <span className="muted small">Calculée sur la sélection en cours (filtres du leak finder).</span>
          <div className="fchips">
            {[["population", "Population"] as [string, string], ...tags.map((t) => [`tag:${t.id}`, plural(t.name)] as [string, string]), ["hero", "Moi"] as [string, string]].map(([v, l]) => (
              <button key={v} className={cls("fchip", who === v && "on")} onClick={() => setWho(v)}>
                {l}
              </button>
            ))}
          </div>
          <div className="row gap8">
            <input className="inp" placeholder="Nom de la base (facultatif)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
            <Btn kind="primary" icon="download" onClick={exp} disabled={busy}>
              {busy ? "Export…" : "Exporter…"}
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}
