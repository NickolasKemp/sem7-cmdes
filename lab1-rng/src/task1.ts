/**
 * Завдання 1: x_i = -(1/λ)·ln(ξ_i), ξ_i ~ U(0;1).
 * Гіпотеза — експоненційний закон F(x) = 1 - e^{-λx}; перевірка за критерієм χ².
 */
import { exponential, fitExponential } from './distributions.ts';
import { chiSquareTest, correlationTest, describe, type ChiSquareResult, type CorrelationResult, type DescriptiveSummary } from './goodness.ts';
import { createLcg, exponentialSample, type UniformGenerator } from './generators.ts';
import { histogram, quantile, skewness, type Bin } from './stats.ts';

export interface ExperimentResult {
  readonly lambda: number;
  /** Джерело рівномірних чисел ξ, з яких будується експоненційна величина. */
  readonly source: string;
  readonly summary: DescriptiveSummary;
  readonly theoretical: { readonly mean: number; readonly variance: number };
  readonly skewness: number;
  readonly median: number;
  readonly bins: readonly Bin[];
  readonly histogramRange: { readonly lo: number; readonly hi: number };
  /** Перевірка з параметром λ, використаним при генеруванні. */
  readonly testTrue: ChiSquareResult;
  /** Перевірка з λ, оціненим за вибіркою (λ̂ = 1/x̄): на один ступінь вільності менше. */
  readonly testEstimated: ChiSquareResult;
  /** Контрольна перевірка зі свідомо неправильним λ — критерій має відхилити гіпотезу. */
  readonly testWrong: ChiSquareResult;
  readonly correlation: readonly CorrelationResult[];
  readonly sample: readonly number[];
}

export interface Task1Result {
  readonly n: number;
  readonly lambdas: readonly number[];
  readonly experiments: readonly ExperimentResult[];
}

const BINS = 20;

/**
 * Джерела рівномірних чисел ξ: вбудований генератор мови
 * та власний конгруентний генератор із завдання 2 (дає відтворювані результати).
 */
const SOURCES: readonly { label: string; create: (seed: number) => UniformGenerator }[] = [
  { label: 'вбудований Math.random()', create: () => Math.random },
  {
    label: 'конгруентний генератор (a=5¹³, c=2³¹)',
    create: (seed) => {
      const gen = createLcg({ a: 5n ** 13n, c: 2n ** 31n, seed: BigInt(seed) });
      return () => gen.next();
    },
  },
];

export const runTask1 = (n = 10_000, lambdas: readonly number[] = [0.5, 1, 2]): Task1Result => {
  const experiments = lambdas.flatMap((lambda, index) =>
    SOURCES.map((source, sourceIndex): ExperimentResult => {
    const sample = exponentialSample(n, lambda, source.create(2_000_003 + index * 7 + sourceIndex));
    const summary = describe(sample);

    // хвіст експоненційного закону нескінченний, тож гістограму будуємо
    // до квантиля 0.995, а решту значень критерій χ² віднесе в останній інтервал
    const lo = 0;
    const hi = quantile(sample, 0.995);
    const bins = histogram(sample, BINS, lo, hi);
    const estimated = fitExponential(sample);

    return {
      lambda,
      source: source.label,
      summary,
      theoretical: { mean: 1 / lambda, variance: 1 / lambda ** 2 },
      skewness: skewness(sample),
      median: quantile(sample, 0.5),
      bins,
      histogramRange: { lo, hi },
      testTrue: chiSquareTest(sample, exponential(lambda), { bins: BINS, lo, hi }),
      testEstimated: chiSquareTest(sample, estimated, { bins: BINS, lo, hi }),
      testWrong: chiSquareTest(sample, exponential(lambda * 1.15), { bins: BINS, lo, hi }),
      correlation: correlationTest(sample, [1, 2, 3, 5]),
      sample,
    };
    }),
  );

  return { n, lambdas, experiments };
};

/** Щільність експоненційного закону — для накладання кривої на гістограму. */
export const exponentialPdf = (lambda: number) => (x: number) =>
  x < 0 ? 0 : lambda * Math.exp(-lambda * x);
