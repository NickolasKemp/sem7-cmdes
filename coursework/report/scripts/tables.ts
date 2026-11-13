/**
 * Рядки таблиць звіту з результатів моделі (model/out/results.json), щоб жодне число не переписувалось руками.
 * Запуск: `just tables`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import type { Estimate } from '../../model/src/stats.ts';
import type { Payback, RunsNeeded, Sensitivity, Verification } from '../../model/src/experiments.ts';

interface Results {
  readonly needed: readonly RunsNeeded[];
  readonly verification: readonly Verification[];
  readonly payback: readonly Payback[];
  readonly sensitivity: readonly Sensitivity[];
}

const OUT = `${import.meta.dir}/../generated/`;
const MLN = 1_000_000;
const results: Results = await Bun.file(`${import.meta.dir}/../../model/out/results.json`).json();

/** Десяткова кома і математичний мінус. */
const num = (x: number, digits: number): string => {
  const text = Math.abs(x).toFixed(digits).replace('.', ',');
  return x < 0 ? `\\textminus{}${text}` : text;
};
const int = (x: number): string => String(Math.round(x));
const months = (e: Estimate | undefined): string => (e ? `${num(e.mean * 12, 3)} $\\pm$ ${num(e.halfWidth * 12, 3)}` : '--');
const caseName = (name: string): string => name.replace(/n = (\d+)/, '$n = $1$').replaceAll('±', '$\\pm$');
const rows = (lines: readonly string[][]): string => lines.map((cells) => `${cells.join(' & ')} \\\\ \\hline`).join('\n') + '\n';

const files: Record<string, string> = {
  'runs-rows': rows(results.needed.map((r) => [String(r.runways), num(r.mean / MLN, 3), num(r.deviation / MLN, 3), String(r.needed)])),
  'verify-rows': rows(
    results.verification.map(({ name, result: r, expectedArrivals, littleBusy }) => [
      caseName(name),
      `${r.arrived} (${int(expectedArrivals)})`,
      String(r.landedNoWait),
      String(r.landedAfterWait),
      String(r.refuelled),
      String(r.left),
      num(r.meanWait, 1),
      num(r.meanQueue, 1),
      `${num(r.busyRunways, 3)} (${num(littleBusy, 3)})`,
      num(r.yearProfit / MLN, 2),
    ]),
  ),
  'payback-rows': rows(
    results.payback.map((r) => [
      String(r.runways),
      num(r.profit.mean / MLN, 2),
      num(r.gain.mean / MLN, 2),
      int(r.arrived.mean),
      int(r.left.mean),
      int(r.refuelled.mean),
      num(r.meanWait.mean, 1),
      num(r.busyRunways.mean, 3),
      months(r.paybackGain),
      r.paybackTotal ? num(r.paybackTotal.mean * 12, 3) : '--',
    ]),
  ),
  'sensitivity-rows': rows(
    results.payback.map((base, i) => {
      const cells = (rs: readonly Payback[]): string[] => {
        const r = rs[i];
        return r ? [num(r.profit.mean / MLN, 1), r.paybackGain ? num(r.paybackGain.mean * 12, 3) : '--'] : ['--', '--'];
      };
      const [slow, fast] = results.sensitivity;
      return [String(base.runways), ...cells(slow?.payback ?? []), ...cells(results.payback), ...cells(fast?.payback ?? [])];
    }),
  ),
};

await mkdir(OUT, { recursive: true });
for (const [name, content] of Object.entries(files)) await writeFile(`${OUT}${name}.tex`, content);
console.log(`→ generated/: ${Object.keys(files).join(', ')}`);
