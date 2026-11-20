# Silhouette

Przeglądarka panoram: wskazujesz punkt na mapie (klik, przeciągnięcie pinezki lub współrzędne), a aplikacja rysuje obrys terenu widoczny z tego miejsca (oko 1,5 m nad ziemią), z opcjonalnymi znacznikami stron świata. Start: Tatry.

## Uruchomienie

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # testy rdzenia
npm run build    # statyczny build w dist/
```

Aplikacja jest w pełni kliencka (bez backendu). Można podać pozycję w URL: `/#49.2992,19.9496`.

## Deploy (GitHub Pages)

Workflow `.github/workflows/deploy.yml` buduje i publikuje `dist/` przy każdym pushu na `main` (najpierw testy). Adres: https://placek.github.io/silhouette/

Jednorazowo: w repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Jak to działa

- **Dane**: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium PNG, bez klucza). LOD zależny od odległości: z13 (<12 km), z11 (<40 km), z9 (do 100 km). Poziomy z14/15 są pomijane – pokrycie jest dziurawe (puste kafelki „no-data", np. wokół Kasprowego); brakujące piksele/kafelki zastępuje grubszy poziom.
- **Obrys** (`src/core/horizon.ts`): dla każdego azymutu (krok 0,25°) maksimum kąta elewacji wzdłuż promienia, z poprawką na krzywiznę Ziemi i refrakcję (k = 0,13). Liczone w Web Workerze.
- **Widok**: SVG, skala kątowa 1:1 na obu osiach; przesuwanie, kółko/pinch, „360°" i „Dopasuj". „Pobierz SVG" zapisuje pełny pas 360°.

## Szczyty

Przycisk „Szczyty" włącza etykiety widocznych szczytów (nazwa + wysokość, markery, układane piętrowo bez kolizji; po przybliżeniu pojawia się ich więcej).

- **Dane**: nazwane węzły OSM `natural=peak` z `ele` ≥ 1000 m, pobierane w przeglądarce (w workerze) z publicznego Overpass API (`overpass-api.de`, zapasowo `overpass.kumi.systems`) w promieniu ~115 km. Wynik jest cache'owany per komórka ~0,1°. Awaria Overpass nie psuje panoramy – tylko brakuje szczytów.
- **Widoczność** (`src/core/peaks.ts`): szczyt jest widoczny, gdy żaden teren na linii wzroku nie ma większego kąta elewacji niż sam szczyt (ten sam model krzywizny/refrakcji co obrys, tolerancja 0,1°). To heurystyka na DEM o rozdzielczości kafelków, więc granicznych przypadków (szczyt tuż za granią) nie należy traktować jako pewnych.
- Eksport SVG zawiera etykiety, jeśli przycisk jest włączony.

## Dalsze kroki

Podziałka azymutów (5°/1°), warstwy grani (odległości punktów obrysu są już zapisywane), dokładniejszy DEM (Copernicus GLO-30 / NMT GUGiK).
