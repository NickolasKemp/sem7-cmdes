/** Побудова графіків у вигляді самодостатніх SVG-файлів (без зовнішніх бібліотек). */
import type { Bin } from './stats.ts';

const W = 900;
const H = 520;
const PAD = { top: 56, right: 28, bottom: 64, left: 78 } as const;
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const INK = '#1d2433';
const MUTED = '#6b7686';
const GRID = '#dfe4ec';
const BAR = '#4c7ef3';
const CURVE = '#e8590c';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmt = (x: number): string => {
  const a = Math.abs(x);
  if (a === 0) return '0';
  if (a >= 1000) return Math.round(x).toString();
  if (a < 0.01) return x.toExponential(1);
  return Number(x.toFixed(a < 1 ? 3 : 1)).toString();
};

const frame = (title: string, subtitle: string, body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${PAD.left}" y="30" font-size="19" font-weight="600" fill="${INK}">${esc(title)}</text>
  <text x="${PAD.left}" y="48" font-size="13" fill="${MUTED}">${esc(subtitle)}</text>
  ${body}
</svg>`;

const axes = (xTicks: readonly number[], yMax: number, xLabel: string, yLabel: string): string => {
  const yTicks = 5;
  const parts: string[] = [];
  for (let i = 0; i <= yTicks; i++) {
    const v = (yMax / yTicks) * i;
    const y = PAD.top + PLOT_H - (v / yMax) * PLOT_H;
    parts.push(`<line x1="${PAD.left}" y1="${y}" x2="${PAD.left + PLOT_W}" y2="${y}" stroke="${GRID}"/>`);
    parts.push(`<text x="${PAD.left - 10}" y="${y + 4}" font-size="11" text-anchor="end" fill="${MUTED}">${fmt(v)}</text>`);
  }
  for (const t of xTicks) {
    parts.push(`<text x="${t}" y="${PAD.top + PLOT_H + 20}" font-size="11" text-anchor="middle" fill="${MUTED}"></text>`);
  }
  parts.push(`<line x1="${PAD.left}" y1="${PAD.top + PLOT_H}" x2="${PAD.left + PLOT_W}" y2="${PAD.top + PLOT_H}" stroke="${INK}"/>`);
  parts.push(`<line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + PLOT_H}" stroke="${INK}"/>`);
  parts.push(`<text x="${PAD.left + PLOT_W / 2}" y="${H - 16}" font-size="12" text-anchor="middle" fill="${MUTED}">${esc(xLabel)}</text>`);
  parts.push(`<text x="18" y="${PAD.top + PLOT_H / 2}" font-size="12" text-anchor="middle" fill="${MUTED}" transform="rotate(-90 18 ${PAD.top + PLOT_H / 2})">${esc(yLabel)}</text>`);
  return parts.join('\n  ');
};

export interface HistogramChartOptions {
  readonly title: string;
  readonly subtitle: string;
  readonly bins: readonly Bin[];
  /** Теоретична щільність — крива накладається на гістограму. */
  readonly pdf?: (x: number) => number;
  readonly total?: number;
  readonly xLabel?: string;
}

