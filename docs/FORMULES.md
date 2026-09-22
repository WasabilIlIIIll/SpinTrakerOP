# Formules de Spin Tracker OP

Toutes les métriques sont calculées localement, à partir de vos historiques de mains.
Ce document décrit **exactement** ce que fait le code, afin que chaque chiffre soit vérifiable.

Notations :

- `S` = tapis de départ d'un spin (500 jetons sur PMU/Winamax)
- `N` = nombre de joueurs (3, ou 2 en tête-à-tête)
- `T = N × S` = total des jetons en jeu (1500)
- `b` = buy-in total (ex. 5 €), `r` = rake (ex. 0,35 €), `c = b − r` = part prize pool (ex. 4,65 €)
- `rb` = taux de rakeback (ex. 10 %)

---

## 1. Résultat d'une main (jetons)

Pour chaque joueur :

```
contribution  = somme des jetons mis au pot (blinds, antes, call, bet, raise)
mise rendue   = plus grosse contribution − deuxième plus grosse contribution
net           = gains − (contribution − mise rendue éventuelle)
```

La mise non suivie est rendue au joueur qui a misé le plus. Selon la room, le champ
« gains » de l'historique inclut ou non cette mise rendue ; Spin Tracker OP détecte le cas
en comparant la somme des gains au pot réel.

**Invariant vérifié par les tests** : sur chaque main, `Σ net = 0`, et le tapis de fin de main
d'un joueur correspond à son tapis de début de main suivante.

---

## 2. EV « all-in ajusté » (chips EV)

Quand un tapis est engagé avant la river et que le board est ensuite distribué sans autre
décision, le résultat réel est remplacé par son espérance :

1. On repère la dernière action volontaire de la main (`street s`).
   Si `s < river` et qu'il y a eu un all-in et au moins deux joueurs à l'abattage, la main est « ajustée ».
2. Les pots (principal + side pots) sont reconstruits par paliers de contribution.
3. Pour chaque pot, on calcule la probabilité de victoire de chaque joueur éligible :
   - flop ou turn connus → **énumération exacte** de tous les boards restants (990 ou 44) ;
   - préflop → **Monte-Carlo déterministe** de 20 000 à 25 000 tirages
     (graine dérivée de l'identifiant de main : le résultat est donc toujours reproductible).
4. `EV(joueur) = Σ_pots (part du pot) − contribution effective`.

Les partages (split pots) sont gérés. L'écart-type de cette variable aléatoire est également
calculé, il sert à l'indicateur de chance.

Si les cartes d'un joueur encore en jeu sont inconnues, la main n'est pas ajustée (`EV = réel`).

---

## 3. CEV

```
CEV          = moyenne des « chips EV » gagnés par tournoi
CEV / main   = total des chips EV / nombre de mains
IC 95 %      = 1,96 × écart-type(chips EV par tournoi) / √(nombre de tournois)
```

Le graphique « Chips gagnés » affiche le cumul, et la barre verticale de droite représente
l'intervalle de confiance à 95 % du CEV extrapolé sur l'échantillon.

---

## 4. Probabilités de place

À partir des jetons EV d'un tournoi, le tapis final espéré du héros vaut `x = S + evchips`.
Comme le Spin est un tournoi « winner takes all » (hors jackpots), la probabilité de victoire
sous l'hypothèse chip-EV est exactement proportionnelle aux jetons :

```
P(1er) = x / T
```

Pour les 2ᵉ et 3ᵉ places (utiles seulement quand le multiplicateur partage le prize pool),
on utilise le modèle **Malmuth-Harville** avec deux adversaires de tapis égaux `y = (T − x)/2` :

```
P(2e) = 2 × (y / T) × x / (T − y)
P(3e) = 1 − P(1er) − P(2e)
```

---

## 5. Espérance de gain d'un tournoi

La table de multiplicateurs (éditable) donne, pour chaque multiplicateur `m`, sa probabilité
`p(m)` et la répartition du prize pool `share_k(m)` pour la place `k`.

Comme les probabilités publiées par les rooms changent souvent, la table est **renormalisée**
sur le retour réel au joueur, qui lui est certain (il se lit dans le buy-in) :

```
λ = (N × c / b) / Σ_m p(m)·m          (facteur de normalisation)
E_k = b × Σ_m p(m)·m·λ·share_k(m)     (gain espéré à la place k, en €)
```

Sur un Twister 5 € : `N × c / b = 3 × 4,65 / 5 = 2,79`, donc le prize pool moyen vaut 13,95 €.

Les quatre mesures de profit, toutes rakeback inclus (`+ rb × r` par tournoi) :

| Mesure | Formule | Ce qu'elle neutralise |
|---|---|---|
| **Profit réel** | `gains − b` | rien |
| **EV Profit** | `Σ_k P(k)·E_k − b` | la chance aux all-in **et** aux multiplicateurs |
| **EV Multi-profit** | `prize pool réel × Σ_k P(k)·share_k − b` | la chance aux all-in seulement |
| **EV Profit effectif** | `E_(place réelle) − b` | la chance aux multiplicateurs seulement |

Ainsi : `EV Multi-profit − EV Profit` mesure votre chance aux multiplicateurs, et
`Profit réel − EV Profit effectif` mesure votre chance aux all-in, exprimée en euros.

---

## 6. CEV minimum (seuil de rentabilité)

C'est la valeur `c*` de CEV telle que l'EV Profit total de la sélection soit nul :

```
Σ_tournois [ Σ_k P_k(S + c*)·E_k − b + rb·r ] = 0
```

Résolu par dichotomie (60 itérations) sur l'ensemble des tournois filtrés. En winner-takes-all,
la solution analytique est `c* = T × (b − rb·r) / E_1 − S`.

Exemple (Twister 5 €, 10 % de rakeback) : `P(1er) minimum = (5 − 0,035)/13,95 = 35,6 %`,
soit `c* = 1500 × 0,356 − 500 ≈ 34` jetons par spin.

---

## 7. Indicateur de chance

```
z = (chips réels − chips EV) / √(Σ variances des situations all-in)
```

| z | Libellé |
|---|---|
| ≤ −2 | Très malchanceux |
| −2 … −1 | Malchanceux |
| −1 … 1 | Neutre (chance normale) |
| 1 … 2 | Chanceux |
| ≥ 2 | Très chanceux |

---

## 8. Temps de jeu et multi-tabling

- **Temps joué** = union des intervalles `[début, fin]` des tournois : deux spins joués en
  parallèle ne comptent qu'une fois.
- **Tables simultanées** d'un tournoi `i` = `Σ_j chevauchement(i, j) / durée(i)` (moyenne
  pondérée par le temps, toujours ≥ 1).
