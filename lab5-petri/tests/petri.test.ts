import { describe, expect, test } from 'bun:test';
import { conveyorNet, STOCK, stockNet } from '../src/nets.ts';
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

  test('конфлікт розв’язується з заданою ймовірністю, пріоритет переважає ймовірність', () => {
    const net = new Net();
    const source = net.place('генератор', 1);
    const item = net.place('виріб', 0);
    const good = net.place('якісні', 0);
    const bad = net.place('браковані', 0);
    net.transition('надходження', constant(1), { in: [source], out: [source, item] });
    const ok = net.transition('якісний', constant(0), { in: [item], out: [good], probability: 0.9 });
    net.transition('бракований', constant(0), { in: [item], out: [bad], probability: 0.1 });
    const r = simulate(net, { time: 20_000, rng: createRng(2) });
    expect(r.fired(ok) / 20_000).toBeCloseTo(0.9, 1);

    const strict = new Net();
    const s = strict.place('генератор', 1);
    const x = strict.place('виріб', 0);
    const main = strict.place('основний', 0);
    strict.transition('надходження', constant(1), { in: [s], out: [s, x] });
    const high = strict.transition('основний пристрій', constant(0), { in: [x], out: [main], priority: 1, probability: 0.01 });
    strict.transition('резервний пристрій', constant(0), { in: [x], out: [main], probability: 0.99 });
    expect(simulate(strict, { time: 100, rng: createRng(3) }).fired(high)).toBe(100);
  });

  test('багатоканальний перехід приймає стільки маркерів, скільки є у вхідній позиції', () => {
    const net = new Net();
    const queue = net.place('черга', 3);
    const out = net.place('оброблені', 0);
    const serve = net.transition('обробка', constant(2), { in: [queue], out: [out] });
    const r = simulate(net, { time: 3, rng: createRng(4) });
    expect(out.tokens).toBe(3);
    expect(r.busy(serve).mean).toBeCloseTo(2, 6);
  });

  test('інформаційна дуга перевіряє, але не забирає маркер', () => {
    const net = new Net();
    const green = net.place('зелене світло', 1);
    const cars = net.place('черга', 5);
    const passed = net.place('проїхали', 0);
    net.transition('переїзд', constant(1), { in: [cars], out: [passed], info: [green] });
    simulate(net, { time: 2, rng: createRng(5) });
    expect(green.tokens).toBe(1);
    expect(passed.tokens).toBe(5);
  });
});

describe('мережі задач', () => {
  test('конвеєр: деталі надходять зі швидкістю 4 за хвилину', () => {
    const m = conveyorNet();
    const r = simulate(m.net, { time: 1_000, rng: createRng(6) });
    expect(r.fired(m.arrive)).toBe(4_000);
  });

  test('запаси: нестача до контрольного рівня завжди дорівнює 72 − поточний стан запасу', () => {
    const m = stockNet();
    let broken = 0;
    simulate(m.net, {
      time: 520,
      rng: createRng(7),
      onEvent: () => {
        // маркери, що перебувають у переходах з нульовою затримкою, вийдуть у цей самий момент
        const settled = m.net.transitions.every((t) => t.delay.mean > 0 || t.busy === 0);
        if (settled && m.gap.tokens + m.position() !== STOCK.level) broken++;
      },
    });
    expect(broken).toBe(0);
  });
});
