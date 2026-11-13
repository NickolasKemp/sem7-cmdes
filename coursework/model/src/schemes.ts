/**
 * Схеми мереж Петрі в позначеннях лекції 6: позиція — коло з маркерами, перехід — планка, дуга — стрілка з кратністю,
 * інформаційна дуга — пунктир. Схема будується з самої мережі: на неї потрапляють елементи, яким задано розташування.
 * Одна сцена рендериться у два формати: SVG (для звіту) і .drawio (для редагування).
 */
import { label } from './format.ts';
import type { Arc, Layout, Net, Place, Point, Side, Transition } from './petri.ts';

type Shape =
  | { readonly kind: 'place'; readonly at: Point; readonly tokens: string }
  | { readonly kind: 'bar'; readonly at: Point; readonly horizontal: boolean }
  | { readonly kind: 'line'; readonly points: readonly Point[]; readonly dashed: boolean }
  | { readonly kind: 'text'; readonly at: Point; readonly text: string; readonly anchor: 'start' | 'middle' | 'end'; readonly muted?: boolean };

export interface Scheme {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly shapes: readonly Shape[];
}

const R = 17;
const BAR = { long: 40, short: 7 } as const;
const LINE_H = 15;
const MUTED = '#555555';

const half = (t: Transition): Point => (t.layout?.horizontal ? [BAR.long / 2, BAR.short / 2] : [BAR.short / 2, BAR.long / 2]);

/** Точка на межі елемента в напрямку до точки `to`. */
const clip = (el: Place | Transition, at: Point, to: Point): Point => {
  const dx = to[0] - at[0];
  const dy = to[1] - at[1];
  const len = Math.hypot(dx, dy) || 1;
  if ('initial' in el) return [at[0] + (dx / len) * R, at[1] + (dy / len) * R];
  const [hw, hh] = half(el);
  const s = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return [at[0] + dx * s, at[1] + dy * s];
};

/** Перенесення довгого підпису на рядки до `width` символів. */
const wrap = (s: string, width = 14): string[] =>
  s.split(' ').reduce<string[]>((lines, word) => {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + ' ' + word).length <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
    return lines;
  }, []);

/** Параметри переходу під назвою: закон розподілу затримки, пріоритет, імовірність запуску. */
const params = (t: Transition): string =>
  [
    t.delay.label === '0' ? '' : label(t.delay.label),
    t.priority ? `pr = ${t.priority}` : '',
    t.probability !== 1 ? `p = ${label(String(+t.probability.toFixed(3)))}` : '',
  ]
    .filter(Boolean)
    .join('; ');

export const buildScheme = (name: string, net: Net, width: number, height: number): Scheme => {
  const shapes: Shape[] = [];

  const caption = (layout: Layout, size: Point, lines: readonly { text: string; muted?: boolean }[]): void => {
    const side: Side = layout.side ?? 'below';
    if (side === 'none') return;
    const [x, y] = [layout.at[0] + (layout.shift?.[0] ?? 0), layout.at[1] + (layout.shift?.[1] ?? 0)];
    const [hw, hh] = size;
    const n = lines.length;
    const anchor = side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle';
    const tx = side === 'left' ? x - hw - 6 : side === 'right' ? x + hw + 6 : x;
    const top = side === 'above' ? y - hh - 6 - (n - 1) * LINE_H : side === 'below' ? y + hh + 15 : y + 5 - ((n - 1) * LINE_H) / 2;
    for (const [i, l] of lines.entries()) shapes.push({ kind: 'text', at: [tx, top + i * LINE_H], text: l.text, anchor, muted: l.muted });
  };

  for (const p of net.places) {
    if (!p.layout) continue;
    const tokens = p.layout.shown ?? (p.initial === 0 ? '' : p.initial === 1 ? '•' : String(p.initial));
    shapes.push({ kind: 'place', at: p.layout.at, tokens });
    caption(p.layout, [R, R], wrap(p.name).map((text) => ({ text })));
  }

  const arc = (from: Place | Transition, to: Place | Transition, a: Arc, dashed: boolean): void => {
    const start = from.layout?.at;
    const end = to.layout?.at;
    if (!start || !end) return;
    const first = a.via[0] ?? end;
    const last = a.via[a.via.length - 1] ?? start;
    const points: Point[] = [clip(from, start, first), ...a.via, clip(to, end, last)];
    shapes.push({ kind: 'line', points, dashed });
    const mark = a.shown ?? (a.weight > 1 ? String(a.weight) : '');
    if (!mark) return;
    // кратність дуги — коса риска з числом на останньому відрізку, ближче до кінця
    const [p, q] = [points[points.length - 2] ?? start, points[points.length - 1] ?? end];
    const m: Point = [p[0] + (q[0] - p[0]) * 0.55, p[1] + (q[1] - p[1]) * 0.55];
    shapes.push({ kind: 'line', points: [[m[0] - 4, m[1] + 6], [m[0] + 4, m[1] - 6]], dashed: false });
    shapes.push({ kind: 'text', at: [m[0] + 6, m[1] - 8], text: mark, anchor: 'start' });
  };

  for (const t of net.transitions) {
    if (!t.layout) continue;
    shapes.push({ kind: 'bar', at: t.layout.at, horizontal: t.layout.horizontal ?? false });
    const extra = params(t);
    caption(t.layout, half(t), [...wrap(t.name).map((text) => ({ text })), ...(extra ? [{ text: extra, muted: true }] : [])]);
    for (const a of t.inputs) arc(a.place, t, a, false);
    for (const a of t.info) arc(a.place, t, a, true);
    for (const a of t.outputs) arc(t, a.place, a, false);
  }
  return { name, width, height, shapes };
};

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const toSvg = ({ width, height, shapes }: Scheme): string => {
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Times New Roman, serif">`,
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">' +
      '<path d="M0,0 L10,5 L0,10 z" fill="#000"/></marker></defs>',
    `<rect width="${width}" height="${height}" fill="#fff"/>`,
  ];
  for (const shape of shapes) {
    switch (shape.kind) {
      case 'line': {
        const d = shape.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
        const tick = shape.points.length === 2 && Math.hypot(...([0, 1] as const).map((k) => (shape.points[1]?.[k] ?? 0) - (shape.points[0]?.[k] ?? 0))) < 16;
        out.push(
          `<path d="${d}" fill="none" stroke="#000" stroke-width="1.3"${shape.dashed ? ' stroke-dasharray="6 4"' : ''}${tick ? '' : ' marker-end="url(#arrow)"'}/>`,
        );
        break;
      }
      case 'place': {
        const [x, y] = shape.at;
        out.push(`<circle cx="${x}" cy="${y}" r="${R}" fill="#fff" stroke="#000" stroke-width="1.5"/>`);
        if (shape.tokens === '•') out.push(`<circle cx="${x}" cy="${y}" r="3.5" fill="#000"/>`);
        else if (shape.tokens) out.push(`<text x="${x}" y="${y + 5}" font-size="14" text-anchor="middle">${escape(shape.tokens)}</text>`);
        break;
      }
      case 'bar': {
        const [x, y] = shape.at;
        const [w, h] = shape.horizontal ? [BAR.long, BAR.short] : [BAR.short, BAR.long];
        out.push(`<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" fill="#000"/>`);
        break;
      }
      case 'text':
        out.push(
          `<text x="${shape.at[0].toFixed(1)}" y="${shape.at[1].toFixed(1)}" font-size="13" text-anchor="${shape.anchor}"${shape.muted ? ` fill="${MUTED}" font-style="italic"` : ''}>${escape(shape.text)}</text>`,
        );
        break;
    }
  }
  out.push('</svg>');
  return `${out.join('\n')}\n`;
};

