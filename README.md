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

## Jak to działa

- **Dane**: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium PNG, bez klucza). LOD zależny od odległości: z13 (<12 km), z11 (<40 km), z9 (do 100 km). Poziomy z14/15 są pomijane – pokrycie jest dziurawe (puste kafelki „no-data", np. wokół Kasprowego); brakujące piksele/kafelki zastępuje grubszy poziom.
- **Obrys** (`src/core/horizon.ts`): dla każdego azymutu (krok 0,25°) maksimum kąta elewacji wzdłuż promienia, z poprawką na krzywiznę Ziemi i refrakcję (k = 0,13). Liczone w Web Workerze.
- **Widok**: SVG, skala kątowa 1:1 na obu osiach; przesuwanie, kółko/pinch, „360°" i „Dopasuj". „Pobierz SVG" zapisuje pełny pas 360°.

## Dalsze kroki

Podziałka azymutów (5°/1°), szczyty, warstwy grani (odległości punktów obrysu są już zapisywane), dokładniejszy DEM (Copernicus GLO-30 / NMT GUGiK).
