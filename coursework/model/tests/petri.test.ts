import { describe, expect, test } from 'bun:test';
import { Net, simulate } from '../src/petri.ts';
import { constant, createRng, exponential } from '../src/random.ts';

describe('алгоритм імітації стохастичної мережі Петрі', () => {
  test('СМО M/M/1 як мережа Петрі відтворює теоретичні завантаження й довжину черги', () => {
    const net = new Net();
    const source = net.place('генератор', 1);
    const queue = net.place('черга', 0);
    const free = net.place('пристрій вільний', 1);
    const done = net.place('обслуговано', 0);
    net.transition('надходження', exponential(1), { in: [source], out: [source, queue] });
    const serve = net.transition('обслуговування', exponential(0.5), { in: [queue, free], out: [free, done] });
    const r = simulate(net, { time: 200_000, warmup: 1_000, rng: createRng(1) });
    // ρ = 0,5; Lq = ρ² / (1 − ρ) = 0,5
    expect(r.busy(serve).mean).toBeCloseTo(0.5, 1);
    expect(r.place(queue).mean).toBeCloseTo(0.5, 1);
  });

  test('пріоритет переважає ймовірність запуску', () => {
    const net = new Net();
    const source = net.place('генератор', 1);
    const item = net.place('виріб', 0);
    const done = net.place('оброблені', 0);
    net.transition('надходження', constant(1), { in: [source], out: [source, item] });
    const high = net.transition('основний', constant(0), { in: [item], out: [done], priority: 1, probability: 0.01 });
    net.transition('резервний', constant(0), { in: [item], out: [done], probability: 0.99 });
    expect(simulate(net, { time: 100, rng: createRng(3) }).fired(high)).toBe(100);
  });

  test('багатоканальний перехід приймає стільки маркерів, скільки є у вхідній позиції', () => {
    const net = new Net();
    const queue = net.place('черга', 3);
    const out = net.place('оброблені', 0);
    const serve = net.transition('обробка', constant(2), { in: [queue], out: [out] });
    const r = simulate(net, { time: 3, rng: createRng(4) });
    expect(out.count).toBe(3);
    expect(r.busy(serve).mean).toBeCloseTo(2, 6);
  });
});

describe('маркери-об’єкти', () => {
  /** Генератор кожну хвилину створює об’єкт і кладе його копії в дві позиції. */
  const twoCopies = () => {
    const net = new Net();
    const source = net.place('генератор', 1);
    const a = net.place('A', 0);
    const b = net.place('B', 0);
    net.transition('надходження', constant(1), { in: [source], out: [source, { place: a, carry: true }, { place: b, carry: true }], spawn: true });
    return { net, a, b };
  };

  test('генератор створює об’єкти з новими номерами і моментом появи', () => {
    const { net, a } = twoCopies();
    simulate(net, { time: 3, rng: createRng(1) });
    expect(a.tokens).toEqual([
      { id: 1, born: 1 },
      { id: 2, born: 2 },
      { id: 3, born: 3 },
    ]);
  });

  test('дуги match беруть маркери одного об’єкта, навіть якщо він не перший у черзі', () => {
    const { net, a, b } = twoCopies();
    const pairs = net.place('пари', 0);
    net.transition('пара', constant(0), { in: [{ place: a, match: true }, { place: b, match: true }], out: [{ place: pairs, carry: true }] });
    // одноразово прибираємо з B перший об’єкт: парою стане другий, хоча в A першим стоїть перший
    const once = net.place('дозвіл', 1);
    net.transition('забрати з B', constant(0), { in: [once, { place: b, match: true }], out: [net.place('скинуті', 0)], priority: 1 });
    simulate(net, { time: 2, rng: createRng(1) });
    expect(pairs.tokens.map((tk) => tk.id)).toEqual([2]);
    expect(a.tokens.map((tk) => tk.id)).toEqual([1]);
  });

  test('інформаційна дуга match перевіряє наявність саме цього об’єкта і не забирає його', () => {
    const { net, a, b } = twoCopies();
    const seen = net.place('помічені', 0);
    net.transition('помітити', constant(0), { in: [{ place: b, match: true }], info: [{ place: a, match: true }], out: [{ place: seen, carry: true }] });
    simulate(net, { time: 2, rng: createRng(1) });
    expect(seen.tokens.map((tk) => tk.id)).toEqual([1, 2]);
    expect(a.tokens.map((tk) => tk.id)).toEqual([1, 2]);
  });
});
