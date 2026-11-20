import type { ElevationSource } from './elevation';
import { EARTH_RADIUS, destination } from './geo';

export interface HorizonOptions {
  /** Observer eye height above ground, metres. */
  eyeHeight: number;
  /** How far to look, metres. */
  maxRange: number;
  /** Azimuth resolution, degrees. */
  azStep: number;
  /** Atmospheric refraction coefficient. */
  refraction: number;
}

export const DEFAULT_OPTIONS: HorizonOptions = {
  eyeHeight: 1.5,
  maxRange: 100_000,
  azStep: 0.25,
  refraction: 0.13,
};

export interface Horizon {
  lat: number;
  lon: number;
  azStep: number;
  /** Ground elevation under the observer, metres. */
  groundElevation: number;
  eyeHeight: number;
  /** Elevation angle of the skyline per azimuth sample (index i ↔ i*azStep degrees, 0 = north, clockwise), degrees. */
  angles: Float32Array;
  /** Distance to the skyline point, metres. */
  distances: Float32Array;
  /** Terrain elevation at the skyline point, metres. */
  heights: Float32Array;
}

const DEG = 180 / Math.PI;

/** Skyline = for each azimuth, the maximum elevation angle along the ray (with Earth curvature and refraction). */
export function computeHorizon(
  src: ElevationSource,
  lat: number,
  lon: number,
  options: Partial<HorizonOptions> = {},
): Horizon {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const ground = src.elevationAt(lat, lon, 0);
  const h0 = (Number.isNaN(ground) ? 0 : ground) + o.eyeHeight;
  const n = Math.round(360 / o.azStep);
  const angles = new Float32Array(n);
  const distances = new Float32Array(n);
  const heights = new Float32Array(n);
  const curv = (1 - o.refraction) / (2 * EARTH_RADIUS);

  for (let i = 0; i < n; i++) {
    const az = i * o.azStep;
    let best = -Infinity;
    let bestD = 0;
    let bestH = 0;
    for (let d = 10; d <= o.maxRange; d += Math.max(20, d * 0.005)) {
      const [la, lo] = destination(lat, lon, az, d);
      const h = src.elevationAt(la, lo, d);
      if (Number.isNaN(h)) continue;
      const a = Math.atan2(h - h0 - d * d * curv, d);
      if (a > best) {
        best = a;
        bestD = d;
        bestH = h;
      }
    }
    angles[i] = best === -Infinity ? NaN : best * DEG;
    distances[i] = bestD;
    heights[i] = bestH;
  }
  return {
    lat,
    lon,
    azStep: o.azStep,
    groundElevation: h0 - o.eyeHeight,
    eyeHeight: o.eyeHeight,
    angles,
    distances,
    heights,
  };
}
