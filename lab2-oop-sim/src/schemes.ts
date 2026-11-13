/**
 * Схеми моделей у позначеннях методички (CREATE, PROCESS, DISPOSE).
 * Одна сцена рендериться у два формати: SVG (для звіту) і .drawio (для редагування).
 */
import { label, num } from './report.ts';
import type { ChainParams, Task6Result } from './tasks.ts';

type Point = readonly [number, number];

interface Block {
  readonly kind: 'create' | 'process' | 'dispose';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly title: string;
  /** підпис під блоком: закон розподілу, черга, кількість пристроїв */
  readonly note?: string;
}

interface Edge {
  readonly points: readonly Point[];
  readonly arrow?: boolean;
}

interface Caption {
  readonly at: Point;
  readonly text: string;
}

export interface Scheme {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly blocks: readonly Block[];
  readonly edges: readonly Edge[];
  readonly captions: readonly Caption[];
}

const H = 50;
/** глибина вістря п’ятикутників CREATE і DISPOSE */
const TIP = 22;
const NOTE_GAP = 20;

const outline = ({ kind, x, y, w }: Block): readonly Point[] => {
  switch (kind) {
    case 'create':
      return [[x, y], [x + w - TIP, y], [x + w, y + H / 2], [x + w - TIP, y + H], [x, y + H]];
    case 'dispose':
      return [[x + TIP, y], [x + w, y], [x + w, y + H], [x + TIP, y + H], [x, y + H / 2]];
    case 'process':
      return [[x, y], [x + w, y], [x + w, y + H], [x, y + H]];
  }
};

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pts = (points: readonly Point[]): string => points.map(([x, y]) => `${x},${y}`).join(' ');

/** центр тексту блоку: у п’ятикутниках зсунутий від вістря */
const titleX = ({ kind, x, w }: Block): number => x + w / 2 + (kind === 'create' ? -TIP / 2 : kind === 'dispose' ? TIP / 2 : 0);

export const toSvg = ({ width, height, blocks, edges, captions }: Scheme): string => {
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, Helvetica, sans-serif">`,
    `<rect width="${width}" height="${height}" fill="#fff"/>`,
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z"/></marker></defs>',
    ...edges.map(
      (e) => `<polyline points="${pts(e.points)}" fill="none" stroke="#000" stroke-width="1.5"${e.arrow ? ' marker-end="url(#arrow)"' : ''}/>`,
    ),
    ...blocks.flatMap((b) => [
      `<polygon points="${pts(outline(b))}" fill="#fff" stroke="#000" stroke-width="2"/>`,
      `<text x="${titleX(b)}" y="${b.y + H / 2 + 5}" font-size="14" text-anchor="middle">${escape(b.title)}</text>`,
      ...(b.note ? [`<text x="${b.x + b.w / 2}" y="${b.y + H + NOTE_GAP}" font-size="13" text-anchor="middle">${escape(b.note)}</text>`] : []),
    ]),
    ...captions.map((c) => `<text x="${c.at[0]}" y="${c.at[1]}" font-size="13">${escape(c.text)}</text>`),
    '</svg>',
  ];
  return `${lines.join('\n')}\n`;
};

const DRAWIO_SHAPE: Record<Block['kind'], string> = {
  // offPageConnector за замовчуванням вказує вниз; direction повертає його вправо або вліво
  create: 'shape=offPageConnector;direction=north;size=0.2;',
  process: 'rounded=0;',
  dispose: 'shape=offPageConnector;direction=south;size=0.2;',
};

const TEXT_STYLE = 'text;html=1;align=center;verticalAlign=middle;strokeColor=none;fillColor=none;fontSize=13;';

