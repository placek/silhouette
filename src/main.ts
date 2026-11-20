import './style.css';
import type { Horizon } from './core/horizon';
import { MapView } from './ui/map';
import { PanoramaView } from './ui/panorama';
import type { ComputeRequest, WorkerMessage } from './worker/horizon.worker';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const info = $('info');
const coordInput = $<HTMLInputElement>('coord');
const downloadBtn = $<HTMLButtonElement>('download');
const cardinalsBtn = $<HTMLButtonElement>('toggle-cardinals');
const peaksBtn = $<HTMLButtonElement>('toggle-peaks');
let elevationText = '';
let peaksText = '';

const updateInfo = () => {
  info.textContent = [elevationText, peaksText].filter(Boolean).join(' · ');
};

const pano = new PanoramaView($('pano'));
const worker = new Worker(new URL('./worker/horizon.worker.ts', import.meta.url), { type: 'module' });

let requestId = 0;
let debounce = 0;

export function parseCoords(text: string): [number, number] | null {
  const m = text.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(',', '.'));
  const lon = parseFloat(m[2].replace(',', '.'));
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  return [lat, lon];
}

const map = new MapView($('map'), (lat, lon) => setObserver(lat, lon, false));

function setObserver(lat: number, lon: number, recenter: boolean) {
  coordInput.value = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  coordInput.classList.remove('bad');
  history.replaceState(null, '', `#${lat.toFixed(5)},${lon.toFixed(5)}`);
  map.setObserver(lat, lon, recenter);
  if (recenter) map.map.setView([lat, lon], Math.max(map.map.getZoom(), 11));
  window.clearTimeout(debounce);
  debounce = window.setTimeout(() => compute(lat, lon), 120);
}

function compute(lat: number, lon: number) {
  const id = ++requestId;
  elevationText = 'Pobieranie danych terenu…';
  peaksText = '';
  updateInfo();
  if (!pano.current) pano.setMessage('Pobieranie danych terenu…');
  worker.postMessage({ id, lat, lon } satisfies ComputeRequest);
}

worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
  const m = ev.data;
  if (m.id !== requestId) return;
  if (m.type === 'progress') {
    elevationText = m.stage === 'tiles' ? `Pobieranie danych terenu… ${m.done}/${m.total}` : 'Obliczanie obrysu…';
    updateInfo();
  } else if (m.type === 'result') {
    showResult(m.horizon);
    peaksText = 'szczyty: ładowanie…';
    updateInfo();
  } else if (m.type === 'peaks') {
    pano.setPeaks(m.peaks);
    peaksText = `szczyty: ${m.peaks.length} widocznych`;
    updateInfo();
  } else if (m.type === 'peaks-error') {
    peaksText = 'szczyty: nie udało się pobrać';
    updateInfo();
    console.warn('Peaks unavailable:', m.message);
  } else {
    elevationText = `Błąd: ${m.message}`;
    updateInfo();
    if (!pano.current) pano.setMessage(`Nie udało się pobrać danych: ${m.message}`);
  }
};

function showResult(h: Horizon) {
  pano.setHorizon(h);
  elevationText = `Wysokość terenu ${Math.round(h.groundElevation)} m n.p.m. + ${h.eyeHeight} m (oko)`;
  updateInfo();
  downloadBtn.disabled = false;
}

$('coord-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const c = parseCoords(coordInput.value);
  if (!c) {
    coordInput.classList.add('bad');
    info.textContent = 'Podaj współrzędne w formacie: szerokość, długość (np. 49.2992, 19.9496)';
    return;
  }
  setObserver(c[0], c[1], true);
});

cardinalsBtn.addEventListener('click', () => {
  const on = !pano.cardinalsVisible;
  pano.setCardinals(on);
  cardinalsBtn.setAttribute('aria-pressed', String(on));
});

peaksBtn.addEventListener('click', () => {
  const on = !pano.peaksVisible;
  pano.setPeaksVisible(on);
  peaksBtn.setAttribute('aria-pressed', String(on));
});

downloadBtn.addEventListener('click', () => {
  const h = pano.current;
  if (!h) return;
  const blob = new Blob([pano.exportSvg()], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `panorama_${h.lat.toFixed(4)}_${h.lon.toFixed(4)}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// Initial position: from the URL hash if present.
const fromHash = parseCoords(location.hash.slice(1));
if (fromHash) setObserver(fromHash[0], fromHash[1], true);
