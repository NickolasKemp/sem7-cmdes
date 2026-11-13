/** Формування звіту у форматі Word (.docx) з титульною сторінкою, таблицями та рисунками. */
import { readFile } from 'node:fs/promises';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import type { ProcessStats } from './process.ts';
import { label, num, type ReportInput } from './report.ts';

const FONT = 'Times New Roman';
const MONO = 'Courier New';
/** 14 pt у половинах пункту */
const SIZE = 28;
const TABLE_SIZE = 22;
/** ширина області тексту A4 з полями 3 / 1,5 см, DXA */
const TEXT_W = 9354;
const LINE = 360;

type Block = Paragraph | Table;

const text = (s: string, opts: { bold?: boolean; italics?: boolean; size?: number; font?: string } = {}): TextRun =>
  new TextRun({ text: s, font: opts.font ?? FONT, size: opts.size ?? SIZE, bold: opts.bold, italics: opts.italics });

/** Розмітка абзацу: **жирний** фрагмент. */
const runs = (s: string, size = SIZE): TextRun[] =>
  s
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) => (part.startsWith('**') ? text(part.slice(2, -2), { bold: true, size }) : text(part, { size })));

const p = (s: string): Paragraph =>
  new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 120, line: LINE }, indent: { firstLine: 709 }, children: runs(s) });

/** Формула або вираз окремим рядком по центру. */
const formula = (s: string): Paragraph =>
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 120, line: LINE }, children: [text(s, { italics: true })] });

/** Формулювання завдання — нумерований абзац, як у методичці. */
const task = (n: number, s: string): Paragraph =>
  new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 120, after: 120, line: LINE },
    indent: { firstLine: 709 },
    children: [text(`${n}.\t`), ...runs(s)],
    tabStops: [{ type: 'left', position: 1418 }],
  });

const heading = (s: string, center = false): Paragraph =>
  new Paragraph({
    alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
    keepNext: true,
    spacing: { before: 200, after: 120, line: LINE },
    children: [text(s, { bold: true })],
  });

const bullet = (s: string): Paragraph =>
  new Paragraph({ numbering: { reference: 'bullets', level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 60, line: LINE }, children: runs(s) });

const numbered = (reference: string, s: string): Paragraph =>
  new Paragraph({ numbering: { reference, level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 60, line: LINE }, children: runs(s) });

const codeBorder = { style: BorderStyle.SINGLE, size: 6, color: 'A6A6A6', space: 4 } as const;

const code = (lines: readonly string[]): Paragraph[] =>
  lines.map(
    (line, i) =>
      new Paragraph({
        shading: { type: ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' },
        border: {
          left: codeBorder,
          right: codeBorder,
          ...(i === 0 ? { top: codeBorder } : {}),
          ...(i === lines.length - 1 ? { bottom: codeBorder } : {}),
        },
        indent: { left: 113, right: 113 },
        keepLines: true,
        keepNext: i < lines.length - 1,
        spacing: { before: i === 0 ? 160 : 0, after: i === lines.length - 1 ? 200 : 0 },
        children: [text(line || ' ', { font: MONO, size: 18 })],
      }),
  );

let tableNo = 0;
let figureNo = 0;

const tableCaption = (s: string): Paragraph =>
  new Paragraph({ spacing: { before: 160, after: 60 }, keepNext: true, children: [text(`Таблиця ${++tableNo} – ${s}`)] });

const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' } as const;

/** Таблиця на всю ширину області тексту, ширини стовпців задаються частками, текст клітинок — по центру. */
const table = (head: readonly string[], rows: readonly (readonly string[])[], weights?: readonly number[]): Block[] => {
  const w = weights ?? head.map(() => 1);
  const total = w.reduce((s, x) => s + x, 0);
  const widths = w.map((x) => Math.floor((x / total) * TEXT_W));
  widths[0] = (widths[0] ?? 0) + TEXT_W - widths.reduce((s, x) => s + x, 0);
  const cell = (s: string, i: number, header: boolean): TableCell =>
    new TableCell({
      width: { size: widths[i] ?? 0, type: WidthType.DXA },
      shading: header ? { type: ShadingType.CLEAR, fill: 'E7E6E6', color: 'auto' } : undefined,
      borders: { top: border, bottom: border, left: border, right: border },
      margins: { top: 30, bottom: 30, left: 60, right: 60 },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [text(s, { size: TABLE_SIZE, bold: header })] })],
    });
  return [
    new Table({
      width: { size: TEXT_W, type: WidthType.DXA },
      columnWidths: widths,
      rows: [
        new TableRow({ tableHeader: true, cantSplit: true, children: head.map((s, i) => cell(s, i, true)) }),
        ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((s, i) => cell(s, i, false)) })),
      ],
    }),
    // відступ після таблиці: інакше наступний абзац прилипає до її нижньої межі
    new Paragraph({ spacing: { after: 120 }, children: [] }),
  ];
};

