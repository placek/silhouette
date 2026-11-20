import { metersPerPixel, worldPixel } from './geo';

/** Anything that can answer "how high is the terrain here?". `distance` hints at the needed resolution. */
export interface ElevationSource {
  /** Elevation in metres, or NaN when no data is available. */
  elevationAt(lat: number, lon: number, distance: number): number;
}

/** Level-of-detail bands: finer tiles near the observer, coarser far away. */
export interface LodBand {
  z: number;
  /** Band covers distances up to this value (metres). */
  maxDist: number;
}

export const DEFAULT_BANDS: LodBand[] = [
  // z14/z15 are not used: coverage is patchy (e.g. empty no-data tiles around Kasprowy Wierch).
  { z: 13, maxDist: 12_000 },
  { z: 11, maxDist: 40_000 },
  { z: 9, maxDist: Infinity },
];

/** AWS Open Data "Terrain Tiles", Terrarium encoding. */
export const TERRARIUM_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/** Anything below this (m) is treated as missing data. */
export const NO_DATA_BELOW = -1000;

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export interface TileId {
  z: number;
  x: number;
  y: number;
}

/** Tiles needed to cover the annulus [rMin, rMax] around the observer at zoom z. */
export function tilesForBand(lat: number, lon: number, z: number, rMin: number, rMax: number): TileId[] {
  const [cx, cy] = worldPixel(lat, lon, z);
  const mpp = metersPerPixel(lat, z);
  const rMaxPx = rMax / mpp;
  const rMinPx = rMin / mpp;
  const n = 2 ** z;
  const x0 = Math.max(0, Math.floor((cx - rMaxPx) / 256));
  const x1 = Math.min(n - 1, Math.floor((cx + rMaxPx) / 256));
  const y0 = Math.max(0, Math.floor((cy - rMaxPx) / 256));
  const y1 = Math.min(n - 1, Math.floor((cy + rMaxPx) / 256));
  const out: TileId[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nearX = Math.max(x * 256 - cx, 0, cx - (x + 1) * 256);
      const nearY = Math.max(y * 256 - cy, 0, cy - (y + 1) * 256);
      const farX = Math.max(Math.abs(x * 256 - cx), Math.abs((x + 1) * 256 - cx));
      const farY = Math.max(Math.abs(y * 256 - cy), Math.abs((y + 1) * 256 - cy));
      if (Math.hypot(nearX, nearY) > rMaxPx) continue;
      if (Math.hypot(farX, farY) < rMinPx) continue;
      out.push({ z, x, y });
    }
  }
  return out;
}

export type TileFetcher = (z: number, x: number, y: number) => Promise<Float32Array | null>;

/** Downloads and decodes one Terrarium tile into 256*256 elevations (browser/worker only). */
export const fetchTerrariumTile: TileFetcher = async (z, x, y) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(TERRARIUM_URL(z, x, y));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bmp = await createImageBitmap(await res.blob(), {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      });
      const canvas = new OffscreenCanvas(256, 256);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      const { data } = ctx.getImageData(0, 0, 256, 256);
      const out = new Float32Array(256 * 256);
      let valid = 0;
      for (let i = 0; i < out.length; i++) {
        const v = decodeTerrarium(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
        // Terrarium uses -32768 for "no data".
        if (v < NO_DATA_BELOW) out[i] = NaN;
        else {
          out[i] = v;
          valid++;
        }
      }
      return valid > 0 ? out : null;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  return null;
};

const tileKey = (z: number, x: number, y: number) => (z * 16384 + x) * 16384 + y;

export class TerrariumSource implements ElevationSource {
  private tiles = new Map<number, Float32Array | null>();
  private lastKey = -1;
  private lastTile: Float32Array | null = null;

  constructor(
    private fetcher: TileFetcher = fetchTerrariumTile,
    private bands: LodBand[] = DEFAULT_BANDS,
  ) {}

  /** Fetch every tile needed for a view from (lat, lon) out to maxRange. */
  async preload(
    lat: number,
    lon: number,
    maxRange: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    const wanted: TileId[] = [];
    // Every band is loaded from distance 0: coarser levels double as fallback where finer tiles have gaps.
    let prevMax = 0;
    for (const band of this.bands) {
      if (prevMax >= maxRange) break;
      wanted.push(...tilesForBand(lat, lon, band.z, 0, Math.min(band.maxDist, maxRange)));
      prevMax = band.maxDist;
    }
    const todo = wanted.filter((t) => !this.tiles.has(tileKey(t.z, t.x, t.y)));
    let done = 0;
    onProgress?.(0, todo.length);
    const queue = [...todo];
    const worker = async () => {
      for (let t = queue.pop(); t; t = queue.pop()) {
        this.tiles.set(tileKey(t.z, t.x, t.y), await this.fetcher(t.z, t.x, t.y));
        onProgress?.(++done, todo.length);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
  }

  /** Inject a tile directly (tests, offline data). */
  setTile(z: number, x: number, y: number, data: Float32Array | null): void {
    this.tiles.set(tileKey(z, x, y), data);
    this.lastKey = -1;
  }

  elevationAt(lat: number, lon: number, distance: number): number {
    let i = this.bands.length - 1;
    for (let k = 0; k < this.bands.length; k++) {
      if (distance <= this.bands[k].maxDist) {
        i = k;
        break;
      }
    }
    // Finest suitable level first; fall back to coarser ones where tiles or pixels are missing.
    for (; i < this.bands.length; i++) {
      const v = this.sample(lat, lon, this.bands[i].z);
      if (!Number.isNaN(v)) return v;
    }
    return NaN;
  }

  private sample(lat: number, lon: number, z: number): number {
    const [wx, wy] = worldPixel(lat, lon, z);
    // Pixel centres sit at +0.5.
    const fx = wx - 0.5;
    const fy = wy - 0.5;
    const tx = Math.floor(fx / 256);
    const ty = Math.floor(fy / 256);
    const key = tileKey(z, tx, ty);
    let tile: Float32Array | null;
    if (key === this.lastKey) tile = this.lastTile;
    else {
      tile = this.tiles.get(key) ?? null;
      this.lastKey = key;
      this.lastTile = tile;
    }
    if (!tile) return NaN;
    // Bilinear inside the tile; indices clamped at tile edges (< 1 px error).
    const lx = fx - tx * 256;
    const ly = fy - ty * 256;
    const ix = Math.floor(lx);
    const iy = Math.floor(ly);
    const ax = lx - ix;
    const ay = ly - iy;
    const ix1 = Math.min(ix + 1, 255);
    const iy1 = Math.min(iy + 1, 255);
    const i0 = Math.max(ix, 0);
    const j0 = Math.max(iy, 0);
    const v00 = tile[j0 * 256 + i0];
    const v10 = tile[j0 * 256 + ix1];
    const v01 = tile[iy1 * 256 + i0];
    const v11 = tile[iy1 * 256 + ix1];
    return (v00 * (1 - ax) + v10 * ax) * (1 - ay) + (v01 * (1 - ax) + v11 * ax) * ay;
  }
}
