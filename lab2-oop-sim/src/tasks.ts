/**
 * Шість завдань практикуму: кожна функція будує модель з елементів, запускає імітацію
 * і повертає числові результати разом з теоретичними значеннями для порівняння.
 */
import { Create } from './create.ts';
import { Dispose } from './dispose.ts';
import { branch, to, type BranchRouter, type Element } from './element.ts';
import { Model } from './model.ts';
import { Process, type ProcessStats } from './process.ts';
import { constant, createRng, erlang, exponential, uniform, type Distribution } from './random.ts';
import { mmc, trafficRates, type QueueTheory } from './theory.ts';

const SEED = 20261001;

// ───────────────────────────── Завдання 1–2: один пристрій ─────────────────────────────

/** Стан моделі CREATE → PROCESS → DISPOSE після кроку імітації (аналог printInfo). */
export interface TraceRow {
  readonly t: number;
  readonly fired: string;
  readonly created: number;
  readonly state: number;
  readonly queue: number;
  readonly served: number;
  readonly failures: number;
}

export interface SingleResult {
  readonly time: number;
  readonly createMean: number;
  readonly serviceMean: number;
  readonly maxQueue: number;
  readonly created: number;
  readonly process: ProcessStats;
  readonly theory: QueueTheory;
  readonly steps: number;
}

/** Модель з методички: CREATE (exp 2) → PROCESS (exp 1, черга ≤ 5) → DISPOSE. */
const buildSingle = (seed: number, createMean = 2, serviceMean = 1, maxQueue = 5) => {
  const rng = createRng(seed);
  const create = new Create('CREATOR', exponential(createMean), rng);
  const process = new Process('PROCESSOR', exponential(serviceMean), rng, { maxQueue });
  const dispose = new Dispose('DISPOSE');
  create.next = to(process);
  process.next = to(dispose);
  return { create, process, model: new Model([create, process, dispose]) };
};

const runSingle = (time: number, seed: number, onEvent?: (row: TraceRow) => void): SingleResult => {
  const { create, process, model } = buildSingle(seed);
  model.simulate(time, (t, fired) =>
    onEvent?.({
      t,
      fired: fired.map((e) => e.name).join(' + '),
      created: create.quantity,
      state: process.busyChannels,
      queue: process.queueLength,
      served: process.quantity,
      failures: process.failures,
    }),
  );
  return {
    time,
    createMean: 2,
    serviceMean: 1,
    maxQueue: 5,
    created: create.quantity,
    process: process.stats(),
    theory: mmc(1 / 2, 1, 1, 5),
    steps: model.steps,
  };
};

export interface Task1Result {
  readonly run: SingleResult;
  readonly trace: readonly TraceRow[];
}

/** Завдання 1: імітація простої моделі (T = 1000, як у методичці) з трасуванням перших кроків. */
export const runTask1 = (): Task1Result => {
  const trace: TraceRow[] = [];
  const run = runSingle(1000, SEED, (row) => void (trace.length < 14 && trace.push(row)));
  return { run, trace };
};

export interface Task2Result {
  /** збіжність середнього завантаження зі збільшенням часу моделювання */
  readonly byTime: readonly SingleResult[];
  /** накопичене середнє завантаження під час одного довгого прогону: [t, U(t)] */
  readonly convergence: readonly (readonly [number, number])[];
  readonly theory: QueueTheory;
}

/** Завдання 2: середнє завантаження пристрою U = (1/T)·∫ state(t) dt. */
export const runTask2 = (): Task2Result => {
  const byTime = [1_000, 10_000, 100_000, 1_000_000].map((time) => runSingle(time, SEED));

  const { process, model } = buildSingle(SEED + 1);
  const convergence: [number, number][] = [];
  let checkpoint = 50;
  model.simulate(20_000, (t) => {
    if (t >= checkpoint) {
      convergence.push([t, process.busyArea / t]);
      checkpoint += 50;
    }
  });
  return { byTime, convergence, theory: mmc(1 / 2, 1, 1, 5) };
};

// ───────────────────────────── Завдання 3–4: три послідовні процеси ─────────────────────────────

export interface StageParams {
  readonly delay: Distribution;
  readonly maxQueue: number;
  readonly channels?: number;
}

export interface ChainParams {
  readonly create: Distribution;
  readonly stages: readonly StageParams[];
  readonly time: number;
  readonly seed: number;
}

