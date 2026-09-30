// Blocs libres des panneaux latéraux : chaque page a sa liste à gauche et à droite, que
// l'utilisateur complète, réordonne (glisser), floute (œil) ou retire.
import { useEffect, useState, type ReactNode } from "react";
import { useApp, useQuery } from "../lib/state";
import { api, type ChallengeView, type Summary } from "../lib/api";
import { cls, duration, money, nowNaive, num, tone } from "../lib/format";
import { rangesApi } from "../lib/ranges";
import { Icon } from "./Icon";

export type Side = "left" | "right";

interface WidgetDef {
  title: string;
  render: (s: Summary | undefined) => ReactNode;
}

function Big({ label, value, tn, sub }: { label: string; value: ReactNode; tn?: string; sub?: ReactNode }) {
  return (
    <div className="wg-big">
      <span>{label}</span>
      <b className={tn}>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function ChallengeWidget() {
  const now = nowNaive();
  const { data } = useQuery(["challenges", Math.floor(now / 600)], () => api.challenges(now));
  const cur = (data ?? []).filter((c: ChallengeView) => c.status === "en_cours");
  if (!data) return null;
  if (!cur.length) return <div className="wg-empty">Aucun challenge en cours</div>;
  return (
    <div className="col gap12">
      {cur.slice(0, 3).map((c) => (
        <div key={c.challenge.id ?? c.challenge.name} className="wg-ch">
          <div className="row">
            <span className="wg-ch-n">{c.challenge.name}</span>
            <div className="grow" />
            <b>{num(c.progress * 100, 0)} %</b>
          </div>
          <div className="wg-bar">
            <i style={{ width: `${Math.min(100, c.progress * 100)}%`, background: c.challenge.color || "var(--accent)" }} />
          </div>
          <small>
            {num(c.value, 0)} / {num(c.challenge.target, 0)} · {num(Math.max(0, c.days_left), 0)} j restants
          </small>
        </div>
      ))}
    </div>
  );
}

/** Précision du trainer et de la dernière analyse de mains réelles (trainer.json). */
function useTrainerFile() {
  const [d, setD] = useState<{ spots?: Record<string, { n: number; ok: number }>; days?: Record<string, { n: number; ok: number }>; reviews?: { label: string; ts: number; decisions: number; ok: number; errors: unknown[] }[] } | null>(null);
  useEffect(() => {
    rangesApi
      .trainerLoad()
      .then((j) => setD(j ? JSON.parse(j) : {}))
      .catch(() => setD({}));
  }, []);
  return d;
}

function TrainerWidget() {
  const d = useTrainerFile();
  if (!d) return null;
  const tot = Object.values(d.spots ?? {}).reduce((a, x) => ({ n: a.n + x.n, ok: a.ok + x.ok }), { n: 0, ok: 0 });
  const day = new Date();
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const today = d.days?.[key];
  if (!tot.n) return <div className="wg-empty">Pas encore de mains au trainer</div>;
  return (
    <div className="wg-2">
      <Big label="Précision" value={`${num((tot.ok / tot.n) * 100, 0)} %`} sub={`${num(tot.n)} mains`} />
      <Big label="Aujourd'hui" value={today?.n ? `${num((today.ok / today.n) * 100, 0)} %` : "–"} sub={`${num(today?.n ?? 0)} mains`} />
    </div>
  );
}

function ReviewWidget() {
  const d = useTrainerFile();
  const r = d?.reviews?.[0];
  if (!d) return null;
  if (!r) return <div className="wg-empty">Aucune analyse de mains réelles</div>;
  return <Big label={r.label} value={`${num((r.ok / Math.max(1, r.decisions)) * 100, 0)} %`} sub={`${num(r.decisions)} décisions · ${num(r.errors.length)} erreurs`} />;
}

export const WIDGETS: Record<string, WidgetDef> = {
  summary: {
    title: "Résumé",
    render: (s) =>
      s && (
        <div className="col gap8">
          <Big label="Tournois" value={num(s.tournaments)} />
          <Big label="CEV" value={num(s.cev, 1)} tn={tone(s.cev)} sub={`± ${num(s.cev_ci, 0)}`} />
          <Big label="EV profit" value={money(s.profit.ev)} tn={tone(s.profit.ev)} />
          <Big label="Profit réel" value={money(s.profit.real)} tn={tone(s.profit.real)} />
          <Big label="Rakeback" value={money(s.rakeback)} />
        </div>
      ),
  },
  cev: { title: "CEV", render: (s) => s && <Big label="CEV par tournoi" value={num(s.cev, 1)} tn={tone(s.cev)} sub={`± ${num(s.cev_ci, 0)} (IC 95 %) · minimum ${num(s.min_cev, 1)}`} /> },
  profit: {
    title: "Profits",
    render: (s) =>
      s && (
        <div className="wg-2">
          <Big label="EV profit" value={money(s.profit.ev)} tn={tone(s.profit.ev)} />
          <Big label="Réel" value={money(s.profit.real)} tn={tone(s.profit.real)} />
          <Big label="ROI EV" value={`${num(s.roi.ev, 1)} %`} tn={tone(s.roi.ev)} />
          <Big label="€ / h EV" value={money(s.hourly.ev)} tn={tone(s.hourly.ev)} />
        </div>
      ),
  },
  volume: {
    title: "Volume",
    render: (s) =>
      s && (
        <div className="wg-2">
          <Big label="Tournois" value={num(s.tournaments)} />
          <Big label="Mains" value={num(s.hands)} />
          <Big label="Temps joué" value={duration(s.seconds)} />
          <Big label="Spins / h" value={num(s.spins_per_hour, 1)} />
        </div>
      ),
  },
  challenge: { title: "Challenge en cours", render: () => <ChallengeWidget /> },
  trainer: { title: "Trainer", render: () => <TrainerWidget /> },
  review: { title: "Précision en jeu", render: () => <ReviewWidget /> },
};

/** Blocs par défaut : la page fournit l'essentiel, on complète avec les chiffres utiles. */
const DEFAULTS: Record<string, Partial<Record<Side, string[]>>> = {
  dashboard: { right: ["challenge"] },
  tournaments: { right: [] },
  hands: { right: [] },
  players: { right: [] },
  ranges: { right: ["trainer", "review"] },
  leaks: { right: [] },
  challenges: { right: [] },
  import: { right: ["review"] },
  settings: { right: ["summary"] },
};

export function widgetsFor(page: string, side: Side, saved?: Record<string, Partial<Record<Side, string[]>>>): string[] {
  return saved?.[page]?.[side] ?? DEFAULTS[page]?.[side] ?? (side === "right" ? ["summary", "challenge"] : []);
}

export function SideWidgets({ page, side }: { page: string; side: Side }) {
  const { prefs, setPrefs, filter, ready } = useApp();
  const list = widgetsFor(page, side, prefs.sideWidgets);
  const [menu, setMenu] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const needSummary = list.some((w) => ["summary", "cev", "profit", "volume"].includes(w));
  const { data: s } = useQuery(["summary", filter], () => api.summary(filter), ready && needSummary);
  const save = (next: string[]) => setPrefs({ sideWidgets: { ...(prefs.sideWidgets ?? {}), [page]: { ...(prefs.sideWidgets?.[page] ?? {}), [side]: next } } });
  const available = Object.keys(WIDGETS).filter((k) => !list.includes(k));
  return (
    <div className="wgs">
      {list.map((k, i) => {
        const w = WIDGETS[k];
        if (!w) return null;
        const hidden = !!prefs.privacy[`w:${k}`] || !!prefs.privacy["__all"];
        return (
          <section
            key={k}
            className={cls("wg", drag === i && "drag")}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => {
              e.preventDefault();
              if (drag == null || drag === i) return;
              const n = [...list];
              const [x] = n.splice(drag, 1);
              n.splice(i, 0, x);
              save(n);
              setDrag(i);
            }}
            onDragEnd={() => setDrag(null)}
          >
            <header className="wg-h">
              <span>{w.title}</span>
              <div className="grow" />
              <button title={hidden ? "Afficher" : "Flouter"} onClick={() => setPrefs({ privacy: { ...prefs.privacy, [`w:${k}`]: !prefs.privacy[`w:${k}`] } })}>
                <Icon name={hidden ? "eyeoff" : "eye"} size={13} />
              </button>
              <button className="wg-x" title="Retirer ce bloc" onClick={() => save(list.filter((x) => x !== k))}>
                <Icon name="x" size={13} />
              </button>
            </header>
            <div className={cls("wg-b", hidden && "blurred")}>{w.render(s)}</div>
          </section>
        );
      })}
      {available.length > 0 && (
        <div className="wg-add">
          <button className="wg-add-b" onClick={() => setMenu(!menu)}>
            <Icon name="plus" size={14} /> Ajouter un bloc
          </button>
          {menu && (
            <div className="wg-menu">
              {available.map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    save([...list, k]);
                    setMenu(false);
                  }}
                >
                  {WIDGETS[k].title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
