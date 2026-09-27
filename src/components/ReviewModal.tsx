// Résultat de l'analyse préflop des mains jouées : précision par rapport aux ranges,
// détail par position, spots les plus fautifs, et bouton pour rejouer les erreurs.
import { Btn, Modal } from "./ui";
import { cls, num } from "../lib/format";
import { decisionLabel, type Analysis, type Decision } from "../lib/review";
import type { RangeBook } from "../lib/ranges";

export function ReviewModal({ a, book, title, onReplay, onClose }: { a: Analysis; book: RangeBook; title: string; onReplay: (errors: Decision[]) => void; onClose: () => void }) {
  const n = a.decisions.length;
  const ok = a.decisions.filter((d) => d.ok).length;
  const errors = a.decisions.filter((d) => !d.ok);
  const pct = n ? ok / n : 0;
  const evKnown = a.decisions.filter((d) => d.evLoss != null);
  const evLoss = evKnown.reduce((s, d) => s + (d.evLoss ?? 0), 0);

  // détail par position (et format)
  const groups = new Map<string, { n: number; ok: number }>();
  for (const d of a.decisions) {
    const k = `${d.fmt === "hu" ? "HU " : ""}${d.hero}`;
    const g = groups.get(k) ?? { n: 0, ok: 0 };
    g.n++;
    if (d.ok) g.ok++;
    groups.set(k, g);
  }
  // spots les plus fautifs
  const bySpot = new Map<string, { label: string; n: number }>();
  for (const d of errors) {
    const k = `${d.fmt}|${d.depth}|${d.key}`;
    const g = bySpot.get(k) ?? { label: decisionLabel(d, book), n: 0 };
    g.n++;
    bySpot.set(k, g);
  }
  const worst = [...bySpot.values()].sort((x, y) => y.n - x.n).slice(0, 6);
  // ranges calculées avec une ante alors que les Spins n'en ont pas : les comparaisons HU sont biaisées
  const huAnte = a.decisions.some((d) => d.fmt === "hu") && book.books.some((b) => b.fmt === "hu" && (b.sizes.ante ?? 0) > 0);

  const R = 54;
  const C = 2 * Math.PI * R;
  const tone = pct >= 0.85 ? "var(--pos)" : pct >= 0.7 ? "var(--warn)" : "var(--neg)";
  return (
    <Modal title={title} onClose={onClose} wide>
      {n === 0 ? (
        <div className="col gap12">
          <p>Aucune décision préflop n'a pu être comparée à tes ranges.</p>
          <p className="muted small">
            {a.hands} mains analysées · {a.outOfTree} sortent de l'arbre de tes ranges · {a.noRange} décisions sur des spots sans range.
          </p>
          <div className="row">
            <div className="grow" />
            <Btn onClick={onClose}>Fermer</Btn>
          </div>
        </div>
      ) : (
        <div className="rv">
          <div className="rv-top">
            <svg className="rv-ring" viewBox="0 0 140 140" width={150} height={150}>
              <circle cx={70} cy={70} r={R} className="rv-track" />
              <circle cx={70} cy={70} r={R} className="rv-arc" style={{ stroke: tone, strokeDasharray: `${C * pct} ${C}` }} transform="rotate(-90 70 70)" />
              <text x={70} y={68} textAnchor="middle" className="rv-pct">
                {num(pct * 100, 0)} %
              </text>
              <text x={70} y={90} textAnchor="middle" className="rv-sub">
                de précision
              </text>
            </svg>
            <div className="rv-facts">
              <div className="rv-big">
                <b className="pos">{num(ok)}</b> bonnes décisions sur <b>{num(n)}</b>
              </div>
              <div className="rv-big">
                <b className="neg">{num(errors.length)}</b> erreur{errors.length > 1 ? "s" : ""} par rapport à tes ranges
              </div>
              {evKnown.length > 0 && (
                <div className="muted small">
                  EV perdue sur les {num(evKnown.length)} décisions dont l'EV est connue (ranges HU) : <b className="neg">{num(evLoss, 2)} bb</b>
                </div>
              )}
              <div className="muted small">
                {num(a.hands)} mains analysées à la profondeur de range la plus proche du tapis effectif
                {a.outOfTree > 0 && ` · ${num(a.outOfTree)} sortent de l'arbre (action absente des ranges)`}
                {a.noRange > 0 && ` · ${num(a.noRange)} décisions sur des spots sans range`}
              </div>
            </div>
          </div>
          {huAnte && (
            <div className="rv-warn">
              Tes ranges tête-à-tête sont calculées <b>avec ante</b> (format HU SnG « With ante »), alors que les Spins se jouent sans ante. Avec une ante, la SB joue
              presque toutes ses mains : une partie des « erreurs » en HU (surtout des folds de la SB) sont en réalité correctes dans tes parties. Des ranges HU sans ante
              donneraient une comparaison juste.
            </div>
          )}
          <div className="rv-cols">
            <div>
              <div className="rv-h">Par position</div>
              <table className="tbl">
                <tbody>
                  {[...groups.entries()]
                    .sort((x, y) => x[1].ok / x[1].n - y[1].ok / y[1].n)
                    .map(([k, g]) => (
                      <tr key={k}>
                        <td>{k}</td>
                        <td className="r muted">{num(g.n)}</td>
                        <td className={cls("r", g.ok / g.n >= 0.85 ? "pos" : "neg")}>{num((g.ok / g.n) * 100, 0)} %</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="rv-h">Spots où tu te trompes le plus</div>
              {worst.length === 0 ? (
                <div className="muted small">Aucune erreur : parfait.</div>
              ) : (
                <table className="tbl">
                  <tbody>
                    {worst.map((w) => (
                      <tr key={w.label}>
                        <td>{w.label}</td>
                        <td className="r neg">{w.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <div className="row gap12">
            <div className="grow" />
            <Btn onClick={onClose}>Plus tard</Btn>
            <Btn kind="primary" icon="target" disabled={!errors.length} onClick={() => onReplay(errors)}>
              Retravailler mes {num(errors.length)} erreur{errors.length > 1 ? "s" : ""}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}
