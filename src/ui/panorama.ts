import type { Horizon } from '../core/horizon';
import type { PeakHit } from '../core/peaks';

const NS = 'http://www.w3.org/2000/svg';
/** World units (SVG user units) per degree. Same scale on both axes, so the picture is angularly true. */
export const SCALE = 10;
const SKY_DEG = -90; // fill extends down to here

export interface Palette {
  bg: string;
  fill: string;
  stroke: string;
  grid: string;
  peak: string;
}

export const LIGHT_PALETTE: Palette = {
  bg: '#eaf1f8',
  fill: '#c3ccd6',
  stroke: '#1b2430',
  grid: '#7a8796',
  peak: '#b4320a',
};

export function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    bg: v('--pano-bg', LIGHT_PALETTE.bg),
    fill: v('--pano-fill', LIGHT_PALETTE.fill),
    stroke: v('--pano-stroke', LIGHT_PALETTE.stroke),
    grid: v('--pano-grid', LIGHT_PALETTE.grid),
    peak: v('--pano-peak', LIGHT_PALETTE.peak),
  };
}

const CARDINALS: { az: number; label: string; name: string; major: boolean }[] = [
  { az: 0, label: 'N', name: 'północ', major: true },
  { az: 45, label: 'NE', name: 'północny wschód', major: false },
  { az: 90, label: 'E', name: 'wschód', major: true },
  { az: 135, label: 'SE', name: 'południowy wschód', major: false },
  { az: 180, label: 'S', name: 'południe', major: true },
  { az: 225, label: 'SW', name: 'południowy zachód', major: false },
  { az: 270, label: 'W', name: 'zachód', major: true },
  { az: 315, label: 'NW', name: 'północny zachód', major: false },
];

