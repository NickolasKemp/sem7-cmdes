/** Формування звіту у форматі Word (.docx): титульна сторінка, хід роботи з таблицями й рисунками, висновки. */
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
import { at, type Checks, type Estimate, type Estimates, type Lab5, type NetArc, type NetStructure, type NetTransition, type Nets, type Results, type Variant } from './data.ts';
import { int, num, pct, pm } from './format.ts';

export interface ReportInput {
  readonly results: Results;
  readonly nets: Nets;
  readonly lab5: Lab5;
  /** шлях до файла пакета мережі: package/<папка>/<файл> */
  readonly pack: (folder: string, file: string) => string;
  /** шлях до растрової версії графіка */
  readonly chart: (name: string) => string;
}

const FONT = 'Times New Roman';
const MONO = 'Courier New';
/** 14 pt у половинах пункту */
const SIZE = 28;
const TABLE_SIZE = 22;
const SMALL_SIZE = 16;
/** ширина області тексту A4 з полями 3 / 1,5 см, DXA */
const TEXT_W = 9354;
const LINE = 360;

type Block = Paragraph | Table;

interface TextOptions {
  readonly bold?: boolean;
  readonly italics?: boolean;
  readonly size?: number;
  readonly font?: string;
  readonly subScript?: boolean;
  readonly superScript?: boolean;
}

const text = (s: string, o: TextOptions = {}): TextRun =>
  new TextRun({ text: s, font: o.font ?? FONT, size: o.size ?? SIZE, bold: o.bold, italics: o.italics, subScript: o.subScript, superScript: o.superScript });

/** Розмітка абзацу: **жирний** фрагмент, `_{…}` — нижній індекс, `^{…}` — верхній. */
const runs = (s: string, size = SIZE): TextRun[] =>
  s
    .split(/(\*\*[^*]+\*\*|[_^]\{[^}]*\})/)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith('**')) return text(part.slice(2, -2), { bold: true, size });
      if (part.startsWith('_{')) return text(part.slice(2, -1), { size, subScript: true });
      if (part.startsWith('^{')) return text(part.slice(2, -1), { size, superScript: true });
      return text(part, { size });
    });

/** Формула з індексами: `M^{+}_{P1}` — верхній і нижній індекси у фігурних дужках. */
const fx = (s: string, size = SIZE): TextRun[] =>
  s
    .split(/([_^]\{[^}]*\})/)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith('_{')) return text(part.slice(2, -1), { italics: true, size, subScript: true });
      if (part.startsWith('^{')) return text(part.slice(2, -1), { italics: true, size, superScript: true });
      return text(part, { italics: true, size });
    });

const p = (s: string): Paragraph =>
  new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 120, line: LINE }, indent: { firstLine: 709 }, children: runs(s) });

/** Формула окремим рядком по центру. */
const formula = (s: string): Paragraph =>
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 120, line: LINE }, children: fx(s) });

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
        spacing: { before: i === 0 ? 160 : 0, after: i === lines.length - 1 ? 200 : 0 },
        children: [text(line || ' ', { font: MONO, size: 16 })],
      }),
  );

let tableNo = 0;
let figureNo = 0;

const tableCaption = (s: string): Paragraph =>
  new Paragraph({ spacing: { before: 160, after: 60 }, keepNext: true, children: [text(`Таблиця ${++tableNo} – ${s}`)] });

const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' } as const;

/** Клітинка — рядок або готові фрагменти тексту (формула з індексами). */
type Cell = string | readonly TextRun[];

interface TableOptions {
  readonly weights?: readonly number[];
  readonly size?: number;
}

/** Таблиця на всю ширину області тексту, ширини стовпців задаються частками, текст клітинок — по центру. */
const table = (head: readonly string[], rows: readonly (readonly Cell[])[], { weights, size = TABLE_SIZE }: TableOptions = {}): Block[] => {
  const w = weights ?? head.map(() => 1);
  const total = w.reduce((s, x) => s + x, 0);
  const widths = w.map((x) => Math.floor((x / total) * TEXT_W));
  widths[0] = (widths[0] ?? 0) + TEXT_W - widths.reduce((s, x) => s + x, 0);
  const margin = size < TABLE_SIZE ? 20 : 60;
  const cell = (c: Cell, i: number, header: boolean): TableCell =>
    new TableCell({
      width: { size: widths[i] ?? 0, type: WidthType.DXA },
      shading: header ? { type: ShadingType.CLEAR, fill: 'E7E6E6', color: 'auto' } : undefined,
      borders: { top: border, bottom: border, left: border, right: border },
      margins: { top: 30, bottom: 30, left: margin, right: margin },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: typeof c === 'string' ? [text(c, { size, bold: header })] : [...c] })],
    });
  return [
    new Table({
      width: { size: TEXT_W, type: WidthType.DXA },
      columnWidths: widths,
      rows: [
        new TableRow({ tableHeader: true, cantSplit: true, children: head.map((s, i) => cell(s, i, true)) }),
        ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) })),
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
    c('Комп’ютерний практикум № 6', 840),
    c('з дисципліни «Комп’ютерне моделювання дискретно-подійних систем»', 600),
    c('Тема: «Застосування алгоритму стохастичної мережі Петрі для реалізації моделей дискретно-подійних систем»'),
    c('Виконав:', 600),
    c('студент групи ІП-34'),
    c('Туболев М. Р.'),
    c('Перевірив:', 360),
    c('ас.'),
    c('Коринецький Д. С.'),
    c('Захищено з балом: _____', 1200),
    c('Київ 2026', 360),
    new Paragraph({ children: [new PageBreak()] }),
  ];
};

// ───────────────────────────── опис мережі для звіту, побудований зі структури мережі

const GENERATOR = 'Генератор';

const delayText = (t: NetTransition): string => {
  if (t.distribution === 'const') return num(t.delay, t.delay % 1 === 0 ? 0 : 2);
  return `${t.distribution}(${num(t.delay, t.delay % 1 === 0 ? 0 : 1)})`;
};

const ruleText = (t: NetTransition): string =>
  [t.priority ? `c = ${t.priority}` : '', t.probability !== 1 ? `b = ${num(t.probability, 1)}` : ''].filter(Boolean).join('; ') || '—';

const placeName = (net: NetStructure, i: number): string => {
  const place = net.places[i];
  if (!place) throw new Error(`немає позиції ${i}`);
  return place.name;
};

const arcText = (net: NetStructure, a: NetArc): string => `${placeName(net, a.place)}${a.k > 1 ? ` (×${a.k})` : ''}${a.info ? ' — інф.' : ''}`;

/** Таблиця переходів: події моделі, їхні передумови й післяумови, затримка та спосіб розв’язання конфлікту. */
const transitionsTable = (net: NetStructure): Block[] =>
  table(
    ['Перехід (подія)', 'Вхідні позиції', 'Вихідні позиції', 'Затримка', 'Пріоритет c, ймовірність b'],
    net.transitions.map((t) => [
      t.name,
      t.in.map((a) => arcText(net, a)).join('; '),
      t.out
        .filter((a) => placeName(net, a.place) !== GENERATOR)
        .map((a) => arcText(net, a))
        .join('; ') || '—',
      delayText(t),
      ruleText(t),
    ]),
    { weights: [1.5, 2.2, 2, 1, 1.1] },
  );

const initialMarking = (net: NetStructure): string =>
  net.places
    .filter((x) => x.mark > 0)
    .map((x) => `«${x.name}» — ${x.mark}`)
    .join(', ');

const est = (e: Estimate, digits = 2, scale = 1): string => pm(e, digits, scale);
const share = (e: Estimate): string => `${num(e.mean * 100, 1)} ± ${num(e.halfWidth * 100, 1)} %`;

/** Чи перекриваються 95 % довірчі інтервали двох оцінок. */
const agree = (a: Estimate, b: Estimate): string => (Math.abs(a.mean - b.mean) <= a.halfWidth + b.halfWidth ? 'так' : 'ні');

const checksText = (c: Checks): string =>
  `За всі прогони базового варіанта оброблено ${int(c.events)} моментів подій; інваріанти порушено ${c.invariantViolations} разів, ` +
  `матричні рівняння станів на кінець прогону не виконались у ${c.stateEquationMismatches} випадках.`;

