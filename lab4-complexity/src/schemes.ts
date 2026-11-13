/**
 * Схеми мереж масового обслуговування в позначеннях лекції 4:
 * черга — прямокутник з поділками, пристрій — коло, дуга — стрілка, розгалуження — точка розходження дуг.
 * Одна сцена рендериться у два формати: SVG (для звіту) і .drawio (для редагування).
 */
import { label } from './format.ts';
import { BASE } from './networks.ts';

type Point = readonly [number, number];

type Shape =
  | { readonly kind: 'queue'; readonly x: number; readonly y: number }
  | { readonly kind: 'device'; readonly x: number; readonly y: number; readonly label: string }
  | { readonly kind: 'line'; readonly points: readonly Point[]; readonly arrow?: boolean; readonly dashed?: boolean }
  | { readonly kind: 'text'; readonly x: number; readonly y: number; readonly text: string; readonly anchor?: 'start' | 'middle' | 'end'; readonly bold?: boolean; readonly muted?: boolean };

export interface Scheme {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly shapes: readonly Shape[];
}

const Q = 40;
const R = 20;
const GAP = 50;

/** Побудова сцени: кожна функція додає фігури й повертає точки під’єднання. */
const scene = () => {
  const shapes: Shape[] = [];
  const line = (points: readonly Point[], opts: { arrow?: boolean; dashed?: boolean } = {}): void => void shapes.push({ kind: 'line', points, ...opts });
  const arrow = (...points: readonly Point[]): void => line(points, { arrow: true });
  const text = (x: number, y: number, s: string, opts: { anchor?: 'start' | 'middle' | 'end'; bold?: boolean; muted?: boolean } = {}): void =>
    void shapes.push({ kind: 'text', x, y, text: s, ...opts });

  /**
   * СМО: черга (за потреби) і пристрої, що стоять стовпчиком між двома шинами.
   * `x` — лівий край, `y` — вісь входу/виходу. Повертає вхід, вихід і межі по вертикалі.
   */
  const smo = (x: number, y: number, devices: readonly string[], { queue = true } = {}) => {
    let cx = x + R;
    if (queue) {
      shapes.push({ kind: 'queue', x, y: y - Q / 2 });
      cx = x + Q + (devices.length > 1 ? 2 * R + 20 : R + 20);
      line([[x + Q, y], [devices.length > 1 ? x + Q + 20 : cx - R, y]]);
    }
    const ys = devices.map((_, k) => y + (k - (devices.length - 1) / 2) * GAP);
    for (const [k, d] of devices.entries()) shapes.push({ kind: 'device', x: cx, y: ys[k] ?? y, label: d });
    const top = (ys[0] ?? y) - R;
    const bottom = (ys[ys.length - 1] ?? y) + R;
    if (devices.length === 1) return { in: [x, y] as Point, out: [cx + R, y] as Point, top, bottom, center: cx };
    const left = cx - R - 20;
    const right = cx + R + 20;
    line([[left, ys[0] ?? y], [left, ys[ys.length - 1] ?? y]]);
    line([[right, ys[0] ?? y], [right, ys[ys.length - 1] ?? y]]);
    for (const dy of ys) {
      line([[left, dy], [cx - R, dy]]);
      line([[cx + R, dy], [right, dy]]);
    }
    if (!queue) line([[x, y], [left, y]]);
    return { in: [x, y] as Point, out: [right, y] as Point, top, bottom, center: cx };
  };

  return { shapes, line, arrow, text, smo };
};

const SERVICE = label(`t = exp(${BASE.serviceMean})`);
const ARRIVAL = label(`t = exp(${BASE.arrivalMean})`);
/** ширина СМО з чергою й одним пристроєм */
const W = Q + 20 + 2 * R;

/** Вхідний потік: стрілка від лівого краю до точки x з підписом закону надходження. */
const source = (s: ReturnType<typeof scene>, x: number, y: number): void => {
  s.arrow([20, y], [x, y]);
  s.text(20, y - 10, ARRIVAL);
};

const exit = (s: ReturnType<typeof scene>, x: number, y: number): void => {
  s.arrow([x, y], [x + 60, y]);
  s.text(x + 8, y - 10, 'вихід', { muted: true });
};

