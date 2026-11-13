import { expect, test } from 'bun:test';
import { growthExponent, theoreticalOps } from '../src/complexity.ts';
import { measure } from '../src/experiments.ts';
import { BASE, buildNetwork, networkTheory, type Structure } from '../src/networks.ts';

const visits = (s: Structure, n: number): number => networkTheory(buildNetwork(s, n)).visits;

test('середня довжина маршруту відповідає структурі мережі', () => {
  expect(visits('serial', 40)).toBeCloseTo(40, 9);
  expect(visits('fan', 40)).toBeCloseTo(1, 9);
  expect(visits('tree', 15)).toBeCloseTo(4, 9);
  expect(visits('skip', 300)).toBeCloseTo((2 * 300) / 3 + 2 / 9, 6);
  expect(visits('feedback', 40)).toBeCloseTo(40 / (1 - BASE.feedbackP), 6);
});

test('кількість подій і переглядів дуг у стаціонарному режимі збігається з теоретичною', () => {
  for (const s of ['serial', 'fan', 'tree', 'feedback'] as const) {
    const m = measure(s, 30, { time: 2000 });
    const o = theoreticalOps(s, 30, 1, 2000);
    expect(Math.abs(m.steps - o.events) / o.events).toBeLessThan(0.05);
    expect(Math.abs(m.arcVisits - o.arcVisits) / o.arcVisits).toBeLessThan(0.05);
  }
});

test('показник степеня відновлюється для точної степеневої залежності', () => {
  expect(growthExponent([1, 2, 4, 8].map((n) => [n, 3 * n ** 2] as const))).toBeCloseTo(2, 9);
});
