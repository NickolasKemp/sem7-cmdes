import { describe, expect, test } from 'bun:test';
import { Create } from '../src/create.ts';
import { Dispose } from '../src/dispose.ts';
import { route, to, type Job } from '../src/element.ts';
import { Model } from '../src/model.ts';
import { Process } from '../src/process.ts';
import { constant, createRng, exponential } from '../src/random.ts';

const job = (type = 1): Job => ({ createdAt: 0, origin: type, type });

describe('вибір маршруту', () => {
  test('за пріоритетом: вимога йде в резерв, лише коли основний елемент не може її прийняти', () => {
    const rng = createRng(1);
    const main = new Process('основний', constant(10), rng, { maxQueue: 0 });
    const reserve = new Process('резервний', constant(10), rng, { maxQueue: 0 });
    const r = route({ to: main, priority: 2 }, { to: reserve, priority: 1 });
    expect(r.pick(job(), rng, 'test').to).toBe(main);
    main.inAct(job());
    expect(r.pick(job(), rng, 'test').to).toBe(reserve);
    reserve.inAct(job());
    // обидва зайняті: вибирається найвищий пріоритет, і там вимога отримає відмову
    expect(r.pick(job(), rng, 'test').to).toBe(main);
  });

  test('за ймовірністю: частоти переходів відповідають заданим імовірностям', () => {
    const rng = createRng(2);
    const a = new Dispose('A');
    const b = new Dispose('B');
    const r = route({ to: a, p: 0.3 }, { to: b, p: 0.7 });
    for (let i = 0; i < 100_000; i++) r.pick(job(), rng, 'test');
    expect((r.counts[0] ?? 0) / 100_000).toBeCloseTo(0.3, 2);
  });

  test('рівні пріоритети з імовірностями: вибір за ймовірністю всередині групи', () => {
    const rng = createRng(3);
    const [a, b, c] = ['A', 'B', 'C'].map((n) => new Dispose(n));
    if (!a || !b || !c) throw new Error();
    const r = route({ to: a, p: 0.5, priority: 1 }, { to: b, p: 0.5, priority: 1 }, { to: c, p: 1, priority: 0 });
    for (let i = 0; i < 10_000; i++) r.pick(job(), rng, 'test');
    expect(r.counts[2]).toBe(0);
    expect((r.counts[0] ?? 0) / 10_000).toBeCloseTo(0.5, 1);
  });

  test('умова when відбирає дуги за типом вимоги, asType змінює тип', () => {
    const rng = createRng(4);
    const ward = new Dispose('палата');
    const lab = new Dispose('лабораторія');
    const r = route({ to: ward, when: (j) => j.type === 1 }, { to: lab, when: (j) => j.type !== 1, asType: 1 });
    expect(r.pick(job(1), rng, 'test').to).toBe(ward);
    const arc = r.pick(job(3), rng, 'test');
    expect(arc.to).toBe(lab);
    expect(arc.asType).toBe(1);
    expect(() => route({ to: ward, when: () => false }).pick(job(), rng, 'test')).toThrow();
  });

  test('імовірності мають бути задані для всіх дуг і в сумі давати 1', () => {
    const d = new Dispose('D');
    expect(() => route({ to: d, p: 0.5 }, { to: d })).toThrow();
    expect(() => route({ to: d, p: 0.5 }, { to: d, p: 0.4 })).toThrow();
  });
});

describe('СМО', () => {
  test('пріоритет у черзі: вимога типу 1 обслуговується раніше за тих, хто прийшов до неї', () => {
    const rng = createRng(5);
    const order: number[] = [];
    const p = new Process('лікар', constant(1), rng, { queuePriority: (j) => (j.type === 1 ? 1 : 0) });
    const out = new Dispose('вихід');
    out.inAct = (j) => void order.push(j.type);
    p.next = to(out);
    for (const type of [3, 3, 2, 1]) p.inAct(job(type));
    const model = new Model([p, out]);
    model.simulate(10);
    expect(order).toEqual([3, 1, 3, 2]);
  });

  test('необмежена кількість пристроїв — чиста затримка без черги', () => {
    const rng = createRng(6);
    const create = new Create('C', constant(0.1), rng);
    const walk = new Process('перехід', constant(5), rng, { channels: Infinity });
    const out = new Dispose('D');
    create.next = to(walk);
    walk.next = to(out);
    new Model([create, walk, out]).simulate(1000);
    const s = walk.stats(1000);
    expect(s.meanQueue).toBe(0);
    expect(s.meanBusy).toBeCloseTo(50, 0);
    expect(out.times().every((t) => Math.abs(t - 5) < 1e-9)).toBe(true);
  });

  test('тип вимоги визначає час обслуговування', () => {
    const rng = createRng(7);
    const p = new Process('реєстрація', (j) => constant(j.type * 10), rng, { channels: 3 });
    const out = new Dispose('D');
    p.next = to(out);
    for (const type of [1, 2, 3]) p.inAct(job(type));
    new Model([p, out]).simulate(100);
    expect(out.times(1)).toEqual([10]);
    expect(out.times(3)).toEqual([30]);
  });

  test('багатоканальна СМО M/M/3 з експоненційними затримками відтворює теорію', async () => {
    const { mmc } = await import('../src/theory.ts');
    const rng = createRng(8);
    const create = new Create('C', exponential(1), rng);
    const p = new Process('P', exponential(2.4), rng, { channels: 3 });
    const out = new Dispose('D');
    create.next = to(p);
    p.next = to(out);
    new Model([create, p, out]).simulate(300_000);
    const t = mmc(1, 2.4, 3, Infinity);
    expect(p.stats().utilization).toBeCloseTo(t.utilization, 2);
    expect(Math.abs(p.stats().meanQueue - t.meanQueue) / t.meanQueue).toBeLessThan(0.05);
  });
});
