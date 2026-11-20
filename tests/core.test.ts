import { describe, expect, it } from 'vitest';
import { TerrariumSource, decodeTerrarium, tilesForBand, type ElevationSource } from '../src/core/elevation';
import { destination, distance, worldPixel } from '../src/core/geo';
import { computeHorizon } from '../src/core/horizon';

describe('geo', () => {
  it('worldPixel puts (0,0) at the centre of the z0 tile', () => {
    const [x, y] = worldPixel(0, 0, 0);
    expect(x).toBeCloseTo(128, 6);
    expect(y).toBeCloseTo(128, 6);
  });
  it('destination and distance are consistent', () => {
    const [la, lo] = destination(49.2, 20, 37, 12_345);
    expect(distance(49.2, 20, la, lo)).toBeCloseTo(12_345, 0);
  });
  it('wraps longitude', () => {
    const [, lo] = destination(0, 179.9, 90, 50_000);
    expect(lo).toBeLessThan(-179);
  });
});

describe('terrarium', () => {
  it('decodes elevation', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(130, 5, 128)).toBeCloseTo(517.5, 6);
    expect(decodeTerrarium(0, 0, 0)).toBe(-32768);
  });
  it('plans a modest number of tiles for the Tatras', () => {
    const t = tilesForBand(49.2, 20, 13, 0, 3000);
    expect(t.length).toBeGreaterThan(4);
    expect(t.length).toBeLessThan(40);
    expect(tilesForBand(49.2, 20, 9, 40_000, 100_000).length).toBeLessThan(40);
  });
  it('samples bilinearly', () => {
    const src = new TerrariumSource(async () => null);
    const [wx, wy] = worldPixel(49.2, 20, 13);
    const tx = Math.floor(wx / 256);
    const ty = Math.floor(wy / 256);
    const tile = new Float32Array(256 * 256);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) tile[j * 256 + i] = i; // ramp in x
    src.setTile(13, tx, ty, tile);
    const expected = wx - 0.5 - tx * 256;
    expect(src.elevationAt(49.2, 20, 5000)).toBeCloseTo(expected, 3);
    expect(src.elevationAt(49.2, 20 + 10, 5000)).toBeNaN(); // tile not loaded
  });
  it('falls back to a coarser level where the fine tile is missing', () => {
    const src = new TerrariumSource(async () => null);
    const [wx, wy] = worldPixel(49.2, 20, 9);
    src.setTile(9, Math.floor(wx / 256), Math.floor(wy / 256), new Float32Array(256 * 256).fill(1234));
    expect(src.elevationAt(49.2, 20, 500)).toBeCloseTo(1234, 3); // z13 band asked, only z9 loaded
  });
});

describe('horizon', () => {
  const flat: ElevationSource = { elevationAt: () => 0 };

  it('flat terrain: skyline sits at the geometric dip of the horizon', () => {
    const h = computeHorizon(flat, 49.2, 20, { azStep: 45, maxRange: 60_000 });
    const k = 0.13;
    const dipDeg = -Math.sqrt((2 * 1.5 * (1 - k)) / 6371008.8) * (180 / Math.PI);
    for (const a of h.angles) expect(a).toBeCloseTo(dipDeg, 2);
  });

  it('a mountain appears at its azimuth with the right elevation angle', () => {
    const D = 8000;
    const AZ = 123;
    const base = 800;
    const peakH = 2200;
    const [pLat, pLon] = destination(49.2, 20, AZ, D);
    const mountain: ElevationSource = {
      elevationAt: (la, lo) => {
        const r = distance(la, lo, pLat, pLon);
        return base + Math.max(0, 1 - r / 1500) * (peakH - base);
      },
    };
    const h = computeHorizon(mountain, 49.2, 20, { azStep: 0.5, maxRange: 20_000 });
    let max = -Infinity;
    let at = 0;
    h.angles.forEach((a, i) => {
      if (a > max) {
        max = a;
        at = i;
      }
    });
    expect(at * 0.5).toBeGreaterThan(AZ - 1.5);
    expect(at * 0.5).toBeLessThan(AZ + 1.5);
    // The ridge top is on the near slope, slightly before the summit; check against the geometry bounds.
    const hi = Math.atan2(peakH - (base + 1.5), D - 1500) * (180 / Math.PI);
    const lo = Math.atan2(peakH - (base + 1.5) - (D * D * 0.87) / (2 * 6371008.8), D + 1500) * (180 / Math.PI);
    expect(max).toBeGreaterThan(lo - 0.5);
    expect(max).toBeLessThan(hi + 0.5);
    expect(h.groundElevation).toBeCloseTo(base, 3);
  });
});