export const toDrawio = ({ name, width, height, shapes }: Scheme): string => {
  let id = 1;
  const cell = (attrs: string, geometry: string): string => `<mxCell id="c${++id}" ${attrs} parent="1">${geometry}</mxCell>`;
  const box = (x: number, y: number, w: number, h: number): string => `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>`;
  const point = ([x, y]: Point, as: string): string => `<mxPoint x="${x}" y="${y}" as="${as}"/>`;
  const cells = shapes.map((shape): string => {
    switch (shape.kind) {
      case 'line': {
        const first = shape.points[0] ?? [0, 0];
        const last = shape.points[shape.points.length - 1] ?? first;
        const via = shape.points.slice(1, -1);
        const tick = shape.points.length === 2 && Math.hypot(last[0] - first[0], last[1] - first[1]) < 16;
        return cell(
          `style="endArrow=${tick ? 'none' : 'block;endFill=1'};html=1;rounded=0;strokeWidth=1.3;strokeColor=#000000;${shape.dashed ? 'dashed=1;' : ''}" edge="1"`,
          `<mxGeometry relative="1" as="geometry">${point(first, 'sourcePoint')}${point(last, 'targetPoint')}` +
            (via.length ? `<Array as="points">${via.map(([x, y]) => `<mxPoint x="${x}" y="${y}"/>`).join('')}</Array>` : '') +
            '</mxGeometry>',
        );
      }
      case 'place':
        return cell(
          `value="${escape(shape.tokens)}" style="ellipse;html=1;strokeColor=#000000;strokeWidth=1.5;fillColor=#FFFFFF;fontSize=14;" vertex="1"`,
          box(shape.at[0] - R, shape.at[1] - R, 2 * R, 2 * R),
        );
      case 'bar': {
        const [w, h] = shape.horizontal ? [BAR.long, BAR.short] : [BAR.short, BAR.long];
        return cell('value="" style="rounded=0;html=1;fillColor=#000000;strokeColor=#000000;" vertex="1"', box(shape.at[0] - w / 2, shape.at[1] - h / 2, w, h));
      }
      case 'text': {
        const w = shape.text.length * 7 + 10;
        const x = shape.anchor === 'middle' ? shape.at[0] - w / 2 : shape.anchor === 'end' ? shape.at[0] - w : shape.at[0];
        const align = shape.anchor === 'middle' ? 'center' : shape.anchor === 'end' ? 'right' : 'left';
        return cell(
          `value="${escape(shape.text)}" style="text;html=1;align=${align};verticalAlign=middle;strokeColor=none;fillColor=none;fontSize=13;fontFamily=Times New Roman;` +
            `${shape.muted ? `fontColor=${MUTED};fontStyle=2;` : ''}" vertex="1"`,
          box(x, shape.at[1] - 13, w, 18),
        );
      }
    }
  });
  return (
    `<mxfile host="app.diagrams.net"><diagram name="${escape(name)}" id="${escape(name)}">` +
    `<mxGraphModel dx="${width}" dy="${height}" grid="1" gridSize="10" guides="1" page="1" pageWidth="${width}" pageHeight="${height}">` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram></mxfile>\n`
  );
};
