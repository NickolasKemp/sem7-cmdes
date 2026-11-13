/**
 * Стохастична мережа Петрі з часовими затримками, кратними та інформаційними дугами, багатоканальними переходами,
 * розв’язанням конфліктів за пріоритетом і ймовірністю, доповнена типізованими маркерами.
 * Маркер з ідентифікатором (наприклад, літак) проходить мережу як окремий об’єкт: дуга з позначкою `match` бере
 * маркери одного й того самого об’єкта з різних позицій, дуга з позначкою `carry` переносить його у вихідну позицію.
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

/** Маркер: `id` 0 — звичайний безіменний маркер, інакше — об’єкт, створений у момент `born`. */
export interface Token {
  readonly id: number;
  readonly born: number;
}

const PLAIN: Token = { id: 0, born: 0 };

export class Place {
  /** маркери в порядку надходження */
  readonly tokens: Token[] = [];

  constructor(
    readonly name: string,
    readonly initial: number,
    readonly layout?: Layout,
  ) {
    this.reset();
  }

  get count(): number {
    return this.tokens.length;
  }

  reset(): void {
    this.tokens.length = 0;
    for (let i = 0; i < this.initial; i++) this.tokens.push(PLAIN);
  }

  has(id: number): boolean {
    return this.tokens.some((tk) => tk.id === id);
  }

  take(id?: number): Token {
    const i = id === undefined ? 0 : this.tokens.findIndex((tk) => tk.id === id);
    const [token] = this.tokens.splice(i, 1);
    if (!token || i < 0) throw new Error(`у позиції «${this.name}» немає потрібного маркера`);
    return token;
  }
}

export interface Arc {
  readonly place: Place;
  readonly weight: number;
  /** вхідна чи інформаційна дуга: маркер того самого об’єкта, що й на інших дугах з `match` */
  readonly match: boolean;
  /** вихідна дуга: у позицію потрапляє об’єкт, що пройшов перехід, а не безіменний маркер */
  readonly carry: boolean;
  /** проміжні точки дуги на схемі */
  readonly via: readonly Point[];
  /** підпис кратності на схемі, якщо він не число (наприклад «n») */
  readonly shown?: string;
}

export type ArcSpec =
  | Place
  | readonly [Place, number]
  | {
      readonly place: Place;
      readonly weight?: number;
      readonly match?: boolean;
      readonly carry?: boolean;
      readonly via?: readonly Point[];
      readonly shown?: string;
    };

const toArc = (spec: ArcSpec): Arc => {
  if (spec instanceof Place) return { place: spec, weight: 1, match: false, carry: false, via: [] };
  if (Array.isArray(spec)) {
    const [place, weight] = spec as readonly [Place, number];
    return { place, weight, match: false, carry: false, via: [] };
  }
  const { place, weight = 1, match = false, carry = false, via = [], shown } = spec as Exclude<ArcSpec, Place | readonly [Place, number]>;
  if (match && weight !== 1) throw new Error(`дуга до «${place.name}» з позначкою match має кратність 1`);
  return { place, weight, match, carry, via, shown };
};

/** Зайнятий канал переходу: момент виходу і об’єкт, що в ньому перебуває. */
interface Channel {
  readonly exit: number;
  readonly token: Token | undefined;
}

export class Transition {
  readonly channels: Channel[] = [];
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
    /** на виході перехід створює новий об’єкт (генератор надходжень) */
    readonly spawn: boolean,
    readonly layout?: Layout,
  ) {}

  get busy(): number {
    return this.channels.length;
  }

  get nextExit(): number {
    let next = Infinity;
    for (const c of this.channels) next = Math.min(next, c.exit);
    return next;
  }

  /**
   * Умова запуску. Повертає об’єкт, з яким перехід запускається (`null` — умова не виконана, `undefined` — перехід
   * працює лише з безіменними маркерами). Об’єкт шукається в порядку надходження у першій позиції з дугою `match`.
   */
  binding(): Token | undefined | null {
    const arcs = [...this.inputs, ...this.info];
    if (!arcs.every((a) => a.place.count >= a.weight)) return null;
    const matched = arcs.filter((a) => a.match);
    const [first, ...rest] = matched;
    if (!first) return undefined;
    return first.place.tokens.find((tk) => rest.every((a) => a.place.has(tk.id))) ?? null;
  }

  enter(t: number, rng: Rng, token: Token | undefined): void {
    for (const a of this.inputs) {
      for (let i = 0; i < a.weight; i++) a.place.take(a.match ? token?.id : undefined);
    }
    this.channels.push({ exit: t + this.delay.sample(rng), token });
  }

  /** Вихід маркерів з усіх каналів, момент виходу яких настав; `create` дає новий об’єкт для генератора. */
  exit(t: number, create: (t: number) => Token): void {
    for (let i = this.channels.length - 1; i >= 0; i--) {
      const channel = this.channels[i];
      if (channel?.exit !== t) continue;
      this.channels.splice(i, 1);
      const token = this.spawn ? create(t) : channel.token;
      for (const a of this.outputs) {
        if (a.carry && !token) throw new Error(`перехід «${this.name}» не несе об’єкта для дуги до «${a.place.name}»`);
        for (let k = 0; k < a.weight; k++) a.place.tokens.push(a.carry && token ? token : PLAIN);
      }
      this.fired++;
    }
  }
}