- **€/h par nombre de tables `k`** = profit du groupe / (somme des durées des tournois du groupe ÷ k).

---

## 8 bis. Attribution des résultats à un adversaire

Un spin à 3 joueurs ne peut pas être attribué à un seul adversaire : votre place dépend aussi
du troisième joueur. La fiche et la liste des joueurs affichent donc en priorité les mesures
**restreintes au tête-à-tête** (`CEV HU`, `Profit HU`), calculées uniquement sur les spins où
vous vous êtes retrouvés seuls face à face. Les colonnes « tous spins » restent disponibles,
grisées, à titre indicatif.

Rappel : une perte sur un spin vaut **au maximum le buy-in engagé** (5 € sur un Twister 5 €),
quel que soit le multiplicateur tiré — c'est bien ce que calcule `profit = gains − buy-in`.

## 9. Statistiques joueurs

| Stat | Définition |
|---|---|
| VPIP | % de mains avec mise volontaire préflop |
| PFR | % de mains avec relance préflop |
| Limp BTN | % des mains BTN « premier de parole » jouées en limp |
| Shove BTN | idem, all-in |
| 3-bet | % de relances face à une première relance, quand l'occasion se présente |
| Call vs shove (BB) | % d'appels en BB face à un tapis |
| AF | (mises + relances postflop) / appels postflop |
| WTSD | % d'abattages après avoir vu le flop |
| W$SD | % d'abattages gagnés |
| C-bet | % de mises au flop en tant que dernier relanceur préflop |
| Fold vs c-bet | % d'abandons face à une c-bet |

Les tags automatiques appliquent des règles sur ces statistiques (voir onglet Joueurs → Tags).

---

## 10. Leak finder

Chaque décision préflop est rangée dans un **nœud** identifié par :

- le scénario de position (BTN, SB vs BTN, SB vs BB, BB vs BTN, BB vs SB, HU SB, HU BB) ;
- l'historique des actions adverses depuis votre dernière action
  (ex. `vs BTN Open`, `Open → vs SB 3B all-in`, `vs BTN Limp + SB Call`) ;
- la tranche de tapis effectif en BB (0-4, 4-6, …, 20+),
  où tapis effectif = min(votre tapis, plus gros tapis adverse).

Vos fréquences (All-in / Relance / Call / Fold) sont comparées à une **référence**. Spin Tracker OP
ne contient **aucune solution GTO** : toutes les références sont statistiques et calculées sur vos
propres historiques. Trois sources au choix :

| Référence | D'où elle vient |
|---|---|
| **Population** | tous les autres joueurs présents dans vos historiques, dans le même nœud et la même tranche de tapis |
| **Tag** (ex. « Reg ») | uniquement les joueurs portant ce tag — utile pour se comparer aux réguliers de vos parties |
| **Personnalisée** | vos propres cibles, saisies dans Paramètres → Références (par exemple issues d'un solveur) |

La taille de l'échantillon de référence est affichée sur chaque nœud (« réf. n »).
La tolérance s'adapte à la taille de **votre** échantillon : `tolérance = 4 % + 40/√n`.
Vert = écart inférieur à la tolérance, orange = jusqu'à 2,2 × la tolérance, rouge au-delà,
gris en dessous de 8 décisions (échantillon trop faible pour conclure).
