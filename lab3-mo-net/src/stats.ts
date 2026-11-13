/** Статистичні оцінки: накопичувач спостережень і довірчий інтервал за кількома прогонами моделі. */

/** Накопичує вибіркове середнє та дисперсію спостережень без збереження самих значень (алгоритм Велфорда). */
export class Accumulator {
  count = 0;
  mean = 0;
  min = Infinity;
  max = -Infinity;
  #m2 = 0;

  add(x: number): void {
    this.count++;
    const d = x - this.mean;
    this.mean += d / this.count;
    this.#m2 += d * (x - this.mean);
    this.min = Math.min(this.min, x);
    this.max = Math.max(this.max, x);
  }

  get deviation(): number {
    return this.count > 1 ? Math.sqrt(this.#m2 / (this.count - 1)) : 0;
  }

  summary(): Summary {
    return { count: this.count, mean: this.mean, deviation: this.deviation, min: this.count ? this.min : 0, max: this.count ? this.max : 0 };
  }
}

export interface Summary {
  readonly count: number;
  readonly mean: number;
  readonly deviation: number;
  readonly min: number;
  readonly max: number;
}

/** Квантилі t-розподілу Стьюдента рівня 0,975 для 1…30 ступенів вільності. */
const T975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
  2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
] as const;

/** Оцінка за n незалежними прогонами: середнє і половина ширини 95 % довірчого інтервалу. */
export interface Estimate {
  readonly mean: number;
  readonly halfWidth: number;
}

export const estimate = (xs: readonly number[]): Estimate => {
  const acc = new Accumulator();
  for (const x of xs) acc.add(x);
  const t = T975[Math.min(xs.length - 1, T975.length) - 1] ?? 1.96;
  return { mean: acc.mean, halfWidth: xs.length > 1 ? (t * acc.deviation) / Math.sqrt(xs.length) : 0 };
};

/** Частоти потрапляння значень у інтервали однакової ширини на [0; top]; значення понад top відкидаються. */
export const histogram = (xs: readonly number[], top: number, bins: number): number[] => {
  const counts = Array.from({ length: bins }, () => 0);
  for (const x of xs) {
    const i = Math.floor((x / top) * bins);
    if (i >= 0 && i < bins) counts[i] = (counts[i] ?? 0) + 1;
  }
  return counts;
};
