import { useMemo, useState } from "react";
import { api, type Challenge, type ChallengeView } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { Btn, Empty, Loading, Modal, NumInput, Priv, Stat, Toggle } from "../components/ui";
import { Icon } from "../components/Icon";
import { cls, date, duration, money, num, nowNaive, pct, todayNaive, toInputDate, fromInputDate, tone } from "../lib/format";

const KINDS: [string, string, string][] = [
  ["spins", "Volume (spins)", "layers"],
  ["hands", "Mains jouées", "cards"],
  ["hours", "Heures de jeu", "clock"],
  ["ev_profit", "EV Profit (€)", "chart"],
  ["profit", "Profit réel (€)", "wallet"],
  ["rakeback", "Rakeback (€)", "star"],
  ["cev", "CEV moyen", "target"],
  ["bankroll", "Objectif bankroll (€)", "trophy"],
];

const DURATIONS: [string, number][] = [
  ["1 semaine", 7],
  ["2 semaines", 14],
  ["1 mois", 30],
  ["2 mois", 61],
  ["3 mois", 91],
  ["4 mois", 122],
  ["6 mois", 183],
  ["1 an", 365],
];

function fmtValue(kind: string, v: number) {
  if (kind === "spins" || kind === "hands") return num(v);
  if (kind === "hours") return `${num(v, 1)} h`;
  if (kind === "cev") return num(v, 1);
  return money(v);
}

export function Challenges() {
  const { toast, bump, overview } = useApp();
  const now = nowNaive();
  const { data, loading } = useQuery(["challenges", Math.floor(now / 600)], () => api.challenges(now));
  const [edit, setEdit] = useState<Challenge | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const list = data ?? [];
  const open = list.find((c) => c.challenge.id === openId);
  const newChallenge = (): Challenge => ({
    name: "Nouveau challenge",
    kind: "spins",
    target: 1000,
    min_spins: 0,
    start: todayNaive(),
    end: todayNaive() + 30 * 86400 - 1,
    filter: {},
    color: "#d4a53c",
    abandoned: false,
  });
  return (
    <div className="page">
      <div className="page-head">
        <h2>Challenges</h2>
        <Btn kind="primary" icon="plus" onClick={() => setEdit(newChallenge())}>
          Nouveau challenge
        </Btn>
      </div>
      {loading && !data ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty
          title="Aucun challenge"
          sub="Fixez-vous un objectif de volume, d'heures, de profit ou de CEV sur une période donnée."
          icon="flag"
          action={
            <Btn kind="primary" icon="plus" onClick={() => setEdit(newChallenge())}>
              Créer mon premier challenge
            </Btn>
          }
        />
      ) : (
        <div className="ch-grid">
          {list.map((c) => (
            <ChallengeCard key={c.challenge.id} c={c} onOpen={() => setOpenId(c.challenge.id!)} />
          ))}
        </div>
      )}
      {open && (
        <ChallengeModal
          c={open}
          onClose={() => setOpenId(null)}
          onEdit={() => {
            setEdit(open.challenge);
            setOpenId(null);
          }}
          onAbandon={async () => {
            await api.saveChallenge({ ...open.challenge, abandoned: !open.challenge.abandoned });
            bump();
            setOpenId(null);
          }}
          onDelete={async () => {
            if (open.challenge.id && window.confirm("Supprimer ce challenge ?")) {
              await api.deleteChallenge(open.challenge.id);
              bump();
              setOpenId(null);
              toast("Challenge supprimé");
            }
          }}
        />
      )}
      {edit && (
        <ChallengeEditor
          c={edit}
          buyins={overview?.buyins ?? []}
          onClose={() => setEdit(null)}
          onSave={async (c) => {
            await api.saveChallenge(c);
            bump();
            setEdit(null);
            toast("Challenge enregistré");
          }}
        />
      )}
    </div>
  );
}

const STATUS: Record<string, [string, string]> = {
  en_cours: ["En cours", "warn"],
  reussi: ["Réussi", "pos"],
  echoue: ["Échoué", "neg"],
  abandonne: ["Abandonné", "muted"],
  a_venir: ["À venir", "muted"],
};