/** Послідовне з’єднання N СМО. */
export const serialScheme = (): Scheme => {
  const s = scene();
  const y = 50;
  source(s, 110, y);
  const xs = [110, 270, 490];
  const names = ['1', '2', 'N'];
  const nodes = xs.map((x, i) => {
    const node = s.smo(x, y, [`D${names[i]}`]);
    s.text(x + W / 2, y + 45, `СМО ${names[i]}`, { anchor: 'middle' });
    return node;
  });
  const [a, b, c] = nodes;
  if (!a || !b || !c) throw new Error('недосяжно');
  s.arrow(a.out, b.in);
  s.line([b.out, [b.out[0] + 40, y]]);
  s.text(b.out[0] + 60, y + 5, '…', { anchor: 'middle', bold: true });
  s.arrow([b.out[0] + 80, y], c.in);
  exit(s, c.out[0], y);
  s.text(110, y + 75, `у кожній СМО ${SERVICE}, 1 пристрій, черга необмежена`, { muted: true });
  return { name: 'task1-serial', width: c.out[0] + 90, height: 150, shapes: s.shapes };
};

/** Розгалуження вхідного потоку на N паралельних СМО з рівними ймовірностями. */
export const fanScheme = (): Scheme => {
  const s = scene();
  const y = 180;
  source(s, 130, y);
  const split = 130;
  const x = 230;
  const rows = [
    { y: 50, name: '1' },
    { y: 130, name: '2' },
    { y: 310, name: 'N' },
  ];
  const join = x + W + 50;
  for (const row of rows) {
    s.arrow([split, y], [split, row.y], [x, row.y]);
    s.text(split + 8, row.y - 8, 'p = 1/N');
    const node = s.smo(x, row.y, [`D${row.name}`]);
    s.text(x + W / 2, row.y - 28, `СМО ${row.name}`, { anchor: 'middle' });
    s.line([node.out, [join, row.y], [join, y]]);
  }
  s.text(x + W / 2, 225, '…', { anchor: 'middle', bold: true });
  exit(s, join, y);
  s.text(20, 380, `у кожній СМО ${SERVICE}; вимога проходить лише одну СМО`, { muted: true });
  return { name: 'task4-fan', width: join + 90, height: 400, shapes: s.shapes };
};

/** Двійкове дерево: з СМО i вимога йде в СМО 2i або 2i + 1 з імовірністю 0,5, з листків — у вихід. */
export const treeScheme = (): Scheme => {
  const s = scene();
  const levels = 3;
  const rowH = 70;
  const height = 2 ** (levels - 1) * rowH;
  const top = 40;
  const colX = (level: number): number => 110 + level * (W + 90);
  const rowY = (level: number, k: number): number => top + (height / 2 ** level) * (k + 0.5);
  const join = colX(levels - 1) + W + 50;
  source(s, colX(0), rowY(0, 0));
  for (let level = 0; level < levels; level++) {
    for (let k = 0; k < 2 ** level; k++) {
      const id = 2 ** level + k;
      const x = colX(level);
      const y = rowY(level, k);
      const node = s.smo(x, y, [`D${id}`]);
      s.text(x + W / 2, y - 26, `СМО ${id}`, { anchor: 'middle' });
      if (level === levels - 1) {
        s.line([node.out, [join, y], [join, rowY(0, 0)]]);
        continue;
      }
      const split = node.out[0] + 30;
      s.line([node.out, [split, y]]);
      for (const child of [0, 1]) {
        const cy = rowY(level + 1, 2 * k + child);
        s.arrow([split, y], [split, cy], [colX(level + 1), cy]);
        s.text(split + 6, cy + (child === 0 ? -8 : 16), '0,5');
      }
    }
  }
  exit(s, join, rowY(0, 0));
  s.text(20, top + height + 30, `приклад для N = 7; у кожній СМО ${SERVICE}; вимога проходить ≈ log₂N СМО`, { muted: true });
  return { name: 'task4-tree', width: join + 90, height: top + height + 50, shapes: s.shapes };
};

