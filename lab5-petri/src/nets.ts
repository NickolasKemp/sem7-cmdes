/**
 * Мережі Петрі чотирьох задач практикуму. Кожна функція будує мережу разом зі схемою і повертає елементи,
 * за якими обчислюються вихідні характеристики моделі.
 */
import { Net, Place, type ArcSpec, type Layout, type Point, type Side } from './petri.ts';
import { constant, exponential, normal, uniform } from './random.ts';

const NOW = constant(0);

/** Генератор потоку: позиція з маркером і перехід, що повертає маркер собі (лекція, рисунок 5.10). */
const generator = (net: Net, name: string, [x, y]: Point, delay: Parameters<Net['transition']>[1], out: ArcSpec, layout = true) => {
  const source = net.place(`генератор: ${name}`, 1, layout ? { at: [x - 60, y], side: 'none' } : undefined);
  return net.transition(name, delay, {
    in: [source],
    out: [out, { place: source, via: [[x, y + 40], [x - 60, y + 40]] }],
    layout: layout ? { at: [x, y], side: 'above' } : undefined,
  });
};

// ─────────────────────────────── Задача 1: конвеєр з п’ятьма пристроями

/** Час у хвилинах. */
export const CONVEYOR = {
  devices: 5,
  /** 4 деталі за хвилину */
  arrival: 0.25,
  service: 1,
  transfer: 1,
  back: 5,
} as const;

export const conveyorNet = () => {
  const { devices, arrival, service, transfer, back } = CONVEYOR;
  const net = new Net();
  const STEP = 190;
  const Y = 230;
  const xOf = (i: number): number => 190 + i * STEP;

  const at = Array.from({ length: devices }, (_, i) => net.place(`деталь біля пристрою ${i + 1}`, 0, { at: [xOf(i), Y], side: 'below' }));
  const first = at[0];
  const last = at[devices - 1];
  if (!first || !last) throw new Error('недосяжно');
  const arrive = generator(net, 'надходження', [100, Y], constant(arrival), first);

  const serve = at.map((place, i) => {
    const x = xOf(i);
    const free = net.place(`пристрій ${i + 1} вільний`, 1, { at: [x - 60, Y - 100], side: 'below' });
    const done = net.place(`оброблено пристроєм ${i + 1}`, 0, { at: [x, 40], side: 'right' });
    return net.transition(`обробка на пристрої ${i + 1}`, exponential(service), {
      in: [place, { place: free, via: [[x - 34, Y - 108]] }],
      out: [done, { place: free, via: [[x - 34, Y - 92]] }],
      priority: 1,
      layout: { at: [x, Y - 100], side: 'right', horizontal: true },
    });
  });
  const move = at.slice(0, -1).map((place, i) => {
    const target = at[i + 1];
    if (!target) throw new Error('недосяжно');
    return net.transition(`перехід ${i + 1}→${i + 2}`, constant(transfer), { in: [place], out: [target], layout: { at: [xOf(i) + STEP / 2, Y], side: 'below' } });
  });
  const xBack = xOf(devices - 1) + STEP / 2;
  const ret = net.transition('повернення до 1', constant(back), {
    in: [last],
    out: [{ place: first, via: [[xBack, Y + 85], [xOf(0) - 50, Y + 85], [xOf(0) - 50, Y + 25]] }],
    layout: { at: [xBack, Y], side: 'above' },
  });

  /** деталей у системі: біля пристроїв, на обробці, у русі конвеєром */
  const inSystem = (): number =>
    at.reduce((s, p) => s + p.tokens, 0) + serve.reduce((s, t) => s + t.busy, 0) + move.reduce((s, t) => s + t.busy, 0) + ret.busy;
  const busyDevices = (): number => serve.reduce((s, t) => s + t.busy, 0);
  return { net, arrive, serve, move, ret, inSystem, busyDevices, width: xBack + 50, height: Y + 105 };
};

// ─────────────────────────────── Задача 2: гнучка виробнича система з роботами

/** Час у секундах. */
export const FMS = {
  arrival: 40,
  machine1: { mean: 60, deviation: 10, slots: 3 },
  machine2: { mean: 100, slots: 3 },
  robots: 3,
  grip: { min: 7, max: 9 },
} as const;

