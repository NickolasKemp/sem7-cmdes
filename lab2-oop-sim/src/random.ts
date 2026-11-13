/**
 * Джерело випадкових чисел і закони розподілу часових затримок (аналог класу FunRand).
 * Генератор з початковим значенням (seed) робить кожен експеримент відтворюваним.
 */

/** Генератор рівномірно розподілених чисел на інтервалі (0; 1). */
export type Rng = () => number;

/** Генератор mulberry32: 32-бітний стан, період 2³², достатньо якісний для імітації. */
export const createRng = (seed: number): Rng => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    // нуль виключаємо, щоб ln(ξ) був скінченним
    return u === 0 ? 0.5 / 4294967296 : u;
  };
};

/** Закон розподілу часової затримки: опис для звіту, математичне сподівання та генерування значення. */
export interface Distribution {
  readonly label: string;
  readonly mean: number;
  readonly sample: (rng: Rng) => number;
}

/** Експоненційний закон із середнім `mean`: x = −mean·ln(ξ). */
export const exponential = (mean: number): Distribution => ({
  label: `exp(${mean})`,
  mean,
  sample: (rng) => -mean * Math.log(rng()),
});

/** Рівномірний закон на інтервалі [min; max]. */
export const uniform = (min: number, max: number): Distribution => ({
  label: `unif(${min}; ${max})`,
  mean: (min + max) / 2,
  sample: (rng) => min + rng() * (max - min),
});

/**
 * Нормальний закон (метод Бокса — Мюллера). Затримка не може бути від’ємною,
 * тому від’ємні значення відкидаються й генеруються повторно (усічений нормальний закон).
 */
export const normal = (mean: number, deviation: number): Distribution => ({
  label: `norm(${mean}; ${deviation})`,
  mean,
  sample: (rng) => {
    for (;;) {
      const x = mean + deviation * Math.sqrt(-2 * Math.log(rng())) * Math.cos(2 * Math.PI * rng());
      if (x >= 0) return x;
    }
  },
});

/** Закон Ерланга k-го порядку із середнім `mean` — сума k експоненційних величин. */
export const erlang = (mean: number, k: number): Distribution => ({
  label: `erlang(${mean}; k=${k})`,
  mean,
  sample: (rng) => {
    let product = 1;
    for (let i = 0; i < k; i++) product *= rng();
    return (-mean / k) * Math.log(product);
  },
});

/** Детермінована (стала) затримка — зручна для перевірки моделі вручну. */
export const constant = (value: number): Distribution => ({
  label: `const(${value})`,
  mean: value,
  sample: () => value,
});
