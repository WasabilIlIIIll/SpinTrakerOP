import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AppProvider } from "./lib/state";
import "./styles/app.css";

/** Écran d'erreur : évite la page blanche en cas de plantage de l'interface. */
class Boundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ padding: 40, fontFamily: "system-ui", color: "#e0353f" }}>
        <h2 style={{ marginBottom: 12 }}>Spin Tracker OP a rencontré une erreur</h2>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#444" }}>{String(this.state.err?.stack ?? this.state.err)}</pre>
        <button onClick={() => location.reload()} style={{ marginTop: 16, padding: "8px 16px" }}>
          Recharger
        </button>
      </div>
    );
  }
}

window.addEventListener("error", (e) => {
  const el = document.getElementById("boot-error");
  if (el) el.textContent = `Erreur : ${e.message}`;
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Boundary>
      <AppProvider>
        <App />
      </AppProvider>
    </Boundary>
  </React.StrictMode>,
);