/** найбільша ширина рисунка в пікселях (≈ 16 см) */
const FIGURE_W = 600;

const figure = async (png: string, caption: string, width = FIGURE_W): Promise<Paragraph[]> => {
  const data = await readFile(png);
  // розміри зображення лежать у заголовку IHDR файлу PNG
  const height = Math.round((width * data.readUInt32BE(20)) / data.readUInt32BE(16));
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160 },
      keepNext: true,
      children: [new ImageRun({ type: 'png', data, transformation: { width, height } })],
    }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 200, line: LINE }, children: [text(`Рисунок ${++figureNo} – ${caption}`)] }),
  ];
};

const titlePage = (): Paragraph[] => {
  const c = (s: string, before = 0) =>
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before, after: 120, line: LINE }, children: [text(s)] });
  return [
    c('Національний технічний університет України', 600),
    c('«Київський політехнічний інститут імені Ігоря Сікорського»'),
    c('Факультет інформатики та обчислювальної техніки'),
    c('Кафедра інформаційних систем та технологій'),
    c('Комп’ютерний практикум № 2', 840),
    c('з дисципліни «Комп’ютерне моделювання дискретно-подійних систем»', 600),
    c('Тема: «Об’єктно-орієнтований підхід до побудови імітаційних моделей дискретно-подійних систем»'),
    c('Виконав:', 600),
    c('студент групи ІП-34'),
    c('Туболев М. Р.'),
    c('Перевірив:', 360),
    c('ас.'),
    c('Коринецький Д. С.'),
    c('Захищено з балом: _____', 1400),
    c('Київ 2026', 360),
    new Paragraph({ children: [new PageBreak()] }),
  ];
};

const int = (x: number): string => x.toLocaleString('uk-UA').replace(/\s/g, ' ');
const pct = (x: number): string => `${num(x * 100, 2)} %`;
const dev = (sim: number, theory: number): string => (theory === 0 ? (sim === 0 ? '0 %' : '—') : pct(Math.abs(sim - theory) / theory));
const cap = (q: number): string => (Number.isFinite(q) ? String(q) : '∞');

const stageCells = (s: ProcessStats): string[] => [
  s.name,
  int(s.arrivals),
  int(s.served),
  int(s.failures),
  num(s.failureProbability, 4),
  num(s.meanQueue),
  num(s.utilization),
  num(s.meanWait),
];

