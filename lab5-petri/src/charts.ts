/** Побудова лінійних графіків у вигляді самодостатніх SVG-файлів (без зовнішніх бібліотек). */

const W = 900;
const H = 500;
const PAD = { top: 60, right: 28, bottom: 92, left: 72 } as const;
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const INK = '#1d2433';
const MUTED = '#6b7686';
const GRID = '#dfe4ec';
export const PALETTE = ['#4c7ef3', '#e8590c', '#2f9e44', '#ae3ec9', '#868e96'] as const;

export interface Series {
  readonly label: string;
  readonly points: readonly (readonly [number, number])[];
  readonly color: string;
  /** ступінчаста лінія — для кусково-сталих траєкторій стану */
  readonly step?: boolean;
  readonly dashed?: boolean;
  readonly markers?: boolean;
  /** лише точки без з’єднувальної лінії — для результатів імітації поверх теоретичної кривої */
  readonly markersOnly?: boolean;
}

export interface LineChartOptions {
  readonly title: string;
  readonly subtitle: string;
  readonly xLabel: string;
  readonly yLabel: string;
  readonly series: readonly Series[];
  readonly xTicks?: readonly number[];
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmt = (x: number): string => {
  const a = Math.abs(x);
  if (a === 0) return '0';
  if (a >= 1000) return Math.round(x).toLocaleString('uk-UA');
  return Number(x.toFixed(a < 1 ? 3 : 2)).toString();
};

/** «Гарний» крок шкали: 1, 2 або 5 помножене на степінь десяти. */
const niceStep = (range: number, ticks: number): number => {
  const raw = range / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow;
};

export const lineChart = ({ title, subtitle, xLabel, yLabel, series, xTicks }: LineChartOptions): string => {
  const all = series.flatMap((s) => s.points);
  const xMin = Math.min(...all.map(([x]) => x));
  const xMax = Math.max(...all.map(([x]) => x));
  const top = Math.max(...all.map(([, y]) => y)) * 1.08 || 1;
  const yStep = niceStep(top, 5);
  const yMax = Math.ceil(top / yStep) * yStep;
  const sx = (x: number): number => PAD.left + ((x - xMin) / (xMax - xMin || 1)) * PLOT_W;
  const sy = (y: number): number => PAD.top + PLOT_H - (y / yMax) * PLOT_H;

  const parts: string[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += yStep) {
    parts.push(`<line x1="${PAD.left}" y1="${sy(v)}" x2="${PAD.left + PLOT_W}" y2="${sy(v)}" stroke="${GRID}"/>`);
    parts.push(`<text x="${PAD.left - 10}" y="${sy(v) + 4}" font-size="11" text-anchor="end" fill="${MUTED}">${fmt(v)}</text>`);
  }
  const ticks = xTicks ?? Array.from({ length: 6 }, (_, i) => xMin + ((xMax - xMin) * i) / 5);
  for (const t of ticks) {
    parts.push(`<text x="${sx(t)}" y="${PAD.top + PLOT_H + 20}" font-size="11" text-anchor="middle" fill="${MUTED}">${fmt(t)}</text>`);
  }
  parts.push(`<line x1="${PAD.left}" y1="${PAD.top + PLOT_H}" x2="${PAD.left + PLOT_W}" y2="${PAD.top + PLOT_H}" stroke="${INK}"/>`);
  parts.push(`<line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + PLOT_H}" stroke="${INK}"/>`);
  parts.push(`<text x="${PAD.left + PLOT_W / 2}" y="${PAD.top + PLOT_H + 44}" font-size="12" text-anchor="middle" fill="${MUTED}">${esc(xLabel)}</text>`);
  parts.push(
    `<text x="18" y="${PAD.top + PLOT_H / 2}" font-size="12" text-anchor="middle" fill="${MUTED}" transform="rotate(-90 18 ${PAD.top + PLOT_H / 2})">${esc(yLabel)}</text>`,
  );

  for (const s of series) {
    const pts = s.step
      ? s.points.flatMap(([x, y], i) => {
          const prev = s.points[i - 1];
          return prev ? [[x, prev[1]] as const, [x, y] as const] : [[x, y] as const];
        })
      : s.points;
    const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ');
    if (!s.markersOnly) {
      parts.push(
        `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"${s.dashed ? ' stroke-dasharray="7 5"' : ''} stroke-linejoin="round"/>`,
      );
    }
    if (s.markers || s.markersOnly) {
      for (const [x, y] of s.points) parts.push(`<circle cx="${sx(x)}" cy="${sy(y)}" r="4" fill="${s.color}"/>`);
    }
  }

  // легенда під віссю абсцис
  let lx = PAD.left;
  const ly = H - 18;
  for (const s of series) {
    parts.push(
      s.markersOnly
        ? `<circle cx="${lx + 13}" cy="${ly - 4}" r="4" fill="${s.color}"/>`
        : `<line x1="${lx}" y1="${ly - 4}" x2="${lx + 26}" y2="${ly - 4}" stroke="${s.color}" stroke-width="3"${s.dashed ? ' stroke-dasharray="7 5"' : ''}/>`,
    );
    parts.push(`<text x="${lx + 32}" y="${ly}" font-size="12" fill="${INK}">${esc(s.label)}</text>`);
    lx += 46 + s.label.length * 6.6;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${PAD.left}" y="30" font-size="19" font-weight="600" fill="${INK}">${esc(title)}</text>
  <text x="${PAD.left}" y="48" font-size="13" fill="${MUTED}">${esc(subtitle)}</text>
  ${parts.join('\n  ')}
</svg>`;
};
