/** Елемент DISPOSE — вихід вимог із мережі; накопичує час перебування в системі за типами вимог та інтервали між виходами. */
import { Element, type Job } from './element.ts';
import { Accumulator } from './stats.ts';

export class Dispose extends Element {
  /** час перебування в системі за початковим типом вимоги */
  readonly timeInSystem = new Map<number, number[]>();
  readonly intervals = new Accumulator();
  #last = NaN;

  constructor(name: string) {
    // DISPOSE нікуди не передає вимоги, тож генератор для маршрутизації йому не потрібен
    super(name, () => {
      throw new Error('DISPOSE не використовує генератор випадкових чисел');
    });
  }

  override inAct(job: Job): void {
    this.quantity++;
    const times = this.timeInSystem.get(job.origin) ?? [];
    times.push(this.tcurr - job.createdAt);
    this.timeInSystem.set(job.origin, times);
    if (!Number.isNaN(this.#last)) this.intervals.add(this.tcurr - this.#last);
    this.#last = this.tcurr;
  }

  /** усі значення часу перебування; з `origin` — лише для вимог цього типу */
  times(origin?: number): number[] {
    return origin === undefined ? [...this.timeInSystem.values()].flat() : (this.timeInSystem.get(origin) ?? []);
  }
}