/** Розгалуження з пропуском: з СМО i вимога йде в СМО i + 1 або i + 2 з імовірністю 0,5. */
export const skipScheme = (): Scheme => {
  const s = scene();
  const y = 170;
  const n = 5;
  const step = W + 60;
  const x0 = 110;
  source(s, x0, y);
  const nodes = Array.from({ length: n }, (_, i) => {
    const x = x0 + i * step;
    const node = s.smo(x, y, [`D${i + 1}`]);
    s.text(x + W / 2, y + 45, `СМО ${i + 1}`, { anchor: 'middle' });
    return node;
  });
  const exitX = x0 + n * step;
  for (const [i, node] of nodes.entries()) {
    const next = nodes[i + 1];
    const far = nodes[i + 2];
    const split = node.out[0] + 15;
    s.line([node.out, [split, y]]);
    s.arrow([split, y], next ? next.in : [exitX, y]);
    if (i === n - 1) break;
    s.text(split + 4, y + 18, '0,5');
    const lane = y - 50 - (i % 2) * 40;
    const target = far ? far.in[0] - 15 : exitX;
    s.line([[split, y], [split, lane], [target, lane]]);
    if (far) s.arrow([target, lane], [target, y]);
    else s.line([[target, lane], [target, y]]);
    s.text(split + 6, lane - 6, '0,5');
  }
  exit(s, exitX, y);
  s.text(20, y + 85, `приклад для N = 5; у кожній СМО ${SERVICE}; вимога проходить ≈ 2N/3 СМО`, { muted: true });
  return { name: 'task4-skip', width: exitX + 90, height: y + 105, shapes: s.shapes };
};

/** Послідовна мережа з поверненням: після СМО N вимога з імовірністю p повертається в СМО 1. */
export const feedbackScheme = (): Scheme => {
  const s = scene();
  const y = 70;
  const merge = 80;
  source(s, 120, y);
  const xs = [120, 280, 500];
  const names = ['1', '2', 'N'];
  const nodes = xs.map((x, i) => {
    const node = s.smo(x, y, [`D${names[i]}`]);
    s.text(x + W / 2, y + 45, `СМО ${names[i]}`, { anchor: 'middle' });
    return node;
  });
  const [a, b, c] = nodes;
  if (!a || !b || !c) throw new Error('недосяжно');
  s.arrow(a.out, b.in);
  s.line([b.out, [b.out[0] + 40, y]]);
  s.text(b.out[0] + 60, y + 5, '…', { anchor: 'middle', bold: true });
  s.arrow([b.out[0] + 80, y], c.in);
  const split = c.out[0] + 30;
  s.line([c.out, [split, y]]);
  const back = y + 80;
  s.arrow([split, y], [split, back], [merge, back], [merge, y + 2]);
  s.text(split + 6, back - 30, label(`p = ${BASE.feedbackP}`));
  exit(s, split, y);
  s.text(split + 8, y + 18, '1 − p', { muted: true });
  s.text(20, back + 35, `у кожній СМО ${SERVICE}; вимога проходить у середньому N / (1 − p) СМО`, { muted: true });
  return { name: 'task4-feedback', width: split + 90, height: back + 55, shapes: s.shapes };
};

export const SCHEMES = [serialScheme, fanScheme, treeScheme, skipScheme, feedbackScheme] as const;

// ───────────────────────────── рендеринг ─────────────────────────────

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MUTED = '#555555';

export const toSvg = ({ width, height, shapes }: Scheme): string => {
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, Helvetica, sans-serif">`,
    `<rect width="${width}" height="${height}" fill="#fff"/>`,
    '<defs><marker id="a" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z"/></marker></defs>',
  ];
  // лінії під фігурами: спершу дуги, потім черги, пристрої й підписи
  const order = (k: Shape['kind']): number => ['line', 'queue', 'device', 'text'].indexOf(k);
  for (const shape of [...shapes].sort((a, b) => order(a.kind) - order(b.kind))) {
    switch (shape.kind) {
      case 'line':
        out.push(
          `<polyline points="${shape.points.map(([x, y]) => `${x},${y}`).join(' ')}" fill="none" stroke="#000" stroke-width="1.5"` +
            `${shape.dashed ? ' stroke-dasharray="6 4"' : ''}${shape.arrow ? ' marker-end="url(#a)"' : ''}/>`,
        );
        break;
      case 'queue':
        out.push(`<rect x="${shape.x}" y="${shape.y}" width="${Q}" height="${Q}" fill="#fff" stroke="#000" stroke-width="1.5"/>`);
        for (const k of [1, 2, 3, 4]) out.push(`<line x1="${shape.x + 8 * k}" y1="${shape.y}" x2="${shape.x + 8 * k}" y2="${shape.y + Q}" stroke="#000"/>`);
        break;
      case 'device':
        out.push(`<circle cx="${shape.x}" cy="${shape.y}" r="${R}" fill="#fff" stroke="#000" stroke-width="1.5"/>`);
        out.push(`<text x="${shape.x}" y="${shape.y + 5}" font-size="13" text-anchor="middle">${escape(shape.label)}</text>`);
        break;
      case 'text':
        out.push(
          `<text x="${shape.x}" y="${shape.y}" font-size="13" text-anchor="${shape.anchor ?? 'start'}"` +
            `${shape.bold ? ' font-weight="bold"' : ''}${shape.muted ? ` fill="${MUTED}"` : ''}>${escape(shape.text)}</text>`,
        );
        break;
    }
  }
  out.push('</svg>');
  return `${out.join('\n')}\n`;
};

