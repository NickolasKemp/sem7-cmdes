/** Елемент DISPOSE — вихід вимог із моделі; рахує час перебування вимог у системі. */
import { Element, type Job } from './element.ts';

export class Dispose extends Element {
  totalTimeInSystem = 0;

  constructor(name: string) {
    // DISPOSE нікуди не передає вимоги, тож генератор для маршрутизації йому не потрібен
    super(name, () => {
      throw new Error('DISPOSE не використовує генератор випадкових чисел');
    });
  }

  override inAct(job: Job): void {
    this.quantity++;
    this.totalTimeInSystem += this.tcurr - job.createdAt;
  }

  get meanTimeInSystem(): number {
    return this.quantity === 0 ? 0 : this.totalTimeInSystem / this.quantity;
  }
}
