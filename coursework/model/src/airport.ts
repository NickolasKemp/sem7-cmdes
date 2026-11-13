/**
 * Модель аеропорту (завдання В12) у вигляді стохастичної мережі Петрі з маркерами-літаками.
 * Одиниця модельного часу — хвилина.
 */
import { Net, simulate } from './petri.ts';
import { constant, exponential, uniform, type Rng } from './random.ts';

export const MINUTES_PER_YEAR = 365 * 24 * 60;

/** Вхідні змінні та параметри моделі з тексту завдання. */
export interface AirportParams {
  /** кількість посадкових смуг */
  readonly runways: number;
  /** середній інтервал між надходженнями літаків, хв */
  readonly arrivalMean: number;
  /** тривалість зайнятості смуги після посадки, хв */
  readonly landing: number;
  /** очікування, після якого потрібна дозаправка: рівномірно в [min; max], хв */
  readonly refuelAfter: readonly [number, number];
  /** очікування, після якого літак відлітає в інший аеропорт, хв */
  readonly leaveAfter: number;
  /** прибуток за посадку без очікування, грн */
  readonly incomeNoWait: number;
  /** прибуток за посадку з очікуванням: рівномірно в [min; max], грн */
  readonly incomeWait: readonly [number, number];
  /** витрати на дозаправку: рівномірно в [min; max], грн */
  readonly refuelCost: readonly [number, number];
  /** вартість будівництва однієї додаткової смуги, грн */
  readonly runwayCost: number;
}

export const BASE: AirportParams = {
  runways: 2,
  arrivalMean: 6,
  landing: 35,
  refuelAfter: [60, 80],
  leaveAfter: 140,
  incomeNoWait: 2000,
  incomeWait: [1400, 1600],
  refuelCost: [800, 1200],
  runwayCost: 3_000_000,
};

export const MAX_EXTRA_RUNWAYS = 10;

export const buildAirport = (p: AirportParams) => {
  const net = new Net();
  const generator = net.place('Генератор', 1, { at: [60, 150], side: 'below' });
  const arrived = net.place('Прибув', 0, { at: [230, 150], side: 'below' });
  const free = net.place('Вільні смуги', p.runways, { at: [480, 150], side: 'below', shown: 'n' });
  const queue = net.place('Черга', 0, { at: [480, 260], side: 'below', shift: [-30, 0] });
  const landed = net.place('Приземлені', 0, { at: [760, 140], side: 'right' });
  const toLeave = net.place('Очікує відльоту', 0, { at: [480, 380], side: 'below' });
  const leaveSignal = net.place('Сигнал відльоту', 0, { at: [720, 380], side: 'below' });
  const left = net.place('Відлетіли', 0, { at: [1000, 340], side: 'right' });
  const leaveCancelled = net.place('Скасовані відльоти', 0, { at: [1000, 420], side: 'right' });
  const toRefuel = net.place('Очікує дозаправки', 0, { at: [480, 530], side: 'below' });
  const refuelSignal = net.place('Сигнал дозаправки', 0, { at: [720, 530], side: 'below' });
  const refuelled = net.place('Дозаправлені', 0, { at: [1000, 490], side: 'right' });
  const refuelCancelled = net.place('Скасовані дозаправки', 0, { at: [1000, 570], side: 'right' });

  const arrival = net.transition('Надходження', exponential(p.arrivalMean), {
    in: [generator],
    out: [{ place: generator, via: [[140, 90], [60, 90]] }, { place: arrived, carry: true }],
    spawn: true,
    layout: { at: [140, 150], side: 'below' },
  });
  const landNow = net.transition('Посадка без очікування', constant(p.landing), {
    in: [{ place: arrived, match: true }, free],
    out: [{ place: landed, carry: true, via: [[760, 70]] }, { place: free, via: [[360, 150]] }],
    priority: 1,
    layout: { at: [360, 70], side: 'above' },
  });
  const enqueue = net.transition('У чергу', constant(0), {
    in: [{ place: arrived, match: true }],
    out: [
      { place: queue, carry: true },
      { place: toLeave, carry: true, via: [[380, 380]] },
      { place: toRefuel, carry: true, via: [[360, 530]] },
    ],
    layout: { at: [360, 260], side: 'left' },
  });
  const landAfterWait = net.transition('Посадка з очікуванням', constant(p.landing), {
    in: [{ place: queue, match: true }, { place: free, via: [[600, 150]] }],
    out: [{ place: landed, carry: true, via: [[760, 200]] }, free],
    priority: 2,
    layout: { at: [600, 200], side: 'right', shift: [0, 26] },
  });
  const leaveTimer = net.transition('Очікування відльоту', constant(p.leaveAfter), {
    in: [{ place: toLeave, match: true }],
    out: [{ place: leaveSignal, carry: true }],
    layout: { at: [600, 380], side: 'below' },
  });
  const leave = net.transition('Відліт', constant(0), {
    in: [{ place: leaveSignal, match: true }, { place: queue, match: true, via: [[860, 260]] }],
    out: [left],
    priority: 1,
    layout: { at: [860, 340], side: 'right', shift: [6, 30] },
  });
  const cancelLeave = net.transition('Скасування відльоту', constant(0), {
    in: [leaveSignal],
    out: [leaveCancelled],
    layout: { at: [860, 420], side: 'right', shift: [6, 30] },
  });
  const refuelTimer = net.transition('Очікування дозаправки', uniform(...p.refuelAfter), {
    in: [{ place: toRefuel, match: true }],
    out: [{ place: refuelSignal, carry: true }],
    layout: { at: [600, 530], side: 'below' },
  });
  const refuel = net.transition('Дозаправка', constant(0), {
    in: [{ place: refuelSignal, match: true }],
    info: [{ place: queue, match: true, via: [[540, 300], [540, 465], [860, 465]] }],
    out: [refuelled],
    priority: 1,
    layout: { at: [860, 490], side: 'right', shift: [6, 30] },
  });
  const cancelRefuel = net.transition('Скасування дозаправки', constant(0), {
    in: [refuelSignal],
    out: [refuelCancelled],
    layout: { at: [860, 570], side: 'right', shift: [6, 30] },
  });

  return {
    net,
    places: { generator, arrived, free, queue, landed, toLeave, leaveSignal, left, leaveCancelled, toRefuel, refuelSignal, refuelled, refuelCancelled },
    transitions: { arrival, landNow, enqueue, landAfterWait, leaveTimer, leave, cancelLeave, refuelTimer, refuel, cancelRefuel },
  };
};

