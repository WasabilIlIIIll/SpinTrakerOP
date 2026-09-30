// Coque « Spatial » : un décor de salle de poker flou et trois panneaux de verre. Le panneau
// central porte la page ; ceux de gauche et de droite sont inclinés vers l'utilisateur et se
// redressent au survol. Chaque page remplit les panneaux latéraux par <PaneLeft> / <PaneRight>.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useApp, useQuery } from "../lib/state";
import { api } from "../lib/api";
import { cls, money, num, tone } from "../lib/format";

interface Slots {
  left: HTMLElement | null;
  right: HTMLElement | null;
  top: HTMLElement | null;
  claimRight: (on: boolean) => void;
  claimTop: (on: boolean) => void;
}

const SlotCtx = createContext<Slots>({ left: null, right: null, top: null, claimRight: () => {}, claimTop: () => {} });

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

/** Contenu propre à la page dans le panneau de droite (remplace le résumé). */
export function PaneRight({ children }: { children: ReactNode }) {
  const { right, claimRight } = useContext(SlotCtx);
  useEffect(() => {
    claimRight(true);
    return () => claimRight(false);
  }, [claimRight]);
  return right ? createPortal(children, right) : null;
}

/** Fond : le fond d'écran Windows, placé exactement comme sur le bureau (mode « remplir »),
 * pour que les panneaux semblent posés dessus. Sans fond image, décor de salle de poker. */
export function Scene() {
  const [wall, setWall] = useState<{ url: string; w: number; h: number } | null>(null);
  const [, redraw] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      invoke<string | null>("desktop_wallpaper")
        .then((url) => {
          if (!url || !alive) return;
          const img = new Image();
          img.onload = () => alive && setWall({ url, w: img.naturalWidth, h: img.naturalHeight });
          img.src = url;
        })
        .catch(() => {});
    load();
    // fond changé pendant que l'application tourne : relu au retour sur la fenêtre
    const onFocus = () => load();
    const onResize = () => redraw((n) => n + 1);
    window.addEventListener("focus", onFocus);
    window.addEventListener("resize", onResize);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  if (wall) {
    // « remplir » : l'image couvre tout l'écran, centrée ; la fenêtre en montre la partie qu'elle recouvre
    const sw = window.screen.width;
    const sh = window.screen.height;
    const k = Math.max(sw / wall.w, sh / wall.h);
    const w = wall.w * k;
    const h = wall.h * k;
    const x = (sw - w) / 2 - (window.screenX || 0);
    const y = (sh - h) / 2 - (window.screenY || 0);
    return <div className="scene wall" aria-hidden="true" style={{ backgroundImage: `url(${wall.url})`, backgroundSize: `${w}px ${h}px`, backgroundPosition: `${x}px ${y}px` }} />;
  }
  return (
    <div className="scene" aria-hidden="true">
      <div className="scene-table" />
      <div className="scene-bokeh" />
      <div className="scene-vignette" />
    </div>
  );
}

/** Réduire / fermer : l'application n'a plus de barre de titre Windows. */
function WindowControls() {
  const win = () => import("@tauri-apps/api/window").then((m) => m.getCurrentWindow());
  return (
    <div className="winctl">
      <button title="Réduire" aria-label="Réduire" onClick={() => win().then((w) => w.minimize())}>
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
      <button title="Fermer" aria-label="Fermer" className="close" onClick={() => win().then((w) => w.close())}>
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}

export function SpatialShell({ nav, foot, page, title, children }: { nav: ReactNode; foot?: ReactNode; page: string; title: string; children: ReactNode }) {
  const [left, setLeft] = useState<HTMLElement | null>(null);
  const [right, setRight] = useState<HTMLElement | null>(null);
  const [top, setTop] = useState<HTMLElement | null>(null);
  const [owned, setOwned] = useState(0);
  const [ownedTop, setOwnedTop] = useState(0);
  const [claim] = useState(() => (on: boolean) => setOwned((n) => Math.max(0, n + (on ? 1 : -1))));
  const [claimTop] = useState(() => (on: boolean) => setOwnedTop((n) => Math.max(0, n + (on ? 1 : -1))));
  return (
    <SlotCtx.Provider value={{ left, right, top, claimRight: claim, claimTop }}>
      <div className="stage">
        <Scene />
        <div className="topbar-float" key={`top-${page}`}>
          <div className="top-slot" ref={setTop} />
          {ownedTop === 0 && <div className="top-title">{title}</div>}
        </div>
        <WindowControls />
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
