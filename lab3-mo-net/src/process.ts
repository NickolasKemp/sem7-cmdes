/**
 * Система масового обслуговування (СМО): c ідентичних пристроїв зі спільною чергою.
 * Черга може бути обмеженою, вибір з черги — FIFO або за пріоритетом типу вимоги,
 * час обслуговування може залежати від типу вимоги. c = Infinity — чиста затримка (наприклад, час переходу).
 */
import { Element, type Job } from './element.ts';
import type { Distribution, Rng } from './random.ts';
import { Accumulator, type Summary } from './stats.ts';

interface Channel {
  readonly job: Job;
  /** момент завершення обслуговування */
  readonly tnext: number;
}

/** Вимога в черзі разом з моментом постановки в чергу. */
export interface Waiting {
  readonly job: Job;
  readonly since: number;
}

export interface ProcessOptions {
  /** кількість ідентичних пристроїв обслуговування, за замовчуванням 1 */
  readonly channels?: number;
  /** максимальна довжина черги, за замовчуванням необмежена */
  readonly maxQueue?: number;
  /** пріоритет вибору з черги: більше значення обслуговується раніше, за рівного пріоритету — FIFO */
  readonly queuePriority?: (job: Job) => number;
}

/** Час обслуговування: один закон для всіх вимог або закон, що залежить від вимоги (її типу). */
export type Delay = Distribution | ((job: Job) => Distribution);

/** Підсумкові характеристики СМО за час моделювання. */
export interface ProcessStats {
  readonly name: string;
  readonly channels: number;
  readonly maxQueue: number;
  readonly arrivals: number;
  readonly served: number;
  readonly failures: number;
  /** імовірність відмови = відмови / надходження */
  readonly failureProbability: number;
  /** середня довжина черги = ∫ q(t) dt / T */
  readonly meanQueue: number;
  /** середня кількість зайнятих пристроїв = ∫ b(t) dt / T */
  readonly meanBusy: number;
  /** середнє завантаження одного пристрою = meanBusy / channels */
  readonly utilization: number;
  /** середній час очікування в черзі серед вимог, що почали обслуговування */
  readonly meanWait: number;
  readonly maxQueueObserved: number;
  /** інтервали між послідовними надходженнями та виходами */
  readonly arrivalInterval: Summary;
  readonly departureInterval: Summary;
}

export class Process extends Element {
  readonly channels: number;
  readonly maxQueue: number;
  arrivals = 0;
  failures = 0;
  queueArea = 0;
  busyArea = 0;
  waitTotal = 0;
  started = 0;
  maxQueueObserved = 0;
  readonly arrivalIntervals = new Accumulator();
  readonly departureIntervals = new Accumulator();
  #lastArrival = NaN;
  #lastDeparture = NaN;
  #busy: Channel[] = [];
  readonly #queue: Waiting[] = [];
  readonly #queuePriority: ((job: Job) => number) | undefined;

  constructor(
    name: string,
    readonly delay: Delay,
    rng: Rng,
    { channels = 1, maxQueue = Infinity, queuePriority }: ProcessOptions = {},
  ) {
    super(name, rng);
    if (!(channels === Infinity || (Number.isInteger(channels) && channels >= 1))) throw new Error(`некоректна кількість каналів: ${channels}`);
    this.channels = channels;
    this.maxQueue = maxQueue;
    this.#queuePriority = queuePriority;
  }

  get queueLength(): number {
    return this.#queue.length;
  }

  get busyChannels(): number {
    return this.#busy.length;
  }

  /** кількість вимог у СМО: в черзі та на обслуговуванні */
  get load(): number {
    return this.#queue.length + this.#busy.length;
  }

  override canAccept(): boolean {
    return this.#busy.length < this.channels || this.#queue.length < this.maxQueue;
  }

  override inAct(job: Job): void {
    this.arrivals++;
    if (!Number.isNaN(this.#lastArrival)) this.arrivalIntervals.add(this.tcurr - this.#lastArrival);
    this.#lastArrival = this.tcurr;
    if (this.#busy.length < this.channels) this.#start(job);
    else if (this.#queue.length < this.maxQueue) this.enqueue(job);
    else this.failures++;
  }

  override outAct(): void {
    const done = this.#busy.filter((c) => c.tnext <= this.tcurr);
    this.#busy = this.#busy.filter((c) => c.tnext > this.tcurr);
    for (const _ of done) {
      this.quantity++;
      if (!Number.isNaN(this.#lastDeparture)) this.departureIntervals.add(this.tcurr - this.#lastDeparture);
      this.#lastDeparture = this.tcurr;
    }
    // звільнені канали спершу забирають вимоги з черги, і лише потім готові вимоги йдуть далі:
    // так вимога, що повертається в цю саму СМО, не обійде тих, хто вже чекає
    while (this.#busy.length < this.channels) {
      const w = this.#take();
      if (!w) break;
      this.waitTotal += this.tcurr - w.since;
      this.#start(w.job);
    }
    this.#refreshTnext();
    for (const c of done) this.send(c.job);
  }

  override doStatistics(delta: number): void {
    this.queueArea += this.#queue.length * delta;
    this.busyArea += this.#busy.length * delta;
  }

  /** Ставить вимогу в кінець черги без перевірки обмеження — для початкового стану та переходу між чергами. */
  enqueue(job: Job, since = this.tcurr): void {
    this.#queue.push({ job, since });
    this.maxQueueObserved = Math.max(this.maxQueueObserved, this.#queue.length);
  }

  /** Займає пристрій вимогою з заданою тривалістю обслуговування — для початкового стану. */
  startWith(job: Job, duration: number): void {
    this.#busy.push({ job, tnext: this.tcurr + duration });
    this.#refreshTnext();
  }

  /** Забирає останню вимогу з черги (вона переходить в іншу чергу). */
  takeLast(): Waiting | undefined {
    return this.#queue.pop();
  }

  /** Характеристики за час моделювання `time` (за замовчуванням — поточний модельний час). */
  stats(time = this.tcurr): ProcessStats {
    const meanBusy = time > 0 ? this.busyArea / time : 0;
    return {
      name: this.name,
      channels: this.channels,
      maxQueue: this.maxQueue,
      arrivals: this.arrivals,
      served: this.quantity,
      failures: this.failures,
      failureProbability: this.arrivals === 0 ? 0 : this.failures / this.arrivals,
      meanQueue: time > 0 ? this.queueArea / time : 0,
      meanBusy,
      utilization: Number.isFinite(this.channels) ? meanBusy / this.channels : 0,
      meanWait: this.started === 0 ? 0 : this.waitTotal / this.started,
      maxQueueObserved: this.maxQueueObserved,
      arrivalInterval: this.arrivalIntervals.summary(),
      departureInterval: this.departureIntervals.summary(),
    };
  }

  #take(): Waiting | undefined {
    const priority = this.#queuePriority;
    if (!priority) return this.#queue.shift();
    let best = 0;
    for (const [i, w] of this.#queue.entries()) {
      if (priority(w.job) > priority(this.#queue[best]?.job ?? w.job)) best = i;
    }
    return this.#queue.splice(best, 1)[0];
  }

  #start(job: Job): void {
    this.started++;
    const law = typeof this.delay === 'function' ? this.delay(job) : this.delay;
    this.#busy.push({ job, tnext: this.tcurr + law.sample(this.rng) });
    this.#refreshTnext();
  }

  #refreshTnext(): void {
    this.tnext = this.#busy.reduce((t, c) => Math.min(t, c.tnext), Infinity);
  }
}
