export interface Theme {
  id: string;
  name: string;
  dark: boolean;
  vars: Record<string, string>;
}

const seriesDark = {
  "--s-chips": "#3ecf6d",
  "--s-sd": "#4d9bff",
  "--s-nsd": "#ff5a5f",
  "--s-ev": "#f3b13a",
  "--s-min": "#b06cf5",
  "--s-luck": "#2fd4d4",
  "--s-hu": "#f472b6",
  "--s-3max": "#a3e635",
  "--s-real": "#3ecf6d",
  "--s-realrb": "#4d9bff",
  "--s-evp": "#f3b13a",
  "--s-evm": "#c77dff",
  "--s-eve": "#ff8fab",
  "--s-rb": "#94a3b8",
};

const seriesLight = {
  "--s-chips": "#0f9d58",
  "--s-sd": "#2563eb",
  "--s-nsd": "#e0353f",
  "--s-ev": "#d08700",
  "--s-min": "#8b5cf6",
  "--s-luck": "#0e9aa7",
  "--s-hu": "#db2777",
  "--s-3max": "#65a30d",
  "--s-real": "#0f9d58",
  "--s-realrb": "#2563eb",
  "--s-evp": "#d08700",
  "--s-evm": "#8b5cf6",
  "--s-eve": "#db2777",
  "--s-rb": "#7b8794",
};

export const THEMES: Theme[] = [
  {
    id: "clair",
    name: "Lumière",
    dark: false,
    vars: {
      "--menu": "#ffffff",
      "--bg": "#f4f5f7",
      "--bg-grad": "radial-gradient(1200px 700px at 12% -10%, #ffffff 0%, transparent 60%), radial-gradient(900px 600px at 100% 0%, #eef1f6 0%, transparent 55%)",
      "--bg2": "rgba(255,255,255,0.55)",
      "--surface": "rgba(255,255,255,0.72)",
      "--surface2": "rgba(255,255,255,0.55)",
      "--surface3": "rgba(17,20,24,0.06)",
      "--border": "rgba(17,20,24,0.09)",
      "--line": "rgba(17,20,24,0.06)",
      "--text": "#14171c",
      "--muted": "#5f6672",
      "--faint": "#9aa1ac",
      "--accent": "#d9353f",
      "--accent-ink": "#ffffff",
      "--accent-soft": "rgba(217,53,63,0.12)",
      "--gold": "#b8862b",
      "--pos": "#0f9d58",
      "--neg": "#d9353f",
      "--warn": "#c2740a",
      "--felt": "#2f7a52",
      "--felt2": "#1d5539",
      "--rail": "#8a6a48",
      "--blur": "18px",
      "--shadow-1": "0 1px 2px rgba(16,20,28,0.06), 0 8px 24px rgba(16,20,28,0.06)",
      "--shadow-2": "0 20px 60px rgba(16,20,28,0.14)",
      ...seriesLight,
    },
  },
  {
    id: "nuit",
    name: "Nuit",
    dark: true,
    vars: {
      "--menu": "#17191d",
      "--bg": "#0a0b0d",
      "--bg-grad": "radial-gradient(1100px 650px at 10% -10%, rgba(255,255,255,0.06) 0%, transparent 60%), radial-gradient(900px 600px at 100% 0%, rgba(120,140,255,0.05) 0%, transparent 55%)",
      "--bg2": "rgba(255,255,255,0.03)",
      "--surface": "rgba(255,255,255,0.045)",
      "--surface2": "rgba(255,255,255,0.06)",
      "--surface3": "rgba(255,255,255,0.10)",
      "--border": "rgba(255,255,255,0.10)",
      "--line": "rgba(255,255,255,0.07)",
      "--text": "#f1f3f6",
      "--muted": "#9ba3af",
      "--faint": "#6b7380",
      "--accent": "#ff4d57",
      "--accent-ink": "#ffffff",
      "--accent-soft": "rgba(255,77,87,0.16)",
      "--gold": "#e0b355",
      "--pos": "#3ecf6d",
      "--neg": "#ff5a5f",
      "--warn": "#f0a93b",
      "--felt": "#18543a",
      "--felt2": "#0c2e20",
      "--rail": "#2c1d14",
      "--blur": "20px",
      "--shadow-1": "0 1px 2px rgba(0,0,0,0.4), 0 10px 30px rgba(0,0,0,0.35)",
      "--shadow-2": "0 24px 70px rgba(0,0,0,0.55)",
      ...seriesDark,
    },
  },
  {
    id: "brume",
    name: "Brume",
    dark: false,
    vars: {
      "--menu": "#fbfcfe",
      "--bg": "#eef1f5",
      "--bg-grad": "radial-gradient(1000px 600px at 20% -10%, #ffffff 0%, transparent 55%), radial-gradient(800px 500px at 90% 10%, #e6ecf5 0%, transparent 60%)",
      "--bg2": "rgba(255,255,255,0.5)",
      "--surface": "rgba(255,255,255,0.66)",
      "--surface2": "rgba(255,255,255,0.5)",
      "--surface3": "rgba(24,32,48,0.06)",
      "--border": "rgba(24,32,48,0.10)",
      "--line": "rgba(24,32,48,0.07)",
      "--text": "#111827",
      "--muted": "#5b6474",
      "--faint": "#98a1b2",
      "--accent": "#2f6df6",
      "--accent-ink": "#ffffff",
      "--accent-soft": "rgba(47,109,246,0.12)",
      "--gold": "#a8781f",
      "--pos": "#0f9d58",
      "--neg": "#dc2626",
      "--warn": "#b45309",
      "--felt": "#2f7a52",
      "--felt2": "#1d5539",
      "--rail": "#8a6a48",
      "--blur": "18px",
      "--shadow-1": "0 1px 2px rgba(16,24,40,0.05), 0 10px 28px rgba(16,24,40,0.07)",
      "--shadow-2": "0 24px 60px rgba(16,24,40,0.16)",
      ...seriesLight,
    },
  },
  {
    id: "tapis",
    name: "Tapis vert",
    dark: true,
    vars: {
      "--menu": "#10221a",
      "--bg": "#07130f",
      "--bg-grad": "radial-gradient(1100px 650px at 15% -10%, rgba(64,200,140,0.10) 0%, transparent 60%), radial-gradient(900px 600px at 95% 5%, rgba(255,255,255,0.03) 0%, transparent 55%)",
      "--bg2": "rgba(255,255,255,0.03)",
      "--surface": "rgba(255,255,255,0.05)",
      "--surface2": "rgba(255,255,255,0.07)",
      "--surface3": "rgba(255,255,255,0.11)",
      "--border": "rgba(160,255,210,0.12)",
      "--line": "rgba(160,255,210,0.08)",
      "--text": "#edf7f1",
      "--muted": "#9fbbad",
      "--faint": "#6c8a7c",
      "--accent": "#e3bc57",
      "--accent-ink": "#141003",
      "--accent-soft": "rgba(227,188,87,0.16)",
      "--gold": "#e3bc57",
      "--pos": "#4ade80",
      "--neg": "#f87171",
      "--warn": "#fbbf24",
      "--felt": "#1f6b47",
      "--felt2": "#0f3d28",
      "--rail": "#4a2c19",
      "--blur": "20px",
      "--shadow-1": "0 1px 2px rgba(0,0,0,0.4), 0 10px 30px rgba(0,0,0,0.3)",
      "--shadow-2": "0 24px 70px rgba(0,0,0,0.5)",
      ...seriesDark,
    },
  },
  {
    id: "vegas",
    name: "Midnight Vegas",
    dark: true,
    vars: {
      "--menu": "#131732",
      "--bg": "#070912",
      "--bg-grad": "radial-gradient(1100px 650px at 10% -10%, rgba(120,90,255,0.12) 0%, transparent 60%), radial-gradient(900px 600px at 100% 0%, rgba(255,60,150,0.10) 0%, transparent 55%)",
      "--bg2": "rgba(255,255,255,0.03)",
      "--surface": "rgba(255,255,255,0.05)",
      "--surface2": "rgba(255,255,255,0.07)",
      "--surface3": "rgba(255,255,255,0.11)",
      "--border": "rgba(160,170,255,0.14)",
      "--line": "rgba(160,170,255,0.09)",
      "--text": "#eef0ff",
      "--muted": "#9aa1c9",
      "--faint": "#6a7196",
      "--accent": "#ff3d9a",
      "--accent-ink": "#ffffff",
      "--accent-soft": "rgba(255,61,154,0.16)",
      "--gold": "#39d8e8",
      "--pos": "#39e58c",
      "--neg": "#ff5470",
      "--warn": "#ffb020",
      "--felt": "#1d2b6b",
      "--felt2": "#10183f",
      "--rail": "#2b1f47",
      "--blur": "22px",
      "--shadow-1": "0 1px 2px rgba(0,0,0,0.45), 0 10px 30px rgba(20,0,40,0.4)",
      "--shadow-2": "0 24px 70px rgba(20,0,40,0.6)",
      ...seriesDark,
    },
  },
];

