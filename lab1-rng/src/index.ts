/**
 * Точка входу: виконує всі три завдання практикуму,
 * друкує стислі результати в консоль і зберігає звіт, графіки та JSON у каталог out/.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { histogramChart, lineChart, overlayHistogramChart, scatterChart } from './charts.ts';
import { buildReport } from './report.ts';
import { histogram, quantile } from './stats.ts';
import { exponentialPdf, runTask1 } from './task1.ts';
import { runTask2 } from './task2.ts';
import { runTask3 } from './task3.ts';

const OUT = new URL('../out/', import.meta.url).pathname;

const n3 = (x: number): string => x.toFixed(3);

const save = async (name: string, content: string): Promise<void> => {
  await writeFile(`${OUT}${name}`, content, 'utf8');
  console.log(`  → out/${name}`);
};

const main = async (): Promise<void> => {
  await mkdir(OUT, { recursive: true });

  console.log('\n═══ Завдання 1: x = −(1/λ)·ln(ξ), перевірка на експоненційний закон ═══\n');
  const t1 = runTask1();
  for (const e of t1.experiments) {
    console.log(
      `λ=${e.lambda} [${e.source}]: x̄=${n3(e.summary.mean)} (теор. ${n3(e.theoretical.mean)}), ` +
        `S²=${n3(e.summary.variance)} (теор. ${n3(e.theoretical.variance)}), ` +
        `χ²=${n3(e.testTrue.statistic)} проти χ²кр=${n3(e.testTrue.critical)} → ` +
        `${e.testTrue.accepted ? 'ПРИЙНЯТО' : 'ВІДХИЛЕНО'}; ` +
        `контроль (λ·1,15): χ²=${n3(e.testWrong.statistic)} → ${e.testWrong.accepted ? 'ПРИЙНЯТО' : 'ВІДХИЛЕНО'}`,
    );
    await save(
      `task1-lambda-${String(e.lambda).replace('.', '_')}-${e.source.startsWith('вбудований') ? 'builtin' : 'lcg'}.svg`,
      histogramChart({
        title: `Гістограма частот: x = −(1/λ)·ln(ξ), λ = ${e.lambda}`,
        subtitle: `ξ: ${e.source}; n = ${t1.n}; x̄ = ${n3(e.summary.mean)}; S² = ${n3(e.summary.variance)}; χ² = ${n3(e.testTrue.statistic)} < χ²кр = ${n3(e.testTrue.critical)}`,
        bins: e.bins,
        pdf: exponentialPdf(e.lambda),
        total: t1.n,
        xLabel: 'значення випадкової величини x',
      }),
    );
  }

  console.log('\n═══ Завдання 2: z = a·z (mod c), перевірка на рівномірний закон ═══\n');
  const t2 = runTask2();
  for (const [i, e] of t2.experiments.entries()) {
    console.log(
      `${e.label}: x̄=${n3(e.summary.mean)}, S²=${n3(e.summary.variance)}, ` +
        `χ²=${n3(e.test.statistic)} проти χ²кр=${n3(e.test.critical)} → ${e.test.accepted ? 'ПРИЙНЯТО' : 'ВІДХИЛЕНО'}` +
        (e.period === null ? '' : `, період = ${e.period}`),
    );
    await save(
      `task2-${i + 1}.svg`,
      histogramChart({
        title: `Гістограма частот конгруентного генератора`,
        subtitle: `${e.label}; χ² = ${n3(e.test.statistic)}; χ²кр = ${n3(e.test.critical)}; ${e.test.accepted ? 'гіпотеза приймається' : 'гіпотеза відхиляється'}`,
        bins: e.bins,
        pdf: () => 1,
        total: t2.n,
        xLabel: 'значення x = z/c',
      }),
    );
    await save(
      `task2-${i + 1}-scatter.svg`,
      scatterChart('Пари сусідніх чисел (xᵢ, xᵢ₊₁) в одиничному квадраті', e.label, e.pairs),
    );
  }

  console.log('\n═══ Завдання 3: часова затримка сортування 1 000 000 об’єктів ═══\n');
  const t3 = runTask3();
  console.log(
    `${t3.runs} прогонів: середнє ${n3(t3.summary.mean)} мс, S² = ${n3(t3.summary.variance)}, ` +
      `асиметрія ${n3(t3.skewness)}`,
  );
  for (const c of t3.candidates) {
    console.log(
      `  ${c.name.padEnd(24)} χ²=${n3(c.statistic)} (k=${c.df}, χ²кр=${n3(c.critical)}), p=${c.pValue.toExponential(2)} → ${c.accepted ? 'приймається' : 'відхиляється'}`,
    );
  }
  console.log(`Ідентифіковано: ${t3.best.name}`);
  for (const im of t3.imitations) {
    console.log(
      `  ${im.label}: середнє ${n3(im.summary.mean)} мс (похибка ${(im.errors.mean * 100).toFixed(2)} %), ` +
        `дисперсія ${n3(im.summary.variance)} (похибка ${(im.errors.variance * 100).toFixed(2)} %), D=${n3(im.kolmogorov)}`,
    );
  }

  await save(
    'task3-delays.svg',
    lineChart(
      'Часова затримка сортування 1 000 000 об’єктів',
      `${t3.runs} послідовних прогонів; середнє ${n3(t3.summary.mean)} мс`,
      t3.delays,
      'затримка, мс',
    ),
  );
  // для графіка обмежуємо діапазон 98 % квантилем: поодинокі викиди
  // в кілька разів більші за типову затримку і роблять гістограму нечитабельною
  const viewHi = quantile(t3.delays, 0.98);
  const viewLo = t3.summary.min;
  const outliers = t3.delays.filter((x) => x > viewHi).length;
  const viewBins = histogram(t3.delays, 30, viewLo, viewHi);
  await save(
    'task3-histogram.svg',
    histogramChart({
      title: 'Гістограма частот часової затримки',
      subtitle:
        `n = ${t3.runs}; ідентифікований закон: ${t3.best.name}; ` +
        `поза діапазоном ${outliers} викидів (до ${n3(t3.summary.max)} мс)`,
      bins: viewBins,
      xLabel: 'затримка, мс',
    }),
  );
  const parametric = t3.imitations[0];
  if (parametric) {
    await save(
      'task3-imitation.svg',
      overlayHistogramChart(
        'Виміряні затримки проти імітованих',
        `${parametric.label}; статистика Колмогорова D = ${n3(parametric.kolmogorov)}`,
        { label: 'виміряно', bins: viewBins },
        {
          label: 'імітація (нормовано)',
          bins: histogram(parametric.sample, 30, viewLo, viewHi).map((b) => ({
            ...b,
            count: (b.count * t3.runs) / parametric.summary.n,
          })),
        },
        'затримка, мс',
      ),
    );
  }

  const meta = {
    date: new Date().toLocaleDateString('uk-UA'),
    runtime: `Bun ${typeof Bun === 'undefined' ? '' : Bun.version} / ${process.platform} ${process.arch}`,
  };

  await save('report.md', buildReport(t1, t2, t3, meta));
  await save(
    'results.json',
    JSON.stringify(
      {
        meta,
        task1: {
          n: t1.n,
          experiments: t1.experiments.map(({ sample: _sample, ...rest }) => rest),
        },
        task2: {
          n: t2.n,
          experiments: t2.experiments.map(({ sample: _sample, pairs: _pairs, ...rest }) => rest),
        },
        task3: {
          ...t3,
          imitations: t3.imitations.map(({ sample: _sample, ...rest }) => rest),
        },
      },
      null,
      2,
    ),
  );

  console.log('\nГотово. Звіт: out/report.md\n');
};

await main();
