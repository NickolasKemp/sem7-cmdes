import { describe, expect, test } from 'bun:test';
import { exponential, uniform } from '../src/distributions.ts';
import { chiSquareTest, kolmogorovTest } from '../src/goodness.ts';
import { exponentialSample } from '../src/generators.ts';
import { fitLognormalMixture, fitNormalMixture } from '../src/mixture.ts';

describe('критерій узгодження χ²', () => {
  test('приймає гіпотезу для вибірки з того самого закону', () => {
    const xs = exponentialSample(20_000, 1.5);
    const result = chiSquareTest(xs, exponential(1.5), { bins: 20, lo: 0, hi: 5 });
    expect(result.accepted).toBe(true);
  });

  test('відхиляє гіпотезу для вибірки з іншим параметром λ', () => {
    const xs = exponentialSample(20_000, 1.5);
    const result = chiSquareTest(xs, exponential(3), { bins: 20, lo: 0, hi: 5 });
    expect(result.accepted).toBe(false);
  });

  test('відхиляє рівномірний закон для явно нерівномірної вибірки', () => {
    const xs = Array.from({ length: 5000 }, (_, i) => (i < 4000 ? 0.1 : 0.9));
    expect(chiSquareTest(xs, uniform(0, 1), { bins: 10, lo: 0, hi: 1 }).accepted).toBe(false);
  });
});

describe('λ-критерій Колмогорова', () => {
  test('приймає гіпотезу для вибірки з того самого закону', () => {
    const xs = exponentialSample(500, 1);
    expect(kolmogorovTest(xs, exponential(1)).accepted).toBe(true);
  });
});

describe('EM-алгоритм для суміші', () => {
  test('відновлює параметри двох відомих складових', () => {
    const data = [
      ...Array.from({ length: 4000 }, () => 10 + boxMuller()),
      ...Array.from({ length: 4000 }, () => 30 + 2 * boxMuller()),
    ];
    const [first, second] = fitNormalMixture(data, 2);
    expect(first?.mu).toBeCloseTo(10, 0);
    expect(second?.mu).toBeCloseTo(30, 0);
    expect(first?.weight).toBeCloseTo(0.5, 1);
  });

  test('суміш логнормальних складових має коректну функцію розподілу', () => {
    const dist = fitLognormalMixture(exponentialSample(2000, 1).map((x) => x + 1), 2);
    expect(dist.cdf(0)).toBe(0);
    expect(dist.cdf(1e6)).toBeCloseTo(1, 6);
  });
});

const boxMuller = (): number =>
  Math.sqrt(-2 * Math.log(Math.random() || 1e-12)) * Math.cos(2 * Math.PI * Math.random());
