# Hvert felt én gang

Seks simple spil med samme regel: brug hvert felt præcis én gang. Banerne er små, hver har nøjagtig én løsning,
og de er fundet af en computer, der har gennemsøgt millioner af baner efter dem, hvor fælderne først afslører sig sent.

Den spilbare version ligger i `docs/` og vises med GitHub Pages.

## Spillene

| Spil | Regler |
| --- | --- |
| **Kun én vej** | Én brik. Gå felt for felt, og besøg hvert felt præcis én gang. |
| **I takt** | To brikker, én styring. Begge flytter samme vej; en brik der ikke kan, bliver stående. |
| **Glatis** | Is forsvinder aldrig, men på is glider man, til man rammer et felt (og lander på det) eller noget man ikke kan gå på. |
| **Korsvej** | Kryds forsvinder aldrig, så man kan gå over dem lige så tit, man vil. |
| **Postløb** | Nummererede poster skal tages i rækkefølge; post 2 kan ikke betrædes, før man har stået på post 1. |
| **Mesterprøven** | To brikker med fælles styring, is og kryds. Is stopper på kryds; på samme linje flytter den forreste brik først. |

## Mapper

| Mappe | Indhold |
| --- | --- |
| `docs/` | Den offentlige side (genereres). Ingen løsninger og ingen sværhedstal i siden. |
| `dev/` | Udviklerversionen: samme spil, men tasten L (to tryk) viser løsningen. Build-scriptene skriver banerne herind. |
| `tools/` | Solvere, generatorer, build-scripts og tests (Node 18+, ingen afhængigheder). |
| `data/` | Kandidatbaner fra søgningerne, så siderne kan bygges uden at søge forfra. |

Begge sider er selvstændige HTML-filer uden afhængigheder ud over Google Fonts.
Motoren (`tools/mix.js`) lægges ind i siderne af `tools/build-public.js`.

## Byg siderne

```
npm run build          # alle baner ind i dev/index.html, og derefter docs/index.html
npm run build:public   # kun docs/index.html ud fra dev/index.html
```

Ved brættet er der kun én knap: *Forfra*, som bliver grøn og går til næste bane, når banen er løst.
På mobil passer spillet på én skærm, og reglerne ligger bag info-ikonet.
Tastatur: piletaster/WASD flytter, Z fortryder, R starter forfra, N/Enter går videre efter en løst bane,
H tjekker kursen. "Tjek kurs" regner selv i browseren (med `solvableFrom` i motoren), om banen stadig kan
løses fra den aktuelle stilling, så den offentlige side behøver ikke at indeholde løsningerne.

## Find nye baner

Generatorerne kører på alle kerner og fletter de bedste kandidater ind i `data/`:

```
node tools/gen.js exhaustive 5         # Kun én vej: alle 2^25 baner på 5x5
node tools/gen.js anneal 6 300         # Kun én vej: simulated annealing i 300 s
node tools/gen-twins.js anneal 6 600   # I takt
node tools/gen-ice.js anneal 5 300     # Glatis
node tools/gen-mix.js kryds 5 300      # Korsvej
node tools/gen-mix.js mester 5 300     # Mesterprøven
node tools/gen-post.js 5 300           # Postløb
npm run build
```

`node tools/check.js 6` viser analysen af de bedste "Kun én vej"-baner.

Baneformat: `#` felt, `.` hul, `~` is, `+` kryds, `1`-`9` poster, `S` start, `A`/`B` to brikker,
`a`/`b` en brik der starter på et kryds.

## Tests

```
npm test            # hurtige krydstjek (ca. 1 minut)
npm run test:all    # også den store test af den fælles motor (ca. 10 minutter)
```

| Variant | Solver | Generator | Bygger | Krydstjek |
| --- | --- | --- | --- | --- |
| Kun én vej | `solver.js` | `gen.js` | `build.js` | `test.js` |
| I takt | `twins.js` | `gen-twins.js` | `build-twins.js` | `test-twins.js` |
| Glatis | `ice.js` | `gen-ice.js` | `build-ice.js` | `test-ice.js` |
| Korsvej, Mesterprøven, Postløb | `mix.js` | `gen-mix.js`, `gen-post.js` | `build-mix.js` | `test-mix.js`, `test-solvable.js` |

`mix.js` er en generel motor (1-2 brikker, felter, huller, is, kryds, poster), der dækker alle seks varianter.
`test-mix.js` tjekker, at den giver præcis samme antal løsninger som de specialiserede solvere og som en
uafhængig, naiv implementering. `test-solvable.js` tjekker "Tjek kurs"-funktionen på samme måde.

## Sværhedsmålet

En "fornuftig spiller" laver aldrig et træk, der straks gør banen umulig på en måde, man kan se: et felt der ikke
kan nås, flere tvungne slutfelter, eller resterende felter der er delt op, så brikkerne ikke kan nå dem alle.
Med lookahead `L` kan spilleren desuden se, at et træk er dødt, hvis alle fortsættelser dør inden for `L` træk.
`P[L]` er chancen for at løse banen i første forsøg ved tilfældigt valg blandt de træk, der stadig ser mulige ud,
og `bits[L] = -log2 P[L]`.

**score = sum af bits[L] for L = 0..8.** Dybe fælder tæller med i mange led og vægter derfor tungest.
Kun baner med præcis én løsning gemmes. Variant-specifikke krav:

- **Kun én vej:** op til 6 ekstra point, hvis "tag kanter/hjørner først" (Warnsdorff) ikke løser banen.
- **I takt:** begge brikker skal svinge mindst 2 gange og dække mindst en fjerdedel af felterne.
- **Glatis, Korsvej, Mesterprøven:** et "træk" er et tryk, der bruger nye felter; bevægelse på is og kryds imellem
  er gratis. Glatis skal glide på is mindst 2 gange, Korsvej skal ende på et kryds mindst 2 gange, og Mesterprøven
  skal bruge både is og kryds, med mindst en femtedel af felterne til hver brik.
- **Postløb:** posterne skal gøre en forskel: uden numrene må banen ikke have en unik løsning.

Ved udvælgelsen af baner til spillet frasorteres baner, der kun adskiller sig ved pynt, eller hvis løsning ligner en
allerede valgt banes for meget.
