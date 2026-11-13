/**
 * Універсальний елемент мережі масового обслуговування і маршрут вимоги:
 * розгалуження за пріоритетом, за заданою ймовірністю або їх комбінацією, умови відкриття дуг, зміна типу вимоги.
 */
import type { Rng } from './random.ts';

/** Вимога (замовлення), що рухається маршрутом мережі. */
export interface Job {
  readonly createdAt: number;
  /** тип, з яким вимога надійшла в мережу, — для статистики за типами */
  readonly origin: number;
  /** поточний тип: від нього залежать час обслуговування, пріоритет у черзі та маршрут */
  type: number;
}

/**
 * Базовий клас елемента. Модель викликає `outAct()` у момент `tnext`,
 * `inAct(job)` викликає попередній елемент маршруту, `doStatistics(delta)` — модель перед кожним просуванням часу.
 */
export abstract class Element {
  /** момент найближчої події елемента; Infinity — подія не очікується */
  tnext = Infinity;
  /** поточний модельний час, синхронізується моделлю */
  tcurr = 0;
  /** кількість вимог, що вийшли з елемента */
  quantity = 0;
  next: Router | null = null;

  constructor(
    readonly name: string,
    protected readonly rng: Rng,
  ) {}

  /** Надходження вимоги в елемент. */
  inAct(_job: Job): void {
    throw new Error(`елемент «${this.name}» не приймає вимог`);
  }

  /** Чи прийме елемент вимогу без відмови — за цією ознакою маршрут з пріоритетами обходить зайняті гілки. */
  canAccept(_job: Job): boolean {
    return true;
  }

  /** Подія, запланована на момент tnext. */
  outAct(): void {}

  /** Накопичення інтегральної статистики за інтервал delta, протягом якого стан елемента не змінювався. */
  doStatistics(_delta: number): void {}

  /** Передає вимогу наступному елементу маршруту. */
  protected send(job: Job): void {
    if (!this.next) throw new Error(`для елемента «${this.name}» не задано маршрут`);
    const arc = this.next.pick(job, this.rng, this.name);
    if (arc.asType !== undefined) job.type = arc.asType;
    arc.to.inAct(job);
  }
}

/** Дуга маршруту від елемента до наступного. */
export interface Arc {
  readonly to: Element;
  /** імовірність вибору дуги серед відкритих дуг з тим самим пріоритетом */
  readonly p?: number;
  /** пріоритет: більше значення — вищий пріоритет; функція — пріоритет, що залежить від стану мережі */
  readonly priority?: number | (() => number);
  /** умова, за якої дуга відкрита для вимоги; закрита дуга не розглядається */
  readonly when?: (job: Job) => boolean;
  /** тип, якого набуває вимога, пройшовши дугу */
  readonly asType?: number;
}

export interface Router {
  readonly arcs: readonly Arc[];
  /** кількість вимог, що пройшли кожною дугою */
  readonly counts: readonly number[];
  readonly pick: (job: Job, rng: Rng, from: string) => Arc;
}

const priorityOf = (arc: Arc): number => (typeof arc.priority === 'function' ? arc.priority() : (arc.priority ?? 0));

/**
 * Маршрут з кількох дуг. Правило вибору:
 * 1) відкидаються дуги, умова `when` яких не виконується для вимоги;
 * 2) серед решти береться група з найвищим пріоритетом, у якій хоча б одна дуга веде в елемент, що прийме вимогу;
 *    якщо такої групи немає — група з найвищим пріоритетом (вимога отримає відмову там);
 * 3) у групі дуга вибирається за ймовірностями (нормованими в межах групи), а без імовірностей — перша за порядком.
 * Маршрут лише з імовірностями — розгалуження за ймовірністю, з різними пріоритетами — розгалуження за пріоритетом.
 */
export const route = (...arcs: readonly Arc[]): Router => {
  const withP = arcs.filter((a) => a.p !== undefined);
  if (arcs.length === 0) throw new Error('маршрут має містити хоча б одну дугу');
  if (withP.length !== 0 && withP.length !== arcs.length) throw new Error('імовірності мають бути задані для всіх дуг маршруту або для жодної');
  if (withP.some((a) => (a.p ?? 0) < 0)) throw new Error('імовірності переходів мають бути невід’ємними');
  const plain = withP.length === arcs.length && arcs.every((a) => a.priority === undefined && a.when === undefined);
  const total = withP.reduce((s, a) => s + (a.p ?? 0), 0);
  if (plain && Math.abs(total - 1) > 1e-9) throw new Error(`імовірності переходів мають у сумі давати 1 (отримано ${total})`);

  const counts = arcs.map(() => 0);
  return {
    arcs,
    counts,
    pick: (job, rng, from) => {
      const open = arcs.map((arc, i) => ({ arc, i, priority: priorityOf(arc) })).filter(({ arc }) => arc.when?.(job) ?? true);
      if (open.length === 0) throw new Error(`для вимоги типу ${job.type} немає відкритої дуги з «${from}»`);
      const levels = [...new Set(open.map((o) => o.priority))].sort((a, b) => b - a);
      const level = levels.find((l) => open.some((o) => o.priority === l && o.arc.to.canAccept(job))) ?? levels[0];
      const group = open.filter((o) => o.priority === level);
      const chosen = group[0]?.arc.p === undefined ? group[0] : weighted(group, rng);
      if (!chosen) throw new Error('недосяжно: група дуг не порожня');
      counts[chosen.i] = (counts[chosen.i] ?? 0) + 1;
      return chosen.arc;
    },
  };
};

const weighted = <T extends { readonly arc: Arc }>(group: readonly T[], rng: Rng): T | undefined => {
  const total = group.reduce((s, o) => s + (o.arc.p ?? 0), 0);
  let u = rng() * total;
  for (const o of group) {
    u -= o.arc.p ?? 0;
    if (u < 0) return o;
  }
  return group[group.length - 1];
};

/** Маршрут з однією дугою — аналог поля nextElement. */
export const to = (element: Element, arc: Omit<Arc, 'to'> = {}): Router => route({ to: element, ...arc });
