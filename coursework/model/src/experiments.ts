/**
 * Експериментальне дослідження моделі аеропорту: перехідний період, тривалість і кількість прогонів,
 * верифікація, перебір кількості додаткових смуг і час окупності.
 */
import { BASE, MAX_EXTRA_RUNWAYS, MINUTES_PER_YEAR, runAirport, type AirportParams, type AirportRun } from './airport.ts';
import { createRng } from './random.ts';
import { Accumulator, estimate, type Estimate } from './stats.ts';

const HOUR = 60;
const DAY = 24 * HOUR;

/** Прогін на рік модельного часу після розгону на одну добу. */
export const RUN = { warmup: DAY, time: DAY + MINUTES_PER_YEAR } as const;

const run = (p: AirportParams, seed: number): AirportRun => runAirport(p, { ...RUN, rng: createRng(seed) });

/** Інтенсивність надходження літаків, 1/год, у середній інтервал між ними, хв. */
export const arrivalMeanFor = (perHour: number): number => HOUR / perHour;

// ─────────────────────────────── Перехідний період і тривалість прогону

export const TRANSIENT = { runs: 4, seed: 11, horizon: 120 * DAY, epsilon: 0.02, window: HOUR, windowHorizon: 2 * DAY } as const;

export interface Transient {
  readonly runways: number;
  /** оцінка річного прибутку за інтервал [0; t] у кожному з прогонів, точки раз на добу */
  readonly cumulative: readonly (readonly (readonly [number, number])[])[];
  /** прибуток за кожну годину перших двох діб, усереднений за прогонами */
  readonly hourly: readonly (readonly [number, number])[];
  /** момент T, після якого оцінки різних прогонів відрізняються менше ніж на ε від їхнього середнього */
  readonly settled: number;
}

export const transient = (runways: number): Transient => {
  const { runs, seed, horizon, epsilon, window, windowHorizon } = TRANSIENT;
  const windows = Math.round(windowHorizon / window);
  const hourlySum = Array.from({ length: windows }, () => 0);
  const cumulative = Array.from({ length: runs }, (_, i) => {
    const points: [number, number][] = [];
    let nextDay = DAY;
    let windowStart = 0;
    let windowIndex = 0;
    runAirport(
      { ...BASE, runways },
      {
        time: horizon,
        warmup: 0,
        rng: createRng(seed + i),
        onProgress: (now, profit) => {
          while (windowIndex < windows && now >= (windowIndex + 1) * window) {
            hourlySum[windowIndex] = (hourlySum[windowIndex] ?? 0) + profit - windowStart;
            windowStart = profit;
            windowIndex++;
          }
          while (now >= nextDay) {
            points.push([nextDay / DAY, (profit / nextDay) * MINUTES_PER_YEAR]);
            nextDay += DAY;
          }
        },
      },
    );
    return points;
  });

  const days = Math.min(...cumulative.map((c) => c.length));
  let settled = days;
  for (let d = days - 1; d >= 0; d--) {
    const ys = cumulative.map((c) => c[d]?.[1] ?? 0);
    const mean = ys.reduce((s, y) => s + y, 0) / ys.length;
    if (Math.max(...ys) - Math.min(...ys) >= epsilon * Math.abs(mean)) break;
    settled = d + 1;
  }
  return {
    runways,
    cumulative,
    hourly: hourlySum.map((s, i) => [i + 1, s / runs] as const),
    settled,
  };
};

// ─────────────────────────────── Кількість прогонів

/** Пробні прогони для оцінки σ; потрібна кількість замірів p = 20·σ²/ε² за довірчої ймовірності 0,95. */
/** ε задано в гривнях: біля нуля прибутку (4 смуги) відносна похибка вимагала б тисяч прогонів. */
export const RUNS = { pilot: 10, seed: 101, epsilon: 1_000_000 } as const;

export interface RunsNeeded {
  readonly runways: number;
  readonly mean: number;
  readonly deviation: number;
  readonly needed: number;
}

export const runsNeeded = (runways: number): RunsNeeded => {
  const acc = new Accumulator();
  for (let i = 0; i < RUNS.pilot; i++) acc.add(run({ ...BASE, runways }, RUNS.seed + i).yearProfit);
  return { runways, mean: acc.mean, deviation: acc.deviation, needed: Math.ceil((20 * acc.deviation ** 2) / RUNS.epsilon ** 2) };
};

// ─────────────────────────────── Верифікація

