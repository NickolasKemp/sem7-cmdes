/**
 * Клас Model — алгоритм імітації за принципом найближчої події:
 * знайти найменший tnext серед елементів, накопичити статистику за інтервал до нього,
 * просунути модельний час і виконати події всіх елементів, запланованих на цей момент.
 */
import type { Element } from './element.ts';

/** Спостерігач кроків імітації: момент події та елементи, чиї події в цей момент виконано. */
export type EventListener = (tcurr: number, fired: readonly Element[]) => void;

export class Model {
  tcurr = 0;
  /** кількість виконаних кроків (моментів подій) */
  steps = 0;

  constructor(readonly elements: readonly Element[]) {}

  /**
   * Імітація на інтервалі [0; time]. На відміну від лістингу з методички, останній крок
   * не «перестрибує» за time: статистика накопичується рівно до кінця інтервалу моделювання,
   * тому середні за часом величини діляться на точне значення time.
   */
  simulate(time: number, onEvent?: EventListener): this {
    if (!Number.isFinite(time)) throw new Error('час моделювання має бути скінченним');
    for (;;) {
      let tnext = Infinity;
      for (const e of this.elements) tnext = Math.min(tnext, e.tnext);

      const until = Math.min(tnext, time);
      for (const e of this.elements) e.doStatistics(until - this.tcurr);
      this.tcurr = until;
      for (const e of this.elements) e.tcurr = until;
      if (tnext > time) return this;

      // знімок до виконання подій: подія одного елемента може змінити tnext іншого
      const fired = this.elements.filter((e) => e.tnext === this.tcurr);
      for (const e of fired) e.outAct();
      this.steps++;
      onEvent?.(this.tcurr, fired);
    }
  }
}
