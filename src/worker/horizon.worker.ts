import { TerrariumSource } from '../core/elevation';
import { computeHorizon, DEFAULT_OPTIONS, type Horizon } from '../core/horizon';

export interface ComputeRequest {
  id: number;
  lat: number;
  lon: number;
}
export type WorkerMessage =
  | { id: number; type: 'progress'; stage: 'tiles' | 'compute'; done: number; total: number }
  | { id: number; type: 'result'; horizon: Horizon }
  | { id: number; type: 'error'; message: string };

const ctx = self as unknown as Worker;
const source = new TerrariumSource();
let chain: Promise<void> = Promise.resolve();
let latest = 0;

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
  } catch (e) {
    post({ id, type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}