interface SceneLabel {
  text: SVGTextElement;
  sub: SVGTextElement;
  x: number;
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** Vertical extent (degrees) of the skyline, ignoring NaN. */
export function angleRange(h: Horizon): { min: number; max: number; maxAz: number } {
  let min = Infinity;
  let max = -Infinity;
  let maxAz = 0;
  h.angles.forEach((a, i) => {
    if (Number.isNaN(a)) return;
    if (a < min) min = a;
    if (a > max) {
      max = a;
      maxAz = i * h.azStep;
    }
  });
  if (!Number.isFinite(min)) return { min: -1, max: 1, maxAz: 0 };
  return { min, max, maxAz };
}

/** Builds the scene (terrain + cardinals) in world coordinates. Azimuth range −180°…540° so the 360° wrap is seamless. */
function buildScene(h: Horizon, palette: Palette) {
  const n = h.angles.length;
  const root = el('g');
  const bottom = -SKY_DEG * SCALE;
  let line = '';
  let first = '';
  let last = '';
  let pen = false;
  for (let k = -n / 2; k < n * 1.5; k++) {
    const i = ((k % n) + n) % n;
    const a = h.angles[i];
    if (Number.isNaN(a)) {
      pen = false;
      continue;
    }
    const x = (k * h.azStep * SCALE).toFixed(2);
    const y = (-a * SCALE).toFixed(2);
    line += `${pen ? 'L' : 'M'}${x} ${y}`;
    pen = true;
    if (!first) first = x;
    last = x;
  }
  root.append(
    el('path', { d: `${line}L${last} ${bottom}L${first} ${bottom}Z`, fill: palette.fill, stroke: 'none' }),
    el('path', {
      d: line,
      fill: 'none',
      stroke: palette.stroke,
      'stroke-width': 1.5,
      'stroke-linejoin': 'round',
      'vector-effect': 'non-scaling-stroke',
    }),
  );

  const cardinals = el('g', { 'data-role': 'cardinals' });
  const labels: SceneLabel[] = [];
  for (let wrap = -1; wrap <= 1; wrap++) {
    for (const c of CARDINALS) {
      const x = (c.az + wrap * 360) * SCALE;
      cardinals.append(
        el('line', {
          x1: x, x2: x, y1: -1000, y2: 1000,
          stroke: palette.grid,
          'stroke-width': c.major ? 1 : 0.75,
          'stroke-dasharray': c.major ? '6 4' : '2 4',
          'vector-effect': 'non-scaling-stroke',
        }),
      );
      const halo = { stroke: palette.bg, 'stroke-width': 3, 'paint-order': 'stroke', 'stroke-linejoin': 'round' };
      const t = el('text', {
        ...halo,
        fill: palette.stroke,
        'font-family': 'system-ui, sans-serif',
        'font-weight': c.major ? 700 : 500,
      });
      t.textContent = c.label;
      const sub = el('text', {
        ...halo,
        fill: palette.grid,
        'font-family': 'system-ui, sans-serif',
        'font-weight': 400,
      });
      sub.textContent = `${c.name} · ${c.az}°`;
      cardinals.append(t, sub);
      labels.push({ text: t, sub, x });
    }
  }
  root.append(cardinals);
  return { root, cardinals, labels };
}

/** Position labels at the top of the visible area, with constant on-screen size. */
function layoutLabels(labels: SceneLabel[], vb: ViewBox, unitsPerPx: number) {
  const u = unitsPerPx;
  for (const { text, sub, x } of labels) {
    const visible = x > vb.x - 90 * u && x < vb.x + vb.w + 90 * u;
    text.style.display = sub.style.display = visible ? '' : 'none';
    if (!visible) continue;
    // Labels are up to ~120 px wide; anchor them inward when the line is near an edge.
    const nearLeft = x - vb.x < 60 * u;
    const nearRight = vb.x + vb.w - x < 60 * u;
    const anchor = nearLeft ? 'start' : nearRight ? 'end' : 'middle';
    const lx = x + (nearLeft ? 4 : nearRight ? -4 : 0) * u;
    text.setAttribute('x', String(lx));
    text.setAttribute('y', String(vb.y + 20 * u));
    text.setAttribute('font-size', String(14 * u));
    text.setAttribute('text-anchor', anchor);
    sub.setAttribute('x', String(lx));
    sub.setAttribute('y', String(vb.y + 34 * u));
    sub.setAttribute('font-size', String(11 * u));
    sub.setAttribute('text-anchor', anchor);
  }
}

// ---- summit labels ----

interface PeakItem {
  peak: PeakHit;
  /** World coordinates of the summit marker. */
  x: number;
  y: number;
  g: SVGGElement;
  line: SVGLineElement;
  marker: SVGPathElement;
  text: SVGTextElement;
  /** Estimated label width, screen px. */
  w: number;
}

const PEAK_FONT = 12;
const PEAK_ROW = 15; // vertical step between stacked labels, px
const PEAK_MAX_ROWS = 7;
const TOP_RESERVED = 46; // px kept free for the cardinal labels

/** Builds one marker+leader+label per summit and per 360° wrap copy (highest summits first). */
function buildPeaks(peaks: PeakHit[], palette: Palette) {
  const root = el('g', { 'data-role': 'peaks' });
  const items: PeakItem[] = [];
  const halo = { stroke: palette.bg, 'stroke-width': 3, 'paint-order': 'stroke', 'stroke-linejoin': 'round' };
  for (const peak of peaks) {
    for (let wrap = -1; wrap <= 1; wrap++) {
      const g = el('g');
      const line = el('line', { stroke: palette.peak, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' });
      const marker = el('path', { d: 'M0 -4L4 3H-4Z', fill: palette.peak, stroke: palette.bg, 'stroke-width': 0.75 });
      const text = el('text', {
        ...halo,
        fill: palette.stroke,
        'font-family': 'system-ui, sans-serif',
        'font-size': PEAK_FONT,
        'text-anchor': 'middle',
      });
      const name = el('tspan', { 'font-weight': 600 });
      name.textContent = peak.name;
      const ele = el('tspan', { fill: palette.peak, 'font-weight': 400 });
      ele.textContent = ` ${Math.round(peak.ele)} m`;
      text.append(name, ele);
      g.append(line, marker, text);
      g.style.display = 'none';
      root.append(g);
      const w = (peak.name.length + 7) * PEAK_FONT * 0.55;
      items.push({ peak, x: (peak.az + wrap * 360) * SCALE, y: -peak.angle * SCALE, g, line, marker, text, w });
    }
  }
  return { root, items };
}

/**
 * Places labels greedily (highest summit first) above their markers, stacking upward on collision.
 * Summits that find no free spot stay hidden, so zooming in reveals more of them.
 * `W` is the view width in screen px; all collision maths is done in screen px.
 */
function layoutPeaks(items: PeakItem[], vb: ViewBox, u: number, W: number) {
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const it of items) {
    const xs = (it.x - vb.x) / u;
    const ys = (it.y - vb.y) / u;
    let ok = false;
    if (xs > -it.w && xs < W + it.w && ys > TOP_RESERVED && ys < (vb.h / u) + 10) {
      const cx = Math.min(Math.max(xs, it.w / 2 + 4), W - it.w / 2 - 4);
      for (let r = 0; r < PEAK_MAX_ROWS && !ok; r++) {
        const y1 = ys - 14 - r * PEAK_ROW;
        const y0 = y1 - PEAK_FONT - 2;
        if (y0 < TOP_RESERVED) break;
        const box = { x0: cx - it.w / 2 - 3, x1: cx + it.w / 2 + 3, y0, y1 };
        if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
        placed.push(box);
        ok = true;
        const wx = (px: number) => vb.x + px * u;
        const wy = (py: number) => vb.y + py * u;
        it.marker.setAttribute('transform', `translate(${it.x} ${it.y}) scale(${u})`);
        it.line.setAttribute('x1', String(it.x));
        it.line.setAttribute('y1', String(it.y - 4 * u));
        it.line.setAttribute('x2', String(it.x));
        it.line.setAttribute('y2', String(wy(y1 + 2)));
        it.text.setAttribute('x', String(wx(cx)));
        it.text.setAttribute('y', String(wy(y1 - 2)));
        it.text.setAttribute('font-size', String(PEAK_FONT * u));
        it.text.setAttribute('stroke-width', String(3 * u));
      }
    }
    it.g.style.display = ok ? '' : 'none';
  }
}

export class PanoramaView {
  private svg: SVGSVGElement;
  private msg: HTMLElement;
  private horizon: Horizon | null = null;
  private scene: ReturnType<typeof buildScene> | null = null;
  private bgRect: SVGRectElement;
  private world: SVGGElement;
  private showCardinals = true;
  private showPeaks = true;
  private peaks: PeakHit[] = [];
  private peakScene: ReturnType<typeof buildPeaks> | null = null;
  private view: ViewBox = { x: 0, y: -100, w: 1200, h: 300 };
  private range = { min: -1, max: 1, maxAz: 0 };

  constructor(private container: HTMLElement) {
    this.svg = el('svg', { preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Panorama' });
    this.bgRect = el('rect', { x: -1e5, y: -1e5, width: 2e5, height: 2e5 });
    this.world = el('g');
    this.svg.append(this.bgRect, this.world);
    this.msg = document.createElement('div');
    this.msg.className = 'pano-msg';
    const tools = document.createElement('div');
    tools.className = 'pano-tools';
    tools.append(
      this.tool('360°', 'Pokaż całą panoramę', () => this.fitAll()),
      this.tool('Dopasuj', 'Przywróć domyślny widok', () => this.fitDefault()),
    );
    container.append(this.svg, this.msg, tools);
    this.bindInteraction();
    new ResizeObserver(() => this.applyView(this.view)).observe(container);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.rebuild());
    this.setMessage('Wskaż miejsce na mapie');
  }

  private tool(text: string, title: string, fn: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', fn);
    return b;
  }

  setMessage(text: string | null) {
    this.msg.textContent = text ?? '';
    this.msg.style.display = text ? '' : 'none';
  }

  get current(): Horizon | null {
    return this.horizon;
  }

  get cardinalsVisible() {
    return this.showCardinals;
  }

  setCardinals(on: boolean) {
    this.showCardinals = on;
    if (this.scene) this.scene.cardinals.style.display = on ? '' : 'none';
  }

  get peaksVisible() {
    return this.showPeaks;
  }

  setPeaksVisible(on: boolean) {
    this.showPeaks = on;
    if (this.peakScene) this.peakScene.root.style.display = on ? '' : 'none';
    this.fitDefault(); // vertical room for labels depends on whether they are shown
  }

  /** Summits visible from the current horizon's observer (replaces the previous set). */
  setPeaks(peaks: PeakHit[]) {
    this.peaks = peaks;
    this.rebuildPeaks();
    this.applyView(this.view);
    if (peaks.length) this.fitDefault();
  }

  setHorizon(h: Horizon) {
    this.peaks = []; // belong to the previous observer
    this.horizon = h;
    this.range = angleRange(h);
    this.rebuild();
    this.setMessage(null);
    this.fitDefault();
  }

  private rebuild() {
    if (!this.horizon) return;
    const palette = readPalette(this.container);
    this.bgRect.setAttribute('fill', palette.bg);
    this.world.replaceChildren();
    this.scene = buildScene(this.horizon, palette);
    this.world.append(this.scene.root);
    this.setCardinals(this.showCardinals);
    this.rebuildPeaks();
    this.applyView(this.view);
  }

  private rebuildPeaks() {
    this.peakScene?.root.remove();
    this.peakScene = buildPeaks(this.peaks, readPalette(this.container));
    this.peakScene.root.style.display = this.showPeaks ? '' : 'none';
    this.world.append(this.peakScene.root);
  }

  // ---- view handling ----
  private size() {
    const r = this.container.getBoundingClientRect();
    return { W: Math.max(r.width, 1), H: Math.max(r.height, 1) };
  }

  private yBounds() {
    // Summit labels stack upwards, so leave extra headroom while they are shown.
    const head = this.showPeaks && this.peaks.length ? 14 : 4;
    return { top: -(this.range.max + head) * SCALE, bottom: -(this.range.min - 4) * SCALE };
  }

  private clamp(v: ViewBox): ViewBox {
    const { W, H } = this.size();
    const w = Math.min(Math.max(v.w, 30), 360 * SCALE);
    const h = (w * H) / W;
    let x = v.x;
    const cx = ((((x + w / 2) % (360 * SCALE)) + 360 * SCALE) % (360 * SCALE));
    x = cx - w / 2;
    const { top, bottom } = this.yBounds();
    let y = v.y;
    if (h >= bottom - top) y = (top + bottom) / 2 - h / 2;
    else y = Math.min(Math.max(y, top), bottom - h);
    return { x, y, w, h };
  }

  private applyView(v: ViewBox) {
    const c = this.clamp(v);
    this.view = c;
    this.svg.setAttribute('viewBox', `${c.x} ${c.y} ${c.w} ${c.h}`);
    const { W } = this.size();
    if (this.scene) layoutLabels(this.scene.labels, c, c.w / W);
    if (this.peakScene && this.showPeaks) layoutPeaks(this.peakScene.items, c, c.w / W, W);
  }

  fitDefault() {
    if (!this.horizon) return;
    const { W, H } = this.size();
    const { top, bottom } = this.yBounds();
    const w = Math.min(Math.max(((bottom - top) * W) / H, 300), 1800);
    const h = (w * H) / W;
    // Centre on the highest visible summit if there is one, else on the highest point of the skyline.
    const centreAz = this.showPeaks && this.peaks.length ? this.peaks[0].az : this.range.maxAz;
    this.applyView({ x: centreAz * SCALE - w / 2, y: (top + bottom) / 2 - h / 2, w, h });
  }

  fitAll() {
    this.applyView({ x: 0, y: this.view.y, w: 360 * SCALE, h: this.view.h });
  }

  private zoomAt(factor: number, sx: number, sy: number) {
    const { W, H } = this.size();
    const v = this.view;
    const wx = v.x + (sx / W) * v.w;
    const wy = v.y + (sy / H) * v.h;
    const w = v.w * factor;
    const h = v.h * factor;
    this.applyView({ x: wx - (sx / W) * w, y: wy - (sy / H) * h, w, h });
  }

  private bindInteraction() {
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const local = (e: MouseEvent) => {
      const r = this.container.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      this.zoomAt(Math.exp(e.deltaY * 0.0015), p.x, p.y);
    }, { passive: false });
    this.svg.addEventListener('pointerdown', (e) => {
      this.svg.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, local(e));
      this.svg.classList.add('dragging');
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    this.svg.addEventListener('pointermove', (e) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const cur = local(e);
      const { W } = this.size();
      if (pts.size === 1) {
        const k = this.view.w / W;
        this.applyView({ ...this.view, x: this.view.x - (cur.x - prev.x) * k, y: this.view.y - (cur.y - prev.y) * k });
        pts.set(e.pointerId, cur);
      } else if (pts.size === 2) {
        pts.set(e.pointerId, cur);
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) this.zoomAt(pinch / d, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch = d;
      }
    });
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      pinch = 0;
      if (pts.size === 0) this.svg.classList.remove('dragging');
    };
    this.svg.addEventListener('pointerup', up);
    this.svg.addEventListener('pointercancel', up);
    this.svg.addEventListener('dblclick', (e) => {
      const p = local(e);
      this.zoomAt(0.5, p.x, p.y);
    });
  }

  /** Standalone SVG document: full 360° strip, light palette, readable when printed. */
  exportSvg(): string {
    if (!this.horizon) throw new Error('No panorama to export');
    const palette = LIGHT_PALETTE;
    const scene = buildScene(this.horizon, palette);
    scene.cardinals.style.display = this.showCardinals ? '' : 'none';
    const { min, max } = this.range;
    const withPeaks = this.showPeaks && this.peaks.length > 0;
    const head = withPeaks ? 14 : 4;
    const vb: ViewBox = {
      x: 0,
      y: -(max + head) * SCALE,
      w: 360 * SCALE,
      h: (max - min + head + 4) * SCALE,
    };
    layoutLabels(scene.labels, vb, 1.4);
    const peakScene = buildPeaks(this.peaks, palette);
    if (withPeaks) layoutPeaks(peakScene.items, vb, 1, vb.w);
    const svg = el('svg', {
      xmlns: NS,
      viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`,
      width: vb.w,
      height: vb.h,
    });
    const title = el('title');
    const h = this.horizon;
    title.textContent = `Panorama z ${h.lat.toFixed(5)}, ${h.lon.toFixed(5)} (${Math.round(h.groundElevation)} m n.p.m. + ${h.eyeHeight} m)`;
    svg.append(
      title,
      el('rect', { x: vb.x, y: vb.y, width: vb.w, height: vb.h, fill: palette.bg }),
      scene.root,
      ...(withPeaks ? [peakScene.root] : []),
    );
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}\n`;
  }
}
