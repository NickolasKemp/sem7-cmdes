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
import { growthExponent, predictMs, theoreticalOps, type CostModel } from './complexity.ts';
import { EXPERIMENT, type Measurement, type Series } from './experiments.ts';
import { int, label, num, pct } from './format.ts';
import { BASE, STRUCTURE_INFO, STRUCTURES, type Structure } from './networks.ts';

export interface ReportInput {
  readonly series: Series;
  readonly fit: CostModel;
  readonly exponents: Readonly<Record<Structure, number>>;
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
    c('Комп’ютерний практикум № 4', 840),
    c('з дисципліни «Комп’ютерне моделювання дискретно-подійних систем»', 600),
    c('Тема: «Оцінка складності алгоритму імітації»'),
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

const ms = (x: number): string => num(x, x < 10 ? 2 : 1);
/** мкс на одну подію */
const perEvent = (m: Measurement): number => (m.ms * 1000) / m.steps;
const deviation = (sim: number, theory: number): string => pct(Math.abs(sim - theory) / theory, 1);
const at = (ms: readonly Measurement[], n: number): Measurement => {
  const m = ms.find((x) => x.n === n);
  if (!m) throw new Error(`немає досліду з N = ${n}`);
  return m;
};

/** Будує .docx; `png(name)` повертає шлях до растрової версії рисунка `name.svg`. */
export const buildDocx = async ({ series, fit, exponents }: ReportInput, png: (name: string) => string): Promise<Buffer> => {
  tableNo = 0;
  figureNo = 0;
  const body: Block[] = [];
  const add = (...b: Block[]): void => void body.push(...b);
  const { serial, byTime, byLambda, branched } = series;
  const T = EXPERIMENT.time;
  const nMax = Math.max(...EXPERIMENT.sizes);
  const theoryMs = (m: Measurement): number => predictMs(fit, theoreticalOps(m.structure, m.n, m.lambda, m.time));
  const theoryExponent = (s: Structure): number =>
    growthExponent(branched[s].filter((m) => m.n >= 100).map((m) => [m.n, theoryMs(m)] as const));

  const maxNuDeviation = Math.max(...serial.map((m) => Math.abs(m.steps / m.time - m.nuTheory) / m.nuTheory));

  // ───────────────────────────── Завдання 1
  add(
    heading('Хід роботи', true),
    task(
      1,
      'Розробити модель масового обслуговування, яка складається з N послідовно з’єднаних систем масового обслуговування. ' +
        'Число N є параметром моделі. Кількість подій в моделі оцінюється числом N+1. 20 балів.',
    ),
    p(
      'Модель зібрано з елементів універсального алгоритму імітації, розробленого в комп’ютерному практикумі № 3: CREATE ' +
        '(надходження вимог), PROCESS (СМО з чергою), DISPOSE (вихід) і клас Model, що реалізує принцип найближчої події. ' +
        'Код алгоритму не змінювався, тож оцінюється складність саме побудованого раніше алгоритму. Функція ' +
        '**buildNetwork(structure, n)** створює мережу заданої структури з n однакових СМО; для послідовної мережі кожна СМО ' +
        'передає вимогу наступній, остання — у вихід.',
    ),
    ...(await figure(png('task1-serial'), 'Схема мережі з N послідовно з’єднаних СМО')),
    p(
      `Параметри однакові для всіх дослідів: інтервал між надходженнями — ${label(`exp(${BASE.arrivalMean})`)} (λ = 1), час ` +
        `обслуговування в кожній СМО — ${label(`exp(${BASE.serviceMean})`)}, один пристрій, черга необмежена. Завантаження кожної ` +
        `СМО ρ = λ·${label(String(BASE.serviceMean))} = ${label(String(BASE.serviceMean))}, тому мережа стаціонарна за будь-якого N, ` +
        'а час обчислення залежить лише від розміру моделі, а не від накопичення черг.',
    ),
    p(
      'Подіями моделі є надходження вимоги (елемент CREATE) і завершення обслуговування в кожній з N СМО; DISPOSE власних ' +
        'подій не має. Отже, у моделі N + 1 подія, а у списку елементів, який переглядає алгоритм, — M = N + 2 елементи.',
    ),
    ...code([
      "const create = new Create('CREATE', exponential(arrivalMean), rng);",
      'const processes = Array.from({ length: n }, (_, i) =>',
      '  new Process(`S${i + 1}`, exponential(BASE.serviceMean), rng));',
      "const dispose = new Dispose('DISPOSE');",
      'const at = (i: number): Element => processes[i] ?? dispose;',
      '',
      "// structure === 'serial'",
      'create.next = to(at(0));',
      'for (const [i, s] of processes.entries()) s.next = to(at(i + 1));',
      '',
      'return { model: new Model([create, ...processes, dispose]), create, processes, dispose };',
    ]),
    heading('Перевірка моделі'),
    p(
      'Кожна вимога породжує одну подію надходження і N подій завершення обслуговування, тому в стаціонарному режимі ' +
        'інтенсивність подій ν = λ·(N + 1). Порівняння з кількістю кроків алгоритму, підрахованою під час імітації на ' +
        `інтервалі T = ${T}, наведено в таблиці 1.`,
    ),
    tableCaption(`Інтенсивність подій у послідовній мережі: теорія проти імітації (T = ${T})`),
    ...table(
      ['N', 'Подій у моделі N + 1', 'ν = λ·(N + 1)', 'ν імітація', 'Відхилення'],
      serial.map((m) => [String(m.n), String(m.n + 1), num(m.nuTheory, 1), num(m.steps / m.time, 1), deviation(m.steps / m.time, m.nuTheory)]),
      [0.6, 1.3, 1.2, 1.1, 1],
    ),
    p(
      `Найбільше відхилення — ${pct(maxNuDeviation, 1)}. Воно зумовлене випадковістю: кількість надходжень за інтервал T = ${T} ` +
        `має стандартне відхилення √(λ·T) ≈ ${num(Math.sqrt(T), 0)}, тобто ≈ ${pct(1 / Math.sqrt(T), 1)}, а кожна вимога ` +
        'породжує N + 1 подію. Модель правильно відтворює потік подій, і кількість подій зростає пропорційно N + 1.',
    ),
  );

  // ───────────────────────────── Завдання 2
  const s100 = at(serial, 100);
  const sMax = at(serial, nMax);
  add(
    task(
      2,
      'Виконати експериментальну оцінку складності алгоритму імітації мережі масового обслуговування. Для цього виконайте ' +
        'серію експериментів, в якій спостерігається збільшення часу обчислення алгоритму імітації при збільшенні кількості ' +
        'подій в моделі. 20 балів.',
    ),
    heading('Методика вимірювання'),
    bullet(
      'Мережа спершу виходить у стаціонарний режим: модель імітується протягом 2·W, де W — середній час перебування вимоги ' +
        'в мережі за формулами мережі Джексона. Інакше на початку імітації мережа порожня, подій менше, і результат залежав би від T.',
    ),
    bullet(`Час обчислення вимірюється функцією performance.now() лише для наступного інтервалу T = ${T} одиниць модельного часу.`),
    bullet(
      `Кожен дослід повторюється ${EXPERIMENT.repeats} рази з тим самим початковим значенням генератора (однакова робота); ` +
        'береться найменший час, найменш спотворений збиранням сміття та планувальником ОС. Перед серією виконується прогрів ' +
        'JIT-компілятора.',
    ),
    bullet('Під час кожного досліду підраховуються кроки алгоритму (події), звернення до елементів і переглянуті дуги маршрутів.'),
    tableCaption(`Час обчислення алгоритму імітації для послідовної мережі (λ = 1, T = ${T})`),
    ...table(
      ['N + 1', 'Подій за T', 'Час, мс', 'Час на подію, мкс'],
      serial.map((m) => [String(m.n + 1), int(m.steps), ms(m.ms), num(perEvent(m), 3)]),
    ),
    ...(await figure(png('task2-time-n'), 'Залежність часу обчислення від кількості подій у моделі')),
    p(
      `Час обчислення зростає нелінійно: при збільшенні кількості подій з ${s100.n + 1} до ${sMax.n + 1} (у ${num((sMax.n + 1) / (s100.n + 1), 1)} ` +
        `раза) він зріс з ${ms(s100.ms)} до ${ms(sMax.ms)} мс, тобто в ${num(sMax.ms / s100.ms, 1)} раза. Нахил залежності в ` +
        `логарифмічних координатах на ділянці N ≥ 100 дорівнює ${num(exponents.serial, 2)}, отже, час обчислення пропорційний ` +
        'квадрату кількості подій. Причина видна з останнього стовпця таблиці 2: зі збільшенням N зростає і кількість подій ' +
        'за інтервал, і час обробки кожної з них.',
    ),
    p(
      `Щоб перевірити інші множники формули складності, проведено ще дві серії для мережі з N = ${EXPERIMENT.fixedN}: зі зміною часу ` +
        `моделювання T при λ = 1 і зі зміною інтенсивності надходження λ при T = ${T}.`,
    ),
    tableCaption(`Час обчислення при зміні T і λ (N = ${EXPERIMENT.fixedN})`),
    ...table(
      ['Серія', 'T', 'λ', 'Подій', 'Час, мс', 'Час на подію, мкс'],
      [
        ...byTime.map((m) => ['зміна T', String(m.time), label(String(m.lambda)), int(m.steps), ms(m.ms), num(perEvent(m), 3)]),
        ...byLambda.map((m) => ['зміна λ', String(m.time), label(String(m.lambda)), int(m.steps), ms(m.ms), num(perEvent(m), 3)]),
      ],
      [1, 0.8, 0.6, 1, 1, 1.3],
    ),
    ...(await figure(png('task2-time-events'), 'Залежність часу обчислення від кількості оброблених подій')),
    p(
      'Обидві серії лягають на одну пряму: час обчислення пропорційний кількості оброблених подій ν·T незалежно від того, ' +
        'чим вона збільшена — тривалістю моделювання чи інтенсивністю надходження. Час обробки однієї події при фіксованому N ' +
        'сталий, отже, нелінійність на рисунку 2 створює саме розмір моделі.',
    ),
  );

  // ───────────────────────────── Завдання 3
  const opsMax = theoreticalOps('serial', nMax, 1, T);
  add(
    task(3, 'Виконати теоретичну оцінку складності побудованого алгоритму імітації. 20 балів.'),
    p('Згідно з лекцією 5, складність алгоритму імітації оцінюється кількістю елементарних операцій:'),
    formula('O = ν · T · k,'),
    p(
      'де ν — інтенсивність подій, T — час моделювання, k — максимальна кількість елементарних операцій для обробки однієї ' +
        'події. Підрахуємо k для побудованого алгоритму. Нижче наведено основний цикл класу Model з кількістю операцій ' +
        'кожного кроку (M = N + 2 — кількість елементів моделі).',
    ),
    ...code([
      'for (;;) {',
      '  let tnext = Infinity;',
      '  for (const e of this.elements) tnext = Math.min(tnext, e.tnext);   // M',
      '  const until = Math.min(tnext, time);',
      '  for (const e of this.elements) e.doStatistics(until - this.tcurr); // M',
      '  this.tcurr = until;',
      '  for (const e of this.elements) e.tcurr = until;                    // M',
      '  if (tnext > time) return this;',
      '  const fired = this.elements.filter((e) => e.tnext === this.tcurr); // M',
      '  for (const e of fired) e.outAct();      // const + вибір дуги: a',
      '  this.steps++;',
      '}',
    ]),
    p(
      'На кожному кроці алгоритм чотири рази проходить увесь список елементів: пошук найближчої події, накопичення ' +
        'статистики, синхронізація модельного часу і відбір елементів, чия подія настала. Обробка самої події (outAct ' +
        'і inAct наступного елемента) має сталу складність, крім вибору дуги маршруту: функція route.pick переглядає всі ' +
        'a дуг маршруту (відбір відкритих дуг, пошук групи з найвищим пріоритетом, вибір за ймовірністю). Тому',
    ),
    formula('k(N) = 4·(N + 2) + a + c,'),
    p(
      'де c — стала кількість операцій обробки події. Для послідовної мережі a = 1, а кожна вимога породжує N + 1 подію, ' +
        'тобто ν = λ·(N + 1). Звідси теоретична оцінка складності:',
    ),
    formula('O(N) = λ·T·(N + 1)·(4N + 8 + 1 + c) = O(λ·T·N²).'),
    p(
      'Складність алгоритму лінійна за часом моделювання та інтенсивністю надходження і квадратична за кількістю подій у ' +
        'моделі. Квадратичність складається з двох лінійних множників: кількість подій на одну вимогу зростає як N + 1, і ' +
        'обробка кожної події потребує перегляду всіх N + 2 елементів.',
    ),
    heading('Порівняння з експериментом'),
    p(
      'Щоб перейти від кількості операцій до часу, вважатимемо, що кожен вид операцій має свою вартість: t = α·E + β·A + γ·S, ' +
        'де E = 4·(N + 2)·S — звернення до елементів, A — переглянуті дуги, S — кількість подій. Коефіцієнти знайдено методом ' +
        `найменших квадратів (за відносною похибкою) за всіма ${int(Object.values(branched).flat().length + byTime.length + byLambda.length)} ` +
        'дослідами практикуму, включно з розгалуженими мережами завдання 4.',
    ),
    tableCaption('Вартість елементарних операцій алгоритму'),
    ...table(
      ['Операція', 'Позначення', 'Вартість, нс'],
      [
        ['звернення до елемента в циклі кроку', 'α', num(fit.alpha, 2)],
        ['перегляд дуги маршруту', 'β', num(fit.beta, 1)],
        ['стала частина обробки події', 'γ', num(fit.gamma, 0)],
        ['коефіцієнт детермінації', 'R²', num(fit.r2, 4)],
      ],
      [2.4, 1, 1],
    ),
    p(
      'Далі теоретичний час обчислюється за теоретичною кількістю операцій — з ν = λ·(N + 1) і k(N), без використання ' +
        'виміряних значень, — і порівнюється з виміряним (таблиця 5).',
    ),
    tableCaption(`Теоретична оцінка складності проти експерименту для послідовної мережі (T = ${T})`),
    ...table(
      ['N + 1', 'ν·T', 'Операцій E, млн', 't теорія, мс', 't експеримент, мс', 'Відхилення'],
      serial.map((m) => {
        const o = theoreticalOps('serial', m.n, m.lambda, m.time);
        return [String(m.n + 1), int(o.events), num(o.elementVisits / 1e6, 2), ms(theoryMs(m)), ms(m.ms), deviation(m.ms, theoryMs(m))];
      }),
      [0.7, 1, 1.3, 1.2, 1.4, 1],
    ),
    ...(await figure(png('task3-event-cost'), 'Середній час обробки однієї події в послідовній мережі')),
    p(
      `Час обробки однієї події зростає лінійно з N, як і передбачає k(N) = 4·(N + 2) + a + c: для N = ${nMax} алгоритм ` +
        `виконує ${num(opsMax.elementVisits / 1e6, 0)} млн звернень до елементів за ${int(opsMax.events)} подій. Теоретична ` +
        'оцінка добре узгоджується з експериментом. За малих N час вимірювання становить частки мілісекунди і чутливий ' +
        'до похибки таймера, за великих N зростає вартість звернення до елемента, оскільки об’єкти елементів перестають ' +
        'вміщатися у швидку кеш-пам’ять процесора.',
    ),
  );

  // ───────────────────────────── Завдання 4
  const light = (['fan', 'tree'] as const).map((s) => STRUCTURE_INFO[s].short).join(' і ');
  add(
    task(
      4,
      'Повторіть експериментальну та теоретичну оцінку складності алгоритму імітації при зміні структури мережі масового ' +
        'обслуговування: замість послідовно з’єднаних систем масового обслуговування розгляньте розгалужені маршрути ' +
        'слідування між системами масового обслуговування. Зробіть висновок про вплив розгалужень маршруту на складність ' +
        'алгоритму. 40 балів.',
    ),
    p(
      'Розглянуто чотири розгалужені структури з тією самою кількістю СМО N (отже, з тією самою кількістю подій N + 1 і ' +
        'елементів N + 2) та тими самими параметрами. Розгалуження задаються маршрутами route з імовірностями переходу, ' +
        'реалізованими в практикумі № 3:',
    ),
    bullet('**віяло** — CREATE розподіляє вимоги між N паралельними СМО з імовірністю 1/N, з кожної СМО вимога виходить з мережі;'),
    bullet('**дерево** — двійкове дерево: з СМО i вимога переходить у СМО 2i або 2i + 1 з імовірністю 0,5, з листків — у вихід;'),
    bullet('**з пропуском** — з СМО i вимога переходить у СМО i + 1 або i + 2 з імовірністю 0,5;'),
    bullet(`**з поверненням** — послідовна мережа, з останньої СМО вимога з імовірністю p = ${label(String(BASE.feedbackP))} повертається в першу.`),
    ...(await figure(png('task4-fan'), 'Розгалуження вхідного потоку на N паралельних СМО', 400)),
    ...(await figure(png('task4-tree'), 'Двійкове дерево розгалужень')),
    ...(await figure(png('task4-skip'), 'Розгалуження з пропуском СМО')),
    ...(await figure(png('task4-feedback'), 'Послідовна мережа з поверненням')),
    heading('Теоретична оцінка'),
    p(
      'Цикл алгоритму не залежить від структури мережі: на кожному кроці переглядаються всі N + 2 елементи, тож оцінка ' +
        'k(N) = 4·(N + 2) + a + c зберігається, змінюється лише кількість дуг a у маршрутах. Структура мережі визначає інше — ' +
        'інтенсивність подій ν = λ·(1 + L), де L — середня кількість обслуговувань однієї вимоги. L знаходиться з рівнянь ' +
        'балансу потоків vⱼ = δⱼ + Σ vᵢ·pᵢⱼ, які програма розв’язує за маршрутами побудованої мережі (функція visitsPerNode).',
    ),
    tableCaption('Теоретична оцінка складності для мереж різної структури'),
    ...table(
      ['Структура', 'L(N)', 'Дуг a', 'ν', 'O(N)'],
      [
        ['послідовна', 'N', '1', 'λ·(N + 1)', 'N²'],
        ['віяло', '1', 'N у CREATE, 1 у СМО', '2λ', 'N'],
        ['дерево', '≈ log₂(N + 1)', '2', 'λ·(1 + log₂N)', 'N·log N'],
        ['з пропуском', '≈ 2N/3 + 2/9', '2', 'λ·(2N/3 + 1)', 'N²'],
        ['з поверненням', `N / (1 − p) = ${label(String(1 / (1 - BASE.feedbackP)))}N`, '1, в останній 2', 'λ·(N/(1 − p) + 1)', 'N²'],
      ],
      [1.3, 1.4, 1.5, 1.4, 0.8],
    ),
    p(
      'Для віяла додатково враховано вибір дуги: CREATE переглядає N дуг, але лише половина подій — надходження, тому ' +
        'в середньому на подію припадає (N + 1)/2 переглядів дуг. Порядок складності залишається лінійним.',
    ),
    heading('Експериментальна оцінка'),
    tableCaption(`Час обчислення для мереж різної структури, мс (λ = 1, T = ${T})`),
    ...table(
      ['N + 1', ...STRUCTURES.map((s) => STRUCTURE_INFO[s].short)],
      EXPERIMENT.sizes.map((n) => [String(n + 1), ...STRUCTURES.map((s) => ms(at(branched[s], n).ms))]),
    ),
    ...(await figure(png('task4-time'), 'Залежність часу обчислення від кількості подій для мереж різної структури')),
    ...(await figure(png('task4-time-light'), `Час обчислення для структур ${light}: експеримент і теорія`)),
    ...(await figure(png('task4-event-cost'), 'Середній час обробки однієї події для мереж різної структури')),
    tableCaption(`Порівняння теоретичної та експериментальної оцінок (N = ${nMax})`),
    ...table(
      ['Структура', 'L теорія', 'L імітація', 'b теорія', 'b експ.', 't теорія, мс', 't експ., мс'],
      STRUCTURES.map((s) => {
        const m = at(branched[s], nMax);
        return [
          STRUCTURE_INFO[s].short,
          num(m.visits, 1),
          num(m.steps / (m.lambda * m.time) - 1, 1),
          num(theoryExponent(s), 2),
          num(exponents[s], 2),
          ms(theoryMs(m)),
          ms(m.ms),
        ];
      }),
      [1.5, 0.9, 1, 0.9, 0.9, 1.1, 1.1],
    ),
    p(
      'Показник b — нахил залежності t ≈ c·Nᵇ у логарифмічних координатах на ділянці N ≥ 100; теоретичний показник ' +
        'обчислено тим самим способом за теоретичними значеннями часу. Він трохи відрізняється від порядку O(N), бо на ' +
        'ділянці N = 100…500 ще помітні доданки нижчого порядку: стала частина обробки події та вибір дуги. Обидва ' +
        'показники поділяють структури на дві групи: близько 2 для послідовної мережі, мережі з пропуском і з поверненням ' +
        'та близько 1 для віяла й дерева.',
    ),
    heading('Вплив розгалужень маршруту на складність'),
    p(
      `Однакова кількість подій у моделі не означає однакової складності: за N + 1 = ${nMax + 1} час обчислення для різних ` +
        `структур відрізняється у ${num(at(branched.feedback, nMax).ms / at(branched.fan, nMax).ms, 0)} разів. Розгалуження впливає ` +
        'на обидва множники формули O = ν·T·k:',
    ),
    bullet(
      '**інтенсивність подій ν** визначається довжиною маршруту вимоги L. Розгалуження на паралельні гілки (віяло, дерево) ' +
        'вкорочує маршрут: вимога проходить одну або log₂N СМО замість N, і складність знижується з O(N²) до O(N) або ' +
        'O(N·log N). Розгалуження з пропуском зменшує L лише в сталу кількість разів (у 1,5), порядок O(N²) зберігається. ' +
        'Повернення, навпаки, подовжує маршрут у 1/(1 − p) разів і пропорційно збільшує час обчислення;',
    ),
    bullet(
      '**кількість операцій на подію k** від структури майже не залежить: для всіх структур час обробки події зростає ' +
        'лінійно з N (рисунок 11), бо алгоритм найближчої події на кожному кроці переглядає всі елементи моделі. ' +
        'Розгалуження додає лише вартість вибору дуги, пропорційну кількості дуг маршруту: тому для віяла, де CREATE має N ' +
        `дуг, час обробки події найбільший — ${num(perEvent(at(branched.fan, nMax)), 2)} мкс проти ` +
        `${num(perEvent(at(branched.serial, nMax)), 2)} мкс для послідовної мережі за N = ${nMax}.`,
    ),
    p(
      'Отже, складність алгоритму імітації визначається не кількістю подій у моделі як такою, а добутком середньої ' +
        'кількості подій, які породжує одна вимога, на розмір моделі. Для оцінки складності розгалуженої мережі достатньо ' +
        'розв’язати рівняння балансу потоків і підставити L(N) у формулу O = λ·T·(1 + L(N))·k(N).',
    ),
  );

  // ───────────────────────────── Висновки
  add(
    heading('Висновки', true),
    p(
      'Побудовано модель з N послідовно з’єднаних СМО на основі універсального алгоритму імітації з практикуму № 3. Модель ' +
        'має N + 1 подію; перевірено, що інтенсивність подій у ній дорівнює λ·(N + 1).',
    ),
    p(
      `Експериментально встановлено, що час обчислення пропорційний кількості оброблених подій ν·T і зростає як N^${num(exponents.serial, 2)} ` +
        `зі збільшенням кількості подій у моделі: для N + 1 = ${nMax + 1} імітація ${T} одиниць часу триває ${ms(sMax.ms)} мс.`,
    ),
    p(
      'Теоретична оцінка за формулою O = ν·T·k дала O(λ·T·N²): кожна вимога породжує N + 1 подію, а кожен крок алгоритму ' +
        `переглядає всі N + 2 елементи. З вартістю операцій, знайденою методом найменших квадратів (R² = ${num(fit.r2, 3)}), ` +
        'теоретична оцінка відтворює виміряний час для всіх досліджених структур.',
    ),
    p(
      'Розгалуження маршрутів змінює складність через середню довжину маршруту вимоги: паралельні гілки знижують її до ' +
        'O(N) (віяло) та O(N·log N) (дерево), пропуски зменшують сталий множник, повернення його збільшують. Вартість ' +
        'обробки однієї події лінійна за N для будь-якої структури й зростає лише на кількість дуг маршруту. Зменшити її ' +
        'можна, замінивши перегляд усіх елементів на чергу подій із пріоритетом (купу): тоді пошук найближчої події коштує ' +
        'O(log N), а статистика накопичується лише для елементів, стан яких змінився.',
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
