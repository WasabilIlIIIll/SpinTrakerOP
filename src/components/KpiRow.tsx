import { useState, type ReactNode } from "react";
import { ALL_KPIS, useApp } from "../lib/state";
import type { Summary } from "../lib/api";
import { cls, duration, money, num, pct, tone } from "../lib/format";
import { Icon } from "./Icon";
import { Modal, Btn } from "./ui";
import { t } from "../lib/i18n";

interface Mode {
  label: string;
  value: ReactNode;
  tone?: string;
  ev?: boolean;
  sub?: ReactNode;
}

export function luckLabel(z: number): { label: string; sub: string; tone: string; icon: string } {
  if (z <= -2) return { label: t("Très malchanceux"), sub: "Run très bad (z " + num(z, 1) + ")", tone: "neg", icon: "thumbdown" };
  if (z <= -1) return { label: t("Malchanceux"), sub: "Sous l'EV (z " + num(z, 1) + ")", tone: "neg", icon: "thumbdown" };
  if (z < 1) return { label: t("Neutre"), sub: "Chance normale (z " + num(z, 1) + ")", tone: "", icon: "thumbup" };
  if (z < 2) return { label: t("Chanceux"), sub: "Au-dessus de l'EV (z " + num(z, 1) + ")", tone: "pos", icon: "thumbup" };
  return { label: t("Très chanceux"), sub: "Run very good (z " + num(z, 1) + ")", tone: "pos", icon: "sparkle" };
}

function modesFor(k: string, s: Summary): { title: string; modes: Mode[] } {
  switch (k) {
    case "tournaments":
      return {
        title: t("Tournois"),
        modes: [
          { label: t("Tournois"), value: num(s.tournaments) },
          { label: t("Mains"), value: num(s.hands) },
          { label: "Mains / spin", value: num(s.hands_per_spin, 1) },
        ],
      };
    case "cev":
      return {
        title: "CEV",
        modes: [
          { label: "CEV", value: num(s.cev, 1), tone: tone(s.cev), sub: `± ${num(s.cev_ci, 0)} (IC 95 %)` },
          { label: "CEV / main", value: num(s.cev_hand, 2), tone: tone(s.cev_hand) },
          { label: "Chips réels / spin", value: num(s.chips_avg, 1), tone: tone(s.chips_avg) },
        ],
      };
    case "rakeback":
      return {
        title: t("Rakeback"),
        modes: [
          { label: t("Rakeback"), value: money(s.rakeback) },
          { label: "Buy-ins totaux", value: money(s.buyins) },
        ],
      };
    case "profit":
      return {
        title: "Profit",
        modes: [
          { label: t("EV Profit"), value: money(s.profit.ev), tone: tone(s.profit.ev), ev: true },
          { label: t("EV Multi-profit"), value: money(s.profit.ev_multi), tone: tone(s.profit.ev_multi), ev: true },
          { label: t("EV Profit effectif"), value: money(s.profit.ev_eff), tone: tone(s.profit.ev_eff), ev: true },
          { label: t("Profit réel + RB"), value: money(s.profit.real_rb), tone: tone(s.profit.real_rb) },
          { label: t("Profit réel"), value: money(s.profit.real), tone: tone(s.profit.real) },
        ],
      };
    case "roi":
      return {
        title: "ROI",
        modes: [
          { label: "ROI EV Profit", value: pct(s.roi.ev), tone: tone(s.roi.ev), ev: true },
          { label: "ROI EV Multi", value: pct(s.roi.ev_multi), tone: tone(s.roi.ev_multi), ev: true },
          { label: "ROI EV effectif", value: pct(s.roi.ev_eff), tone: tone(s.roi.ev_eff), ev: true },
          { label: "ROI réel + RB", value: pct(s.roi.real_rb), tone: tone(s.roi.real_rb) },
        ],
      };
    case "hourly":
      return {
        title: "Gain / heure",
        modes: [
          { label: "EV Profit / h", value: money(s.hourly.ev), tone: tone(s.hourly.ev), ev: true },
          { label: "EV Multi / h", value: money(s.hourly.ev_multi), tone: tone(s.hourly.ev_multi), ev: true },
          { label: "EV effectif / h", value: money(s.hourly.ev_eff), tone: tone(s.hourly.ev_eff), ev: true },
          { label: "Réel + RB / h", value: money(s.hourly.real_rb), tone: tone(s.hourly.real_rb) },
        ],
      };
    case "time":
      return {
        title: t("Temps joué"),
        modes: [
          { label: t("Temps joué"), value: duration(s.seconds) },
          { label: "Durée moy. d'un spin", value: duration(s.avg_duration) },
          { label: "Tables moyennes", value: num(s.avg_tables, 2) },
        ],
      };
    case "luck": {
      const l = luckLabel(s.luck_z);
      return { title: "Chance", modes: [{ label: "Chance all-in", value: l.label, tone: l.tone, sub: `${num(s.luck_chips, 0)} chips vs EV` }] };
    }
    case "finish":
      return {
        title: "Victoires",
        modes: [
          { label: "% 1er", value: pct(s.finish[0]), sub: `attendu ${pct(s.finish_expected[0])}`, tone: tone(s.finish[0] - s.finish_expected[0]) },
          { label: "Multiplicateur moyen", value: `x${num(s.avg_mult, 2)}`, sub: `attendu x${num(s.expected_mult, 2)}`, tone: tone(s.avg_mult - s.expected_mult) },
        ],
      };
    case "avg_buyin":
      return { title: t("Buy-in moyen"), modes: [{ label: t("Buy-in moyen"), value: money(s.avg_buyin) }] };
    case "spins_h":
      return { title: t("Spins/h"), modes: [{ label: t("Spins/h"), value: num(s.spins_per_hour, 1) }] };
    case "min_cev":
      return { title: "CEV minimum", modes: [{ label: "CEV break-even", value: num(s.min_cev, 1), sub: "rakeback inclus" }] };
    default:
      return { title: k, modes: [{ label: k, value: "–" }] };
  }
}

