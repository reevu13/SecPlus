import { LocalState } from './types';

const DB_NAME = 'secplus-quest-db';
const STORE_NAME = 'app_state';
const STATE_KEY = 'main';
const DB_VERSION = 2;

function normalizeRemediation(remediation: unknown) {
  if (!Array.isArray(remediation)) return [];
  return remediation
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      label: typeof (entry as { label?: unknown }).label === 'string'
        ? (entry as { label: string }).label.trim()
        : '',
      href: typeof (entry as { href?: unknown }).href === 'string'
        ? (entry as { href: string }).href.trim()
        : '',
      objectiveIds: Array.isArray((entry as { objectiveIds?: unknown }).objectiveIds)
        ? (entry as { objectiveIds: unknown[] }).objectiveIds.filter((value): value is string => typeof value === 'string')
        : undefined
    }))
    .filter((entry) => entry.label.length > 0 && entry.href.length > 0);
}

export function defaultLocalState(): LocalState {
  return {
    version: 2,
    masteryByTag: {},
    streak: { days: 0, lastActive: null },
    runHistory: [],
    mistakeCards: [],
    questionStats: {},
    activeSessions: {},
    lessonProgress: {},
    lessonRecall: {},
    xpTotal: 0,
    cardProgress: {}
  };
}

function normalizeLocalState(state: LocalState | null | undefined): LocalState {
  const base = defaultLocalState();
  if (!state) return base;
  const normalizedMistakeCards = (state.mistakeCards ?? base.mistakeCards).map((card) => ({
    ...card,
    nextDueAt: card.nextDueAt ?? card.due ?? new Date().toISOString(),
    due: card.due ?? card.nextDueAt ?? new Date().toISOString(),
    question_type: card.question_type ?? 'mcq',
    hints_used: card.hints_used ?? false,
    objectiveIds: card.objectiveIds ?? [],
    misconceptionTags: card.misconceptionTags ?? [],
    tags: card.tags ?? [],
    remediation: normalizeRemediation(card.remediation)
  }));
  return {
    ...base,
    ...state,
    version: 2,                           // migrate v1 → v2
    masteryByTag: state.masteryByTag ?? base.masteryByTag,
    streak: { ...base.streak, ...(state.streak ?? {}) },
    runHistory: state.runHistory ?? base.runHistory,
    mistakeCards: normalizedMistakeCards,
    questionStats: state.questionStats ?? base.questionStats,
    activeSessions: state.activeSessions ?? base.activeSessions,
    lessonProgress: state.lessonProgress ?? base.lessonProgress,
    lessonRecall: state.lessonRecall ?? base.lessonRecall,
    xpTotal: typeof state.xpTotal === 'number' ? state.xpTotal : base.xpTotal,
    cardProgress: state.cardProgress ?? base.cardProgress
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadLocalState(): Promise<LocalState> {
  if (typeof window === 'undefined') return defaultLocalState();
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(STATE_KEY);
      request.onsuccess = () => resolve(normalizeLocalState(request.result as LocalState));
      request.onerror = () => resolve(defaultLocalState());
    });
  } catch {
    return defaultLocalState();
  }
}

export async function saveLocalState(state: LocalState) {
  if (typeof window === 'undefined') return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(normalizeLocalState(state), STATE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function updateLocalState(updater: (state: LocalState) => LocalState) {
  const state = await loadLocalState();
  const next = updater(state);
  await saveLocalState(next);
  return next;
}
