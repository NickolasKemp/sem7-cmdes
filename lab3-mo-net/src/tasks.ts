/**
 * Три завдання практикуму: кожна функція будує мережу масового обслуговування з елементів,
 * запускає імітацію і повертає числові результати разом з аналітичними значеннями для порівняння.
 */
import { Create } from './create.ts';
import { Dispose } from './dispose.ts';
import { route, to, type Job } from './element.ts';
import { Model } from './model.ts';
import { Process, type ProcessStats } from './process.ts';
import { createRng, discrete, erlang, exponential, normal, uniform, type Distribution } from './random.ts';
import { estimate, histogram, type Estimate } from './stats.ts';
import { mmc, trafficRates, type QueueTheory } from './theory.ts';

const SEED = 20261019;
const REPLICATIONS = 20;

/** Оцінки показників за незалежними прогонами: для кожного ключа — середнє й 95 % довірчий інтервал. */
const replicate = <K extends string>(runs: readonly Readonly<Record<K, number>>[]): Record<K, Estimate> => {
  const first = runs[0];
  if (!first) throw new Error('потрібен хоча б один прогін');
  const keys = Object.keys(first) as K[];
  return Object.fromEntries(keys.map((k) => [k, estimate(runs.map((r) => r[k]))])) as Record<K, Estimate>;
};

// ───────────────────────────── Завдання 1: перевірка універсального алгоритму ─────────────────────────────

export interface NodeParams {
  readonly name: string;
  readonly mean: number;
  readonly channels: number;
}

/** Мережа Джексона з багатоканальними СМО і поверненням: усі закони експоненційні, черги необмежені. */
export interface NetworkParams {
  readonly createMean: number;
  readonly nodes: readonly NodeParams[];
  /** routing[i][j] — імовірність переходу з СМО i в СМО j; решта — вихід */
  readonly routing: readonly (readonly number[])[];
  readonly time: number;
}

export const JACKSON: NetworkParams = {
  createMean: 1,
  nodes: [
    { name: 'СМО 1', mean: 1.5, channels: 2 },
    { name: 'СМО 2', mean: 1, channels: 1 },
    { name: 'СМО 3', mean: 3, channels: 3 },
  ],
  routing: [
    [0, 0.4, 0.6],
    [0.2, 0, 0],
    [0, 0, 0],
  ],
  time: 1_000_000,
};

export interface Transition {
  readonly from: string;
  readonly to: string;
  readonly p: number;
  readonly observed: number;
}

export interface JacksonResult {
  readonly nodes: readonly ProcessStats[];
  readonly lambdas: readonly number[];
  readonly theory: readonly QueueTheory[];
  readonly transitions: readonly Transition[];
  readonly meanTimeInSystem: number;
  readonly theoryTimeInSystem: number;
  readonly created: number;
}

const runJackson = (): JacksonResult => {
  const { createMean, nodes, routing, time } = JACKSON;
  const rng = createRng(SEED);
  const create = new Create('CREATE', exponential(createMean), rng);
  const smo = nodes.map((n) => new Process(n.name, exponential(n.mean), rng, { channels: n.channels }));
  const dispose = new Dispose('DISPOSE');
  const [s1, s2, s3] = smo;
  if (!s1 || !s2 || !s3) throw new Error('мережа має три СМО');
  create.next = to(s1);
  const routers = smo.map((s, i) => {
    const row = routing[i] ?? [];
    const exit = 1 - row.reduce((a, p) => a + p, 0);
    const arcs = [...row.flatMap((p, j) => (p > 0 ? [{ to: smo[j] ?? s, p }] : [])), ...(exit > 1e-12 ? [{ to: dispose, p: exit }] : [])];
    s.next = route(...arcs);
    return s.next;
  });
  new Model([create, ...smo, dispose]).simulate(time);

  const lambdas = trafficRates([1 / createMean, 0, 0], routing);
  const theory = nodes.map((n, i) => mmc(lambdas[i] ?? 0, n.mean, n.channels, Infinity));
  const transitions = routers.flatMap((r, i) => {
    const total = r.counts.reduce((a, c) => a + c, 0);
    return r.arcs.map((a, k) => ({ from: smo[i]?.name ?? '', to: a.to.name, p: a.p ?? 1, observed: (r.counts[k] ?? 0) / total }));
  });
  const times = dispose.times();
  return {
    nodes: smo.map((s) => s.stats(time)),
    lambdas,
    theory,
    transitions,
    meanTimeInSystem: times.reduce((a, x) => a + x, 0) / times.length,
    // формула Літтла для всієї мережі: W = Σ L_i / γ
    theoryTimeInSystem: theory.reduce((a, t) => a + t.meanInSystem, 0) * createMean,
    created: create.quantity,
  };
};

