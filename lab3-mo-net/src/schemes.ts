/**
 * Схеми формалізованих мереж масового обслуговування в позначеннях лекції 4:
 * черга — прямокутник з поділками, пристрій — коло, дуга — стрілка, розгалуження — точка розходження дуг.
 * Одна сцена рендериться у два формати: SVG (для звіту) і .drawio (для редагування).
 */
import { label } from './format.ts';
import { BANK, HOSPITAL, JACKSON, RESERVE } from './tasks.ts';

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

/** Мережа Джексона завдання 1: СМО 1 (2 пристрої) розгалужується на СМО 2 і СМО 3, з СМО 2 — повернення. */
export const jacksonScheme = (): Scheme => {
  const s = scene();
  const [n1, n2, n3] = JACKSON.nodes;
  const p = (i: number, j: number): string => label(String(JACKSON.routing[i]?.[j] ?? 0)).replace('.', ',');
  const y = 190;
  s.arrow([20, y], [100, y]);
  s.text(20, y + 22, label(`t = exp(${JACKSON.createMean})`));
  const a = s.smo(100, y, ['D11', 'D12']);
  s.text(a.center, a.bottom + 22, label(`СМО 1: t = exp(${n1?.mean})`), { anchor: 'middle' });
  const split = a.out[0] + 40;
  s.line([a.out, [split, y]]);
  const y2 = 80;
  const y3 = 300;
  s.arrow([split, y], [split, y2], [split + 40, y2]);
  s.text(split + 6, y2 - 8, p(0, 1));
  s.arrow([split, y], [split, y3], [split + 40, y3]);
  s.text(split + 6, y3 - 8 - GAP, p(0, 2));
  const b = s.smo(split + 40, y2, ['D2']);
  s.text(b.center - 20, y2 + 40, label(`СМО 2: t = exp(${n2?.mean})`), { anchor: 'middle' });
  const c = s.smo(split + 40, y3, ['D31', 'D32', 'D33']);
  s.text(c.center, c.bottom + 22, label(`СМО 3: t = exp(${n3?.mean})`), { anchor: 'middle' });
  const exitX = c.out[0] + 60;
  const back = b.out[0] + 30;
  s.line([b.out, [back, y2]]);
  s.arrow([back, y2], [back, 20], [70, 20], [70, y]);
  s.text(back + 6, 45, p(1, 0));
  s.line([[back, y2], [exitX, y2], [exitX, y]]);
  s.text(back + 6, y2 - 8, label(String(1 - (JACKSON.routing[1]?.[0] ?? 0))).replace('.', ','));
  s.line([c.out, [exitX, y3], [exitX, y]]);
  s.arrow([exitX, y], [exitX + 60, y]);
  s.text(exitX + 10, y - 10, 'вихід', { muted: true });
  return { name: 'task1-jackson', width: exitX + 90, height: 400, shapes: s.shapes };
};

/** Основний і резервний пристрої: розгалуження за пріоритетом, відмова, коли обидва зайняті. */
export const reserveScheme = (): Scheme => {
  const s = scene();
  const y = 130;
  s.arrow([20, y], [110, y]);
  s.text(24, y - 10, label(`t = exp(${RESERVE.createMean})`));
  const split = 110;
  const y1 = 60;
  const y2 = 200;
  s.arrow([split, y], [split, y1], [split + 110, y1]);
  s.text(split + 10, y1 - 8, 'пріоритет 2');
  s.arrow([split, y], [split, y2], [split + 110, y2]);
  s.text(split + 10, y2 - 8, 'пріоритет 1');
  const main = s.smo(split + 110, y1, ['D1']);
  const reserve = s.smo(split + 110, y2, ['D2']);
  s.text(main.center, y1 - 30, label(`основний, t = exp(${RESERVE.serviceMean}), max = ${RESERVE.maxQueue}`), { anchor: 'middle' });
  s.text(reserve.center, y2 + 40, label(`резервний, t = exp(${RESERVE.serviceMean}), max = ${RESERVE.maxQueue}`), { anchor: 'middle' });
  const join = main.out[0] + 60;
  s.line([main.out, [join, y1], [join, y]]);
  s.line([reserve.out, [join, y2], [join, y]]);
  s.arrow([join, y], [join + 60, y]);
  s.text(join + 8, y - 10, 'вихід', { muted: true });
  s.arrow([split, y2], [split, y2 + 50]);
  s.text(split - 6, y2 + 66, 'відмова, якщо обидва зайняті', { muted: true });
  return { name: 'task1-reserve', width: join + 90, height: 280, shapes: s.shapes };
};

