import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, type ImportResult } from "../lib/api";
import { useApp, useQuery, clearCache } from "../lib/state";
import { Btn, Loading, Panel, Seg } from "../components/ui";
import { Icon } from "../components/Icon";
import { Heatmap } from "../components/Heatmap";
import { cls, date, num } from "../lib/format";

export function ImportPage() {
  const { bump, toast, overview, filter } = useApp();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [drop, setDrop] = useState(false);
  const [metric, setMetric] = useState<"spins" | "profit" | "ev">("spins");
  const { data: cal } = useQuery(["calendar", filter], () => api.calendar(filter));
  const { data: hist } = useQuery(["imports"], () => api.imports());

  const run = async (paths: string[]) => {
    if (!paths.length) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await api.importPaths(paths);
      clearCache();
      setResult(r);
      bump();
      toast(`${num(r.imported)} mains importées en ${(r.millis / 1000).toFixed(1)} s`);
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  useEffect(() => {
    let un1: (() => void) | undefined;
    let un2: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen<{ phase: string; done: number; total: number }>("import-progress", (e) => setProgress(e.payload)))
      .then((u) => (un1 = u))
      .catch(() => {});
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((e) => {
          if (e.payload.type === "over") setDrop(true);
          else if (e.payload.type === "drop") {
            setDrop(false);
            run(e.payload.paths);
          } else setDrop(false);
        }),
      )
      .then((u) => (un2 = u))
      .catch(() => {});
    return () => {
      un1?.();
      un2?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickFiles = async () => {
    const sel = await openDialog({ multiple: true, filters: [{ name: "Historiques", extensions: ["xml", "txt", "zip"] }] });
    if (sel) await run(Array.isArray(sel) ? sel : [sel]);
  };
  const pickFolder = async () => {
    const sel = await openDialog({ directory: true, multiple: true });
    if (sel) await run(Array.isArray(sel) ? sel : [sel]);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>Import</h2>
        <span className="muted small">{overview ? `${num(overview.tournaments)} spins · ${num(overview.hands)} mains en base` : ""}</span>
      </div>
      <div className={cls("dropzone", drop && "over", busy && "busy")}>
        {busy ? (
          <>
            <Loading h={60} />
            <div className="dz-t">{progress ? `${progress.phase} — ${num(progress.done)} / ${num(progress.total)}` : "Import en cours…"}</div>
            {progress && progress.total > 0 && (
              <div className="ch-bar" style={{ maxWidth: 420 }}>
                <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            )}
          </>
        ) : (
          <>
            <Icon name="upload" size={30} />
            <div className="dz-t">Glissez-déposez vos fichiers, dossiers ou .zip ici</div>
            <div className="muted small">Formats reconnus : PMU / iPoker (.xml), Winamax (.txt, bêta). Les doublons sont ignorés automatiquement.</div>
            <div className="row gap8">
              <Btn kind="primary" icon="file" onClick={pickFiles}>
                Choisir des fichiers
              </Btn>
              <Btn icon="folder" onClick={pickFolder}>
                Choisir un dossier
              </Btn>
            </div>
          </>
        )}
      </div>
      {result && (
        <Panel title="Dernier import">
          <div className="tiles tiles-6">
            <Res l="Fichiers" v={result.sources} />
            <Res l="Mains lues" v={result.hands} />
            <Res l="Importées" v={result.imported} tone="pos" />
            <Res l="Doublons" v={result.duplicates} />
            <Res l="Invalides" v={result.invalid} tone={result.invalid ? "neg" : ""} />
            <Res l="Tournois" v={result.tournaments} />
          </div>
          {result.errors.length > 0 && (
            <details className="errs">
              <summary>{result.errors.length} fichier(s) non lus</summary>
              <ul>
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </Panel>
      )}
      <Panel
        title="Calendrier de volume"
        right={<Seg small value={metric} onChange={setMetric} options={[{ v: "spins", l: "Spins" }, { v: "profit", l: "Profit" }, { v: "ev", l: "EV" }]} />}
      >
        {cal ? <Heatmap data={cal} metric={metric} /> : <Loading h={160} />}
      </Panel>
      <Panel title="Historique des imports" pad={false}>
        <div className="tbl-wrap" style={{ maxHeight: 260 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th className="r">Sources</th>
                <th className="r">Mains</th>
                <th className="r">Importées</th>
                <th className="r">Doublons</th>
                <th className="r">Invalides</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {(hist ?? []).map((h, i) => (
                <tr key={i}>
                  <td>{date(h.ts, true)}</td>
                  <td className="r">{num(h.sources)}</td>
                  <td className="r">{num(h.hands)}</td>
                  <td className="r pos">{num(h.imported)}</td>
                  <td className="r">{num(h.duplicates)}</td>
                  <td className={cls("r", h.invalid > 0 && "neg")}>{num(h.invalid)}</td>
                  <td className="pos">TERMINÉ</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Res({ l, v, tone }: { l: string; v: number; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat-l">{l}</div>
      <div className={cls("stat-v", tone)}>{num(v)}</div>
    </div>
  );
}
