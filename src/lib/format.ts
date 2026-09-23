// Formatage : les horodatages du backend sont en heure locale "naïve" (secondes),
// on les lit donc avec les accesseurs UTC.

let currency = "€";
let locale = "fr-FR";

export function setFormatPrefs(cur: string, loc: string) {
  currency = cur;
  locale = loc;
}

export function nowNaive(): number {
  const d = new Date();
  return Math.floor(d.getTime() / 1000) - d.getTimezoneOffset() * 60;
}

export function todayNaive(): number {
  const n = nowNaive();
  return n - (n % 86400);
}

export function num(v: number | null | undefined, digits = 0): string {
  if (v == null || !isFinite(v)) return "–";
  return v.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function money(v: number | null | undefined, digits = 2): string {
  if (v == null || !isFinite(v)) return "–";
  const s = Math.abs(v).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${v < 0 ? "-" : ""}${s} ${currency}`;
}

export function signed(v: number, digits = 1): string {
  if (!isFinite(v)) return "–";
  return `${v > 0 ? "+" : ""}${num(v, digits)}`;
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v)) return "–";
  return `${num(v, digits)} %`;
}

export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${num(v / 1e6, 1)}M`;
  if (a >= 1e4) return `${num(v / 1e3, 1)}k`;
  return num(v, 0);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function date(ts: number, withTime = false): string {
  if (!ts) return "–";
  const d = new Date(ts * 1000);
  const s = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  return withTime ? `${s} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : s;
}

/** Date d'un vrai horodatage Unix (import, sauvegarde…), affichée à l'heure de l'ordinateur. */
export function realDate(ts: number): string {
  if (!ts) return "–";
  const d = new Date(ts * 1000);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function time(ts: number): string {
  const d = new Date(ts * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function duration(sec: number): string {
  if (!sec || sec < 0) return "0m";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m ${pad(Math.floor(sec % 60))}s`;
}

export function ago(ts: number): string {
  if (!ts) return "–";
  const d = Math.floor((nowNaive() - ts) / 86400);
  if (d <= 0) return "aujourd'hui";
  if (d === 1) return "hier";
  if (d < 30) return `il y a ${d} j`;
  if (d < 365) return `il y a ${Math.floor(d / 30)} mois`;
  return `il y a ${Math.floor(d / 365)} an(s)`;
}

export function mult(m: number): string {
  return `x${Math.abs(m - Math.round(m)) < 0.01 ? Math.round(m) : m.toFixed(1)}`;
}

export function toInputDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function fromInputDate(s: string, endOfDay = false): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000;
  return endOfDay ? t + 86399 : t;
}

export function cls(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}

export function tone(v: number): string {
  return v > 0.0000001 ? "pos" : v < -0.0000001 ? "neg" : "";
}
