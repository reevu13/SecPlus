import { RunQuestionResult } from './types';

const RESULTS_KEY = 'secplus_run_results_v1';

export type StoredRunResult = {
  seed: string;
  ended_at: string;
  total: number;
  correct: number;
  incorrect: number;
  unsure: number;
  xp: number;
  results: RunQuestionResult[];
};

function loadStore(): StoredRunResult[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(RESULTS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as StoredRunResult[];
  } catch {
    return [];
  }
}

function saveStore(results: StoredRunResult[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
}

export function getRunResult(seed: string) {
  return loadStore().find((result) => result.seed === seed) ?? null;
}

export function storeRunResult(result: StoredRunResult) {
  const store = loadStore().filter((item) => item.seed !== result.seed);
  saveStore([...store, result]);
}
