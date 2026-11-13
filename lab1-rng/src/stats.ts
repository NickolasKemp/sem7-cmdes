/**
 * Базова описова статистика та спеціальні функції,
 * потрібні для критерію узгодження χ² (розділ 1.3 методичних вказівок).
 */

export type Sample = readonly number[];

export const mean = (xs: Sample): number => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Незміщена (виправлена) вибіркова дисперсія. */
export const variance = (xs: Sample): number => {
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
};

export const stdDev = (xs: Sample): number => Math.sqrt(variance(xs));

/** Коефіцієнт асиметрії — перша підказка про форму закону розподілу. */
export const skewness = (xs: Sample): number => {
  const m = mean(xs);
  const s = stdDev(xs);
  return xs.reduce((acc, x) => acc + ((x - m) / s) ** 3, 0) / xs.length;
};

/** Коефіцієнт ексцесу (надлишковий, для нормального закону ≈ 0). */
export const kurtosis = (xs: Sample): number => {
  const m = mean(xs);
  const s = stdDev(xs);
  return xs.reduce((acc, x) => acc + ((x - m) / s) ** 4, 0) / xs.length - 3;
};

export const min = (xs: Sample): number => xs.reduce((a, b) => (b < a ? b : a), Infinity);
export const max = (xs: Sample): number => xs.reduce((a, b) => (b > a ? b : a), -Infinity);

/** Вибірковий квантиль рівня p за лінійною інтерполяцією. */
export const quantile = (xs: Sample, p: number): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
};

export interface Bin {
  readonly from: number;
  readonly to: number;
  readonly count: number;
}

/** Гістограма частот: m рівних інтервалів на [min; max]. */
export const histogram = (xs: Sample, binCount: number, lo = min(xs), hi = max(xs)): Bin[] => {
  const width = (hi - lo) / binCount;
  const counts = new Array<number>(binCount).fill(0);
  for (const x of xs) {
    if (x < lo || x > hi) continue;
    const idx = Math.min(binCount - 1, Math.floor((x - lo) / width));
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  return counts.map((count, i) => ({ from: lo + i * width, to: lo + (i + 1) * width, count }));
};

// ---------------------------------------------------------------------------
// Спеціальні функції
// ---------------------------------------------------------------------------

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
] as const;

/** Логарифм гамма-функції (апроксимація Ланцоша). */
export const logGamma = (z: number): number => {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  const x = z - 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < LANCZOS.length; i++) a += (LANCZOS[i] as number) / (x + i + 1);
  const t = x + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
};

/** Регуляризована нижня неповна гамма-функція P(s, x). */
export const lowerGammaP = (s: number, x: number): number => {
  if (x <= 0) return 0;
  if (!Number.isFinite(x)) return 1;
  if (x < s + 1) {
    // Розклад у ряд
    let sum = 1 / s;
    let term = sum;
    for (let n = 1; n < 1000; n++) {
      term *= x / (s + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + s * Math.log(x) - logGamma(s));
  }
  // Ланцюговий дріб для Q(s, x) = 1 - P(s, x)
  const tiny = 1e-300;
  let b = x + 1 - s;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return 1 - Math.exp(-x + s * Math.log(x) - logGamma(s)) * h;
};

/** Функція розподілу χ² з df ступенями вільності. */
export const chiSquareCdf = (x: number, df: number): number => lowerGammaP(df / 2, x / 2);

/** p-значення критерію χ²: P(χ²_df > stat). */
export const chiSquarePValue = (stat: number, df: number): number =>
  df <= 0 ? 1 : 1 - chiSquareCdf(stat, df);

/** Критичне (табличне) значення χ² для рівня значимості alpha — розв'язок методом бісекції. */
export const chiSquareCritical = (df: number, alpha = 0.05): number => {
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (chiSquarePValue(mid, df) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/** Функція розподілу стандартного нормального закону. */
export const normalCdf = (x: number): number => 0.5 * (1 + erf(x / Math.SQRT2));

/** Функція помилок (максимальна похибка ~1.2e-7). */
export const erf = (x: number): number => {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return sign * y;
};
