/**
 * Завдання 2: z_{i+1} = a·z_i (mod c), x = z/c, a = 5^13, c = 2^31.
 * Гіпотеза — рівномірний закон на (0;1); перевірка за критерієм χ²,
 * додатково — тести на незалежність та оцінка періоду.
 */
import { uniform } from './distributions.ts';
import { chiSquareTest, correlationTest, describe, type ChiSquareResult, type CorrelationResult, type DescriptiveSummary } from './goodness.ts';
import { createLcg, detectPeriod, lcgSample, type LcgParams } from './generators.ts';
import { histogram, type Bin } from './stats.ts';

export interface LcgConfig {
  readonly label: string;
  readonly note: string;
  readonly params: LcgParams;
  /** Період шукаємо перебором лише для невеликих c. */
  readonly detectPeriod: boolean;
  /** Теоретичний максимальний період для цих параметрів. */
  readonly theoreticalPeriod: string;
}

export interface LcgExperiment {
  readonly label: string;
  readonly note: string;
  readonly a: string;
  readonly c: string;
  readonly seed: string;
  readonly summary: DescriptiveSummary;
  readonly theoretical: { readonly mean: number; readonly variance: number };
  readonly bins: readonly Bin[];
  readonly test: ChiSquareResult;
  readonly correlation: readonly CorrelationResult[];
  readonly period: number | null;
  readonly theoreticalPeriod: string;
  /**
   * Частка трійок (zᵢ, zᵢ₊₁, zᵢ₊₂), які задовольняють лінійне співвідношення
   * z_{i+2} = 6·z_{i+1} − 9·z_i (mod c). Для RANDU воно виконується завжди —
   * саме тому всі трійки чисел лежать у 15 площинах одиничного куба.
   */
  readonly planeFraction: number;
  readonly pairs: readonly (readonly [number, number])[];
  readonly sample: readonly number[];
}

export interface Task2Result {
  readonly n: number;
  readonly experiments: readonly LcgExperiment[];
}

const BINS = 20;
const POW = (base: bigint, exp: number): bigint => base ** BigInt(exp);

export const LCG_CONFIGS: readonly LcgConfig[] = [
  {
    label: 'a=5¹³, c=2³¹ (за умовою), z₀=1',
    note: 'базовий варіант із завдання',
    params: { a: POW(5n, 13), c: POW(2n, 31), seed: 1n },
    detectPeriod: false,
    theoreticalPeriod: '2²⁹ = 536 870 912',
  },
  {
    label: 'a=5¹³, c=2³¹, z₀=987654321',
    note: 'та сама пара параметрів, інше початкове значення',
    params: { a: POW(5n, 13), c: POW(2n, 31), seed: 987654321n },
    detectPeriod: false,
    theoreticalPeriod: '2²⁹ = 536 870 912',
  },
  {
    label: 'a=5¹³, c=2²⁴, z₀=1',
    note: 'зменшений модуль — коротший період',
    params: { a: POW(5n, 13), c: POW(2n, 24), seed: 1n },
    detectPeriod: true,
    theoreticalPeriod: '2²² = 4 194 304',
  },
  {
    label: 'a=65539, c=2³¹ (RANDU), z₀=1',
    note: 'класичний «поганий» генератор: точки лягають у площини',
    params: { a: 65539n, c: POW(2n, 31), seed: 1n },
    detectPeriod: false,
    theoreticalPeriod: '2²⁹ = 536 870 912',
  },
  {
    label: 'a=5, c=2¹³, z₀=1',
    note: 'малі параметри — дуже короткий період',
    params: { a: 5n, c: POW(2n, 13), seed: 1n },
    detectPeriod: true,
    theoreticalPeriod: '2¹¹ = 2 048',
  },
];

/** Перевірка лінійного співвідношення, характерного для генератора RANDU. */
export const randuPlaneFraction = (params: LcgParams, n: number): number => {
  const gen = createLcg(params);
  const z: bigint[] = Array.from({ length: n }, () => gen.nextInt());
  let hits = 0;
  for (let i = 0; i + 2 < n; i++) {
    const expected = (6n * (z[i + 1] as bigint) - 9n * (z[i] as bigint) + 9n * params.c) % params.c;
    if (expected === z[i + 2]) hits++;
  }
  return hits / (n - 2);
};

export const runTask2 = (n = 10_000, configs: readonly LcgConfig[] = LCG_CONFIGS): Task2Result => {
  const experiments = configs.map((cfg): LcgExperiment => {
    const sample = lcgSample(cfg.params, n);
    const bins = histogram(sample, BINS, 0, 1);
    const pairs = sample
      .slice(0, 2000)
      .map((x, i, arr): readonly [number, number] => [x, arr[i + 1] ?? 0])
      .slice(0, -1);

    return {
      label: cfg.label,
      note: cfg.note,
      a: cfg.params.a.toString(),
      c: cfg.params.c.toString(),
      seed: cfg.params.seed.toString(),
      summary: describe(sample),
      theoretical: { mean: 0.5, variance: 1 / 12 },
      bins,
      test: chiSquareTest(sample, uniform(0, 1), { bins: BINS, lo: 0, hi: 1 }),
      correlation: correlationTest(sample, [1, 2, 3, 5]),
      period: cfg.detectPeriod ? detectPeriod(cfg.params) : null,
      theoreticalPeriod: cfg.theoreticalPeriod,
      planeFraction: randuPlaneFraction(cfg.params, 5000),
      pairs,
      sample,
    };
  });

  return { n, experiments };
};

export const uniformPdf = () => (): number => 1;
