import { useEffect } from "react";
import { useApp } from "./lib/state";
import { Icon } from "./components/Icon";
import { Modals } from "./components/Modals";
import { FilterBar } from "./components/FilterBar";
import { Dashboard } from "./pages/Dashboard";
import { Tournaments } from "./pages/Tournaments";
import { Hands } from "./pages/Hands";
import { Players } from "./pages/Players";
import { LeakFinder } from "./pages/LeakFinder";
import { Challenges } from "./pages/Challenges";
import { ImportPage } from "./pages/Import";
import { SettingsPage } from "./pages/Settings";
import { RangesPage } from "./pages/Ranges";
import { cls } from "./lib/format";
import { t } from "./lib/i18n";
import { Spinner } from "./components/ui";

const NAV: [string, string, string][] = [
  ["dashboard", "Tableau de bord", "dashboard"],
  ["tournaments", "Tournois", "trophy"],
  ["hands", "Mains", "cards"],
  ["players", "Joueurs", "users"],
  ["leaks", "Leak finder", "search"],
  ["ranges", "Ranges", "target"],
  ["challenges", "Challenges", "flag"],
  ["import", "Import", "upload"],
  ["settings", "Paramètres", "settings"],
];

export function App() {
  const { page: rawPage, go, prefs, setPrefs, ready, toasts, overview } = useApp();
  // l'ancien onglet Solver est remplacé par Ranges
  const page = rawPage === "solver" ? "ranges" : rawPage;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        go(NAV[+e.key - 1][0]);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [go]);
  return (
    <div className={cls("app", prefs.sidebarCollapsed && "collapsed")}>
      <aside className="side">
        <div className="brand">
          <img className="brand-ic" src="/logo.png" alt="" />
          <span className="brand-t">
            Spin Tracker <b>OP</b>
          </span>
          <button className="icon-btn collapse" onClick={() => setPrefs({ sidebarCollapsed: !prefs.sidebarCollapsed })} title="Réduire le menu">
            <Icon name="menu" size={15} />
          </button>
        </div>
        <nav>
          {NAV.map(([k, l, ic], i) => (
            <button key={k} className={cls("nav", page === k && "on")} onClick={() => go(k)} title={`${t(l)} (Ctrl+${i + 1})`}>
              <Icon name={ic} size={17} />
              <span>{t(l)}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <button className="nav" onClick={() => setPrefs({ privacy: { ...prefs.privacy, __all: !prefs.privacy["__all"] } })} title="Mode discret">
            <Icon name={prefs.privacy["__all"] ? "eyeoff" : "eye"} size={17} />
            <span>Mode discret</span>
          </button>
          <div className="side-v">v{overview?.version ?? "…"}</div>
        </div>
      </aside>
      <main className="main">
        {page === "dashboard" && (
          <div className="topbar">
            <FilterBar />
          </div>
        )}
        {!ready ? (
          <div className="boot">
            <Spinner />
            <div>Chargement de votre base…</div>
          </div>
        ) : (
          <>
            {page === "dashboard" && <Dashboard />}
            {page === "tournaments" && <Tournaments />}
            {page === "hands" && <Hands />}
            {page === "players" && <Players />}
            {page === "leaks" && <LeakFinder />}
            {page === "ranges" && <RangesPage />}
            {page === "challenges" && <Challenges />}
            {page === "import" && <ImportPage />}
            {page === "settings" && <SettingsPage />}
          </>
        )}
      </main>
      <Modals />
      <div className="toasts">
        {toasts.map((x) => (
          <div key={x.id} className={cls("toast", x.kind)}>
            <Icon name={x.kind === "err" ? "info" : "check"} size={15} />
            {x.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
