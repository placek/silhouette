import type { ElevationSource } from './elevation';
import { bearing, destination, distance } from './geo';
import { DEFAULT_OPTIONS, curvatureCoeff, observerHeight, rayStep, type HorizonOptions } from './horizon';

/** A named summit, e.g. from OpenStreetMap. */
export interface Peak {
  name: string;
  /** Summit elevation, metres. */
  ele: number;
  lat: number;
  lon: number;
}

/** A summit that is visible from the observer. */
export interface PeakHit extends Peak {
  /** Azimuth from the observer, degrees clockwise from north. */
  az: number;
  /** Distance from the observer, metres. */
  dist: number;
  /** Elevation angle of the summit as seen by the observer, degrees. */
  angle: number;
}

/** Minimum summit elevation requested from OSM, metres (keeps the response small). */
export const MIN_PEAK_ELE = 1000;

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export function overpassQuery(lat: number, lon: number, radius: number): string {
  return (
    `[out:json][timeout:25];` +
    `node["natural"="peak"]["name"]["ele"~"^[1-9][0-9]{3}"](around:${Math.round(radius)},${lat.toFixed(4)},${lon.toFixed(4)});` +
    `out body qt;`
  );
}

interface OverpassResponse {
  elements?: { type?: string; lat?: number; lon?: number; tags?: Record<string, string> }[];
}

/** Turns an Overpass response into peaks: parses `ele`, drops bad rows and same-name duplicates within 300 m. */
export function parseOverpass(json: OverpassResponse): Peak[] {
  const out: Peak[] = [];
  for (const e of json.elements ?? []) {
    const name = e.tags?.name?.trim();
    const ele = parseFloat((e.tags?.ele ?? '').replace(',', '.'));
    if (!name || !Number.isFinite(ele) || ele < MIN_PEAK_ELE || e.lat == null || e.lon == null) continue;
    if (out.some((p) => p.name === name && distance(p.lat, p.lon, e.lat!, e.lon!) < 300)) continue;
    out.push({ name, ele, lat: e.lat, lon: e.lon });
  }
  return out;
}

/** Fetches summits around a point from Overpass, trying the mirrors in turn. */
export async function fetchPeaks(lat: number, lon: number, radius: number): Promise<Peak[]> {
  let lastError: unknown;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30_000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(overpassQuery(lat, lon, radius)),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
        return parseOverpass(await res.json());
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Overpass unavailable');
}

export interface VisibilityOptions extends Pick<HorizonOptions, 'eyeHeight' | 'maxRange' | 'refraction'> {
  /** A summit counts as visible if terrain in front reaches at most this many degrees above its top. */
  toleranceDeg: number;
  /** Summits closer than this are ignored (observer is practically on them), metres. */
  minDistance: number;
}

export const DEFAULT_VISIBILITY: VisibilityOptions = {
  eyeHeight: DEFAULT_OPTIONS.eyeHeight,
  maxRange: DEFAULT_OPTIONS.maxRange,
  refraction: DEFAULT_OPTIONS.refraction,
  toleranceDeg: 0.1,
  minDistance: 300,
};

const DEG = 180 / Math.PI;

/**
 * Which of the given summits can the observer see? A summit is visible when no terrain along the line to it
 * subtends a larger elevation angle than the summit itself (same curvature/refraction model as the skyline).
 * Result is sorted from the highest summit down.
 */
export function findVisiblePeaks(
  src: ElevationSource,
  lat: number,
  lon: number,
  peaks: Peak[],
  options: Partial<VisibilityOptions> = {},
): PeakHit[] {
  const o = { ...DEFAULT_VISIBILITY, ...options };
  const h0 = observerHeight(src, lat, lon, o.eyeHeight);
  const curv = curvatureCoeff(o.refraction);
  const hits: PeakHit[] = [];

  for (const p of peaks) {
    const dist = distance(lat, lon, p.lat, p.lon);
    if (dist < o.minDistance || dist > o.maxRange) continue;
    const az = bearing(lat, lon, p.lat, p.lon);
    const angle = Math.atan2(p.ele - h0 - dist * dist * curv, dist) * DEG;

    // March up to just short of the summit: the DEM around the top may be a little higher than the OSM point.
    const stop = dist - Math.max(150, dist * 0.01);
    let blocked = false;
    for (let d = 10; d <= stop; d += rayStep(d)) {
      const [la, lo] = destination(lat, lon, az, d);
      const h = src.elevationAt(la, lo, d);
      if (Number.isNaN(h)) continue;
      if (Math.atan2(h - h0 - d * d * curv, d) * DEG > angle + o.toleranceDeg) {
        blocked = true;
        break;
      }
    }
    if (!blocked) hits.push({ ...p, az, dist, angle });
  }
  return hits.sort((a, b) => b.ele - a.ele);
}
