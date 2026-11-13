/** Результати Java-частини (out/results.json, out/nets.json) і результати практикуму 5 для порівняння. */
import { readFile } from 'node:fs/promises';

/** Оцінка за незалежними прогонами: середнє і половина ширини 95 % довірчого інтервалу. */
export interface Estimate {
  readonly mean: number;
  readonly halfWidth: number;
}

export type Estimates = Readonly<Record<string, Estimate>>;

export interface Checks {
  readonly events: number;
  readonly invariantViolations: number;
  readonly stateEquationMismatches: number;
}

export interface Variant {
  readonly label: string;
  readonly result: Estimates;
}

interface Experiment {
  readonly run: { readonly time: number; readonly warmup?: number; readonly runs: number; readonly traceWeeks?: number };
  readonly base: Estimates;
  readonly checks: Checks;
  readonly variants: readonly Variant[];
}

export interface ProtocolStep {
  readonly t: number;
  readonly marks: Readonly<Record<string, number>>;
  readonly exits: Readonly<Record<string, readonly number[]>>;
}

export interface Equations {
  readonly places: readonly string[];
  readonly transitions: readonly string[];
  readonly plus: readonly (readonly number[])[];
  readonly minus: readonly (readonly number[])[];
  readonly time: number;
  readonly initialMark: readonly number[];
  readonly mark: readonly number[];
  readonly active: readonly number[];
  readonly entries: readonly number[];
  readonly exits: readonly number[];
  readonly mismatches: number;
  readonly protocol: readonly ProtocolStep[];
}

export interface WebParameters {
  readonly arrival: number;
  readonly queueLimit: number;
  readonly auxShare: number;
  readonly threads: readonly [number, number];
  readonly cores: readonly [number, number];
  readonly compute: readonly [number, number];
  readonly connections: number;
  readonly write: number;
  readonly reply: number;
}

export interface Results {
  readonly conveyor: Experiment;
  readonly stock: Experiment & { readonly trace: readonly (readonly [number, number, number])[] };
  readonly web: Experiment & {
    readonly parameters: WebParameters;
    readonly unlimited: Estimates;
    readonly theory: Readonly<Record<string, number>>;
    readonly load: readonly { readonly arrival: number; readonly result: Estimates }[];
    readonly equations: Equations;
  };
}

export interface NetArc {
  readonly place: number;
  readonly k: number;
  readonly info?: boolean;
}

export interface NetTransition {
  readonly name: string;
  readonly delay: number;
  readonly distribution: string;
  readonly priority: number;
  readonly probability: number;
  readonly in: readonly NetArc[];
  readonly out: readonly NetArc[];
}

export interface NetStructure {
  readonly name: string;
  readonly places: readonly { readonly name: string; readonly mark: number }[];
  readonly transitions: readonly NetTransition[];
}

export type NetName = 'conveyor' | 'stock' | 'web';
export type Nets = Readonly<Record<NetName, NetStructure>>;

/** Результати власного алгоритму практикуму 5 для тих самих двох задач. */
export interface Lab5 {
  readonly conveyor: Estimates;
  readonly stock: Estimates;
}

const json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;

export const load = async (root: string): Promise<{ results: Results; nets: Nets; lab5: Lab5 }> => ({
  results: await json<Results>(`${root}out/results.json`),
  nets: await json<Nets>(`${root}out/nets.json`),
  lab5: await json<Lab5>(`${root}../lab5-petri/out/results.json`),
});

/** Оцінка за назвою; відсутня характеристика — помилка в назві, а не привід мовчки показати нуль. */
export const at = (e: Estimates, key: string): Estimate => {
  const v = e[key];
  if (!v) throw new Error(`немає характеристики ${key}`);
  return v;
};
