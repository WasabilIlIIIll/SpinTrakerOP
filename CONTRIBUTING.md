# Contribuer à Spin Tracker OP

Merci ! Toutes les contributions sont les bienvenues : parsers de nouvelles rooms, statistiques,
thèmes, traductions, corrections.

## Démarrer

```bash
npm install
npm run app     # application en mode développement (rechargement à chaud)
```

Prérequis : Node.js 20+, Rust stable, et sous Windows les *Build Tools* Visual Studio
(« Développement Desktop en C++ »).

## Vérifications avant une PR

```bash
npx tsc -b                      # typage front
cd src-tauri && cargo test      # tests Rust (dont le test d'intégration sur échantillons)
cd src-tauri && cargo fmt       # formatage
```

Le test d'intégration lit le dossier `maintest/` s'il existe ; il est ignoré sinon.
Pour tester sans interface :

```bash
cargo run --bin spinop-cli -- import "chemin/vers/historiques"
cargo run --bin spinop-cli -- summary
```

Astuce : `SPINOP_DATA_DIR=/tmp/test-db` permet de travailler sur une base jetable.

## Ajouter le support d'une room

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#ajouter-un-parser). Joignez à votre PR un
historique d'exemple **anonymisé** (pseudos remplacés) dans `samples/<room>/` ainsi qu'un test.

Les invariants suivants doivent tenir sur chaque main :

- la somme des résultats nets des joueurs vaut zéro ;
- le tapis final d'un joueur est son tapis initial de la main suivante ;
- la somme des EV all-in vaut zéro.

## Style

- Rust : `cargo fmt`, pas de `unwrap()` sur des données externes, erreurs remontées en `String`.
- TypeScript : pas de dépendance supplémentaire sans discussion (l'application doit rester
  légère et rapide) ; React sans bibliothèque d'état.
- Commentaires et libellés en français dans l'interface ; les traductions anglaises vont dans
  `src/lib/i18n.ts`.

## Ne jamais committer

Vos historiques de mains personnels (`maintest/`, `samples/private/` sont ignorés par git),
ni votre base `spintracker.db`.

## Licence

En contribuant, vous acceptez que votre code soit distribué sous licence GPL-3.0.
