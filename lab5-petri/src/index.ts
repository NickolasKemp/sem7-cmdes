/**
 * Точка входу: будує мережі Петрі чотирьох задач, проводить імітацію, зберігає схеми, графіки та JSON
 * у каталог out/ і збирає звіт .docx та .pdf.
 */
import { $ } from 'bun';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { lineChart, PALETTE } from './charts.ts';
import { buildDocx } from './docx.ts';
import { busExperiment, CONVEYOR_RUN, conveyorExperiment, FMS_RUN, fmsExperiment, stockExperiment } from './experiments.ts';
import { num } from './format.ts';
import { BUSES, busNet, CONVEYOR, conveyorNet, fmsNet, STOCK, stockNet } from './nets.ts';
import { buildScheme, toDrawio, toSvg } from './schemes.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = `${ROOT}out/`;
const REPORT = 'Звіт_КП5_Туболев';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SOFFICE = '/opt/homebrew/bin/soffice';
const CHART = { width: 900, height: 500 } as const;
/** схема задачі 3 малюється для довільної кількості місць: на ній кратність дуг позначено «n» */
const SCHEME_SEATS = 20;

const save = async (name: string, content: string): Promise<void> => {
  await writeFile(`${OUT}${name}`, content, 'utf8');
  console.log(`  → out/${name}`);
};
const color = (i: number): string => PALETTE[i % PALETTE.length] ?? '#000';

