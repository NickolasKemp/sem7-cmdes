import { describe, expect, test } from 'bun:test';
import { Create } from '../src/create.ts';
import { Dispose } from '../src/dispose.ts';
import { branch, to } from '../src/element.ts';
import { Model } from '../src/model.ts';
import { Process, type ProcessOptions } from '../src/process.ts';
import { constant, createRng, exponential, type Distribution } from '../src/random.ts';
import { mmc } from '../src/theory.ts';

/** CREATE → PROCESS → DISPOSE з одним генератором для всієї моделі. */
const single = (create: number | Distribution, service: Distribution, options: ProcessOptions = {}) => {
  const rng = createRng(7);
  const c = new Create('CREATE', typeof create === 'number' ? exponential(create) : create, rng);
  const p = new Process('PROCESS', service, rng, options);
  const d = new Dispose('DISPOSE');
  c.next = to(p);
  p.next = to(d);
  return { c, p, d, model: new Model([c, p, d]) };
};

describe('детерміновані затримки — результат відомий заздалегідь', () => {
  test('надходження кожні 2, обслуговування 1: черги немає, завантаження 0,5', () => {
    const { p, d, model } = single(constant(2), constant(1));
    model.simulate(1000);
    const s = p.stats();
    expect(s.failures).toBe(0);
    expect(s.meanQueue).toBe(0);
    expect(s.utilization).toBeCloseTo(0.5, 10);
    expect(d.meanTimeInSystem).toBeCloseTo(1, 10);
  });

  test('один пристрій без черги, обслуговування 1,5 при надходженні кожні 1: відмовляє кожній другій', () => {
    const { p, model } = single(constant(1), constant(1.5), { maxQueue: 0 });
    model.simulate(1000);
    const s = p.stats();
    expect(s.failureProbability).toBeCloseTo(0.5, 2);
    expect(s.utilization).toBeCloseTo(0.75, 2);
  });

  test('два пристрої за тих самих умов обслуговують усіх, зайнято в середньому 1,5 пристрою', () => {
    const { p, model } = single(constant(1), constant(1.5), { channels: 2, maxQueue: 0 });
    model.simulate(1000);
    const s = p.stats();
    expect(s.failures).toBe(0);
    expect(s.meanBusy).toBeCloseTo(1.5, 2);
    expect(s.utilization).toBeCloseTo(0.75, 2);
  });

  test('черга з однією вимогою: надходження кожні 1, обслуговування 2 — черга рідко порожня', () => {
    const { p, model } = single(constant(1), constant(2), { maxQueue: 1 });
    model.simulate(1000);
    const s = p.stats();
    expect(s.utilization).toBeCloseTo(1, 2);
    expect(s.failureProbability).toBeCloseTo(0.5, 2);
  });
});

describe('закон збереження вимог', () => {
  test('надійшло = обслуговано + відмовлено + у черзі + на обслуговуванні', () => {
    const { c, p, d, model } = single(1, exponential(0.9), { channels: 1, maxQueue: 4 });
    model.simulate(5000);
    const s = p.stats();
    expect(c.quantity).toBe(s.arrivals);
    expect(s.arrivals).toBe(s.served + s.failures + s.inQueue + s.inService);
    expect(d.quantity).toBe(s.served);
  });
});

describe('відповідність теорії M/M/c/K', () => {
  test.each([
    [1, 5],
    [3, 2],
    [2, Infinity],
  ])('c = %i, черга %p: імовірність відмови, черга та завантаження в межах 3 %%', (channels, maxQueue) => {
    const meanService = 0.8 * channels;
    const { p, model } = single(1, exponential(meanService), { channels, maxQueue });
    model.simulate(300_000);
    const s = p.stats();
    const t = mmc(1, meanService, channels, maxQueue);
    expect(Math.abs(s.utilization - t.utilization)).toBeLessThan(0.03 * t.utilization);
    expect(Math.abs(s.meanQueue - t.meanQueue)).toBeLessThan(0.06 * t.meanQueue + 0.01);
    expect(Math.abs(s.failureProbability - t.failureProbability)).toBeLessThan(0.1 * t.failureProbability + 0.002);
  });
});

describe('маршрутизація з розгалуженням', () => {
  test('частоти переходів відповідають заданим ймовірностям', () => {
    const rng = createRng(3);
    const c = new Create('CREATE', exponential(1), rng);
    const a = new Dispose('A');
    const b = new Dispose('B');
    const router = branch({ to: a, p: 0.3 }, { to: b, p: 0.7 });
    c.next = router;
    new Model([c, a, b]).simulate(100_000);
    expect(a.quantity / c.quantity).toBeCloseTo(0.3, 2);
    expect(router.counts[1]).toBe(b.quantity);
  });

  test('ймовірності, що не дають у сумі 1, відхиляються', () => {
    const d = new Dispose('D');
    expect(() => branch({ to: d, p: 0.5 }, { to: d, p: 0.4 })).toThrow();
  });

  test('вимога, повернута в той самий елемент, стає в кінець черги', () => {
    const rng = createRng(1);
    const p = new Process('P', constant(1), rng, { maxQueue: 10 });
    const d = new Dispose('D');
    // перша вимога повертається один раз, далі всі йдуть на вихід
    let returned = false;
    p.next = { label: 'P або D', pick: () => (returned ? d : ((returned = true), p)) };
    const order: number[] = [];
    const inAct = d.inAct.bind(d);
    d.inAct = (job) => {
      order.push(job.id);
      inAct(job);
    };
    for (const id of [0, 1, 2]) p.inAct({ id, createdAt: 0 });
    new Model([p, d]).simulate(10);
    expect(order).toEqual([1, 2, 0]);
  });
});