/** Основний і резервний пристрої (приклад з лекції): маршрут за пріоритетом проти маршруту за ймовірністю. */
export const RESERVE = { createMean: 1, serviceMean: 1.5, maxQueue: 2, time: 200_000 } as const;

export interface ReserveVariant {
  readonly label: string;
  readonly devices: readonly ProcessStats[];
  /** частка вимог, спрямованих маршрутом у кожен пристрій */
  readonly share: readonly number[];
  readonly failureProbability: number;
  /** частка вимог, що застали основний пристрій заповненим (у резерв або у відмову) */
  readonly mainFullShare: number;
  /** аналітичні значення для основного пристрою (за пріоритетом) або для кожного з пристроїв (за ймовірністю) */
  readonly theory: QueueTheory;
}

const runReserve = (mode: 'priority' | 'probability'): ReserveVariant => {
  const { createMean, serviceMean, maxQueue, time } = RESERVE;
  const rng = createRng(SEED + 1);
  const create = new Create('CREATE', exponential(createMean), rng);
  const main = new Process('основний', exponential(serviceMean), rng, { maxQueue });
  const reserve = new Process('резервний', exponential(serviceMean), rng, { maxQueue });
  const dispose = new Dispose('DISPOSE');
  create.next =
    mode === 'priority'
      ? route({ to: main, priority: 2 }, { to: reserve, priority: 1 })
      : route({ to: main, p: 0.5 }, { to: reserve, p: 0.5 });
  main.next = to(dispose);
  reserve.next = to(dispose);
  new Model([create, main, reserve, dispose]).simulate(time);
  const devices = [main.stats(time), reserve.stats(time)];
  const failures = devices.reduce((a, d) => a + d.failures, 0);
  return {
    label: mode === 'priority' ? 'за пріоритетом (основний 2, резервний 1)' : 'за ймовірністю (0,5 / 0,5)',
    devices,
    share: create.next.counts.map((c) => c / create.quantity),
    failureProbability: failures / create.quantity,
    // за пріоритетом основний бачить кожну вимогу; за ймовірністю — лише свою половину, і заповненим його застають ті, кому він відмовив
    mainFullShare: mode === 'priority' ? 1 - (main.arrivals - main.failures) / create.quantity : (devices[0]?.failureProbability ?? 0),
    // за пріоритетом основний пристрій отримує всі вимоги, поки має місце, — це СМО M/M/1/K з повним потоком;
    // за ймовірністю кожен пристрій — M/M/1/K з половиною потоку
    theory: mmc((mode === 'priority' ? 1 : 0.5) / createMean, serviceMean, 1, maxQueue),
  };
};

export const runTask1 = () => ({ jackson: runJackson(), reserve: [runReserve('priority'), runReserve('probability')] });
export type Task1Result = ReturnType<typeof runTask1>;

// ───────────────────────────── Завдання 2: банк з двома під’їзними смугами ─────────────────────────────

export const BANK = {
  arrivalMean: 0.5,
  serviceMean: 0.3,
  /** місць у черзі кожної смуги: на смузі ≤ 3 автомобілі, що очікують, разом з обслуговуваними в банку ≤ 8 */
  maxQueue: 3,
  /** перехід в іншу чергу, якщо вона коротша щонайменше на стільки автомобілів */
  jockeyGap: 2,
  initial: { service: normal(1, 0.3), queue: 2, firstArrival: 0.1 },
  time: 1000,
  replications: REPLICATIONS,
} as const;

