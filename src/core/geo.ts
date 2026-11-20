export const EARTH_RADIUS = 6371008.8;
const RAD = Math.PI / 180;

/** Point reached from (lat, lon) travelling `dist` metres on bearing `azDeg` (great circle). */
export function destination(lat: number, lon: number, azDeg: number, dist: number): [number, number] {
  const d = dist / EARTH_RADIUS;
  const th = azDeg * RAD;
  const p1 = lat * RAD;
  const l1 = lon * RAD;
  const sinP2 = Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th);
  const p2 = Math.asin(sinP2);
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * sinP2);
  return [p2 / RAD, ((((l2 / RAD) % 360) + 540) % 360) - 180];
}

/** Great-circle distance in metres. */
export function distance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Web-Mercator world pixel coordinates at zoom `z` (256 px tiles). */
export function worldPixel(lat: number, lon: number, z: number): [number, number] {
  const n = 256 * 2 ** z;
  const s = Math.sin(lat * RAD);
  const x = ((lon + 180) / 360) * n;
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return [x, y];
}

/** Ground size of one Web-Mercator pixel at given latitude and zoom, metres. */
export function metersPerPixel(lat: number, z: number): number {
  return (156543.03392 * Math.cos(lat * RAD)) / 2 ** z;
}
