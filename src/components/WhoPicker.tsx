// Choix d'un joueur analysé ou d'un adversaire : moi, un tag (Regs, Fish…), la population,
// un joueur précis (recherche) ou un groupe de joueurs.
import { useState } from "react";
import { api } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { cls, num } from "../lib/format";
import { Icon } from "./Icon";

/** Pluriel d'un nom de tag (Reg → Regs, Fish → Fish, Agressif → Agressifs). */
export function plural(n: string): string {
  return /s$|x$|^fish$/i.test(n) ? n : `${n}s`;
}

/** Libellé lisible d'une valeur « qui » : "hero", "all", "population", "tag:x", "player:x", "players:a|b". */
export function whoLabel(v: string, tags: { id: string; name: string }[] = [], refs: { id: string; name: string }[] = []): string {
  if (!v || v === "hero") return "Moi";
  if (v.startsWith("file:")) return refs.find((r) => r.id === v.slice(5))?.name ?? "Base importée";
  if (v === "none") return "Aucune";
  if (v === "all") return "Tout le monde";
  if (v === "population") return "Population";
  if (v.startsWith("tag:")) return plural(tags.find((t) => t.id === v.slice(4))?.name ?? v.slice(4));
  if (v.startsWith("player:")) return v.slice(7);
  if (v.startsWith("players:")) return `Groupe (${v.slice(8).split("|").length})`;
  return v;
}

export function WhoPicker({
  value,
  onChange,
  hero,
  all,
  population,
  searchOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  hero?: boolean;
  all?: boolean;
  population?: boolean;
  /** seulement la recherche de joueur(s) */
  searchOnly?: boolean;
}) {
  const { settings } = useApp();
  const [q, setQ] = useState("");
  const [picked, setSearch] = useState(value.startsWith("player:") || value.startsWith("players:"));
  const search = picked || !!searchOnly;
  const { data } = useQuery(["who-pick", q], () => api.players({ search: q, tag: null, min_hands: 0, sort: "vs_hero_tournaments", desc: true, offset: 0, limit: 8 }), q.trim().length >= 2);
  const group = value.startsWith("players:") ? value.slice(8).split("|").filter(Boolean) : value.startsWith("player:") ? [value.slice(7)] : [];
  const setGroup = (g: string[]) => onChange(g.length === 0 ? (hero ? "hero" : "all") : g.length === 1 ? `player:${g[0]}` : `players:${g.join("|")}`);
  const opts: [string, string][] = [
    ...(hero ? ([["hero", "Moi"]] as [string, string][]) : []),
    ...(all ? ([["all", "Tous"]] as [string, string][]) : []),
    ...(settings?.tags ?? []).filter((t) => t.active).map((t) => [`tag:${t.id}`, plural(t.name)] as [string, string]),
    ...(population ? ([["population", "Population"]] as [string, string][]) : []),
  ];
  return (
    <div className="who">
      {!searchOnly && (
      <div className="fchips">
        {opts.map(([v, l]) => (
          <button key={v} className={cls("fchip", value === v && !search && "on")} onClick={() => (setSearch(false), onChange(v))}>
            {l}
          </button>
        ))}
        <button className={cls("fchip", search && "on")} onClick={() => setSearch(true)}>
          <Icon name="search" size={11} /> Joueur(s)
        </button>
      </div>
      )}
      {search && (
        <div className="col gap6">
          {group.length > 0 && (
            <div className="fchips">
              {group.map((n) => (
                <span key={n} className="chip">
                  {n}
                  <button onClick={() => setGroup(group.filter((x) => x !== n))} title="Retirer">
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input className="inp" placeholder={searchOnly ? "Ou un joueur précis (pseudo)…" : "Pseudo (2 lettres minimum)…"} value={q} onChange={(e) => setQ(e.target.value)} />
          {q.trim().length >= 2 && data && (
            <div className="fchips">
              {data.rows
                .filter((p) => !group.includes(p.name))
                .map((p) => (
                  <button
                    key={p.name}
                    className="fchip"
                    onClick={() => {
                      setGroup([...group, p.name]);
                      setQ("");
                    }}
                  >
                    <Icon name="plus" size={11} /> {p.name} <span className="muted">· {num(p.vs_hero_tournaments)}</span>
                  </button>
                ))}
              {!data.rows.length && <span className="muted small">Aucun joueur trouvé.</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
