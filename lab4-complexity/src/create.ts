/** Елемент CREATE — джерело вимог з випадковим інтервалом між надходженнями і, за потреби, випадковим типом вимоги. */
import { Element } from './element.ts';
import type { Distribution, Rng } from './random.ts';

export interface CreateOptions {
  /** момент першого надходження, за замовчуванням 0 */
  readonly firstAt?: number;
  /** закон розподілу типу вимоги, за замовчуванням усі вимоги типу 1 */
  readonly jobType?: (rng: Rng) => number;
}

export class Create extends Element {
  readonly #jobType: (rng: Rng) => number;

  constructor(
    name: string,
    readonly delay: Distribution,
    rng: Rng,
    { firstAt = 0, jobType = () => 1 }: CreateOptions = {},
  ) {
    super(name, rng);
    this.tnext = firstAt;
    this.#jobType = jobType;
  }

  override outAct(): void {
    const type = this.#jobType(this.rng);
    this.quantity++;
    this.tnext = this.tcurr + this.delay.sample(this.rng);
    this.send({ createdAt: this.tcurr, origin: type, type });
  }
}
