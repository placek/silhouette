import type { Horizon } from '../core/horizon';

const NS = 'http://www.w3.org/2000/svg';
/** World units (SVG user units) per degree. Same scale on both axes, so the picture is angularly true. */
export const SCALE = 10;
const SKY_DEG = -90; // fill extends down to here

export interface Palette {
  bg: string;
  fill: string;
  stroke: string;
  grid: string;
}

export const LIGHT_PALETTE: Palette = { bg: '#eaf1f8', fill: '#c3ccd6', stroke: '#1b2430', grid: '#7a8796' };

export function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    bg: v('--pano-bg', LIGHT_PALETTE.bg),
    fill: v('--pano-fill', LIGHT_PALETTE.fill),
    stroke: v('--pano-stroke', LIGHT_PALETTE.stroke),
    grid: v('--pano-grid', LIGHT_PALETTE.grid),
  };
}

const CARDINALS: { az: number; label: string; major: boolean }[] = [
  { az: 0, label: 'N', major: true },
  { az: 45, label: 'NE', major: false },
  { az: 90, label: 'E', major: true },
  { az: 135, label: 'SE', major: false },
  { az: 180, label: 'S', major: true },
  { az: 225, label: 'SW', major: false },
  { az: 270, label: 'W', major: true },
  { az: 315, label: 'NW', major: false },
];

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
  const labels: { text: SVGTextElement; x: number }[] = [];
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
      const t = el('text', {
        fill: palette.stroke,
        'font-family': 'system-ui, sans-serif',
        'font-weight': c.major ? 700 : 500,
      });
      t.textContent = c.label;
      cardinals.append(t);
      labels.push({ text: t, x });
    }
  }
  root.append(cardinals);
  return { root, cardinals, labels };
}

/** Position labels at the top of the visible area, with constant on-screen size. */
function layoutLabels(labels: { text: SVGTextElement; x: number }[], vb: ViewBox, unitsPerPx: number) {
  const fs = 13 * unitsPerPx;
  for (const { text, x } of labels) {
    const visible = x > vb.x - 40 * unitsPerPx && x < vb.x + vb.w + 40 * unitsPerPx;
    text.style.display = visible ? '' : 'none';
    if (!visible) continue;
    const nearLeft = x - vb.x < 14 * unitsPerPx;
    const nearRight = vb.x + vb.w - x < 14 * unitsPerPx;
    text.setAttribute('x', String(x + (nearLeft ? 4 : nearRight ? -4 : 0) * unitsPerPx));
    text.setAttribute('y', String(vb.y + 20 * unitsPerPx));
    text.setAttribute('font-size', String(fs));
    text.setAttribute('text-anchor', nearLeft ? 'start' : nearRight ? 'end' : 'middle');
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

  setHorizon(h: Horizon) {
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
    this.applyView(this.view);
  }

  // ---- view handling ----
  private size() {
    const r = this.container.getBoundingClientRect();
    return { W: Math.max(r.width, 1), H: Math.max(r.height, 1) };
  }

  private yBounds() {
    return { top: -(this.range.max + 4) * SCALE, bottom: -(this.range.min - 4) * SCALE };
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
    if (this.scene) layoutLabels(this.scene.labels, c, c.w / this.size().W);
  }

  fitDefault() {
    if (!this.horizon) return;
    const { W, H } = this.size();
    const { top, bottom } = this.yBounds();
    const w = Math.min(Math.max(((bottom - top) * W) / H, 300), 1800);
    const h = (w * H) / W;
    this.applyView({ x: this.range.maxAz * SCALE - w / 2, y: (top + bottom) / 2 - h / 2, w, h });
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
    const vb: ViewBox = {
      x: 0,
      y: -(max + 4) * SCALE,
      w: 360 * SCALE,
      h: (max - min + 8) * SCALE,
    };
    layoutLabels(scene.labels, vb, 1.4);
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
    );
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}\n`;
  }
}
