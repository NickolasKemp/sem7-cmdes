/**
 * Мережі з N однакових одноканальних СМО різної структури: послідовна і чотири розгалужені.
 * Кожна мережа має N + 1 подію (надходження і N завершень обслуговування) і N + 2 елементи: CREATE, N СМО, DISPOSE.
 */
import { Create } from './create.ts';
import { Dispose } from './dispose.ts';
import { route, to, type Element, type Router } from './element.ts';
import { Model } from './model.ts';
import { Process } from './process.ts';
import { createRng, exponential } from './random.ts';

/** Параметри всіх експериментів: інтенсивність надходження λ і середній час обслуговування в кожній СМО. */
export const BASE = { arrivalMean: 1, serviceMean: 0.3, feedbackP: 0.5 } as const;

export const STRUCTURES = ['serial', 'fan', 'tree', 'skip', 'feedback'] as const;
export type Structure = (typeof STRUCTURES)[number];

export const STRUCTURE_INFO: Record<Structure, { readonly title: string; readonly short: string }> = {
  serial: { title: 'послідовне з’єднання', short: 'послідовна' },
  fan: { title: 'розгалуження на N паралельних СМО', short: 'віяло' },
  tree: { title: 'двійкове дерево розгалужень', short: 'дерево' },
  skip: { title: 'розгалуження з пропуском СМО', short: 'з пропуском' },
  feedback: { title: `послідовна з поверненням (p = ${BASE.feedbackP})`, short: 'з поверненням' },
};

export interface Network {
  readonly model: Model;
  readonly create: Create;
  readonly processes: readonly Process[];
  readonly dispose: Dispose;
}

export interface NetworkOptions {
  readonly seed?: number;
  readonly arrivalMean?: number;
}

/**
 * Будує мережу заданої структури з n СМО. Маршрути:
 * serial — Sᵢ → Sᵢ₊₁; fan — CREATE → Sᵢ з імовірністю 1/n; tree — Sᵢ → S₂ᵢ₊₁ або S₂ᵢ₊₂ з імовірністю 0,5;
 * skip — Sᵢ → Sᵢ₊₁ або Sᵢ₊₂ з імовірністю 0,5; feedback — як serial, але з останньої СМО повернення на першу з імовірністю p.
 * Дуга до неіснуючої СМО веде у вихід.
 */
export const buildNetwork = (structure: Structure, n: number, { seed = 1, arrivalMean = BASE.arrivalMean }: NetworkOptions = {}): Network => {
  if (!(Number.isInteger(n) && n >= 1)) throw new Error(`кількість СМО має бути натуральним числом: ${n}`);
  const rng = createRng(seed);
  const create = new Create('CREATE', exponential(arrivalMean), rng);
  const processes = Array.from({ length: n }, (_, i) => new Process(`S${i + 1}`, exponential(BASE.serviceMean), rng));
  const dispose = new Dispose('DISPOSE');
  const at = (i: number): Element => processes[i] ?? dispose;
  /** розгалуження з рівними ймовірностями; однакові цілі зливаються в одну дугу */
  const split = (...targets: readonly Element[]): Router => {
    const distinct = [...new Set(targets)];
    return distinct.length === 1 ? to(distinct[0] ?? dispose) : route(...distinct.map((t) => ({ to: t, p: 1 / distinct.length })));
  };

  switch (structure) {
    case 'serial':
    case 'feedback':
      create.next = to(at(0));
      for (const [i, s] of processes.entries()) s.next = to(at(i + 1));
      if (structure === 'feedback') {
        const last = processes[n - 1];
        if (last) last.next = route({ to: at(0), p: BASE.feedbackP }, { to: dispose, p: 1 - BASE.feedbackP });
      }
      break;
    case 'fan':
      create.next = split(...processes);
      for (const s of processes) s.next = to(dispose);
      break;
    case 'tree':
      create.next = to(at(0));
      for (const [i, s] of processes.entries()) s.next = 2 * i + 1 < n ? split(at(2 * i + 1), at(2 * i + 2)) : to(dispose);
      break;
    case 'skip':
      create.next = to(at(0));
      for (const [i, s] of processes.entries()) s.next = split(at(i + 1), at(i + 2));
      break;
  }
  return { model: new Model([create, ...processes, dispose]), create, processes, dispose };
};

/**
 * Середня кількість проходжень вимоги через кожну СМО — розв’язок рівнянь балансу потоків vⱼ = δⱼ + Σᵢ vᵢ·pᵢⱼ,
 * отриманий з маршрутів побудованої мережі методом простої ітерації.
 */
export const visitsPerNode = ({ create, processes }: Network): Float64Array => {
  const index = new Map<Element, number>(processes.map((s, i) => [s, i]));
  const inflow = (from: Router | null, weight: number, into: Float64Array): void => {
    for (const arc of from?.arcs ?? []) {
      const j = index.get(arc.to);
      if (j !== undefined) into[j] = (into[j] ?? 0) + weight * (arc.p ?? 1);
    }
  };
  const entry = new Float64Array(processes.length);
  inflow(create.next, 1, entry);
  let visits = entry.slice();
  for (let iteration = 0; iteration < 1_000_000; iteration++) {
    const nextVisits = entry.slice();
    for (const [i, s] of processes.entries()) inflow(s.next, visits[i] ?? 0, nextVisits);
    const change = nextVisits.reduce((m, v, i) => Math.max(m, Math.abs(v - (visits[i] ?? 0))), 0);
    visits = nextVisits;
    if (change < 1e-12) return visits;
  }
  throw new Error('рівняння балансу потоків не збіглися: мережа не має виходу');
};

/**
 * Теоретичні характеристики мережі Джексона: середня кількість обслуговувань вимоги L = Σ vᵢ
 * і середній час перебування вимоги в мережі W = Σ vᵢ·s / (1 − λ·vᵢ·s) (кожна СМО — M/M/1).
 */
export const networkTheory = (network: Network): { readonly visits: number; readonly sojourn: number } => {
  const lambda = 1 / network.create.delay.mean;
  const s = BASE.serviceMean;
  let visits = 0;
  let sojourn = 0;
  for (const v of visitsPerNode(network)) {
    const rho = lambda * v * s;
    if (rho >= 1) throw new Error(`СМО перевантажена: ρ = ${rho}`);
    visits += v;
    sojourn += (v * s) / (1 - rho);
  }
  return { visits, sojourn };
};

/** Найбільша кількість дуг у маршруті одного елемента — від неї залежить вартість вибору дуги. */
export const maxArcs = ({ create, processes }: Network): number => Math.max(...[create, ...processes].map((e) => e.next?.arcs.length ?? 0));
