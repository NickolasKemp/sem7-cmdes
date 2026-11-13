/**
 * Суміш логнормальних складових, параметри якої оцінюються EM-алгоритмом.
 *
 * Мотивація: виміряна затримка сортування виявилась багатомодальною —
 * процесор працює на різних частотах (P-/E-ядра, DVFS), тому «типовий» час
 * групується навколо кількох значень, а зверху додаються рідкісні довгі паузи.
 * Жоден одномодальний закон такі дані описати не може.
 */
import { normalCdf } from './stats.ts';
import type { Distribution } from './distributions.ts';

export interface MixtureComponent {
  readonly weight: number;
  readonly mu: number;
  readonly sigma: number;
}

const normalPdf = (x: number, mu: number, sigma: number): number =>
  Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI));

/** EM-алгоритм для суміші k нормальних складових. */
export const fitNormalMixture = (
  xs: readonly number[],
  k: number,
  iterations = 300,
): MixtureComponent[] => {
  const n = xs.length;
  const sorted = [...xs].sort((a, b) => a - b);
  const spread = ((sorted[n - 1] as number) - (sorted[0] as number)) / (2 * k) || 1;

  // початкове наближення: центри — рівновіддалені квантилі вибірки
  let comps: MixtureComponent[] = Array.from({ length: k }, (_, i) => ({
    weight: 1 / k,
    mu: sorted[Math.min(n - 1, Math.floor(((i + 0.5) / k) * n))] as number,
    sigma: spread,
  }));

  const resp = Array.from({ length: k }, () => new Array<number>(n).fill(0));

  for (let it = 0; it < iterations; it++) {
    // E-крок: апостеріорні ймовірності належності до складових
    for (let i = 0; i < n; i++) {
      const x = xs[i] as number;
      let total = 0;
      for (let c = 0; c < k; c++) {
        const comp = comps[c] as MixtureComponent;
        const value = comp.weight * normalPdf(x, comp.mu, comp.sigma);
        (resp[c] as number[])[i] = value;
        total += value;
      }
      if (total <= 0) continue;
      for (let c = 0; c < k; c++) (resp[c] as number[])[i] = ((resp[c] as number[])[i] as number) / total;
    }

    // M-крок: перерахунок ваг, середніх та дисперсій
    comps = comps.map((_, c) => {
      const r = resp[c] as number[];
      const w = r.reduce((s, v) => s + v, 0);
      const mu = r.reduce((s, v, i) => s + v * (xs[i] as number), 0) / (w || 1);
      const varc = r.reduce((s, v, i) => s + v * ((xs[i] as number) - mu) ** 2, 0) / (w || 1);
      return { weight: w / n, mu, sigma: Math.max(Math.sqrt(varc), 1e-6) };
    });
  }

  return comps.sort((a, b) => a.mu - b.mu);
};

/** Параметри суміші у пласкому вигляді — щоб покласти їх у звіт та JSON. */
export const flattenComponents = (comps: readonly MixtureComponent[]): Record<string, number> =>
  Object.fromEntries(
    comps.flatMap((c, i) => [
      [`w${i + 1}`, c.weight],
      [`mu${i + 1}`, c.mu],
      [`sigma${i + 1}`, c.sigma],
    ]),
  );

export const parseComponents = (params: Readonly<Record<string, number>>): MixtureComponent[] => {
  const comps: MixtureComponent[] = [];
  for (let i = 1; params[`w${i}`] !== undefined; i++) {
    comps.push({
      weight: params[`w${i}`] as number,
      mu: params[`mu${i}`] as number,
      sigma: params[`sigma${i}`] as number,
    });
  }
  return comps;
};

/** Суміш логнормальних складових: EM працює на логарифмах спостережень. */
export const fitLognormalMixture = (xs: readonly number[], k: number): Distribution => {
  const comps = fitNormalMixture(xs.map(Math.log), k);
  return {
    name: `суміш ${k} логнормальних складових (EM)`,
    params: flattenComponents(comps),
    estimated: 3 * k - 1,
    cdf: (x) =>
      x <= 0
        ? 0
        : comps.reduce((s, c) => s + c.weight * normalCdf((Math.log(x) - c.mu) / c.sigma), 0),
  };
};
