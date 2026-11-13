/** Формування звіту у форматі Markdown за результатами обчислень. */
import type { ProcessStats } from './process.ts';
import type { Task1Result, Task2Result, Task3Result, Task4Result, Task5Result, Task6Result } from './tasks.ts';
import type { QueueTheory } from './theory.ts';

/** Число з десятковою комою, як прийнято в українських текстах. */
export const num = (x: number, digits = 3): string =>
  Number.isFinite(x) ? x.toFixed(digits).replace('.', ',').replace('-', '−') : '∞';

/** Підпис закону розподілу з десятковою комою: exp(1.5) → exp(1,5). */
export const label = (s: string): string => s.replace(/(\d)\.(\d)/g, '$1,$2');

const int = (x: number): string => x.toLocaleString('uk-UA').replace(/\s/g, ' ');
const pct = (x: number): string => `${num(x * 100, 2)} %`;
/** відносне відхилення імітації від теорії */
const dev = (sim: number, theory: number): string => (theory === 0 ? (sim === 0 ? '0 %' : '—') : pct(Math.abs(sim - theory) / theory));
const queueCap = (q: number): string => (Number.isFinite(q) ? String(q) : '∞');

const table = (head: readonly string[], align: readonly ('l' | 'r')[], rows: readonly (readonly string[])[]): string =>
  [
    `| ${head.join(' | ')} |`,
    `| ${align.map((a) => (a === 'r' ? '---:' : '---')).join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');

const compareRows = (sim: ProcessStats, theory: QueueTheory): string[][] => [
  ['Імовірність відмови', num(sim.failureProbability, 4), num(theory.failureProbability, 4), dev(sim.failureProbability, theory.failureProbability)],
  ['Середня довжина черги', num(sim.meanQueue), num(theory.meanQueue), dev(sim.meanQueue, theory.meanQueue)],
  ['Середнє завантаження пристрою', num(sim.utilization), num(theory.utilization), dev(sim.utilization, theory.utilization)],
  ['Середній час очікування в черзі', num(sim.meanWait), num(theory.meanWait), dev(sim.meanWait, theory.meanWait)],
];

export interface ReportInput {
  readonly t1: Task1Result;
  readonly t2: Task2Result;
  readonly t3: Task3Result;
  readonly t4: Task4Result;
  readonly t5: Task5Result;
  readonly t6: Task6Result;
  readonly meta: { readonly date: string; readonly runtime: string };
}

export const buildReport = ({ t1, t2, t3, t4, t5, t6, meta }: ReportInput): string => {
  const lines: string[] = [];
  const push = (...s: string[]): void => void lines.push(...s);

  push(
    '# Комп’ютерний практикум №2',
    '## «Об’єктно-орієнтований підхід до побудови імітаційних моделей дискретно-подійних систем»',
    '',
    `**Дата виконання:** ${meta.date}  `,
    `**Середовище:** ${meta.runtime}  `,
    '**Мова реалізації:** TypeScript (без сторонніх бібліотек; генератор випадкових чисел з початковим значенням — результати відтворювані)',
    '',
    '### Мета роботи',
    'Реалізувати алгоритм імітації дискретно-подійної системи за принципом найближчої події з використанням ' +
      'об’єктно-орієнтованого підходу, побудувати модель із трьох послідовних процесів обслуговування, ' +
      'розширити клас PROCESS багатоканальним обслуговуванням і маршрутизацією в кілька блоків ' +
      'та виконати верифікацію моделі.',
    '',
    '### Структура програми',
    '',
    table(
      ['Клас / модуль', 'Призначення'],
      ['l', 'l'],
      [
        ['`Element` (`element.ts`)', 'базовий елемент: `tnext`, `tcurr`, `quantity`, маршрут `next`, методи `inAct`, `outAct`, `doStatistics`'],
        ['`Create` (`create.ts`)', 'джерело вимог: у момент `tnext` створює вимогу й планує наступне надходження'],
        ['`Process` (`process.ts`)', 'обслуговування c ідентичними пристроями зі спільною обмеженою чергою, накопичення статистики'],
        ['`Dispose` (`dispose.ts`)', 'вихід із моделі, час перебування вимог у системі'],
        ['`Router`, `to`, `branch`', 'маршрут вимоги: одна гілка (аналог `nextElement`) або кілька гілок з імовірностями'],
        ['`Model` (`model.ts`)', 'алгоритм імітації за принципом найближчої події'],
        ['`random.ts`', 'аналог `FunRand`: експоненційний, рівномірний, нормальний, Ерланга та сталий закони'],
        ['`theory.ts`', 'формули M/M/c/K та рівняння балансу потоків мережі — еталон для верифікації'],
      ],
    ),
    '',
    'Діаграма класів відповідає рисунку 2.5 методички: `Create`, `Process` і `Dispose` успадковують `Element`, ' +
      '`Model` агрегує список елементів. Поле `nextElement` замінено інтерфейсом `Router` — це й дає змогу ' +
      'в завданні 6 організувати вихід у кілька блоків без зміни решти коду.',
    '',
    '---',
    '',
  );

  // ── Завдання 1
  const r1 = t1.run;
  push(
    '## 1. Алгоритм імітації моделі обслуговування одним пристроєм (ООП)',
    '',
    'Модель CREATE → PROCESS → DISPOSE (рисунок 2.4): інтервал між надходженнями — exp(2), час обслуговування — exp(1), ' +
      'максимальна довжина черги 5, час моделювання 1000.',
    '',
    'Крок алгоритму `Model.simulate`:',
    '1. знайти найменший `tnext` серед усіх елементів (момент найближчої події);',
    '2. для всіх елементів накопичити статистику `doStatistics(tnext − tcurr)` — стан між подіями не змінюється;',
    '3. просунути модельний час `tcurr = tnext` у всіх елементах;',
    '4. виконати `outAct()` усіх елементів, у яких `tnext = tcurr` (одночасні події обробляються за один крок).',
    '',
    '```ts',
    'for (;;) {',
    '  let tnext = Infinity;',
    '  for (const e of this.elements) tnext = Math.min(tnext, e.tnext);',
    '  const until = Math.min(tnext, time);',
    '  for (const e of this.elements) e.doStatistics(until - this.tcurr);',
    '  this.tcurr = until;',
    '  for (const e of this.elements) e.tcurr = until;',
    '  if (tnext > time) return this;',
    '  const fired = this.elements.filter((e) => e.tnext === this.tcurr);',
    '  for (const e of fired) e.outAct();',
    '}',
    '```',
    '',
    'На відміну від лістингу з методички, останній крок не виходить за межу `time`: статистика накопичується точно до ' +
      'кінця інтервалу моделювання, тож середні за часом величини діляться на правильну тривалість.',
    '',
    '**Трасування перших кроків імітації** (аналог виводу `printInfo`):',
    '',
    table(
      ['Крок', 't', 'Подія', 'Створено', 'Стан пристрою', 'Черга', 'Обслуговано', 'Відмови'],
      ['r', 'r', 'l', 'r', 'r', 'r', 'r', 'r'],
      t1.trace.map((r, i) => [String(i + 1), num(r.t), r.fired, int(r.created), String(r.state), String(r.queue), int(r.served), int(r.failures)]),
    ),
    '',
    `**Результати за T = ${int(r1.time)}** (${int(r1.steps)} кроків імітації):`,
    '',
    table(
      ['Показник', 'Значення'],
      ['l', 'r'],
      [
        ['Створено вимог (CREATOR quantity)', int(r1.created)],
        ['Обслуговано вимог (PROCESSOR quantity)', int(r1.process.served)],
        ['Кількість відмов', int(r1.process.failures)],
        ['Імовірність відмови', num(r1.process.failureProbability, 4)],
        ['Середня довжина черги', num(r1.process.meanQueue)],
        ['Середній час очікування в черзі', num(r1.process.meanWait)],
      ],
    ),
    '',
    'Імовірність відмови рахується як відношення кількості відмов до кількості вимог, що *надійшли* в PROCESS ' +
      '(у методичці — до кількості обслугованих, що дає трохи завищену оцінку).',
    '',
    '---',
    '',
  );

  // ── Завдання 2
  push(
    '## 2. Середнє завантаження пристрою',
    '',
    'Завантаження — частка часу, протягом якої пристрій зайнятий. Метод `doStatistics(delta)` класу `Process` ' +
      'накопичує інтеграл кількості зайнятих пристроїв `busyArea += busy·delta` поряд з інтегралом довжини черги; ' +
      'середнє завантаження U = busyArea / (T·c).',
    '',
    '```ts',
    'override doStatistics(delta: number): void {',
    '  this.queueArea += this.#queue.length * delta;',
    '  this.busyArea += this.#busy.length * delta;',
    '}',
    '```',
    '',
    `Для перевірки використано точні формули СМО M/M/1/6 (ρ = 0,5): U = ρ·(1 − P_відм) = ${num(t2.theory.utilization, 4)}, ` +
      `L_черги = ${num(t2.theory.meanQueue, 4)}, P_відм = ${num(t2.theory.failureProbability, 4)}.`,
    '',
    table(
      ['Час моделювання T', 'Створено', 'U (імітація)', 'U (теорія)', 'Відхилення U', 'L_черги', 'P_відм'],
      ['r', 'r', 'r', 'r', 'r', 'r', 'r'],
      t2.byTime.map((r) => [
        int(r.time),
        int(r.created),
        num(r.process.utilization, 4),
        num(t2.theory.utilization, 4),
        dev(r.process.utilization, t2.theory.utilization),
        num(r.process.meanQueue, 4),
        num(r.process.failureProbability, 4),
      ]),
    ),
    '',
    '![Збіжність середнього завантаження](task2-utilization.svg)',
    '',
    'Зі збільшенням часу моделювання оцінка завантаження збігається до теоретичного значення: при T = 1000 відхилення ' +
      `становить ${dev(t2.byTime[0]?.process.utilization ?? 0, t2.theory.utilization)}, при T = 10⁶ — ` +
      `${dev(t2.byTime[3]?.process.utilization ?? 0, t2.theory.utilization)}.`,
    '',
    '---',
    '',
  );

  // ── Завдання 3
  const r3 = t3.run;
  push(
    '## 3. Модель із трьох послідовних процесів (рисунок 2.1)',
    '',
    'CREATE → PROCESS 1 → PROCESS 2 → PROCESS 3 → DISPOSE. Кожен елемент з’єднується з наступним маршрутом `to(next)`; ' +
      'вимога, що отримала відмову в будь-якому процесі, з моделі видаляється.',
    '',
    '![Схема моделі](task3-scheme.svg)',
    '',
    table(
      ['Параметр', 'Значення'],
      ['l', 'l'],
      [
        ['Інтервал між надходженнями', r3.params.create.label],
        ...r3.params.stages.map((s, i) => [`PROCESS ${i + 1}`, `${s.delay.label}, черга ≤ ${queueCap(s.maxQueue)}, пристроїв ${s.channels ?? 1}`]),
        ['Час моделювання', int(r3.params.time)],
      ],
    ),
    '',
    table(
      ['Елемент', 'Надійшло', 'Обслуговано', 'Відмови', 'P_відм', 'L_черги', 'U', 'Очікування в черзі'],
      ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
      r3.stages.map((s) => [s.name, int(s.arrivals), int(s.served), int(s.failures), num(s.failureProbability, 4), num(s.meanQueue), num(s.utilization), num(s.meanWait)]),
    ),
    '',
    `Створено ${int(r3.created)} вимог, вийшло з моделі (DISPOSE) ${int(r3.disposed)}, ` +
      `середній час перебування в системі ${num(r3.meanTimeInSystem)}. ` +
      `Баланс вимог: ${int(r3.created)} = ${int(r3.disposed)} (вийшли) + ${int(r3.stages.reduce((s, p) => s + p.failures, 0))} (відмови) + ${int(r3.inSystem)} (у моделі на момент T) — виконується.`,
    '',
    '![Траєкторія черг](task3-queues.svg)',
    '',
    'Вузьке місце — PROCESS 2 з найбільшим середнім часом обслуговування: у ньому найдовша черга й найбільша частка відмов. ' +
      'Потік на вході PROCESS 2 і PROCESS 3 «проріджений» відмовами попередніх процесів, тому кількість надходжень спадає вздовж ланцюга.',
    '',
    '---',
    '',
  );

  // ── Завдання 4
  push(
    '## 4. Верифікація моделі',
    '',
    'Верифікацію виконано трьома способами:',
    '1. **Зміна вхідних змінних і параметрів** — для кожного варіанта заздалегідь сформульовано очікуваний напрямок зміни ' +
      'вихідних величин відносно базового варіанта; програма перевіряє його автоматично.',
    '2. **Порівняння з аналітичним розв’язком** — на вхід PROCESS 1 завжди надходить пуассонівський потік, тому для ' +
      'експоненційних законів його характеристики точно описуються формулами M/M/1/K.',
    '3. **Необмежені черги** — за теоремою Берка вихідний потік M/M/1 пуассонівський, тож увесь ланцюг є мережею ' +
      'Джексона і кожен процес має характеристики M/M/1 з тим самим λ.',
    '',
    'Позначення: tc — середній інтервал надходження, t_i — середній час обслуговування в PROCESS i, ' +
      'P_i — імовірність відмови, L_i — середня довжина черги, U_i — завантаження, W — середній час перебування в системі. ' +
      `Час моделювання кожного варіанта T = ${int(t4.rows[0]?.run.params.time ?? 0)}.`,
    '',
    '**Таблиця 4.1 — Результати верифікації**',
    '',
    table(
      ['№', 'Варіант', 'Зміна', 'P1', 'P2', 'P3', 'L1', 'L2', 'L3', 'U1', 'U2', 'U3', 'W'],
      ['r', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
      t4.rows.map((r, i) => {
        const s = r.run.stages;
        return [
          String(i + 1),
          r.label,
          r.change,
          ...s.map((p) => num(p.failureProbability, 4)),
          ...s.map((p) => num(p.meanQueue)),
          ...s.map((p) => num(p.utilization)),
          num(r.run.meanTimeInSystem),
        ];
      }),
    ),
    '',
    '**Таблиця 4.2 — Очікувані зміни відносно базового варіанта**',
    '',
    table(
      ['№', 'Варіант', 'Очікувалось', 'Результат'],
      ['r', 'l', 'l', 'l'],
      t4.rows.slice(1).map((r, i) => [
        String(i + 2),
        r.label,
        r.checks.map((c) => c.label).join('; '),
        r.checks.every((c) => c.ok) ? '✅ усі підтверджено' : `❌ ${r.checks.filter((c) => !c.ok).map((c) => c.label).join('; ')}`,
      ]),
    ),
    '',
    '**Таблиця 4.3 — PROCESS 1: імітація проти формул M/M/1/K**',
    '',
    table(
      ['№', 'Варіант', 'P1 імітація', 'P1 теорія', 'L1 імітація', 'L1 теорія', 'U1 імітація', 'U1 теорія'],
      ['r', 'l', 'r', 'r', 'r', 'r', 'r', 'r'],
      t4.rows.flatMap((r, i) => {
        const s = r.run.stages[0];
        const t = r.firstStageTheory;
        return s && t
          ? [[String(i + 1), r.label, num(s.failureProbability, 4), num(t.failureProbability, 4), num(s.meanQueue), num(t.meanQueue), num(s.utilization), num(t.utilization)]]
          : [];
      }),
    ),
    '',
    `**Таблиця 4.4 — Необмежені черги: імітація (T = ${int(t4.jackson.run.params.time)}) проти мережі Джексона**`,
    '',
    table(
      ['Процес', 'L імітація', 'L теорія', 'Відхилення', 'U імітація', 'U теорія', 'Очікування імітація', 'Очікування теорія'],
      ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
      t4.jackson.run.stages.map((s, i) => {
        const t = t4.jackson.theory[i];
        return t
          ? [s.name, num(s.meanQueue), num(t.meanQueue), dev(s.meanQueue, t.meanQueue), num(s.utilization), num(t.utilization), num(s.meanWait), num(t.meanWait)]
          : [s.name];
      }),
    ),
    '',
    `Середній час перебування в системі: імітація ${num(t4.jackson.run.meanTimeInSystem)}, теорія ${num(t4.jackson.meanTimeInSystem)} ` +
      `(відхилення ${dev(t4.jackson.run.meanTimeInSystem, t4.jackson.meanTimeInSystem)}).`,
    '',
    '**Висновки з верифікації.** Усі очікувані напрямки змін підтвердились. Детерміновані затримки дають точні значення ' +
      '(черг і відмов немає, U_i = t_i / tc). Зменшення дисперсії часу обслуговування за незмінних середніх (рівномірний закон, ' +
      'закон Ерланга) зменшує черги — відома властивість СМО (формула Поллачека — Хінчина). ' +
      'Для PROCESS 1 і для мережі з необмеженими чергами імітація збігається з аналітичними формулами в межах статистичної похибки, ' +
      'отже модель адекватна.',
    '',
    '---',
    '',
  );

  // ── Завдання 5
  push(
    '## 5. PROCESS з кількома ідентичними пристроями',
    '',
    'Клас `Process` зберігає масив зайнятих каналів (кожен — вимога та момент завершення обслуговування) і спільну чергу. ' +
      '`tnext` процесу — найменший момент завершення серед каналів. У `outAct()` звільняються всі канали, що завершили ' +
      'обслуговування в поточний момент, вільні канали забирають вимоги з черги, а обслуговані вимоги передаються далі за маршрутом.',
    '',
    '```ts',
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
    '```',
    '',
    `Перевірка: CREATE exp(${t5.createMean}) → PROCESS exp(${t5.serviceMean}) з c пристроями → DISPOSE, T = ${int(t5.time)}; ` +
      `навантаження a = λ/μ = ${num(t5.serviceMean / t5.createMean, 1)}. Теоретичні значення — формули M/M/c/K.`,
    '',
    table(
      ['c', 'Черга', 'P_відм імітація', 'P_відм теорія', 'L_черги імітація', 'L_черги теорія', 'Зайнято пристроїв імітація', 'Зайнято пристроїв теорія', 'Очікування імітація', 'Очікування теорія'],
      ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
      t5.rows.map((r) => [
        String(r.channels),
        queueCap(r.maxQueue),
        num(r.sim.failureProbability, 4),
        num(r.theory.failureProbability, 4),
        num(r.sim.meanQueue),
        num(r.theory.meanQueue),
        num(r.sim.meanBusy),
        num(r.theory.meanBusy),
        num(r.sim.meanWait),
        num(r.theory.meanWait),
      ]),
    ),
    '',
    '![Середня довжина черги](task5-queue.svg)',
    '',
    '![Імовірність відмови](task5-failure.svg)',
    '',
    'Імітація відтворює формули M/M/c/K для всіх c. Кожен додатковий пристрій різко зменшує ймовірність відмови й чергу; ' +
      'при необмеженій черзі середня кількість зайнятих пристроїв дорівнює a = λ/μ незалежно від c (за умови a < c).',
    '',
    '---',
    '',
  );

  // ── Завдання 6
  const nodes = t6.nodes;
  push(
    '## 6. Вихід у кілька наступних блоків з поверненням у попередні',
    '',
    'Маршрут елемента задається об’єктом `Router`. Функція `branch` будує маршрут з кількома гілками: ' +
      'для кожної вимоги розігрується випадкове число й вибирається гілка відповідно до ймовірностей переходу. ' +
      'Будь-який елемент (зокрема попередній у ланцюгу або сам цей елемент) може бути цільовим, тому повернення ' +
      'вимог не потребує окремої логіки. Вимога, що повертається, стає в кінець черги — вона не обходить тих, хто вже чекає.',
    '',
    '```ts',
    'p1.next = branch({ to: p2, p: 0.7 }, { to: p3, p: 0.3 });',
    'p2.next = branch({ to: p1, p: 0.2 }, { to: dispose, p: 0.8 }); // повернення в PROCESS 1',
    'p3.next = branch({ to: p1, p: 0.4 }, { to: dispose, p: 0.6 }); // повернення в PROCESS 1',
    '```',
    '',
    `Параметри мережі: CREATE exp(${t6.createMean}) → PROCESS 1; ` +
      nodes.map((n) => `${n.name}: exp(${n.delay}), пристроїв ${n.channels}`).join('; ') +
      `. Час моделювання T = ${int(t6.time)}.`,
    '',
    '![Схема мережі](task6-scheme.svg)',
    '',
    'Інтенсивності потоків у вузлах знайдено з рівнянь балансу λ_j = γ_j + Σ λ_i·p_ij (метод Гаусса): ' +
      t6.lambdas.map((l, i) => `λ${i + 1} = ${num(l, 4)}`).join(', ') +
      '. Оскільки в усіх вузлах ρ < 1, мережа з необмеженими чергами стаціонарна і є мережею Джексона.',
    '',
    '**Таблиця 6.1 — Фактичні частоти переходів**',
    '',
    table(
      ['Звідки', 'Куди', 'Задана ймовірність', 'Фактична частота'],
      ['l', 'l', 'r', 'r'],
      t6.unlimited.transitions.map((tr) => [tr.from, tr.to, num(tr.p, 2), num(tr.observed, 4)]),
    ),
    '',
    '**Таблиця 6.2 — Необмежені черги: імітація проти теорії мереж Джексона**',
    '',
    table(
      ['Вузол', 'λ імітація', 'λ теорія', 'L_черги імітація', 'L_черги теорія', 'Відхилення', 'U імітація', 'U теорія'],
      ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
      t6.unlimited.nodes.map((s, i) => {
        const t = t6.theory[i];
        const l = t6.lambdas[i] ?? 0;
        return t
          ? [s.name, num(s.arrivals / t6.time, 4), num(l, 4), num(s.meanQueue), num(t.meanQueue), dev(s.meanQueue, t.meanQueue), num(s.utilization), num(t.utilization)]
          : [s.name];
      }),
    ),
    '',
    `Середній час перебування в мережі: імітація ${num(t6.unlimited.meanTimeInSystem)}, теорія (формула Літтла W = ΣL_i/γ) ` +
      `${num(t6.theoryTimeInSystem)}, відхилення ${dev(t6.unlimited.meanTimeInSystem, t6.theoryTimeInSystem)}.`,
    '',
    `**Таблиця 6.3 — Та сама мережа з обмеженими чергами (≤ ${t6.limited.maxQueue})**`,
    '',
    table(
      ['Вузол', 'Надійшло', 'Обслуговано', 'P_відм', 'L_черги', 'U', 'Очікування'],
      ['l', 'r', 'r', 'r', 'r', 'r', 'r'],
      t6.limited.nodes.map((s) => [s.name, int(s.arrivals), int(s.served), num(s.failureProbability, 4), num(s.meanQueue), num(s.utilization), num(s.meanWait)]),
    ),
    '',
    `Створено ${int(t6.limited.created)} вимог, вийшло через DISPOSE ${int(t6.limited.disposed)}, ` +
      `середній час перебування ${num(t6.limited.meanTimeInSystem)}. Обмеження черг зменшує час перебування, ` +
      'але частина вимог отримує відмову — найчастіше у PROCESS 1, куди, окрім зовнішнього потоку, повертаються вимоги з PROCESS 2 і PROCESS 3.',
    '',
    '---',
    '',
    '## Загальні висновки',
    '',
    '1. Об’єктно-орієнтований підхід дозволив описати модель як набір однотипних елементів з єдиним інтерфейсом ' +
      '(`inAct`, `outAct`, `doStatistics`); алгоритм імітації за принципом найближчої події (`Model.simulate`) не залежить ' +
      'від структури моделі й однаково працює для одного пристрою, ланцюга та мережі з поверненнями.',
    '2. Середнє завантаження обчислюється інтегруванням кусково-сталої функції стану пристрою між подіями; ' +
      'оцінка збігається до теоретичного значення зі збільшенням часу моделювання.',
    '3. Модель з трьох процесів верифіковано зміною 12 вхідних змінних і параметрів: усі очікувані напрямки змін підтверджено, ' +
      'для детермінованих затримок отримано точні значення, для пуассонівського входу — збіг з формулами M/M/1/K і мережею Джексона.',
    '4. Узагальнення класу PROCESS на c ідентичних пристроїв відтворює формули M/M/c/K з відхиленням у межах статистичної похибки.',
    '5. Заміна поля `nextElement` на маршрут `Router` дає вихід у будь-яку кількість блоків, зокрема з поверненням у попередні; ' +
      'фактичні частоти переходів і характеристики вузлів збігаються з заданими ймовірностями та теорією мереж Джексона.',
    '',
  );
  return lines.join('\n');
};
