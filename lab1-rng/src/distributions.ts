/** Теоретичні закони розподілу: функції розподілу та оцінка параметрів за вибіркою. */
import { lowerGammaP, mean, min as sampleMin, normalCdf, skewness, variance, type Sample } from './stats.ts';

export interface Distribution {
  readonly name: string;
  /** Параметри у вигляді, придатному для звіту. */
  readonly params: Readonly<Record<string, number>>;
  /** Кількість оцінених за вибіркою параметрів — зменшує число ступенів вільності χ². */
  readonly estimated: number;
  readonly cdf: (x: number) => number;
}

export const exponential = (lambda: number, estimated = 0): Distribution => ({
  name: 'експоненційний',
  params: { lambda },
  estimated,
  cdf: (x) => (x <= 0 ? 0 : 1 - Math.exp(-lambda * x)),
});

export const uniform = (a: number, b: number, estimated = 0): Distribution => ({
  name: 'рівномірний',
  params: { a, b },
  estimated,
  cdf: (x) => (x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a)),
});

export const normal = (mu: number, sigma: number, estimated = 2): Distribution => ({
  name: 'нормальний',
  params: { mu, sigma },
  estimated,
  cdf: (x) => normalCdf((x - mu) / sigma),
});

export const lognormal = (mu: number, sigma: number, estimated = 2): Distribution => ({
  name: 'логнормальний',
  params: { mu, sigma },
  estimated,
  cdf: (x) => (x <= 0 ? 0 : normalCdf((Math.log(x) - mu) / sigma)),
});

export const gamma = (shape: number, scale: number, estimated = 2): Distribution => ({
  name: 'гамма',
  params: { shape, scale },
  estimated,
  cdf: (x) => (x <= 0 ? 0 : lowerGammaP(shape, x / scale)),
});

/** Зсунутий експоненційний закон: F(x) = 1 - e^{-λ(x-shift)}. */
export const shiftedExponential = (lambda: number, shift: number, estimated = 2): Distribution => ({
  name: 'зсунутий експоненційний',
  params: { lambda, shift },
  estimated,
  cdf: (x) => (x <= shift ? 0 : 1 - Math.exp(-lambda * (x - shift))),
});

/** Тripараметричні закони: той самий закон, зсунутий уздовж осі на shift. */
export const shiftedGamma = (shape: number, scale: number, shift: number, estimated = 3): Distribution => ({
  name: 'зсунутий гамма',
  params: { shape, scale, shift },
  estimated,
  cdf: (x) => (x <= shift ? 0 : lowerGammaP(shape, (x - shift) / scale)),
});

export const shiftedLognormal = (mu: number, sigma: number, shift: number, estimated = 3): Distribution => ({
  name: 'зсунутий логнормальний',
  params: { mu, sigma, shift },
  estimated,
  cdf: (x) => (x <= shift ? 0 : normalCdf((Math.log(x - shift) - mu) / sigma)),
});

/**
 * Складений («тіло + хвіст») закон розподілу.
 * Тіло — логнормальний закон, зрізаний у точці t, хвіст — експоненційний від t.
 * Такий опис відповідає фізиці вимірювання: типовий час роботи алгоритму
 * плюс рідкісні довгі паузи (складальник сміття, планувальник ОС).
 */
export const bodyTailMixture = (
  mu: number,
  sigma: number,
  threshold: number,
  lambda: number,
  p: number,
): Distribution => {
  const bodyCdf = (x: number): number => (x <= 0 ? 0 : normalCdf((Math.log(x) - mu) / sigma));
  const norm = bodyCdf(threshold) || 1;
  return {
    name: 'складений (логнормальне тіло + експоненційний хвіст)',
    params: { mu, sigma, threshold, lambda, p },
    estimated: 4,
    cdf: (x) =>
      x <= threshold
        ? p * (bodyCdf(x) / norm)
        : p + (1 - p) * (1 - Math.exp(-lambda * (x - threshold))),
  };
};

// --- оцінка параметрів за методом моментів -------------------------------

export const fitExponential = (xs: Sample): Distribution => exponential(1 / mean(xs), 1);

export const fitNormal = (xs: Sample): Distribution => normal(mean(xs), Math.sqrt(variance(xs)));

export const fitLognormal = (xs: Sample): Distribution => {
  const logs = xs.map(Math.log);
  return lognormal(mean(logs), Math.sqrt(variance(logs)));
};

export const fitGamma = (xs: Sample): Distribution => {
  const m = mean(xs);
  const v = variance(xs);
  return gamma(m ** 2 / v, v / m);
};

export const fitShiftedExponential = (xs: Sample): Distribution => {
  const m = mean(xs);
  const lo = sampleMin(xs);
  // зсув — мінімум вибірки, інтенсивність — з середнього перевищення над зсувом
  return shiftedExponential(1 / (m - lo || 1e-12), lo);
};

/**
 * Тріпараметричний гамма-закон за методом моментів:
 * форма k = 4/γ₁², масштаб θ = √(S²/k), зсув = x̄ − k·θ.
 */
export const fitShiftedGamma = (xs: Sample): Distribution => {
  const g = skewness(xs);
  const v = variance(xs);
  const m = mean(xs);
  if (g <= 0.05) return fitGamma(xs);
  const shape = 4 / g ** 2;
  const scale = Math.sqrt(v / shape);
  return shiftedGamma(shape, scale, m - shape * scale);
};

/**
 * Оцінка складеного закону: межу t беремо на рівні квантиля q,
 * параметри тіла — за значеннями нижче t, інтенсивність хвоста — за перевищеннями над t.
 */
export const fitBodyTail = (xs: Sample, q = 0.9): Distribution => {
  const sorted = [...xs].sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * q)] ?? sorted[sorted.length - 1] ?? 0;
  const body = sorted.filter((x) => x <= threshold);
  const tail = sorted.filter((x) => x > threshold);
  const logs = body.map(Math.log);
  const excess = tail.length ? mean(tail.map((x) => x - threshold)) : 1;
  return bodyTailMixture(
    mean(logs),
    Math.sqrt(variance(logs)),
    threshold,
    1 / excess,
    body.length / sorted.length,
  );
};

/** Логнормальний закон зі зсувом: зсув беремо трохи меншим за мінімум вибірки. */
export const fitShiftedLognormal = (xs: Sample): Distribution => {
  const lo = sampleMin(xs);
  const shift = lo - (mean(xs) - lo) * 0.05;
  const logs = xs.map((x) => Math.log(x - shift));
  return shiftedLognormal(mean(logs), Math.sqrt(variance(logs)), shift);
};
