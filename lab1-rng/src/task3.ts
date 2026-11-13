/**
 * Завдання 3: дослідження часової затримки на сортування колекції з 1 000 000 об'єктів,
 * ідентифікація закону розподілу затримки та побудова генератора, що її імітує.
 */
import {
  fitGamma,
  fitLognormal,
  fitNormal,
  fitShiftedExponential,
  fitBodyTail,
  fitShiftedGamma,
  fitShiftedLognormal,
  type Distribution,
} from './distributions.ts';
import {
  chiSquareTest,
  describe,
  kolmogorovTest,
  type ChiSquareResult,
  type DescriptiveSummary,
  type KolmogorovResult,
} from './goodness.ts';
import {
  empiricalGenerator,
  gammaSample,
  lognormalSample,
  normalSample,
  standardNormal,
} from './generators.ts';
import { fitLognormalMixture, parseComponents } from './mixture.ts';
import { histogram, kurtosis, mean, quantile, skewness, variance, type Bin } from './stats.ts';

export interface Item {
  readonly id: number;
  readonly key: number;
}

/** Один вимір: створюємо колекцію, вимірюємо лише час виконання сортування. */
export const measureSortDelay = (size: number, buffer: Item[]): number => {
  for (let i = 0; i < size; i++) buffer[i] = { id: i, key: Math.random() };
  const t0 = performance.now();
  buffer.sort((x, y) => x.key - y.key);
  return performance.now() - t0;
};

export const collectDelays = (runs: number, size: number, warmup = 5): number[] => {
  const buffer = new Array<Item>(size);
  for (let i = 0; i < warmup; i++) measureSortDelay(size, buffer);
  return Array.from({ length: runs }, () => measureSortDelay(size, buffer));
};

/** Статистика Колмогорова (максимальне відхилення емпіричних функцій розподілу). */
export const kolmogorovDistance = (a: readonly number[], b: readonly number[]): number => {
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  let i = 0;
  let j = 0;
  let d = 0;
  while (i < sa.length && j < sb.length) {
    const av = sa[i] as number;
    const bv = sb[j] as number;
    if (av <= bv) i++;
    else j++;
    d = Math.max(d, Math.abs(i / sa.length - j / sb.length));
  }
  return d;
};

export interface Candidate {
  readonly distribution: Distribution;
  readonly test: ChiSquareResult;
  readonly kolmogorov: KolmogorovResult;
}

export interface ImitationComparison {
  readonly label: string;
  readonly summary: DescriptiveSummary;
  readonly bins: readonly Bin[];
  readonly errors: {
    readonly mean: number;
    readonly variance: number;
    readonly p50: number;
    readonly p90: number;
    readonly p99: number;
  };
  readonly kolmogorov: number;
  readonly sample: readonly number[];
}

/**
 * Кількість локальних максимумів згладженої гістограми —
 * кількісна ознака багатомодальності вибірки.
 */
export const countModes = (values: readonly number[], bins = 30, upperQuantile = 0.98): number => {
  const lo = Math.min(...values);
  const hi = quantile(values, upperQuantile);
  const counts = histogram(values, bins, lo, hi).map((b) => b.count);
  const smooth = counts.map((_, i) =>
    ((counts[i - 1] ?? 0) + (counts[i] as number) + (counts[i + 1] ?? 0)) / 3,
  );
  const peak = Math.max(...smooth);
  let modes = 0;
  for (let i = 1; i < smooth.length - 1; i++) {
    const v = smooth[i] as number;
    // за моду вважаємо лише помітні піки — не менше 15 % від головного
    if (v > (smooth[i - 1] as number) && v >= (smooth[i + 1] as number) && v > peak * 0.15) modes++;
  }
  return Math.max(1, modes);
};

