# Refonte « Spatial » — cahier des charges

Validé avec Laszlo le 30/09/2026 à partir d'une maquette de style visionOS (dashboard en verre,
panneau central et deux panneaux latéraux inclinés).

## Principes

- **Un tracker, pas un solveur** : on suit ses données, simplement et efficacement.
- **Design unique**, plus de thèmes : pas de mode clair/sombre, de couleur d'accent, de taille de
  texte ni de densité au choix. Seules restent personnalisables la disposition du tableau de bord
  (indicateurs) et celle de l'onglet Stats.
- **Lisible, aéré, sans surcharge** : l'information importante saute aux yeux, le reste se
  découvre au survol ou au clic.
- **Interactif et animé** : arrivée des panneaux, courbes qui se dessinent, transitions de page.

## Coque « Spatial »

- **Posée sur le bureau** : fenêtre Windows réellement transparente et sans cadre ; on voit le
  vrai bureau autour et entre les panneaux. Le verre est fumé (WebView2 ne peut pas flouter les
  autres fenêtres), son opacité se règle.
- **Barre du haut** (au-dessus du panneau central) : titre de la page, contenu propre à la page
  (ex. bulle Chips gagnés / Bankroll / Stats), boutons − □ ×. On la tire pour déplacer la
  fenêtre, double-clic ou □ = plein écran de travail ↔ 80 % centré. Bords de la fenêtre
  redimensionnables. Position et taille mémorisées (`fenetre.json`).
- Trois panneaux de verre :
  - **gauche** : marque, navigation, puis les filtres et réglages propres à la page ;
  - **centre** : le contenu principal de la page, qui défile à l'intérieur du panneau (jamais
    sous la barre des tâches) ;
  - **droite** : le détail propre à la page (ligne survolée, chiffres de la sélection…).
- **Blocs libres** sous le contenu de chaque panneau latéral, **par page** : Résumé, CEV,
  Profits, Volume, Challenge en cours (ex. 244 / 4000 · 6 %), Trainer, Précision en jeu. Ajouter,
  glisser pour réordonner, œil pour flouter, croix pour retirer.
- **Paramètres › Disposition** : largeur des panneaux gauche et droite, marge, opacité du verre ;
  inclinaison, redressement au survol et dépliage à l'ouverture activables un par un.
- Animations : le centre apparaît, puis les côtés se déplient depuis l'arrière du centre ;
  changement de page en fondu glissé.
- Graphiques sur fond sombre, lisibles quel que soit le fond d'écran.
- Fenêtre < 1150 px : panneau de droite replié.

## Pages en trois segments

| Page | Gauche | Centre | Droite |
|---|---|---|---|
| Tableau de bord | Filtres | Bulle Chips gagnés / Bankroll / Stats + graphique | Indicateurs (tournois, CEV, rakeback, EV profit…) |
| Stats | Choix des blocs, filtres | Blocs de stats | Détail du bloc survolé |
| Tournois | Filtres | Liste | Tournoi survolé, chiffres de la sélection — **fait** |
| Mains | Filtres, filtres de main | Liste | Main survolée (cartes, ligne, CEV), totaux — **fait** |
| Joueurs | Recherche, tags | Liste des adversaires | Joueur survolé (HU, stats, notes) — **fait** |
| Ranges | Onglets, import/export, spot : format, profondeur, tailles | Coup, grille (ou comparaison) | Actions, mains, EV — **fait** |
| Trainer | Réglages de session | Tables | Score, précision, raccourcis |
| Leak finder | Situations, filtres | Arbre de décision / grille | Stats du nœud choisi |
| Challenges | Liste | Challenge choisi | Rythme, progression |
| Import | Formats, historique | Zone de dépôt, calendrier | Résultat, analyse préflop |
| Paramètres | Rubriques | Réglages | Aide |

## Nouveautés prévues

1. **Leak finder postflop en arbre de décision** (ex. BTN vs BB, pot relancé) : flop → donk /
   check → c-bet / check → fold / call / raise, avec fréquences, nombre de mains et barres de
   répartition par taille de mise ; filtres de tapis (20+ bb, 18-20…), position analysée, héros
   contre tous ou contre un type de joueur.
2. **Comparaison de ranges préflop observées** : grille de fréquences réelles du héros par
   situation (BTN, SB vs BTN, SB vs BB…) et, à côté, celle des réguliers ou d'un type de joueur
   (estimée à partir des mains vues), avec les écarts ; comparaison aussi avec ses propres ranges.
3. **Précision face aux ranges à l'import** (fait) : fenêtre de précision, review des erreurs.

## Plus tard

- Données comparatives (regs, fish, population) et import de données externes.
- Système de comptes (vente ou open source).

## Étapes

1. Coque, décor, design unique, tableau de bord en trois segments — **fait**.
2. Stats, Ranges et Trainer en trois segments.
3. Tournois, Mains, Joueurs, Challenges, Import, Paramètres.
4. Leak finder en arbre postflop et comparaison de ranges observées.
5. Panneaux modulables (déplacer, détacher, redimensionner).
