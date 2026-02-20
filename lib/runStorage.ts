import { RunPlan } from './runEngine';
import { ChapterPack } from './types';

const RUN_KEY = 'secplus_run_plans_v1';

type StoredPlan = {
  seed: string;
  created_at: string;
  questions: { packId: string; questionId: string }[];
  weakTags: string[];
  focusTags?: string[];
  chapterScope?: string[];
  runtimeMinutes?: number;
  minutesPerQuestion?: number;
  targetCount?: number;
};

function normalizeScope(values: string[] = []) {
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function sameScope(a: string[] = [], b: string[] = []) {
  const left = normalizeScope(a);
  const right = normalizeScope(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeTiming(config: { runtimeMinutes?: number; minutesPerQuestion?: number; targetCount?: number } = {}) {
  return {
    runtimeMinutes: Number.isFinite(config.runtimeMinutes) ? Number(config.runtimeMinutes) : 90,
    minutesPerQuestion: Number.isFinite(config.minutesPerQuestion) ? Number(config.minutesPerQuestion) : 1,
    targetCount: Number.isFinite(config.targetCount) ? Number(config.targetCount) : 30
  };
}

function sameTiming(
  a: { runtimeMinutes?: number; minutesPerQuestion?: number; targetCount?: number } = {},
  b: { runtimeMinutes?: number; minutesPerQuestion?: number; targetCount?: number } = {}
) {
  const left = normalizeTiming(a);
  const right = normalizeTiming(b);
  return (
    left.runtimeMinutes === right.runtimeMinutes
    && left.minutesPerQuestion === right.minutesPerQuestion
    && left.targetCount === right.targetCount
  );
}

function loadStore(): StoredPlan[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(RUN_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as StoredPlan[];
  } catch {
    return [];
  }
}

function saveStore(plans: StoredPlan[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RUN_KEY, JSON.stringify(plans));
}

export function getStoredRun(
  seed: string,
  focusTags: string[] = [],
  chapterScope: string[] = [],
  timing: { runtimeMinutes?: number; minutesPerQuestion?: number; targetCount?: number } = {}
): StoredPlan | null {
  const plans = loadStore();
  return plans.find((plan) => (
    plan.seed === seed
    && sameScope(plan.focusTags ?? [], focusTags)
    && sameScope(plan.chapterScope ?? [], chapterScope)
    && sameTiming(plan, timing)
  )) ?? null;
}

export function storeRunPlan(plan: RunPlan) {
  const plans = loadStore();
  const stored: StoredPlan = {
    seed: plan.seed,
    created_at: new Date().toISOString(),
    questions: plan.questions.map((q) => ({ packId: q.packId, questionId: q.question.id })),
    weakTags: plan.weakTags,
    focusTags: plan.focusTags,
    chapterScope: plan.chapterScope,
    runtimeMinutes: plan.runtimeMinutes,
    minutesPerQuestion: plan.minutesPerQuestion,
    targetCount: plan.targetCount
  };
  const filtered = plans.filter((item) => !(
    item.seed === plan.seed
    && sameScope(item.focusTags ?? [], plan.focusTags)
    && sameScope(item.chapterScope ?? [], plan.chapterScope)
    && sameTiming(item, plan)
  ));
  saveStore([...filtered, stored]);
}

export function expandStoredRun(plan: StoredPlan, packs: ChapterPack[]) {
  const questions = plan.questions
    .map((item) => {
      const pack = packs.find((p) => p.pack_id === item.packId);
      const question = pack?.question_bank.find((q) => q.id === item.questionId);
      if (!pack || !question) return null;
      return { packId: pack.pack_id, question };
    })
    .filter(Boolean);

  return {
    seed: plan.seed,
    questions,
    weakTags: plan.weakTags,
    focusTags: plan.focusTags ?? [],
    chapterScope: plan.chapterScope ?? Array.from(new Set(plan.questions.map((item) => item.packId))),
    runtimeMinutes: Number.isFinite(plan.runtimeMinutes) ? Number(plan.runtimeMinutes) : 90,
    minutesPerQuestion: Number.isFinite(plan.minutesPerQuestion) ? Number(plan.minutesPerQuestion) : 1,
    targetCount: Number.isFinite(plan.targetCount) ? Number(plan.targetCount) : questions.length
  } as RunPlan;
}
