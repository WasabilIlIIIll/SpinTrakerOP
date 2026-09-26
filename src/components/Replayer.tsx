import { useEffect, useMemo, useState } from "react";
import { api, type HandDetail } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { PlayingCard } from "./PlayingCard";
import { Icon } from "./Icon";
import { Help, Loading, Seg, Tags, Toggle } from "./ui";
import { cls, date, mult, num, signed, tone } from "../lib/format";
import { t } from "../lib/i18n";
import { pending } from "../lib/solver";

interface SeatState {
  stack: number;
  bet: number;
  folded: boolean;
  last?: string;
  allin: boolean;
}

interface Step {
  street: number;
  seats: SeatState[];
  pot: number;
  board: number;
  actor: number | null;
  label: string;
  showdown: boolean;
}

const STREETS = ["Préflop", "Flop", "Turn", "River"];

function actLabel(kind: string, amount: number, allin: boolean, fmt: (v: number) => string) {
  const a = allin ? " (all-in)" : "";
  switch (kind) {
    case "Fold":
      return "Fold";
    case "Check":
      return "Check";
    case "Call":
      return `Call ${fmt(amount)}${a}`;
    case "Bet":
      return `Bet ${fmt(amount)}${a}`;
    case "Raise":
      return `Raise ${fmt(amount)}${a}`;
    case "SmallBlind":
      return `SB ${fmt(amount)}`;
    case "BigBlind":
      return `BB ${fmt(amount)}`;
    case "Ante":
      return `Ante ${fmt(amount)}`;
    default:
      return kind;
  }
}

function buildSteps(h: HandDetail, fmt: (v: number) => string): Step[] {
  const n = h.seats.length;
  const seats: SeatState[] = h.seats.map((s) => ({ stack: s.stack, bet: 0, folded: false, allin: false }));
  let pot = 0;
  const steps: Step[] = [];
  const clone = () => seats.map((s) => ({ ...s }));
  let street = 0;
  const boardFor = (st: number) => (st === 0 ? 0 : st === 1 ? 3 : st === 2 ? 4 : 5);
  // posts
  const posts = h.actions.filter((a) => a.kind === "SmallBlind" || a.kind === "BigBlind" || a.kind === "Ante");
  for (const a of posts) {
    seats[a.p].stack -= a.amount;
    if (a.kind === "Ante") pot += a.amount;
    else seats[a.p].bet += a.amount;
    seats[a.p].last = actLabel(a.kind, a.amount, a.allin, fmt);
    if (a.allin) seats[a.p].allin = true;
  }
  steps.push({ street: 0, seats: clone(), pot, board: 0, actor: null, label: "Blinds postées", showdown: false });
  const collect = () => {
    for (const s of seats) {
      pot += s.bet;
      s.bet = 0;
      s.last = undefined;
    }
  };
  for (const a of h.actions) {
    if (a.kind === "SmallBlind" || a.kind === "BigBlind" || a.kind === "Ante") continue;
    if (a.street !== street) {
      collect();
      street = a.street;
      steps.push({ street, seats: clone(), pot, board: boardFor(street), actor: null, label: STREETS[street], showdown: false });
    }
    const s = seats[a.p];
    s.stack -= a.amount;
    s.bet += a.amount;
    if (a.kind === "Fold") s.folded = true;
    if (a.allin) s.allin = true;
    s.last = actLabel(a.kind, a.amount, a.allin, fmt);
    steps.push({ street, seats: clone(), pot, board: boardFor(street), actor: a.p, label: `${h.seats[a.p].name} : ${s.last}`, showdown: false });
  }
  // mise non suivie
  const bets = seats.map((s) => s.bet);
  const order = [...bets.keys()].sort((a, b) => bets[b] - bets[a]);
  if (n >= 2) {
    const unc = bets[order[0]] - bets[order[1]];
    if (unc > 0) {
      seats[order[0]].bet -= unc;
      seats[order[0]].stack += unc;
    }
  }
  collect();
  const live = seats.filter((s) => !s.folded).length;
  const boardLen = h.board.length;
  if (boardLen > boardFor(street)) {
    for (let st = street + 1; st <= 3 && boardFor(st) <= boardLen; st++) {
      steps.push({ street: st, seats: clone(), pot, board: boardFor(st), actor: null, label: `${STREETS[st]} (tapis)`, showdown: live > 1 });
    }
  }
  // résultat
  const final = h.seats.map((x, i) => ({ ...seats[i], stack: x.stack + x.net, last: x.net > 0 ? `+${fmt(x.net)}` : undefined }));
  steps.push({ street: 3, seats: final, pot: 0, board: boardLen, actor: null, label: "Résultat", showdown: live > 1 });
  return steps;
}