export interface ChainResult {
  readonly params: ChainParams;
  readonly created: number;
  readonly stages: readonly ProcessStats[];
  readonly disposed: number;
  readonly meanTimeInSystem: number;
  /** вимоги, що залишились у моделі на кінець моделювання */
  readonly inSystem: number;
}

/** Ланцюг CREATE → PROCESS 1 → … → PROCESS n → DISPOSE (рисунок 2.1). */
const buildChain = ({ create: createDelay, stages, seed }: ChainParams) => {
  const rng = createRng(seed);
  const create = new Create('CREATE', createDelay, rng);
  const processes = stages.map(
    (s, i) => new Process(`PROCESS ${i + 1}`, s.delay, rng, { maxQueue: s.maxQueue, channels: s.channels ?? 1 }),
  );
  const dispose = new Dispose('DISPOSE');
  const route = [create, ...processes, dispose];
  for (const [i, e] of route.entries()) {
    const next = route[i + 1];
    if (next) e.next = to(next);
  }
  return { create, processes, dispose, model: new Model(route) };
};

export const runChain = (params: ChainParams, onEvent?: (t: number, processes: readonly Process[]) => void): ChainResult => {
  const { create, processes, dispose, model } = buildChain(params);
  model.simulate(params.time, onEvent && ((t) => onEvent(t, processes)));
  const stages = processes.map((p) => p.stats());
  return {
    params,
    created: create.quantity,
    stages,
    disposed: dispose.quantity,
    meanTimeInSystem: dispose.meanTimeInSystem,
    inSystem: stages.reduce((s, p) => s + p.inQueue + p.inService, 0),
  };
};

/** Базовий варіант параметрів моделі з рисунка 2.1. */
export const BASE: ChainParams = {
  create: exponential(2),
  stages: [
    { delay: exponential(1), maxQueue: 5 },
    { delay: exponential(1.5), maxQueue: 5 },
    { delay: exponential(1.2), maxQueue: 5 },
  ],
  time: 100_000,
  seed: SEED,
};

export interface Task3Result {
  readonly run: ChainResult;
  /** траєкторія довжин черг і стану пристроїв на початку імітації (для графіка) */
  readonly path: readonly { readonly t: number; readonly queues: readonly number[]; readonly busy: readonly number[] }[];
}

/** Завдання 3: модель з трьох послідовних процесів. */
export const runTask3 = (): Task3Result => {
  const path: { t: number; queues: number[]; busy: number[] }[] = [];
  const run = runChain(BASE, (t, ps) => {
    if (t <= 80) path.push({ t, queues: ps.map((p) => p.queueLength), busy: ps.map((p) => p.busyChannels) });
  });
  return { run, path };
};

/** Перевірка очікуваного напрямку зміни вихідної величини відносно базового варіанта. */
export interface Check {
  readonly label: string;
  readonly ok: boolean;
}

export interface VerificationRow {
  readonly label: string;
  readonly change: string;
  readonly run: ChainResult;
  /** точні значення для PROCESS 1 (на його вхід завжди надходить пуассонівський потік), якщо закони експоненційні */
  readonly firstStageTheory: QueueTheory | null;
  readonly checks: readonly Check[];
}

const withStage = (i: number, patch: Partial<StageParams>): ChainParams => ({
  ...BASE,
  stages: BASE.stages.map((s, k) => (k === i ? { ...s, ...patch } : s)),
});

const withAllStages = (patch: (s: StageParams, i: number) => Partial<StageParams>): ChainParams => ({
  ...BASE,
  stages: BASE.stages.map((s, i) => ({ ...s, ...patch(s, i) })),
});

const isExponential = (d: Distribution): boolean => d.label.startsWith('exp');

const up = (label: string, value: number, base: number): Check => ({ label: `${label} ↑`, ok: value > base });
const down = (label: string, value: number, base: number): Check => ({ label: `${label} ↓`, ok: value < base });
const equals = (label: string, value: number, expected: number, tolerance = 1e-9): Check => ({
  label: `${label} = ${String(expected).replace(".", ",")}`,
  ok: Math.abs(value - expected) <= tolerance,
});

type CheckFn = (run: ChainResult, base: ChainResult) => Check[];

const stage = (r: ChainResult, i: number): ProcessStats => {
  const s = r.stages[i];
  if (!s) throw new Error(`немає процесу ${i + 1}`);
  return s;
};

const fail = (i: number) => `P_відм${i + 1}`;
const queue = (i: number) => `L_черги${i + 1}`;
const load = (i: number) => `U${i + 1}`;

