/**
 * Стохастична мережа Петрі N = (P, T, A, W, I, K, R) з лекцій 6 і 10: часові затримки переходів з заданим законом
 * розподілу, кратні дуги, інформаційні дуги, багатоканальні переходи, розв’язання конфліктів за пріоритетом і ймовірністю.
 * Елементи мережі несуть і своє розташування на схемі, тож модель і рисунок будуються з одного опису.
 */
import type { Distribution, Rng } from './random.ts';

export type Point = readonly [number, number];
/** 'none' — без підпису, як генератори в лекційних схемах */
export type Side = 'above' | 'below' | 'left' | 'right' | 'none';

/** Розташування елемента на схемі; елемент без розташування на схему не потрапляє. */
export interface Layout {
  readonly at: Point;
  readonly side?: Side;
  /** перехід горизонтальною планкою (за замовчуванням — вертикальною) */
  readonly horizontal?: boolean;
  /** підпис кількості маркерів замість числа, наприклад «n» */
  readonly shown?: string;
  /** зсув підпису, коли на його звичному місці проходить дуга */
  readonly shift?: Point;
}

export class Place {
  tokens: number;

  constructor(
    readonly name: string,
    readonly initial: number,
    readonly layout?: Layout,
  ) {
    this.tokens = initial;
  }
}

export interface Arc {
  readonly place: Place;
  readonly weight: number;
  /** проміжні точки дуги на схемі */
  readonly via: readonly Point[];
  /** підпис кратності на схемі, якщо він не число (наприклад «n») */
  readonly shown?: string;
}

export type ArcSpec =
  | Place
  | readonly [Place, number]
  | { readonly place: Place; readonly weight?: number; readonly via?: readonly Point[]; readonly shown?: string };

const toArc = (spec: ArcSpec): Arc => {
  if (spec instanceof Place) return { place: spec, weight: 1, via: [] };
  if (Array.isArray(spec)) {
    const [place, weight] = spec as readonly [Place, number];
    return { place, weight, via: [] };
  }
  const { place, weight = 1, via = [], shown } = spec as Exclude<ArcSpec, Place | readonly [Place, number]>;
  return { place, weight, via, shown };
};

export class Transition {
  /** моменти виходу маркерів з каналів переходу, що зараз зайняті */
  readonly exits: number[] = [];
  /** скільки разів маркери вийшли з переходу від початку прогону */
  fired = 0;

  constructor(
    readonly name: string,
    readonly delay: Distribution,
    readonly inputs: readonly Arc[],
    readonly outputs: readonly Arc[],
    /** інформаційні дуги: маркери перевіряються, але не забираються */
    readonly info: readonly Arc[],
    readonly priority: number,
    readonly probability: number,
    readonly layout?: Layout,
  ) {}

  get busy(): number {
    return this.exits.length;
  }

  get enabled(): boolean {
    return [...this.inputs, ...this.info].every((a) => a.place.tokens >= a.weight);
  }

  enter(t: number, rng: Rng): void {
    for (const a of this.inputs) a.place.tokens -= a.weight;
    this.exits.push(t + this.delay.sample(rng));
  }

  /** Вихід маркерів з усіх каналів, момент виходу яких настав. */
  exit(t: number): void {
    for (let i = this.exits.length - 1; i >= 0; i--) {
      if (this.exits[i] !== t) continue;
      this.exits.splice(i, 1);
      for (const a of this.outputs) a.place.tokens += a.weight;
      this.fired++;
    }
  }

  get nextExit(): number {
    return this.exits.length ? Math.min(...this.exits) : Infinity;
  }
}

export interface TransitionSpec {
  readonly in: readonly ArcSpec[];
  readonly out: readonly ArcSpec[];
  readonly info?: readonly ArcSpec[];
  readonly priority?: number;
  readonly probability?: number;
  readonly layout?: Layout;
}

export class Net {
  readonly places: Place[] = [];
  readonly transitions: Transition[] = [];

  place(name: string, tokens = 0, layout?: Layout): Place {
    const p = new Place(name, tokens, layout);
    this.places.push(p);
    return p;
  }

  transition(name: string, delay: Distribution, spec: TransitionSpec): Transition {
    const inputs = spec.in.map(toArc);
    const outputs = spec.out.map(toArc);
    // допустима конструкція (лекція 10): у переходу є хоч одна звичайна вхідна і хоч одна вихідна позиція
    if (!inputs.length || !outputs.length) throw new Error(`перехід «${name}» має мати вхідні й вихідні позиції`);
    const t = new Transition(name, delay, inputs, outputs, (spec.info ?? []).map(toArc), spec.priority ?? 0, spec.probability ?? 1, spec.layout);
    this.transitions.push(t);
    return t;
  }

  reset(): void {
    for (const p of this.places) p.tokens = p.initial;
    for (const t of this.transitions) {
      t.exits.length = 0;
      t.fired = 0;
    }
  }
}

/** Середнє в часі значення кусково-сталої величини (кількість маркерів, зайнятих каналів) і частка часу кожного значення. */
export class Gauge {
  #area = 0;
  #span = 0;
  max = 0;
  readonly shares = new Map<number, number>();

