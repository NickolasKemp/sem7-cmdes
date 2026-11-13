/** Форматування чисел для звіту: десяткова кома, знак мінус, відсотки, оцінки з довірчим інтервалом. */
import type { Estimate } from './stats.ts';

export const num = (x: number, digits = 3): string =>
  Number.isFinite(x) ? x.toFixed(digits).replace('.', ',').replace('-', '−') : '∞';

/** Підпис закону розподілу з десятковою комою: exp(1.5) → exp(1,5). */
export const label = (s: string): string => s.replace(/(\d)\.(\d)/g, '$1,$2');

export const int = (x: number): string => Math.round(x).toLocaleString('uk-UA').replace(/\s/g, ' ');

export const pct = (x: number, digits = 2): string => `${num(x * 100, digits)} %`;

/** відносне відхилення імітації від теорії */
export const dev = (sim: number, theory: number): string => (theory === 0 ? (sim === 0 ? '0 %' : '—') : pct(Math.abs(sim - theory) / theory));

/** середнє ± половина 95 % довірчого інтервалу */
export const pm = (e: Estimate, digits = 3, scale = 1): string => `${num(e.mean * scale, digits)} ± ${num(e.halfWidth * scale, digits)}`;