/** Будує .docx; `png(name)` повертає шлях до растрової версії графіка `name.svg`. */
export const buildDocx = async ({ t1, t2, t3, t4, t5, t6 }: ReportInput, png: (name: string) => string): Promise<Buffer> => {
  tableNo = 0;
  figureNo = 0;
  const body: Block[] = [];
  const add = (...b: Block[]): void => void body.push(...b);

  add(
    heading('Хід роботи', true),
    task(1, 'Реалізувати алгоритм імітації простої моделі обслуговування одним пристроєм з використанням об’єктно-орієнтованого підходу. 5 балів.'),
    p(
      'Роботу виконано мовою TypeScript (середовище Bun) без сторонніх бібліотек. Модель складається з елементів — нащадків ' +
        'універсального класу Element (діаграма класів рисунка 2.5 методички): Create, Process, Dispose; клас Model реалізує алгоритм ' +
        'імітації за принципом найближчої події. Поле nextElement замінено інтерфейсом Router (маршрут вимоги), що дало змогу ' +
        'в завданні 6 організувати вихід у кілька блоків без зміни решти коду. Генератор випадкових чисел має початкове значення (seed), ' +
        'тому всі результати відтворювані. Для верифікації реалізовано формули теорії масового обслуговування M/M/c/K і рівняння балансу ' +
        'потоків мережі.',
    ),
    tableCaption('Класи та модулі програми'),
    ...table(
      ['Клас / модуль', 'Призначення'],
      [
        ['Element', 'базовий елемент: tnext, tcurr, quantity, маршрут next; методи inAct, outAct, doStatistics'],
        ['Create', 'джерело вимог: у момент tnext створює вимогу й планує наступне надходження'],
        ['Process', 'обслуговування c ідентичними пристроями зі спільною обмеженою чергою, накопичення статистики'],
        ['Dispose', 'вихід із моделі, облік часу перебування вимог у системі'],
        ['Router: to, branch', 'маршрут: одна гілка (аналог nextElement) або кілька гілок з імовірностями'],
        ['Model', 'алгоритм імітації за принципом найближчої події'],
        ['random.ts', 'аналог FunRand: експоненційний, рівномірний, нормальний, Ерланга, сталий закони'],
        ['theory.ts', 'формули M/M/c/K і рівняння балансу потоків — еталон для верифікації'],
      ],
      [1, 3],
    ),
  );

  // ── Завдання 1
  const r1 = t1.run;
  add(
    p(
      'Модель CREATE → PROCESS → DISPOSE (рисунок 2.4 методички): інтервал між надходженнями exp(2), час обслуговування exp(1), ' +
        'максимальна довжина черги 5, час моделювання 1000. Крок алгоритму Model.simulate:',
    ),
    numbered('steps', 'знайти найменший tnext серед усіх елементів — момент найближчої події;'),
    numbered('steps', 'накопичити статистику doStatistics(tnext − tcurr) у всіх елементах — між подіями стан не змінюється;'),
    numbered('steps', 'просунути модельний час tcurr = tnext;'),
    numbered('steps', 'виконати outAct() усіх елементів, у яких tnext = tcurr.'),
    ...code([
      'simulate(time: number): this {',
      '  for (;;) {',
      '    let tnext = Infinity;',
      '    for (const e of this.elements) tnext = Math.min(tnext, e.tnext);',
      '    const until = Math.min(tnext, time);',
      '    for (const e of this.elements) e.doStatistics(until - this.tcurr);',
      '    this.tcurr = until;',
      '    for (const e of this.elements) e.tcurr = until;',
      '    if (tnext > time) return this;',
      '    const fired = this.elements.filter((e) => e.tnext === this.tcurr);',
      '    for (const e of fired) e.outAct();',
      '  }',
      '}',
    ]),
    p(
      'На відміну від лістингу методички, останній крок не виходить за межу time: статистика накопичується точно до кінця ' +
        'інтервалу моделювання, тож середні за часом величини діляться на правильну тривалість.',
    ),
    tableCaption('Трасування перших кроків імітації (аналог printInfo)'),
    ...table(
      ['Крок', 't', 'Подія', 'Створено', 'Стан', 'Черга', 'Обслуговано', 'Відмови'],
      t1.trace.map((r, i) => [String(i + 1), num(r.t), r.fired, int(r.created), String(r.state), String(r.queue), int(r.served), int(r.failures)]),
      [0.6, 0.9, 1.5, 1.1, 0.7, 0.7, 1.5, 1],
    ),
    tableCaption(`Результати моделювання за T = ${int(r1.time)} (${int(r1.steps)} кроків імітації)`),
    ...table(
      ['Показник', 'Значення'],
      [
        ['Створено вимог (CREATOR quantity)', int(r1.created)],
        ['Обслуговано вимог (PROCESSOR quantity)', int(r1.process.served)],
        ['Кількість відмов', int(r1.process.failures)],
        ['Імовірність відмови', num(r1.process.failureProbability, 4)],
        ['Середня довжина черги', num(r1.process.meanQueue)],
        ['Середній час очікування в черзі', num(r1.process.meanWait)],
      ],
      [3, 1],
    ),
    p(
      'Імовірність відмови обчислюється як відношення кількості відмов до кількості вимог, що надійшли в PROCESS ' +
        '(у методичці — до кількості обслугованих, що дає дещо завищену оцінку).',
    ),
  );

  // ── Завдання 2
  const u = t2.theory;
  add(
    task(2, 'Модифікувати алгоритм, додавши обчислення середнього завантаження пристрою. 5 балів.'),
    p(
      'Завантаження — частка часу, протягом якої пристрій зайнятий. Метод doStatistics(delta) класу Process накопичує інтеграл ' +
        'кількості зайнятих пристроїв busyArea поряд з інтегралом довжини черги; середнє завантаження U = busyArea / (T·c).',
    ),
    ...code([
      'override doStatistics(delta: number): void {',
      '  this.queueArea += this.#queue.length * delta;',
      '  this.busyArea += this.#busy.length * delta;',
      '}',
    ]),
    p(
      `Еталоном слугують точні формули СМО M/M/1/6 (ρ = 0,5): U = ρ·(1 − P_відм) = ${num(u.utilization, 4)}, ` +
        `L_черги = ${num(u.meanQueue, 4)}, P_відм = ${num(u.failureProbability, 4)}.`,
    ),
    tableCaption('Збіжність середнього завантаження зі збільшенням часу моделювання'),
    ...table(
      ['T', 'Створено', 'U імітація', 'U теорія', 'Відхилення', 'L_черги', 'P_відм'],
      t2.byTime.map((r) => [
        int(r.time),
        int(r.created),
        num(r.process.utilization, 4),
        num(u.utilization, 4),
        dev(r.process.utilization, u.utilization),
        num(r.process.meanQueue, 4),
        num(r.process.failureProbability, 4),
      ]),
    ),
    ...(await figure(png('task2-utilization'), 'Накопичене середнє завантаження U(t) під час імітації')),
    p(
      `Оцінка завантаження збігається до теоретичного значення: при T = 10⁶ відхилення становить ` +
        `${dev(t2.byTime[3]?.process.utilization ?? 0, u.utilization)}.`,
    ),
  );

  // ── Завдання 3
  const r3 = t3.run;
  add(
    task(3, 'Створити модель за схемою, представленою на рисунку 2.1 методичних вказівок. 30 балів.'),
    p(
      'Модель CREATE → PROCESS 1 → PROCESS 2 → PROCESS 3 → DISPOSE будується з’єднанням елементів маршрутами to(next); ' +
        'вимога, що отримала відмову в будь-якому процесі, залишає модель. ' +
        `Параметри: інтервал між надходженнями ${label(r3.params.create.label)}; ` +
        r3.params.stages.map((s, i) => `PROCESS ${i + 1} — ${label(s.delay.label)}, черга ≤ ${cap(s.maxQueue)}`).join('; ') +
        `; час моделювання ${int(r3.params.time)}.`,
    ),
    ...(await figure(png('task3-scheme'), 'Схема моделі з трьох послідовних процесів')),
    ...code([
      "const create = new Create('CREATE', exponential(2), rng);",
      "const p1 = new Process('PROCESS 1', exponential(1), rng, { maxQueue: 5 });",
      "const p2 = new Process('PROCESS 2', exponential(1.5), rng, { maxQueue: 5 });",
      "const p3 = new Process('PROCESS 3', exponential(1.2), rng, { maxQueue: 5 });",
      "const dispose = new Dispose('DISPOSE');",
      'create.next = to(p1); p1.next = to(p2); p2.next = to(p3); p3.next = to(dispose);',
      'new Model([create, p1, p2, p3, dispose]).simulate(100_000);',
    ]),
    tableCaption('Результати моделювання трьох послідовних процесів'),
    ...table(['Елемент', 'Надійшло', 'Обслуговано', 'Відмови', 'P_відм', 'L_черги', 'U', 'Очікування'], r3.stages.map(stageCells), [1.4, 1, 1.1, 0.9, 0.9, 0.9, 0.8, 1]),
    p(
      `Створено ${int(r3.created)} вимог, вийшло з моделі ${int(r3.disposed)}, середній час перебування в системі ${num(r3.meanTimeInSystem)}. ` +
        `Баланс вимог виконується: ${int(r3.created)} = ${int(r3.disposed)} (вийшли) + ${int(r3.stages.reduce((s, x) => s + x.failures, 0))} (відмови) + ` +
        `${int(r3.inSystem)} (у моделі на момент T).`,
    ),
    ...(await figure(png('task3-queues'), 'Довжини черг процесів на початку імітації')),
    p(
      'Вузьке місце — PROCESS 2 з найбільшим часом обслуговування: у ньому найдовша черга й найбільша частка відмов. ' +
        'Потік на вході наступних процесів проріджений відмовами попередніх, тому кількість надходжень спадає вздовж ланцюга.',
    ),
  );

  // ── Завдання 4
  const rows = t4.rows;
  add(
    task(4, 'Виконати верифікацію моделі, змінюючи значення вхідних змінних та параметрів моделі. Навести результати верифікації у таблиці. 10 балів.'),
    p('Верифікацію виконано трьома способами:'),
    bullet(
      'зміна вхідних змінних і параметрів по одному відносно базового варіанта — для кожного варіанта заздалегідь сформульовано ' +
        'очікуваний напрямок зміни вихідних величин, програма перевіряє його автоматично;',
    ),
    bullet('порівняння PROCESS 1 з формулами M/M/1/K — на його вхід завжди надходить пуассонівський потік;'),
    bullet('необмежені черги: за теоремою Берка ланцюг є мережею Джексона, кожен процес — M/M/1 з тим самим λ.'),
    p(
      'Позначення: tc — середній інтервал надходження, t_i — середній час обслуговування в PROCESS i, P_i — імовірність відмови, ' +
        `L_i — середня довжина черги, U_i — завантаження, W — середній час перебування в системі. Час моделювання T = ${int(rows[0]?.run.params.time ?? 0)}.`,
    ),
    tableCaption('Результати верифікації: імовірності відмови та довжини черг'),
    ...table(
      ['№', 'Зміна параметрів', 'P1', 'P2', 'P3', 'L1', 'L2', 'L3'],
      rows.map((r, i) => [String(i + 1), `${r.label}: ${r.change}`, ...r.run.stages.map((s) => num(s.failureProbability, 4)), ...r.run.stages.map((s) => num(s.meanQueue))]),
      [0.5, 3.6, 1, 1, 1, 0.9, 0.9, 0.9],
    ),
    tableCaption('Результати верифікації: завантаження та час перебування'),
    ...table(
      ['№', 'Зміна параметрів', 'U1', 'U2', 'U3', 'W'],
      rows.map((r, i) => [String(i + 1), `${r.label}: ${r.change}`, ...r.run.stages.map((s) => num(s.utilization)), num(r.run.meanTimeInSystem)]),
      [0.5, 4.2, 1, 1, 1, 1],
    ),
    tableCaption('Очікувані зміни вихідних величин відносно базового варіанта'),
    ...table(
      ['№', 'Варіант', 'Очікувалось', 'Результат'],
      rows.slice(1).map((r, i) => [
        String(i + 2),
        r.label,
        r.checks.map((c) => c.label).join('; '),
        r.checks.every((c) => c.ok) ? 'підтверджено' : `ні: ${r.checks.filter((c) => !c.ok).map((c) => c.label).join('; ')}`,
      ]),
      [0.4, 2, 4.2, 1.4],
    ),
    tableCaption('PROCESS 1: імітація проти формул M/M/1/K'),
    ...table(
      ['№', 'Варіант', 'P1 імітація', 'P1 теорія', 'L1 імітація', 'L1 теорія', 'U1 імітація', 'U1 теорія'],
      rows.flatMap((r, i) => {
        const s = r.run.stages[0];
        const t = r.firstStageTheory;
        return s && t
          ? [[String(i + 1), r.label, num(s.failureProbability, 4), num(t.failureProbability, 4), num(s.meanQueue), num(t.meanQueue), num(s.utilization), num(t.utilization)]]
          : [];
      }),
      [0.4, 2.4, 1, 1, 1, 1, 1, 1],
    ),
    tableCaption(`Необмежені черги: імітація (T = ${int(t4.jackson.run.params.time)}) проти мережі Джексона`),
    ...table(
      ['Процес', 'L імітація', 'L теорія', 'Відхилення', 'U імітація', 'U теорія', 'Очікування імітація', 'Очікування теорія'],
      t4.jackson.run.stages.map((s, i) => {
        const t = t4.jackson.theory[i];
        return t
          ? [s.name, num(s.meanQueue), num(t.meanQueue), dev(s.meanQueue, t.meanQueue), num(s.utilization), num(t.utilization), num(s.meanWait), num(t.meanWait)]
          : [s.name, '', '', '', '', '', '', ''];
      }),
    ),
    p(
      `Середній час перебування в системі з необмеженими чергами: імітація ${num(t4.jackson.run.meanTimeInSystem)}, ` +
        `теорія ${num(t4.jackson.meanTimeInSystem)} (відхилення ${dev(t4.jackson.run.meanTimeInSystem, t4.jackson.meanTimeInSystem)}).`,
    ),
    p(
      'Усі очікувані напрямки змін підтвердились. Детерміновані затримки дають точні значення (черг і відмов немає, U_i = t_i / tc). ' +
        'Зменшення дисперсії часу обслуговування за незмінних середніх (рівномірний закон, закон Ерланга) зменшує черги, як і передбачає ' +
        'формула Поллачека — Хінчина. Для PROCESS 1 і для ланцюга з необмеженими чергами імітація збігається з аналітичними формулами ' +
        'в межах статистичної похибки, отже модель адекватна.',
    ),
  );

  // ── Завдання 5
  add(
    task(5, 'Модифікувати клас PROCESS, щоб можна було його використовувати для моделювання процесу обслуговування кількома ідентичними пристроями. 20 балів.'),
    p(
      'Клас Process зберігає масив зайнятих каналів (вимога та момент завершення її обслуговування) і спільну чергу. ' +
        'tnext процесу — найменший момент завершення серед каналів. У outAct() звільняються всі канали, що завершили обслуговування ' +
        'в поточний момент; вільні канали забирають вимоги з черги, після чого обслуговані вимоги передаються далі за маршрутом.',
    ),
    ...code([
      'override inAct(job: Job): void {',
      '  this.arrivals++;',
      '  if (this.#busy.length < this.channels) this.#start(job);',
      '  else if (this.#queue.length < this.maxQueue) this.#queue.push({ job, since: this.tcurr });',
      '  else this.failures++;',
      '}',
      '',
      'override outAct(): void {',
      '  const done = this.#busy.filter((c) => c.tnext <= this.tcurr);',
      '  this.#busy = this.#busy.filter((c) => c.tnext > this.tcurr);',
      '  this.quantity += done.length;',
      '  while (this.#busy.length < this.channels) {',
      '    const w = this.#queue.shift();',
      '    if (!w) break;',
      '    this.waitTotal += this.tcurr - w.since;',
      '    this.#start(w.job);',
      '  }',
      '  this.#refreshTnext();',
      '  for (const c of done) this.send(c.job);',
      '}',
    ]),
    p(
      `Перевірка: CREATE exp(${t5.createMean}) → PROCESS exp(${label(String(t5.serviceMean))}) з c пристроями → DISPOSE, T = ${int(t5.time)}, ` +
        `навантаження a = λ/μ = ${num(t5.serviceMean / t5.createMean, 1)}. Еталон — формули M/M/c/K.`,
    ),
    tableCaption('Багатоканальний PROCESS: імітація проти формул M/M/c/K'),
    ...table(
      ['c', 'Черга', 'P_відм імітація', 'P_відм теорія', 'L_черги імітація', 'L_черги теорія', 'Зайнято імітація', 'Зайнято теорія'],
      t5.rows.map((r) => [
        String(r.channels),
        cap(r.maxQueue),
        num(r.sim.failureProbability, 4),
        num(r.theory.failureProbability, 4),
        num(r.sim.meanQueue),
        num(r.theory.meanQueue),
        num(r.sim.meanBusy),
        num(r.theory.meanBusy),
      ]),
      [0.5, 0.7, 1, 1, 1, 1, 1, 1],
    ),
    ...(await figure(png('task5-queue'), 'Середня довжина черги залежно від кількості пристроїв')),
    ...(await figure(png('task5-failure'), 'Імовірність відмови залежно від кількості пристроїв')),
    p(
      'Імітація відтворює формули M/M/c/K для всіх c. Кожен додатковий пристрій різко зменшує ймовірність відмови та чергу; ' +
        'при необмеженій черзі середня кількість зайнятих пристроїв дорівнює a = λ/μ незалежно від c (за умови a < c).',
    ),
  );

  // ── Завдання 6
  add(
    task(6, 'Модифікувати клас PROCESS, щоб можна було організовувати вихід в два і більше наступних блоків, в тому числі з поверненням у попередні блоки. 30 балів.'),
    p(
      'Маршрут елемента задається об’єктом Router. Функція branch будує маршрут з кількома гілками: для кожної вимоги розігрується ' +
        'випадкове число й вибирається гілка відповідно до ймовірностей переходу. Цільовим може бути будь-який елемент, зокрема ' +
        'попередній або сам цей елемент, тож повернення не потребує окремої логіки. Повернена вимога стає в кінець черги й не обходить тих, хто вже чекає. ' +
        'Маршрутизатор рахує фактичні переходи по кожній гілці, що дає змогу перевірити правильність розподілу.',
    ),
    ...code([
      'p1.next = branch({ to: p2, p: 0.7 }, { to: p3, p: 0.3 });',
      'p2.next = branch({ to: p1, p: 0.2 }, { to: dispose, p: 0.8 }); // повернення',
      'p3.next = branch({ to: p1, p: 0.4 }, { to: dispose, p: 0.6 }); // повернення',
    ]),
    p(
      `Параметри мережі: CREATE exp(${t6.createMean}) → PROCESS 1; ` +
        t6.nodes.map((n) => `${n.name} — exp(${label(String(n.delay))}), пристроїв ${n.channels}`).join('; ') +
        `; T = ${int(t6.time)}. Інтенсивності потоків у вузлах знайдено з рівнянь балансу λ_j = γ_j + Σ λ_i·p_ij методом Гаусса: ` +
        t6.lambdas.map((l, i) => `λ${i + 1} = ${num(l, 4)}`).join(', ') +
        '. В усіх вузлах ρ < 1, тож мережа з необмеженими чергами стаціонарна і є мережею Джексона.',
    ),
    ...(await figure(png('task6-scheme'), 'Схема мережі з розгалуженням і поверненням у PROCESS 1 (на стрілках — імовірності переходу)')),
    tableCaption('Задані ймовірності та фактичні частоти переходів'),
    ...table(
      ['Звідки', 'Куди', 'Задана ймовірність', 'Фактична частота'],
      t6.unlimited.transitions.map((tr) => [tr.from, tr.to, num(tr.p, 2), num(tr.observed, 4)]),
    ),
    tableCaption('Необмежені черги: імітація проти теорії мереж Джексона'),
    ...table(
      ['Вузол', 'λ імітація', 'λ теорія', 'L_черги імітація', 'L_черги теорія', 'Відхилення', 'U імітація', 'U теорія'],
      t6.unlimited.nodes.map((s, i) => {
        const t = t6.theory[i];
        return t
          ? [s.name, num(s.arrivals / t6.time, 4), num(t6.lambdas[i] ?? 0, 4), num(s.meanQueue), num(t.meanQueue), dev(s.meanQueue, t.meanQueue), num(s.utilization), num(t.utilization)]
          : [s.name, '', '', '', '', '', '', ''];
      }),
      [1.3, 1, 1, 1, 1, 1, 1, 1],
    ),
    p(
      `Середній час перебування в мережі: імітація ${num(t6.unlimited.meanTimeInSystem)}, теорія (формула Літтла W = ΣL_i / γ) ` +
        `${num(t6.theoryTimeInSystem)}, відхилення ${dev(t6.unlimited.meanTimeInSystem, t6.theoryTimeInSystem)}.`,
    ),
    tableCaption(`Та сама мережа з обмеженими чергами (≤ ${t6.limited.maxQueue})`),
    ...table(['Вузол', 'Надійшло', 'Обслуговано', 'Відмови', 'P_відм', 'L_черги', 'U', 'Очікування'], t6.limited.nodes.map(stageCells), [1.4, 1, 1.1, 0.9, 0.9, 0.9, 0.8, 1]),
    p(
      `Створено ${int(t6.limited.created)} вимог, вийшло через DISPOSE ${int(t6.limited.disposed)}, середній час перебування ` +
        `${num(t6.limited.meanTimeInSystem)}. Обмеження черг скорочує час перебування, але частина вимог отримує відмову — найчастіше ` +
        'у PROCESS 1, куди, окрім зовнішнього потоку, повертаються вимоги з PROCESS 2 і PROCESS 3.',
    ),
  );

  add(
    heading('Висновки', true),
    p(
      'Об’єктно-орієнтований підхід дозволив описати модель як набір однотипних елементів з єдиним інтерфейсом (inAct, outAct, doStatistics). ' +
        'Алгоритм імітації за принципом найближчої події не залежить від структури моделі й однаково працює для одного пристрою, ' +
        'ланцюга з трьох процесів і мережі з поверненнями.',
    ),
    p(
      'Середнє завантаження обчислюється інтегруванням кусково-сталої функції стану пристрою між подіями; оцінка збігається до ' +
        'теоретичного значення зі збільшенням часу моделювання.',
    ),
    p(
      `Модель з трьох процесів верифіковано ${rows.length - 1} варіантами зміни вхідних змінних і параметрів: усі очікувані напрямки змін ` +
        'підтверджено, для детермінованих затримок отримано точні значення, для пуассонівського входу — збіг з формулами M/M/1/K ' +
        'і теорією мереж Джексона.',
    ),
    p(
      'Узагальнення класу PROCESS на c ідентичних пристроїв відтворює формули M/M/c/K. Заміна поля nextElement маршрутом Router ' +
        'дає вихід у будь-яку кількість блоків, зокрема з поверненням у попередні; фактичні частоти переходів і характеристики вузлів ' +
        'збігаються із заданими ймовірностями та теорією мереж Джексона.',
    ),
  );

  const list = (reference: string, format: (typeof LevelFormat)[keyof typeof LevelFormat], txt: string) => ({
    reference,
    levels: [{ level: 0, format, text: txt, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1069, hanging: 360 } } } }],
  });
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    numbering: { config: [list('bullets', LevelFormat.BULLET, '–'), list('steps', LevelFormat.DECIMAL, '%1)')] },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1701, right: 851 } } },
        children: [...titlePage(), ...body],
      },
    ],
  });
  return Packer.toBuffer(doc);
};