/** Тип клієнтів, що були в банку в початковий момент, — їх не враховано в часі перебування. */
const INITIAL_CLIENT = 0;
const initialClient = (): Job => ({ createdAt: 0, origin: INITIAL_CLIENT, type: 1 });

export interface BankTraceRow {
  readonly t: number;
  readonly event: string;
  readonly busy: readonly [number, number];
  readonly queues: readonly [number, number];
  readonly changes: number;
  readonly lost: number;
}

const buildBank = (seed: number, arrivalMean: number = BANK.arrivalMean) => {
  const { serviceMean, maxQueue, jockeyGap, initial } = BANK;
  const rng = createRng(seed);
  const create = new Create('CREATE', exponential(arrivalMean), rng, { firstAt: initial.firstArrival });
  const lanes = [1, 2].map((i) => new Process(`касир ${i}`, exponential(serviceMean), rng, { maxQueue })) as [Process, Process];
  const dispose = new Dispose('DISPOSE');
  const [lane1, lane2] = lanes;
  // клієнт обирає смугу з меншою кількістю автомобілів; за рівності — першу (вищий пріоритет за порядком дуг)
  create.next = route({ to: lane1, priority: () => -lane1.load }, { to: lane2, priority: () => -lane2.load });
  for (const lane of lanes) {
    lane.next = to(dispose);
    lane.startWith(initialClient(), initial.service.sample(rng));
    for (let k = 0; k < initial.queue; k++) lane.enqueue(initialClient());
  }
  let changes = 0;
  /** останній автомобіль довшої черги переїжджає в коротшу, поки різниця не менша за jockeyGap */
  const jockey = (): void => {
    for (;;) {
      const [long, short] = lane1.queueLength >= lane2.queueLength ? [lane1, lane2] : [lane2, lane1];
      if (long.queueLength - short.queueLength < jockeyGap) return;
      const w = long.takeLast();
      if (!w) return;
      short.enqueue(w.job, w.since);
      changes++;
    }
  };
  return { create, lanes, dispose, model: new Model([create, ...lanes, dispose]), jockey, changes: () => changes };
};

type BankMetric = 'u1' | 'u2' | 'inBank' | 'departureInterval' | 'd1' | 'd2' | 'timeInBank' | 'q1' | 'q2' | 'lostShare' | 'changes';

const runBank = (seed: number, arrivalMean: number = BANK.arrivalMean, time: number = BANK.time) => {
  const bank = buildBank(seed, arrivalMean);
  bank.model.simulate(time, bank.jockey);
  const [s1, s2] = bank.lanes.map((l) => l.stats(time)) as [ProcessStats, ProcessStats];
  const times = bank.dispose.times(1);
  const metrics: Record<BankMetric, number> = {
    u1: s1.utilization,
    u2: s2.utilization,
    inBank: s1.meanQueue + s1.meanBusy + s2.meanQueue + s2.meanBusy,
    departureInterval: bank.dispose.intervals.mean,
    d1: s1.departureInterval.mean,
    d2: s2.departureInterval.mean,
    timeInBank: times.reduce((a, x) => a + x, 0) / times.length,
    q1: s1.meanQueue,
    q2: s2.meanQueue,
    lostShare: (s1.failures + s2.failures) / bank.create.quantity,
    changes: bank.changes(),
  };
  return { metrics, lanes: [s1, s2] as const, arrivals: bank.create.quantity, served: bank.dispose.quantity };
};

