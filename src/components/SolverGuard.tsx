// Bouton « Couper le solver » : toujours visible dans le menu. Arrête tout calcul, libère la
// mémoire et active le mode session (aucun nouveau calcul tant qu'il n'est pas désactivé), pour
// être certain que rien ne tourne pendant une partie.
import { useEffect, useState } from "react";
import { useApp } from "../lib/state";
import { Icon } from "./Icon";
import { cls } from "../lib/format";
import { guardApi } from "../lib/solver";

export function SolverGuard() {
  const { toast } = useApp();
  const [st, setSt] = useState<{ locked: boolean; running: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const poll = () => guardApi.state().then(setSt).catch(() => {});
  useEffect(() => {
    poll();
    const t = window.setInterval(poll, 1500);
    return () => window.clearInterval(t);
  }, []);
  const kill = async () => {
    setBusy(true);
    try {
      const r = await guardApi.killAll();
      if (r.stopped) toast("Solver coupé : aucun calcul en cours, mode session actif");
      else if (window.confirm("Un calcul ne s'est pas arrêté dans les 15 secondes. Redémarrer l'application pour être certain que plus rien ne tourne ?")) await guardApi.restart();
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setBusy(false);
      poll();
    }
  };
  const unlock = async () => {
    await guardApi.lock(false);
    toast("Mode session désactivé : le solver peut de nouveau calculer");
    poll();
  };
  if (!st) return null;
  return (
    <div className={cls("guard", st.running && "run", st.locked && "lock")}>
      {st.running && (
        <div className="guard-run" title="Un calcul du solver tourne en ce moment">
          <i /> Calcul en cours
        </div>
      )}
      {st.locked && !st.running ? (
        <button className="nav" onClick={unlock} title="Le solver est coupé (mode session). Cliquer pour le réactiver.">
          <Icon name="shield" size={17} />
          <span>Session : solver coupé</span>
        </button>
      ) : (
        <button className={cls("nav", "guard-kill")} onClick={kill} disabled={busy} title="Arrête tout calcul, libère la mémoire et bloque le solver (mode session)">
          <Icon name="power" size={17} />
          <span>{busy ? "Arrêt…" : "Couper le solver"}</span>
        </button>
      )}
    </div>
  );
}
