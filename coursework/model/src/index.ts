/**
 * Повний прогін: схема мережі, перехідний період, кількість прогонів, верифікація, перебір кількості смуг
 * і пробний запуск за іншої інтенсивності надходження.
 * Результати — у out/: results.json, схема (.svg, .png, .drawio) і графіки (.svg, .png).
 */
import { $ } from 'bun';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { BASE, buildAirport, MAX_EXTRA_RUNWAYS } from './airport.ts';
import { lineChart, PALETTE, type Series } from './charts.ts';
import { payback, RUN, runsNeeded, sensitivity, transient, TRANSIENT, verify } from './experiments.ts';
import { buildScheme, toDrawio, toSvg } from './schemes.ts';

const OUT = `${import.meta.dir}/../out/`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MLN = 1_000_000;
/** за меншої кількості смуг загальний прибуток близький до нуля або від’ємний, і T затуляє решту графіка */
const TOTAL_FROM = 5;

const color = (i: number): string => PALETTE[i % PALETTE.length] ?? '#000000';
const figures: { name: string; width: number; height: number }[] = [];

const save = async (name: string, content: string): Promise<void> => {
  await writeFile(`${OUT}${name}`, content);
  console.log(`  → out/${name}`);
};

const chart = async (name: string, svg: string): Promise<void> => {
  figures.push({ name, width: 900, height: 500 });
  await save(`${name}.svg`, svg);
};

