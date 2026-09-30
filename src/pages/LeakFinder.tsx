// Leak finder : cinq vues, réglées depuis le panneau de gauche.
//  - Préflop : chaque décision réelle comparée à une référence (population, tag…) ;
//  - Postflop : statistiques globales ;
//  - Arbre postflop : un duel (ex. BTN contre BB en pot relancé) en arbre de décision ;
//  - Comparer : moi contre un joueur / un groupe, situation par situation, avec les grilles ;
//  - Mes ranges : mes ranges face à ce que je joue vraiment.
import { api } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { Empty, Loading, Panel } from "../components/ui";
import { FilterBar } from "../components/FilterBar";
import { LeakPanels, PostflopTable, RefLegend, RefSources } from "../components/LeakPanels";
import { PostflopTree } from "../components/PostflopTree";
import { LeakCompare } from "../components/LeakCompare";
import { RangeVsPlay } from "../components/RangeVsPlay";
import { WhoPicker, whoLabel } from "../components/WhoPicker";
import { PaneLeft, PaneTop } from "../components/Spatial";
import { useRangeBook } from "./Ranges";
import { cls, num } from "../lib/format";

const SCENARIOS = ["BTN", "SB vs BTN", "SB vs BB", "BB vs BTN", "BB vs SB", "HU SB", "HU BB"];

type Mode = "pre" | "post" | "tree" | "cmp" | "rvp";
const MODES: [Mode, string, string][] = [
  ["pre", "Préflop", "Chaque décision préflop comparée à une référence"],
  ["tree", "Arbre postflop", "Un duel postflop en arbre de décision"],
  ["post", "Stats postflop", "Statistiques postflop globales"],
  ["cmp", "Comparer", "Moi contre un joueur ou un groupe, situation par situation"],
  ["rvp", "Mes ranges", "Mes ranges face à ce que je joue vraiment"],
];

export interface LeakPrefs {
  mode: Mode;
  player: string;
  vs: string;
  scenario: string | null;
  minHands: number;
  cmpL: string;
  cmpLVs: string;
  cmpR: string;
  cmpRVs: string;
}

const DEFAULTS: LeakPrefs = { mode: "pre", player: "hero", vs: "all", scenario: null, minHands: 5, cmpL: "hero", cmpLVs: "all", cmpR: "tag:reg", cmpRVs: "all" };

export function LeakFinder() {
  const { filter, prefs, setPrefs, settings } = useApp();
  const lp: LeakPrefs = { ...DEFAULTS, ...(prefs.leak ?? {}) };
  const set = (p: Partial<LeakPrefs>) => setPrefs({ leak: { ...lp, ...p } });
  const tags = settings?.tags ?? [];
  const subject = lp.player === "hero" ? "" : lp.player;
  const needReport = lp.mode === "pre" || lp.mode === "post";
  const { data, loading } = useQuery(["leak", subject, lp.vs, filter, prefs.leakRef], () => api.leakReport(subject, filter, prefs.leakRef, lp.vs), needReport);
  const { book } = useRangeBook();
  const subjectLabel = whoLabel(lp.player, tags);
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
        {(lp.mode === "pre" || lp.mode === "post" || lp.mode === "tree") && (
          <>
            <div className="pane-title">Joueur analysé</div>
            <WhoPicker value={lp.player} onChange={(v) => set({ player: v })} hero population />
            <div className="pane-title">Contre</div>
            <WhoPicker value={lp.vs} onChange={(v) => set({ vs: v })} all hero={lp.player !== "hero"} />
          </>
        )}
        {lp.mode === "cmp" && (
          <>
            <div className="pane-title">À gauche</div>
            <WhoPicker value={lp.cmpL} onChange={(v) => set({ cmpL: v })} hero population />
            <div className="lf-vs">
              <span>contre</span>
              <WhoPicker value={lp.cmpLVs} onChange={(v) => set({ cmpLVs: v })} all hero={lp.cmpL !== "hero"} />
            </div>
            <div className="pane-title">À droite</div>
            <WhoPicker value={lp.cmpR} onChange={(v) => set({ cmpR: v })} hero population />
            <div className="lf-vs">
              <span>contre</span>
              <WhoPicker value={lp.cmpRVs} onChange={(v) => set({ cmpRVs: v })} all hero={lp.cmpR !== "hero"} />
            </div>
          </>
        )}
        {(lp.mode === "pre" || lp.mode === "cmp") && (
          <>
            <div className="pane-title">Situation</div>
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
        {(lp.mode === "pre" || lp.mode === "post") && (
          <label className="side-ctl">
            <span>Référence</span>
            <select className="sel" value={prefs.leakRef} onChange={(e) => setPrefs({ leakRef: e.target.value })}>
              <option value="population">Population</option>
              {tags.map((t) => (
                <option key={t.id} value={`tag:${t.id}`}>
                  {t.name}s
                </option>
              ))}
              <option value="custom">Personnalisée</option>
              <option value="none">Sans référence</option>
            </select>
          </label>
        )}
        {lp.mode !== "rvp" && (
          <>
            <div className="pane-title">Sélection</div>
            <FilterBar />
          </>
        )}
      </PaneLeft>

      {lp.mode === "tree" && <PostflopTree player={subject} vs={lp.vs === "all" ? "" : lp.vs} filter={filter} subjectLabel={subjectLabel} />}
      {lp.mode === "cmp" && (
        <LeakCompare
          filter={filter}
          left={lp.cmpL}
          leftVs={lp.cmpLVs === "all" ? "" : lp.cmpLVs}
          right={lp.cmpR}
          rightVs={lp.cmpRVs === "all" ? "" : lp.cmpRVs}
          leftLabel={`${whoLabel(lp.cmpL, tags)}${lp.cmpLVs !== "all" ? ` vs ${whoLabel(lp.cmpLVs, tags)}` : ""}`}
          rightLabel={`${whoLabel(lp.cmpR, tags)}${lp.cmpRVs !== "all" ? ` vs ${whoLabel(lp.cmpRVs, tags)}` : ""}`}
          scenario={lp.scenario}
          minHands={lp.minHands}
        />
      )}
      {lp.mode === "rvp" && <RangeVsPlay book={book} />}
      {needReport &&
        (loading && !data ? (
          <Loading h={400} />
        ) : !data || data.hands === 0 ? (
          <Empty title="Aucune main" sub="Importez vos historiques ou élargissez les filtres." icon="search" />
        ) : (
          <Panel
            title={`${lp.mode === "pre" ? "Décisions préflop" : "Statistiques postflop"} · ${subjectLabel}${lp.vs !== "all" ? ` contre ${whoLabel(lp.vs, tags)}` : ""}`}
            help={
              lp.mode === "pre"
                ? "Chaque encadré est un nœud de décision réel (position + action des adversaires). Les couleurs comparent les fréquences à la référence choisie : vert = conforme, orange = écart notable, rouge = leak probable, gris = échantillon trop faible."
                : "Statistiques postflop comparées à la référence, en pots HU et à 3."
            }
            right={<span className="muted small">{num(data.hands)} mains analysées</span>}
          >
            <RefSources mode={prefs.leakRef} tagName={tags.find((t) => `tag:${t.id}` === prefs.leakRef)?.name} />
            <RefLegend />
            {lp.mode === "pre" ? (
              <LeakPanels report={data} scenarios={lp.scenario ? [lp.scenario] : undefined} minHands={lp.minHands} />
            ) : (
              <PostflopTable mine={data.postflop.player} reference={data.postflop.reference} />
            )}
          </Panel>
        ))}
    </div>
  );
}
