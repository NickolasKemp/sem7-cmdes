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
import { dev, int, label, num, pct, pm } from './format.ts';
import type { ProcessStats } from './process.ts';
import { BANK, HOSPITAL, JACKSON, RESERVE, type Task1Result, type Task2Result, type Task3Result } from './tasks.ts';

export interface ReportInput {
  readonly t1: Task1Result;
  readonly t2: Task2Result;
  readonly t3: Task3Result;
}

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
    c('Комп’ютерний практикум № 3', 840),
    c('з дисципліни «Комп’ютерне моделювання дискретно-подійних систем»', 600),
    c('Тема: «Побудова імітаційної моделі системи з використанням формалізму моделі масового обслуговування»'),
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

const queueCap = (q: number): string => (Number.isFinite(q) ? String(q) : '∞');
const channelsCap = (c: number): string => (Number.isFinite(c) ? String(c) : '∞');

/** Будує .docx; `png(name)` повертає шлях до растрової версії рисунка `name.svg`. */
export const buildDocx = async ({ t1, t2, t3 }: ReportInput, png: (name: string) => string): Promise<Buffer> => {
  tableNo = 0;
  figureNo = 0;
  const body: Block[] = [];
  const add = (...b: Block[]): void => void body.push(...b);

  // ───────────────────────────── Завдання 1
  const j = t1.jackson;
  const [priority, probability] = t1.reserve;
  add(
    heading('Хід роботи', true),
    task(
      1,
      'Реалізувати універсальний алгоритм імітації моделі масового обслуговування з багатоканальним обслуговуванням, ' +
        'з вибором маршруту за пріоритетом або за заданою ймовірністю. 30 балів.',
    ),
    p(
      'Роботу виконано мовою TypeScript (середовище Bun) без сторонніх бібліотек. За основу взято об’єктно-орієнтовану модель ' +
        'з комп’ютерного практикуму № 2: елементи Create, Process і Dispose — нащадки класу Element, клас Model просуває час ' +
        'за принципом найближчої події. Для універсального алгоритму модель розширено: вимога має тип, від якого можуть залежати ' +
        'час обслуговування, пріоритет вибору з черги та маршрут; маршрут складається з дуг з імовірностями, пріоритетами й умовами; ' +
        'СМО має довільну кількість пристроїв, зокрема необмежену (чиста затримка). Генератор випадкових чисел має початкове ' +
        'значення (seed), тому всі результати відтворювані.',
    ),
    tableCaption('Класи та модулі програми'),
    ...table(
      ['Клас / модуль', 'Призначення'],
      [
        ['Element', 'базовий елемент: tnext, tcurr, quantity, маршрут next; inAct, outAct, doStatistics, canAccept'],
        ['Job', 'вимога: момент надходження, початковий і поточний тип'],
        ['Arc, route, to', 'маршрут: дуги з імовірністю p, пріоритетом (сталим або залежним від стану), умовою when, зміною типу'],
        ['Create', 'надходження вимог із заданим інтервалом і законом розподілу типу вимоги'],
        ['Process', 'СМО: c пристроїв (c = ∞ — затримка), обмежена черга, FIFO або пріоритет у черзі, час обслуговування за типом'],
        ['Dispose', 'вихід з мережі: час перебування за типами, інтервали між виходами'],
        ['Model', 'алгоритм імітації за принципом найближчої події'],
        ['random.ts, stats.ts', 'закони розподілу (exp, unif, norm, Ерланга, дискретний); накопичувачі статистики, довірчі інтервали'],
        ['theory.ts', 'формули M/M/c/K і рівняння балансу потоків — еталон для перевірки'],
      ],
      [1, 3],
    ),
    heading('Вибір маршруту'),
    p(
      'Кожна дуга маршруту має необов’язкові параметри: імовірність p, пріоритет (більше значення — вищий пріоритет), умову when ' +
        '(для яких вимог дуга відкрита) та новий тип вимоги. Вимога, що завершила обслуговування, вибирає дугу так:',
    ),
    numbered('route', 'відкидаються дуги, умова when яких для цієї вимоги не виконується;'),
    numbered(
      'route',
      'з решти береться група дуг з найвищим пріоритетом, у якій хоча б одна дуга веде в елемент, здатний прийняти вимогу ' +
        '(є вільний пристрій або місце в черзі); якщо такої групи немає — група з найвищим пріоритетом, і вимога отримує відмову;',
    ),
    numbered('route', 'у групі дуга вибирається за ймовірностями, нормованими в межах групи; якщо ймовірності не задано — перша за порядком.'),
    p(
      'Маршрут лише з імовірностями — розгалуження за заданою ймовірністю, з різними пріоритетами — розгалуження за пріоритетом, ' +
        'а дуги з однаковим пріоритетом і заданими ймовірностями дають комбінований вибір, описаний у лекції. Пріоритет може бути ' +
        'функцією стану мережі — так у завданні 2 клієнт обирає коротшу смугу.',
    ),
    ...code([
      'pick: (job, rng) => {',
      '  const open = arcs.map((arc, i) => ({ arc, i, priority: priorityOf(arc) }))',
      '    .filter(({ arc }) => arc.when?.(job) ?? true);',
      '  const levels = [...new Set(open.map((o) => o.priority))].sort((a, b) => b - a);',
      '  const level = levels.find((l) =>',
      '    open.some((o) => o.priority === l && o.arc.to.canAccept(job))) ?? levels[0];',
      '  const group = open.filter((o) => o.priority === level);',
      '  const chosen = group[0]?.arc.p === undefined ? group[0] : weighted(group, rng);',
      '  counts[chosen.i]++;',
      '  return chosen.arc;',
      '}',
    ]),
    heading('Багатоканальне обслуговування'),
    p(
      'Клас Process зберігає масив зайнятих пристроїв (вимога і момент завершення обслуговування) та спільну чергу. Момент ' +
        'найближчої події СМО — найменший момент завершення серед пристроїв. У outAct() звільняються всі пристрої, що завершили ' +
        'обслуговування в поточний момент, вільні пристрої забирають вимоги з черги, а обслуговані вимоги передаються за маршрутом. ' +
        'Якщо задано пріоритет у черзі, береться перша з вимог з найбільшим пріоритетом, інакше — перша в черзі (FIFO).',
    ),
    ...code([
      'override inAct(job: Job): void {',
      '  this.arrivals++;',
      '  if (this.#busy.length < this.channels) this.#start(job);',
      '  else if (this.#queue.length < this.maxQueue) this.enqueue(job);',
      '  else this.failures++;',
      '}',
      '',
      'override outAct(): void {',
      '  const done = this.#busy.filter((c) => c.tnext <= this.tcurr);',
      '  this.#busy = this.#busy.filter((c) => c.tnext > this.tcurr);',
      '  while (this.#busy.length < this.channels) {',
      '    const w = this.#take();          // FIFO або за пріоритетом типу',
      '    if (!w) break;',
      '    this.#start(w.job);',
      '  }',
      '  for (const c of done) this.send(c.job);',
      '}',
    ]),
    heading('Перевірка: мережа з розгалуженням за ймовірністю'),
    p(
      'Точність алгоритму оцінено порівнянням з аналітичним розрахунком за умов, наведених у лекції 5: черги необмежені, ' +
        'усі затримки експоненційні, маршрут вибирається лише за ймовірностями. Тоді мережа є мережею Джексона: інтенсивності ' +
        'потоків знаходяться з рівнянь балансу λⱼ = γⱼ + Σ λᵢ·pᵢⱼ, а кожна СМО поводиться як M/M/c з власним λ. Перевірено мережу ' +
        `з багатоканальними СМО та поверненням (рисунок ${figureNo + 1}).`,
    ),
    ...(await figure(png('task1-jackson'), 'Мережа масового обслуговування для перевірки алгоритму', 480)),
    p(
      `Розв’язок рівнянь балансу: ${j.lambdas.map((l, i) => `λ${i + 1} = ${num(l, 4)}`).join(', ')}; час моделювання ` +
        `T = ${int(JACKSON.time)}, створено ${int(j.created)} вимог.`,
    ),
    tableCaption('Мережа Джексона: імітація проти аналітичного розрахунку'),
    ...table(
      ['СМО', 'c', 'L імітація', 'L теорія', 'Відхилення L', 'ρ імітація', 'ρ теорія', 'Wq імітація', 'Wq теорія'],
      j.nodes.map((s, i) => {
        const t = j.theory[i];
        return t
          ? [s.name, String(s.channels), num(s.meanQueue), num(t.meanQueue), dev(s.meanQueue, t.meanQueue), num(s.utilization), num(t.utilization), num(s.meanWait), num(t.meanWait)]
          : [s.name, '', '', '', '', '', '', '', ''];
      }),
      [0.9, 0.4, 1, 1, 1.1, 1, 1, 1, 1],
    ),
    p('Позначення: L — середня довжина черги, ρ — завантаження пристрою, Wq — середній час очікування в черзі.'),
    tableCaption('Задані ймовірності та фактичні частоти переходів'),
    ...table(
      ['Звідки', 'Куди', 'Задана ймовірність', 'Фактична частота'],
      j.transitions.map((tr) => [tr.from, tr.to, num(tr.p, 2), num(tr.observed, 4)]),
    ),
    p(
      `Середній час перебування вимоги в мережі: імітація ${num(j.meanTimeInSystem)}, теорія (формула Літтла W = ΣLᵢ / γ) ` +
        `${num(j.theoryTimeInSystem)}, відхилення ${dev(j.meanTimeInSystem, j.theoryTimeInSystem)}. Частоти переходів збігаються ` +
        'із заданими ймовірностями, характеристики СМО — з аналітичними значеннями в межах статистичної похибки.',
    ),
    heading('Перевірка: розгалуження за пріоритетом'),
    p(
      'Розгалуження за пріоритетом перевірено на прикладі з лекції 4 — основний і резервний пристрої ' +
        `(рисунок ${figureNo + 1}). Вимога йде ` +
        'до основного пристрою (пріоритет 2), а до резервного (пріоритет 1) — лише коли в основному немає місця; якщо зайняті обидва, ' +
        `вимога отримує відмову. Параметри: надходження exp(${RESERVE.createMean}), обслуговування ${label(`exp(${RESERVE.serviceMean})`)}, ` +
        `черга кожного пристрою ≤ ${RESERVE.maxQueue}, T = ${int(RESERVE.time)}. Для порівняння та сама модель запущена з розгалуженням ` +
        'за ймовірністю 0,5 / 0,5.',
    ),
    ...(await figure(png('task1-reserve'), 'Основний і резервний пристрої з розгалуженням за пріоритетом', 420)),
    p(
      'Для розгалуження за пріоритетом основний пристрій отримує кожну вимогу, поки має місце, тому він є СМО M/M/1/K з повним ' +
        'вхідним потоком, і частка вимог, що застали його заповненим, дорівнює ймовірності відмови цієї СМО. Ці вимоги йдуть у резерв, ' +
        'а якщо заповнений і резерв — отримують відмову, тому частка в резерв менша за неї. Для розгалуження за ймовірністю кожен ' +
        'пристрій — M/M/1/K з половиною потоку. Обидва факти дають точну перевірку.',
    ),
    tableCaption('Розгалуження за пріоритетом і за ймовірністю'),
    ...table(
      ['Маршрут', 'Частка в резервний', 'Застали основний заповненим (теорія)', 'ρ основного (теорія)', 'ρ резервного', 'Імовірність відмови'],
      t1.reserve.map((v) => [
        v.label,
        num(v.share[1] ?? 0, 4),
        `${num(v.mainFullShare, 4)} (${num(v.theory.failureProbability, 4)})`,
        `${num(v.devices[0]?.utilization ?? 0)} (${num(v.theory.utilization)})`,
        num(v.devices[1]?.utilization ?? 0),
        `${num(v.failureProbability, 4)}${v === probability ? ` (${num(v.theory.failureProbability, 4)})` : ''}`,
      ]),
      [2, 1, 1.5, 1.3, 1.1, 1.2],
    ),
    p(
      `За пріоритетом основний пристрій завантажений на ${pct(priority?.devices[0]?.utilization ?? 0, 1)}, а резервний — лише ` +
        `на ${pct(priority?.devices[1]?.utilization ?? 0, 1)}; імовірність відмови ${num(priority?.failureProbability ?? 0, 4)} майже ` +
        `удвічі менша, ніж за випадкового вибору (${num(probability?.failureProbability ?? 0, 4)}): резерв приймає вимоги саме тоді, ` +
        'коли основний пристрій заповнений. Значення в дужках — аналітичні; вони збігаються з імітацією.',
    ),
  );

  // ───────────────────────────── Завдання 2
  const e2 = t2.estimates;
  const first = t2.first;
  const lambdaEff = (1 - e2.lostShare.mean) / BANK.arrivalMean;
  add(
    task(
      2,
      'Для задачі про банк для автомобілістів скласти формалізовану модель масового обслуговування та реалізувати її ' +
        'з використанням побудованого універсального алгоритму. 30 балів.',
    ),
    p(
      'У банку два віконця з окремими під’їзними смугами, кожне обслуговує один касир. Інтервали між прибуттями клієнтів у годину ' +
        `пік — exp(${label(String(BANK.arrivalMean))}), тривалість обслуговування — exp(${label(String(BANK.serviceMean))}). ` +
        'За рівної довжини черг або їх відсутності клієнт обирає першу смугу, інакше — коротшу. Клієнт, що стоїть останнім, ' +
        `переїжджає в іншу чергу, якщо вона коротша щонайменше на ${BANK.jockeyGap} автомобілі. На кожній смузі в черзі не більше ` +
        `${BANK.maxQueue} автомобілів, у банку — не більше 8 разом з двома, що обслуговуються; клієнт, який застав усі місця ` +
        'зайнятими, втрачається. Початковий стан: обидва касири зайняті, обслуговування початкових клієнтів — ' +
        `${label(BANK.initial.service.label)}; у кожній черзі по ${BANK.initial.queue} автомобілі; перший клієнт прибуває в момент ` +
        `${label(String(BANK.initial.firstArrival))}.`,
    ),
    heading('Формалізація'),
    p(
      'Об’єкт обслуговування — клієнт на автомобілі. Кожне віконце з під’їзною смугою — одноканальна СМО з чергою max = 3. ' +
        'Надходження клієнтів розгалужується на дві СМО за пріоритетом, що залежить від стану мережі: пріоритет дуги i дорівнює ' +
        '−Nᵢ, де Nᵢ — кількість автомобілів на смузі (в черзі й біля вікна). Коротша смуга має вищий пріоритет, за рівних пріоритетів ' +
        'обирається перша дуга, тобто перша смуга. Коли обидві черги заповнені, жодна дуга не може прийняти клієнта — відмова. ' +
        'Перешикування між чергами — розширення формалізму: після кожної події, якщо |L₁ − L₂| ≥ 2, останній автомобіль довшої ' +
        'черги переходить у кінець коротшої зі збереженням моменту прибуття.',
    ),
    p(
      'Порівнювати Nᵢ, а не лише довжини черг, необхідно: інакше клієнт, що застав вільного другого касира і порожню чергу першого, ' +
        'став би в чергу до зайнятого першого касира. Для перешикування умова сформульована через довжини черг, як у тексті задачі.',
    ),
    ...(await figure(png('task2-bank'), 'Формалізована модель банку для автомобілістів')),
    tableCaption('Вихідні характеристики та спосіб їх обчислення'),
    ...table(
      ['Величина', 'Спосіб обчислення'],
      [
        ['Середнє завантаження касира i', 'Uᵢ = (1/T)·∫ bᵢ(t) dt, bᵢ — стан пристрою Dᵢ'],
        ['Середнє число клієнтів у банку', '(1/T)·∫ (L₁ + L₂ + b₁ + b₂) dt'],
        ['Середній інтервал між від’їздами', 'середнє інтервалів між послідовними виходами з DISPOSE'],
        ['Середній час перебування клієнта', 'середнє (t виходу − t прибуття) для клієнтів, що прибули після 0'],
        ['Середнє число клієнтів у черзі i', '(1/T)·∫ Lᵢ(t) dt'],
        ['Відсоток відмов', 'відмови / кількість прибулих клієнтів · 100 %'],
        ['Число змін смуги', 'кількість переходів автомобілів між чергами'],
      ],
      [1.3, 2],
    ),
    p('Побудова моделі з елементів універсального алгоритму:'),
    ...code([
      "const create = new Create('CREATE', exponential(0.5), rng, { firstAt: 0.1 });",
      "const lane1 = new Process('касир 1', exponential(0.3), rng, { maxQueue: 3 });",
      "const lane2 = new Process('касир 2', exponential(0.3), rng, { maxQueue: 3 });",
      'create.next = route(',
      '  { to: lane1, priority: () => -lane1.load },',
      '  { to: lane2, priority: () => -lane2.load },',
      ');',
      'lane1.next = to(dispose);',
      'lane2.next = to(dispose);',
      'for (const lane of [lane1, lane2]) {',
      '  lane.startWith(initialClient(), normal(1, 0.3).sample(rng));',
      '  lane.enqueue(initialClient());',
      '  lane.enqueue(initialClient());',
      '}',
      'new Model([create, lane1, lane2, dispose]).simulate(1000, jockey);',
    ]),
    tableCaption('Трасування перших кроків імітації'),
    ...table(
      ['Крок', 't', 'Подія', 'Касири зайняті', 'Черги', 'Змін смуги'],
      t2.trace.map((r, i) => [String(i), num(r.t), r.event, r.busy.join(' / '), r.queues.join(' / '), String(r.changes)]),
      [0.5, 0.7, 2.6, 0.9, 0.7, 0.8],
    ),
    ...(await figure(png('task2-queues'), 'Довжини черг на початку імітації')),
    p(
      'Трасування показує роботу всіх правил: перший клієнт за рівних черг став у першу смугу, а коли черга першої смуги ' +
        'спорожніла раніше, останній автомобіль другої смуги переїхав у першу.',
    ),
    heading('Результати'),
    p(
      `Імітацію виконано ${BANK.replications} незалежними прогонами тривалістю T = ${int(BANK.time)} од. часу з різними початковими ` +
        'значеннями генератора. Наведено середнє за прогонами та половину 95 % довірчого інтервалу (за розподілом Стьюдента).',
    ),
    tableCaption(`Шукані величини (${BANK.replications} прогонів по T = ${int(BANK.time)})`),
    ...table(
      ['№', 'Величина', 'Значення'],
      [
        ['1', 'Середнє завантаження касира 1 / касира 2', `${pm(e2.u1)} / ${pm(e2.u2)}`],
        ['2', 'Середнє число клієнтів у банку', pm(e2.inBank)],
        ['3', 'Середній інтервал між від’їздами (вікно 1 / вікно 2)', `${pm(e2.departureInterval)} (${num(e2.d1.mean)} / ${num(e2.d2.mean)})`],
        ['4', 'Середній час перебування клієнта в банку', pm(e2.timeInBank)],
        ['5', 'Середнє число клієнтів у черзі 1 / черзі 2', `${pm(e2.q1, 4)} / ${pm(e2.q2, 4)}`],
        ['6', 'Відсоток клієнтів, яким відмовлено', `${pm(e2.lostShare, 3, 100)} %`],
        ['7', `Число змін під’їзних смуг за T = ${int(BANK.time)}`, pm(e2.changes, 1)],
      ],
      [0.4, 3, 2.2],
    ),
    p(
      `Касир першого вікна завантажений приблизно вдвічі більше (${num(e2.u1.mean)} проти ${num(e2.u2.mean)}): за рівних черг ` +
        'клієнти обирають першу смугу, а при низькому навантаженні рівність трапляється найчастіше. Сумарне завантаження ' +
        `${num(e2.u1.mean + e2.u2.mean)} близьке до ρ = λ·t_обсл = ${num(BANK.serviceMean / BANK.arrivalMean, 1)}: втрат майже немає. ` +
        `Середній інтервал між від’їздами ${num(e2.departureInterval.mean)} збігається із середнім інтервалом прибуття ${num(BANK.arrivalMean, 1)} — ` +
        'у стаціонарному режимі потік на виході дорівнює потоку на вході.',
    ),
    heading('Верифікація'),
    bullet(
      `формула Літтла: λ_еф·W = ${num(lambdaEff, 3)} · ${num(e2.timeInBank.mean)} = ${num(lambdaEff * e2.timeInBank.mean)} проти ` +
        `середнього числа клієнтів у банку ${num(e2.inBank.mean)} (різниця — внесок початкових клієнтів, не врахованих у W);`,
    ),
    bullet(
      'перешикування майже вирівнює черги, тож банк поводиться близько до СМО M/M/2/8 зі спільною чергою: ' +
        `число клієнтів у банку ${num(t2.reference.meanInSystem)}, час перебування ${num(t2.reference.meanSojourn)}, ` +
        `імовірність відмови ${pct(t2.reference.failureProbability, 3)};`,
    ),
    bullet(
      'при збільшенні інтенсивності надходження завантаження, відмови й кількість змін смуги зростають ' +
        `(таблиця ${tableNo + 1}, рисунок ${figureNo + 1}).`,
    ),
    tableCaption('Залежність характеристик банку від середнього інтервалу між прибуттями (10 прогонів)'),
    ...table(
      ['Інтервал прибуття', 'ρ касира (сер.)', 'Клієнтів у банку', 'M/M/2/8', 'Відмови, %', 'M/M/2/8, %', 'Змін смуги'],
      t2.sweep.map((s) => [
        num(s.arrivalMean, 2),
        num((s.u1.mean + s.u2.mean) / 2),
        num(s.inBank.mean),
        num(s.reference.meanInSystem),
        num(s.lostShare.mean * 100, 2),
        num(s.reference.failureProbability * 100, 2),
        num(s.changes.mean, 1),
      ]),
    ),
    ...(await figure(png('task2-load'), 'Частка відмов і завантаження касирів залежно від інтенсивності надходження')),
    p(
      'Модель відтворює очікувану поведінку: зі зростанням навантаження частка відмов наближається до значення M/M/2/8, ' +
        'бо при довгих чергах перешикування майже завжди вирівнює смуги; при малому навантаженні число клієнтів у банку дещо ' +
        'більше, ніж у M/M/2/8, бо інколи клієнт чекає в одній черзі при вільному другому касирі (різниця черг 1 не дає права ' +
        'на перехід).',
    ),
  );

  // ───────────────────────────── Завдання 3
  const e3 = t3.estimates;
  const th = t3.theory;
  const nodes = t3.first?.nodes ?? [];
  const nodeRow = (s: ProcessStats, theoryU?: number): string[] => [
    s.name,
    channelsCap(s.channels),
    num(s.arrivals / HOSPITAL.time, 4),
    Number.isFinite(s.channels) ? num(s.utilization) : `${num(s.meanBusy)} зайн.`,
    theoryU === undefined ? '—' : num(theoryU),
    num(s.meanQueue),
    num(s.meanWait, 2),
    queueCap(s.maxQueueObserved),
  ];
  const utilTheory = [th.utilization.reception, th.utilization.escort, undefined, th.utilization.labRegistry, th.utilization.lab, undefined];
  add(
    task(
      3,
      'Для задачі про приймання хворих у лікарню скласти формалізовану модель масового обслуговування та реалізувати її ' +
        'з використанням побудованого універсального алгоритму. 40 балів.',
    ),
    p(
      'У лікарню надходять хворі трьох типів: 1 — пройшли попереднє обстеження і направлені на лікування; 2 — бажають потрапити ' +
        'в лікарню, але не пройшли повністю попереднє обстеження; 3 — тільки поступили на попереднє обстеження. У приймальному ' +
        'відділенні хворий стає в чергу, якщо обидва чергові лікарі зайняті; лікар, що звільнився, насамперед бере хворих, які вже ' +
        'пройшли обстеження. Хворі типу 1 після реєстрації чекають одного з трьох супровідних і йдуть у палату, хворі типів 2 і 3 ' +
        'самостійно йдуть у лабораторію, де стають у чергу в реєстратуру, а потім чекають одного з двох лаборантів. Після аналізів ' +
        'хворі типу 3 залишають лікарню, а хворі типу 2 повертаються в приймальне відділення і розглядаються як хворі типу 1.',
    ),
    tableCaption('Числові характеристики типів хворих'),
    ...table(
      ['Тип хворого', 'Відносна частота', 'Середній час реєстрації, хв'],
      HOSPITAL.types.map((t) => [String(t.type), num(t.p, 1), String(t.registrationMean)]),
    ),
    heading('Формалізація'),
    p(
      `Об’єкт обслуговування — хворий, тип хворого — тип вимоги. Мережа складається з шести СМО (рисунок ${figureNo + 1}), маршрут ` +
        'розгалужується за умовою на тип вимоги:',
    ),
    tableCaption('СМО моделі лікарні'),
    ...table(
      ['СМО', 'Пристрої', 'Черга', 'Час обслуговування, хв', 'Маршрут далі'],
      [
        ['чергові лікарі', String(HOSPITAL.doctors), '∞, тип 1 — першим', 'exp(15 / 40 / 30) за типом', 'тип 1 — супровідні; 2, 3 — перехід у лабораторію'],
        ['супровідні', String(HOSPITAL.escorts), '∞', label(HOSPITAL.toWard.label), 'палата (вихід)'],
        ['перехід у лабораторію', '∞', '—', label(HOSPITAL.walk.label), 'реєстратура'],
        ['реєстратура лабораторії', '1', '∞', label(HOSPITAL.labRegistry.label), 'лаборанти'],
        ['лаборанти', String(HOSPITAL.labTechnicians), '∞', label(HOSPITAL.analysis.label), 'тип 3 — вихід; тип 2 — перехід у приймальне'],
        ['перехід у приймальне', '∞', '—', label(HOSPITAL.walk.label), 'чергові лікарі, тип := 1'],
      ],
      [1.4, 0.8, 1.1, 1.4, 2.2],
    ),
    p(
      'Переходи між корпусами — СМО з необмеженою кількістю пристроїв: хворі йдуть незалежно, і черги не виникає. ' +
        'Супровідний зайнятий на весь час слідування в палату. Тип хворого визначає час реєстрації, пріоритет у черзі до лікаря ' +
        'та напрям руху; дуга з лабораторії в приймальне відділення змінює тип 2 на 1. Час перебування в системі фіксується в ' +
        'момент виходу: для типів 1 і 2 — у палаті, для типу 3 — на виході з лабораторії; інтервал між прибуттями в лабораторію — ' +
        'інтервал між надходженнями в реєстратуру лабораторії.',
    ),
    ...(await figure(png('task3-hospital'), 'Формалізована модель приймання хворих у лікарню')),
    ...code([
      "const create = new Create('надходження', exponential(15), rng, {",
      '  jobType: discrete(',
      '    { value: 1, p: 0.5 },',
      '    { value: 2, p: 0.1 },',
      '    { value: 3, p: 0.4 },',
      '  ),',
      '});',
      "const reception = new Process('чергові лікарі',",
      '  (job) => registration(job.type), rng, {',
      '    channels: 2,',
      '    queuePriority: (job) => (job.type === 1 ? 1 : 0),',
      '  });',
      "const toLab = new Process('перехід у лабораторію', uniform(2, 5), rng,",
      '  { channels: Infinity });',
      'reception.next = route(',
      '  { to: escort, when: (j) => j.type === 1 },',
      '  { to: toLab, when: (j) => j.type !== 1 },',
      ');',
      'lab.next = route(',
      '  { to: toReception, when: (j) => j.type === 2 },',
      '  { to: exit, when: (j) => j.type === 3 },',
      ');',
      'toReception.next = to(reception, { asType: 1 });',
    ]),
    heading('Результати'),
    p(
      `Виконано ${HOSPITAL.replications} незалежних прогонів, кожен тривалістю ${int(HOSPITAL.time)} хв (30 діб). ` +
        'Для часу перебування наведено середнє за прогонами з 95 % довірчим інтервалом, а також характеристики, обчислені ' +
        `за всіма ${int(t3.timeSummary.reduce((a, s) => a + s.count, 0))} хворими, що завершили прийом.`,
    ),
    tableCaption('Час, проведений хворим у системі, хв'),
    ...table(
      ['Тип', 'Хворих', 'Середній час', 'Відхилення', 'Квантиль 0,9', 'Максимум', 'Без черг'],
      t3.timeSummary.map((s) => {
        const e = [e3.time1, e3.time2, e3.time3][s.type - 1];
        return [String(s.type), int(s.count), e ? pm(e, 1) : num(s.mean, 1), num(s.deviation, 1), num(s.p90, 1), num(s.max, 1), num(th.pureTime[s.type] ?? 0, 1)];
      }),
      [0.5, 0.8, 1.3, 1, 1, 1, 1.1],
    ),
    p(
      `Середній інтервал між прибуттями хворих у лабораторію: ${pm(e3.labInterval, 2)} хв (середньоквадратичне відхилення ` +
        `${num(e3.labIntervalDeviation.mean, 2)} хв); аналітично — 1 / λ_лаб = ${num(th.labInterval, 1)} хв. Близькість ` +
        'відхилення до середнього показує, що потік у лабораторію близький до пуассонівського.',
    ),
    ...(await figure(png('task3-sojourn'), 'Розподіл часу перебування хворих у системі за типами')),
    p(
      'Стовпець «без черг» — сума середніх тривалостей етапів маршруту. Хворі типу 1 очікують у середньому ' +
        `${num((e3.time1.mean ?? 0) - (th.pureTime[1] ?? 0), 1)} хв, типу 3 — ${num((e3.time3.mean ?? 0) - (th.pureTime[3] ?? 0), 1)} хв: ` +
        'пріоритет у черзі до лікаря скорочує очікування тих, хто вже пройшов обстеження. Хворі типу 2 двічі проходять ' +
        'приймальне відділення, тож їхній час найбільший.',
    ),
    tableCaption('Характеристики СМО лікарні (перший прогін)'),
    ...table(
      ['СМО', 'c', 'λ, 1/хв', 'ρ імітація', 'ρ теорія', 'L', 'Wq, хв', 'Lmax'],
      nodes.map((s, i) => nodeRow(s, utilTheory[i])),
      [1.9, 0.5, 0.9, 1.1, 0.9, 0.8, 0.8, 0.7],
    ),
    p('Для СМО з c = ∞ замість завантаження наведено середню кількість хворих, що одночасно перебувають у переході; Lmax — найбільша довжина черги.'),
    heading('Верифікація'),
    p(
      'Для СМО без відмов у стаціонарному режимі завантаження ρ = λ·E[S] / c не залежить від законів розподілу, а інтенсивності ' +
        'потоків визначаються маршрутом: у приймальне відділення надходить λ·(1 + 0,1) (повернення типу 2), до супровідних — ' +
        'λ·(0,5 + 0,1), у лабораторію — λ·(0,1 + 0,4), де λ = 1/15.',
    ),
    tableCaption(`Інтенсивності потоків і завантаження: імітація (${HOSPITAL.replications} прогонів) проти розрахунку`),
    ...table(
      ['Величина', 'Імітація', 'Розрахунок', 'Відхилення'],
      [
        ['λ у приймальне відділення', pm(e3.flowReception, 4), num(th.flows.reception, 4), dev(e3.flowReception.mean, th.flows.reception)],
        ['λ до супровідних', pm(e3.flowEscort, 4), num(th.flows.escort, 4), dev(e3.flowEscort.mean, th.flows.escort)],
        ['λ у лабораторію', pm(e3.flowLab, 4), num(th.flows.lab, 4), dev(e3.flowLab.mean, th.flows.lab)],
        ['Завантаження лікаря', pm(e3.uReception), num(th.utilization.reception), dev(e3.uReception.mean, th.utilization.reception)],
        ['Завантаження супровідного', pm(e3.uEscort), num(th.utilization.escort), dev(e3.uEscort.mean, th.utilization.escort)],
        ['Завантаження реєстратури', pm(e3.uLabRegistry), num(th.utilization.labRegistry), dev(e3.uLabRegistry.mean, th.utilization.labRegistry)],
        ['Завантаження лаборанта', pm(e3.uLab), num(th.utilization.lab), dev(e3.uLab.mean, th.utilization.lab)],
      ],
      [2, 1.4, 1, 1],
    ),
    p(
      `Імітація збігається з розрахунком. Вузьке місце — чергові лікарі: завантаження ${num(e3.uReception.mean)}, середня черга ` +
        `${pm(e3.receptionQueue, 2)} хворих, середнє очікування ${pm(e3.receptionWait, 1)} хв. Решта ресурсів завантажені слабко ` +
        '(супровідні — менше ніж на 10 %), отже скорочувати час перебування слід за рахунок приймального відділення.',
    ),
  );

  add(
    heading('Висновки', true),
    p(
      'Реалізовано універсальний алгоритм імітації мережі масового обслуговування з просуванням часу до найближчої події. ' +
        'Алгоритм підтримує багатоканальні СМО (зокрема з необмеженою кількістю пристроїв), обмежені й необмежені черги, вибір з ' +
        'черги за пріоритетом, типи вимог та розгалуження маршруту за ймовірністю, за пріоритетом (сталим або залежним від стану ' +
        'мережі) і за умовою. Порівняння з мережею Джексона та формулами M/M/1/K підтвердило точність алгоритму.',
    ),
    p(
      'Модель банку побудовано з тих самих елементів: вибір коротшої смуги — пріоритет, що залежить від стану, відмова — ' +
        'відсутність дуги, здатної прийняти клієнта; перешикування реалізовано як додаткове правило після кожної події. ' +
        `За заданих параметрів банк недовантажений: завантаження касирів ${num(e2.u1.mean)} і ${num(e2.u2.mean)}, ` +
        `у банку в середньому ${num(e2.inBank.mean, 2)} клієнта, час перебування ${num(e2.timeInBank.mean, 3)}, відмов ` +
        `${num(e2.lostShare.mean * 100, 2)} %, близько ${int(e2.changes.mean)} змін смуги за ${int(BANK.time)} од. часу.`,
    ),
    p(
      'Модель лікарні використовує типи вимог для часу реєстрації, пріоритету в черзі й маршруту, а зміну типу — для повернення ' +
        `з лабораторії. Середній час у системі: тип 1 — ${num(e3.time1.mean, 1)} хв, тип 2 — ${num(e3.time2.mean, 1)} хв, ` +
        `тип 3 — ${num(e3.time3.mean, 1)} хв; інтервал між прибуттями в лабораторію — ${num(e3.labInterval.mean, 1)} хв. ` +
        `Основну частину часу хворі витрачають на очікування чергових лікарів, завантажених на ${pct(e3.uReception.mean, 0)}.`,
    ),
  );

  const list = (reference: string, format: (typeof LevelFormat)[keyof typeof LevelFormat], txt: string) => ({
    reference,
    levels: [{ level: 0, format, text: txt, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1069, hanging: 360 } } } }],
  });
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    numbering: { config: [list('bullets', LevelFormat.BULLET, '–'), list('route', LevelFormat.DECIMAL, '%1)')] },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1701, right: 851 } } },
        children: [...titlePage(), ...body],
      },
    ],
  });
  return Packer.toBuffer(doc);
};
