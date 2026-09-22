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
| **Replayer** | Rejouez chaque main sur une table animée : cartes, tapis, mises, équité au tapis, EV vs résultat réel, navigation au clavier. |
| **Challenges** | Objectifs de volume, d'heures, de profit, de rakeback, de CEV ou de bankroll sur une période, avec rythme requis et suivi quotidien. |
| **Personnalisation** | 5 thèmes poker, couleur d'accent libre, couleurs de courbes, densité, taille du texte, indicateurs du tableau de bord réordonnables, mode discret (floutage), français / anglais. |

## Installation

### Depuis les releases (recommandé)

Téléchargez la dernière version pour votre système sur la page
[Releases](../../releases/latest) : `.msi` ou `.exe` (Windows), `.dmg` (macOS), `.AppImage` / `.deb` (Linux).

### Depuis les sources

Prérequis : [Node.js 20+](https://nodejs.org), [Rust](https://rustup.rs) et, sous Windows,
les *Build Tools* de Visual Studio (composant « Développement Desktop en C++ »).

```bash
git clone https://github.com/<votre-compte>/spin-tracker-op.git
cd spin-tracker-op
npm install
npm run app        # lance l'application en mode développement
npm run bundle     # génère l'installeur dans src-tauri/target/release/bundle
```

## Import des historiques

Import **manuel** : glissez-déposez des fichiers, des dossiers entiers ou des `.zip` dans
l'onglet Import (ou utilisez les boutons). Les doublons sont détectés et ignorés.

| Room | Format | Statut |
|---|---|---|
| PMU / réseau iPoker (Twister) | `.xml` | ✅ complet |
| Winamax (Expresso) | `.txt` + résumés de tournoi | 🧪 bêta |

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

## Changer le logo

Remplacez `app-icon.svg` (ou déposez un PNG carré d'au moins 1024 px) puis lancez :

```bash
npm run icons
```

Toutes les tailles (Windows, macOS, Linux, favicon) sont regénérées automatiquement.

## Vie privée

Aucune donnée ne quitte votre machine, aucune requête réseau, aucun compte.
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

> Spin Tracker OP n'est affilié à aucune room de poker. Vérifiez que l'usage d'un tracker
> est autorisé par les conditions d'utilisation de votre room.
