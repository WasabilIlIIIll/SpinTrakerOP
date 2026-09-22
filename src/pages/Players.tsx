import { useState } from "react";
import { api, type TagDef, type TagRule } from "../lib/api";
import { useApp, useQuery } from "../lib/state";
import { Btn, Empty, Loading, Modal, Pager, Panel, Priv, Seg, TagChip, Tags, Toggle, NumInput } from "../components/ui";
import { Icon, TAG_ICONS } from "../components/Icon";
import { ago, cls, money, num, pct, tone } from "../lib/format";

const STATS: [string, string][] = [
  ["hands", "Mains"],
  ["tournaments", "Tournois"],
  ["vpip", "VPIP %"],
  ["pfr", "PFR %"],
  ["limp_btn", "Limp BTN %"],
  ["shove_btn", "Shove BTN %"],
  ["raise_btn", "Open BTN %"],
  ["threebet", "3-bet %"],
  ["call_shove_bb", "Call vs shove BB %"],
  ["af", "AF"],
  ["wtsd", "WTSD %"],
  ["wsd", "W$SD %"],
  ["cbet", "C-bet flop %"],
  ["fold_cbet", "Fold vs c-bet %"],
  ["cev", "CEV du joueur"],
  ["cev_vs_hero", "CEV contre vous"],
];

export function Players() {
  const [tab, setTab] = useState<"players" | "tags">("players");
  return (
    <div className="page">
      <div className="page-head">
        <h2>Joueurs</h2>
        <Seg value={tab} onChange={setTab} options={[{ v: "players", l: "Joueurs" }, { v: "tags", l: "Tags" }]} />
      </div>
      {tab === "players" ? <PlayerList /> : <TagsManager />}
    </div>
  );
}

const COLS: [string, string][] = [
  ["hands", "Mains"],
  ["vs_hero_tournaments", "Spins ensemble"],
  ["vpip", "VPIP"],
  ["pfr", "PFR"],
  ["limp_btn", "Limp BTN"],
  ["threebet", "3-bet"],
  ["af", "AF"],
  ["cev_vs_hero", "CEV vs vous"],
  ["hero_cev_vs", "Votre CEV"],
  ["hero_profit_vs", "Votre profit"],
  ["last_ts", "Vu"],
];