/** Банк з двома під’їзними смугами: вибір коротшої смуги, перехід між чергами, відмова при заповнених смугах. */
export const bankScheme = (): Scheme => {
  const s = scene();
  const y = 170;
  s.arrow([20, y], [150, y]);
  s.text(24, y - 26, label(`t = exp(${BANK.arrivalMean})`));
  s.text(24, y - 10, label(`перше: t = ${BANK.initial.firstArrival}`), { muted: true });
  const split = 150;
  const y1 = 80;
  const y2 = 260;
  s.arrow([split, y], [split, y1], [split + 130, y1]);
  s.text(split + 8, y1 - 8, 'пріоритет −N1');
  s.arrow([split, y], [split, y2], [split + 130, y2]);
  s.text(split + 8, y2 - 8, 'пріоритет −N2');
  const l1 = s.smo(split + 130, y1, ['D1']);
  const l2 = s.smo(split + 130, y2, ['D2']);
  s.text(l1.center, y1 - 32, label(`смуга 1: t = exp(${BANK.serviceMean}), max = ${BANK.maxQueue}`), { anchor: 'middle' });
  s.text(l2.center, y2 + 42, label(`смуга 2: t = exp(${BANK.serviceMean}), max = ${BANK.maxQueue}`), { anchor: 'middle' });
  // перехід останнього автомобіля між чергами
  const qx = split + 130 + Q / 2;
  s.line([[qx - 6, y1 + Q / 2], [qx - 6, y2 - Q / 2]], { arrow: true, dashed: true });
  s.line([[qx + 6, y2 - Q / 2], [qx + 6, y1 + Q / 2]], { arrow: true, dashed: true });
  s.text(qx + 14, y + 4, 'перехід', { muted: true });
  const join = l1.out[0] + 60;
  s.line([l1.out, [join, y1], [join, y]]);
  s.line([l2.out, [join, y2], [join, y]]);
  s.arrow([join, y], [join + 70, y]);
  s.text(join + 8, y - 10, 'від’їзд', { muted: true });
  s.text(join + 110, y1 - 30, 'Nᵢ — кількість автомобілів на смузі i;', { muted: true });
  s.text(join + 110, y1 - 12, 'за рівних пріоритетів — смуга 1;', { muted: true });
  s.text(join + 110, y1 + 6, 'відмова, якщо обидві черги повні;', { muted: true });
  s.text(join + 110, y1 + 24, `перехід останнього в черзі, якщо |L1 − L2| ≥ ${BANK.jockeyGap}`, { muted: true });
  return { name: 'task2-bank', width: join + 420, height: 340, shapes: s.shapes };
};

/** Приймання хворих у лікарню: приймальне відділення, супровід у палату, лабораторія з поверненням. */
export const hospitalScheme = (): Scheme => {
  const s = scene();
  const h = HOSPITAL;
  const y = 120;
  s.arrow([20, y], [170, y]);
  s.text(24, y - 26, label(`t = exp(${h.arrivalMean})`));
  s.text(24, y - 10, `тип ${h.types.map((t) => t.type).join('/')}: ${h.types.map((t) => label(String(t.p))).join('/')}`, { muted: true });
  const merge = 140;
  const reception = s.smo(170, y, ['D11', 'D12']);
  s.text(156, y + 62, 'тип 1 — першим', { muted: true });
  s.text(reception.center, y - 66, 'чергові лікарі', { anchor: 'middle', bold: true });
  s.text(reception.center, reception.bottom + 40, `t = exp(${h.types.map((t) => t.registrationMean).join(' / ')})`, { anchor: 'middle' });
  const split = reception.out[0] + 40;
  s.line([reception.out, [split, y]]);
  s.arrow([split, y], [split + 60, y]);
  s.text(split + 6, y - 8, 'тип 1');
  const escort = s.smo(split + 60, y, ['D21', 'D22', 'D23']);
  s.text(escort.center, escort.top - 12, 'супровідні', { anchor: 'middle', bold: true });
  s.text(escort.center, escort.bottom + 20, label(`t = ${h.toWard.label}`), { anchor: 'middle' });
  s.arrow(escort.out, [escort.out[0] + 70, y]);
  s.text(escort.out[0] + 8, y - 10, 'палата', { muted: true });

  const y2 = 330;
  s.line([[split, y], [split, y2 - 0]]);
  s.text(split + 6, y + 80, 'тип 2, 3');
  s.arrow([split, y2], [split + 30, y2]);
  const walk = s.smo(split + 30, y2, ['∞'], { queue: false });
  s.text(walk.center, y2 + 40, label(`t = ${h.walk.label}`), { anchor: 'middle' });
  const registry = s.smo(walk.out[0] + 50, y2, ['D3']);
  s.arrow(walk.out, registry.in);
  s.text(registry.center - 30, y2 - 32, 'реєстратура', { anchor: 'middle', bold: true });
  s.text(registry.center - 30, y2 + 40, label(`t = ${h.labRegistry.label}`), { anchor: 'middle' });
  const lab = s.smo(registry.out[0] + 50, y2, ['D41', 'D42']);
  s.arrow(registry.out, lab.in);
  s.text(lab.center - 20, lab.top - 12, 'лаборанти', { anchor: 'middle', bold: true });
  s.text(lab.center - 20, lab.bottom + 20, label(`t = ${h.analysis.label}`), { anchor: 'middle' });
  const out = lab.out[0] + 40;
  s.line([lab.out, [out, y2]]);
  s.arrow([out, y2], [out + 80, y2]);
  s.text(out + 6, y2 - 8, 'тип 3: вихід', { muted: true });
  const y3 = 460;
  s.line([[out, y2], [out, y3]]);
  s.text(out + 6, y2 + 70, 'тип 2');
  const back = s.smo(out - 120, y3, ['∞'], { queue: false });
  s.arrow([out, y3], back.out);
  s.text(back.center, y3 + 40, label(`t = ${h.walk.label}`), { anchor: 'middle' });
  s.arrow([back.in[0], y3], [merge, y3], [merge, y + 2]);
  s.text(merge + 8, y3 - 10, 'тип := 1');
  return { name: 'task3-hospital', width: out + 140, height: 520, shapes: s.shapes };
};

export const SCHEMES = [jacksonScheme, reserveScheme, bankScheme, hospitalScheme] as const;

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