/** Variables modifiables depuis l'éditeur de thème. */
export const EDITABLE_VARS: [string, string][] = [
  ["--bg", "Fond"],
  ["--surface", "Panneaux"],
  ["--menu", "Menus et fenêtres"],
  ["--border", "Bordures"],
  ["--text", "Texte"],
  ["--muted", "Texte secondaire"],
  ["--accent", "Accent"],
  ["--gold", "Or"],
  ["--pos", "Positif"],
  ["--neg", "Négatif"],
  ["--felt", "Tapis du replayer"],
];

/** "auto" suit le mode clair/sombre du système. */
export function resolveThemeId(id: string): string {
  if (id !== "auto") return id;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "nuit" : "clair";
}

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === resolveThemeId(id)) ?? THEMES[0];
}

export function applyTheme(id: string, accent?: string | null, overrides?: Record<string, string>) {
  const th = themeById(id);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(th.vars)) root.style.setProperty(k, v);
  if (accent) {
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-soft", `color-mix(in srgb, ${accent} 16%, transparent)`);
  }
  if (overrides) for (const [k, v] of Object.entries(overrides)) if (v) root.style.setProperty(k, v);
  root.dataset.theme = th.dark ? "dark" : "light";
  // menus natifs (listes déroulantes, calendriers, barres de défilement) dans le bon mode
  root.style.colorScheme = th.dark ? "dark" : "light";
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
