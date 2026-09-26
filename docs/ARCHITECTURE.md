# Architecture

```
spin-tracker-op/
├── src-tauri/             cœur Rust (Tauri 2)
│   ├── src/
│   │   ├── model.rs       structures brutes (Hand, Seat, Action, Tournament)
│   │   ├── parser/        détection de format + parsers par room
│   │   │   ├── ipoker.rs  PMU / réseau iPoker (XML)
│   │   │   └── winamax.rs Winamax Expresso (texte, bêta)
│   │   ├── eval.rs        évaluateur 7 cartes + équité (side pots, Monte-Carlo)
│   │   ├── analysis.rs    faits par main : net, EV all-in, positions, scénarios
│   │   ├── store.rs       état en mémoire + agrégats par tournoi + modèle €
│   │   ├── settings.rs    paramètres persistés (rakeback, multiplicateurs, tags…)
│   │   ├── db.rs          SQLite (mains sérialisées en MessagePack)
│   │   ├── import.rs      pipeline d'import parallèle
│   │   ├── stats/         calculs : summary, charts, breakdown, players, leaks, challenges
│   │   ├── solver/        solver GTO : ranges et analyseur (Flopzilla), postflop, spots, tâches
│   │   ├── commands.rs    commandes exposées au front
│   │   ├── bin/cli.rs     outil en ligne de commande (import headless)
│   │   └── lib.rs         état applicatif, chargement asynchrone
│   ├── crates/postflop-solver  fork du moteur postflop (AGPL-3.0, voir sa licence)
│   └── tests/samples.rs   test d'intégration sur des historiques réels
└── src/                   interface React + TypeScript
    ├── lib/               api (invoke), état global, thèmes, formats, i18n
    ├── components/        graphiques, replayer, tableaux, UI
    ├── pages/             tableau de bord, tournois, mains, joueurs, leaks, challenges…
    └── styles/app.css     feuille unique pilotée par variables CSS
```

## Principes

**Tout en mémoire, tout en Rust.** Au démarrage, les mains sont chargées depuis SQLite dans
un `Store` (Vec de mains + agrégats par tournoi). Chaque filtre est appliqué en Rust sur des
`Vec<usize>` d'indices : un historique de 70 000 mains tient dans une centaine de mégaoctets et
le moindre recalcul prend quelques millisecondes. Le front ne fait jamais de calcul lourd.

**Les faits coûteux sont mis en cache.** L'EV all-in (énumération ou Monte-Carlo) est calculé
une seule fois à l'import et stocké avec la main (`facts`, version `FACTS_VERSION`). Si
l'algorithme change, incrémenter la constante suffit : les faits obsolètes sont recalculés au
prochain lancement, en parallèle (rayon).

**Le chargement ne bloque pas la fenêtre.** `lib.rs` ouvre la base, puis charge le `Store`
dans un thread ; le front interroge `is_ready` et écoute l'événement `store-ready`.

**Un seul point de vérité pour les montants.** Les euros (EV profit, rakeback…) sont recalculés
par `Store::recompute_money()` dès qu'un paramètre change ; les statistiques joueurs et tags
par `recompute_players()`.

## Ajouter un parser

1. Créer `src-tauri/src/parser/<room>.rs` avec :
   - `pub fn looks_like(content: &str) -> bool`
   - `pub fn parse(content: &str, source: &str) -> Result<Vec<ParsedFile>, String>`
2. L'enregistrer dans `parser::parse_source`.
3. Produire des `Hand` dont les `Action::amount` sont **incrémentaux** (jetons ajoutés au pot)
   et dont `Seat::win` correspond aux pots remportés.
4. Ajouter un historique d'exemple anonymisé et un test dans `tests/`.

L'invariant à respecter, vérifié par les tests : sur chaque main, `Σ net = 0` et le tapis de
fin correspond au tapis de début de la main suivante.

## Ajouter une statistique

- Calcul : `src-tauri/src/stats/…` (les fonctions reçoivent `&Store` et un `Filter`).
- Exposition : une commande dans `commands.rs` + son entrée dans `invoke_handler` (`lib.rs`).
- Typage front : `src/lib/api.ts`, puis affichage via `useQuery` dans une page.

## Interface

- **Graphiques** : uPlot (≈ 45 ko) pour les courbes ; SVG maison pour les barres, la grille de
  mains et le calendrier. Les séries longues sont sous-échantillonnées côté Rust en conservant
  les extrêmes de chaque tranche.
- **Thèmes** : uniquement des variables CSS posées sur `:root`. Ajouter un thème = ajouter une
  entrée dans `src/lib/themes.ts`.
- **Préférences** : un objet `UiPrefs` sérialisé dans la table `kv` (clé `ui`), sauvegardé en
  différé (400 ms) pour ne jamais bloquer l'interface.
- **Cache de requêtes** : `useQuery` mémorise les réponses par clé ; `version` est incrémenté
  après un import ou un changement de paramètre pour tout invalider.

## Solver

- **Moteur** : `crates/postflop-solver`, fork de b-inary/postflop-solver (Discounted CFR,
  isomorphismes, compression 16 bits). Corrections de compatibilité seulement (bincode épinglé
  en 2.0.0-rc.3, emprunts explicites exigés par Rust récent).
- **`solver/postflop.rs`** : `PostflopConfig` (bb, tailles par street en % du pot, relances en ×)
  → arbre du moteur (1 bb = 100 unités) ; `node_view` renvoie pour un nœud la stratégie, la CEV
  de chaque action par main, l'équité, l'EQR et la grille 13×13.
- **`solver/spot.rs`** : main importée → spot postflop (pot et tapis effectif en bb, OOP / IP,
  tailles jouées hors arbre ajoutées pour ce solve, ligne réelle pour « Suivre la main jouée »).
- **`solver/mod.rs`** (`Hub`) : un solve à la fois dans un thread, progression interrogée par le
  front, arrêt propre, fichier `solves/<id>.bin` (zstd), arbre ouvert gardé en mémoire.
- **`solver/ranges.rs`** : ranges, catégories de mains, équité exacte combo par combo par
  balayage trié (retrait de cartes par inclusion-exclusion), ordre préflop des 169 cases.
- **Historique** : table `solves` (paramètres JSON, état, précision atteinte, durée, taille,
  favori, note, corbeille).
- **Vérifications** : `cargo test --lib solver` (conservation des jetons, convergence,
  équité identique au moteur du tracker, catégories) ; `spinop-cli spots` reconstruit le spot de
  toutes les mains de la base et signale toute mise supérieure au tapis effectif ;
  `spinop-cli solve-hand <id> <range OOP> <range IP> [précision %]` fait un solve complet
  (fichier compris) sans interface.