export const toDrawio = ({ name, width, height, shapes }: Scheme): string => {
  let id = 1;
  const cell = (attrs: string, geometry: string, parent = '1'): string => `<mxCell id="c${++id}" ${attrs} parent="${parent}">${geometry}</mxCell>`;
  const box = (x: number, y: number, w: number, h: number): string => `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>`;
  const point = ([x, y]: Point, as: string): string => `<mxPoint x="${x}" y="${y}" as="${as}"/>`;
  const stroke = 'strokeColor=#000000;strokeWidth=1.5;fillColor=#FFFFFF;';
  const cells = shapes.flatMap((shape): string[] => {
    switch (shape.kind) {
      case 'line': {
        const first = shape.points[0] ?? [0, 0];
        const last = shape.points[shape.points.length - 1] ?? first;
        const via = shape.points.slice(1, -1);
        return [
          cell(
            `style="endArrow=${shape.arrow ? 'block;endFill=1' : 'none'};html=1;rounded=0;strokeWidth=1.5;strokeColor=#000000;${shape.dashed ? 'dashed=1;' : ''}" edge="1"`,
            `<mxGeometry relative="1" as="geometry">${point(first, 'sourcePoint')}${point(last, 'targetPoint')}` +
              (via.length > 0 ? `<Array as="points">${via.map(([x, y]) => `<mxPoint x="${x}" y="${y}"/>`).join('')}</Array>` : '') +
              '</mxGeometry>',
          ),
        ];
      }
      case 'queue': {
        const group = cell('value="" style="group;" vertex="1" connectable="0"', box(shape.x, shape.y, Q, Q));
        const groupId = `c${id}`;
        return [
          group,
          cell(`value="" style="rounded=0;html=1;${stroke}" vertex="1"`, box(0, 0, Q, Q), groupId),
          ...[1, 2, 3, 4].map((k) => cell('value="" style="line;strokeWidth=1;direction=south;html=1;strokeColor=#000000;" vertex="1"', box(8 * k - 2, 0, 4, Q), groupId)),
        ];
      }
      case 'device':
        return [cell(`value="${escape(shape.label)}" style="ellipse;html=1;${stroke}fontSize=13;" vertex="1"`, box(shape.x - R, shape.y - R, 2 * R, 2 * R))];
      case 'text': {
        const w = shape.text.length * 7.5 + 10;
        const x = shape.anchor === 'middle' ? shape.x - w / 2 : shape.anchor === 'end' ? shape.x - w : shape.x;
        const align = shape.anchor === 'middle' ? 'center' : shape.anchor === 'end' ? 'right' : 'left';
        return [
          cell(
            `value="${escape(shape.text)}" style="text;html=1;align=${align};verticalAlign=middle;strokeColor=none;fillColor=none;fontSize=13;` +
              `${shape.bold ? 'fontStyle=1;' : ''}${shape.muted ? `fontColor=${MUTED};` : ''}" vertex="1"`,
            box(x, shape.y - 14, w, 20),
          ),
        ];
      }
    }
  });
  return (
    `<mxfile host="app.diagrams.net"><diagram name="${escape(name)}" id="${escape(name)}">` +
    `<mxGraphModel dx="${width}" dy="${height}" grid="1" gridSize="10" guides="1" page="1" pageWidth="${width}" pageHeight="${height}">` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram></mxfile>\n`
  );
};
