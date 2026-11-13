import { describe, expect, test } from 'bun:test';
import { mmc, trafficRates } from '../src/theory.ts';

describe('формули M/M/c/K', () => {
  test('M/M/1/6 при ρ = 0,5: P_відм = (1−ρ)ρ⁶/(1−ρ⁷)', () => {
    const rho = 0.5;
    expect(mmc(0.5, 1, 1, 5).failureProbability).toBeCloseTo(((1 - rho) * rho ** 6) / (1 - rho ** 7), 12);
  });

  test('M/M/1/∞: L_q = ρ²/(1−ρ), W = 1/(μ−λ)', () => {
    const t = mmc(0.5, 1, 1, Infinity);
    expect(t.meanQueue).toBeCloseTo(0.5, 12);
    expect(t.meanSojourn).toBeCloseTo(2, 12);
  });

  test('M/M/2/∞ при a = 1: L_q = 1/3', () => {
    expect(mmc(1, 1, 2, Infinity).meanQueue).toBeCloseTo(1 / 3, 12);
  });

  test('велика скінченна черга наближається до необмеженої', () => {
    expect(mmc(0.9, 1, 1, 500).meanQueue).toBeCloseTo(mmc(0.9, 1, 1, Infinity).meanQueue, 6);
  });

  test('M/M/c/0 — формула Ерланга B', () => {
    // B(c=2, a=1) = (a²/2) / (1 + a + a²/2) = 0,2
    expect(mmc(1, 1, 2, 0).failureProbability).toBeCloseTo(0.2, 12);
  });
});

describe('рівняння балансу потоків', () => {
  test('мережа з поверненнями', () => {
    // λ1 = 1 + 0,2λ2 + 0,4λ3, λ2 = 0,7λ1, λ3 = 0,3λ1  ⇒  λ1 = 1/0,74
    const [l1, l2, l3] = trafficRates(
      [1, 0, 0],
      [
        [0, 0.7, 0.3],
        [0.2, 0, 0],
        [0.4, 0, 0],
      ],
    );
    expect(l1).toBeCloseTo(1 / 0.74, 12);
    expect(l2).toBeCloseTo(0.7 / 0.74, 12);
    expect(l3).toBeCloseTo(0.3 / 0.74, 12);
  });
});
