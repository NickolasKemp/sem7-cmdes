/**
 * Генератори випадкових чисел, які досліджуються в роботі.
 */

/** Будь-який генератор рівномірних чисел на (0;1). */
export type UniformGenerator = () => number;

/**
 * Мультиплікативний конгруентний генератор:
 *   z_{i+1} = a * z_i (mod c),  x_{i+1} = z_{i+1} / c
 * Параметри за замовчуванням з умови завдання: a = 5^13, c = 2^31.
 * Множення виконується в BigInt, бо a*z виходить за межі 2^53.
 */
export interface LcgParams {
  readonly a: bigint;
  readonly c: bigint;
  readonly seed: bigint;
  /** Адитивна константа b (за умовою b = 0 — мультиплікативний варіант). */
  readonly b?: bigint;
}

export const createLcg = ({ a, c, seed, b = 0n }: LcgParams) => {
  let z = seed % c;
  const cNum = Number(c);
  return {
    /** Наступне ціле z_i. */
    nextInt(): bigint {
      z = (a * z + b) % c;
      return z;
    },
    /** Наступне нормоване число з інтервалу (0;1). */
    next(): number {
      z = (a * z + b) % c;
      return Number(z) / cNum;
    },
  };
};

/** Вибірка з n нормованих чисел конгруентного генератора. */
export const lcgSample = (params: LcgParams, n: number): number[] => {
  const gen = createLcg(params);
  return Array.from({ length: n }, () => gen.next());
};

/**
 * Довжина періоду послідовності z_i (зупиняється, коли значення повторилось).
 * limit обмежує пошук, щоб не зациклитись на генераторах з величезним періодом.
 */
export const detectPeriod = (params: LcgParams, limit = 5_000_000): number | null => {
  const gen = createLcg(params);
  const seen = new Map<bigint, number>();
  for (let i = 0; i < limit; i++) {
    const z = gen.nextInt();
    const prev = seen.get(z);
    if (prev !== undefined) return i - prev;
    seen.set(z, i);
  }
  return null;
};

/**
 * Метод оберненої функції для експоненційного закону F(x) = 1 - e^{-λx}:
 *   x = -(1/λ)·ln(ξ),  ξ ~ U(0;1)
 */
export const exponentialFrom = (xi: number, lambda: number): number => -Math.log(xi) / lambda;

/** n експоненційно розподілених чисел; джерело рівномірних чисел можна підмінити. */
export const exponentialSample = (
  n: number,
  lambda: number,
  uniform: UniformGenerator = Math.random,
): number[] => {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let u = uniform();
    // ln(0) = -Infinity, тому нуль відкидаємо (інтервал відкритий: (0;1))
    while (u <= 0 || u >= 1) u = uniform();
    out[i] = exponentialFrom(u, lambda);
  }
  return out;
};

/** Стандартний нормальний закон, перетворення Бокса–Мюллера. */
export const standardNormal = (uniform: UniformGenerator = Math.random): number => {
  let u1 = uniform();
  while (u1 <= 0) u1 = uniform();
  const u2 = uniform();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

export const normalSample = (
  n: number,
  mu: number,
  sigma: number,
  uniform: UniformGenerator = Math.random,
): number[] => Array.from({ length: n }, () => mu + sigma * standardNormal(uniform));

/** Логнормальний закон із заданими параметрами логарифма (mu, sigma). */
export const lognormalSample = (
  n: number,
  mu: number,
  sigma: number,
  uniform: UniformGenerator = Math.random,
): number[] => Array.from({ length: n }, () => Math.exp(mu + sigma * standardNormal(uniform)));

/** Гамма-розподіл, алгоритм Марсальї–Цанга (shape k, scale θ). */
export const gammaValue = (shape: number, scale: number, uniform: UniformGenerator = Math.random): number => {
  if (shape < 1) {
    const u = uniform();
    return gammaValue(shape + 1, scale, uniform) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = standardNormal(uniform);
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = uniform();
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v * scale;
  }
};

export const gammaSample = (
  n: number,
  shape: number,
  scale: number,
  uniform: UniformGenerator = Math.random,
): number[] => Array.from({ length: n }, () => gammaValue(shape, scale, uniform));

/**
 * Генератор за емпіричним законом розподілу (табличний метод):
 * кусково-лінійна обернена функція, побудована по відсортованій вибірці.
 */
export const empiricalGenerator = (data: readonly number[], uniform: UniformGenerator = Math.random) => {
  const sorted = [...data].sort((a, b) => a - b);
  const n = sorted.length;
  return (): number => {
    const pos = uniform() * (n - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(n - 1, lo + 1);
    const a = sorted[lo] as number;
    const b = sorted[hi] as number;
    return a + (b - a) * (pos - lo);
  };
};
