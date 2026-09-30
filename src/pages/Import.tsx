import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, type ImportResult } from "../lib/api";
import { useApp, useQuery, clearCache } from "../lib/state";
import { Btn, Loading, Modal, Panel, Seg } from "../components/ui";
import { Icon } from "../components/Icon";
import { Heatmap } from "../components/Heatmap";
import { cls, num, realDate } from "../lib/format";
import { ReviewModal } from "../components/ReviewModal";
import { analyze, linesApi, pendingReview, saveReview, type Analysis } from "../lib/review";
import { parseBook, rangesApi, type RangeBook } from "../lib/ranges";

export function ImportPage() {
  const { bump, toast, overview, filter, prefs, go } = useApp();
  const [review, setReview] = useState<{ a: Analysis; book: RangeBook } | null>(null);
  const [del, setDel] = useState<{ id: number; label: string; remaining: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [drop, setDrop] = useState(false);
  const [metric, setMetric] = useState<"spins" | "profit" | "ev">("spins");
  const { data: cal } = useQuery(["calendar", filter], () => api.calendar(filter));
  const { data: hist } = useQuery(["imports"], () => api.imports());
  const { data: folders } = useQuery(["hh-folders"], () => api.hhFolders());

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
      // décisions préflop des nouvelles mains comparées aux ranges
      if (r.hand_ids?.length) {
        try {
          const book = parseBook(await rangesApi.load());
          if (book.books.length) {
            const threshold = Number((prefs.trainer as { threshold?: number } | undefined)?.threshold ?? 0.1);
            const a = analyze(await linesApi.get(r.hand_ids), book, threshold);
            if (a.decisions.length) {
              const ok = a.decisions.filter((d) => d.ok).length;
              await saveReview(
                {
                  ts: Math.floor(Date.now() / 1000),
                  label: `Import du ${realDate(Math.floor(Date.now() / 1000))}`,
                  decisions: a.decisions.length,
                  ok,
                  evLoss: a.decisions.reduce((x, d) => x + (d.evLoss ?? 0), 0),
                  errors: a.decisions.filter((d) => !d.ok),
                },
                rangesApi.trainerLoad,
                rangesApi.trainerSave,
              );
              setReview({ a, book });
            }
          }
        } catch (e) {
          toast(`Analyse préflop impossible : ${e}`, "err");
        }
      }
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
            <div className="formats">
              <span className="fmt ok">PMU (.xml)</span>
              <span className="fmt ok" title="Expresso et Expresso Nitro : historiques .txt et fichiers « summary »">Winamax Expresso (.txt + résumés)</span>
              <span className="fmt ok" title="Historiques et « Tournament Summary » en anglais (réglage de l'historique dans PokerStars)">PokerStars Spin &amp; Go (.txt, en anglais)</span>
              <span className="fmt ok" title="Unibet.fr utilise le logiciel iPoker : mêmes fichiers XML que PMU">Unibet.fr (.xml iPoker)</span>
              <span className="fmt ok">Betclic Spin &amp; Rush (.txt ExportHH, .zip)</span>
            </div>
            <div className="muted small">Room détectée automatiquement · doublons ignorés · seuls les formats Spin (2-3 joueurs) sont conservés.</div>
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
      {!busy && folders && folders.length > 0 && (
        <Panel title="Dossiers d'historiques trouvés sur ce PC" help="Emplacements par défaut de Winamax, PokerStars (.FR et .com), Unibet.fr et PMU. Un clic importe tout le dossier ; les mains déjà en base sont ignorées.">
          <div className="hh-folders">
            {folders.map((f) => (
              <div key={f.path} className="hh-folder">
                <b>{f.room}</b>
                <span className="muted small hh-path" title={f.path}>
                  {f.path}
                </span>
                <span className="muted small">{num(f.files)} fichiers</span>
                <Btn small icon="upload" onClick={() => run([f.path])}>
                  Importer
                </Btn>
              </div>
            ))}
          </div>
          {folders.length > 1 && (
            <Btn kind="primary" icon="upload" onClick={() => run(folders.map((f) => f.path))}>
              Tout importer
            </Btn>
          )}
        </Panel>
      )}
      {result && (
        <Panel title="Dernier import">
          <div className="tiles tiles-6">
            <Res l="Fichiers" v={result.sources} />
            <Res l="Mains lues" v={result.hands} />
            <Res l="Importées" v={result.imported} tone="pos" />
            <Res l="Doublons" v={result.duplicates} />
            <Res l="Invalides" v={result.invalid} tone={result.invalid ? "neg" : ""} />
            <Res l="Tournois" v={result.tournaments} />
            {result.skipped > 0 && <Res l="Hors format Spin" v={result.skipped} tone="warn" />}
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
      <Panel
        title="Historique des imports"
        help="Chaque import est un lot : le supprimer retire uniquement les mains qu'il avait ajoutées (les doublons déjà présents sont conservés). Les mains déjà en base ne sont jamais importées deux fois."
        pad={false}
      >
        <div className="tbl-wrap" style={{ maxHeight: 260 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Contenu</th>
                <th className="r">Sources</th>
                <th className="r">Mains lues</th>
                <th className="r">Importées</th>
                <th className="r">Doublons ignorés</th>
                <th className="r">Invalides</th>
                <th className="r">En base</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(hist ?? []).map((h) => (
                <tr key={h.id}>
                  <td>{realDate(h.ts)}</td>
                  <td className="muted">{h.label || "–"}</td>
                  <td className="r">{num(h.sources)}</td>
                  <td className="r">{num(h.hands)}</td>
                  <td className="r pos">{num(h.imported)}</td>
                  <td className="r muted">{num(h.duplicates)}</td>
                  <td className={cls("r", h.invalid > 0 && "neg")}>{num(h.invalid)}</td>
                  <td className="r">{num(h.remaining)}</td>
                  <td className="r">
                    <button
                      className="icon-btn"
                      disabled={h.remaining === 0}
                      title={
                        h.remaining === 0
                          ? "Import antérieur au suivi par lots : ses mains ne peuvent plus être isolées (Paramètres → Données pour tout effacer)"
                          : "Supprimer cet import et les mains qu'il a apportées"
                      }
                      onClick={() => setDel({ id: h.id, label: h.label || realDate(h.ts), remaining: h.remaining })}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {del && (
        <Modal title="Supprimer cet import" onClose={() => setDel(null)}>
          <p>
            L'import <b>{del.label}</b> sera retiré de la base : <b>{num(del.remaining)} mains</b> et les tournois devenus vides seront supprimés. Les mains apportées par
            d'autres imports ne sont pas touchées.
          </p>
          <div className="row gap8" style={{ justifyContent: "flex-end", marginTop: 16 }}>
            <Btn onClick={() => setDel(null)}>Annuler</Btn>
            <Btn
              kind="danger"
              icon="trash"
              onClick={async () => {
                try {
                  const r = await api.deleteImport(del.id);
                  clearCache();
                  bump();
                  toast(`${num(r.hands)} mains et ${num(r.tournaments)} tournois supprimés`);
                } catch (e) {
                  toast(String(e), "err");
                }
                setDel(null);
              }}
            >
              Supprimer
            </Btn>
          </div>
        </Modal>
      )}
      {review && (
        <ReviewModal
          a={review.a}
          book={review.book}
          title="Tes décisions préflop de cet import"
          onClose={() => setReview(null)}
          onReplay={(errors) => {
            pendingReview.items = errors;
            pendingReview.label = "Erreurs de l'import";
            setReview(null);
            go("ranges");
          }}
        />
      )}
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