/** Пункти на шляху деталі: пункт прибуття, верстат 1, верстат 2, склад. */
export const STATIONS = ['А', 'В1', 'В2', 'С'] as const;
export type Station = (typeof STATIONS)[number];
/** пункти розташовані на одній лінії з інтервалами переміщення робота 6, 7 і 5 с */
const POSITION: Readonly<Record<Station, number>> = { А: 0, В1: 6, В2: 13, С: 18 };
export const travel = (a: Station, b: Station): number => Math.abs(POSITION[a] - POSITION[b]);

/** fixed — по роботу на кожен шлях, nearest — деталь забирає найближчий вільний робот */
export type Assignment = 'fixed' | 'nearest';

const LEGS = [
  ['А', 'В1'],
  ['В1', 'В2'],
  ['В2', 'С'],
] as const;

export const fmsNet = (assignment: Assignment, arrivalMean: number = FMS.arrival) => {
  const net = new Net();
  const grip = uniform(FMS.grip.min, FMS.grip.max);
  const fixed = assignment === 'fixed';
  /** на схемі варіанта 1 — уся мережа змійкою з трьох рядів, варіанта 2 — фрагмент виклику робота до верстата 1 */
  const lay = (one: Point | undefined, two: Point | undefined, side: Side = 'below', shift?: Point): Layout | undefined => {
    const at = fixed ? one : two;
    return at ? { at, side, shift } : undefined;
  };
  const ROW = [170, 390, 630] as const;
  const S = 100;

  const ready = {
    А: net.place('деталі на пункті прибуття', 0, lay([180, ROW[0]], undefined)),
    В1: net.place('оброблені на верстаті 1', 0, lay([970, ROW[0]], [330, 530], 'right')),
    В2: net.place('оброблені на верстаті 2', 0, lay([270, ROW[1]], undefined, 'left')),
  };
  const stored = net.place('склад оброблених деталей', 0, lay([770, ROW[2]], undefined, 'right'));
  const arrive = generator(net, 'прибуття деталі', [100, ROW[0]], exponential(arrivalMean), ready.А, fixed);
  const onMachine = {
    В1: net.place('деталі на верстаті 1', 0, lay([770, ROW[0]], undefined)),
    В2: net.place('деталі на верстаті 2', 0, lay([470, ROW[1]], [800, 260])),
  };
  // місце на верстаті займає робот, коли бере деталь для цього верстата, і звільняє, коли забирає деталь з нього
  const slots = {
    В1: net.place('вільні місця на верстаті 1', FMS.machine1.slots, lay([180, 285], [400, 370], 'left')),
    В2: net.place('вільні місця на верстаті 2', FMS.machine2.slots, lay([1070, 390], [120, 530], 'right')),
  };
  const machine1 = net.transition('обробка на верстаті 1', normal(FMS.machine1.mean, FMS.machine1.deviation), {
    in: [onMachine.В1],
    out: [ready.В1],
    layout: lay([870, ROW[0]], undefined, 'above'),
  });
  const machine2 = net.transition('обробка на верстаті 2', exponential(FMS.machine2.mean), {
    in: [onMachine.В2],
    out: [ready.В2],
    layout: lay([370, ROW[1]], undefined, 'above'),
  });
  const deliverTo = { В1: onMachine.В1, В2: onMachine.В2, С: stored } as const;

  interface LegSpec {
    readonly from: Station;
    readonly to: 'В1' | 'В2' | 'С';
    readonly who: string;
    /** вхідні дуги захоплення: робот, деталь, місце на наступному верстаті */
    readonly pickup: readonly ArcSpec[];
    /** місце, яке звільняється на верстаті, звідки забрано деталь */
    readonly freed?: ArcSpec;
    /** куди потрапляє робот після вивільнення деталі */
    readonly home: ArcSpec;
    readonly at: (k: number) => Point | undefined;
    readonly sides: readonly [capture: Side, release: Side];
    readonly captureShift?: Point;
  }
  /** Ланцюжок «захоплення — переміщення — вивільнення» на шляху from → to. */
  const leg = ({ from, to, who, pickup, freed, home, at, sides, captureShift }: LegSpec) => {
    const pos = (k: number, side: Side, shift?: Point): Layout | undefined => {
      const p = at(k);
      return p ? { at: p, side, shift } : undefined;
    };
    const taken = net.place(`${who} везе деталь ${from}→${to}`, 0, pos(1, 'below'));
    const arrived = net.place(`${who} з деталлю біля ${to}`, 0, pos(3, 'below'));
    net.transition(`захоплення біля ${from}`, grip, { in: pickup, out: [taken, ...(freed ? [freed] : [])], layout: pos(0, sides[0], captureShift) });
    net.transition(`переміщення ${from}→${to}`, constant(travel(from, to)), { in: [taken], out: [arrived], layout: pos(2, 'above') });
    return net.transition(`вивільнення біля ${to}`, grip, { in: [arrived], out: [deliverTo[to], home], layout: pos(4, sides[1]) });
  };

  if (fixed) {
    const X0 = [270, 970, 270] as const;
    const target = [{ place: slots.В1 }, { place: slots.В2 }, undefined] as const;
    const freed = [undefined, { place: slots.В1, via: [[940, 285]] }, { place: slots.В2, via: [[300, 550], [1070, 550]] }] as const;
    const sides: readonly (readonly [Side, Side])[] = [
      ['below', 'below'],
      ['above', 'above'],
      ['left', 'above'],
    ];
    const idle: Place[] = [];
    const releases = LEGS.map(([from, to], i) => {
      const dir = i === 1 ? -1 : 1;
      const x = (k: number): number => (X0[i] ?? 0) + dir * S * k;
      const row = ROW[i] ?? 0;
      const loop = i === 0 ? row - 90 : row + 90;
      const side: Side = i === 0 ? 'above' : 'below';
      const start = net.place(`робот ${i + 1} біля ${from}`, 1, { at: [x(0), loop], side });
      const end = net.place(`робот ${i + 1} біля ${to}`, 0, { at: [x(4), loop], side });
      const slot = target[i];
      const release = leg({
        from,
        to,
        who: `робот ${i + 1}`,
        pickup: [ready[from as keyof typeof ready], start, ...(slot ? [slot] : [])],
        freed: freed[i],
        home: end,
        at: (k) => [x(k), row],
        sides: sides[i] ?? ['above', 'above'],
        captureShift: i === 1 ? [55, 0] : undefined,
      });
      net.transition(`холостий хід ${to}→${from}`, constant(travel(from, to)), { in: [end], out: [start], layout: { at: [x(2), loop], side } });
      idle.push(start);
      return release;
    });
    const store = releases[2];
    if (!store) throw new Error('недосяжно');
    // робот вільний лише тоді, коли чекає на початку свого шляху; холостий хід — теж робота
    return { net, arrive, store, machine1, machine2, slots, ready, robotBusy: () => FMS.robots - idle.reduce((s, p) => s + p.tokens, 0), width: 1230, height: 790 };
  }

  // варіант 2: вільний робот стоїть там, де звільнився; на виклик їде найближчий (пріоритет тим більший, чим менша відстань)
  const idle = Object.fromEntries(
    STATIONS.map((s, k) => [s, net.place(`вільний робот біля ${s}`, s === 'С' ? 0 : 1, { at: [70, 90 + 110 * k], side: 'below' })]),
  ) as Record<Station, Place>;
  const releases = LEGS.map(([from, to]) => {
    const fragment = from === 'В1';
    const waiting = net.place(`робот готовий забрати деталь біля ${from}`, 0, fragment ? { at: [320, 260], side: 'above' } : undefined);
    const slot = to === 'С' ? undefined : slots[to];
    for (const [k, s] of STATIONS.entries()) {
      net.transition(`виклик робота ${s}→${from}`, constant(travel(s, from)), {
        in: [ready[from], idle[s], ...(slot ? [slot] : [])],
        out: [waiting],
        priority: 100 - travel(s, from),
        layout: fragment ? { at: [200, 90 + 110 * k], side: 'above', shift: [-60, 0] } : undefined,
      });
    }
    return leg({
      from,
      to,
      who: 'робот',
      pickup: [waiting],
      freed: from === 'А' ? undefined : slots[from],
      home: { place: idle[to], via: fragment ? [[720, 590], [20, 590], [20, 310]] : [] },
      at: (k) => (fragment ? [400 + 80 * k, 260] : undefined),
      sides: ['above', 'above'],
    });
  });
  const store = releases[2];
  if (!store) throw new Error('недосяжно');
  return {
    net,
    arrive,
    store,
    machine1,
    machine2,
    slots,
    ready,
    robotBusy: () => FMS.robots - STATIONS.reduce((s, st) => s + idle[st].tokens, 0),
    width: 880,
    height: 620,
  };
};