export const toDrawio = ({ name, width, height, blocks, edges, captions }: Scheme): string => {
  let id = 1;
  const cell = (attrs: string, geometry: string): string => `<mxCell id="c${++id}" ${attrs} parent="1">${geometry}</mxCell>`;
  const box = (x: number, y: number, w: number, h: number) => `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>`;
  const point = ([x, y]: Point, as: string) => `<mxPoint x="${x}" y="${y}" as="${as}"/>`;
  const cells = [
    ...blocks.flatMap((b) => [
      cell(
        `value="${escape(b.title)}" style="${DRAWIO_SHAPE[b.kind]}whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#000000;strokeWidth=2;fontSize=14;" vertex="1"`,
        box(b.x, b.y, b.w, H),
      ),
      ...(b.note ? [cell(`value="${escape(b.note)}" style="${TEXT_STYLE}" vertex="1"`, box(b.x - 20, b.y + H + 6, b.w + 40, 20))] : []),
    ]),
    ...edges.map((e) => {
      const first = e.points[0] ?? [0, 0];
      const last = e.points[e.points.length - 1] ?? first;
      const via = e.points.slice(1, -1);
      return cell(
        `style="endArrow=${e.arrow ? 'block;endFill=1' : 'none'};html=1;rounded=0;strokeWidth=1.5;strokeColor=#000000;" edge="1"`,
        `<mxGeometry relative="1" as="geometry">${point(first, 'sourcePoint')}${point(last, 'targetPoint')}` +
          (via.length > 0 ? `<Array as="points">${via.map((p) => `<mxPoint x="${p[0]}" y="${p[1]}"/>`).join('')}</Array>` : '') +
          '</mxGeometry>',
      );
    }),
    ...captions.map((c) =>
      cell(`value="${escape(c.text)}" style="${TEXT_STYLE}align=left;" vertex="1"`, box(c.at[0], c.at[1] - 14, 40, 20)),
    ),
  ];
  return (
    `<mxfile host="app.diagrams.net"><diagram name="${escape(name)}" id="${escape(name)}">` +
    `<mxGraphModel dx="${width}" dy="${height}" grid="1" gridSize="10" guides="1" page="1" pageWidth="${width}" pageHeight="${height}">` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram></mxfile>\n`
  );
};

const queueNote = (maxQueue: number): string => (Number.isFinite(maxQueue) ? `черга ≤ ${maxQueue}` : 'черга без обмеження');

/** Рисунок 2.1: CREATE → PROCESS 1 → PROCESS 2 → PROCESS 3 → DISPOSE. */
export const chainScheme = ({ create, stages }: ChainParams): Scheme => {
  const w = 130;
  const step = w + 50;
  const y = 30;
  const blocks: Block[] = [
    { kind: 'create', x: 20, y, w, title: 'CREATE', note: label(create.label) },
    ...stages.map((s, i): Block => ({
      kind: 'process',
      x: 20 + step * (i + 1),
      y,
      w,
      title: `PROCESS ${i + 1}`,
      note: `${label(s.delay.label)}, ${queueNote(s.maxQueue)}`,
    })),
    { kind: 'dispose', x: 20 + step * (stages.length + 1), y, w, title: 'DISPOSE' },
  ];
  const edges = blocks.slice(1).map((b, i): Edge => {
    const from = blocks[i] ?? b;
    return { points: [[from.x + from.w, y + H / 2], [b.x, y + H / 2]], arrow: true };
  });
  const last = blocks[blocks.length - 1];
  return { name: 'task3-scheme', width: (last ? last.x + last.w : 0) + 20, height: y + H + NOTE_GAP + 20, blocks, edges, captions: [] };
};

/**
 * Мережа завдання 6: PROCESS 1 розгалужується на PROCESS 2 і PROCESS 3,
 * з кожного з них вимога або повертається на вхід PROCESS 1, або виходить з моделі.
 */
export const networkScheme = ({ createMean, nodes, routing }: Pick<Task6Result, 'createMean' | 'nodes' | 'routing'>): Scheme => {
  const p = (i: number, j: number): string => num(routing[i]?.[j] ?? 0, 1);
  const exit = (i: number): string => num(1 - (routing[i] ?? []).reduce((s, x) => s + x, 0), 1);
  const note = (i: number): string => {
    const n = nodes[i];
    return n ? `${label(`exp(${n.delay})`)}, пристроїв ${n.channels}` : '';
  };
  const mid = 175;
  const top = 75;
  const bottom = 255;
  const merge = 160;
  const split = 370;
  const back = 590;
  const join = 630;
  const returnArrow = 375;
  return {
    name: 'task6-scheme',
    width: 810,
    height: 360,
    blocks: [
      { kind: 'create', x: 20, y: mid - H / 2, w: 110, title: 'CREATE', note: label(`exp(${createMean})`) },
      { kind: 'process', x: 190, y: mid - H / 2, w: 130, title: 'PROCESS 1', note: note(0) },
      { kind: 'process', x: 420, y: top - H / 2, w: 130, title: 'PROCESS 2', note: note(1) },
      { kind: 'process', x: 420, y: bottom - H / 2, w: 130, title: 'PROCESS 3', note: note(2) },
      { kind: 'dispose', x: 670, y: mid - H / 2, w: 120, title: 'DISPOSE' },
    ],
    edges: [
      { points: [[130, mid], [merge, mid]] },
      { points: [[merge, mid], [190, mid]], arrow: true },
      { points: [[320, mid], [split, mid]] },
      { points: [[split, mid], [split, top], [420, top]], arrow: true },
      { points: [[split, mid], [split, bottom], [420, bottom]], arrow: true },
      { points: [[550, top], [back, top]] },
      // стрілка повернення ставиться посередині верхнього відрізка, щоб не накладатися на вхід PROCESS 1
      { points: [[back, top], [back, 20], [returnArrow, 20]], arrow: true },
      { points: [[returnArrow, 20], [merge, 20], [merge, mid]] },
      { points: [[back, top], [join, top], [join, mid]] },
      { points: [[550, bottom], [back, bottom]] },
      { points: [[back, bottom], [back, 340], [returnArrow, 340]], arrow: true },
      { points: [[returnArrow, 340], [merge, 340], [merge, mid]] },
      { points: [[back, bottom], [join, bottom], [join, mid]] },
      { points: [[join, mid], [670, mid]], arrow: true },
    ],
    captions: [
      { at: [383, top - 8], text: p(0, 1) },
      { at: [383, bottom - 8], text: p(0, 2) },
      { at: [back + 8, 45], text: p(1, 0) },
      { at: [back + 8, top - 8], text: exit(1) },
      { at: [back + 8, 305], text: p(2, 0) },
      { at: [back + 8, bottom - 8], text: exit(2) },
    ],
  };
};