export const VERIFY = { time: 30 * DAY, warmup: DAY, seed: 501 } as const;

export interface VerifyCase {
  readonly name: string;
  readonly params: AirportParams;
}

export const VERIFY_CASES: readonly VerifyCase[] = [
  { name: 'базовий', params: BASE },
  { name: 'n = 7', params: { ...BASE, runways: 7 } },
  { name: 'n = 30', params: { ...BASE, runways: 30 } },
  { name: 'інтервал 12 хв', params: { ...BASE, arrivalMean: 12 } },
  { name: 'посадка 20 хв', params: { ...BASE, landing: 20 } },
  { name: 'відліт після 90 хв', params: { ...BASE, leaveAfter: 90 } },
  { name: 'дозаправка після 150 ± 10 хв', params: { ...BASE, refuelAfter: [140, 160] } },
  { name: 'дозаправка після 10 ± 0 хв', params: { ...BASE, refuelAfter: [10, 10] } },
];

export interface Verification {
  readonly name: string;
  readonly params: AirportParams;
  readonly result: AirportRun;
  /** очікувана кількість надходжень span / arrivalMean */
  readonly expectedArrivals: number;
  /** середня кількість зайнятих смуг за формулою Літтла: посадки · тривалість / span */
  readonly littleBusy: number;
}

export const verify = (): Verification[] =>
  VERIFY_CASES.map(({ name, params }) => {
    const result = runAirport(params, { time: VERIFY.time, warmup: VERIFY.warmup, rng: createRng(VERIFY.seed) });
    const landed = result.landedNoWait + result.landedAfterWait;
    return {
      name,
      params,
      result,
      expectedArrivals: result.span / params.arrivalMean,
      littleBusy: (landed * params.landing) / result.span,
    };
  });

// ─────────────────────────────── Кількість смуг і час окупності

export interface Payback {
  readonly extra: number;
  readonly runways: number;
  readonly profit: Estimate;
  readonly arrived: Estimate;
  readonly left: Estimate;
  readonly refuelled: Estimate;
  readonly meanWait: Estimate;
  readonly busyRunways: Estimate;
  /** додатковий річний прибуток порівняно з двома смугами */
  readonly gain: Estimate;
  /** T = S / p з p — додатковим прибутком, років */
  readonly paybackGain: Estimate | undefined;
  /** T = S / p з p — загальним прибутком аеропорту, років (лише коли прибуток додатний) */
  readonly paybackTotal: Estimate | undefined;
}

/** Для кожної кількості додаткових смуг k — однакові seed (спільні випадкові числа), тож різниця прибутків менш зашумлена. */
export const payback = (runs: number, params: AirportParams = BASE, seed = 1001): Payback[] => {
  const samples = Array.from({ length: MAX_EXTRA_RUNWAYS + 1 }, (_, extra) =>
    Array.from({ length: runs }, (_, i) => run({ ...params, runways: params.runways + extra }, seed + i)),
  );
  const base = samples[0] ?? [];
  return samples.map((rs, extra) => {
    const of = (f: (r: AirportRun) => number): Estimate => estimate(rs.map(f));
    const cost = extra * params.runwayCost;
    const gains = rs.map((r, i) => r.yearProfit - (base[i]?.yearProfit ?? 0));
    const positive = rs.every((r) => r.yearProfit > 0);
    return {
      extra,
      runways: params.runways + extra,
      profit: of((r) => r.yearProfit),
      arrived: of((r) => r.arrived),
      left: of((r) => r.left),
      refuelled: of((r) => r.refuelled),
      meanWait: of((r) => r.meanWait),
      busyRunways: of((r) => r.busyRunways),
      gain: estimate(gains),
      paybackGain: extra ? estimate(gains.map((g) => cost / g)) : undefined,
      paybackTotal: extra && positive ? estimate(rs.map((r) => cost / r.yearProfit)) : undefined,
    };
  });
};

// ─────────────────────────────── Пробний запуск: інша інтенсивність надходження

/** Інтенсивність надходження, 1/год, за якої перевіряється, чи лишається оптимум тим самим; 10 — базова. */
export const SENSITIVITY = { perHour: [8, 12] } as const;

export interface Sensitivity {
  readonly perHour: number;
  readonly payback: Payback[];
}

export const sensitivity = (runs: number): Sensitivity[] =>
  SENSITIVITY.perHour.map((perHour) => ({ perHour, payback: payback(runs, { ...BASE, arrivalMean: arrivalMeanFor(perHour) }) }));
