/**
 * Елемент PROCESS — обслуговування вимог кількома ідентичними пристроями (каналами) зі спільною чергою
 * обмеженої довжини. Вимога, що застала всі канали зайнятими і чергу заповненою, отримує відмову.
 */
import { Element, type Job } from './element.ts';
import type { Distribution, Rng } from './random.ts';

interface Channel {
  readonly job: Job;
  /** момент завершення обслуговування */
  readonly tnext: number;
}

interface Waiting {
  readonly job: Job;
  /** момент постановки в чергу */
  readonly since: number;
}

export interface ProcessOptions {
  /** кількість ідентичних пристроїв обслуговування, за замовчуванням 1 */
  readonly channels?: number;
  /** максимальна довжина черги, за замовчуванням необмежена */
  readonly maxQueue?: number;
}

/** Підсумкові характеристики процесу обслуговування за час моделювання. */
export interface ProcessStats {
  readonly name: string;
  readonly channels: number;
  readonly maxQueue: number;
  /** кількість вимог, що надійшли */
  readonly arrivals: number;
  /** кількість обслугованих вимог */
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
  /** вимоги, що залишились в елементі на кінець моделювання */
  readonly inQueue: number;
  readonly inService: number;
}

export class Process extends Element {
  readonly channels: number;
  readonly maxQueue: number;
  arrivals = 0;
  failures = 0;
  /** ∫ q(t) dt — інтеграл довжини черги (поле meanQueue з методички) */
  queueArea = 0;
  /** ∫ b(t) dt — інтеграл кількості зайнятих пристроїв, з нього рахується середнє завантаження */
  busyArea = 0;
  /** сумарний час очікування в черзі та кількість вимог, що почали обслуговування */
  waitTotal = 0;
  started = 0;
  #busy: Channel[] = [];
  readonly #queue: Waiting[] = [];

  constructor(
    name: string,
    readonly delay: Distribution,
    rng: Rng,
    { channels = 1, maxQueue = Infinity }: ProcessOptions = {},
  ) {
    super(name, rng);
    if (!Number.isInteger(channels) || channels < 1) throw new Error(`некоректна кількість каналів: ${channels}`);
    this.channels = channels;
    this.maxQueue = maxQueue;
  }

  get queueLength(): number {
    return this.#queue.length;
  }

  get busyChannels(): number {
    return this.#busy.length;
  }

  override inAct(job: Job): void {
    this.arrivals++;
    if (this.#busy.length < this.channels) this.#start(job);
    else if (this.#queue.length < this.maxQueue) this.#queue.push({ job, since: this.tcurr });
    else this.failures++;
  }

  override outAct(): void {
    const done = this.#busy.filter((c) => c.tnext <= this.tcurr);
    this.#busy = this.#busy.filter((c) => c.tnext > this.tcurr);
    this.quantity += done.length;
    // звільнені канали спершу забирають вимоги з черги, і лише потім готові вимоги йдуть далі:
    // так вимога, що повертається в цей самий елемент, не обійде тих, хто вже чекає
    while (this.#busy.length < this.channels) {
      const w = this.#queue.shift();
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
      utilization: meanBusy / this.channels,
      meanWait: this.started === 0 ? 0 : this.waitTotal / this.started,
      inQueue: this.#queue.length,
      inService: this.#busy.length,
    };
  }

  #start(job: Job): void {
    this.started++;
    this.#busy.push({ job, tnext: this.tcurr + this.delay.sample(this.rng) });
    this.#refreshTnext();
  }

  #refreshTnext(): void {
    this.tnext = this.#busy.reduce((t, c) => Math.min(t, c.tnext), Infinity);
  }
}