/** Гістограма частот із необов'язковою теоретичною кривою. */
export const histogramChart = ({
  title,
  subtitle,
  bins,
  pdf,
  total,
  xLabel = 'значення випадкової величини',
}: HistogramChartOptions): string => {
  const lo = bins[0]?.from ?? 0;
  const hi = bins[bins.length - 1]?.to ?? 1;
  const width = (bins[0]?.to ?? 1) - lo;
  const n = total ?? bins.reduce((s, b) => s + b.count, 0);

  const curve: { x: number; y: number }[] = [];
  if (pdf) {
    for (let i = 0; i <= 200; i++) {
      const x = lo + ((hi - lo) * i) / 200;
      curve.push({ x, y: pdf(x) * n * width });
    }
  }
  const yMax = Math.max(...bins.map((b) => b.count), ...curve.map((p) => p.y)) * 1.12;

  const sx = (x: number): number => PAD.left + ((x - lo) / (hi - lo)) * PLOT_W;
  const sy = (y: number): number => PAD.top + PLOT_H - (y / yMax) * PLOT_H;

  const bars = bins
    .map((b) => {
      const x = sx(b.from);
      const w = Math.max(1, sx(b.to) - x - 1);
      const y = sy(b.count);
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${(PAD.top + PLOT_H - y).toFixed(1)}" fill="${BAR}" opacity="0.82"/>`;
    })
    .join('\n  ');

  const path = curve.length
    ? `<path d="${curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')}" fill="none" stroke="${CURVE}" stroke-width="2.5"/>`
    : '';

  const xLabels = Array.from({ length: 6 }, (_, i) => {
    const v = lo + ((hi - lo) * i) / 5;
    return `<text x="${sx(v)}" y="${PAD.top + PLOT_H + 20}" font-size="11" text-anchor="middle" fill="${MUTED}">${fmt(v)}</text>`;
  }).join('\n  ');

  const legend = pdf
    ? `<rect x="${PAD.left + PLOT_W - 210}" y="${PAD.top + 6}" width="200" height="46" fill="#ffffff" stroke="${GRID}" rx="6"/>
  <rect x="${PAD.left + PLOT_W - 198}" y="${PAD.top + 16}" width="14" height="10" fill="${BAR}"/>
  <text x="${PAD.left + PLOT_W - 178}" y="${PAD.top + 25}" font-size="11" fill="${INK}">емпірична частота</text>
  <line x1="${PAD.left + PLOT_W - 198}" y1="${PAD.top + 40}" x2="${PAD.left + PLOT_W - 184}" y2="${PAD.top + 40}" stroke="${CURVE}" stroke-width="2.5"/>
  <text x="${PAD.left + PLOT_W - 178}" y="${PAD.top + 44}" font-size="11" fill="${INK}">теоретична частота</text>`
    : '';

  return frame(title, subtitle, `${axes([], yMax, xLabel, 'кількість влучень')}\n  ${bars}\n  ${path}\n  ${xLabels}\n  ${legend}`);
};

/** Діаграма розсіювання пар (x_i, x_{i+1}) — теоретичний тест рівномірності. */
export const scatterChart = (
  title: string,
  subtitle: string,
  points: readonly (readonly [number, number])[],
): string => {
  const size = PLOT_H;
  const sx = (x: number): number => PAD.left + x * size;
  const sy = (y: number): number => PAD.top + size - y * size;
  const dots = points
    .map(([x, y]) => `<circle cx="${sx(x).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="1.5" fill="${BAR}" opacity="0.5"/>`)
    .join('');
  return frame(
    title,
    subtitle,
    `<rect x="${PAD.left}" y="${PAD.top}" width="${size}" height="${size}" fill="#fbfcfe" stroke="${GRID}"/>
  ${dots}
  <text x="${PAD.left + size / 2}" y="${H - 16}" font-size="12" text-anchor="middle" fill="${MUTED}">x&#8336;</text>
  <text x="18" y="${PAD.top + size / 2}" font-size="12" text-anchor="middle" fill="${MUTED}" transform="rotate(-90 18 ${PAD.top + size / 2})">x&#8336;&#8330;&#8321;</text>`,
  );
};