function ChallengeCard({ c, onOpen }: { c: ChallengeView; onOpen: () => void }) {
  const k = KINDS.find((x) => x[0] === c.challenge.kind);
  const [label, tn] = STATUS[c.status];
  return (
    <button className="ch-card" onClick={onOpen} style={{ ["--ch" as string]: c.challenge.color }}>
      <div className="ch-top">
        <span className="ch-kind">
          <Icon name={k?.[2] ?? "flag"} size={14} /> {k?.[1]}
        </span>
        <span className={cls("ch-status", tn)}>{label}</span>
      </div>
      <div className="ch-name">{c.challenge.name}</div>
      <div className="ch-val">
        <b>
          <Priv k="profit">{fmtValue(c.challenge.kind, c.value)}</Priv>
        </b>
        <span> / {fmtValue(c.challenge.kind, c.challenge.target)}</span>
        <i>{pct(c.progress * 100, 0)}</i>
      </div>
      <div className="ch-bar">
        <span style={{ width: `${Math.min(100, c.progress * 100)}%` }} />
      </div>
      <div className="ch-foot">
        <span>
          {date(c.challenge.start)} → {date(c.challenge.end)}
        </span>
        {c.status === "en_cours" && <span>{num(Math.ceil(c.days_left))} j restants</span>}
      </div>
    </button>
  );
}

