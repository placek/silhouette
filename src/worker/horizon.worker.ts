import { TerrariumSource } from '../core/elevation';
import { computeHorizon, DEFAULT_OPTIONS, type Horizon } from '../core/horizon';
import { fetchPeaks, findVisiblePeaks, type Peak, type PeakHit } from '../core/peaks';

export interface ComputeRequest {
  id: number;
  lat: number;
  lon: number;
}
export type WorkerMessage =
  | { id: number; type: 'progress'; stage: 'tiles' | 'compute'; done: number; total: number }
  | { id: number; type: 'result'; horizon: Horizon }
  | { id: number; type: 'peaks'; peaks: PeakHit[]; candidates: number }
  | { id: number; type: 'peaks-error'; message: string }
  | { id: number; type: 'error'; message: string };

const ctx = self as unknown as Worker;
const source = new TerrariumSource();
let chain: Promise<void> = Promise.resolve();
let latest = 0;

// Overpass results are cached per ~0.1° cell; the query radius leaves room for the cell offset.
const PEAK_RADIUS = DEFAULT_OPTIONS.maxRange + 15_000;
const peakCache = new Map<string, Promise<Peak[]>>();
function peaksAround(lat: number, lon: number): Promise<Peak[]> {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  let hit = peakCache.get(key);
  if (!hit) {
    hit = fetchPeaks(Math.round(lat * 10) / 10, Math.round(lon * 10) / 10, PEAK_RADIUS);
    hit.catch(() => peakCache.delete(key)); // do not cache failures
    peakCache.set(key, hit);
  }
  return hit;
}

ctx.onmessage = (ev: MessageEvent<ComputeRequest>) => {
  const req = ev.data;
  latest = req.id;
  chain = chain.then(() => run(req));
};

async function run({ id, lat, lon }: ComputeRequest): Promise<void> {
  if (id !== latest) return; // superseded by a newer request
  const post = (m: WorkerMessage) => ctx.postMessage(m);
  try {
    await source.preload(lat, lon, DEFAULT_OPTIONS.maxRange, (done, total) =>
      post({ id, type: 'progress', stage: 'tiles', done, total }),
    );
    if (id !== latest) return;
    post({ id, type: 'progress', stage: 'compute', done: 0, total: 1 });
    const horizon = computeHorizon(source, lat, lon);
    post({ id, type: 'result', horizon });
    // Summits are best-effort: the panorama is already shown, a failure here must not hide it.
    try {
      const candidates = await peaksAround(lat, lon);
      if (id !== latest) return;
      post({ id, type: 'peaks', peaks: findVisiblePeaks(source, lat, lon, candidates), candidates: candidates.length });
    } catch (e) {
      post({ id, type: 'peaks-error', message: e instanceof Error ? e.message : String(e) });
    }
  } catch (e) {
    post({ id, type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}