  constructor(readonly read: () => number) {}

  add(dt: number): void {
    const v = this.read();
    this.#area += v * dt;
    this.#span += dt;
    this.max = Math.max(this.max, v);
    this.shares.set(v, (this.shares.get(v) ?? 0) + dt);
  }

  get mean(): number {
    return this.#span ? this.#area / this.#span : 0;
  }

  share(v: number): number {
    return this.#span ? (this.shares.get(v) ?? 0) / this.#span : 0;
  }
}

/** Межа кількості входів за один момент часу: більше означає цикл з нульових затримок. */
const MAX_ENTRIES_PER_MOMENT = 1_000_000;

/**
 * Вхід маркерів у переходи: доки є переходи з виконаною умовою запуску, залишити ті, що мають найбільший пріоритет,
 * вибрати один із заданою ймовірністю і здійснити вхід. Багатоканальний перехід входить стільки разів, скільки дозволяють маркери.
 */
const enterAll = (net: Net, t: number, rng: Rng): number => {
  for (let entries = 0; entries < MAX_ENTRIES_PER_MOMENT; entries++) {
    const enabled = net.transitions.filter((tr) => tr.enabled);
    if (!enabled.length) return entries;
    const top = Math.max(...enabled.map((tr) => tr.priority));
    const rivals = enabled.filter((tr) => tr.priority === top);
    let chosen = rivals[0];
    if (rivals.length > 1) {
      let u = rng() * rivals.reduce((s, tr) => s + tr.probability, 0);
      chosen = rivals.find((tr) => (u -= tr.probability) < 0) ?? rivals[rivals.length - 1];
    }
    chosen?.enter(t, rng);
  }
  throw new Error(`у момент ${t} понад ${MAX_ENTRIES_PER_MOMENT} входів: цикл переходів з нульовою затримкою`);
};

export interface RunOptions<G extends string> {
  readonly time: number;
  /** статистика збирається лише після цього моменту (вихід на сталий режим) */
  readonly warmup?: number;
  readonly rng: Rng;
  /** додаткові спостережувані величини, наприклад кількість деталей у системі */
  readonly gauges?: Readonly<Record<G, () => number>>;
  /** викликається після обробки кожного моменту найближчої події */
  readonly onEvent?: (t: number) => void;
}

export interface RunResult<G extends string> {
  /** тривалість інтервалу збору статистики */
  readonly span: number;
  readonly events: number;
  readonly place: (p: Place) => Gauge;
  /** середня кількість зайнятих каналів переходу */
  readonly busy: (t: Transition) => Gauge;
  /** кількість виходів маркерів з переходу на інтервалі збору статистики */
  readonly fired: (t: Transition) => number;
  readonly gauge: Readonly<Record<G, Gauge>>;
}

/**
 * Алгоритм імітації стохастичної мережі Петрі (лекція 10): вхід маркерів у переходи; далі, доки t < Tmod, —
 * момент найближчої події, статистика, вихід маркерів з переходів, момент виходу яких настав, і знову вхід маркерів.
 */
export const simulate = <G extends string = never>(net: Net, { time, warmup = 0, rng, gauges, onEvent }: RunOptions<G>): RunResult<G> => {
  net.reset();
  const places = new Map(net.places.map((p) => [p, new Gauge(() => p.tokens)]));
  const transitions = new Map(net.transitions.map((tr) => [tr, new Gauge(() => tr.busy)]));
  const extra = Object.fromEntries(Object.entries<() => number>(gauges ?? ({} as Record<G, () => number>)).map(([k, f]) => [k, new Gauge(f)])) as Record<G, Gauge>;
  const all = [...places.values(), ...transitions.values(), ...Object.values<Gauge>(extra)];
  let base: Map<Transition, number> | undefined = warmup <= 0 ? new Map(net.transitions.map((tr) => [tr, 0])) : undefined;

  let t = 0;
  let events = 0;
  const advance = (to: number): void => {
    const from = Math.max(t, warmup);
    if (to > from) for (const g of all) g.add(to - from);
    if (!base && to >= warmup) base = new Map(net.transitions.map((tr) => [tr, tr.fired]));
    t = to;
  };

  enterAll(net, t, rng);
  for (;;) {
    const next = Math.min(...net.transitions.map((tr) => tr.nextExit));
    if (next > time) {
      advance(time);
      break;
    }
    advance(next);
    for (const tr of net.transitions) tr.exit(t);
    enterAll(net, t, rng);
    events++;
    onEvent?.(t);
  }

  const counted = base;
  if (!counted) throw new Error('час моделювання менший за час розгону');
  const get = <K, V>(map: Map<K, V>, k: K): V => {
    const v = map.get(k);
    if (v === undefined) throw new Error('елемент не належить мережі');
    return v;
  };
  return {
    span: time - warmup,
    events,
    place: (p) => get(places, p),
    busy: (tr) => get(transitions, tr),
    fired: (tr) => tr.fired - get(counted, tr),
    gauge: extra,
  };
};