export interface Task4Result {
  readonly rows: readonly VerificationRow[];
  /** перевірка за теорією мереж Джексона для необмежених черг */
  readonly jackson: {
    readonly run: ChainResult;
    readonly theory: readonly QueueTheory[];
    readonly meanTimeInSystem: number;
  };
}

/** Завдання 4: верифікація — змінюємо по одному вхідну змінну чи параметр і порівнюємо з базовим прогоном. */
export const runTask4 = (): Task4Result => {
  const variants: readonly { label: string; change: string; params: ChainParams; checks: CheckFn }[] = [
    { label: 'Базовий', change: 'tc = 2; t1 = 1; t2 = 1,5; t3 = 1,2; черги ≤ 5', params: BASE, checks: () => [] },
    {
      label: 'Інтенсивніший потік',
      change: 'tc = 1',
      params: { ...BASE, create: exponential(1) },
      checks: (r, b) => [0, 1, 2].flatMap((i) => [up(load(i), stage(r, i).utilization, stage(b, i).utilization), up(fail(i), stage(r, i).failureProbability, stage(b, i).failureProbability)]),
    },
    {
      label: 'Рідший потік',
      change: 'tc = 4',
      params: { ...BASE, create: exponential(4) },
      checks: (r, b) => [0, 1, 2].flatMap((i) => [down(load(i), stage(r, i).utilization, stage(b, i).utilization), down(queue(i), stage(r, i).meanQueue, stage(b, i).meanQueue)]),
    },
    {
      label: 'Повільніший PROCESS 1',
      change: 't1 = 2',
      params: withStage(0, { delay: exponential(2) }),
      checks: (r, b) => [
        up(load(0), stage(r, 0).utilization, stage(b, 0).utilization),
        up(fail(0), stage(r, 0).failureProbability, stage(b, 0).failureProbability),
        down(load(1), stage(r, 1).utilization, stage(b, 1).utilization),
        down(load(2), stage(r, 2).utilization, stage(b, 2).utilization),
      ],
    },
    {
      label: 'Повільніший PROCESS 2',
      change: 't2 = 3',
      params: withStage(1, { delay: exponential(3) }),
      checks: (r, b) => [
        up(queue(1), stage(r, 1).meanQueue, stage(b, 1).meanQueue),
        up(fail(1), stage(r, 1).failureProbability, stage(b, 1).failureProbability),
        down(load(2), stage(r, 2).utilization, stage(b, 2).utilization),
      ],
    },
    {
      label: 'Швидший PROCESS 3',
      change: 't3 = 0,6',
      params: withStage(2, { delay: exponential(0.6) }),
      checks: (r, b) => [
        down(load(2), stage(r, 2).utilization, stage(b, 2).utilization),
        down(queue(2), stage(r, 2).meanQueue, stage(b, 2).meanQueue),
        down('W', r.meanTimeInSystem, b.meanTimeInSystem),
      ],
    },
    {
      label: 'Без черг',
      change: 'черги = 0',
      params: withAllStages(() => ({ maxQueue: 0 })),
      checks: (r, b) => [
        ...[0, 1, 2].map((i) => equals(queue(i), stage(r, i).meanQueue, 0)),
        ...[0, 1, 2].map((i) => up(fail(i), stage(r, i).failureProbability, stage(b, i).failureProbability)),
      ],
    },
    {
      label: 'Короткі черги',
      change: 'черги ≤ 1',
      params: withAllStages(() => ({ maxQueue: 1 })),
      checks: (r, b) => [0, 1, 2].flatMap((i) => [up(fail(i), stage(r, i).failureProbability, stage(b, i).failureProbability), { label: `${queue(i)} ≤ 1`, ok: stage(r, i).meanQueue <= 1 }]),
    },
    {
      label: 'Необмежені черги',
      change: 'черги = ∞',
      params: withAllStages(() => ({ maxQueue: Infinity })),
      checks: (r, b) => [
        ...[0, 1, 2].map((i) => equals(fail(i), stage(r, i).failureProbability, 0)),
        ...[0, 1, 2].map((i) => up(queue(i), stage(r, i).meanQueue, stage(b, i).meanQueue)),
      ],
    },
    {
      label: 'Детерміновані затримки',
      change: 'усі затримки сталі',
      params: { ...BASE, create: constant(2), stages: BASE.stages.map((s) => ({ ...s, delay: constant(s.delay.mean) })) },
      checks: (r) => [
        ...[0, 1, 2].map((i) => equals(queue(i), stage(r, i).meanQueue, 0)),
        ...[0, 1, 2].map((i) => equals(fail(i), stage(r, i).failures, 0)),
        ...[0, 1, 2].map((i) => equals(load(i), stage(r, i).utilization, (BASE.stages[i]?.delay.mean ?? 0) / 2, 1e-3)),
      ],
    },
    {
      label: 'Рівномірні затримки',
      change: 'unif з тими самими середніми',
      params: {
        ...BASE,
        create: uniform(1, 3),
        stages: BASE.stages.map((s) => ({ ...s, delay: uniform(s.delay.mean / 2, (s.delay.mean * 3) / 2) })),
      },
      checks: (r, b) => [0, 1, 2].map((i) => down(queue(i), stage(r, i).meanQueue, stage(b, i).meanQueue)),
    },
    {
      label: 'Затримки Ерланга',
      change: 'erlang k = 4 з тими самими середніми',
      params: { ...BASE, create: erlang(2, 4), stages: BASE.stages.map((s) => ({ ...s, delay: erlang(s.delay.mean, 4) })) },
      checks: (r, b) => [0, 1, 2].map((i) => down(queue(i), stage(r, i).meanQueue, stage(b, i).meanQueue)),
    },
    {
      label: 'Два пристрої в PROCESS 2',
      change: 'c2 = 2',
      params: withStage(1, { channels: 2 }),
      checks: (r, b) => [
        down(queue(1), stage(r, 1).meanQueue, stage(b, 1).meanQueue),
        down(fail(1), stage(r, 1).failureProbability, stage(b, 1).failureProbability),
        up(load(2), stage(r, 2).utilization, stage(b, 2).utilization),
      ],
    },
  ];

  const base = runChain(BASE);
  const rows = variants.map((v): VerificationRow => {
    const run = v.params === BASE ? base : runChain(v.params);
    const s1 = v.params.stages[0];
    return {
      label: v.label,
      change: v.change,
      run,
      firstStageTheory:
        s1 && isExponential(v.params.create) && isExponential(s1.delay)
          ? mmc(1 / v.params.create.mean, s1.delay.mean, s1.channels ?? 1, s1.maxQueue)
          : null,
      checks: v.checks(run, base),
    };
  });

  // для необмежених черг ланцюг — мережа Джексона: за теоремою Берка кожен вузол є M/M/1 з тим самим λ
  const unlimited = withAllStages(() => ({ maxQueue: Infinity }));
  const run = runChain({ ...unlimited, time: 1_000_000 });
  const lambda = 1 / unlimited.create.mean;
  const theory = unlimited.stages.map((s) => mmc(lambda, s.delay.mean, 1, Infinity));
  return {
    rows,
    jackson: { run, theory, meanTimeInSystem: theory.reduce((sum, t) => sum + t.meanSojourn, 0) },
  };
};