export type Airport = ReturnType<typeof buildAirport>;

/** Вихідні змінні одного прогону за інтервал збору статистики. */
export interface AirportRun {
  readonly span: number;
  readonly arrived: number;
  readonly landedNoWait: number;
  readonly landedAfterWait: number;
  readonly refuelled: number;
  readonly left: number;
  /** середній час очікування посадки серед літаків, що приземлилися, хв */
  readonly meanWait: number;
  readonly meanQueue: number;
  readonly maxQueue: number;
  /** середня кількість зайнятих смуг */
  readonly busyRunways: number;
  readonly income: number;
  readonly refuelCosts: number;
  /** прибуток за рік: дохід від посадок мінус витрати на дозаправки, перераховані на 365 діб */
  readonly yearProfit: number;
}

const between = (rng: Rng, [min, max]: readonly [number, number]): number => min + rng() * (max - min);

export interface AirportRunOptions {
  readonly time: number;
  readonly warmup: number;
  readonly rng: Rng;
  /** після кожної події: поточний момент і прибуток, накопичений від кінця розгону */
  readonly onProgress?: (now: number, profit: number) => void;
}

export const runAirport = (p: AirportParams, { time, warmup, rng, onProgress }: AirportRunOptions): AirportRun => {
  const { places, transitions: tr, net } = buildAirport(p);
  let landedNoWait = 0;
  let landedAfterWait = 0;
  let income = 0;
  let refuelCosts = 0;
  let waitSum = 0;
  const result = simulate(net, {
    time,
    warmup,
    rng,
    onEnter: (t, token, now) => {
      if (now < warmup || !token) return;
      if (t === tr.landNow) {
        landedNoWait++;
        income += p.incomeNoWait;
      }
      if (t === tr.landAfterWait) {
        landedAfterWait++;
        income += between(rng, p.incomeWait);
        waitSum += now - token.born;
      }
      if (t === tr.refuel) refuelCosts += between(rng, p.refuelCost);
    },
    onEvent: onProgress && ((now) => onProgress(now, income - refuelCosts)),
  });
  const landed = landedNoWait + landedAfterWait;
  const queue = result.place(places.queue);
  return {
    span: result.span,
    arrived: result.fired(tr.arrival),
    landedNoWait,
    landedAfterWait,
    refuelled: result.fired(tr.refuel),
    left: result.fired(tr.leave),
    meanWait: landed ? waitSum / landed : 0,
    meanQueue: queue.mean,
    maxQueue: queue.max,
    busyRunways: result.busy(tr.landNow).mean + result.busy(tr.landAfterWait).mean,
    income,
    refuelCosts,
    yearProfit: ((income - refuelCosts) / result.span) * MINUTES_PER_YEAR,
  };
};