export const KPI_NAMES: Record<string, string> = {
  tournaments: "Tournois / mains",
  cev: "CEV",
  rakeback: "Rakeback",
  profit: "Profit (EV / réel)",
  roi: "ROI",
  hourly: "Gain / heure",
  time: "Temps joué",
  luck: "Chance",
  finish: "Victoires / multiplicateurs",
  avg_buyin: "Buy-in moyen",
  spins_h: "Spins / heure",
  min_cev: "CEV minimum",
};

export function KpiRow({ s, compact: small }: { s: Summary | undefined; compact?: boolean }) {
  const { prefs, setPrefs } = useApp();
  const [edit, setEdit] = useState(false);
  return (
    <div className={cls("kpis", small && "kpis-sm")}>
      {prefs.kpis.map((k) => {
        const { modes } = s ? modesFor(k, s) : { modes: [{ label: KPI_NAMES[k], value: "–" }] as Mode[] };
        const mi = (prefs.kpiModes[k] ?? 0) % modes.length;
        const m = modes[mi];
        const hidden = prefs.privacy[k] || prefs.privacy["__all"];
        return (
          <div
            key={k}
            className={cls("kpi", modes.length > 1 && "clickable")}
            onClick={() => modes.length > 1 && setPrefs({ kpiModes: { ...prefs.kpiModes, [k]: mi + 1 } })}
            title={modes.length > 1 ? "Cliquer pour changer d'indicateur" : undefined}
          >
            <button
              className="kpi-eye"
              onClick={(e) => {
                e.stopPropagation();
                setPrefs({ privacy: { ...prefs.privacy, [k]: !prefs.privacy[k] } });
              }}
              title="Flouter"
            >
              <Icon name={hidden ? "eyeoff" : "eye"} size={13} />
            </button>
            <div className="kpi-l">
              {m.ev && <i className="evdot" />}
              {m.label}
            </div>
            <div className={cls("kpi-v", m.tone, hidden && "blurred")}>{m.value}</div>
            {m.sub && <div className={cls("kpi-s", hidden && "blurred")}>{m.sub}</div>}
            {modes.length > 1 && (
              <div className="kpi-dots">
                {modes.map((_, i) => (
                  <i key={i} className={cls(i === mi && "on")} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {!small && (
        <button className="kpi-add" onClick={() => setEdit(true)} title="Personnaliser les indicateurs">
          <Icon name="settings" size={15} />
        </button>
      )}
      {edit && <KpiEditor onClose={() => setEdit(false)} />}
    </div>
  );
}

function KpiEditor({ onClose }: { onClose: () => void }) {
  const { prefs, setPrefs } = useApp();
  const [list, setList] = useState(prefs.kpis);
  const [drag, setDrag] = useState<number | null>(null);
  const hidden = ALL_KPIS.filter((k) => !list.includes(k));
  return (
    <Modal title="Indicateurs du tableau de bord" onClose={onClose}>
      <p className="muted small">Glissez pour réordonner. Cliquez sur un indicateur dans le tableau de bord pour faire défiler ses variantes.</p>
      <div className="kpi-edit">
        {list.map((k, i) => (
          <div
            key={k}
            className={cls("kpi-edit-row", drag === i && "drag")}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => {
              e.preventDefault();
              if (drag == null || drag === i) return;
              const n = [...list];
              const [x] = n.splice(drag, 1);
              n.splice(i, 0, x);
              setList(n);
              setDrag(i);
            }}
            onDragEnd={() => setDrag(null)}
          >
            <Icon name="grip" />
            <span>{KPI_NAMES[k]}</span>
            <button className="icon-btn" onClick={() => setList(list.filter((x) => x !== k))}>
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
      </div>
      {hidden.length > 0 && (
        <>
          <div className="fsec-t" style={{ marginTop: 14 }}>
            Ajouter
          </div>
          <div className="fchips">
            {hidden.map((k) => (
              <button key={k} className="fchip" onClick={() => setList([...list, k])}>
                <Icon name="plus" size={11} /> {KPI_NAMES[k]}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="row gap8" style={{ justifyContent: "flex-end", marginTop: 18 }}>
        <Btn onClick={onClose}>{t("Annuler")}</Btn>
        <Btn
          kind="primary"
          onClick={() => {
            setPrefs({ kpis: list });
            onClose();
          }}
        >
          {t("Enregistrer")}
        </Btn>
      </div>
    </Modal>
  );
}