// ───────────────────────────── Завдання 5: кілька ідентичних пристроїв ─────────────────────────────

export interface MultiChannelRow {
  readonly channels: number;
  readonly maxQueue: number;
  readonly sim: ProcessStats;
  readonly theory: QueueTheory;
}

export interface Task5Result {
  readonly createMean: number;
  readonly serviceMean: number;
  readonly time: number;
  readonly rows: readonly MultiChannelRow[];
}

/** Завдання 5: PROCESS з c ідентичними пристроями — порівняння з формулами M/M/c/K. */
export const runTask5 = (): Task5Result => {
  const createMean = 1;
  const serviceMean = 2.5;
  const time = 200_000;
  const configs = [
    ...[1, 2, 3, 4, 5].map((c) => [c, 5] as const),
    ...[3, 4, 5].map((c) => [c, Infinity] as const),
  ];
  const rows = configs.map(([channels, maxQueue], i): MultiChannelRow => {
    const rng = createRng(SEED + i);
    const create = new Create('CREATE', exponential(createMean), rng);
    const process = new Process(`PROCESS (c=${channels})`, exponential(serviceMean), rng, { channels, maxQueue });
    const dispose = new Dispose('DISPOSE');
    create.next = to(process);
    process.next = to(dispose);
    new Model([create, process, dispose]).simulate(time);
    return { channels, maxQueue, sim: process.stats(), theory: mmc(1 / createMean, serviceMean, channels, maxQueue) };
  });
  return { createMean, serviceMean, time, rows };
};