/** Рядки Java-методу мережі з файла пакета: табуляція замінюється двома пробілами. */
const methodLines = async (path: string, limit?: number): Promise<string[]> => {
  const lines = (await readFile(path, 'utf8')).trimEnd().split('\n').map((l) => l.replace(/\t/g, '  '));
  if (!limit || lines.length <= limit) return lines;
  return [...lines.slice(0, limit), '  …', ...lines.slice(-4)];
};

const variantsTable = (variants: readonly Variant[], columns: readonly (readonly [string, (r: Estimates) => string])[]): Block[] =>
  table(
    ['Варіант', ...columns.map(([h]) => h)],
    variants.map((v) => [v.label, ...columns.map(([, f]) => f(v.result))]),
    { weights: [2, ...columns.map(() => 1)] },
  );

export const buildDocx = async ({ results, nets, lab5, pack, chart }: ReportInput): Promise<Buffer> => {
  tableNo = 0;
  figureNo = 0;
  const body: Block[] = [];
  const add = (...b: Block[]): void => void body.push(...b);
  const { conveyor, stock, web } = results;

  // ───────────────────────────── вступ
  add(
    heading('Хід роботи', true),
    p(
      'Моделі реалізовано на Java з бібліотекою PetriObjModelPaint (github.com/StetsenkoInna/PetriObjModelPaint). Її модуль ' +
        'petri-math містить елементи стохастичної мережі Петрі — позицію PetriP, перехід PetriT, дуги ArcIn (вхідна, зокрема ' +
        'інформаційна) і ArcOut, мережу PetriNet — та клас PetriSim з алгоритмом імітації. Перехід PetriT багатоканальний: ' +
        'зберігає список моментів виходу маркерів timeOut, має параметр затримки з законом розподілу (exp, unif, norm або ' +
        'стале значення), пріоритет і ймовірність запуску. Модуль petri-model містить графічну мережу GraphPetriNet, яку ' +
        'малює редактор, і засоби збереження PNML.',
    ),
    p(
      'Мережа створюється так само, як у методі, що його редактор зберігає командою Save method: списки позицій, переходів і ' +
        'дуг передаються конструктору PetriNet. Нижче — фрагмент створення мережі задачі 1 (допоміжний клас NetBuilder лише ' +
        'додає елементи в ці списки і запам’ятовує координати елемента на полотні редактора).',
    ),
    ...code([
      'PetriP free = b.place("Вільний" + (i + 1), 1, x, y);',
      'PetriP done = b.place("Готово" + (i + 1), 0, x, y);',
      '// пристрій знімає деталь зі стрічки, тільки якщо вільний: обробка має пріоритет над рухом далі',
      'PetriT serve = b.exp("Обробка" + (i + 1), c.service(), tx, ty);   // new PetriT + setDistribution("exp", …)',
      'serve.setPriority(1);',
      'b.in(at[i], serve);     // new ArcIn(at[i], serve, 1)',
      'b.in(free, serve);',
      'b.out(serve, free);     // new ArcOut(serve, free, 1)',
      'b.out(serve, done);',
      '…',
      'PetriNet net = new PetriNet("Conveyor", places, transitions, ins, outs);',
    ]),
    p(
      'Імітацію виконує алгоритм класу PetriSim: метод input() здійснює вхід маркерів у переходи, доки є переходи з ' +
        'виконаною умовою запуску (findActiveT), розв’язуючи конфлікти методом doConflikt — спершу за пріоритетом, серед ' +
        'рівних за ймовірністю; метод output() здійснює вихід маркерів з усіх каналів переходів, момент виходу яких настав; ' +
        'getTimeMin() дає момент найближчої події. Цикл прогону — той самий, що в PetriSim.step() і PetriObjModel.go():',
    ),
    ...code([
      'PetriSim sim = new PetriSim(net);',
      'sim.input();                                    // вхід маркерів у момент t = 0',
      'while (true) {',
      '    double next = Math.min(sim.getTimeMin(), time);',
      '    statistics(next - t);                       // середні в часі за інтервал [t; next]',
      '    t = next;',
      '    if (t >= time) break;',
      '    sim.setTimeCurr(t);                         // просування часу до найближчої події',
      '    sim.output();                               // вихід маркерів з переходів',
      '    sim.input();                                // вхід маркерів у переходи',
      '}',
    ]),
    p(
      'Статистика збирається в цьому циклі, а не методом PetriSim.doStatistics(): так її можна рахувати після періоду ' +
        'розгону і для довільних функцій стану. Для позиції це середня в часі кількість маркерів, для переходу — середня ' +
        'кількість зайнятих каналів (buffer) і кількість входів та виходів маркерів (через TransitionFiringListener). ' +
        'Середній час перебування обчислюється за формулою Літтла: середня кількість об’єктів, поділена на інтенсивність ' +
        'їхнього проходження. Кожен дослід повторено кілька разів; у таблицях — середнє і половина ширини 95 % довірчого ' +
        'інтервалу. Генератор випадкових чисел бібліотеки (Math.random) не має початкового значення, тому повторний ' +
        'запуск дає інші числа в межах цих інтервалів.',
    ),
    p(
      'Верифікація кожної моделі складається з чотирьох перевірок: 1) інваріанти мережі — зважені суми маркерів у позиціях ' +
        'і каналах переходів, що мають лишатися сталими, — перевіряються в кожний момент подій; 2) на кінець кожного ' +
        'прогону перевіряються матричні рівняння станів стохастичної мережі Петрі (завдання 5); 3) результати ' +
        'порівнюються з незалежним джерелом — власним алгоритмом практикуму 5 (TypeScript) для задач 1 і 2 та з ' +
        'аналітичним розв’язком для задачі 3; 4) змінюються вхідні параметри і перевіряється, що вихідні характеристики ' +
        'змінюються в очікуваному напрямку.',
    ),
  );

  // ───────────────────────────── Завдання 1
  const c1 = conveyor.base;
  const devices = [1, 2, 3, 4, 5];
  const compare = (rows: readonly (readonly [string, string, number])[], mine: Estimates, theirs: Estimates): Block[] =>
    table(
      ['Характеристика', 'PetriSim (Java)', 'Практикум 5 (TypeScript)', 'Збіг інтервалів'],
      rows.map(([label, key, digits]) => [label, est(at(mine, key), digits), est(at(theirs, key), digits), agree(at(mine, key), at(theirs, key))]),
      { weights: [2.4, 1.3, 1.3, 1] },
    );
  add(
    task(
      1,
      'Ознайомитись з бібліотекою класів PetriObjModelPaint моделювання дискретно-подійних систем на основі стохастичних ' +
        'мереж Петрі та графічним редактором мережі Петрі. З використанням алгоритму імітації стохастичної мережі Петрі ' +
        'класу PetriSim реалізувати модель, розроблену за текстом завдання 1 практикуму 5, та виконати її верифікацію. ' +
        'Зробити висновки про функціонування моделі. 20 балів.',
    ),
    heading('Мережа Петрі конвеєрної системи'),
    p(
      'Завдання 1 практикуму 5 — конвеєр з п’ятьма пристроями: деталі надходять кожні 0,25 хв, обробка exp(1) хв, рух між ' +
        'сусідніми пристроями 1 хв, повернення від п’ятого пристрою до першого 5 хв. Позиція «Біля i» — деталь на стрічці ' +
        'навпроти пристрою i. За цю позицію конфліктують переходи «Обробка i» (пріоритет 1, потребує маркера в позиції ' +
        '«Вільний i») і «Рух» до наступного пристрою (пріоритет 0): якщо пристрій вільний, findActiveT ставить обробку ' +
        'першою і деталь знімається зі стрічки; якщо зайнятий, умова обробки не виконана і деталь їде далі. Переходи руху ' +
        'багатоканальні — стрічка везе скільки завгодно деталей.',
    ),
    tableCaption('Переходи мережі Петрі конвеєрної системи'),
    ...transitionsTable(nets.conveyor),
    p(`Початкове маркірування: ${initialMarking(nets.conveyor)}; решта позицій порожні.`),
    ...(await figure(pack('task1-conveyor', 'net.png'), 'Мережа Петрі конвеєрної системи в редакторі PetriObjModelPaint')),
    heading('Результати моделювання'),
    p(
      `Час моделювання ${int(conveyor.run.time)} хв, статистика збирається після ${int(conveyor.run.warmup ?? 0)} хв, ` +
        `${conveyor.run.runs} прогонів — ті самі умови, що в практикумі 5. Деталей у системі — сума маркерів у позиціях ` +
        '«Біля i» і зайнятих каналів переходів обробки, руху й повернення.',
    ),
    tableCaption('Характеристики конвеєрної системи: PetriSim і алгоритм практикуму 5'),
    ...compare(
      [
        ['Пропускна здатність, дет./хв', 'throughput', 3],
        ['Середня кількість деталей у системі', 'inSystem', 2],
        ['Середній час перебування деталі, хв', 'sojourn', 2],
        ['Середня кількість зайнятих пристроїв', 'busy', 3],
        ['Повернень до першого пристрою на деталь', 'returns', 3],
        ...devices.map((i) => [`Завантаження пристрою ${i}`, `load${i}`, 3] as const),
      ],
      c1,
      lab5.conveyor,
    ),
    ...(await figure(chart('task1-load'), 'Завантаження пристроїв: PetriSim і алгоритм практикуму 5')),
    tableCaption('Розподіл кількості зайнятих пристроїв'),
    ...table(
      ['Зайнято пристроїв', ...[0, ...devices].map(String)],
      [
        ['PetriSim', ...[0, ...devices].map((k) => pct(at(c1, `busy${k}`).mean, 1))],
        ['Практикум 5', ...[0, ...devices].map((k) => pct(at(lab5.conveyor, `busy${k}`).mean, 1))],
      ],
      { weights: [1.6, 1, 1, 1, 1, 1, 1] },
    ),
    heading('Верифікація'),
    p(
      'Інваріанти: для кожного пристрою сума маркерів у позиції «Вільний i» і зайнятих каналів переходу «Обробка i» ' +
        'дорівнює 1 (пристрій обробляє не більше однієї деталі); маркер генератора єдиний. ' +
        checksText(conveyor.checks),
    ),
    p(
      'Теоретична перевірка: у сталому режимі всі деталі обробляються, тому середня кількість зайнятих пристроїв дорівнює ' +
        `λ·Tобсл = 4·1 = 4; модель дає ${num(at(c1, 'busy').mean, 3)}. Пропускна здатність ${num(at(c1, 'throughput').mean, 3)} ` +
        'дет./хв дорівнює інтенсивності надходження.',
    ),
    tableCaption('Верифікація моделі конвеєра зміною вхідних параметрів'),
    ...variantsTable(conveyor.variants, [
      ['Пропускна здатність, дет./хв', (r) => num(at(r, 'throughput').mean, 2)],
      ['Зайнято пристроїв', (r) => num(at(r, 'busy').mean, 2)],
      ['Повернень на деталь', (r) => num(at(r, 'returns').mean, 2)],
      ['Час у системі, хв', (r) => num(at(r, 'sojourn').mean, 2)],
    ]),
    p(
      'Зміни відповідають очікуваним. Удвічі рідше надходження або вдвічі швидша обробка зменшують середню кількість ' +
        'зайнятих пристроїв до λ·Tобсл = 2, повернення майже зникають, і час перебування наближається до часу обробки ' +
        'плюс рух до вільного пристрою. За обробки exp(1,2) потрібно λ·Tобсл = 4,8 пристрою з п’яти: система на межі, ' +
        'деталі багато разів об’їжджають коло, час перебування зростає на порядки. Довший рух між пристроями і довше ' +
        'повернення не змінюють завантаження, але збільшують час перебування.',
    ),
    heading('Висновки про функціонування моделі'),
    p(
      `Модель на PetriSim відтворює результати практикуму 5: середній час перебування деталі ${est(at(c1, 'sojourn'))} хв ` +
        `проти ${est(at(lab5.conveyor, 'sojourn'))} хв, довірчі інтервали всіх характеристик перекриваються. Система стабільна, ` +
        `але працює близько до межі: у середньому зайнято ${num(at(c1, 'busy').mean, 2)} пристрою з п’яти, усі п’ять зайняті ` +
        `${pct(at(c1, 'busy5').mean, 1)} часу. Завантаження спадає від ${pct(at(c1, 'load1').mean, 1)} у першого пристрою до ` +
        `${pct(at(c1, 'load5').mean, 1)} у п’ятого, бо деталь доходить до далекого пристрою, лише коли ближчі зайняті. На одну ` +
        `деталь припадає ${num(at(c1, 'returns').mean, 2)} повернення, кожне додає 9 хв руху, тому час перебування майже на ` +
        'порядок більший за час обробки.',
    ),
  );

  // ───────────────────────────── Завдання 2
  const s = stock.base;
  add(
    task(
      2,
      'З використанням алгоритму імітації стохастичної мережі Петрі класу PetriSim реалізувати модель, розроблену за ' +
        'текстом завдання 4 практикуму 5, та виконати її верифікацію. Зробити висновки про функціонування моделі. 20 балів.',
    ),
    heading('Мережа Петрі системи управління запасами'),
    p(
      'Завдання 4 практикуму 5 — запас холодильників з періодичним переглядом: попит exp(0,2) тижня, перегляд кожні 4 ' +
        'тижні, контрольний рівень 72, точка замовлення 18, доставка 3 тижні; без запасу 80 % покупців ідуть, 20 % чекають ' +
        'наступної партії. Покупця обслуговує один з трьох миттєвих переходів: «Продаж» (пріоритет 2, потребує маркера в ' +
        'позиції «Запас»), а якщо запасу немає — «Відмова» або «Очікування» з однаковим пріоритетом 1 і ймовірностями 0,8 і ' +
        '0,2, між якими doConflikt вибирає випадково.',
    ),
    p(
      'Обсяг замовлення залежить від поточного стану запасу (наявний запас + замовлене − невдоволений попит). Його тримає ' +
        'позиція «Нестача»: кількість маркерів у ній завжди дорівнює 72 мінус поточний стан запасу. Умова «поточний стан ' +
        '≤ 18» рівносильна «нестача ≥ 54», тому перехід «Замовити» з’єднано з позицією «Нестача» інформаційною дугою ' +
        'кратності 54 (ArcIn з ознакою inf): дуга перевіряє умову, не забираючи маркерів. Перехід «Дозамовлення» (пріоритет ' +
        '4, інформаційна дуга з позиції «Оформлення») переносить маркери з «Нестачі» у «ВДорозі», доки нестача не стане ' +
        'нульовою, після чого запускається «Кінець» (пріоритет 2). «Доставка» — багатоканальний перехід із затримкою 3: ' +
        'уся партія входить у нього в один момент і в один момент виходить у «Запас».',
    ),
    tableCaption('Переходи мережі Петрі системи управління запасами'),
    ...transitionsTable(nets.stock),
    p(`Початкове маркірування: ${initialMarking(nets.stock)}; невдоволеного попиту немає.`),
    ...(await figure(pack('task2-stock', 'net.png'), 'Мережа Петрі системи управління запасами в редакторі PetriObjModelPaint')),
    heading('Результати моделювання'),
    p(
      `Час моделювання ${int(stock.run.time)} тижнів (10 років) від заданого початкового стану, ${stock.run.runs} прогонів, ` +
        'як у практикумі 5. Середній запас — середнє в часі кількості маркерів у позиції «Запас»; середній час між ' +
        'продажами, що не здійснилися, — час моделювання, поділений на кількість виходів маркерів з переходу «Відмова».',
    ),
    tableCaption('Характеристики системи управління запасами: PetriSim і алгоритм практикуму 5'),
    ...compare(
      [
        ['Середня кількість холодильників у запасі', 'stock', 2],
        ['Середній час між продажами, що не здійснилися, тижнів', 'betweenLost', 2],
        ['Продажів, що не здійснилися, за рік', 'lostPerYear', 1],
        ['Частка покупців, що пішли', 'lostShare', 3],
        ['Частка покупців, що чекали партії', 'backorderShare', 3],
        ['Частка часу без запасу', 'stockouts', 3],
        ['Середній невдоволений попит', 'backlog', 3],
        ['Замовлень за рік', 'orders', 2],
        ['Середній обсяг замовлення', 'orderSize', 1],
      ],
      s,
      lab5.stock,
    ),
    ...(await figure(chart('task2-trace'), 'Наявний запас і поточний стан запасу в одному прогоні моделі на PetriSim')),
    heading('Верифікація'),
    p(
      'Інваріанти: поточний стан запасу плюс маркери позиції «Нестача» (разом з маркерами, що в цей момент перебувають ' +
        'усередині миттєвих переходів «Продаж» і «Дозамовлення») завжди дорівнює контрольному рівню 72; маркер таймера ' +
        `перегляду єдиний. ${checksText(stock.checks)} Найбільший поточний стан запасу за всі прогони — ` +
        `${num(at(s, 'positionMax').mean, 0)}: замовлення ніколи не перевищує контрольний рівень.`,
    ),
    tableCaption('Верифікація моделі запасів зміною вхідних параметрів'),
    ...variantsTable(stock.variants, [
      ['Середній запас', (r) => num(at(r, 'stock').mean, 1)],
      ['Втрачених продажів за рік', (r) => num(at(r, 'lostPerYear').mean, 1)],
      ['Час без запасу', (r) => pct(at(r, 'stockouts').mean, 1)],
      ['Замовлень за рік', (r) => num(at(r, 'orders').mean, 2)],
      ['Обсяг замовлення', (r) => num(at(r, 'orderSize').mean, 1)],
    ]),
    p(
      'Удвічі менший попит майже усуває втрачені продажі і зменшує кількість замовлень. Вища точка замовлення (36) ' +
        'змушує замовляти частіше і меншими партіями, запас не встигає вичерпатися. Частіший перегляд скорочує час без ' +
        'запасу приблизно вдвічі, швидша доставка — ще сильніше. Якщо йдуть 50 % покупців замість 80 %, втрачених продажів ' +
        'стає менше, а час без запасу не змінюється: запас вичерпується так само, змінюється лише поведінка покупця. Усі ' +
        'зміни відповідають логіці системи.',
    ),
    heading('Висновки про функціонування моделі'),
    p(
      `Середня кількість холодильників у запасі — ${est(at(s, 'stock'))}, середній час між продажами, що не здійснилися, — ` +
        `${est(at(s, 'betweenLost'))} тижня; результати практикуму 5 — ${est(at(lab5.stock, 'stock'))} і ` +
        `${est(at(lab5.stock, 'betweenLost'))}, інтервали перекриваються. Попит становить 5 холодильників за тиждень, ` +
        `замовлення розміщується ${num(at(s, 'orders').mean, 1)} раза на рік партіями близько ${num(at(s, 'orderSize').mean, 0)} ` +
        'штук. Після рішення про замовлення до надходження партії минає 3 тижні, за які продається ще близько 15 ' +
        `холодильників, тому ${pct(at(s, 'stockouts').mean, 1)} часу запасу немає — саме тоді й втрачаються продажі. Найдієвіші ` +
        'способи зменшити втрати — підняти точку замовлення або скоротити доставку.',
    ),
  );

  // ───────────────────────────── Завдання 3
  const w = web.base;
  const prm = web.parameters;
  const perSecond = (a: number): number => 1000 / a;
  const stable = web.load.filter((r) => at(r.result, 'rejected').mean === 0 && at(r.result, 'queue').mean < 100);
  const overloaded = web.load.filter((r) => at(r.result, 'rejected').mean > 0);
  const firstOver = overloaded[0];
  const lastOver = overloaded.at(-1);
  if (!firstOver || !lastOver) throw new Error('у дослідах немає перевантаження');
  const stages = (n: 1 | 2): [string, string][] => [
    ['Очікування потоку в черзі', `queueWait${n}`],
    ['Очікування ядра', `coreWait${n}`],
    ['Обчислення', `compute${n}`],
    ['Очікування з’єднання з БД', `dbWait${n}`],
    ['Запис у БД', `write${n}`],
    ['Повернення відповіді', `reply${n}`],
    ['Разом', `time${n}`],
  ];
  const [stagesMain, stagesAux] = [stages(1), stages(2)];
  add(
    task(
      3,
      'Побудувати модель системи, що відтворює багатопотокову обробку запитів на кожному з двох серверів: головному та ' +
        'допоміжному. Для запобігання DDOS атакам для черги запитів встановлено обмеження до 1000. Результат обробки запиту ' +
        'обов’язково зберігається у базі даних перед його поверненням користувачу. База даних є спільною для обох серверів і ' +
        'забезпечена багатопотоковим доступом. Ймовірність звернення до допоміжного сервера 0,3. Часові характеристики ' +
        'обробки запитів, кількість обчислювального ресурсу, задіяного в обчисленнях, та кількість потоків, задіяних у ' +
        'програмі обчислень, задайте самостійно. Метою моделювання є оцінка часу обробки запиту. 20 балів.',
    ),
    heading('Формалізація мережею Петрі'),
    p(
      'Запит проходить такі етапи: надходження, постановка в чергу свого сервера, отримання потоку з пулу потоків ' +
        'програми, обчислення на ядрі процесора, запис результату в базу даних через з’єднання зі спільного пулу, ' +
        'повернення відповіді користувачу, після чого потік повертається в пул. Задані самостійно параметри наведено в ' +
        'таблиці; час вимірюється в мілісекундах.',
    ),
    tableCaption('Параметри моделі обробки запитів'),
    ...table(
      ['Параметр', 'Головний сервер', 'Допоміжний сервер'],
      [
        ['Інтервал надходження запитів (спільний потік)', `exp(${num(prm.arrival, 0)}) мс — ${num(perSecond(prm.arrival), 0)} запитів/с`, 'спільний'],
        ['Ймовірність звернення', num(1 - prm.auxShare, 1), num(prm.auxShare, 1)],
        ['Потоків у програмі обчислень', String(prm.threads[0]), String(prm.threads[1])],
        ['Ядер процесора (обчислювальний ресурс)', String(prm.cores[0]), String(prm.cores[1])],
        ['Час обчислень, мс', `exp(${num(prm.compute[0], 0)})`, `exp(${num(prm.compute[1], 0)})`],
        ['З’єднань з БД (спільний пул)', String(prm.connections), 'спільні'],
        ['Час запису в БД, мс', `exp(${num(prm.write, 0)})`, `exp(${num(prm.write, 0)})`],
        ['Час повернення відповіді, мс', num(prm.reply, 0), num(prm.reply, 0)],
        ['Обмеження черги запитів', String(prm.queueLimit), 'спільне'],
      ],
      { weights: [2.2, 1.6, 1.2] },
    ),
    p(
      'Ресурси — позиції з початковим маркіруванням, що дорівнює кількості ресурсу: «Потоки i», «Ядра i», «БД» (з’єднання), ' +
        `«Місця» (${prm.queueLimit} вільних місць у черзі). Багатопотоковість дають багатоканальні переходи: «Обчислення i» ` +
        'одночасно виконує стільки запитів, скільки є ядер, «Запис i» — скільки є з’єднань. Потік береться з пулу переходом ' +
        '«Прийняти i» і повертається лише переходом «Відповідь i», тобто зайнятий увесь час обробки запиту, включно з ' +
        'очікуванням ядра і записом у БД; ядро зайняте лише під час обчислень. Саме тому потоків задано більше, ніж ядер.',
    ),
    p(
      'Маршрутизація: переходи «ДоГоловного» і «ДоДопоміжного» мають однаковий пріоритет 1 та ймовірності ' +
        `${num(1 - prm.auxShare, 1)} і ${num(prm.auxShare, 1)}; обидва забирають маркер зі спільної позиції «Місця», яка ` +
        'повертається, коли запит отримує потік. Якщо вільних місць немає, умови маршрутизації не виконані і запускається ' +
        'перехід «Відмова» з пріоритетом 0 — запит відхиляється. Спільна база даних — позиція «БД», за яку конфліктують ' +
        'переходи «Запис1» і «Запис2».',
    ),
    tableCaption('Переходи мережі Петрі обробки запитів'),
    ...transitionsTable(nets.web),
    p(`Початкове маркірування: ${initialMarking(nets.web)}.`),
    ...(await figure(chart('task3-web-rotated'), 'Мережа Петрі багатопотокової обробки запитів на двох серверах зі спільною базою даних (рисунок повернуто)', 440)),
    heading('Результати моделювання'),
    p(
      `Час моделювання ${int(web.run.time)} мс (${num(web.run.time / 1000, 0)} с, близько ` +
        `${int((web.run.time - (web.run.warmup ?? 0)) / prm.arrival)} запитів), розгін ${int(web.run.warmup ?? 0)} мс, ` +
        `${web.run.runs} прогонів. Час обробки запиту — від надходження до повернення відповіді. Його оцінено за формулою ` +
        'Літтла: середня кількість запитів на етапі (маркери в позиції або зайняті канали переходу), поділена на ' +
        'інтенсивність потоку запитів через сервер.',
    ),
    tableCaption('Середній час обробки запиту за етапами, мс'),
    ...table(
      ['Етап', 'Головний сервер', 'Допоміжний сервер'],
      stagesMain.map(([label, key], i) => [label, est(at(w, key)), est(at(w, stagesAux[i]?.[1] ?? key))]),
      { weights: [2, 1.2, 1.2] },
    ),
    tableCaption('Загальні характеристики системи'),
    ...table(
      ['Характеристика', 'Значення'],
      [
        ['Середній час обробки запиту (обидва сервери), мс', est(at(w, 'time'))],
        ['Пропускна здатність, запитів/с', est(at(w, 'throughput'), 1, 1000)],
        ['Частка запитів до допоміжного сервера', share(at(w, 'auxShare'))],
        ['Завантаження ядер: головний / допоміжний', `${pct(at(w, 'cores1').mean, 1)} / ${pct(at(w, 'cores2').mean, 1)}`],
        ['Зайнятість потоків: головний / допоміжний', `${pct(at(w, 'threads1').mean, 1)} / ${pct(at(w, 'threads2').mean, 1)}`],
        ['Завантаження з’єднань з БД', share(at(w, 'db'))],
        ['Середня довжина черги запитів', est(at(w, 'queue'))],
        ['Найбільша довжина черги (середнє за прогонами)', num(at(w, 'queueMax').mean, 0)],
        ['Частка відхилених запитів', share(at(w, 'rejected'))],
      ],
      { weights: [2.6, 1.4] },
    ),
    p(
      `Середній час обробки запиту — ${est(at(w, 'time'))} мс: ${est(at(w, 'time1'))} мс на головному сервері і ` +
        `${est(at(w, 'time2'))} мс на допоміжному. Обов’язкова частина (обчислення, запис, відповідь) становить ` +
        `${num(prm.compute[0] + prm.write + prm.reply, 0)} і ${num(prm.compute[1] + prm.write + prm.reply, 0)} мс, решта — ` +
        `очікування. Допоміжний сервер повільніший не лише через довші обчислення: у нього ${prm.cores[1]} ядра і ` +
        `${prm.threads[1]} потоків, завантаження ядер ${pct(at(w, 'cores2').mean, 0)}, і запит у середньому ` +
        `${num(at(w, 'queueWait2').mean, 1)} мс чекає потоку. Черга за базового навантаження коротка, обмеження 1000 не ` +
        'спрацьовує, відхилених запитів немає.',
    ),
    heading('Верифікація'),
    p(
      'Інваріанти: для кожного сервера кількість потоків (у пулі та зайнятих запитами на всіх етапах) і кількість ядер ' +
        '(вільних та зайнятих обчисленнями) сталі; сума вільних з’єднань з БД і каналів переходів запису стала; сума ' +
        `вільних місць і запитів у чергах дорівнює ${prm.queueLimit}. ${checksText(web.checks)}`,
    ),
    p(
      'Аналітична перевірка. Якщо потоків удосталь, мережа розпадається на незалежні системи масового обслуговування: ' +
        'потік exp ділиться з ймовірностями 0,7 і 0,3 на два пуассонівські потоки, обчислення на сервері — система M/M/c ' +
        'з c ядрами, вихідний потік M/M/c теж пуассонівський (теорема Берке), тому запис у БД — система M/M/c із сумарним ' +
        'потоком. Середнє очікування в M/M/c дає формула Ерланга C. Модель з 1000 потоків на кожному сервері порівняно з ' +
        'цим розв’язком.',
    ),
    tableCaption('Порівняння моделі без обмеження потоків з аналітичним розв’язком, мс'),
    ...table(
      ['Характеристика', 'Модель (PetriSim)', 'Теорія', 'Відхилення'],
      (
        [
          ['Очікування ядра, головний сервер', 'coreWait1'],
          ['Очікування ядра, допоміжний сервер', 'coreWait2'],
          ['Час обробки, головний сервер', 'time1'],
          ['Час обробки, допоміжний сервер', 'time2'],
          ['Середній час обробки запиту', 'time'],
        ] as const
      ).map(([label, key]) => {
        const theory = web.theory[key];
        if (theory === undefined) throw new Error(`немає теоретичного значення ${key}`);
        const sim = at(web.unlimited, key);
        return [label, est(sim), num(theory, 2), pct(Math.abs(sim.mean - theory) / theory, 1)];
      }),
      { weights: [2.4, 1.3, 1, 1] },
    ),
    p(
      `Очікування з’єднання з БД за теорією — ${num(web.theory.dbWait ?? 0, 2)} мс для будь-якого запиту, а модель дає ` +
        `${num(at(web.unlimited, 'dbWait1').mean, 2)} мс для запитів головного сервера і ` +
        `${num(at(web.unlimited, 'dbWait2').mean, 2)} мс для допоміжного. Причина — правило розв’язання конфлікту: коли ` +
        'з’єднання звільняється, а чекають запити обох серверів, PetriSim.doConflikt вибирає між переходами «Запис1» і ' +
        '«Запис2» з рівними ймовірностями, а не пропорційно кількості запитів, тому запити допоміжного сервера, яких ' +
        'менше, чекають коротше. Середнє очікування, зважене на частки потоків, — ' +
        `${num((1 - prm.auxShare) * at(web.unlimited, 'dbWait1').mean + prm.auxShare * at(web.unlimited, 'dbWait2').mean, 2)} мс — ` +
        'збігається з теоретичним.',
    ),
    tableCaption('Верифікація моделі обробки запитів зміною вхідних параметрів'),
    ...variantsTable(web.variants, [
      ['Час, головний, мс', (r) => num(at(r, 'time1').mean, 1)],
      ['Час, допоміжний, мс', (r) => num(at(r, 'time2').mean, 1)],
      ['Середній час, мс', (r) => num(at(r, 'time').mean, 1)],
      ['Ядра: гол. / доп.', (r) => `${num(at(r, 'cores1').mean * 100, 0)} / ${num(at(r, 'cores2').mean * 100, 0)} %`],
      ['Потоки: гол. / доп.', (r) => `${num(at(r, 'threads1').mean * 100, 0)} / ${num(at(r, 'threads2').mean * 100, 0)} %`],
      ['Відхилено', (r) => pct(at(r, 'rejected').mean, 1)],
    ]),
    p(
      'Удвічі менше навантаження прибирає очікування, час наближається до обов’язкових 25 і 29 мс. Якщо на допоміжний ' +
        'сервер іде половина запитів, він отримує 250 запитів/с за спроможності ядер 200 — його черга заповнює всі 1000 ' +
        'місць, і частина запитів відхиляється, зокрема й тих, що йшли б на головний сервер, бо місця спільні. Додаткові ' +
        'ядра головного сервера прибирають очікування ядра лише на ньому. Менше з’єднань з БД збільшує час на обох ' +
        'серверах. Потоків 8 і 4 (стільки ж, скільки ядер) замало: потік зайнятий і під час запису в БД, тому ядра ' +
        'простоюють, а черга росте до обмеження. 24 і 12 потоків дають час, близький до аналітичного розв’язку без ' +
        'обмеження потоків: очікування переходить з черги на ядро.',
    ),
    heading('Залежність часу обробки від навантаження'),
    tableCaption('Характеристики системи за різної інтенсивності надходження запитів'),
    ...table(
      ['Інтервал, мс', 'Надходить, запитів/с', 'Оброблено, запитів/с', 'Час обробки, мс', 'Черга', 'Відхилено'],
      web.load.map(({ arrival, result: r }) => [
        num(arrival, 1),
        num(perSecond(arrival), 0),
        num(at(r, 'throughput').mean * 1000, 0),
        est(at(r, 'time'), at(r, 'time').mean > 100 ? 0 : 1),
        num(at(r, 'queue').mean, at(r, 'queue').mean > 100 ? 0 : 1),
        pct(at(r, 'rejected').mean, 1),
      ]),
      { weights: [0.9, 1.1, 1.1, 1.3, 0.9, 1] },
    ),
    ...(await figure(chart('task3-time'), 'Середній час обробки запиту в сталому режимі залежно від інтенсивності надходження')),
    ...(await figure(chart('task3-reject'), 'Оброблені та відхилені запити залежно від інтенсивності надходження')),
    p(
      `До ${num(perSecond(stable.at(-1)?.arrival ?? prm.arrival), 0)} запитів/с система стабільна, час обробки зростає від ` +
        `${num(at(stable[0]?.result ?? w, 'time').mean, 1)} до ${num(at(stable.at(-1)?.result ?? w, 'time').mean, 1)} мс. За ` +
        `${num(perSecond(firstOver.arrival), 0)} запитів/с і більше черга заповнюється до обмеження, пропускна здатність ` +
        `зупиняється на ${num(at(lastOver.result, 'throughput').mean * 1000, 0)} запитів/с, а час обробки — близько ` +
        `${num(at(lastOver.result, 'time').mean / 1000, 1)} с: це час проходження заповненої черги з 1000 запитів. Обмеження ` +
        'черги виконує своє призначення: за атаки час обробки прийнятого запиту не росте необмежено, зайві запити ' +
        `відхиляються (${pct(at(lastOver.result, 'rejected').mean, 0)} за ${num(perSecond(lastOver.arrival), 0)} запитів/с).`,
    ),
    p(
      `Вузьке місце — допоміжний сервер, причому не ядра, а потоки: за перевантаження зайняті всі ${prm.threads[1]} потоків ` +
        `(${pct(at(lastOver.result, 'threads2').mean, 0)}), а ядра завантажені на ${pct(at(lastOver.result, 'cores2').mean, 0)}, ` +
        'бо частина потоків у цей час чекає запису в БД. Допоміжний сервер обробляє ' +
        `${num(at(lastOver.result, 'throughput2').mean * 1000, 0)} запитів/с замість 200 можливих за ядрами, його запити ` +
        'займають більшість із 1000 спільних місць черги, і через це відхиляються й запити до головного сервера, який ще ' +
        `має запас (ядра ${pct(at(lastOver.result, 'cores1').mean, 0)}).`,
    ),
    heading('Висновки про функціонування моделі'),
    p(
      `За базового навантаження ${num(perSecond(prm.arrival), 0)} запитів/с середній час обробки запиту — ` +
        `${est(at(w, 'time'))} мс (головний сервер ${num(at(w, 'time1').mean, 1)} мс, допоміжний ${num(at(w, 'time2').mean, 1)} мс), ` +
        'запити не відхиляються. Модель збігається з аналітичним розв’язком, коли потоки не обмежують обробку, і показує ' +
        'ефект, якого аналітична модель не описує: потік, зайнятий на час запису в БД, обмежує використання ядер. Щоб ' +
        'підняти пропускну здатність, насамперед слід збільшити пул потоків допоміжного сервера або розділити черги серверів.',
    ),
  );

  // ───────────────────────────── Завдання 4
  const webMethod = await methodLines(pack('task3-web', 'method.txt'));
  const pnml = (await readFile(pack('task3-web', 'net.pnml'), 'utf8')).split('\n');
  const firstTransition = pnml.findIndex((l) => l.includes('<transition'));
  add(
    task(
      4,
      'Для усіх розроблених мереж Петрі створити та подати разом зі звітом такий пакет файлів: 1) текст завдання, 2) скриншот ' +
        'графічного зображення розробленої мережі Петрі у форматі .png, яка є результатом збереження Save GraphNet, ' +
        '3) результат збереження мережі Петрі у форматі .pnml, 4) результат збереження для мережі Петрі у вигляді ' +
        'java-методу у форматі .txt. 20 балів.',
    ),
    p(
      'Пакети файлів лежать у каталозі package/ — по одній папці на мережу. Файли створено засобами самої бібліотеки ' +
        'PetriObjModelPaint: мережа PetriNet перетворюється на графічну мережу GraphPetriNet (GraphNetBuilder) з ' +
        'координатами елементів; рисунок .png — це зображення, яке малює полотно редактора (метод paintGraphPetriNet); ' +
        'net.pns — серіалізована GraphPetriNet, тобто те, що записує команда Save GraphNet, цей файл відкривається в ' +
        'редакторі; net.pnml записує PnmlGenerator (команда експорту PNML); method.txt — текст, який редактор формує ' +
        'командою збереження мережі як методу (FileUse.saveNetAsMethod).',
    ),
    tableCaption('Пакети файлів розроблених мереж Петрі'),
    ...table(
      ['Мережа', 'Папка', 'Позицій', 'Переходів', 'Файли'],
      (
        [
          ['Конвеєрна система (завдання 1)', 'task1-conveyor', nets.conveyor],
          ['Управління запасами (завдання 2)', 'task2-stock', nets.stock],
          ['Обробка запитів на двох серверах (завдання 3)', 'task3-web', nets.web],
        ] as const
      ).map(([label, folder, net]) => [
        label,
        `package/${folder}`,
        String(net.places.length),
        String(net.transitions.length),
        'task.txt, net.png, net.pns, net.pnml, method.txt',
      ]),
      { weights: [1.9, 1.4, 0.8, 1, 1.9] },
    ),
    p(
      'Після запису кожен файл .pnml читається назад класом PnmlParser, і відновлена мережа порівнюється з початковою: ' +
        'назви і маркірування позицій, затримки, закони розподілу, пріоритети та ймовірності переходів, кратності й ' +
        'ознаки інформаційних дуг. Розбіжностей немає для всіх трьох мереж. Нижче — метод мережі завдання 3 і початок ' +
        'опису переходу у файлі PNML.',
    ),
    ...code(webMethod),
    ...code(pnml.slice(firstTransition, firstTransition + 14).map((l) => l.replace(/^ {4}/, ''))),
  );

  // ───────────────────────────── Завдання 5
  const net = nets.web;
  const eq = web.equations;
  const P = (i: number): string => `P_{${i}}`;
  const T = (i: number): string => `T_{${i}}`;
  const pi = (name: string): number => {
    const i = net.places.findIndex((x) => x.name === name);
    if (i < 0) throw new Error(`немає позиції ${name}`);
    return i;
  };
  const ti = (name: string): number => {
    const i = net.transitions.findIndex((x) => x.name === name);
    if (i < 0) throw new Error(`немає переходу ${name}`);
    return i;
  };
  const k = (n: number): string => (n > 1 ? `${n}·` : '');
  const small = (s: string): TextRun[] => fx(s, SMALL_SIZE + 2);
  const consuming = (t: NetTransition): readonly NetArc[] => t.in.filter((a) => !a.info);

  const placeRows = net.places.map((place, i) => {
    const producers = net.transitions.flatMap((t, j) => t.out.filter((a) => a.place === i).map((a) => `${k(a.k)}Y_{${j}}·s_{${j}}`));
    const consumers = net.transitions.flatMap((t, j) => consuming(t).filter((a) => a.place === i).map((a) => `${k(a.k)}u_{${j}}`));
    return [
      small(`${P(i)}`),
      place.name,
      small(`M^{+}_{${i}} = M′_{${i}}${producers.length ? ` + ${producers.join(' + ')}` : ''}`),
      small(`M_{${i}} = M^{+}_{${i}}${consumers.length ? ` − ${consumers.join(' − ')}` : ''}`),
    ];
  });
  const transitionRows = net.transitions.map((t, j) => [
    small(T(j)),
    t.name,
    small(t.in.map((a) => `M^{+}_{${a.place}} ≥ ${a.k}`).join(' ∧ ')),
    `${t.priority}; ${num(t.probability, 1)}`,
    delayText(t),
  ]);

  const [arrive, reject, toMain, toAux] = [ti('Надходження'), ti('Відмова'), ti('ДоГоловного'), ti('ДоДопоміжного')];
  const [request, slots, db] = [pi('Запит'), pi('Місця'), pi('БД')];
  const [write1, write2] = [ti('Запис1'), ti('Запис2')];
  const [computed1, computed2] = [pi('Обчислено1'), pi('Обчислено2')];
  const pairMin = (name: string): string => {
    const t = net.transitions[ti(name)];
    if (!t) throw new Error(`немає переходу ${name}`);
    const args = consuming(t).map((a) => `M^{+}_{${a.place}}`);
    return `u_{${ti(name)}} = ${args.length > 1 ? `min{${args.join(', ')}}` : args[0]}`;
  };

  const dot = (row: readonly number[] | undefined, v: readonly number[]): number => (row ?? []).reduce((sum, x, j) => sum + x * (v[j] ?? 0), 0);
  const matrixRows = net.places.map((place, i) => [
    `P${i}`,
    ...net.transitions.map((_, j) => {
      const plus = eq.plus[i]?.[j] ?? 0;
      const minus = eq.minus[i]?.[j] ?? 0;
      if (plus && minus) return `+${plus} −${minus}`;
      if (plus) return `+${plus}`;
      if (minus) return `−${minus}`;
      return '';
    }),
  ]);
  const balanceRows = net.places.map((place, i) => {
    const waiting = dot(eq.plus[i], eq.active);
    const change = dot(eq.plus[i], eq.entries) - dot(eq.minus[i], eq.entries);
    const mu0 = eq.initialMark[i] ?? 0;
    const mu = (eq.mark[i] ?? 0) + waiting;
    return [`P${i}`, place.name, String(mu0), String(eq.mark[i] ?? 0), String(waiting), String(mu), String(change).replace('-', '−'), String(mu0 + change)];
  });
  const flowRows = net.transitions.map((t, j) => [
    `T${j}`,
    t.name,
    String(eq.entries[j] ?? 0),
    String(eq.exits[j] ?? 0),
    String(eq.active[j] ?? 0),
    String((eq.entries[j] ?? 0) - (eq.active[j] ?? 0)),
  ]);
  const time = (x: number): string => (x > 1e300 ? '∞' : num(x, 2));
  const protocolRows = eq.protocol.map((step, n) => [
    String(n),
    time(step.t),
    Object.entries(step.marks)
      .filter(([name, m]) => m !== net.places[pi(name)]?.mark)
      .map(([name, m]) => `M(${name}) = ${m}`)
      .join('; ') || 'без змін',
    Object.entries(step.exits)
      .map(([name, ts]) => `E(${name}) = {${ts.map(time).join('; ')}}`)
      .join('; '),
  ]);

  add(
    task(5, 'Побудувати математичні рівняння, що описують побудовану за текстом завдання 3 мережу Петрі. 20 балів.'),
    heading('Формальний опис мережі'),
    p(
      'Рівняння побудовано за теорією стохастичної мережі Петрі з часовими затримками, конфліктними та багатоканальними ' +
        'переходами (лекція «Рівняння стохастичної мережі Петрі»). Мережа завдання 3 — це',
    ),
    formula('N = (P, T, A, W, K, I, R)'),
    p(
      `де P — множина з ${net.places.length} позицій, T — множина з ${net.transitions.length} переходів (нумерація — як у ` +
        'списках d_P і d_T збереженого методу), A — множина дуг, W — кратності дуг (усі дорівнюють 1), K — пари ' +
        '«пріоритет c, ймовірність запуску b», I — множина інформаційних дуг (порожня), R — часові затримки переходів. ' +
        'Склад множин A, K і R наведено в таблицях: позиція з’єднана дугою з переходом, якщо входить в умову його запуску, ' +
        'а перехід з позицією — якщо входить у рівняння її маркірування з додатним знаком.',
    ),
    heading('Стан мережі та момент найближчої події'),
    p('Стан мережі в момент t — маркірування позицій і множини запланованих моментів виходу маркерів з каналів переходів:'),
    formula(`S(t) = (M(t), E(t)),   M(t) = {M_{i}(t), i = 0…${net.places.length - 1}},   E(t) = {E_{j}(t), j = 0…${net.transitions.length - 1}}`),
    p('Початковий стан: у переходах немає маркерів, маркірування — початкове:'),
    formula(
      `E_{j}(t_{0}) = {∞},   ` +
        net.places
          .map((x, i) => (x.mark > 0 ? `M_{${i}}(t_{0}) = ${x.mark}` : ''))
          .filter(Boolean)
          .join(', ') +
        ', решта M_{i}(t_{0}) = 0',
    ),
    p('Момент найближчої події — найменший із запланованих моментів виходу маркерів:'),
    formula('τ_{j}(t) = min_{q} [E_{j}(t)]_{q},     t_{n} = min_{j} τ_{j}(t_{n−1}),   t_{n} ≥ t_{n−1}'),
    p('Стан змінюється двома перетвореннями: виходом маркерів з переходів D⁺ і багатократним входом маркерів у переходи (D⁻)ᵐ:'),
    formula('S(t_{1}) = (D^{−})^{m}(S(t_{0})),     S(t_{n}) = (D^{−})^{m}(D^{+}(S(t_{n−1}))),   n = 2, 3, …'),
    heading('Рівняння виходу і входу маркерів'),
    p(
      'Предикат Y_{j} = Y(T_{j}, t_{n}) дорівнює 1, якщо τ_{j}(t_{n−1}) = t_{n}, інакше 0; s_{j} — кількість каналів переходу ' +
        'T_{j}, момент виходу яких дорівнює t_{n}; u_{j} = u_{j}(t_{n}) — кількість входів маркерів у перехід T_{j} у момент ' +
        't_{n}. У таблиці M′_{i} = M_{i}(t_{n−1}) — маркірування до події, M^{+}_{i} = M^{+}_{i}(t_{n}) — після виходу маркерів, ' +
        'M_{i} = M_{i}(t_{n}) — після входу маркерів.',
    ),
    tableCaption('Рівняння маркірування позицій мережі завдання 3'),
    ...table(['Позиція', 'Назва', 'Вихід маркерів з переходів, D⁺', 'Вхід маркерів у переходи, (D⁻)ᵐ'], placeRows, {
      weights: [0.6, 1.1, 2.6, 1.9],
      size: SMALL_SIZE + 2,
    }),
    p('Умова запуску переходу — предикат Z(T_{j}, t_{n}), що дорівнює 1, якщо в кожній вхідній позиції достатньо маркерів:'),
    tableCaption('Умови запуску, параметри розв’язання конфліктів і затримки переходів'),
    ...table(['Перехід', 'Назва', 'Z(T, tₙ) = 1, якщо', 'c; b', 'Затримка R'], transitionRows, { weights: [0.6, 1.3, 2.4, 0.7, 0.9], size: SMALL_SIZE + 2 }),
    p(
      'Кількість входів маркерів u_{j} визначається маркіруванням M^{+} і правилами розв’язання конфліктів. Переходи, що не ' +
        'мають спільних вхідних позицій з іншими, входять стільки разів, скільки дозволяє маркірування:',
    ),
    formula(
      `u_{${arrive}} = M^{+}_{${pi(GENERATOR)}},   ${['Прийняти1', 'Обчислення1', 'Відповідь1', 'Прийняти2', 'Обчислення2', 'Відповідь2'].map(pairMin).join(',   ')}`,
    ),
    p(
      `Позиції ${`P${request}`} («Запит») і ${`P${slots}`} («Місця») — конфліктні для переходів T${toMain}, T${toAux} і T${reject}. ` +
        `Вищий пріоритет мають переходи маршрутизації: разом вони приймають стільки запитів, скільки є вільних місць, кожен ` +
        `запит незалежно потрапляє в T${toMain} з ймовірністю ${num(1 - prm.auxShare, 1)} і в T${toAux} з ймовірністю ` +
        `${num(prm.auxShare, 1)}; запити, яким не вистачило місця, забирає перехід відмови:`,
    ),
    formula(
      `u_{${toMain}} + u_{${toAux}} = min{M^{+}_{${request}}, M^{+}_{${slots}}},   u_{${toMain}} ~ Bin(u_{${toMain}} + u_{${toAux}}, ${num(1 - prm.auxShare, 1)}),   ` +
        `u_{${reject}} = M^{+}_{${request}} − u_{${toMain}} − u_{${toAux}}`,
    ),
    p(
      `Позиція P${db} («БД») — конфліктна для переходів T${write1} і T${write2} з однаковими пріоритетом та ймовірністю: ` +
        'з’єднання розподіляються між ними рівноймовірно, доки є і з’єднання, і обчислені запити:',
    ),
    formula(
      `u_{${write1}} ≤ M^{+}_{${computed1}},   u_{${write2}} ≤ M^{+}_{${computed2}},   ` +
        `u_{${write1}} + u_{${write2}} = min{M^{+}_{${computed1}} + M^{+}_{${computed2}}, M^{+}_{${db}}}`,
    ),
    p(
      'Після m входів жоден перехід не може запуститися: Z(T_{j}, t_{n}) = 0 для всіх j. Стан переходів змінюється так: при ' +
        'виході з множини E_{j} вилучаються моменти, що дорівнюють t_{n}; при вході до неї додається u_{j} нових моментів, ' +
        'кожен зі своїм значенням затримки R_{j} (u = u_{j}):',
    ),
    formula('E^{+}_{j}(t_{n}) = E_{j}(t_{n−1}) \\ {[E_{j}(t_{n−1})]_{q} = t_{n}},     E_{j}(t_{n}) = E^{+}_{j}(t_{n}) ∪ {t_{n} + R_{j}}_{1} ∪ … ∪ {t_{n} + R_{j}}_{u}'),
    p('Якщо множина E_{j} стає порожньою, E_{j} = {∞}. Перші кроки одного прогону моделі (стан після входу маркерів у переходи):'),
    tableCaption('Приклад змінювання стану мережі в перші моменти подій'),
    ...table(['n', 'tₙ, мс', 'Маркірування, що відрізняється від початкового', 'Стан переходів'], protocolRows, {
      weights: [0.3, 0.7, 2.6, 2.6],
      size: SMALL_SIZE + 2,
    }),
    heading('Матричні рівняння станів'),
    p(
      'Матриця входів a⁻ містить кратності дуг з позицій у переходи, матриця виходів a⁺ — з переходів у позиції, a = a⁺ − a⁻. ' +
        'У таблиці «+1» — елемент a⁺, «−1» — елемент a⁻; порожня клітинка — нуль. Стовпці — переходи T0…T' +
        `${net.transitions.length - 1}.`,
    ),
    tableCaption('Матриці виходів a⁺ і входів a⁻ мережі завдання 3'),
    ...table(['', ...net.transitions.map((_, j) => `T${j}`)], matrixRows, { weights: [1.1, ...net.transitions.map(() => 1)], size: SMALL_SIZE }),
    p(
      'Нехай v(t) — вектор кількості активних каналів переходів, γ(t) — вектор кількості входів маркерів у переходи за ' +
        'час [t₀; t], η(t) — вектор кількості виходів, μ(t) = M(t) + a⁺·v(t) — розширене маркірування, що враховує ' +
        'маркери, які очікують виходу з переходів. Матричні рівняння станів:',
    ),
    formula('μ(t_{n}) = μ(t_{0}) + a·γ(t_{n}),     η(t_{n}) = γ(t_{n}) − v(t_{n}) + v(t_{0})'),
    p(
      `Рівняння перевірено на моделі: для прогону тривалістю ${int(eq.time)} мс у таблицях наведено обидві частини кожного ` +
        `рівняння. Розбіжностей — ${eq.mismatches}; так само рівняння виконуються на кінець кожного прогону всіх дослідів.`,
    ),
    tableCaption(`Перевірка рівняння μ(tₙ) = μ(t₀) + a·γ(tₙ), tₙ = ${int(eq.time)} мс`),
    ...table(['Позиція', 'Назва', 'M(t₀) = μ(t₀)', 'M(tₙ)', 'a⁺·v(tₙ)', 'μ(tₙ)', 'a·γ(tₙ)', 'μ(t₀) + a·γ(tₙ)'], balanceRows, {
      weights: [0.7, 1.3, 1, 0.8, 0.8, 0.8, 0.8, 1.1],
      size: SMALL_SIZE + 2,
    }),
    tableCaption('Перевірка рівняння η(tₙ) = γ(tₙ) − v(tₙ)'),
    ...table(['Перехід', 'Назва', 'Входів γ', 'Виходів η', 'Активних каналів v', 'γ − v'], flowRows, { weights: [0.7, 1.6, 1, 1, 1.2, 1], size: SMALL_SIZE + 2 }),
    heading('Інваріанти'),
    p(
      'З матриці a випливають S-інваріанти — вектори w з aᵀ·w = 0, для яких зважена сума розширеного маркірування ' +
        'wᵀ·μ(t) стала. Вони виражають збереження ресурсів мережі і є тими інваріантами, що перевірялись під час ' +
        'верифікації моделі:',
    ),
    bullet(`потоки сервера i: μ(Потоки i) + μ(Готовий i) + μ(Обчислено i) + μ(Збережено i) = ${prm.threads[0]} для головного і ${prm.threads[1]} для допоміжного;`),
    bullet(`ядра сервера i: μ(Ядра i) = ${prm.cores[0]} і ${prm.cores[1]};`),
    bullet(`з’єднання з базою даних: μ(БД) = ${prm.connections};`),
    bullet(`місця в черзі: μ(Місця) + μ(Черга1) + μ(Черга2) = ${prm.queueLimit};`),
    bullet('генератор: μ(Генератор) = 1.'),
    p(
      'Тут μ(P) включає маркери, що перебувають у переходах і повернуться в позицію P. Обмеженість цих сум означає, що ' +
        'позиції ресурсів і черг обмежені; необмеженими лишаються тільки позиції-лічильники «Виконано» і «Відхилено».',
    ),
  );

  // ───────────────────────────── Висновки
  add(
    heading('Висновки', true),
    p(
      'Опановано бібліотеку PetriObjModelPaint: мережі Петрі створено з елементів PetriP, PetriT, ArcIn, ArcOut, імітацію ' +
        'виконано алгоритмом класу PetriSim (вхід маркерів у переходи з розв’язанням конфліктів за пріоритетом та ' +
        'ймовірністю, просування часу до найближчої події, вихід маркерів). Для трьох мереж сформовано пакети файлів: ' +
        'текст завдання, рисунок мережі, PNML і Java-метод.',
    ),
    p(
      `Моделі завдань 1 і 4 практикуму 5 на PetriSim дали ті самі результати, що й власний алгоритм: час перебування деталі ` +
        `на конвеєрі ${num(at(c1, 'sojourn').mean, 2)} хв, середній запас холодильників ${num(at(s, 'stock').mean, 1)}, продаж ` +
        `не відбувається раз на ${num(at(s, 'betweenLost').mean, 2)} тижня. Збіг двох незалежних реалізацій підтверджує і ` +
        'моделі, і алгоритм практикуму 5.',
    ),
    p(
      `Модель багатопотокової обробки запитів на двох серверах зі спільною базою даних дає середній час обробки запиту ` +
        `${num(at(w, 'time').mean, 1)} мс за ${num(perSecond(prm.arrival), 0)} запитів/с. Модель без обмеження потоків збігається ` +
        `з аналітичним розв’язком (системи M/M/c). Найбільша пропускна здатність — ` +
        `${num(at(lastOver.result, 'throughput').mean * 1000, 0)} запитів/с; її обмежує пул потоків допоміжного сервера. За ` +
        'перевантаження обмеження черги у 1000 запитів утримує час обробки близько ' +
        `${num(at(lastOver.result, 'time').mean / 1000, 1)} с, відхиляючи зайві запити.`,
    ),
    p(
      'Для мережі завдання 3 побудовано рівняння станів стохастичної мережі Петрі: рівняння маркірування для виходу і ' +
        'входу маркерів, умови запуску та правила розв’язання конфліктів, матричні рівняння з матрицями входів і виходів. ' +
        'Матричні рівняння та S-інваріанти перевірено на кожному прогоні моделі — порушень немає, що є ще одним ' +
        'підтвердженням правильності алгоритму PetriSim і побудованих мереж.',
    ),
  );

  const list = (reference: string, format: (typeof LevelFormat)[keyof typeof LevelFormat], txt: string) => ({
    reference,
    levels: [{ level: 0, format, text: txt, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1069, hanging: 360 } } } }],
  });
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    numbering: { config: [list('bullets', LevelFormat.BULLET, '–')] },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1701, right: 851 } } },
        children: [...titlePage(), ...body],
      },
    ],
  });
  return Packer.toBuffer(doc);
};