// ─────────────────────────────── Задача 3: два мікроавтобуси на приміському маршруті

/** Час у хвилинах, гроші у гривнях. */
export const BUSES = {
  arrival: { min: 0.3, max: 0.7 },
  queueLimit: 30,
  ride: { A: { min: 15, max: 25 }, B: { min: 25, max: 35 } },
  unload: { min: 4, max: 6 },
  fare: 20,
  day: 600,
  maxSeats: 25,
} as const;

export const busNet = (seats: number) => {
  const net = new Net();
  const { arrival, queueLimit, ride, unload } = BUSES;
  const Y = 270;
  const came = net.place('пасажир на зупинці', 0, { at: [190, Y], side: 'above' });
  const arrive = generator(net, 'прихід пасажира', [100, Y], uniform(arrival.min, arrival.max), came);
  const room = net.place('вільні місця в черзі', queueLimit, { at: [280, 150], side: 'above' });
  const queue = net.place('черга', 0, { at: [380, Y], side: 'below' });
  const lostPlace = net.place('пасажири, що пішли', 0, { at: [380, Y + 100], side: 'below' });
  const join = net.transition('стати в чергу', NOW, { in: [came, room], out: [queue], priority: 1, layout: { at: [280, Y], side: 'above', shift: [42, 0] } });
  const leave = net.transition('піти на інший маршрут', NOW, {
    in: [{ place: came, via: [[190, Y + 100]] }],
    out: [lostPlace],
    layout: { at: [280, Y + 100], side: 'below' },
  });

  /** Мікроавтобус: ряд посадки, відправлення, висадки; `sign` = 1 — ряд над чергою, −1 — під нею. */
  const bus = (name: 'A' | 'B', y: number, sign: 1 | -1, priority: number) => {
    const out: Side = sign > 0 ? 'above' : 'below';
    const inner: Side = sign > 0 ? 'below' : 'above';
    const free = net.place(`вільні місця в ${name}`, seats, { at: [570, y + sign * 85], side: sign > 0 ? 'below' : 'left', shown: 'n' });
    const aboard = net.place(`пасажири в ${name}`, 0, { at: [570, y], side: inner });
    const atStop = net.place(`${name} на зупинці`, 1, { at: [660, y - sign * 80], side: out });
    const atEnd = net.place(`${name} на кінцевій`, 0, { at: [770, y], side: out });
    const empty = net.place(`${name} порожній`, 0, { at: [970, y], side: 'right' });
    const board = net.transition(`посадка в ${name}`, NOW, {
      in: [queue, free],
      out: [aboard, { place: room, via: sign > 0 ? [[480, y + 60], [240, y + 60], [240, 150]] : [] }],
      info: [atStop],
      priority,
      layout: { at: [480, y], side: 'left', shift: [0, sign > 0 ? 0 : -14] },
    });
    const depart = net.transition(`відправлення ${name}`, uniform(ride[name].min, ride[name].max), {
      in: [{ place: aboard, weight: seats, shown: 'n' }, atStop],
      out: [atEnd],
      priority: 3,
      layout: { at: [660, y], side: inner, shift: [40, 0] },
    });
    const drop = net.transition(`висадка з ${name}`, uniform(unload.min, unload.max), {
      in: [atEnd],
      out: [empty, { place: free, weight: seats, shown: 'n', via: [[870, y + sign * 85]] }],
      layout: { at: [870, y], side: out },
    });
    const back = net.transition(`повернення ${name}`, uniform(ride[name].min, ride[name].max), {
      in: [{ place: empty, via: [[970, y - sign * 80]] }],
      out: [atStop],
      layout: { at: [870, y - sign * 80], side: out },
    });
    return { board, depart, drop, back, atStop };
  };
  const a = bus('A', 110, -1, 2);
  const b = bus('B', 430, 1, 1);
  return { net, seats, arrive, join, leave, queue, a, b, width: 1060, height: 580 };
};