// ───────────────────────────── Завдання 6: розгалуження та повернення ─────────────────────────────

export interface NodeSpec {
  readonly name: string;
  readonly delay: number;
  readonly channels: number;
}

export interface NetworkRun {
  readonly maxQueue: number;
  readonly created: number;
  readonly disposed: number;
  readonly meanTimeInSystem: number;
  readonly nodes: readonly ProcessStats[];
  /** фактичні частоти переходів по гілках кожного вузла */
  readonly transitions: readonly { readonly from: string; readonly to: string; readonly p: number; readonly observed: number }[];
}

export interface Task6Result {
  readonly createMean: number;
  readonly nodes: readonly NodeSpec[];
  /** routing[i][j] — імовірність переходу з вузла i у вузол j; решта — вихід з моделі */
  readonly routing: readonly (readonly number[])[];
  readonly lambdas: readonly number[];
  readonly theory: readonly QueueTheory[];
  readonly theoryTimeInSystem: number;
  readonly time: number;
  readonly unlimited: NetworkRun;
  readonly limited: NetworkRun;
}

const NODES: readonly NodeSpec[] = [
  { name: 'PROCESS 1', delay: 1.2, channels: 2 },
  { name: 'PROCESS 2', delay: 0.8, channels: 1 },
  { name: 'PROCESS 3', delay: 1.5, channels: 1 },
];

const ROUTING: readonly (readonly number[])[] = [
  [0, 0.7, 0.3], // PROCESS 1 → PROCESS 2 (0,7) або PROCESS 3 (0,3)
  [0.2, 0, 0], //   PROCESS 2 → назад у PROCESS 1 (0,2), інакше DISPOSE (0,8)
  [0.4, 0, 0], //   PROCESS 3 → назад у PROCESS 1 (0,4), інакше DISPOSE (0,6)
];

const runNetwork = (createMean: number, maxQueue: number, time: number, seed: number): NetworkRun => {
  const rng = createRng(seed);
  const create = new Create('CREATE', exponential(createMean), rng);
  const nodes = NODES.map((n) => new Process(n.name, exponential(n.delay), rng, { channels: n.channels, maxQueue }));
  const dispose = new Dispose('DISPOSE');
  create.next = to(nodes[0] ?? dispose);
  const routers: BranchRouter[] = nodes.map((node, i) => {
    const row = ROUTING[i] ?? [];
    const exit = 1 - row.reduce((s, p) => s + p, 0);
    const branches = [
      ...row.flatMap((p, j) => {
        const target: Element | undefined = nodes[j];
        return p > 0 && target ? [{ to: target, p }] : [];
      }),
      ...(exit > 1e-12 ? [{ to: dispose, p: exit }] : []),
    ];
    const router = branch(...branches);
    node.next = router;
    return router;
  });
  new Model([create, ...nodes, dispose]).simulate(time);
  return {
    maxQueue,
    created: create.quantity,
    disposed: dispose.quantity,
    meanTimeInSystem: dispose.meanTimeInSystem,
    nodes: nodes.map((n) => n.stats()),
    transitions: routers.flatMap((r, i) => {
      const total = r.counts.reduce((s, c) => s + c, 0);
      return r.branches.map((b, k) => ({
        from: NODES[i]?.name ?? '',
        to: b.to.name,
        p: b.p,
        observed: total === 0 ? 0 : (r.counts[k] ?? 0) / total,
      }));
    }),
  };
};

/** Завдання 6: мережа з виходом у кілька блоків і поверненням у попередні блоки. */
export const runTask6 = (): Task6Result => {
  const createMean = 1;
  const time = 1_000_000;
  const external = NODES.map((_, i) => (i === 0 ? 1 / createMean : 0));
  const lambdas = trafficRates(external, ROUTING);
  const theory = NODES.map((n, i) => mmc(lambdas[i] ?? 0, n.delay, n.channels, Infinity));
  // формула Літтла для всієї мережі: W = Σ L_i / γ
  const theoryTimeInSystem = theory.reduce((s, t) => s + t.meanInSystem, 0) * createMean;
  return {
    createMean,
    nodes: NODES,
    routing: ROUTING,
    lambdas,
    theory,
    theoryTimeInSystem,
    time,
    unlimited: runNetwork(createMean, Infinity, time, SEED),
    limited: runNetwork(createMean, 3, time, SEED),
  };
};
