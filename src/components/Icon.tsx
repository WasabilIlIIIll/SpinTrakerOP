// Jeu d'icônes minimal (traits 24x24) pour éviter toute dépendance.
const P: Record<string, string> = {
  dashboard: "M3 13h8V3H3zM13 21h8v-8h-8zM13 3v8h8V3zM3 21h8v-6H3z",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3",
  cards: "M4 5.5 12.5 3l3.2 12L7.2 17.3zM15 6.5l4.5 1.2-3.2 12L9.5 18",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  flag: "M4 22V4M4 4h13l-2 4 2 4H4",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeoff: "M9.9 4.2A9.8 9.8 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.4-1.6M2 2l20 20M14.1 14.1a3 3 0 1 1-4.2-4.2",
  filter: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  x: "M18 6 6 18M6 6l12 12",
  chevron: "m6 9 6 6 6-6",
  chevronr: "m9 18 6-6-6-6",
  chevronl: "m15 18-6-6 6-6",
  play: "M6 4l14 8-14 8z",
  pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  skipb: "M19 20 9 12l10-8zM5 19V5",
  skipf: "m5 4 10 8-10 8zM19 5v14",
  plus: "M12 5v14M5 12h14",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  calendar: "M3 5h18v16H3zM16 3v4M8 3v4M3 10h18",
  target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  file: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6",
  thumbup: "M7 10v11M15 5.9 14 10h5.8a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 18.5 21H7V10l4-8a3 3 0 0 1 4 3.9zM3 10h4v11H3z",
  thumbdown: "M17 14V3M9 18.1 10 14H4.2a2 2 0 0 1-2-2.3l1.4-7A2 2 0 0 1 5.5 3H17v11l-4 8a3 3 0 0 1-4-3.9zM21 14h-4V3h4z",
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
  chart: "M3 3v18h18M7 15l4-4 3 3 6-7",
  bars: "M3 21h18M6 17V9M11 17V5M16 17v-6M21 17v-9",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  crown: "m2 7 5 4 5-7 5 7 5-4-2 12H4zM4 21h16",
  fish: "M6.5 12c3-5 8-6 12.5-4-1 1.5-1 2.5 0 4-4.5 2-9.5 1-12.5-4M6.5 12 2 8v8zM16 11h.01",
  flame: "M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 3-5 5-5 8 0 4 3 7 7 7z",
  star: "m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  skull: "M12 3a8 8 0 0 0-8 8c0 2.5 1.2 4.4 3 5.6V20h10v-3.4c1.8-1.2 3-3.1 3-5.6a8 8 0 0 0-8-8zM9 12h.01M15 12h.01M10 20v-2M14 20v-2",
  zap: "M13 2 3 14h9l-1 8 10-12h-9z",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  menu: "M3 6h18M3 12h18M3 18h18",
  grip: "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01",
  refresh: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  check: "M20 6 9 17l-5-5",
  spade: "M12 2C9 6 4 9 4 13a4 4 0 0 0 7 2.6c-.3 2-1.2 3.6-2.8 5.4h7.6c-1.6-1.8-2.5-3.4-2.8-5.4A4 4 0 0 0 20 13c0-4-5-7-8-11z",
  heart: "M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z",
  diamond: "M12 2 20 12 12 22 4 12z",
  club: "M12 2a4 4 0 0 0-3.5 6A4 4 0 1 0 11 15c-.3 2.3-1.2 4-2.8 6h7.6c-1.6-2-2.5-3.7-2.8-6a4 4 0 1 0 2.5-7A4 4 0 0 0 12 2z",
  layers: "m12 2 10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5",
  wallet: "M20 12V8H6a2 2 0 0 1 0-4h12v4M4 6v12a2 2 0 0 0 2 2h14v-4M18 12a2 2 0 0 0 0 4h4v-4z",
};

export const TAG_ICONS = ["crown", "fish", "flame", "star", "shield", "skull", "zap", "target", "spade", "heart", "diamond", "club"];

export function Icon({ name, size = 16, className, fill }: { name: string; size?: number; className?: string; fill?: boolean }) {
  const d = P[name] ?? P.info;
  const solid = fill || ["spade", "heart", "diamond", "club", "play"].includes(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? "currentColor" : "none"}
      stroke={solid ? "none" : "currentColor"}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}
