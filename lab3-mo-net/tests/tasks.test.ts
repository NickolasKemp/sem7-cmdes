import { expect, test } from 'bun:test';
import { runTask1, runTask2, runTask3 } from '../src/tasks.ts';

test('мережа Джексона: характеристики СМО збігаються з теорією', () => {
  const { jackson } = runTask1();
  for (const [i, s] of jackson.nodes.entries()) {
    const t = jackson.theory[i];
    if (!t) throw new Error();
    expect(Math.abs(s.utilization - t.utilization)).toBeLessThan(0.01);
    expect(Math.abs(s.meanQueue - t.meanQueue) / t.meanQueue).toBeLessThan(0.05);
  }
});

test('банк: потік на виході дорівнює потоку на вході, перешикування відбувається', () => {
  const { estimates } = runTask2();
  expect(estimates.departureInterval.mean).toBeCloseTo(0.5, 1);
  expect(estimates.changes.mean).toBeGreaterThan(0);
  expect(estimates.u1.mean).toBeGreaterThan(estimates.u2.mean);
});

test('лікарня: інтенсивності потоків і завантаження відповідають маршруту', () => {
  const { estimates, theory } = runTask3();
  expect(estimates.labInterval.mean).toBeCloseTo(theory.labInterval, -1);
  expect(Math.abs(estimates.uReception.mean - theory.utilization.reception)).toBeLessThan(0.03);
  expect(estimates.time1.mean).toBeLessThan(estimates.time3.mean);
});