const main = async (): Promise<void> => {
  await mkdir(OUT, { recursive: true });
  const started = performance.now();

  console.log('Схема мережі');
  const scheme = buildScheme('airport', buildAirport(BASE).net, 1180, 660);
  figures.push({ name: 'airport', width: scheme.width, height: scheme.height });
  await save('airport.svg', toSvg(scheme));
  await save('airport.drawio', toDrawio(scheme));

  console.log('Перехідний період');
  const transients = [BASE.runways, 7].map(transient);
  for (const t of transients) {
    await chart(
      `transient-${t.runways}`,
      lineChart({
        title: `Оцінка річного прибутку за інтервал [0; t], n = ${t.runways}`,
        subtitle: `${TRANSIENT.runs} прогони; після ${t.settled}-ї доби оцінки відрізняються менше ніж на ${TRANSIENT.epsilon * 100} %`,
        xLabel: 't, діб',
        xTicks: [1, 20, 40, 60, 80, 100, 120],
        yLabel: 'прибуток, млн грн / рік',
        series: t.cumulative.map((c, i) => ({ label: `прогін ${i + 1}`, points: c.map(([d, y]) => [d, y / MLN] as const), color: color(i) })),
      }),
    );
  }
  await chart(
    'transient-hourly',
    lineChart({
      title: 'Прибуток за кожну годину перших двох діб',
      subtitle: `середнє за ${TRANSIENT.runs} прогонами; розгін ${RUN.warmup / 60} год відкидає нетиповий початок`,
      xLabel: 'година моделювання',
      xTicks: [1, 6, 12, 18, 24, 30, 36, 42, 48],
      yLabel: 'прибуток за годину, тис. грн',
      series: transients.map((t, i) => ({ label: `n = ${t.runways}`, points: t.hourly.map(([h, y]) => [h, y / 1000] as const), color: color(i) })),
    }),
  );

  console.log('Кількість прогонів');
  const needed = Array.from({ length: MAX_EXTRA_RUNWAYS + 1 }, (_, k) => runsNeeded(BASE.runways + k));
  const runs = Math.max(...needed.map((r) => r.needed));
  console.log(`  потрібно ${runs} прогонів`);

  console.log('Верифікація');
  const verification = verify();

  console.log(`Перебір 0…${MAX_EXTRA_RUNWAYS} додаткових смуг, ${runs} прогонів кожен`);
  const results = payback(runs);
  const best = (key: 'paybackGain' | 'paybackTotal') => {
    const mean = (r: (typeof results)[number]): number => r[key]?.mean ?? Infinity;
    return results.reduce((b, r) => (mean(r) < mean(b) ? r : b));
  };
  const bestGain = best('paybackGain');
  const bestTotal = best('paybackTotal');
  console.log(`  найкоротша окупність: +${bestGain?.extra} смуг (додатковий прибуток), +${bestTotal?.extra} смуг (загальний прибуток)`);

  const byRunways = (f: (r: (typeof results)[number]) => number | undefined): (readonly [number, number])[] =>
    results.flatMap((r) => {
      const y = f(r);
      return y === undefined ? [] : [[r.runways, y] as const];
    });
  const xTicks = results.map((r) => r.runways);
  await chart(
    'profit',
    lineChart({
      title: 'Річний прибуток аеропорту залежно від кількості смуг',
      subtitle: `середнє за ${runs} прогонами по 365 діб`,
      xLabel: 'кількість посадкових смуг n',
      yLabel: 'прибуток, млн грн / рік',
      xTicks,
      series: [
        { label: 'прибуток', points: byRunways((r) => r.profit.mean / MLN), color: color(0), markers: true },
        { label: 'додатковий прибуток порівняно з n = 2', points: byRunways((r) => r.gain.mean / MLN), color: color(1), markers: true, dashed: true },
      ],
    }),
  );
  const paybackSeries: Series[] = [
    { label: 'p — додатковий прибуток', points: byRunways((r) => r.paybackGain && r.paybackGain.mean * 12), color: color(0), markers: true },
    { label: 'p — загальний прибуток', points: byRunways((r) => (r.runways >= TOTAL_FROM ? r.paybackTotal && r.paybackTotal.mean * 12 : undefined)), color: color(1), markers: true, dashed: true },
  ];
  const nearZero = results.find((r) => r.runways === TOTAL_FROM - 1)?.paybackTotal;
  await chart(
    'payback',
    lineChart({
      title: 'Час окупності додаткових смуг T = S / p',
      subtitle: `S = ${BASE.runwayCost / MLN} млн грн за смугу; для загального прибутку за n = ${TOTAL_FROM - 1} T = ${nearZero ? (nearZero.mean * 12).toFixed(1).replace('.', ',') : '—'} міс., за n < ${TOTAL_FROM - 1} p ≤ 0`,
      xLabel: 'кількість посадкових смуг n',
      yLabel: 'T, місяців',
      xTicks,
      series: paybackSeries,
    }),
  );
  await chart(
    'outcomes',
    lineChart({
      title: 'Що відбувається з літаками залежно від кількості смуг',
      subtitle: 'частка від кількості літаків, що прибули',
      xLabel: 'кількість посадкових смуг n',
      yLabel: 'частка, %',
      xTicks,
      series: [
        { label: 'відлетіли в інший аеропорт', points: byRunways((r) => (100 * r.left.mean) / r.arrived.mean), color: color(1), markers: true },
        { label: 'дозаправлялися', points: byRunways((r) => (100 * r.refuelled.mean) / r.arrived.mean), color: color(2), markers: true, dashed: true },
      ],
    }),
  );

  console.log(`Пробний запуск: інша інтенсивність надходження, ${runs} прогонів`);
  const trials = sensitivity(runs);
  const paybackMonths = (rs: typeof results): (readonly [number, number])[] =>
    rs.flatMap((r) => (r.paybackGain ? [[r.runways, r.paybackGain.mean * 12] as const] : []));
  await chart(
    'sensitivity',
    lineChart({
      title: 'Час окупності додаткових смуг за різної інтенсивності надходження',
      subtitle: `p — додатковий прибуток порівняно з n = ${BASE.runways}; середнє за ${runs} прогонами по 365 діб`,
      xLabel: 'кількість посадкових смуг n',
      yLabel: 'T, місяців',
      xTicks,
      series: [
        ...trials.map((s, i) => ({ label: `${s.perHour} літаків / год`, points: paybackMonths(s.payback), color: color(i + 1), markers: true, dashed: true })),
        { label: `${60 / BASE.arrivalMean} літаків / год (завдання)`, points: paybackMonths(results), color: color(0), markers: true },
      ],
    }),
  );

  await save(
    'results.json',
    JSON.stringify({ run: RUN, transients, needed, runs, verification, payback: results, best: { gain: bestGain?.extra, total: bestTotal?.extra }, sensitivity: trials }, null, 2),
  );

  if (!existsSync(CHROME)) {
    console.log('  (Google Chrome не знайдено — PNG-версії рисунків не зібрано)');
  } else {
    const profile = `${OUT}.chrome`;
    for (const f of figures) {
      await $`${CHROME} --headless=new --disable-gpu --hide-scrollbars --user-data-dir=${profile} --force-device-scale-factor=2 --window-size=${f.width},${f.height} --screenshot=${OUT}${f.name}.png file://${OUT}${f.name}.svg`.quiet();
    }
    await $`rm -rf ${profile}`.quiet();
    console.log(`  → ${figures.length} PNG`);
  }
  console.log(`\nГотово за ${Math.round((performance.now() - started) / 1000)} с.\n`);
};

await main();
