/**
 * Точка входу: виконує три завдання практикуму, друкує стислі результати в консоль,
 * зберігає схеми, графіки та JSON у каталог out/ і збирає звіт .docx та .pdf.
 */
import { $ } from 'bun';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { lineChart, PALETTE } from './charts.ts';
import { buildDocx } from './docx.ts';
import { num, pm } from './format.ts';
import { SCHEMES, toDrawio, toSvg } from './schemes.ts';
import { BANK, runTask1, runTask2, runTask3 } from './tasks.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = `${ROOT}out/`;
const REPORT = 'Звіт_КП3_Туболев';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SOFFICE = '/opt/homebrew/bin/soffice';
const CHART = { width: 900, height: 500 } as const;

const save = async (name: string, content: string): Promise<void> => {
  await writeFile(`${OUT}${name}`, content, 'utf8');
  console.log(`  → out/${name}`);
};

const color = (i: number): string => PALETTE[i % PALETTE.length] ?? '#000';

const main = async (): Promise<void> => {
  await mkdir(OUT, { recursive: true });
  const figures: { name: string; width: number; height: number }[] = [];

  console.log('\n═══ Схеми мереж ═══\n');
  for (const build of SCHEMES) {
    const scheme = build();
    await save(`${scheme.name}.svg`, toSvg(scheme));
    await save(`${scheme.name}.drawio`, toDrawio(scheme));
    figures.push({ name: scheme.name, width: scheme.width, height: scheme.height });
  }
  const chart = async (name: string, svg: string): Promise<void> => {
    await save(`${name}.svg`, svg);
    figures.push({ name, ...CHART });
  };

  console.log('\n═══ Завдання 1: універсальний алгоритм ═══\n');
  const t1 = runTask1();
  for (const [i, s] of t1.jackson.nodes.entries()) {
    const t = t1.jackson.theory[i];
    console.log(`${s.name}: L = ${num(s.meanQueue)} (теорія ${num(t?.meanQueue ?? 0)}), U = ${num(s.utilization)} (теорія ${num(t?.utilization ?? 0)})`);
  }
  console.log(`W = ${num(t1.jackson.meanTimeInSystem)} (теорія ${num(t1.jackson.theoryTimeInSystem)})`);
  for (const v of t1.reserve) console.log(`${v.label}: P_відм = ${num(v.failureProbability, 4)}, частки ${v.share.map((x) => num(x, 3)).join(' / ')}`);

  console.log('\n═══ Завдання 2: банк ═══\n');
  const t2 = runTask2();
  const e2 = t2.estimates;
  console.log(`U = ${pm(e2.u1)} / ${pm(e2.u2)}, у банку ${pm(e2.inBank)}, W = ${pm(e2.timeInBank)}`);
  console.log(`черги ${pm(e2.q1, 4)} / ${pm(e2.q2, 4)}, відмов ${pm(e2.lostShare, 3, 100)} %, змін смуги ${pm(e2.changes, 1)}`);
  await chart(
    'task2-queues',
    lineChart({
      title: 'Довжини черг під’їзних смуг на початку імітації',
      subtitle: 'початковий стан: обидва касири зайняті, у кожній черзі по 2 автомобілі; перший прогін',
      xLabel: 'модельний час t',
      yLabel: 'довжина черги',
      xTicks: [0, 4, 8, 12, 16, 20],
      series: [0, 1].map((i) => ({
        label: `черга ${i + 1}`,
        points: [...t2.path.map((p) => [p.t, p.queues[i] ?? 0] as const), [20, t2.path[t2.path.length - 1]?.queues[i] ?? 0] as const],
        color: color(i),
        step: true,
      })),
    }),
  );
  const intensity = t2.sweep.map((s) => 1 / s.arrivalMean);
  await chart(
    'task2-load',
    lineChart({
      title: 'Частка відмов і завантаження касирів',
      subtitle: `середнє за 10 прогонів по T = ${BANK.time}; пунктир — СМО M/M/2/8 зі спільною чергою`,
      xLabel: 'інтенсивність надходження λ = 1 / t_надх',
      yLabel: 'частка',
      xTicks: [2, 4, 6, 8, 10],
      series: [
        { label: 'відмови M/M/2/8', points: t2.sweep.map((s, i) => [intensity[i] ?? 0, s.reference.failureProbability]), color: color(1), dashed: true },
        { label: 'відмови, імітація', points: t2.sweep.map((s, i) => [intensity[i] ?? 0, s.lostShare.mean]), color: color(1), markersOnly: true },
        { label: 'завантаження M/M/2/8', points: t2.sweep.map((s, i) => [intensity[i] ?? 0, s.reference.utilization]), color: color(0), dashed: true },
        { label: 'завантаження, імітація', points: t2.sweep.map((s, i) => [intensity[i] ?? 0, (s.u1.mean + s.u2.mean) / 2]), color: color(0), markersOnly: true },
      ],
    }),
  );

  console.log('\n═══ Завдання 3: лікарня ═══\n');
  const t3 = runTask3();
  const e3 = t3.estimates;
  console.log(`час у системі: тип 1 ${pm(e3.time1, 1)}, тип 2 ${pm(e3.time2, 1)}, тип 3 ${pm(e3.time3, 1)} хв`);
  console.log(`інтервал між прибуттями в лабораторію ${pm(e3.labInterval, 2)} хв (теорія ${num(t3.theory.labInterval, 1)})`);
  const width = t3.histogramTop / t3.histogramBins;
  await chart(
    'task3-sojourn',
    lineChart({
      title: 'Розподіл часу перебування хворих у системі',
      subtitle: `полігони частот, крок ${width} хв; ${t3.timeSummary.reduce((a, s) => a + s.count, 0)} хворих за ${t3.timeSummary.length} типами, 20 прогонів`,
      xLabel: 'час перебування, хв',
      yLabel: 'відносна частота',
      xTicks: [0, 50, 100, 150, 200, 250, 300, 350, 400],
      series: t3.timeSummary.map((s, i) => ({
        label: `тип ${s.type} (середнє ${num(s.mean, 1)} хв)`,
        points: s.histogram.map((f, k) => [(k + 0.5) * width, f] as const),
        color: color(i),
        markers: true,
      })),
    }),
  );

  // Infinity у JSON не існує — записуємо його рядком
  const json = JSON.stringify(
    { task1: t1, task2: { ...t2, path: undefined }, task3: { ...t3, first: t3.first && { ...t3.first, times: undefined } } },
    (_key, value: unknown) => (value === Infinity ? 'Infinity' : value),
    2,
  );
  await save('results.json', json);

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
  await writeFile(`${ROOT}${REPORT}.docx`, await buildDocx({ t1, t2, t3 }, (name) => `${OUT}${name}.png`));
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