export interface Task3Result {
  readonly runs: number;
  readonly collectionSize: number;
  readonly delays: readonly number[];
  readonly summary: DescriptiveSummary;
  readonly skewness: number;
  readonly kurtosis: number;
  /** Кількість помітних локальних максимумів гістограми. */
  readonly modes: number;
  readonly quantiles: { readonly p50: number; readonly p90: number; readonly p99: number };
  readonly bins: readonly Bin[];
  readonly range: { readonly lo: number; readonly hi: number };
  readonly candidates: readonly {
    readonly name: string;
    readonly params: Readonly<Record<string, number>>;
    readonly statistic: number;
    readonly df: number;
    readonly critical: number;
    readonly pValue: number;
    readonly accepted: boolean;
    readonly kolmogorovLambda: number;
    readonly kolmogorovAccepted: boolean;
  }[];
  readonly best: { readonly name: string; readonly params: Readonly<Record<string, number>> };
  /** Аналіз «тіла» розподілу — типових затримок без рідкісних довгих пауз. */
  readonly body: {
    readonly threshold: number;
    readonly share: number;
    readonly summary: DescriptiveSummary;
    readonly candidates: readonly {
      readonly name: string;
      readonly params: Readonly<Record<string, number>>;
      readonly statistic: number;
      readonly df: number;
      readonly critical: number;
      readonly pValue: number;
      readonly accepted: boolean;
      readonly kolmogorovLambda: number;
      readonly kolmogorovAccepted: boolean;
    }[];
    readonly best: { readonly name: string; readonly params: Readonly<Record<string, number>> };
  };
  readonly imitations: readonly ImitationComparison[];
}

const relErr = (actual: number, expected: number): number => Math.abs(actual - expected) / Math.abs(expected);

const BINS = 12;
const IMITATION_N = 10_000;

/** Вибірка з розподілу за його назвою та параметрами (для імітаційного генератора). */
const sampleFrom = (dist: Distribution, n: number): number[] => {
  const p = dist.params;
  if (dist.name.startsWith('суміш')) {
    const comps = parseComponents(p);
    return Array.from({ length: n }, () => {
      let u = Math.random();
      for (const c of comps) {
        u -= c.weight;
        if (u <= 0) return Math.exp(c.mu + c.sigma * standardNormal());
      }
      const last = comps[comps.length - 1] as { mu: number; sigma: number };
      return Math.exp(last.mu + last.sigma * standardNormal());
    });
  }
  switch (dist.name) {
    case 'нормальний':
      return normalSample(n, p.mu as number, p.sigma as number);
    case 'логнормальний':
      return lognormalSample(n, p.mu as number, p.sigma as number);
    case 'гамма':
      return gammaSample(n, p.shape as number, p.scale as number);
    case 'зсунутий гамма':
      return gammaSample(n, p.shape as number, p.scale as number).map((x) => x + (p.shift as number));
    case 'зсунутий логнормальний':
      return lognormalSample(n, p.mu as number, p.sigma as number).map((x) => x + (p.shift as number));
    case 'складений (логнормальне тіло + експоненційний хвіст)': {
      const { mu, sigma, threshold, lambda, p: share } = p as Record<string, number> & {
        mu: number; sigma: number; threshold: number; lambda: number; p: number;
      };
      return Array.from({ length: n }, () => {
        if (Math.random() < share) {
          // тіло: логнормальний закон, зрізаний у точці threshold
          for (let attempt = 0; attempt < 100; attempt++) {
            const value = Math.exp(mu + sigma * standardNormal());
            if (value <= threshold) return value;
          }
          return threshold;
        }
        return threshold - Math.log(1 - Math.random()) / lambda;
      });
    }
    case 'зсунутий експоненційний': {
      const lambda = p.lambda as number;
      const shift = p.shift as number;
      return Array.from({ length: n }, () => shift - Math.log(1 - Math.random()) / lambda);
    }
    default:
      throw new Error(`Немає генератора для закону «${dist.name}»`);
  }
};

