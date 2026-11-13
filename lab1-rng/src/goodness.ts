/**
 * Критерій узгодження χ² (Пірсона) та додаткові емпіричні тести
 * генераторів (п. 1.2.3 методичних вказівок).
 */
import type { Distribution } from './distributions.ts';
import { chiSquareCritical, chiSquarePValue, max, mean, min, variance, type Sample } from './stats.ts';

export interface ChiRow {
  readonly from: number;
  readonly to: number;
  readonly observed: number;
  readonly expected: number;
  readonly term: number;
}

export interface ChiSquareResult {
  /** Спосіб розбиття на інтервали. */
  readonly binning: 'рівної ширини' | 'рівноймовірні';
  readonly distribution: string;
  readonly params: Readonly<Record<string, number>>;
  readonly statistic: number;
  readonly df: number;
  readonly critical: number;
  readonly pValue: number;
  readonly alpha: number;
  readonly accepted: boolean;
  /**
   * Підозріло мале χ² (p > 1−α): збіг із теоретичним законом «занадто добрий»,
   * що свідчить не про випадковість, а про регулярність послідовності.
   */
  readonly suspiciouslyGood: boolean;
  readonly rows: readonly ChiRow[];
}

/** Обернена функція розподілу, знайдена бісекцією (для рівноймовірних інтервалів). */
const invertCdf = (dist: Distribution, p: number, lo: number, hi: number): number => {
  let a = lo;
  let b = hi;
  for (let i = 0; i < 200; i++) {
    const mid = (a + b) / 2;
    if (dist.cdf(mid) < p) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
};

const MIN_EXPECTED = 5;

/**
 * Перевірка вибірки на відповідність закону розподілу.
 * Інтервали — рівної ширини; сусідні інтервали об'єднуються,
 * доки очікувана частота не стане ≥ 5 (вимога критерію χ²).
 */
export const chiSquareTest = (
  xs: Sample,
  dist: Distribution,
  options: { bins?: number; lo?: number; hi?: number; alpha?: number; equiprobable?: boolean } = {},
): ChiSquareResult => {
  const { bins = 20, alpha = 0.05, equiprobable = false } = options;
  const lo = options.lo ?? min(xs);
  const hi = options.hi ?? max(xs);
  const span = hi - lo || 1;

  // межі інтервалів; крайні розширюємо до (-∞; +∞), щоб сума ймовірностей = 1
  const edges: number[] = equiprobable
    ? Array.from({ length: bins + 1 }, (_, i) =>
        i === 0 || i === bins
          ? (i === 0 ? -Infinity : Infinity)
          : invertCdf(dist, i / bins, lo - span * 5, hi + span * 5),
      )
    : (() => {
        const e = Array.from({ length: bins + 1 }, (_, i) => lo + (span * i) / bins);
        e[0] = -Infinity;
        e[bins] = Infinity;
        return e;
      })();

  const counts = new Array<number>(bins).fill(0);
  for (const x of xs) {
    let idx = edges.findIndex((edge, i) => i > 0 && x < edge) - 1;
    if (idx < 0) idx = bins - 1;
    counts[idx] = (counts[idx] ?? 0) + 1;
  }

  const raw = counts.map((observed, i) => {
    const a = edges[i] as number;
    const b = edges[i + 1] as number;
    const p = dist.cdf(b) - dist.cdf(a);
    return { from: a, to: b, observed, expected: p * xs.length };
  });

  // об'єднання інтервалів з малою очікуваною частотою
  const merged: { from: number; to: number; observed: number; expected: number }[] = [];
  for (const cell of raw) {
    const last = merged[merged.length - 1];
    if (last && last.expected < MIN_EXPECTED) {
      last.to = cell.to;
      last.observed += cell.observed;
      last.expected += cell.expected;
    } else {
      merged.push({ ...cell });
    }
  }
  while (merged.length > 1 && (merged[merged.length - 1] as { expected: number }).expected < MIN_EXPECTED) {
    const tail = merged.pop() as { to: number; observed: number; expected: number };
    const prev = merged[merged.length - 1] as { to: number; observed: number; expected: number };
    prev.to = tail.to;
    prev.observed += tail.observed;
    prev.expected += tail.expected;
  }

  const rows: ChiRow[] = merged.map((c) => ({
    ...c,
    term: (c.observed - c.expected) ** 2 / c.expected,
  }));

  const statistic = rows.reduce((s, r) => s + r.term, 0);
  const df = Math.max(1, rows.length - 1 - dist.estimated);
  const critical = chiSquareCritical(df, alpha);

  const pValue = chiSquarePValue(statistic, df);

  return {
    binning: equiprobable ? 'рівноймовірні' : 'рівної ширини',
    distribution: dist.name,
    params: dist.params,
    statistic,
    df,
    critical,
    pValue,
    alpha,
    accepted: statistic < critical,
    suspiciouslyGood: pValue > 1 - alpha,
    rows,
  };
};

/** Автокореляція вибірки з лагом j (формула (1.6) методичних вказівок). */
export const autocorrelation = (xs: Sample, lag: number): number => {
  const h = Math.floor((xs.length - 1) / lag) - 1;
  let sum = 0;
  for (let k = 0; k <= h; k++) {
    sum += (xs[k * lag] as number) * (xs[(k + 1) * lag] as number);
  }
  return (12 / (h + 1)) * sum - 3;
};

export interface CorrelationResult {
  readonly lag: number;
  readonly rho: number;
  readonly a: number;
  readonly independent: boolean;
}

/** Критерій A_j = ρ_j / σ(ρ_j): незалежність приймається при |A_j| < 1.645. */
export const correlationTest = (xs: Sample, lags: readonly number[]): CorrelationResult[] =>
  lags.map((lag) => {
    const h = Math.floor((xs.length - 1) / lag) - 1;
    const rho = autocorrelation(xs, lag);
    const sigma = Math.sqrt(13 * h + 7) / (h + 1);
    const a = rho / sigma;
    return { lag, rho, a, independent: Math.abs(a) < 1.645 };
  });

export interface DescriptiveSummary {
  readonly n: number;
  readonly mean: number;
  readonly variance: number;
  readonly min: number;
  readonly max: number;
}

export const describe = (xs: Sample): DescriptiveSummary => ({
  n: xs.length,
  mean: mean(xs),
  variance: variance(xs),
  min: min(xs),
  max: max(xs),
});

export interface KolmogorovResult {
  readonly distribution: string;
  /** D = max|F_емп(x) − F_теор(x)| */
  readonly d: number;
  /** λ = D·√n */
  readonly lambda: number;
  readonly critical: number;
  readonly accepted: boolean;
}

/**
 * λ-критерій Колмогорова (п. 1.3 методичних вказівок):
 * гіпотеза приймається, якщо λ = D·√n менше за λ_кр = 1,36 (рівень значимості 0,05).
 */
export const kolmogorovTest = (
  xs: Sample,
  dist: { name: string; cdf: (x: number) => number },
  critical = 1.36,
): KolmogorovResult => {
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  let d = 0;
  for (let i = 0; i < n; i++) {
    const f = dist.cdf(sorted[i] as number);
    d = Math.max(d, Math.abs((i + 1) / n - f), Math.abs(f - i / n));
  }
  const lambda = d * Math.sqrt(n);
  return { distribution: dist.name, d, lambda, critical, accepted: lambda < critical };
};