export interface TransitionSpec {
  readonly in: readonly ArcSpec[];
  readonly out: readonly ArcSpec[];
  readonly info?: readonly ArcSpec[];
  readonly priority?: number;
  readonly probability?: number;
  readonly spawn?: boolean;
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
    // допустима конструкція: у переходу є хоч одна звичайна вхідна і хоч одна вихідна позиція
    if (!inputs.length || !outputs.length) throw new Error(`перехід «${name}» має мати вхідні й вихідні позиції`);
    const t = new Transition(
      name,
      delay,
      inputs,
      outputs,
      (spec.info ?? []).map(toArc),
      spec.priority ?? 0,
      spec.probability ?? 1,
      spec.spawn ?? false,
      spec.layout,
    );
    this.transitions.push(t);
    return t;
  }

  reset(): void {
    for (const p of this.places) p.reset();
    for (const t of this.transitions) {
      t.channels.length = 0;
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

type Enter = (tr: Transition, token: Token | undefined, t: number) => void;

/**
 * Вхід маркерів у переходи: доки є переходи з виконаною умовою запуску, залишити ті, що мають найбільший пріоритет,
 * вибрати один із заданою ймовірністю і здійснити вхід. Багатоканальний перехід входить стільки разів, скільки дозволяють маркери.
 */
const enterAll = (net: Net, t: number, rng: Rng, onEnter: Enter | undefined): void => {
  for (let entries = 0; entries < MAX_ENTRIES_PER_MOMENT; entries++) {
    const enabled = net.transitions.flatMap((tr) => {
      const token = tr.binding();
      return token === null ? [] : [{ tr, token }];
    });
    if (!enabled.length) return;
    const top = Math.max(...enabled.map((e) => e.tr.priority));
    const rivals = enabled.filter((e) => e.tr.priority === top);
    let chosen = rivals[0];
    if (rivals.length > 1) {
      let u = rng() * rivals.reduce((s, e) => s + e.tr.probability, 0);
      chosen = rivals.find((e) => (u -= e.tr.probability) < 0) ?? rivals[rivals.length - 1];
    }
    if (!chosen) return;
    chosen.tr.enter(t, rng, chosen.token);
    onEnter?.(chosen.tr, chosen.token, t);
  }
  throw new Error(`у момент ${t} понад ${MAX_ENTRIES_PER_MOMENT} входів: цикл переходів з нульовою затримкою`);
};

export interface RunOptions<G extends string> {
  readonly time: number;
  /** статистика збирається лише після цього моменту (вихід на сталий режим) */
  readonly warmup?: number;
  readonly rng: Rng;
  /** додаткові спостережувані величини, наприклад кількість літаків в аеропорту */
  readonly gauges?: Readonly<Record<G, () => number>>;
  /** вхід маркерів у перехід: для збору статистики за окремими об’єктами */
  readonly onEnter?: Enter;
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
 * Алгоритм імітації стохастичної мережі Петрі: вхід маркерів у переходи; далі, доки t < Tmod, — момент найближчої
 * події, статистика, вихід маркерів з переходів, момент виходу яких настав, і знову вхід маркерів.
 */
export const simulate = <G extends string = never>(net: Net, { time, warmup = 0, rng, gauges, onEnter, onEvent }: RunOptions<G>): RunResult<G> => {
  net.reset();
  const places = new Map(net.places.map((p) => [p, new Gauge(() => p.count)]));
  const transitions = new Map(net.transitions.map((tr) => [tr, new Gauge(() => tr.busy)]));
  const extra = Object.fromEntries(Object.entries<() => number>(gauges ?? ({} as Record<G, () => number>)).map(([k, f]) => [k, new Gauge(f)])) as Record<G, Gauge>;
  const all = [...places.values(), ...transitions.values(), ...Object.values<Gauge>(extra)];
  let base: Map<Transition, number> | undefined = warmup <= 0 ? new Map(net.transitions.map((tr) => [tr, 0])) : undefined;

  let lastId = 0;
  const create = (born: number): Token => ({ id: ++lastId, born });

  let t = 0;
  let events = 0;
  const advance = (to: number): void => {
    const from = Math.max(t, warmup);
    if (to > from) for (const g of all) g.add(to - from);
    if (!base && to >= warmup) base = new Map(net.transitions.map((tr) => [tr, tr.fired]));
    t = to;
  };

  enterAll(net, t, rng, onEnter);
  for (;;) {
    let next = Infinity;
    for (const tr of net.transitions) next = Math.min(next, tr.nextExit);
    if (next > time) {
      advance(time);
      break;
    }
    advance(next);
    for (const tr of net.transitions) tr.exit(t, create);
    enterAll(net, t, rng, onEnter);
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
