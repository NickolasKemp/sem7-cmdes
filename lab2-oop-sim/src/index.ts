/**
 * Точка входу: виконує шість завдань практикуму, друкує стислі результати в консоль
 * і зберігає звіт, графіки та JSON у каталог out/.
 */
import { $ } from 'bun';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineChart, PALETTE } from './charts.ts';
import { buildDocx } from './docx.ts';
import { buildReport, num } from './report.ts';
import { chainScheme, networkScheme, toDrawio, toSvg, type Scheme } from './schemes.ts';
import { BASE, runTask1, runTask2, runTask3, runTask4, runTask5, runTask6 } from './tasks.ts';

const OUT = new URL('../out/', import.meta.url).pathname;
const DOCX = fileURLToPath(new URL('../Звіт_КП2_Туболев.docx', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SOFFICE = '/opt/homebrew/bin/soffice';
const CHARTS = ['task2-utilization', 'task3-queues', 'task5-queue', 'task5-failure'] as const;

const save = async (name: string, content: string): Promise<void> => {
  await writeFile(`${OUT}${name}`, content, 'utf8');
  console.log(`  → out/${name}`);
};

const saveScheme = async (scheme: Scheme): Promise<void> => {
  await save(`${scheme.name}.svg`, toSvg(scheme));
  await save(`${scheme.name}.drawio`, toDrawio(scheme));
};

const color = (i: number): string => PALETTE[i % PALETTE.length] ?? '#000';

const main = async (): Promise<void> => {
  await mkdir(OUT, { recursive: true });

  console.log('\n═══ Завдання 1: CREATE → PROCESS → DISPOSE ═══\n');
  const t1 = runTask1();
  for (const r of t1.trace) {
    console.log(`t = ${num(r.t, 4).padStart(9)}  ${r.fired.padEnd(10)} створено ${r.created}, стан ${r.state}, черга ${r.queue}, обслуговано ${r.served}`);
  }
  const p1 = t1.run.process;
  console.log(
    `RESULTS (T = ${t1.run.time}): створено ${t1.run.created}, обслуговано ${p1.served}, відмов ${p1.failures}, ` +
      `P_відм = ${num(p1.failureProbability, 4)}, L_черги = ${num(p1.meanQueue)}`,
  );

  console.log('\n═══ Завдання 2: середнє завантаження ═══\n');
  const t2 = runTask2();
  for (const r of t2.byTime) {
    console.log(`T = ${String(r.time).padStart(8)}: U = ${num(r.process.utilization, 4)} (теорія ${num(t2.theory.utilization, 4)})`);
  }
  await save(
    'task2-utilization.svg',
    lineChart({
      title: 'Збіжність середнього завантаження пристрою',
      subtitle: 'CREATE exp(2) → PROCESS exp(1), черга ≤ 5; накопичене U(t) = (1/t)·∫ state dt',
      xLabel: 'модельний час t',
      yLabel: 'середнє завантаження U(t)',
      xTicks: [0, 4000, 8000, 12000, 16000, 20000],
      series: [
        { label: 'імітація', points: t2.convergence, color: color(0) },
        {
          label: `теорія M/M/1/6: ${num(t2.theory.utilization, 4)}`,
          points: [
            [0, t2.theory.utilization],
            [t2.convergence[t2.convergence.length - 1]?.[0] ?? 0, t2.theory.utilization],
          ],
          color: color(1),
          dashed: true,
        },
      ],
    }),
  );

  console.log('\n═══ Завдання 3: три послідовні процеси ═══\n');
  const t3 = runTask3();
  for (const s of t3.run.stages) {
    console.log(`${s.name}: P_відм = ${num(s.failureProbability, 4)}, L = ${num(s.meanQueue)}, U = ${num(s.utilization)}`);
  }
  console.log(`DISPOSE: ${t3.run.disposed} вимог, W = ${num(t3.run.meanTimeInSystem)}`);
  await save(
    'task3-queues.svg',
    lineChart({
      title: 'Довжини черг на початку імітації',
      subtitle: 'CREATE → PROCESS 1 → PROCESS 2 → PROCESS 3 → DISPOSE, базовий варіант параметрів',
      xLabel: 'модельний час t',
      yLabel: 'довжина черги',
      xTicks: [0, 10, 20, 30, 40, 50, 60, 70, 80],
      series: [0, 1, 2].map((i) => ({
        label: `PROCESS ${i + 1}`,
        points: [
          [0, 0] as const,
          ...t3.path.map((p) => [p.t, p.queues[i] ?? 0] as const),
          [80, t3.path[t3.path.length - 1]?.queues[i] ?? 0] as const,
        ],
        color: color(i),
        step: true,
      })),
    }),
  );

  console.log('\n═══ Завдання 4: верифікація ═══\n');
  const t4 = runTask4();
  for (const r of t4.rows) {
    const failed = r.checks.filter((c) => !c.ok);
    console.log(`${r.label.padEnd(26)} ${failed.length === 0 ? '✓' : `✗ ${failed.map((c) => c.label).join(', ')}`}`);
  }

  console.log('\n═══ Завдання 5: кілька ідентичних пристроїв ═══\n');
  const t5 = runTask5();
  for (const r of t5.rows) {
    console.log(
      `c = ${r.channels}, черга ${Number.isFinite(r.maxQueue) ? r.maxQueue : '∞'}: ` +
        `P_відм ${num(r.sim.failureProbability, 4)} / ${num(r.theory.failureProbability, 4)}, ` +
        `L ${num(r.sim.meanQueue)} / ${num(r.theory.meanQueue)} (імітація / теорія)`,
    );
  }
  const finite = t5.rows.filter((r) => Number.isFinite(r.maxQueue));
  const channelsChart = (file: string, title: string, yLabel: string, pick: (s: { meanQueue: number; failureProbability: number }) => number) =>
    save(
      file,
      lineChart({
        title,
        subtitle: `CREATE exp(${t5.createMean}) → PROCESS exp(${t5.serviceMean}) з c пристроями, черга ≤ 5, T = ${t5.time}`,
        xLabel: 'кількість пристроїв c',
        yLabel,
        xTicks: finite.map((r) => r.channels),
        series: [
          { label: 'теорія M/M/c/5', points: finite.map((r) => [r.channels, pick(r.theory)]), color: color(1), dashed: true },
          { label: 'імітація', points: finite.map((r) => [r.channels, pick(r.sim)]), color: color(0), markersOnly: true },
        ],
      }),
    );
  await channelsChart('task5-queue.svg', 'Середня довжина черги багатоканального PROCESS', 'середня довжина черги', (s) => s.meanQueue);
  await channelsChart('task5-failure.svg', 'Імовірність відмови багатоканального PROCESS', 'імовірність відмови', (s) => s.failureProbability);

  console.log('\n═══ Завдання 6: розгалуження з поверненням ═══\n');
  const t6 = runTask6();
  for (const [i, s] of t6.unlimited.nodes.entries()) {
    console.log(`${s.name}: L = ${num(s.meanQueue)} (теорія ${num(t6.theory[i]?.meanQueue ?? 0)}), U = ${num(s.utilization)}`);
  }
  console.log(`W = ${num(t6.unlimited.meanTimeInSystem)} (теорія ${num(t6.theoryTimeInSystem)})`);

  const schemes = [chainScheme(BASE), networkScheme(t6)];
  for (const scheme of schemes) await saveScheme(scheme);

  const meta = {
    date: new Date().toLocaleDateString('uk-UA'),
    runtime: `Bun ${typeof Bun === 'undefined' ? '' : Bun.version} / ${process.platform} ${process.arch}`,
  };
  await save('report.md', buildReport({ t1, t2, t3, t4, t5, t6, meta }));
  // Infinity у JSON не існує — записуємо його рядком
  const json = JSON.stringify(
    { meta, task1: t1, task2: { ...t2, convergence: undefined }, task3: { run: t3.run }, task4: t4, task5: t5, task6: t6 },
    (_key, value: unknown) => (value === Infinity ? 'Infinity' : value),
    2,
  );
  await save('results.json', json);

  // растрові копії графіків і схем для Word: SVG рендериться headless Chrome у PNG
  if (existsSync(CHROME)) {
    const rasterize = (name: string, width: number, height: number) =>
      $`${CHROME} --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=${width},${height} --screenshot=${OUT}${name}.png file://${OUT}${name}.svg`.quiet();
    for (const name of CHARTS) await rasterize(name, 900, 500);
    for (const { name, width, height } of schemes) await rasterize(name, width, height);
    await writeFile(DOCX, await buildDocx({ t1, t2, t3, t4, t5, t6, meta }, (name) => `${OUT}${name}.png`));
    console.log('  → Звіт_КП2_Туболев.docx');
    if (existsSync(SOFFICE)) {
      await $`${SOFFICE} --headless --convert-to pdf --outdir ${dirname(DOCX)} ${DOCX}`.quiet();
      console.log('  → Звіт_КП2_Туболев.pdf');
    } else {
      console.log('  (LibreOffice не знайдено — .pdf не зібрано)');
    }
  } else {
    console.log('  (Google Chrome не знайдено — .docx не зібрано: потрібні PNG-версії графіків)');
  }
  console.log('\nГотово. Звіт: out/report.md\n');
};

await main();