// ─────────────────────────────── Задача 4: управління запасами холодильників

/** Час у тижнях. */
export const STOCK = {
  demand: 0.2,
  lost: 0.8,
  review: 4,
  level: 72,
  reorder: 18,
  lead: 3,
} as const;

export const stockNet = () => {
  const { demand, lost, review, level, reorder, lead } = STOCK;
  const net = new Net();
  /** при поточному стані запасу ≤ 18 нестача до контрольного рівня ≥ 72 − 18 */
  const threshold = level - reorder;

  const buyer = net.place('покупець', 0, { at: [190, 260], side: 'below' });
  const arrive = generator(net, 'надходження замовлення', [100, 260], exponential(demand), buyer);
  const stock = net.place('запас', level, { at: [300, 60], side: 'above' });
  const gap = net.place('нестача до контрольного рівня', 0, { at: [700, 260], side: 'below' });
  const lostPlace = net.place('продажі, що не відбулися', 0, { at: [420, 260], side: 'below' });
  const backlog = net.place('невдоволений попит', 0, { at: [420, 380], side: 'below' });
  const late = net.place('продано після надходження партії', 0, { at: [680, 380], side: 'below' });

  const sell = net.transition('продаж', NOW, {
    in: [buyer, stock],
    out: [{ place: gap, via: [[700, 150]] }],
    priority: 2,
    layout: { at: [300, 150], side: 'left', shift: [0, -12] },
  });
  const refuse = net.transition('відмова', NOW, { in: [buyer], out: [lostPlace], priority: 1, probability: lost, layout: { at: [300, 260], side: 'above' } });
  const wait = net.transition('повторне замовлення', NOW, {
    in: [buyer],
    out: [backlog, { place: gap, via: [[300, 470], [760, 470], [760, 300]] }],
    priority: 1,
    probability: 1 - lost,
    layout: { at: [300, 380], side: 'left', shift: [0, 35] },
  });
  const serveLate = net.transition('задоволення попиту', NOW, {
    in: [backlog, { place: stock, via: [[360, 100], [530, 340]] }],
    out: [late],
    priority: 3,
    layout: { at: [560, 380], side: 'below' },
  });

  const transit = net.place('холодильники в дорозі', 0, { at: [620, 60], side: 'above' });
  const deliver = net.transition('доставка', constant(lead), { in: [transit], out: [stock], layout: { at: [460, 60], side: 'above' } });
  const timer = net.place('таймер перегляду', 1, { at: [1050, 60], side: 'none' });
  const decision = net.place('перегляд стану запасу', 0, { at: [1110, 260], side: 'right' });
  const reviewT = net.transition('перегляд', constant(review), {
    in: [timer],
    out: [decision, { place: timer, via: [[1110, 100], [1050, 100]] }],
    layout: { at: [1110, 60], side: 'above' },
  });
  const ordering = net.place('замовлення розміщується', 0, { at: [880, 180], side: 'above' });
  const orders = net.place('розміщені замовлення', 0, { at: [1050, 180], side: 'above' });
  const skipped = net.place('перегляди без замовлення', 0, { at: [1200, 380], side: 'below' });
  const order = net.transition('розміщення замовлення', NOW, {
    in: [decision],
    out: [ordering],
    info: [{ place: gap, weight: threshold }],
    priority: 3,
    layout: { at: [880, 260], side: 'below' },
  });
  const noOrder = net.transition('без замовлення', NOW, { in: [decision], out: [skipped], priority: 1, layout: { at: [1110, 380], side: 'left' } });
  // замовлення розміщується поштучно, доки поточний стан запасу не досягне контрольного рівня 72
  const topUp = net.transition('дозамовлення одиниці', NOW, {
    in: [gap],
    out: [transit],
    info: [ordering],
    priority: 4,
    layout: { at: [620, 180], side: 'left' },
  });
  const close = net.transition('кінець замовлення', NOW, { in: [ordering], out: [orders], priority: 2, layout: { at: [965, 180], side: 'above' } });

  return {
    net,
    arrive,
    sell,
    refuse,
    wait,
    serveLate,
    reviewT,
    order,
    noOrder,
    topUp,
    close,
    deliver,
    stock,
    backlog,
    gap,
    /** поточний стан запасу: наявний запас + замовлені раніше − невдоволений попит */
    position: (): number => stock.tokens + transit.tokens + deliver.busy - backlog.tokens,
    width: 1300,
    height: 500,
  };
};
