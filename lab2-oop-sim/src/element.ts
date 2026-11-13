/**
 * Універсальний елемент моделі (клас Element з діаграми класів) і маршрутизація вимог між елементами.
 */
import type { Rng } from './random.ts';

/** Вимога, що рухається маршрутом моделі. Момент створення потрібен для часу перебування в системі. */
export interface Job {
  readonly id: number;
  readonly createdAt: number;
}

/**
 * Правило вибору наступного елемента для вимоги, що вийшла з елемента.
 * Замінює одиночне поле nextElement: маршрут може мати кілька гілок, зокрема повернення назад.
 */
export interface Router {
  readonly label: string;
  readonly pick: (rng: Rng) => Element;
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

  /** Подія, запланована на момент tnext. */
  outAct(): void {}

  /** Накопичення інтегральної статистики за інтервал delta, протягом якого стан елемента не змінювався. */
  doStatistics(_delta: number): void {}

  /** Передає вимогу наступному елементу маршруту. */
  protected send(job: Job): void {
    if (!this.next) throw new Error(`для елемента «${this.name}» не задано наступний елемент`);
    this.next.pick(this.rng).inAct(job);
  }
}

/** Маршрут з однією гілкою — відповідає полю nextElement з методички. */
export const to = (element: Element): Router => ({ label: element.name, pick: () => element });

/** Гілка маршруту з імовірністю переходу. */
export interface Branch {
  readonly to: Element;
  readonly p: number;
}

/** Імовірнісний маршрут, що рахує фактичні переходи по кожній гілці (для перевірки маршрутизації). */
export interface BranchRouter extends Router {
  readonly branches: readonly Branch[];
  readonly counts: readonly number[];
}

/** Вихід у дві і більше гілки з заданими ймовірностями; сума ймовірностей має дорівнювати 1. */
export const branch = (...branches: readonly Branch[]): BranchRouter => {
  const total = branches.reduce((s, b) => s + b.p, 0);
  if (branches.length === 0 || Math.abs(total - 1) > 1e-9 || branches.some((b) => b.p < 0)) {
    throw new Error(`ймовірності переходів мають бути невід’ємними й у сумі давати 1 (отримано ${total})`);
  }
  const counts = branches.map(() => 0);
  return {
    label: branches.map((b) => `${b.to.name} (p=${b.p})`).join(', '),
    branches,
    counts,
    pick: (rng) => {
      let u = rng();
      for (const [i, b] of branches.entries()) {
        u -= b.p;
        if (u < 0 || i === branches.length - 1) {
          counts[i] = (counts[i] ?? 0) + 1;
          return b.to;
        }
      }
      throw new Error('недосяжно: гілки не порожні');
    },
  };
};
