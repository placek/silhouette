import { describe, expect, it } from 'vitest';
import type { ElevationSource } from '../src/core/elevation';
import { bearing, destination, distance } from '../src/core/geo';
import { findVisiblePeaks, overpassQuery, parseOverpass } from '../src/core/peaks';

describe('geo.bearing', () => {
  it('matches destination()', () => {
    for (const az of [0, 37, 90, 181, 270, 359]) {
      const [la, lo] = destination(49.2, 20, az, 25_000);
      expect(bearing(49.2, 20, la, lo)).toBeCloseTo(az, 1);
    }
  });
});

describe('parseOverpass', () => {
  it('parses ele, skips bad rows and same-name duplicates', () => {
    const peaks = parseOverpass({
      elements: [
        { type: 'node', lat: 49.18, lon: 20.09, tags: { name: 'Gerlach', ele: '2654' } },
        { type: 'node', lat: 49.1801, lon: 20.0901, tags: { name: 'Gerlach', ele: '2655' } }, // duplicate (~13 m)
        { type: 'node', lat: 49.2, lon: 20.0, tags: { name: 'Giewont', ele: '1894,5' } },
        { type: 'node', lat: 49.3, lon: 20.0, tags: { name: 'Pagórek', ele: '900' } }, // too low
        { type: 'node', lat: 49.3, lon: 20.0, tags: { ele: '1500' } }, // no name
        { type: 'node', lat: 49.3, lon: 20.0, tags: { name: 'Bez wysokości' } },
      ],
    });
    expect(peaks.map((p) => [p.name, p.ele])).toEqual([
      ['Gerlach', 2654],
      ['Giewont', 1894.5],
    ]);
  });
  it('builds a bounded query', () => {
    expect(overpassQuery(49.2, 20, 115_000)).toContain('(around:115000,49.2000,20.0000)');
  });
});

describe('findVisiblePeaks', () => {
  const O: [number, number] = [49.2, 20];
  // Flat ground at 800 m, plus a ridge 10 km due east that is 1400 m high.
  const [rLat, rLon] = destination(O[0], O[1], 90, 10_000);
  const ridge: ElevationSource = {
    elevationAt: (la, lo) => {
      const r = distance(la, lo, rLat, rLon);
      return r < 1500 ? 1400 : 800;
    },
  };
  const at = (az: number, d: number, ele: number, name: string) => {
    const [lat, lon] = destination(O[0], O[1], az, d);
    return { name, ele, lat, lon };
  };

  it('keeps a summit in the open, hides one behind a ridge, shows one that overtops it', () => {
    const peaks = [
      at(0, 15_000, 1500, 'Open'), // north: nothing in between
      at(90, 20_000, 1500, 'Hidden'), // behind the 1400 m ridge: angle to ridge 0.034 rad > angle to peak 0.021
      at(90, 20_000, 2800, 'Taller'), // overtops the ridge
    ];
    const hits = findVisiblePeaks(ridge, O[0], O[1], peaks);
    expect(hits.map((h) => h.name)).toEqual(['Taller', 'Open']);
    const open = hits.find((h) => h.name === 'Open')!;
    expect(open.az).toBeCloseTo(0, 1);
    expect(open.dist).toBeCloseTo(15_000, -1);
    expect(open.angle).toBeCloseTo((Math.atan2(1500 - 801.5 - 15_000 ** 2 * (0.87 / (2 * 6371008.8)), 15_000) * 180) / Math.PI, 2);
  });

  it('ignores summits beyond range and the one the observer stands on', () => {
    const hits = findVisiblePeaks(ridge, O[0], O[1], [at(0, 150_000, 4000, 'Far'), at(0, 100, 1500, 'Here')]);
    expect(hits).toEqual([]);
  });
});