/** Лінійний графік послідовності спостережень (наприклад, часу сортування). */
export const lineChart = (
  title: string,
  subtitle: string,
  values: readonly number[],
  yLabel: string,
): string => {
  const lo = Math.min(...values) * 0.98;
  const hi = Math.max(...values) * 1.02;
  const sx = (i: number): number => PAD.left + (i / (values.length - 1)) * PLOT_W;
  const sy = (v: number): number => PAD.top + PLOT_H - ((v - lo) / (hi - lo)) * PLOT_H;
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  const yLabels = Array.from({ length: 6 }, (_, i) => {
    const v = lo + ((hi - lo) * i) / 5;
    const y = sy(v);
    return `<line x1="${PAD.left}" y1="${y}" x2="${PAD.left + PLOT_W}" y2="${y}" stroke="${GRID}"/><text x="${PAD.left - 10}" y="${y + 4}" font-size="11" text-anchor="end" fill="${MUTED}">${fmt(v)}</text>`;
  }).join('\n  ');
  return frame(
    title,
    subtitle,
    `${yLabels}
  <path d="${path}" fill="none" stroke="${BAR}" stroke-width="1.6"/>
  <line x1="${PAD.left}" y1="${PAD.top + PLOT_H}" x2="${PAD.left + PLOT_W}" y2="${PAD.top + PLOT_H}" stroke="${INK}"/>
  <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + PLOT_H}" stroke="${INK}"/>
  <text x="${PAD.left + PLOT_W / 2}" y="${H - 16}" font-size="12" text-anchor="middle" fill="${MUTED}">номер прогону</text>
  <text x="18" y="${PAD.top + PLOT_H / 2}" font-size="12" text-anchor="middle" fill="${MUTED}" transform="rotate(-90 18 ${PAD.top + PLOT_H / 2})">${esc(yLabel)}</text>`,
  );
};

/** Порівняння двох гістограм (виміряні та імітовані затримки). */
export const overlayHistogramChart = (
  title: string,
  subtitle: string,
  a: { label: string; bins: readonly Bin[] },
  b: { label: string; bins: readonly Bin[] },
  xLabel: string,
): string => {
  const lo = a.bins[0]?.from ?? 0;
  const hi = a.bins[a.bins.length - 1]?.to ?? 1;
  const yMax = Math.max(...a.bins.map((x) => x.count), ...b.bins.map((x) => x.count)) * 1.15;
  const sx = (x: number): number => PAD.left + ((x - lo) / (hi - lo)) * PLOT_W;
  const sy = (y: number): number => PAD.top + PLOT_H - (y / yMax) * PLOT_H;
  const bars = (bins: readonly Bin[], color: string, offset: number): string =>
    bins
      .map((bin) => {
        const x0 = sx(bin.from);
        const full = sx(bin.to) - x0;
        const w = Math.max(1, full / 2 - 1);
        const y = sy(bin.count);
        return `<rect x="${(x0 + offset * (full / 2)).toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${(PAD.top + PLOT_H - y).toFixed(1)}" fill="${color}" opacity="0.85"/>`;
      })
      .join('');
  const xLabels = Array.from({ length: 6 }, (_, i) => {
    const v = lo + ((hi - lo) * i) / 5;
    return `<text x="${sx(v)}" y="${PAD.top + PLOT_H + 20}" font-size="11" text-anchor="middle" fill="${MUTED}">${fmt(v)}</text>`;
  }).join('');
  return frame(
    title,
    subtitle,
    `${axes([], yMax, xLabel, 'кількість влучень')}
  ${bars(a.bins, BAR, 0)}
  ${bars(b.bins, CURVE, 1)}
  ${xLabels}
  <rect x="${PAD.left + PLOT_W - 230}" y="${PAD.top + 6}" width="220" height="46" fill="#ffffff" stroke="${GRID}" rx="6"/>
  <rect x="${PAD.left + PLOT_W - 218}" y="${PAD.top + 16}" width="14" height="10" fill="${BAR}"/>
  <text x="${PAD.left + PLOT_W - 198}" y="${PAD.top + 25}" font-size="11" fill="${INK}">${esc(a.label)}</text>
  <rect x="${PAD.left + PLOT_W - 218}" y="${PAD.top + 34}" width="14" height="10" fill="${CURVE}"/>
  <text x="${PAD.left + PLOT_W - 198}" y="${PAD.top + 43}" font-size="11" fill="${INK}">${esc(b.label)}</text>`,
  );
};
