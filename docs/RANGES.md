# Format des ranges (`ranges.json`)

Fichier stocké à côté de la base (`%APPDATA%\com.spintrackerop.desktop\ranges.json`, copie de
la version précédente en `ranges.json.bak`). L'onglet Ranges l'écrit tout seul ; ce document
sert à préparer ou échanger des fichiers (bouton **Importer**).

```json
{
  "version": 1,
  "books": [
    {
      "fmt": "spin3",
      "depth": 25,
      "sizes": { "open": { "BTN": 2, "SB": 3 }, "limp": { "BTN": false, "SB": true },
                 "iso": 3, "threeBet": 3, "maxRaiseFrac": 0.5, "maxRaises": 2 },
      "nodes": {
        "":     { "R2": "22+,A2s+,K5s+,A7o+,KTo+" },
        "R2":   { "C": "22-99,ATs-A2s,KJs", "R6": "TT+,AK", "AI": "A5s:0.5" },
        "R2-F": { "C": "…", "R6": "…" }
      }
    }
  ]
}
```

- `fmt` : `spin3` (BTN, SB, BB) ou `hu` (SB, BB). `depth` : tapis symétrique en bb.
- **Clé d'un spot** : les actions depuis le début du coup, séparées par `-`. `""` = premier
  à parler (BTN en Spin, SB en HU) ; `R2` = BTN a relancé à 2, c'est à SB ; `R2-F` = puis SB
  a fold, c'est à BB ; `F-C` = BTN fold, SB limp, c'est à BB.
- **Actions** : `F` fold, `X` check, `C` call (ou limp), `R<x>` relance à x bb (`R2`, `R6`,
  `R2.5`), `AI` tapis. Les tailles disponibles dépendent de `sizes` (onglet Ranges → ⚙ Tailles).
- **Ranges** : format texte standard, poids optionnel de 0 à 1 après `:` —
  `AA`, `AKs`, `AKo`, `AK` (les deux), `22+`, `A2s+`, `22-66`, `KTo-K8o`, `A5s:0.5`.
- Le fold (ou, sans fold possible, le check / call) n'est pas écrit : il reçoit le reste.
  Un spot présent avec `{}` signifie « 100 % fold ».
