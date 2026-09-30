// Coque « Spatial » : une fenêtre réellement transparente, sans cadre, posée sur le bureau. Trois
// panneaux de verre fumé : le central porte la page, ceux de gauche et de droite sont inclinés
// vers l'utilisateur, se déplient à l'ouverture et se redressent au survol (réglable dans
// Paramètres › Disposition). La barre du haut déplace la fenêtre et porte − □ ×.
// Chaque page remplit les panneaux latéraux par <PaneLeft> / <PaneRight>, et l'utilisateur y
// ajoute ses propres blocs (SideWidgets).
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { SideWidgets } from "./SideWidgets";

interface Slots {
  left: HTMLElement | null;
  right: HTMLElement | null;
  top: HTMLElement | null;
  claimTop: (on: boolean) => void;
}

const SlotCtx = createContext<Slots>({ left: null, right: null, top: null, claimTop: () => {} });

/** Contenu propre à la page dans la barre du haut (ex. bulle Chips gagnés / Bankroll / Stats). */
export function PaneTop({ children }: { children: ReactNode }) {
  const { top, claimTop } = useContext(SlotCtx);
  useEffect(() => {
    claimTop(true);
    return () => claimTop(false);
  }, [claimTop]);
  return top ? createPortal(children, top) : null;
}

/** Contenu propre à la page dans le panneau de gauche (sous la navigation). */
export function PaneLeft({ children }: { children: ReactNode }) {
  const { left } = useContext(SlotCtx);
  return left ? createPortal(children, left) : null;
}

/** Contenu propre à la page en haut du panneau de droite (les blocs choisis suivent). */
export function PaneRight({ children }: { children: ReactNode }) {
  const { right } = useContext(SlotCtx);
  return right ? createPortal(children, right) : null;
}

const win = () => import("@tauri-apps/api/window").then((m) => m.getCurrentWindow());

/** Déplacer la fenêtre en tirant la barre (sauf sur un bouton), double-clic = plein écran. */
function onBarDown(e: React.MouseEvent) {
  if (e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (t.closest("button, a, input, select, textarea, [role=button], .no-drag")) return;
  if (e.detail === 2) {
    invoke("window_toggle_fill").catch(() => {});
    return;
  }
  win().then((w) => w.startDragging()).catch(() => {});
}

function WindowControls() {
  return (
    <div className="winctl no-drag">
      <button title="Réduire" aria-label="Réduire" onClick={() => win().then((w) => w.minimize())}>
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
      <button title="Agrandir / réduire la fenêtre" aria-label="Agrandir" onClick={() => invoke("window_toggle_fill").catch(() => {})}>
        <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      <button title="Fermer" aria-label="Fermer" className="close" onClick={() => win().then((w) => w.close())}>
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}

/** Bords invisibles pour redimensionner la fenêtre sans cadre. */
const EDGES = [
  ["n", "North"],
  ["s", "South"],
  ["e", "East"],
  ["w", "West"],
  ["ne", "NorthEast"],
  ["nw", "NorthWest"],
  ["se", "SouthEast"],
  ["sw", "SouthWest"],
] as const;

function ResizeEdges() {
  return (
    <>
      {EDGES.map(([k, dir]) => (
        <div
          key={k}
          className={`rsz rsz-${k}`}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            win().then((w) => w.startResizeDragging(dir)).catch(() => {});
          }}
        />
      ))}
    </>
  );
}

export function SpatialShell({ nav, foot, page, title, children }: { nav: ReactNode; foot?: ReactNode; page: string; title: string; children: ReactNode }) {
  const [left, setLeft] = useState<HTMLElement | null>(null);
  const [right, setRight] = useState<HTMLElement | null>(null);
  const [top, setTop] = useState<HTMLElement | null>(null);
  const [claimTop] = useState(() => (_on: boolean) => {});
  return (
    <SlotCtx.Provider value={{ left, right, top, claimTop }}>
      <div className="stage">
        <ResizeEdges />
        <div className="spatial">
          <aside className="pane pane-left">
            <div className="pane-in">
              <div className="pane-scroll">
                {nav}
                <div className="pane-slot" ref={setLeft} />
                <SideWidgets page={page} side="left" />
                {foot && <div className="pane-foot">{foot}</div>}
              </div>
            </div>
          </aside>
          <header className="topbar" onMouseDown={onBarDown}>
            <div className="top-title">{title}</div>
            <div className="top-slot" ref={setTop} key={`top-${page}`} />
            <WindowControls />
          </header>
          <main className="pane pane-center">
            <div className="pane-scroll center-scroll" key={page}>
              {children}
            </div>
          </main>
          <aside className="pane pane-right">
            <div className="pane-in">
              <div className="pane-scroll">
                <div className="pane-slot" ref={setRight} />
                <SideWidgets page={page} side="right" />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </SlotCtx.Provider>
  );
}