export function Replayer({ id, onNav }: { id: string; onNav?: (id: string) => void }) {
  const { prefs, setPrefs, open, bump, toast, go } = useApp();
  const { data: h } = useQuery(["hand", id], () => api.handDetail(id));
  const [inBB, setInBB] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const fmt = (v: number) => (inBB && h ? `${num(v / h.bb, 1)} bb` : num(v));
  const steps = useMemo(() => (h ? buildSteps(h, fmt) : []), [h, inBB]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setI(0);
    setPlaying(prefs.animations);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!playing) return;
    if (i >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const tm = window.setTimeout(() => setI((x) => Math.min(steps.length - 1, x + 1)), 850 / prefs.replaySpeed);
    return () => window.clearTimeout(tm);
  }, [playing, i, steps.length, prefs.replaySpeed]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight") setI((x) => Math.min(steps.length - 1, x + 1));
      else if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowDown" && h?.next) onNav?.(h.next);
      else if (e.key === "ArrowUp" && h?.prev) onNav?.(h.prev);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [steps.length, h, onNav]);

  if (!h) return <Loading h={420} />;
  const st = steps[Math.min(i, steps.length - 1)];
  const n = h.seats.length;
  const hero = h.hero;
  // disposition : héros en bas, puis sens horaire
  const layout = n === 2 ? ["bottom", "top"] : ["bottom", "left", "right", "topl", "topr", "top"];
  const slot = (k: number) => layout[(k - hero + n) % n];
  const reveal = st.showdown || i === steps.length - 1 || showAll;
  const heroSeat = h.seats[hero];
  const allin = h.allin_street != null;
  return (
    <div className="rp">
      <div className="rp-head">
        <div className="rp-title">
          <b>
            {h.tournament.name} · {mult(h.tournament.multiplier)}
          </b>
          <span className="muted">
            Main {h.index}/{h.count} · {date(h.ts, true)} · blinds {num(h.sb)}/{num(h.bb)} · tapis eff. {num(h.eff_bb, 1)} bb
          </span>
        </div>
        <div className="row gap8">
          <button
            className={cls("star", h.fav && "on")}
            title={h.fav ? "Retirer des favoris" : "Ajouter aux favoris (onglet Review)"}
            onClick={async () => {
              await api.setFavorite(h.id, !h.fav);
              bump();
              toast(h.fav ? "Retirée des favoris" : "Main ajoutée aux favoris");
            }}
          >
            <Icon name="star" size={16} fill={h.fav} />
          </button>
          <Toggle on={inBB} onChange={setInBB} label="en BB" />
          <Toggle on={showAll} onChange={setShowAll} label="Cartes visibles" />
          {h.board.length >= 3 && (
            <button
              className="btn btn-soft btn-sm"
              title="Ouvrir le spot postflop de cette main dans le Solver"
              onClick={() => {
                pending.handId = h.id;
                open(null);
                go("solver");
              }}
            >
              <Icon name="zap" size={13} /> Solver la main
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => open({ type: "tournament", id: h.tid })}>
            <Icon name="trophy" size={13} /> Tournoi
          </button>
        </div>
      </div>
      <div className="rp-table-wrap">
        <div className="rp-table">
          <div className="rp-felt">
            <div className="rp-logo">
              <Icon name="spade" size={22} /> SPIN TRACKER OP
            </div>
            <div className="rp-board">
              {[0, 1, 2, 3, 4].map((k) => (
                <span key={k} className={cls("rp-bc", k < st.board && "in")}>
                  {k < st.board ? <PlayingCard card={h.board[k]} size="md" /> : <span className="pc pc-md pc-slot" />}
                </span>
              ))}
            </div>
            <div className="rp-pot">
              {st.pot > 0 && (
                <>
                  <span className="chipstack" /> Pot {fmt(st.pot)}
                </>
              )}
            </div>
            <div className="rp-street">{st.label}</div>
          </div>
          {h.seats.map((s, k) => {
            const ss = st.seats[k];
            const showCards = k === hero || (reveal && s.cards) || (showAll && s.cards);
            return (
              <div key={k} className={cls("rp-seat", `slot-${slot(k)}`, ss.folded && "folded", st.actor === k && "acting")}>
                <div className="rp-cards">
                  {s.cards && showCards ? (
                    <>
                      <PlayingCard card={s.cards[0]} size="lg" dim={ss.folded} />
                      <PlayingCard card={s.cards[1]} size="lg" dim={ss.folded} />
                    </>
                  ) : !ss.folded ? (
                    <>
                      <PlayingCard back size="lg" />
                      <PlayingCard back size="lg" />
                    </>
                  ) : null}
                </div>
                <div className="rp-plate">
                  <div className="rp-name">
                    {k === h.button && <span className="dealer">D</span>}
                    <button className="linkish" onClick={() => k !== hero && open({ type: "player", name: s.name })}>
                      {s.name}
                    </button>
                    <Tags ids={s.tags} small />
                  </div>
                  <div className="rp-stack">
                    <span className="rp-pos">{s.pos}</span>
                    {ss.allin && ss.stack <= 0 ? <b className="allin">ALL-IN</b> : fmt(Math.max(0, ss.stack))}
                  </div>
                  {i === steps.length - 1 && s.equity != null && <div className="rp-eq">Équité {num(s.equity * 100, 1)} %</div>}
                </div>
                {ss.bet > 0 && (
                  <div className="rp-bet">
                    <span className="chip-ic" />
                    {fmt(ss.bet)}
                  </div>
                )}
                {ss.last && <div className={cls("rp-act", ss.last.startsWith("Fold") && "fold", ss.last.startsWith("+") && "win")}>{ss.last}</div>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="rp-controls">
        <button className="icon-btn" disabled={!h.prev} onClick={() => h.prev && onNav?.(h.prev)} title="Main précédente (↑)">
          <Icon name="skipb" />
        </button>
        <button className="icon-btn" onClick={() => setI(Math.max(0, i - 1))} title="Étape précédente (←)">
          <Icon name="chevronl" />
        </button>
        <button className="icon-btn big" onClick={() => (i >= steps.length - 1 ? (setI(0), setPlaying(true)) : setPlaying(!playing))} title="Lecture / pause (espace)">
          <Icon name={playing ? "pause" : "play"} size={18} />
        </button>
        <button className="icon-btn" onClick={() => setI(Math.min(steps.length - 1, i + 1))} title="Étape suivante (→)">
          <Icon name="chevronr" />
        </button>
        <button className="icon-btn" disabled={!h.next} onClick={() => h.next && onNav?.(h.next)} title="Main suivante (↓)">
          <Icon name="skipf" />
        </button>
        <input type="range" min={0} max={steps.length - 1} value={i} onChange={(e) => setI(+e.target.value)} className="rp-range" />
        <Seg
          small
          value={String(prefs.replaySpeed)}
          onChange={(v) => setPrefs({ replaySpeed: +v })}
          options={[
            { v: "0.5", l: "0.5x" },
            { v: "1", l: "1x" },
            { v: "2", l: "2x" },
            { v: "4", l: "4x" },
          ]}
        />
      </div>
      <div className="rp-summary">
        <div>
          <span className="muted">Résultat réel</span>
          <b className={tone(heroSeat.net)}>{signed(heroSeat.net, 0)} chips</b>
        </div>
        <div>
          <span className="muted">
            CEV de la main <Help text="Jetons gagnés en tenant compte de l'équité au moment du tapis (all-in ajusté). Identique au résultat réel s'il n'y a pas eu de tapis avant la river. C'est bien une valeur en JETONS, pas en euros." />
          </span>
          <b className={tone(heroSeat.ev)}>{signed(heroSeat.ev, 0)} chips</b>
        </div>
        {allin && (
          <div>
            <span className="muted">
              Écart réel − CEV <Help text="Positif : vous avez gagné plus de jetons que votre espérance sur ce tapis. Négatif : moins." />
            </span>
            <b className={tone(heroSeat.net - heroSeat.ev)}>{signed(heroSeat.net - heroSeat.ev, 0)}</b>
          </div>
        )}
        {heroSeat.equity != null && (
          <div>
            <span className="muted">Équité au tapis</span>
            <b>{num(heroSeat.equity * 100, 1)} %</b>
          </div>
        )}
        <div>
          <span className="muted">Pot</span>
          <b>{fmt(h.pot)}</b>
        </div>
      </div>
      <div className="rp-log">
        {steps.map((s, k) =>
          k === 0 ? null : (
            <button key={k} className={cls("rp-log-i", k === i && "on", s.actor === null && "street")} onClick={() => setI(k)}>
              {s.label}
            </button>
          ),
        )}
      </div>
      <div className="muted small">{t("Raccourcis")} : ← → étapes · espace lecture · ↑ ↓ main précédente / suivante</div>
    </div>
  );
}
