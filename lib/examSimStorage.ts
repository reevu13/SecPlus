import { ExamObjectiveBreakdownRow, ExamSimulationPlan } from './examSim';
import { RunQuestion } from './runEngine';
import { ChapterPack, RunQuestionResult } from './types';

const ACTIVE_EXAM_KEY = 'secplus_exam_sim_active_v1';
const EXAM_RESULTS_KEY = 'secplus_exam_sim_results_v1';

type StoredExamPlan = {
  id: string;
  seed: string;
  startedAt: string;
  totalQuestions: number;
  durationMinutes: number;
  domainTargets: Record<string, number>;
  domainActual: Record<string, number>;
  minScenarioQuestions: number;
  minInteractiveQuestions: number;
  scenarioCount: number;
  interactiveCount: number;
  warnings: string[];
  configVersion: string;
  questions: { packId: string; questionId: string }[];
};

export type StoredExamSimResult = {
  id: string;
  seed: string;
  startedAt: string;
  endedAt: string;
  total: number;
  correct: number;
  incorrect: number;
  unsure: number;
  scorePercent: number;
  durationSeconds: number;
  objectiveBreakdown: ExamObjectiveBreakdownRow[];
  weakestObjectiveIds: string[];
  warnings: string[];
  results: RunQuestionResult[];
};

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function toStoredPlan(plan: ExamSimulationPlan): StoredExamPlan {
  return {
    id: plan.id,
    seed: plan.seed,
    startedAt: plan.startedAt,
    totalQuestions: plan.totalQuestions,
    durationMinutes: plan.durationMinutes,
    domainTargets: plan.domainTargets,
    domainActual: plan.domainActual,
    minScenarioQuestions: plan.minScenarioQuestions,
    minInteractiveQuestions: plan.minInteractiveQuestions,
    scenarioCount: plan.scenarioCount,
    interactiveCount: plan.interactiveCount,
    warnings: plan.warnings,
    configVersion: plan.configVersion,
    questions: plan.questions.map((item) => ({ packId: item.packId, questionId: item.question.id }))
  };
}

function fromStoredPlan(stored: StoredExamPlan, questions: RunQuestion[]): ExamSimulationPlan {
  return {
    id: stored.id,
    seed: stored.seed,
    startedAt: stored.startedAt,
    totalQuestions: stored.totalQuestions,
    durationMinutes: stored.durationMinutes,
    domainTargets: stored.domainTargets,
    domainActual: stored.domainActual,
    minScenarioQuestions: stored.minScenarioQuestions,
    minInteractiveQuestions: stored.minInteractiveQuestions,
    scenarioCount: stored.scenarioCount,
    interactiveCount: stored.interactiveCount,
    warnings: stored.warnings,
    configVersion: stored.configVersion,
    questions
  };
}

export function storeActiveExamPlan(plan: ExamSimulationPlan) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(ACTIVE_EXAM_KEY, JSON.stringify(toStoredPlan(plan)));
}

export function clearActiveExamPlan() {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(ACTIVE_EXAM_KEY);
}

export function getStoredActiveExamPlan() {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(ACTIVE_EXAM_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredExamPlan;
  } catch {
    return null;
  }
}

export function expandStoredActiveExamPlan(packs: ChapterPack[]) {
  const stored = getStoredActiveExamPlan();
  if (!stored) return null;

  const expandedQuestions = stored.questions
    .map((entry) => {
      const pack = packs.find((item) => item.pack_id === entry.packId);
      const question = pack?.question_bank.find((candidate) => candidate.id === entry.questionId);
      if (!pack || !question) return null;
      return { packId: pack.pack_id, question };
    })
    .filter((item): item is RunQuestion => Boolean(item));

  if (expandedQuestions.length === 0) return null;
  return fromStoredPlan(stored, expandedQuestions);
}

function loadResultsStore(): StoredExamSimResult[] {
  if (!canUseStorage()) return [];
  const raw = window.localStorage.getItem(EXAM_RESULTS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as StoredExamSimResult[];
  } catch {
    return [];
  }
}

function saveResultsStore(results: StoredExamSimResult[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(EXAM_RESULTS_KEY, JSON.stringify(results));
}

export function storeExamSimResult(result: StoredExamSimResult) {
  const filtered = loadResultsStore().filter((item) => item.id !== result.id);
  const next = [result, ...filtered]
    .sort((a, b) => b.endedAt.localeCompare(a.endedAt))
    .slice(0, 20);
  saveResultsStore(next);
}

export function getExamSimResult(resultId: string) {
  if (!resultId) return null;
  return loadResultsStore().find((item) => item.id === resultId) ?? null;
}

export function getLatestExamSimResult() {
  return loadResultsStore()[0] ?? null;
}
