import { describe, expect, test } from 'bun:test';
import { createLcg, detectPeriod, exponentialFrom, exponentialSample, lcgSample } from '../src/generators.ts';
import { mean, variance } from '../src/stats.ts';

describe('конгруентний генератор', () => {
  test('відтворює послідовність за тим самим початковим значенням', () => {
    const params = { a: 5n ** 13n, c: 2n ** 31n, seed: 7n };
    expect(lcgSample(params, 5)).toEqual(lcgSample(params, 5));
  });

  test('усі значення лежать в інтервалі (0;1)', () => {
    for (const x of lcgSample({ a: 5n ** 13n, c: 2n ** 31n, seed: 1n }, 1000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  test('обчислення відповідає формулі z = a·z (mod c)', () => {
    const gen = createLcg({ a: 7n, c: 11n, seed: 1n });
    expect([gen.nextInt(), gen.nextInt(), gen.nextInt()]).toEqual([7n, 5n, 2n]);
  });

  test('період для a=5, c=2¹³ дорівнює 2048', () => {
    expect(detectPeriod({ a: 5n, c: 2n ** 13n, seed: 1n })).toBe(2048);
  });
});

describe('метод оберненої функції', () => {
  test('перетворення узгоджене з функцією розподілу F(x) = 1 − e^(−λx)', () => {
    const lambda = 2;
    const xi = 0.25;
    const x = exponentialFrom(xi, lambda);
    // ξ = e^(−λx) ⇒ підставляння назад має повернути вихідне число
    expect(Math.exp(-lambda * x)).toBeCloseTo(xi, 12);
  });

  test('вибіркові середнє і дисперсія близькі до 1/λ та 1/λ²', () => {
    const xs = exponentialSample(50_000, 4);
    expect(mean(xs)).toBeCloseTo(0.25, 2);
    expect(variance(xs)).toBeCloseTo(0.0625, 2);
  });
});
