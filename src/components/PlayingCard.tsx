import { useApp } from "../lib/state";
import { cls } from "../lib/format";

const SUIT: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

export function PlayingCard({ card, size = "md", back, dim }: { card?: string | null; size?: "xs" | "sm" | "md" | "lg"; back?: boolean; dim?: boolean }) {
  const { prefs } = useApp();
  if (back || !card) {
    return <span className={cls("pc", `pc-${size}`, "pc-back")} />;
  }
  const r = card[0] === "T" ? "10" : card[0];
  const s = card[1];
  return (
    <span className={cls("pc", `pc-${size}`, `pc-${s}`, prefs.fourColor ? "four" : "two", dim && "pc-dim")}>
      <span className="pc-r">{r}</span>
      <span className="pc-s">{SUIT[s]}</span>
    </span>
  );
}

export function Cards({ cards, size = "sm" }: { cards: (string | null)[] | null | undefined; size?: "xs" | "sm" | "md" | "lg" }) {
  if (!cards || cards.length === 0) return <span className="muted">–</span>;
  return (
    <span className="cards">
      {cards.map((c, i) => (
        <PlayingCard key={i} card={c} size={size} />
      ))}
    </span>
  );
}