export const runTask2 = () => {
  const runs = Array.from({ length: BANK.replications }, (_, r) => runBank(SEED + 100 + r));
  const estimates = replicate(runs.map((r) => r.metrics));

  // трасування першого прогону та траєкторії черг для графіка
  const trace: BankTraceRow[] = [];
  const path: { t: number; queues: [number, number]; busy: [number, number] }[] = [];
  const bank = buildBank(SEED + 100);
  const [lane1, lane2] = bank.lanes;
  const snapshot = (t: number, event: string): void => {
    path.push({ t, queues: [lane1.queueLength, lane2.queueLength], busy: [lane1.busyChannels, lane2.busyChannels] });
    if (trace.length < 16) {
      trace.push({
        t,
        event,
        busy: [lane1.busyChannels, lane2.busyChannels],
        queues: [lane1.queueLength, lane2.queueLength],
        changes: bank.changes(),
        lost: lane1.failures + lane2.failures,
      });
    }
  };
  snapshot(0, 'початковий стан');
  bank.model.simulate(BANK.time, (t, fired) => {
    const before = bank.changes();
    bank.jockey();
    snapshot(t, fired.map((e) => (e === bank.create ? 'прибуття' : `від’їзд від вікна ${e === lane1 ? 1 : 2}`)).join(' + ') + (bank.changes() > before ? ', зміна смуги' : ''));
  });

  // ідеальне перешикування робить дві смуги однією спільною чергою — СМО M/M/2/8 як орієнтир
  const reference = mmc(1 / BANK.arrivalMean, BANK.serviceMean, 2, 2 * BANK.maxQueue);

  const sweep = [0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1].map((arrivalMean) => {
    const rs = Array.from({ length: 10 }, (_, r) => runBank(SEED + 200 + r, arrivalMean).metrics);
    return { arrivalMean, ...replicate(rs), reference: mmc(1 / arrivalMean, BANK.serviceMean, 2, 2 * BANK.maxQueue) };
  });

  return { estimates, first: runs[0], trace, path: path.filter((p) => p.t <= 20), reference, sweep };
};
export type Task2Result = ReturnType<typeof runTask2>;

// ───────────────────────────── Завдання 3: приймання хворих у лікарню ─────────────────────────────

export interface PatientType {
  readonly type: number;
  readonly p: number;
  readonly registrationMean: number;
}

export const HOSPITAL = {
  arrivalMean: 15,
  types: [
    { type: 1, p: 0.5, registrationMean: 15 },
    { type: 2, p: 0.1, registrationMean: 40 },
    { type: 3, p: 0.4, registrationMean: 30 },
  ],
  doctors: 2,
  escorts: 3,
  toWard: uniform(3, 8),
  walk: uniform(2, 5),
  labRegistry: erlang(4.5, 3),
  labTechnicians: 2,
  analysis: erlang(4, 2),
  /** 30 діб у хвилинах */
  time: 43_200,
  replications: REPLICATIONS,
} as const;

const registration = (type: number): Distribution => exponential(HOSPITAL.types.find((t) => t.type === type)?.registrationMean ?? NaN);

const buildHospital = (seed: number) => {
  const h = HOSPITAL;
  const rng = createRng(seed);
  const create = new Create('надходження', exponential(h.arrivalMean), rng, { jobType: discrete(...h.types.map((t) => ({ value: t.type, p: t.p }))) });
  const reception = new Process('чергові лікарі', (job: Job) => registration(job.type), rng, {
    channels: h.doctors,
    // лікар насамперед бере тих, хто вже пройшов попереднє обстеження
    queuePriority: (job) => (job.type === 1 ? 1 : 0),
  });
  const escort = new Process('супровідні', h.toWard, rng, { channels: h.escorts });
  const toLab = new Process('перехід у лабораторію', h.walk, rng, { channels: Infinity });
  const labRegistry = new Process('реєстратура лабораторії', h.labRegistry, rng);
  const lab = new Process('лаборанти', h.analysis, rng, { channels: h.labTechnicians });
  const toReception = new Process('перехід у приймальне', h.walk, rng, { channels: Infinity });
  const ward = new Dispose('палата');
  const exit = new Dispose('вихід з лабораторії');

  create.next = to(reception);
  reception.next = route({ to: escort, when: (j) => j.type === 1 }, { to: toLab, when: (j) => j.type !== 1 });
  escort.next = to(ward);
  toLab.next = to(labRegistry);
  labRegistry.next = to(lab);
  lab.next = route({ to: toReception, when: (j) => j.type === 2 }, { to: exit, when: (j) => j.type === 3 });
  // після повернення з лабораторії хворий розглядається як хворий типу 1
  toReception.next = to(reception, { asType: 1 });

  const nodes = [reception, escort, toLab, labRegistry, lab, toReception] as const;
  return { create, nodes, ward, exit, model: new Model([create, ...nodes, ward, exit]) };
};