function PlayerList() {
  const { settings, open, filter, setFilter, go } = useApp();
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [minHands, setMinHands] = useState(0);
  const [sort, setSort] = useState("vs_hero_tournaments");
  const [desc, setDesc] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 100;
  const q = { search, tag, min_hands: minHands, sort, desc, offset, limit };
  const { data, loading } = useQuery(["players", q], () => api.players(q));
  const click = (k: string) => {
    if (k === sort) setDesc(!desc);
    else {
      setSort(k);
      setDesc(true);
    }
    setOffset(0);
  };
  return (
    <>
      <div className="hand-filters">
        <input className="inp" placeholder="Rechercher un joueur…" value={search} onChange={(e) => (setSearch(e.target.value), setOffset(0))} style={{ width: 220 }} />
        <div className="fchips">
          <button className={cls("fchip", !tag && "on")} onClick={() => setTag(null)}>
            Tous
          </button>
          {settings?.tags.map((t) => (
            <button key={t.id} className={cls("fchip", tag === t.id && "on")} onClick={() => setTag(t.id)}>
              <TagChip tag={t} small /> {t.name}
            </button>
          ))}
        </div>
        <label className="row gap8 small muted">
          Mains min <NumInput value={minHands} width={60} min={0} onChange={setMinHands} />
        </label>
        <div className="grow" />
        <span className="muted small">{num(data?.total ?? 0)} joueurs</span>
      </div>
      <Panel pad={false} right={<Pager total={data?.total ?? 0} offset={offset} limit={limit} onChange={setOffset} />}>
        {loading && !data ? (
          <Loading />
        ) : !data?.rows.length ? (
          <Empty title="Aucun joueur" sub="Importez des mains pour construire votre base d'adversaires." icon="users" />
        ) : (
          <div className="tbl-wrap tall">
            <table className="tbl hover">
              <thead>
                <tr>
                  <th>Joueur</th>
                  <th>Tags</th>
                  {COLS.map(([k, l]) => (
                    <th key={k} className="r sortable" onClick={() => click(k)}>
                      {l} {sort === k ? (desc ? "↓" : "↑") : ""}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((p) => (
                  <tr key={p.name} onClick={() => open({ type: "player", name: p.name })}>
                    <td>
                      <b>{p.name}</b>
                    </td>
                    <td>
                      <Tags ids={p.tags} small />
                    </td>
                    <td className="r">{num(p.hands)}</td>
                    <td className="r">{num(p.vs_hero_tournaments)}</td>
                    <td className="r">{pct(p.vpip, 0)}</td>
                    <td className="r">{pct(p.pfr, 0)}</td>
                    <td className="r">{pct(p.limp_btn, 0)}</td>
                    <td className="r">{pct(p.threebet, 0)}</td>
                    <td className="r">{num(p.af, 1)}</td>
                    <td className={cls("r", tone(p.cev_vs_hero))}>{num(p.cev_vs_hero, 0)}</td>
                    <td className={cls("r", tone(p.hero_cev_vs))}>{num(p.hero_cev_vs, 0)}</td>
                    <td className={cls("r", tone(p.hero_profit_vs))}>
                      <Priv k="profit">{money(p.hero_profit_vs)}</Priv>
                    </td>
                    <td className="r muted">{ago(p.last_ts)}</td>
                    <td>
                      <button
                        className="icon-btn"
                        title="Filtrer le tableau de bord sur ce joueur"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFilter({ ...filter, opponent: p.name });
                          go("dashboard");
                        }}
                      >
                        <Icon name="filter" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function TagsManager() {
  const { settings, saveSettings, toast } = useApp();
  const { data: ov } = useQuery(["tagsov"], () => api.tagsOverview());
  const [edit, setEdit] = useState<TagDef | null>(null);
  if (!settings) return <Loading />;
  const update = async (tags: TagDef[]) => {
    await saveSettings({ ...settings, tags });
    toast("Tags mis à jour");
  };
  return (
    <>
      <Panel
        title="Tags & règles automatiques"
        help="Un joueur reçoit automatiquement un tag dès que ses statistiques vérifient les règles. Les tags manuels (fiche joueur) s'ajoutent aux tags automatiques."
        right={
          <Btn
            icon="plus"
            kind="primary"
            small
            onClick={() =>
              setEdit({ id: `tag${Date.now().toString(36)}`, name: "Nouveau tag", color: "#d4a53c", icon: "star", active: true, auto: true, mode: "all", rules: [{ stat: "hands", op: ">=", value: 50 }] })
            }
          >
            Nouveau tag
          </Btn>
        }
        pad={false}
      >
        <table className="tbl">
          <thead>
            <tr>
              <th>Actif</th>
              <th>Tag</th>
              <th>Règles</th>
              <th className="r">Joueurs</th>
              <th className="r">CEV HU</th>
              <th className="r">CEV</th>
              <th className="r">Spins</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {settings.tags.map((t) => {
              const o = ov?.find((x) => x.id === t.id);
              return (
                <tr key={t.id}>
                  <td>
                    <Toggle on={t.active} onChange={(v) => update(settings.tags.map((x) => (x.id === t.id ? { ...x, active: v } : x)))} />
                  </td>
                  <td>
                    <TagChip tag={t} />
                  </td>
                  <td className="muted small">
                    {t.auto ? t.rules.map((r) => `${STATS.find((s) => s[0] === r.stat)?.[1] ?? r.stat} ${r.op} ${r.value}`).join(t.mode === "all" ? " et " : " ou ") : "manuel uniquement"}
                  </td>
                  <td className="r">{num(o?.players ?? 0)}</td>
                  <td className={cls("r", tone(o?.cev_hu ?? 0))}>
                    {num(o?.cev_hu ?? 0, 0)} <small className="muted">± {num(o?.cev_hu_ci ?? 0, 0)}</small>
                  </td>
                  <td className={cls("r", tone(o?.cev ?? 0))}>
                    {num(o?.cev ?? 0, 0)} <small className="muted">± {num(o?.cev_ci ?? 0, 0)}</small>
                  </td>
                  <td className="r muted">{num(o?.tournaments ?? 0)}</td>
                  <td className="r">
                    <button className="icon-btn" onClick={() => setEdit(t)}>
                      <Icon name="edit" size={14} />
                    </button>
                    <button className="icon-btn" onClick={() => update(settings.tags.filter((x) => x.id !== t.id))}>
                      <Icon name="trash" size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
      {edit && (
        <TagEditor
          tag={edit}
          onClose={() => setEdit(null)}
          onSave={(t) => {
            const exists = settings.tags.some((x) => x.id === t.id);
            update(exists ? settings.tags.map((x) => (x.id === t.id ? t : x)) : [...settings.tags, t]);
            setEdit(null);
          }}
        />
      )}
    </>
  );
}

const OPS = [">=", ">", "<=", "<", "=", "!="];

function TagEditor({ tag, onClose, onSave }: { tag: TagDef; onClose: () => void; onSave: (t: TagDef) => void }) {
  const [t, setT] = useState<TagDef>(tag);
  const setRule = (i: number, r: Partial<TagRule>) => setT({ ...t, rules: t.rules.map((x, k) => (k === i ? { ...x, ...r } : x)) });
  return (
    <Modal title="Tag" onClose={onClose} wide>
      <div className="col gap12">
        <div className="row gap12 wrap">
          <label className="field">
            Nom
            <input className="inp" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
          </label>
          <label className="field">
            Couleur
            <input type="color" value={t.color} onChange={(e) => setT({ ...t, color: e.target.value })} />
          </label>
          <div className="field">
            Icône
            <div className="fchips">
              {TAG_ICONS.map((ic) => (
                <button key={ic} className={cls("fchip", t.icon === ic && "on")} onClick={() => setT({ ...t, icon: ic })}>
                  <Icon name={ic} size={14} />
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="row gap12">
          <Toggle on={t.auto} onChange={(v) => setT({ ...t, auto: v })} label="Attribution automatique" />
          {t.auto && <Seg small value={t.mode} onChange={(v) => setT({ ...t, mode: v })} options={[{ v: "all", l: "Toutes les règles" }, { v: "any", l: "Au moins une" }]} />}
        </div>
        {t.auto && (
          <div className="col gap8">
            {t.rules.map((r, i) => (
              <div key={i} className="row gap8">
                <select className="sel" value={r.stat} onChange={(e) => setRule(i, { stat: e.target.value })}>
                  {STATS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
                <select className="sel" value={r.op} onChange={(e) => setRule(i, { op: e.target.value })} style={{ width: 70 }}>
                  {OPS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <NumInput value={r.value} onChange={(v) => setRule(i, { value: v })} width={80} />
                <button className="icon-btn" onClick={() => setT({ ...t, rules: t.rules.filter((_, k) => k !== i) })}>
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
            <Btn small icon="plus" onClick={() => setT({ ...t, rules: [...t.rules, { stat: "vpip", op: ">=", value: 50 }] })}>
              Ajouter une règle
            </Btn>
          </div>
        )}
        <div className="row gap8" style={{ justifyContent: "flex-end" }}>
          <Btn onClick={onClose}>Annuler</Btn>
          <Btn kind="primary" onClick={() => onSave(t)}>
            Enregistrer
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
