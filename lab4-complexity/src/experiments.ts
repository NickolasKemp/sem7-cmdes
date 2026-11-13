/**
 * Експериментальна оцінка складності: час виконання алгоритму імітації на інтервалі T стаціонарного режиму
 * разом з точним підрахунком подій і елементарних операцій, виконаних за цей інтервал.
 */
import { buildNetwork, networkTheory, type Network, type Structure, STRUCTURES } from './networks.ts';

export const EXPERIMENT = {
  /** тривалість інтервалу, на якому вимірюється час обчислення */
  time: 500,
  /** повтори одного досліду; береться найменший час — він найменше спотворений збиранням сміття і планувальником ОС */
  repeats: 3,
  sizes: [1, 10, 25, 50, 100, 200, 300, 400, 500],
  /** досліди з послідовною мережею фіксованого розміру: залежність від T і від λ */
  fixedN: 100,
  times: [250, 500, 750, 1000, 1250],
  lambdas: [0.5, 1, 1.5, 2, 2.5],
} as const;

export interface Measurement {
  readonly structure: Structure;
  readonly n: number;
  readonly lambda: number;
  readonly time: number;
  /** середня кількість обслуговувань однієї вимоги L */
  readonly visits: number;
  /** теоретична інтенсивність подій ν = λ·(1 + L) */
  readonly nuTheory: number;
  /** кількість кроків алгоритму (моментів подій) за інтервал T */
  readonly steps: number;
  /** кількість звернень до елементів у циклах алгоритму: 4 проходи по N + 2 елементах на кожному кроці */
  readonly elementVisits: number;
  /** кількість переглянутих дуг під час вибору маршруту */
  readonly arcVisits: number;
  readonly ms: number;
}

const routers = ({ create, processes }: Network) => [create, ...processes].flatMap((e) => (e.next ? [e.next] : []));

/** Скільки дуг переглянуто: кожен вибір маршруту проходить усі його дуги. */
const arcVisitsOf = (network: Network): number =>
  routers(network).reduce((sum, r) => sum + r.counts.reduce((a, c) => a + c, 0) * r.arcs.length, 0);

/**
 * Один дослід: мережа спершу виходить у стаціонарний режим (прогрів 2·W, W — середній час перебування вимоги),
 * після чого вимірюється час імітації наступних T одиниць модельного часу.
 */
export const measure = (structure: Structure, n: number, { time = EXPERIMENT.time, lambda = 1 }: { time?: number; lambda?: number } = {}): Measurement => {
  let ms = Infinity;
  let counted: Omit<Measurement, 'ms'> | undefined;
  for (let r = 0; r < EXPERIMENT.repeats; r++) {
    const network = buildNetwork(structure, n, { arrivalMean: 1 / lambda });
    const { visits, sojourn } = networkTheory(network);
    const warmup = 2 * sojourn + 10;
    network.model.simulate(warmup);
    const steps0 = network.model.steps;
    const arcs0 = arcVisitsOf(network);

    const started = performance.now();
    network.model.simulate(warmup + time);
    ms = Math.min(ms, performance.now() - started);

    const steps = network.model.steps - steps0;
    counted = {
      structure,
      n,
      lambda,
      time,
      visits,
      nuTheory: lambda * (1 + visits),
      steps,
      elementVisits: 4 * (n + 2) * steps,
      arcVisits: arcVisitsOf(network) - arcs0,
    };
  }
  if (!counted) throw new Error('кількість повторів має бути додатною');
  return { ...counted, ms };
};

/** Прогрів JIT-компілятора, щоб перші виміряні досліди не включали час компіляції. */
export const warmUpJit = (): void => {
  for (const s of STRUCTURES) buildNetwork(s, 50).model.simulate(300);
};

export interface Series {
  readonly serial: readonly Measurement[];
  readonly byTime: readonly Measurement[];
  readonly byLambda: readonly Measurement[];
  readonly branched: Readonly<Record<Structure, readonly Measurement[]>>;
}

export const runExperiments = (log: (m: Measurement) => void = () => {}): Series => {
  warmUpJit();
  const run = (structure: Structure, n: number, opts?: { time?: number; lambda?: number }): Measurement => {
    const m = measure(structure, n, opts);
    log(m);
    return m;
  };
  const sweep = (s: Structure) => EXPERIMENT.sizes.map((n) => run(s, n));
  const serial = sweep('serial');
  const byTime = EXPERIMENT.times.map((time) => run('serial', EXPERIMENT.fixedN, { time }));
  const byLambda = EXPERIMENT.lambdas.map((lambda) => run('serial', EXPERIMENT.fixedN, { lambda }));
  const branched = { serial, fan: sweep('fan'), tree: sweep('tree'), skip: sweep('skip'), feedback: sweep('feedback') };
  return { serial, byTime, byLambda, branched };
};
