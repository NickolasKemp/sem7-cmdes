/**
 * Точка входу: експериментальна і теоретична оцінка складності алгоритму імітації для послідовної
 * та розгалужених мереж; зберігає схеми, графіки та JSON у каталог out/ і збирає звіт .docx та .pdf.
 */
import { $ } from 'bun';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { lineChart, PALETTE } from './charts.ts';
import { fitCostModel, growthExponent, predictMs, theoreticalOps } from './complexity.ts';
import { buildDocx } from './docx.ts';
import { EXPERIMENT, runExperiments, type Measurement } from './experiments.ts';
import { num } from './format.ts';
import { STRUCTURE_INFO, STRUCTURES, type Structure } from './networks.ts';
import { SCHEMES, toDrawio, toSvg } from './schemes.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = `${ROOT}out/`;
const REPORT = 'Звіт_КП4_Туболев';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SOFFICE = '/opt/homebrew/bin/soffice';
const CHART = { width: 900, height: 500 } as const;
const N_TICKS = [0, 100, 200, 300, 400, 500];

const save = async (name: string, content: string): Promise<void> => {
  await writeFile(`${OUT}${name}`, content, 'utf8');
  console.log(`  → out/${name}`);
};

const color = (i: number): string => PALETTE[i % PALETTE.length] ?? '#000';
const colorOf = (s: Structure): string => color(STRUCTURES.indexOf(s));

/** Точки «кількість подій N + 1 → значення». */
const byEvents = (ms: readonly Measurement[], value: (m: Measurement) => number) => ms.map((m) => [m.n + 1, value(m)] as const);

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

  console.log('\n═══ Досліди ═══\n');
  const series = runExperiments((m) =>
    console.log(`${m.structure.padEnd(8)} N = ${String(m.n).padStart(3)}  λ = ${m.lambda}  T = ${m.time}  подій ${m.steps}  ${num(m.ms, 1)} мс`),
  );
  const all = [...Object.values(series.branched).flat(), ...series.byTime, ...series.byLambda];
  const fit = fitCostModel(all);
  console.log(`\nα = ${num(fit.alpha, 2)} нс, β = ${num(fit.beta, 1)} нс, γ = ${num(fit.gamma, 0)} нс, R² = ${num(fit.r2, 4)}`);
  const exponent = (s: Structure): number => growthExponent(series.branched[s].filter((m) => m.n >= 100).map((m) => [m.n, m.ms]));
  const exponents: Record<Structure, number> = {
    serial: exponent('serial'),
    fan: exponent('fan'),
    tree: exponent('tree'),
    skip: exponent('skip'),
    feedback: exponent('feedback'),
  };
  for (const s of STRUCTURES) console.log(`${STRUCTURE_INFO[s].short}: t ~ N^${num(exponents[s], 2)}`);

  const predicted = (s: Structure) =>
    Array.from({ length: 21 }, (_, i) => Math.max(1, i * 25)).map((n) => [n + 1, predictMs(fit, theoreticalOps(s, n, 1, EXPERIMENT.time))] as const);

  console.log('\n═══ Графіки ═══\n');
  await chart(
    'task2-time-n',
    lineChart({
      title: 'Час обчислення алгоритму імітації: послідовна мережа',
      subtitle: `λ = 1, T = ${EXPERIMENT.time}, найменший час з ${EXPERIMENT.repeats} повторів; пунктир — теоретична оцінка`,
      xLabel: 'кількість подій у моделі N + 1',
      yLabel: 'час обчислення, мс',
      xTicks: N_TICKS,
      series: [
        { label: 'теоретична оцінка O = ν·T·k', points: predicted('serial'), color: color(0), dashed: true },
        { label: 'експеримент', points: byEvents(series.serial, (m) => m.ms), color: color(0), markersOnly: true },
      ],
    }),
  );
  await chart(
    'task2-time-events',
    lineChart({
      title: 'Час обчислення від кількості оброблених подій ν·T',
      subtitle: `послідовна мережа, N = ${EXPERIMENT.fixedN}; змінюється T (λ = 1) або λ (T = ${EXPERIMENT.time})`,
      xLabel: 'кількість подій за інтервал моделювання, тис.',
      yLabel: 'час обчислення, мс',
      series: [
        { label: 'змінюється час моделювання T', points: series.byTime.map((m) => [m.steps / 1000, m.ms] as const), color: color(0), markers: true },
        { label: 'змінюється інтенсивність λ', points: series.byLambda.map((m) => [m.steps / 1000, m.ms] as const), color: color(1), markers: true },
      ],
    }),
  );
  await chart(
    'task3-event-cost',
    lineChart({
      title: 'Середній час обробки однієї події',
      subtitle: 'час обчислення / кількість подій; пунктир — k(N) = 4·(N + 2)·α + β + γ',
      xLabel: 'кількість подій у моделі N + 1',
      yLabel: 'мкс на подію',
      xTicks: N_TICKS,
      series: [
        {
          label: 'теоретична оцінка',
          points: series.serial.map((m) => [m.n + 1, (4 * (m.n + 2) * fit.alpha + fit.beta + fit.gamma) / 1000] as const),
          color: color(0),
          dashed: true,
        },
        { label: 'експеримент', points: byEvents(series.serial, (m) => (m.ms * 1000) / m.steps), color: color(0), markersOnly: true },
      ],
    }),
  );
  await chart(
    'task4-time',
    lineChart({
      title: 'Час обчислення для мереж різної структури',
      subtitle: `λ = 1, T = ${EXPERIMENT.time}; однакова кількість подій N + 1 у моделі`,
      xLabel: 'кількість подій у моделі N + 1',
      yLabel: 'час обчислення, мс',
      xTicks: N_TICKS,
      series: STRUCTURES.map((s) => ({ label: STRUCTURE_INFO[s].short, points: byEvents(series.branched[s], (m) => m.ms), color: colorOf(s), markers: true })),
    }),
  );
  const light: readonly Structure[] = ['fan', 'tree'];
  await chart(
    'task4-time-light',
    lineChart({
      title: 'Час обчислення для мереж з паралельними гілками',
      subtitle: 'точки — експеримент, пунктир — теоретична оцінка з тими самими коефіцієнтами α, β, γ',
      xLabel: 'кількість подій у моделі N + 1',
      yLabel: 'час обчислення, мс',
      xTicks: N_TICKS,
      series: light.flatMap((s) => [
        { label: `${STRUCTURE_INFO[s].short}, теорія`, points: predicted(s), color: colorOf(s), dashed: true },
        { label: `${STRUCTURE_INFO[s].short}, експеримент`, points: byEvents(series.branched[s], (m) => m.ms), color: colorOf(s), markersOnly: true },
      ]),
    }),
  );
  await chart(
    'task4-event-cost',
    lineChart({
      title: 'Середній час обробки однієї події для мереж різної структури',
      subtitle: 'час обчислення / кількість подій',
      xLabel: 'кількість подій у моделі N + 1',
      yLabel: 'мкс на подію',
      xTicks: N_TICKS,
      series: STRUCTURES.map((s) => ({
        label: STRUCTURE_INFO[s].short,
        points: byEvents(series.branched[s], (m) => (m.ms * 1000) / m.steps),
        color: colorOf(s),
        markers: true,
      })),
    }),
  );

  await save('results.json', JSON.stringify({ experiment: EXPERIMENT, fit, exponents, series }, null, 2));

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
  await writeFile(`${ROOT}${REPORT}.docx`, await buildDocx({ series, fit, exponents }, (name) => `${OUT}${name}.png`));
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