function ChallengeModal({ c, onClose, onEdit, onAbandon, onDelete }: { c: ChallengeView; onClose: () => void; onEdit: () => void; onAbandon: () => void; onDelete: () => void }) {
  const s = c.summary;
  const left = Math.max(0, c.challenge.end - nowNaive());
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const [label, tn] = STATUS[c.status];
  return (
    <Modal
      wide="xl"
      onClose={onClose}
      title={
        <div className="row gap8">
          <b>{c.challenge.name}</b>
          <span className="ch-kind">
            <Icon name={KINDS.find((x) => x[0] === c.challenge.kind)?.[2] ?? "flag"} size={13} /> {KINDS.find((x) => x[0] === c.challenge.kind)?.[1]}
          </span>
          <span className={cls("ch-status", tn)}>{label}</span>
        </div>
      }
      right={
        c.status === "en_cours" && (
          <div className="countdown">
            <span>
              <b>{d}</b>jours
            </span>
            <span>
              <b>{String(h).padStart(2, "0")}</b>heures
            </span>
            <span>
              <b>{String(m).padStart(2, "0")}</b>min
            </span>
          </div>
        )
      }
    >
      <div className="col gap16">
        <div>
          <div className="ch-val big">
            <b>
              <Priv k="profit">{fmtValue(c.challenge.kind, c.value)}</Priv>
            </b>
            <span> / {fmtValue(c.challenge.kind, c.challenge.target)}</span>
            <i>{pct(c.progress * 100, 0)}</i>
          </div>
          <div className="ch-bar lg" style={{ ["--ch" as string]: c.challenge.color }}>
            <span style={{ width: `${Math.min(100, c.progress * 100)}%` }} />
          </div>
        </div>
        <div className="tiles tiles-8">
          <Stat label="Tournois" value={num(s.tournaments)} />
          <Stat label="Buy-in moyen" value={money(s.avg_buyin)} />
          <Stat label={<><i className="evdot" />EV Profit</>} value={money(s.profit.ev)} tone={tone(s.profit.ev)} k="profit" />
          <Stat label="Rakeback" value={money(s.rakeback)} k="profit" />
          <Stat label="CEV" value={num(s.cev, 1)} tone={tone(s.cev)} />
          <Stat label={<><i className="evdot" />ROI EV</>} value={pct(s.roi.ev)} tone={tone(s.roi.ev)} k="profit" />
          <Stat label={<><i className="evdot" />EV /heure</>} value={money(s.hourly.ev)} tone={tone(s.hourly.ev)} k="profit" />
          <Stat label="Temps joué" value={duration(s.seconds)} />
        </div>
        <DailyBars c={c} />
        <div className="row gap8">
          <span className="muted small">
            Rythme requis : {fmtValue(c.challenge.kind, c.required_per_day)} / jour
            {c.status === "en_cours" && ` · restant : ${fmtValue(c.challenge.kind, c.remaining_per_day)} / jour`}
          </span>
          <div className="grow" />
          <Btn small icon="edit" onClick={onEdit}>
            Modifier
          </Btn>
          <Btn small onClick={onAbandon}>
            {c.challenge.abandoned ? "Reprendre" : "Abandonner"}
          </Btn>
          <Btn small kind="danger" icon="trash" onClick={onDelete}>
            Supprimer
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function DailyBars({ c }: { c: ChallengeView }) {
  const data = c.daily;
  const cum = c.challenge.kind !== "cev";
  const max = useMemo(() => Math.max(c.required_per_day, ...data.map((d) => d.value)) * 1.15 || 1, [data, c.required_per_day]);
  const w = Math.max(600, data.length * 26);
  const h = 230;
  const pad = 26;
  return (
    <div className="dbars">
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {cum && (
          <>
            <line x1={0} x2={w} y1={pad} y2={pad} className="db-goal" />
          </>
        )}
        {data.map((d, i) => {
          const bw = w / data.length;
          const bh = Math.max(0, ((h - pad - 22) * Math.abs(d.value)) / max);
          return (
            <g key={d.day}>
              <rect x={i * bw + bw * 0.15} y={h - 22 - bh} width={bw * 0.7} height={bh} rx={3} fill={d.value >= 0 ? "var(--pos)" : "var(--neg)"} opacity={0.9}>
                <title>
                  {date(d.day * 86400)} : {fmtValue(c.challenge.kind, d.value)}
                </title>
              </rect>
              {d.value > 0 && bw > 18 && (
                <text x={i * bw + bw / 2} y={h - 26 - bh} textAnchor="middle" className="db-val">
                  {fmtValue(c.challenge.kind, d.value)}
                </text>
              )}
              {i % Math.ceil(data.length / 14) === 0 && (
                <text x={i * bw + bw / 2} y={h - 6} textAnchor="middle" className="db-x">
                  {date(d.day * 86400).slice(0, 5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {cum && <div className="db-legend">Rythme requis : {fmtValue(c.challenge.kind, c.required_per_day)} / jour</div>}
    </div>
  );
}

function ChallengeEditor({ c, onClose, onSave, buyins }: { c: Challenge; onClose: () => void; onSave: (c: Challenge) => void; buyins: number[] }) {
  const [x, setX] = useState<Challenge>(c);
  const days = Math.round((x.end - x.start) / 86400) + 1;
  return (
    <Modal title={x.id ? "Modifier le challenge" : "Nouveau challenge"} onClose={onClose} wide>
      <div className="col gap12">
        <label className="field">
          Nom
          <input className="inp" value={x.name} onChange={(e) => setX({ ...x, name: e.target.value })} />
        </label>
        <div className="field">
          Type d'objectif
          <div className="fchips">
            {KINDS.map(([k, l, ic]) => (
              <button key={k} className={cls("fchip", x.kind === k && "on")} onClick={() => setX({ ...x, kind: k })}>
                <Icon name={ic} size={13} /> {l}
              </button>
            ))}
          </div>
        </div>
        <div className="row gap12 wrap">
          <label className="field">
            Objectif
            <NumInput value={x.target} onChange={(v) => setX({ ...x, target: v })} width={120} />
          </label>
          {x.kind === "cev" && (
            <label className="field">
              Spins minimum
              <NumInput value={x.min_spins} onChange={(v) => setX({ ...x, min_spins: v })} width={100} />
            </label>
          )}
          <label className="field">
            Couleur
            <input type="color" value={x.color} onChange={(e) => setX({ ...x, color: e.target.value })} />
          </label>
        </div>
        <div className="field">
          Durée
          <div className="fchips">
            {DURATIONS.map(([l, d]) => (
              <button key={l} className={cls("fchip", days === d && "on")} onClick={() => setX({ ...x, end: x.start + d * 86400 - 1 })}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="row gap12">
          <label className="field">
            Début
            <input className="inp" type="date" value={toInputDate(x.start)} onChange={(e) => setX({ ...x, start: fromInputDate(e.target.value) ?? x.start })} />
          </label>
          <label className="field">
            Fin
            <input className="inp" type="date" value={toInputDate(x.end)} onChange={(e) => setX({ ...x, end: fromInputDate(e.target.value, true) ?? x.end })} />
          </label>
          <span className="muted small" style={{ alignSelf: "flex-end" }}>
            {days} jours · {fmtValue(x.kind, x.target / days)} / jour
          </span>
        </div>
        {buyins.length > 1 && (
          <div className="field">
            Buy-ins comptabilisés
            <div className="fchips">
              {buyins.map((b) => (
                <button
                  key={b}
                  className={cls("fchip", (x.filter.buyins ?? []).includes(b) && "on")}
                  onClick={() => {
                    const cur = x.filter.buyins ?? [];
                    setX({ ...x, filter: { ...x.filter, buyins: cur.includes(b) ? cur.filter((y) => y !== b) : [...cur, b] } });
                  }}
                >
                  {b} €
                </button>
              ))}
            </div>
          </div>
        )}
        <Toggle on={!x.abandoned} onChange={(v) => setX({ ...x, abandoned: !v })} label="Challenge actif" />
        <div className="row gap8" style={{ justifyContent: "flex-end" }}>
          <Btn onClick={onClose}>Annuler</Btn>
          <Btn kind="primary" onClick={() => onSave(x)}>
            Enregistrer
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
