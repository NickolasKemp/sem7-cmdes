import { describe, expect, test } from 'bun:test';
import { chiSquareCritical, chiSquarePValue, logGamma, lowerGammaP, mean, variance } from '../src/stats.ts';

describe('спеціальні функції', () => {
  test('logGamma збігається з факторіалом: Γ(5) = 4! = 24', () => {
    expect(Math.exp(logGamma(5))).toBeCloseTo(24, 6);
  });

  test('неповна гамма-функція: P(s, ∞) = 1', () => {
    expect(lowerGammaP(153, Infinity)).toBe(1);
  });
});

describe('критерій χ²', () => {
  // табличні значення χ²_кр для рівня значимості 0,05
  test.each([
    [1, 3.841],
    [5, 11.07],
    [10, 18.307],
    [19, 30.144],
  ])('χ²_кр(k=%i; α=0,05) ≈ %f', (df, expected) => {
    expect(chiSquareCritical(df, 0.05)).toBeCloseTo(expected, 2);
  });

  test('p-значення для χ² = χ²_кр дорівнює рівню значимості', () => {
    expect(chiSquarePValue(chiSquareCritical(7, 0.05), 7)).toBeCloseTo(0.05, 6);
  });
});

describe('описова статистика', () => {
  test('середнє та незміщена дисперсія', () => {
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(xs)).toBe(5);
    expect(variance(xs)).toBeCloseTo(4.571, 3);
  });
});
