import { useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api, type MultTable, type Settings as S } from "../lib/api";
import { ALL_STATS_SECTIONS, useApp, DEFAULT_PREFS, clearCache } from "../lib/state";
import { Btn, NumInput, Panel, Seg, Toggle, Modal } from "../components/ui";
import { THEMES, EDITABLE_VARS, themeById } from "../lib/themes";
import { Icon } from "../components/Icon";
import { cls, date, money, num, nowNaive } from "../lib/format";
import { CHIP_SERIES } from "./ChipsTab";
import { BR_SERIES } from "./BankrollTab";

/** rgba()/couleur nommée -> #rrggbb pour l'input color */
function toHex(c: string): string {
  if (c.startsWith("#")) return c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c.slice(0, 7);
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(",").map((x) => Math.round(parseFloat(x)));
    return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v || 0)).toString(16).padStart(2, "0")).join("")}`;
  }
  return "#888888";
}

const SECTION_NAMES: Record<string, string> = {
  tiles: "Tuiles de synthèse",
  position: "CEV par position",
  sessions: "Sessions",
  results: "Résultats groupés",
  profile: "CEV par profil de table",
  multitabling: "Multi-tabling",
  finishers: "Finishers",
  multipliers: "Multiplicateurs",
  stack: "Winrate par tapis",
  hours: "Performance par heure",
  weekdays: "Performance par jour",
};

export function SettingsPage() {
  const [tab, setTab] = useState<"look" | "calc" | "mult" | "data">("look");
  return (
    <div className="page">
      <div className="page-head">
        <h2>Paramètres</h2>
        <Seg
          value={tab}
          onChange={setTab}
          options={[
            { v: "look", l: "Apparence" },
            { v: "calc", l: "Calculs" },
            { v: "mult", l: "Multiplicateurs" },
            { v: "data", l: "Données" },
          ]}
        />
      </div>
      {tab === "look" && <Look />}
      {tab === "calc" && <Calc />}
      {tab === "mult" && <Mults />}
      {tab === "data" && <Data />}
    </div>
  );
}

function Look() {
  const { prefs, setPrefs } = useApp();
  return (
    <>
      <Panel title="Thème">
        <div className="themes">
          <button className={cls("theme-card", prefs.theme === "auto" && "on")} onClick={() => setPrefs({ theme: "auto", accent: null })}>
            <span className="tc-prev" style={{ background: "linear-gradient(110deg, #f4f5f7 50%, #0a0b0d 50%)" }}>
              <Icon name="sparkle" size={18} />
            </span>
            Auto (système)
          </button>
          {THEMES.map((t) => (
            <button key={t.id} className={cls("theme-card", prefs.theme === t.id && "on")} onClick={() => setPrefs({ theme: t.id, accent: null })}>
              <span className="tc-prev" style={{ background: t.vars["--bg"] }}>
                <i style={{ background: t.vars["--accent"] }} />
                <i style={{ background: t.vars["--gold"] }} />
                <i style={{ background: t.vars["--pos"] }} />
                <i style={{ background: t.vars["--surface2"] }} />
              </span>
              {t.name}
            </button>
          ))}
        </div>
        <div className="row gap16 wrap" style={{ marginTop: 16 }}>
          <label className="field">
            Couleur d'accent
            <div className="row gap8">
              <input type="color" value={prefs.accent ?? themeById(prefs.theme).vars["--accent"]} onChange={(e) => setPrefs({ accent: e.target.value })} />
              {prefs.accent && (
                <Btn small onClick={() => setPrefs({ accent: null })}>
                  Réinitialiser
                </Btn>
              )}
            </div>
          </label>
          <label className="field">
            Densité
            <Seg small value={prefs.density} onChange={(v) => setPrefs({ density: v })} options={[{ v: "cozy", l: "Confort" }, { v: "compact", l: "Compact" }]} />
          </label>
          <label className="field">
            Taille du texte
            <div className="row gap8">
              <input type="range" min={0.85} max={1.25} step={0.05} value={prefs.fontScale} onChange={(e) => setPrefs({ fontScale: +e.target.value })} />
              <span className="muted small">{Math.round(prefs.fontScale * 100)} %</span>
            </div>
          </label>
          <label className="field">
            Arrondi
            <input type="range" min={0} max={20} step={1} value={prefs.radius} onChange={(e) => setPrefs({ radius: +e.target.value })} />
          </label>
          <label className="field">
            Langue
            <Seg small value={prefs.lang} onChange={(v) => setPrefs({ lang: v })} options={[{ v: "fr", l: "Français" }, { v: "en", l: "English" }]} />
          </label>
          <label className="field">
            Devise
            <input className="inp" style={{ width: 60 }} value={prefs.currency} onChange={(e) => setPrefs({ currency: e.target.value })} />
          </label>
        </div>
        <div className="row gap16 wrap" style={{ marginTop: 14 }}>
          <Toggle on={prefs.fourColor} onChange={(v) => setPrefs({ fourColor: v })} label="Jeu 4 couleurs" />
          <Toggle on={prefs.animations} onChange={(v) => setPrefs({ animations: v })} label="Animations" />
          <Toggle on={!!prefs.privacy["__all"]} onChange={(v) => setPrefs({ privacy: { ...prefs.privacy, __all: v } })} label="Mode discret (tout flouter)" />
        </div>
      </Panel>
      <Panel title="Personnaliser le thème" help="Chaque couleur du thème sélectionné peut être remplacée. Les modifications s'appliquent instantanément et sont conservées.">
        <div className="colors-grid">
          {EDITABLE_VARS.map(([v, label]) => (
            <label key={v} className="color-row">
              <input
                type="color"
                value={toHex(prefs.themeVars[v] ?? themeById(prefs.theme).vars[v] ?? "#888888")}
                onChange={(e) => setPrefs({ themeVars: { ...prefs.themeVars, [v]: e.target.value } })}
              />
              {label}
              {prefs.themeVars[v] && (
                <button
                  className="icon-btn"
                  title="Rétablir"
                  onClick={() => {
                    const n = { ...prefs.themeVars };
                    delete n[v];
                    setPrefs({ themeVars: n });
                  }}
                >
                  <Icon name="refresh" size={12} />
                </button>
              )}
            </label>
          ))}
        </div>
        <Btn small icon="refresh" onClick={() => setPrefs({ themeVars: {} })}>
          Rétablir les couleurs du thème
        </Btn>
      </Panel>
      <Panel title="Couleurs des courbes">
        <div className="colors-grid">
          {[...CHIP_SERIES, ...BR_SERIES].map((s) => (
            <label key={s.key + s.color} className="color-row">
              <input
                type="color"
                value={prefs.chartColors[s.color] ?? getComputedStyle(document.documentElement).getPropertyValue(s.color).trim()}
                onChange={(e) => setPrefs({ chartColors: { ...prefs.chartColors, [s.color]: e.target.value } })}
              />
              {s.label}
            </label>
          ))}
        </div>
        <Btn small onClick={() => setPrefs({ chartColors: {} })} icon="refresh">
          Couleurs par défaut
        </Btn>
      </Panel>
      <Panel title="Sections de l'onglet Stats" help="Choisissez les blocs affichés et leur ordre.">
        <div className="fchips">
          {ALL_STATS_SECTIONS.map((s) => (
            <button
              key={s}
              className={cls("fchip", prefs.statsSections.includes(s) && "on")}
              onClick={() => setPrefs({ statsSections: prefs.statsSections.includes(s) ? prefs.statsSections.filter((x) => x !== s) : [...prefs.statsSections, s] })}
            >
              {SECTION_NAMES[s]}
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Réinitialisation">
        <Btn
          icon="refresh"
          onClick={() => {
            if (window.confirm("Rétablir toutes les préférences d'affichage ?")) setPrefs(DEFAULT_PREFS);
          }}
        >
          Rétablir l'affichage par défaut
        </Btn>
      </Panel>
    </>
  );
}

function Calc() {
  const { settings, saveSettings, overview, toast } = useApp();
  const [tx, setTx] = useState({ amount: 0, note: "" });
  if (!settings) return null;
  const set = (p: Partial<S>) => saveSettings({ ...settings, ...p });
  return (
    <>
      <Panel title="Rakeback" help="Le rakeback est ajouté à tous les profits (réel et EV) et abaisse le CEV minimum de rentabilité.">
        <div className="row gap16 wrap">
          <label className="field">
            Rakeback par défaut
            <NumInput value={settings.default_rakeback} onChange={(v) => set({ default_rakeback: v })} suffix="%" width={70} />
          </label>
          {(overview?.rooms ?? []).map((r) => (
            <label key={r} className="field">
              {r}
              <NumInput value={settings.rakeback[r] ?? settings.default_rakeback} onChange={(v) => set({ rakeback: { ...settings.rakeback, [r]: v } })} suffix="%" width={70} />
            </label>
          ))}
        </div>
      </Panel>
      <Panel title="Bankroll">
        <div className="row gap16 wrap">
          <label className="field">
            Bankroll de départ
            <NumInput value={settings.bankroll_start} onChange={(v) => set({ bankroll_start: v })} width={100} suffix="€" />
          </label>
          <label className="field">
            Seuil « jackpot »
            <NumInput value={settings.jackpot_threshold} onChange={(v) => set({ jackpot_threshold: v })} width={70} suffix="x" />
          </label>
        </div>
        <div className="fsec-t" style={{ marginTop: 14 }}>
          Dépôts / retraits
        </div>
        <table className="tbl">
          <tbody>
            {settings.transactions.map((t, i) => (
              <tr key={i}>
                <td>{date(t.ts)}</td>
                <td className={t.amount >= 0 ? "pos" : "neg"}>{money(t.amount)}</td>
                <td>{t.note}</td>
                <td className="r">
                  <button className="icon-btn" onClick={() => set({ transactions: settings.transactions.filter((_, k) => k !== i) })}>
                    <Icon name="trash" size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row gap8" style={{ marginTop: 8 }}>
          <NumInput value={tx.amount} onChange={(v) => setTx({ ...tx, amount: v })} width={100} suffix="€" />
          <input className="inp" placeholder="Note (dépôt, retrait…)" value={tx.note} onChange={(e) => setTx({ ...tx, note: e.target.value })} />
          <Btn
            small
            icon="plus"
            onClick={() => {
              set({ transactions: [...settings.transactions, { ts: nowNaive(), amount: tx.amount, note: tx.note }] });
              setTx({ amount: 0, note: "" });
            }}
          >
            Ajouter
          </Btn>
        </div>
      </Panel>
      <Panel title="Pseudos héros" help="Les pseudos détectés dans vos historiques sont reconnus automatiquement. Ajoutez-en si vous jouez sous plusieurs noms.">
        <div className="fchips">
          {(overview?.heroes ?? []).map((h) => (
            <span key={h} className="fchip on">
              {h}
            </span>
          ))}
          <button
            className="fchip"
            onClick={() => {
              const n = window.prompt("Pseudo à ajouter ?");
              if (n) {
                set({ heroes: [...settings.heroes, n] });
                toast("Pseudo ajouté");
              }
            }}
          >
            <Icon name="plus" size={12} /> Ajouter
          </button>
        </div>
      </Panel>
      <Panel title="Références du leak finder" help="Les références personnalisées permettent de comparer vos fréquences à vos propres cibles (issues d'un solveur par exemple).">
        <div className="muted small">{Object.keys(settings.references).length} référence(s) enregistrée(s).</div>
        {Object.keys(settings.references).length > 0 && (
          <Btn small icon="trash" onClick={() => set({ references: {} })}>
            Tout effacer
          </Btn>
        )}
      </Panel>
    </>
  );
}

function Mults() {
  const { settings, saveSettings, toast } = useApp();
  const [sel, setSel] = useState(0);
  if (!settings) return null;
  const tables = settings.mult_tables;
  const tb: MultTable | undefined = tables[sel];
  const update = (t: MultTable) => saveSettings({ ...settings, mult_tables: tables.map((x, i) => (i === sel ? t : x)) });
  const psum = tb ? tb.entries.reduce((a, e) => a + e.prob, 0) : 0;
  const emult = tb ? tb.entries.reduce((a, e) => a + (e.prob / (psum || 1)) * e.mult, 0) : 0;
  return (
    <Panel
      title="Tables de multiplicateurs"
      help="Probabilité de chaque multiplicateur et répartition du prize pool. Ces valeurs servent à l'EV Profit et aux statistiques de multiplicateurs. Spin Tracker OP renormalise automatiquement la table sur le retour réel au joueur de vos tournois (3 × la part prize pool du buy-in), donc seules les proportions relatives comptent."
      right={
        <div className="row gap8">
          <select className="sel" value={sel} onChange={(e) => setSel(+e.target.value)}>
            {tables.map((t, i) => (
              <option key={t.id} value={i}>
                {t.name}
              </option>
            ))}
          </select>
          <Btn
            small
            icon="plus"
            onClick={() => {
              saveSettings({
                ...settings,
                mult_tables: [...tables, { id: `t${Date.now().toString(36)}`, name: "Nouvelle table", room: "", buyin: null, entries: [{ mult: 2, prob: 0.6, shares: [1, 0, 0] }] }],
              });
              setSel(tables.length);
            }}
          >
            Nouvelle table
          </Btn>
        </div>
      }
    >
      {tb && (
        <>
          <div className="row gap12 wrap">
            <label className="field">
              Nom
              <input className="inp" value={tb.name} onChange={(e) => update({ ...tb, name: e.target.value })} />
            </label>
            <label className="field">
              Room
              <input className="inp" style={{ width: 120 }} value={tb.room} onChange={(e) => update({ ...tb, room: e.target.value })} />
            </label>
            <label className="field">
              Buy-in (vide = tous)
              <input className="inp" style={{ width: 100 }} value={tb.buyin ?? ""} onChange={(e) => update({ ...tb, buyin: e.target.value ? +e.target.value : null })} />
            </label>
            <div className="field">
              Multiplicateur moyen
              <b>x{num(emult, 3)}</b>
            </div>
          </div>
          <table className="tbl" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Multiplicateur</th>
                <th className="r">Probabilité (%)</th>
                <th className="r">1er (%)</th>
                <th className="r">2e (%)</th>
                <th className="r">3e (%)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tb.entries.map((e, i) => {
                const setE = (p: Partial<typeof e>) => update({ ...tb, entries: tb.entries.map((x, k) => (k === i ? { ...x, ...p } : x)) });
                return (
                  <tr key={i}>
                    <td>
                      <NumInput value={e.mult} onChange={(v) => setE({ mult: v })} width={80} />
                    </td>
                    <td className="r">
                      <NumInput value={+(e.prob * 100).toFixed(6)} onChange={(v) => setE({ prob: v / 100 })} width={90} />
                    </td>
                    {[0, 1, 2].map((k) => (
                      <td key={k} className="r">
                        <NumInput
                          value={+(e.shares[k] * 100).toFixed(2)}
                          onChange={(v) => {
                            const s = [...e.shares] as [number, number, number];
                            s[k] = v / 100;
                            setE({ shares: s });
                          }}
                          width={70}
                        />
                      </td>
                    ))}
                    <td className="r">
                      <button className="icon-btn" onClick={() => update({ ...tb, entries: tb.entries.filter((_, k) => k !== i) })}>
                        <Icon name="trash" size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="row gap8" style={{ marginTop: 10 }}>
            <Btn small icon="plus" onClick={() => update({ ...tb, entries: [...tb.entries, { mult: 2, prob: 0.01, shares: [1, 0, 0] }] })}>
              Ajouter un palier
            </Btn>
            <span className="muted small">Somme des probabilités : {num(psum * 100, 3)} %</span>
            <div className="grow" />
            <Btn
              small
              kind="danger"
              icon="trash"
              onClick={() => {
                if (window.confirm("Supprimer cette table ?")) {
                  saveSettings({ ...settings, mult_tables: tables.filter((_, i) => i !== sel) });
                  setSel(0);
                  toast("Table supprimée");
                }
              }}
            >
              Supprimer la table
            </Btn>
            <Btn
              small
              icon="refresh"
              onClick={async () => {
                const d = await api.defaultSettings();
                saveSettings({ ...settings, mult_tables: d.mult_tables });
                toast("Tables par défaut restaurées");
              }}
            >
              Tables par défaut
            </Btn>
          </div>
        </>
      )}
    </Panel>
  );
}

function Data() {
  const { overview, filter, toast, bump } = useApp();
  const [wipe, setWipe] = useState(false);
  return (
    <>
      <Panel title="Base de données">
        <div className="kv">
          <span>Emplacement</span>
          <code>{overview?.db_path}</code>
          <span>Contenu</span>
          <span>
            {num(overview?.tournaments ?? 0)} tournois · {num(overview?.hands ?? 0)} mains · {num(overview?.players ?? 0)} joueurs
          </span>
          <span>Version</span>
          <span>Spin Tracker OP {overview?.version}</span>
        </div>
        <div className="row gap8" style={{ marginTop: 14 }}>
          <Btn
            icon="download"
            onClick={async () => {
              const p = await saveDialog({ defaultPath: "spintracker-backup.db", filters: [{ name: "SQLite", extensions: ["db"] }] });
              if (p) {
                await api.backup(p);
                toast("Sauvegarde créée");
              }
            }}
          >
            Sauvegarder la base
          </Btn>
          <Btn
            icon="file"
            onClick={async () => {
              const p = await saveDialog({ defaultPath: "spins.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
              if (p) {
                const n = await api.exportCsv(filter, p);
                toast(`${n} tournois exportés`);
              }
            }}
          >
            Exporter en CSV (filtre actuel)
          </Btn>
          <div className="grow" />
          <Btn kind="danger" icon="trash" onClick={() => setWipe(true)}>
            Effacer toutes les données
          </Btn>
        </div>
      </Panel>
      <Panel title="À propos">
        <p className="muted">
          Spin Tracker OP est un tracker open source (GPL-3.0) pour les formats Spin &amp; Go / Twister / Expresso. Toutes vos données restent sur votre machine : aucune connexion réseau n'est
          effectuée.
        </p>
        <p className="muted small">
          Les formules utilisées (CEV, EV profit, CEV minimum, intervalles de confiance) sont documentées dans <code>docs/FORMULES.md</code>.
        </p>
      </Panel>
      {wipe && (
        <Modal title="Effacer toutes les données" onClose={() => setWipe(false)}>
          <p>Cette action supprime définitivement tous les tournois et toutes les mains importés. Les paramètres, tags et challenges sont conservés.</p>
          <div className="row gap8" style={{ justifyContent: "flex-end" }}>
            <Btn onClick={() => setWipe(false)}>Annuler</Btn>
            <Btn
              kind="danger"
              onClick={async () => {
                await api.wipe();
                clearCache();
                bump();
                setWipe(false);
                toast("Base vidée");
              }}
            >
              Tout effacer
            </Btn>
          </div>
        </Modal>
      )}
    </>
  );
}
