/**
 * Теоретична оцінка складності за формулою з лекції 5: O = ν·T·k, де ν — інтенсивність подій,
 * T — час моделювання, k — кількість елементарних операцій на обробку однієї події.
 * Для алгоритму найближчої події k = 4·(N + 2) + (кількість дуг маршруту) + const.
 */
import type { Measurement } from './experiments.ts';
import { buildNetwork, visitsPerNode, type Structure } from './networks.ts';

export interface Operations {
  /** ν·T — кількість подій */
  readonly events: number;
  /** 4·(N + 2)·ν·T — звернення до елементів у чотирьох циклах кроку алгоритму */
  readonly elementVisits: number;
  /** перегляди дуг під час вибору маршруту: λ·T·(a₀ + Σ vᵢ·aᵢ), aᵢ — кількість дуг маршруту елемента */
  readonly arcVisits: number;
}

export const theoreticalOps = (structure: Structure, n: number, lambda: number, time: number): Operations => {
  const network = buildNetwork(structure, n, { arrivalMean: 1 / lambda });
  const visits = visitsPerNode(network);
  const arcs = (r: { readonly arcs: readonly unknown[] } | null): number => r?.arcs.length ?? 0;
  const perJob = network.processes.reduce((sum, s, i) => sum + (visits[i] ?? 0) * arcs(s.next), arcs(network.create.next));
  const events = lambda * time * (1 + visits.reduce((a, v) => a + v, 0));
  return { events, elementVisits: 4 * (n + 2) * events, arcVisits: lambda * time * perJob };
};

/** Час обчислення як лінійна комбінація операцій: t = α·(звернення до елементів) + β·(перегляди дуг) + γ·(події). */
export interface CostModel {
  /** нс на одне звернення до елемента */
  readonly alpha: number;
  /** нс на перегляд однієї дуги */
  readonly beta: number;
  /** нс на сталу частину обробки події */
  readonly gamma: number;
  /** коефіцієнт детермінації на всіх дослідах */
  readonly r2: number;
}

const features = (o: Operations): readonly [number, number, number] => [o.elementVisits, o.arcVisits, o.events];

/** Операції, фактично підраховані під час досліду. */
const counted = (m: Measurement): Operations => ({ events: m.steps, elementVisits: m.elementVisits, arcVisits: m.arcVisits });

export const predictMs = (model: CostModel, o: Operations): number => {
  const [e, a, s] = features(o);
  return (model.alpha * e + model.beta * a + model.gamma * s) / 1e6;
};

/** Розв’язок системи лінійних рівнянь методом Гаусса з вибором головного елемента. */
const solve = (a: number[][], b: number[]): number[] => {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] ?? 0]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]?.[col] ?? 0) > Math.abs(m[pivot]?.[col] ?? 0)) pivot = r;
    [m[col], m[pivot]] = [m[pivot] ?? [], m[col] ?? []];
    const lead = m[col] ?? [];
    for (let r = 0; r < n; r++) {
      const row = m[r];
      if (r === col || !row) continue;
      const k = (row[col] ?? 0) / (lead[col] ?? 1);
      for (let c = col; c <= n; c++) row[c] = (row[c] ?? 0) - k * (lead[c] ?? 0);
    }
  }
  return m.map((row, i) => (row[n] ?? 0) / (row[i] ?? 1));
};

/**
 * Метод найменших квадратів для відносної похибки: кожне рівняння ділиться на виміряний час,
 * інакше найдовші досліди визначали б коефіцієнти самі.
 */
export const fitCostModel = (measurements: readonly Measurement[]): CostModel => {
  const rows = measurements.map((m) => ({ x: features(counted(m)), y: m.ms * 1e6 }));
  const ata = [0, 1, 2].map((i) => [0, 1, 2].map((j) => rows.reduce((s, { x, y }) => s + ((x[i] ?? 0) * (x[j] ?? 0)) / (y * y), 0)));
  const atb = [0, 1, 2].map((i) => rows.reduce((s, { x, y }) => s + (x[i] ?? 0) / y, 0));
  const [alpha = 0, beta = 0, gamma = 0] = solve(ata, atb);
  const mean = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  const ssTot = rows.reduce((s, r) => s + (r.y - mean) ** 2, 0);
  const ssRes = rows.reduce((s, { x, y }) => s + (y - (alpha * x[0] + beta * x[1] + gamma * x[2])) ** 2, 0);
  return { alpha, beta, gamma, r2: 1 - ssRes / ssTot };
};

/** Показник степеня b у залежності t ≈ c·Nᵇ — нахил прямої в логарифмічних координатах. */
export const growthExponent = (points: readonly (readonly [number, number])[]): number => {
  const xs = points.map(([x]) => Math.log(x));
  const ys = points.map(([, y]) => Math.log(y));
  const mx = xs.reduce((a, x) => a + x, 0) / xs.length;
  const my = ys.reduce((a, y) => a + y, 0) / ys.length;
  const sxy = xs.reduce((s, x, i) => s + (x - mx) * ((ys[i] ?? 0) - my), 0);
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return sxy / sxx;
};
