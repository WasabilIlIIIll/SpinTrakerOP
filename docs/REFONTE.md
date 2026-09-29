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

- Décor : salle de poker chaude et floue (lampe, fenêtre, table de feutre au sol, lumières qui
  dérivent lentement). Fabriqué en CSS, aucune image sous droits.
- Trois panneaux de verre dépoli (flou d'arrière-plan, liseré lumineux) :
  - **gauche** : marque, navigation, puis les filtres et réglages propres à la page ;
  - **centre** : le contenu principal de la page ;
  - **droite** : les chiffres et détails de la page (par défaut : résumé des chiffres clés).
- Les panneaux latéraux sont inclinés vers l'utilisateur (14°) et se redressent au survol.
- Animations d'arrivée : le centre apparaît, puis les côtés pivotent en place ; changement de page
  en fondu glissé.
- Fenêtres et menus en verre fumé au-dessus des panneaux.
- Écrans < 1200 px : panneau de droite replié ; < 1500 px : panneaux plus étroits.
- Plus tard : panneaux détachables, déplaçables et redimensionnables, disposition mémorisée.

## Pages en trois segments

| Page | Gauche | Centre | Droite |
|---|---|---|---|
| Tableau de bord | Filtres | Bulle Chips gagnés / Bankroll / Stats + graphique | Indicateurs (tournois, CEV, rakeback, EV profit…) |
| Stats | Choix des blocs, filtres | Blocs de stats | Détail du bloc survolé |
| Tournois / Mains | Filtres de liste | Liste | Détail de la ligne choisie (replayer compact) |
| Joueurs | Recherche, tags | Liste des adversaires | Fiche du joueur (HU, notes) |
| Ranges | Spot : format, profondeur, coup | Grille (ou comparaison) | Actions, mains, EV |
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
