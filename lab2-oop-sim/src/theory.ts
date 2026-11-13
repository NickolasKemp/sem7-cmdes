/**
 * Аналітичні формули теорії масового обслуговування — еталон для верифікації імітаційної моделі.
 * Справедливі для пуассонівського вхідного потоку та експоненційного часу обслуговування.
 */

/** Стаціонарні характеристики СМО M/M/c/K. */
export interface QueueTheory {
  /** імовірність відмови (усі місця в системі зайняті) */
  readonly failureProbability: number;
  /** середня довжина черги */
  readonly meanQueue: number;
  /** середня кількість зайнятих пристроїв */
  readonly meanBusy: number;
  /** завантаження одного пристрою */
  readonly utilization: number;
  /** середній час очікування в черзі */
  readonly meanWait: number;
  /** середній час перебування в СМО */
  readonly meanSojourn: number;
  /** середня кількість вимог у СМО */
  readonly meanInSystem: number;
}

/**
 * СМО M/M/c/K: інтенсивність надходження λ, середній час обслуговування 1/μ, c пристроїв,
 * максимальна довжина черги maxQueue (Infinity — необмежена, тоді потрібно λ < c·μ).
 */
export const mmc = (lambda: number, meanService: number, c: number, maxQueue: number): QueueTheory => {
  const a = lambda * meanService;
  let p: number[];
  if (Number.isFinite(maxQueue)) {
    // ненормовані ймовірності станів: p_n ∝ a^n / n! для n ≤ c, далі множник a/c на кожне місце в черзі
    p = [1];
    for (let n = 1; n <= c + maxQueue; n++) p.push((p[n - 1] ?? 0) * (a / Math.min(n, c)));
  } else {
    const rho = a / c;
    if (rho >= 1) throw new Error(`СМО нестаціонарна: ρ = ${rho} ≥ 1`);
    p = [1];
    for (let n = 1; n <= c; n++) p.push((p[n - 1] ?? 0) * (a / n));
    // хвіст геометричної прогресії для n > c згортаємо аналітично
    const pc = p[c] ?? 0;
    const tail = (pc * rho) / (1 - rho);
    const total = p.reduce((s, x) => s + x, 0) + tail;
    const meanQueue = (pc * rho) / (1 - rho) ** 2 / total;
    const meanBusy = a;
    return finish(lambda, 0, meanQueue, meanBusy, c);
  }
  const total = p.reduce((s, x) => s + x, 0);
  const prob = p.map((x) => x / total);
  const meanQueue = prob.reduce((s, x, n) => s + Math.max(0, n - c) * x, 0);
  const meanBusy = prob.reduce((s, x, n) => s + Math.min(n, c) * x, 0);
  return finish(lambda, prob[prob.length - 1] ?? 0, meanQueue, meanBusy, c);
};

const finish = (lambda: number, failureProbability: number, meanQueue: number, meanBusy: number, c: number): QueueTheory => {
  const effective = lambda * (1 - failureProbability);
  const meanInSystem = meanQueue + meanBusy;
  return {
    failureProbability,
    meanQueue,
    meanBusy,
    utilization: meanBusy / c,
    meanWait: meanQueue / effective,
    meanSojourn: meanInSystem / effective,
    meanInSystem,
  };
};

/**
 * Рівняння балансу потоків відкритої мережі: λ_j = γ_j + Σ_i λ_i·p_ij.
 * `external[j]` — інтенсивність зовнішнього потоку у вузол j, `routing[i][j]` — імовірність переходу i → j.
 * Розв’язується методом Гаусса для системи (I − Pᵀ)·λ = γ.
 */
export const trafficRates = (external: readonly number[], routing: readonly (readonly number[])[]): number[] => {
  const n = external.length;
  const m = Array.from({ length: n }, (_, j) => [
    ...Array.from({ length: n }, (_, i) => (i === j ? 1 : 0) - (routing[i]?.[j] ?? 0)),
    external[j] ?? 0,
  ]);
  for (let col = 0; col < n; col++) {
    const pivot = m.slice(col).reduce((best, row, k) => (Math.abs(row[col] ?? 0) > Math.abs(m[best]?.[col] ?? 0) ? col + k : best), col);
    [m[col], m[pivot]] = [m[pivot] ?? [], m[col] ?? []];
    const lead = m[col] ?? [];
    const d = lead[col] ?? 0;
    if (Math.abs(d) < 1e-12) throw new Error('система рівнянь балансу вироджена (у мережі є замкнений цикл без виходу)');
    for (const [r, row] of m.entries()) {
      if (r === col) continue;
      const f = (row[col] ?? 0) / d;
      for (let k = col; k <= n; k++) row[k] = (row[k] ?? 0) - f * (lead[k] ?? 0);
    }
  }
  return m.map((row, j) => (row[n] ?? 0) / (row[j] ?? 1));
};