/** Аналітичні інтенсивності потоків і завантаження: для СМО без відмов ρ = λ·E[S] / c за будь-яких законів розподілу. */
const hospitalTheory = () => {
  const h = HOSPITAL;
  const lambda = 1 / h.arrivalMean;
  const share = (type: number): number => h.types.find((t) => t.type === type)?.p ?? 0;
  const reg = (type: number): number => registration(type).mean;
  const lab = lambda * (share(2) + share(3));
  const returned = lambda * share(2);
  const flows = {
    reception: lambda + returned,
    escort: lambda * share(1) + returned,
    lab,
  };
  const receptionWork = lambda * h.types.reduce((a, t) => a + t.p * t.registrationMean, 0) + returned * reg(1);
  return {
    flows,
    labInterval: 1 / lab,
    utilization: {
      reception: receptionWork / h.doctors,
      escort: (flows.escort * h.toWard.mean) / h.escorts,
      labRegistry: lab * h.labRegistry.mean,
      lab: (lab * h.analysis.mean) / h.labTechnicians,
    },
    /** час у системі без очікування в чергах — сума середніх тривалостей етапів маршруту */
    pureTime: {
      1: reg(1) + h.toWard.mean,
      2: reg(2) + 2 * h.walk.mean + h.labRegistry.mean + h.analysis.mean + reg(1) + h.toWard.mean,
      3: reg(3) + h.walk.mean + h.labRegistry.mean + h.analysis.mean,
    } as Record<number, number>,
  };
};

const runHospital = (seed: number) => {
  const hospital = buildHospital(seed);
  hospital.model.simulate(HOSPITAL.time);
  const [reception, escort, , labRegistry, lab] = hospital.nodes;
  const mean = (xs: readonly number[]): number => xs.reduce((a, x) => a + x, 0) / xs.length;
  const times = { 1: hospital.ward.times(1), 2: hospital.ward.times(2), 3: hospital.exit.times(3) };
  return {
    metrics: {
      time1: mean(times[1]),
      time2: mean(times[2]),
      time3: mean(times[3]),
      labInterval: labRegistry.arrivalIntervals.mean,
      labIntervalDeviation: labRegistry.arrivalIntervals.deviation,
      receptionQueue: reception.stats(HOSPITAL.time).meanQueue,
      receptionWait: reception.stats(HOSPITAL.time).meanWait,
      uReception: reception.stats(HOSPITAL.time).utilization,
      uEscort: escort.stats(HOSPITAL.time).utilization,
      uLabRegistry: labRegistry.stats(HOSPITAL.time).utilization,
      uLab: lab.stats(HOSPITAL.time).utilization,
      flowReception: reception.arrivals / HOSPITAL.time,
      flowEscort: escort.arrivals / HOSPITAL.time,
      flowLab: labRegistry.arrivals / HOSPITAL.time,
    },
    nodes: hospital.nodes.map((n) => n.stats(HOSPITAL.time)),
    times,
    created: hospital.create.quantity,
  };
};

export const runTask3 = () => {
  const runs = Array.from({ length: HOSPITAL.replications }, (_, r) => runHospital(SEED + 300 + r));
  const top = 400;
  const bins = 40;
  const pooled = (type: 1 | 2 | 3): number[] => runs.flatMap((r) => r.times[type]);
  const timeSummary = ([1, 2, 3] as const).map((type) => {
    const xs = pooled(type);
    const sorted = [...xs].sort((a, b) => a - b);
    return {
      type,
      count: xs.length,
      mean: xs.reduce((a, x) => a + x, 0) / xs.length,
      deviation: Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / xs.length - (xs.reduce((a, x) => a + x, 0) / xs.length) ** 2),
      p90: sorted[Math.floor(0.9 * (sorted.length - 1))] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      histogram: histogram(xs, top, bins).map((c) => c / xs.length),
    };
  });
  return { estimates: replicate(runs.map((r) => r.metrics)), first: runs[0], theory: hospitalTheory(), timeSummary, histogramTop: top, histogramBins: bins };
};
export type Task3Result = ReturnType<typeof runTask3>;
