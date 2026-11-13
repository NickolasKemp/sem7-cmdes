/**
 * Точка входу: запускає Java-частину (пакети файлів мереж і досліди на PetriSim), будує графіки і збирає звіт
 * .docx та .pdf, а також сторінку-симулятор explorer.html. З прапорцем --report досліди не повторюються: звіт збирається з наявного out/results.json.
 */
import { $ } from 'bun';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { lineChart, PALETTE } from './charts.ts';
import { at, load } from './data.ts';
import { buildDocx } from './docx.ts';
import { num } from './format.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = `${ROOT}out/`;
const REPORT = 'Звіт_КП6_Туболев';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SOFFICE = '/opt/homebrew/bin/soffice';
const CHART = { width: 900, height: 500 } as const;

const color = (i: number): string => PALETTE[i % PALETTE.length] ?? '#000';

const main = async (): Promise<void> => {
  await mkdir(OUT, { recursive: true });
  const reportOnly = process.argv.includes('--report');

  console.log('\n═══ Пакети файлів мереж Петрі ═══\n');
  await $`${ROOT}run-java.sh package`;
  if (!reportOnly) {
    console.log('\n═══ Імітація на PetriSim ═══\n');
    await $`${ROOT}run-java.sh simulate`;
  }
  const { results, nets, lab5 } = await load(ROOT);
  const { conveyor, stock, web } = results;
  console.log(`конвеєр: час перебування ${num(at(conveyor.base, 'sojourn').mean, 2)} хв`);
  console.log(`запаси: середній запас ${num(at(stock.base, 'stock').mean, 2)}`);
  console.log(`сервери: час обробки запиту ${num(at(web.base, 'time').mean, 2)} мс`);

  // сторінка-симулятор малює і виконує ті самі мережі: їхня структура вбудовується в шаблон
  const template = await readFile(`${ROOT}src/explorer.template.html`, 'utf8');
  await writeFile(`${ROOT}explorer.html`, template.replace('/*NETS*/null', await readFile(`${OUT}nets.json`, 'utf8')), 'utf8');
  console.log('  → explorer.html');

  console.log('\n═══ Графіки ═══\n');
  const charts: string[] = [];
  const chart = async (name: string, svg: string): Promise<void> => {
    await writeFile(`${OUT}${name}.svg`, svg, 'utf8');
    charts.push(name);
    console.log(`  → out/${name}.svg`);
  };
  const devices = [1, 2, 3, 4, 5];
  await chart(
    'task1-load',
    lineChart({
      title: 'Завантаження пристроїв конвеєра',
      subtitle: 'модель на PetriSim (Java) і власний алгоритм практикуму 5 (TypeScript)',
      xLabel: 'номер пристрою',
      yLabel: 'частка часу',
      xTicks: devices,
      series: [
        { label: 'PetriSim', points: devices.map((i) => [i, at(conveyor.base, `load${i}`).mean] as const), color: color(0), markers: true },
        { label: 'практикум 5', points: devices.map((i) => [i, at(lab5.conveyor, `load${i}`).mean] as const), color: color(1), markersOnly: true },
      ],
    }),
  );
  await chart(
    'task2-trace',
    lineChart({
      title: 'Стан запасу холодильників протягом двох років',
      subtitle: 'перегляд кожні 4 тижні, точка замовлення 18, контрольний рівень 72, доставка 3 тижні',
      xLabel: 'час, тижнів',
      yLabel: 'холодильників',
      xTicks: [0, 13, 26, 39, 52, 65, 78, 91, 104],
      series: [
        { label: 'наявний запас', points: stock.trace.map(([t, s]) => [t, s] as const), color: color(0), step: true },
        { label: 'поточний стан запасу з урахуванням замовлень', points: stock.trace.map(([t, , p]) => [t, p] as const), color: color(1), step: true, dashed: true },
      ],
    }),
  );
  const perSecond = (a: number): number => 1000 / a;
  const stable = web.load.filter((r) => at(r.result, 'rejected').mean === 0 && at(r.result, 'queue').mean < 100);
  await chart(
    'task3-time',
    lineChart({
      title: 'Середній час обробки запиту',
      subtitle: 'сталий режим без відхилених запитів; від надходження до повернення відповіді',
      xLabel: 'інтенсивність надходження, запитів за секунду',
      yLabel: 'мілісекунд',
      xTicks: stable.map((r) => Math.round(perSecond(r.arrival))),
      series: (
        [
          ['допоміжний сервер', 'time2'],
          ['у середньому', 'time'],
          ['головний сервер', 'time1'],
        ] as const
      ).map(([label, key], i) => ({ label, points: stable.map((r) => [perSecond(r.arrival), at(r.result, key).mean] as const), color: color(i), markers: true })),
    }),
  );
  await chart(
    'task3-reject',
    lineChart({
      title: 'Оброблені та відхилені запити',
      subtitle: `черга обмежена ${web.parameters.queueLimit} запитами; пунктир — інтенсивність надходження`,
      xLabel: 'інтенсивність надходження, запитів за секунду',
      yLabel: 'запитів за секунду',
      xTicks: [250, 400, 500, 625, 714, 833, 1000],
      series: [
        { label: 'надходить', points: web.load.map((r) => [perSecond(r.arrival), perSecond(r.arrival)] as const), color: color(4), dashed: true },
        { label: 'оброблено', points: web.load.map((r) => [perSecond(r.arrival), at(r.result, 'throughput').mean * 1000] as const), color: color(2), markers: true },
        {
          label: 'відхилено',
          points: web.load.map((r) => [perSecond(r.arrival), at(r.result, 'rejected').mean * perSecond(r.arrival)] as const),
          color: color(1),
          markers: true,
        },
      ],
    }),
  );

  // растрові копії графіків для Word: SVG рендериться headless Chrome у PNG
  if (!existsSync(CHROME)) {
    console.log('  (Google Chrome не знайдено — звіт не зібрано: потрібні PNG-версії графіків)');
    return;
  }
  const profile = `${OUT}.chrome`;
  for (const name of charts) {
    await $`${CHROME} --headless=new --disable-gpu --hide-scrollbars --user-data-dir=${profile} --force-device-scale-factor=2 --window-size=${CHART.width},${CHART.height} --screenshot=${OUT}${name}.png file://${OUT}${name}.svg`.quiet();
  }
  await $`rm -rf ${profile}`.quiet();

  const docx = await buildDocx({
    results,
    nets,
    lab5,
    pack: (folder, file) => `${ROOT}package/${folder}/${file}`,
    chart: (name) => `${OUT}${name}.png`,
  });
  await writeFile(`${ROOT}${REPORT}.docx`, docx);
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
