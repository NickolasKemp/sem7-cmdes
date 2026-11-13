/** Прогони мереж Петрі чотирьох задач: незалежні повтори з різними seed і оцінки з 95 % довірчим інтервалом. */
import { BUSES, busNet, CONVEYOR, conveyorNet, fmsNet, STOCK, stockNet, type Assignment } from './nets.ts';
import { simulate } from './petri.ts';
import { createRng } from './random.ts';
import { estimate, type Estimate } from './stats.ts';

const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);

/** Оцінки за кожною характеристикою, отриманою в кожному з `runs` прогонів. */
const replicate = <K extends string>(runs: number, seed: number, run: (seed: number) => Record<K, number>): Record<K, Estimate> => {
  const samples = Array.from({ length: runs }, (_, i) => run(seed + i));
  const first = samples[0];
  if (!first) throw new Error('потрібен хоча б один прогін');
  return Object.fromEntries(Object.keys(first).map((k) => [k, estimate(samples.map((s) => s[k as K]))])) as Record<K, Estimate>;
};

// ─────────────────────────────── Задача 1

export const CONVEYOR_RUN = { time: 10_000, warmup: 1_000, runs: 20, seed: 101 } as const;

export const conveyorExperiment = () => {
  const { time, warmup, runs, seed } = CONVEYOR_RUN;
  const model = conveyorNet();
  const busyLevels = Array.from({ length: CONVEYOR.devices + 1 }, (_, k) => k);
  const deviceKeys = model.serve.map((_, i) => i);
  return replicate(runs, seed, (s) => {
    const r = simulate(model.net, { time, warmup, rng: createRng(s), gauges: { inSystem: model.inSystem, busy: model.busyDevices } });
    const served = model.serve.map((t) => r.fired(t));
    const throughput = sum(served) / r.span;
    return {
      arrivals: r.fired(model.arrive) / r.span,
      throughput,
      inSystem: r.gauge.inSystem.mean,
      sojourn: r.gauge.inSystem.mean / throughput,
      busy: r.gauge.busy.mean,
      busyMax: r.gauge.busy.max,
      returns: r.fired(model.ret) / sum(served),
      ...Object.fromEntries(deviceKeys.map((i) => [`load${i + 1}`, r.busy(model.serve[i] ?? model.arrive).mean])),
      ...Object.fromEntries(deviceKeys.map((i) => [`share${i + 1}`, (served[i] ?? 0) / sum(served)])),
      ...Object.fromEntries(busyLevels.map((k) => [`busy${k}`, r.gauge.busy.share(k)])),
    };
  });
};
export type ConveyorResult = ReturnType<typeof conveyorExperiment>;

// ─────────────────────────────── Задача 2

export const FMS_RUN = { time: 200_000, warmup: 20_000, runs: 10, seed: 202, arrivals: [70, 60, 55, 50, 45, 40, 35] } as const;

export const fmsRun = (assignment: Assignment, arrival: number) => {
  const { time, warmup, runs, seed } = FMS_RUN;
  const m = fmsNet(assignment, arrival);
  return replicate(runs, seed, (s) => {
    const r = simulate(m.net, {
      time,
      warmup,
      rng: createRng(s),
      gauges: { inSystem: () => m.arrive.fired - m.store.fired, robots: m.robotBusy },
    });
    const throughput = r.fired(m.store) / r.span;
    return {
      perHour: throughput * 3600,
      sojourn: r.gauge.inSystem.mean / throughput,
      inSystem: r.gauge.inSystem.mean,
      waitingAtArrival: r.place(m.ready.А).mean,
      robots: r.gauge.robots.mean / 3,
      machine1: r.busy(m.machine1).mean / 3,
      machine2: r.busy(m.machine2).mean / 3,
      occupied1: 1 - r.place(m.slots.В1).mean / 3,
      occupied2: 1 - r.place(m.slots.В2).mean / 3,
    };
  });
};
export type FmsResult = ReturnType<typeof fmsRun>;

export const fmsExperiment = () =>
  Object.fromEntries((['fixed', 'nearest'] as const).map((a) => [a, FMS_RUN.arrivals.map((arrival) => ({ arrival, result: fmsRun(a, arrival) }))])) as Record<
    Assignment,
    { arrival: number; result: FmsResult }[]
  >;

// ─────────────────────────────── Задача 3

export const BUS_RUN = { runs: 200, seed: 303, seats: Array.from({ length: 21 }, (_, i) => i + 5) } as const;

export const busRun = (seats: number) => {
  const m = busNet(seats);
  return replicate(BUS_RUN.runs, BUS_RUN.seed, (s) => {
    const r = simulate(m.net, { time: BUSES.day, rng: createRng(s) });
    const boarded = r.fired(m.a.board) + r.fired(m.b.board);
    const lost = r.fired(m.leave);
    return {
      wait: (r.place(m.queue).mean * r.span) / boarded,
      queue: r.place(m.queue).mean,
      boarded,
      lost,
      revenue: boarded * BUSES.fare,
      lostRevenue: lost * BUSES.fare,
      tripsA: r.fired(m.a.depart),
      tripsB: r.fired(m.b.depart),
      shareA: r.fired(m.a.board) / boarded,
    };
  });
};
export type BusResult = ReturnType<typeof busRun>;

export const busExperiment = () => BUS_RUN.seats.map((seats) => ({ seats, result: busRun(seats) }));

// ─────────────────────────────── Задача 4

export const STOCK_RUN = { time: 520, runs: 30, seed: 404, traceWeeks: 104 } as const;

export const stockExperiment = () => {
  const m = stockNet();
  const result = replicate(STOCK_RUN.runs, STOCK_RUN.seed, (s) => {
    const r = simulate(m.net, { time: STOCK_RUN.time, rng: createRng(s) });
    const lost = r.fired(m.refuse);
    const demand = r.fired(m.arrive);
    return {
      stock: r.place(m.stock).mean,
      backlog: r.place(m.backlog).mean,
      lost,
      lostPerYear: (lost / r.span) * 52,
      betweenLost: r.span / lost,
      lostShare: lost / demand,
      backorderShare: r.fired(m.wait) / demand,
      orders: (r.fired(m.close) / r.span) * 52,
      orderSize: r.fired(m.topUp) / r.fired(m.close),
      stockouts: r.place(m.stock).share(0),
    };
  });

  // траєкторія одного прогону: стан запасу і поточний стан запасу з урахуванням замовлень
  const trace: [number, number, number][] = [[0, STOCK.level, STOCK.level]];
  simulate(m.net, {
    time: STOCK_RUN.traceWeeks,
    rng: createRng(STOCK_RUN.seed),
    onEvent: (t) => void trace.push([t, m.stock.tokens, m.position()]),
  });
  return { result, trace };
};
export type StockResult = ReturnType<typeof stockExperiment>;
