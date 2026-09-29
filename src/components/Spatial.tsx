// Coque « Spatial » : un décor de salle de poker flou et trois panneaux de verre. Le panneau
// central porte la page ; ceux de gauche et de droite sont inclinés vers l'utilisateur et se
// redressent au survol. Chaque page remplit les panneaux latéraux par <PaneLeft> / <PaneRight>.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useApp, useQuery } from "../lib/state";
import { api } from "../lib/api";
import { cls, money, num, tone } from "../lib/format";

interface Slots {
  left: HTMLElement | null;
  right: HTMLElement | null;
  claimRight: (on: boolean) => void;
}

const SlotCtx = createContext<Slots>({ left: null, right: null, claimRight: () => {} });

/** Contenu propre à la page dans le panneau de gauche (sous la navigation). */
export function PaneLeft({ children }: { children: ReactNode }) {
  const { left } = useContext(SlotCtx);
  return left ? createPortal(children, left) : null;
}

/** Contenu propre à la page dans le panneau de droite (remplace le résumé). */
export function PaneRight({ children }: { children: ReactNode }) {
  const { right, claimRight } = useContext(SlotCtx);
  useEffect(() => {
    claimRight(true);
    return () => claimRight(false);
  }, [claimRight]);
  return right ? createPortal(children, right) : null;
}

/** Décor : salle chaude, lampe, fenêtre et table de poker floues, lumières qui dérivent. */
export function Scene() {
  return (
    <div className="scene" aria-hidden="true">
      <div className="scene-table" />
      <div className="scene-bokeh" />
      <div className="scene-vignette" />
    </div>
  );
}

export function SpatialShell({ nav, foot, page, children }: { nav: ReactNode; foot?: ReactNode; page: string; children: ReactNode }) {
  const [left, setLeft] = useState<HTMLElement | null>(null);
  const [right, setRight] = useState<HTMLElement | null>(null);
  const [owned, setOwned] = useState(0);
  const [claim] = useState(() => (on: boolean) => setOwned((n) => Math.max(0, n + (on ? 1 : -1))));
  return (
    <SlotCtx.Provider value={{ left, right, claimRight: claim }}>
      <div className="stage">
        <Scene />
        <div className="spatial">
          <aside className="pane pane-left">
            <div className="pane-scroll">
              {nav}
              <div className="pane-slot" ref={setLeft} />
              {foot && <div className="pane-foot">{foot}</div>}
            </div>
          </aside>
          <main className="pane pane-center">
            <div className="pane-scroll center-scroll" key={page}>
              {children}
            </div>
          </main>
          <aside className="pane pane-right">
            <div className="pane-scroll">
              <div className="pane-slot" ref={setRight} />
              {owned === 0 && <SummaryPane />}
            </div>
          </aside>
        </div>
      </div>
    </SlotCtx.Provider>
  );
}

/** Résumé par défaut du panneau de droite : les chiffres clés de la sélection en cours. */
function SummaryPane() {
  const { filter, ready, prefs } = useApp();
  const { data: s } = useQuery(["summary", filter], () => api.summary(filter), ready);
  const hide = !!prefs.privacy["__all"];
  if (!s) return null;
  const rows: [string, string, string?][] = [
    ["Tournois", num(s.tournaments)],
    ["CEV", num(s.cev, 1), tone(s.cev)],
    ["EV profit", money(s.profit.ev), tone(s.profit.ev)],
    ["Profit réel", money(s.profit.real), tone(s.profit.real)],
    ["Rakeback", money(s.rakeback)],
  ];
  return (
    <div className="summary">
      <div className="pane-title">Résumé</div>
      {rows.map(([l, v, tn]) => (
        <div key={l} className="sum-row">
          <span>{l}</span>
          <b className={cls(tn, hide && "blurred")}>{v}</b>
        </div>
      ))}
    </div>
  );
}
