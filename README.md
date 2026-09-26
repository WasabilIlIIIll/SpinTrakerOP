<div align="center">

<img src="app-icon.svg" width="110" alt="Spin Tracker OP">

# Spin Tracker OP

**Le tracker open source des Spin & Go / Twister / Expresso.**
Application de bureau, 100 % hors ligne, vos données restent chez vous.

[![Licence: GPL v3](https://img.shields.io/badge/licence-GPL--3.0-d63c43)](LICENSE)
![Windows](https://img.shields.io/badge/Windows-✓-2ea043)
![macOS](https://img.shields.io/badge/macOS-✓-2ea043)
![Linux](https://img.shields.io/badge/Linux-✓-2ea043)

</div>

---

## Ce que ça fait

| | |
|---|---|
| **CEV & EV ajusté** | Chaque all-in est recalculé à l'équité exacte (énumération complète postflop, side pots gérés). Courbes Chips / Chips SD / Chips NSD / EV, ligne du **CEV minimum de rentabilité**, intervalle de confiance à 95 %. |
| **4 mesures de profit** | Profit réel, **EV Profit**, **EV Multi-profit**, **EV Profit effectif** — pour séparer la chance aux all-in de celle des multiplicateurs. Rakeback configurable inclus partout. |
| **Bankroll** | Courbes en euros, jackpots, plus gros upswing / downswing, plus haut, plus bas, plus longue période break-even, meilleures et pires journées, séries. |
| **Stats** | CEV par position (BTN, SB vs BTN, HU SB…), par profil de table, par tapis effectif, par heure, par jour ; multi-tabling en €/h ; finishers réels vs attendus ; multiplicateurs tirés vs attendus. |
| **Joueurs** | Base d'adversaires complète : VPIP, PFR, limp BTN, 3-bet, AF, WTSD… votre CEV contre eux, le leur contre vous, dernière rencontre, notes libres. |
| **Tags automatiques** | Constructeur de règles (« ≥ 50 mains **et** limp BTN ≤ 5 % » → Reg). Les tags alimentent les profils de table et les références du leak finder. |
| **Leak finder** | Arbre complet de vos décisions préflop par position, situation et tranche de tapis, avec grille 13×13 des mains jouées, et comparaison à la population, aux regs ou à vos propres cibles. Stats postflop (c-bet, fold vs c-bet, check-raise, barrel, WTSD…). |
| **Replayer & Review** | Rejouez chaque main sur une table animée : cartes, tapis, mises, équité au tapis, CEV vs résultat réel. Marquez une main d'une étoile pour la retrouver dans l'onglet Review. |
| **Challenges** | Objectifs de volume, d'heures, de profit, de rakeback, de CEV ou de bankroll sur une période, avec rythme requis et suivi quotidien. |
| **Sessions** | Vos sessions reconstituées automatiquement (pause réglable) : durée, spins, CEV, EV et profit de chacune. |
| **Personnalisation** | 6 thèmes, couleur d'accent libre, couleurs de courbes, densité, taille du texte, indicateurs du tableau de bord réordonnables, mode discret (floutage), français / anglais. |

## Installation

### Depuis les releases (recommandé)

Téléchargez la dernière version pour votre système sur la page
[Releases](https://github.com/WasabilIlIIIll/SpinTrakerOP/releases/latest) :
`.exe` ou `.msi` (Windows), `.dmg` (macOS), `.AppImage` / `.deb` (Linux).

Sous Windows, lancez le `.exe` : l'installation se fait pour l'utilisateur courant, sans
droits administrateur, et l'application démarre automatiquement.

### Depuis les sources

Prérequis : [Node.js 20+](https://nodejs.org), [Rust](https://rustup.rs) et, sous Windows,
les *Build Tools* de Visual Studio (composant « Développement Desktop en C++ »).

```bash
git clone https://github.com/WasabilIlIIIll/SpinTrakerOP.git
cd SpinTrakerOP
npm install
npm run app        # lance l'application en mode développement
npm run bundle     # génère l'installeur dans src-tauri/target/release/bundle
```

## Import des historiques

Import **manuel** : glissez-déposez des fichiers, des dossiers entiers ou des `.zip` dans
l'onglet Import (ou utilisez les boutons). Chaque main porte un identifiant unique : réimporter
le même dossier tous les jours ne crée **aucun doublon**, les mains déjà connues sont ignorées.

Chaque import forme un lot listé dans l'historique, avec une **corbeille** : supprimer un import
retire uniquement les mains qu'il avait apportées (et les tournois devenus vides).

Seuls les **formats Spin** sont conservés (2 ou 3 joueurs, tapis de départ court). Si votre
dossier contient des MTT, des freerolls ou des Sit & Go classiques, ils sont comptés et listés
dans le rapport d'import puis ignorés : mélangés aux Spins, ils rendraient le CEV et les chips
totalement faux.

| Room | Format | Statut |
|---|---|---|
| PMU / réseau iPoker (Twister) | `.xml` | ✅ complet |
| Betclic (Spin & Rush, logiciel actuel) | `.txt` « ExportHH » ou le `.zip` tel quel | ✅ vérifié sur 12 000 mains réelles |
| Betclic (ancien logiciel iPoker) | `.xml` | ✅ même format que PMU |
| Winamax (Expresso) | `.txt` + résumés de tournoi | 🧪 bêta |
| Unibet (Spin) | `.txt` | 🧪 bêta |
| PokerStars (Spin & Go) | `.txt` + résumés | 🧪 bêta |

La **room est détectée automatiquement** : par le format pour Betclic, Winamax, Unibet et
PokerStars ; pour les `.xml` iPoker (identiques entre PMU et l'ancien Betclic), par le
contenu, le chemin du dossier, puis le pseudo du héros déjà vu sur une room — PMU par défaut.
Les heures données en UTC (Betclic, Winamax, Unibet) sont converties en heure de Paris.

Les « bêta » sont écrits d'après les formats publiés (fpdb et autres projets libres) et
validés sur des historiques synthétiques : un fichier réel anonymisé dans une issue suffit
à les passer en « vérifié ».

Un autre format à ajouter ? Ouvrez une issue avec un fichier d'exemple anonymisé :
l'architecture des parsers est prévue pour ça (`src-tauri/src/parser/`).

## Comment les chiffres sont calculés

Tout est documenté, formule par formule, dans **[docs/FORMULES.md](docs/FORMULES.md)** :
EV all-in, CEV, intervalles de confiance, probabilités de place (Malmuth-Harville),
les quatre mesures de profit, le CEV minimum de rentabilité, l'indicateur de chance,
le multi-tabling et le leak finder.

Les tables de multiplicateurs sont **éditables** (Paramètres → Multiplicateurs) et
automatiquement renormalisées sur le retour réel au joueur de vos tournois : même si les
probabilités officielles de votre room changent, l'EV reste juste.

## Solver GTO

Onglet **Solver** (et bouton **Solver la main** dans le Replayer) :

- **Postflop tête-à-tête** : arbre complet flop → turn → river aux tailles Spin (33 / 55 / 100 / 150 %
  du pot, relance 3× et all-in, donk bets), résolu en Discounted CFR jusqu'à la précision
  visée (1 %, 0,3 % ou 0,1 % du pot d'exploitabilité, mesurée et affichée). Grille 13×13 des
  stratégies, CEV de **chaque action** pour chaque main, équité, EQR, distribution d'équité.
- **Solver la main** : le spot est reconstruit depuis l'historique (pot, tapis effectif,
  positions, tailles réellement jouées ajoutées à l'arbre) ; « Suivre la main jouée » compare
  chacune de vos décisions à la solution et chiffre la CEV perdue.
- **Ranges** (façon Flopzilla) : répartition d'une range sur un board (paires, tirages…),
  équité exacte main par main contre une range adverse.
- **Historique** des solves, favoris, notes, corbeille ; les arbres sont stockés compressés
  dans le sous-dossier `solves/` des données.

Valeurs en bb, **sans ICM** (le vainqueur rafle le prize pool). Les pots à 3 joueurs et le
solver préflop arrivent dans les prochaines versions. Mémoire indicative (Ryzen 7 5800X) : un
flop BTN min-raise / BB call à 23 bb avec le profil *Standard* (4 tailles au flop, 2 au turn et
à la river) occupe 8,8 Go et atteint 0,3 % du pot en moins de 5 minutes ; 4 tailles sur les
trois streets demandent 25 Go. Un solve qui démarre au turn tient en quelques centaines de Mo.

## Changer le logo

Remplacez `app-icon.svg` (ou déposez un PNG carré d'au moins 1024 px) puis lancez :

```bash
npm run icons
```

Toutes les tailles (Windows, macOS, Linux, favicon) sont regénérées automatiquement.

## Vie privée

Aucune donnée ne quitte votre machine, aucune requête réseau, aucun compte.
La base est **sauvegardée automatiquement chaque jour** (7 dernières copies, dossier
`sauvegardes/`) ; si elle est endommagée au démarrage, la dernière sauvegarde est restaurée.
Tout est stocké dans une base SQLite locale (Paramètres → Données pour l'emplacement,
la sauvegarde et l'export CSV).

## Architecture

- **Rust + Tauri 2** : parsing, moteur d'équité, calculs, base SQLite. Tout est chargé en
  mémoire puis filtré en Rust — un historique de 70 000 mains se recalcule en quelques
  millisecondes et l'installeur pèse une dizaine de mégaoctets.
- **React + TypeScript + uPlot** : interface, graphiques légers, thèmes en variables CSS.

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contribuer

Les contributions sont bienvenues : parsers de nouvelles rooms, traductions, thèmes,
nouvelles statistiques. Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[GPL-3.0](LICENSE) — libre d'utilisation, de modification et de redistribution, à condition
que les versions dérivées restent open source.

Le moteur postflop est un fork de [postflop-solver](https://github.com/b-inary/postflop-solver)
(Wataru Inariba), sous licence AGPL-3.0 : son code se trouve dans
`src-tauri/crates/postflop-solver` avec sa licence d'origine. La GPL-3.0 (article 13) autorise
cet assemblage ; l'application qui l'intègre respecte aussi les conditions de l'AGPL-3.0.

> Spin Tracker OP n'est affilié à aucune room de poker. Vérifiez que l'usage d'un tracker
> est autorisé par les conditions d'utilisation de votre room.