const main = async (): Promise<void> => {
  await mkdir(OUT, { recursive: true });
  const figures: { name: string; width: number; height: number }[] = [];

  console.log('\n═══ Схеми мереж Петрі ═══\n');
  const schemes = [
    ['task1-conveyor', conveyorNet()],
    ['task2-fixed', fmsNet('fixed')],
    ['task2-nearest', fmsNet('nearest')],
    ['task3-buses', busNet(SCHEME_SEATS)],
    ['task4-stock', stockNet()],
  ] as const;
  for (const [name, model] of schemes) {
    const scheme = buildScheme(name, model.net, model.width, model.height);
    await save(`${name}.svg`, toSvg(scheme));
    await save(`${name}.drawio`, toDrawio(scheme));
    figures.push({ name, width: scheme.width, height: scheme.height });
  }
  const chart = async (name: string, svg: string): Promise<void> => {
    await save(`${name}.svg`, svg);
    figures.push({ name, ...CHART });
  };

  console.log('\n═══ Імітація ═══\n');
  const conveyor = conveyorExperiment();
  console.log(`конвеєр: час перебування ${num(conveyor.sojourn.mean, 2)} хв, зайнято ${num(conveyor.busy.mean, 2)} пристроїв`);
  const fms = fmsExperiment();
  for (const [a, rows] of Object.entries(fms)) {
    for (const { arrival, result } of rows) console.log(`ГВС ${a.padEnd(7)} a = ${arrival} с: ${num(result.perHour.mean, 1)} дет./год`);
  }
  const bus = busExperiment();
  for (const { seats, result } of bus) console.log(`автобуси n = ${String(seats).padStart(2)}: очікування ${num(result.wait.mean, 1)} хв, виручка ${num(result.revenue.mean, 0)} грн`);
  const stock = stockExperiment();
  console.log(`запаси: середній запас ${num(stock.result.stock.mean, 2)}, між втраченими продажами ${num(stock.result.betweenLost.mean, 2)} тиж.`);

  console.log('\n═══ Графіки ═══\n');
  const devices = Array.from({ length: CONVEYOR.devices }, (_, i) => i + 1);
  await chart(
    'task1-load',
    lineChart({
      title: 'Завантаження пристроїв конвеєра',
      subtitle: `4 деталі за хвилину, обробка exp(${CONVEYOR.service}); середнє за ${CONVEYOR_RUN.runs} прогонами`,
      xLabel: 'номер пристрою',
      yLabel: 'частка',
      xTicks: devices,
      series: [
        { label: 'завантаження пристрою', points: devices.map((i) => [i, conveyor[`load${i}` as keyof typeof conveyor].mean] as const), color: color(0), markers: true },
        { label: 'частка оброблених деталей', points: devices.map((i) => [i, conveyor[`share${i}` as keyof typeof conveyor].mean] as const), color: color(1), markers: true },
      ],
    }),
  );
  const levels = Array.from({ length: CONVEYOR.devices + 1 }, (_, k) => k);
  await chart(
    'task1-busy',
    lineChart({
      title: 'Розподіл кількості зайнятих пристроїв',
      subtitle: `частка часу, протягом якої зайнято k пристроїв; середнє ${num(conveyor.busy.mean, 2)}`,
      xLabel: 'кількість зайнятих пристроїв k',
      yLabel: 'частка часу',
      xTicks: levels,
      series: [{ label: 'імітація', points: levels.map((k) => [k, conveyor[`busy${k}` as keyof typeof conveyor].mean] as const), color: color(0), markers: true }],
    }),
  );
  const variants = [
    ['fixed', 'варіант 1: робот на кожному шляху'],
    ['nearest', 'варіант 2: найближчий вільний робот'],
  ] as const;
  await chart(
    'task2-throughput',
    lineChart({
      title: 'Пропускна здатність гнучкої виробничої системи',
      subtitle: 'деталей за годину, що надійшли на склад; пунктир — інтенсивність надходження деталей',
      xLabel: 'середній інтервал надходження деталей, с',
      yLabel: 'деталей за годину',
      xTicks: [...FMS_RUN.arrivals].reverse(),
      series: [
        { label: 'надходження', points: FMS_RUN.arrivals.map((a) => [a, 3600 / a] as const), color: color(4), dashed: true },
        ...variants.map(([v, l], i) => ({ label: l, points: fms[v].map((r) => [r.arrival, r.result.perHour.mean] as const), color: color(i), markers: true })),
      ],
    }),
  );
  await chart(
    'task2-occupied',
    lineChart({
      title: 'Зайнятість місць на верстаті 2',
      subtitle: 'частка часу, протягом якої місце зайняте: деталь везуть, обробляють або вона чекає на робота',
      xLabel: 'середній інтервал надходження деталей, с',
      yLabel: 'частка',
      xTicks: [...FMS_RUN.arrivals].reverse(),
      series: variants.flatMap(([v, l], i) => [
        { label: `${l}, місця`, points: fms[v].map((r) => [r.arrival, r.result.occupied2.mean] as const), color: color(i), markers: true },
        { label: 'обробка', points: fms[v].map((r) => [r.arrival, r.result.machine2.mean] as const), color: color(i), dashed: true },
      ]),
    }),
  );
  await chart(
    'task3-wait',
    lineChart({
      title: 'Середній час очікування пасажира в черзі',
      subtitle: `робочий день ${BUSES.day / 60} годин, черга не більше ${BUSES.queueLimit} осіб`,
      xLabel: 'кількість місць у мікроавтобусі n',
      yLabel: 'хвилин',
      xTicks: [5, 10, 15, 20, 25],
      series: [{ label: 'імітація', points: bus.map((b) => [b.seats, b.result.wait.mean] as const), color: color(0), markers: true }],
    }),
  );
  await chart(
    'task3-revenue',
    lineChart({
      title: 'Виручка автопідприємства за день',
      subtitle: `плата за проїзд ${BUSES.fare} грн; недоотримана виручка — пасажири, що пішли на інший маршрут`,
      xLabel: 'кількість місць у мікроавтобусі n',
      yLabel: 'гривень за день',
      xTicks: [5, 10, 15, 20, 25],
      series: [
        { label: 'виручка', points: bus.map((b) => [b.seats, b.result.revenue.mean] as const), color: color(2), markers: true },
        { label: 'недоотримано', points: bus.map((b) => [b.seats, b.result.lostRevenue.mean] as const), color: color(1), markers: true },
      ],
    }),
  );
  await chart(
    'task4-trace',
    lineChart({
      title: 'Стан запасу холодильників протягом двох років',
      subtitle: `перегляд кожні ${STOCK.review} тижні, точка замовлення ${STOCK.reorder}, контрольний рівень ${STOCK.level}, доставка ${STOCK.lead} тижні`,
      xLabel: 'час, тижнів',
      yLabel: 'холодильників',
      xTicks: [0, 13, 26, 39, 52, 65, 78, 91, 104],
      series: [
        { label: 'наявний запас', points: stock.trace.map(([t, s]) => [t, s] as const), color: color(0), step: true },
        { label: 'поточний стан запасу з урахуванням замовлень', points: stock.trace.map(([t, , p]) => [t, p] as const), color: color(1), step: true, dashed: true },
      ],
    }),
  );

  await save('results.json', JSON.stringify({ conveyor, fms, bus, stock: stock.result }, null, 2));

  // растрові копії схем і графіків для Word: SVG рендериться headless Chrome у PNG
  if (!existsSync(CHROME)) {
    console.log('  (Google Chrome не знайдено — звіт не зібрано: потрібні PNG-версії рисунків)');
    return;
  }
  const profile = `${OUT}.chrome`;
  for (const f of figures) {
    await $`${CHROME} --headless=new --disable-gpu --hide-scrollbars --user-data-dir=${profile} --force-device-scale-factor=2 --window-size=${f.width},${f.height} --screenshot=${OUT}${f.name}.png file://${OUT}${f.name}.svg`.quiet();
  }
  await $`rm -rf ${profile}`.quiet();
  await writeFile(`${ROOT}${REPORT}.docx`, await buildDocx({ conveyor, fms, bus, stock }, (name) => `${OUT}${name}.png`));
  console.log(`  → ${REPORT}.docx`);
  if (existsSync(SOFFICE)) {
    await $`${SOFFICE} --headless --convert-to pdf --outdir ${ROOT} ${ROOT}${REPORT}.docx`.quiet();
    console.log(`  → ${REPORT}.pdf`);
  } else {
    console.log('  (LibreOffice не знайдено — .pdf не зібрано)');
  }
  console.log('\nГотово.\n');
};

await main();
