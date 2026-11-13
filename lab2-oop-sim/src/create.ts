/** Елемент CREATE — джерело вимог з випадковим інтервалом між надходженнями. */
import { Element } from './element.ts';
import type { Distribution, Rng } from './random.ts';

export class Create extends Element {
  constructor(
    name: string,
    readonly delay: Distribution,
    rng: Rng,
    /** момент першого надходження; за методичкою імітація починається з події Create у момент 0 */
    firstAt = 0,
  ) {
    super(name, rng);
    this.tnext = firstAt;
  }

  override outAct(): void {
    const job = { id: this.quantity, createdAt: this.tcurr };
    this.quantity++;
    this.tnext = this.tcurr + this.delay.sample(this.rng);
    this.send(job);
  }
}