export const runTask3 = (runs = 300, collectionSize = 1_000_000): Task3Result => {
  const delays = collectDelays(runs, collectionSize);
  const summary = describe(delays);
  const lo = Math.min(...delays);
  const hi = Math.max(...delays);

  const fits: Distribution[] = [
    fitNormal(delays),
    fitLognormal(delays),
    fitGamma(delays),
    fitShiftedExponential(delays),
    fitShiftedGamma(delays),
    fitShiftedLognormal(delays),
    fitBodyTail(delays),
    fitLognormalMixture(delays, 2),
    fitLognormalMixture(delays, 3),
    fitLognormalMixture(delays, 4),
  ];

  // для малої вибірки коректніше використовувати рівноймовірні інтервали:
  // очікувана частота в кожному з них однакова й достатньо велика
  const candidates: Candidate[] = fits.map((distribution) => ({
    distribution,
    test: chiSquareTest(delays, distribution, { bins: BINS, lo, hi, equiprobable: true }),
    kolmogorov: kolmogorovTest(delays, distribution),
  }));

  const best = candidates.reduce((a, b) => (b.test.pValue > a.test.pValue ? b : a));

  // «Тіло» розподілу: типові затримки без рідкісних довгих пауз (понад 90 % квантиль).
  const threshold = quantile(delays, 0.9);
  const body = delays.filter((x) => x <= threshold);
  const bodyFits: Distribution[] = [
    fitNormal(body),
    fitLognormal(body),
    fitGamma(body),
    fitLognormalMixture(body, 2),
  ];
  const bodyCandidates: Candidate[] = bodyFits.map((distribution) => ({
    distribution,
    test: chiSquareTest(body, distribution, {
      bins: 6,
      lo: Math.min(...body),
      hi: Math.max(...body),
      equiprobable: true,
    }),
    kolmogorov: kolmogorovTest(body, distribution),
  }));
  const bodyBest = bodyCandidates.reduce((a, b) => (b.test.pValue > a.test.pValue ? b : a));

  // Складений імітатор: тіло — за ідентифікованим для нього законом,
  // хвіст — за емпіричними значеннями рідкісних довгих затримок.
  const tail = delays.filter((x) => x > threshold);
  const tailGen = empiricalGenerator(tail.length ? tail : delays);
  const bodyShare = body.length / delays.length;
  const composite = Array.from({ length: IMITATION_N }, () => {
    if (Math.random() >= bodyShare) return tailGen();
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = (sampleFrom(bodyBest.distribution, 1)[0] as number);
      if (value <= threshold) return value;
    }
    return threshold;
  });

  // Імітаційні генератори: параметричний (за ідентифікованим законом)
  // та табличний (за емпіричною функцією розподілу).
  const parametric = sampleFrom(best.distribution, IMITATION_N);
  const empiricalGen = empiricalGenerator(delays);
  const empirical = Array.from({ length: IMITATION_N }, empiricalGen);

  const compare = (label: string, sample: number[]): ImitationComparison => ({
    label,
    summary: describe(sample),
    bins: histogram(sample, BINS, lo, hi),
    errors: {
      mean: relErr(mean(sample), summary.mean),
      variance: relErr(variance(sample), summary.variance),
      p50: relErr(quantile(sample, 0.5), quantile(delays, 0.5)),
      p90: relErr(quantile(sample, 0.9), quantile(delays, 0.9)),
      p99: relErr(quantile(sample, 0.99), quantile(delays, 0.99)),
    },
    kolmogorov: kolmogorovDistance(sample, delays),
    sample,
  });

  return {
    runs,
    collectionSize,
    delays,
    summary,
    skewness: skewness(delays),
    kurtosis: kurtosis(delays),
    modes: countModes(delays),
    quantiles: {
      p50: quantile(delays, 0.5),
      p90: quantile(delays, 0.9),
      p99: quantile(delays, 0.99),
    },
    bins: histogram(delays, BINS, lo, hi),
    range: { lo, hi },
    candidates: candidates.map(({ distribution, test, kolmogorov }) => ({
      name: distribution.name,
      params: distribution.params,
      statistic: test.statistic,
      df: test.df,
      critical: test.critical,
      pValue: test.pValue,
      accepted: test.accepted,
      kolmogorovLambda: kolmogorov.lambda,
      kolmogorovAccepted: kolmogorov.accepted,
    })),
    body: {
      threshold,
      share: bodyShare,
      summary: describe(body),
      candidates: bodyCandidates.map(({ distribution, test, kolmogorov }) => ({
        name: distribution.name,
        params: distribution.params,
        statistic: test.statistic,
        df: test.df,
        critical: test.critical,
        pValue: test.pValue,
        accepted: test.accepted,
        kolmogorovLambda: kolmogorov.lambda,
        kolmogorovAccepted: kolmogorov.accepted,
      })),
      best: { name: bodyBest.distribution.name, params: bodyBest.distribution.params },
    },
    best: { name: best.distribution.name, params: best.distribution.params },
    imitations: [
      compare(`імітація за законом «${best.distribution.name}»`, parametric),
      compare('імітація за емпіричним розподілом (табличний метод)', empirical),
      compare(`складена імітація: «${bodyBest.distribution.name}» + емпіричний хвіст`, composite),
    ],
  };
};
