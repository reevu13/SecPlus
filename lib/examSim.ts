import examWeightsJson from '@/content/_rules/exam_objective_weights.json';
import { objectiveIdSort } from './objectiveIds';
import { RunQuestion } from './runEngine';
import { createSeededRng, hashSeed } from './seededRandom';
import { ExamObjectivesDoc, LocalState, Question, RunQuestionResult } from './types';

type DomainWeightRule = {
  domain_id: string;
  weight: number;
};

type ExamSimConfig = {
  exam_code: string;
  version: string;
  total_questions: number;
  duration_minutes: number;
  min_scenario_questions: number;
  min_interactive_questions: number;
  domain_weights: DomainWeightRule[];
};

type CandidateQuestion = {
  packId: string;
  question: Question;
  domainIds: string[];
  isScenario: boolean;
  isInteractive: boolean;
  weight: number;
};

type SelectedCandidate = {
  candidate: CandidateQuestion;
  assignedDomain: string | null;
};

export type ExamSimulationPlan = {
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
  questions: RunQuestion[];
};

export type ExamObjectiveBreakdownRow = {
  objectiveId: string;
  title: string;
  domainId: string;
  attempted: number;
  correct: number;
  incorrect: number;
  unsure: number;
  accuracy: number;
  wrongRate: number;
  avgTimeMs: number;
};

const DEFAULT_CONFIG: ExamSimConfig = {
  exam_code: 'SY0-701',
  version: '1.0.0',
  total_questions: 90,
  duration_minutes: 90,
  min_scenario_questions: 15,
  min_interactive_questions: 10,
  domain_weights: [
    { domain_id: '1.0', weight: 0.12 },
    { domain_id: '2.0', weight: 0.22 },
    { domain_id: '3.0', weight: 0.18 },
    { domain_id: '4.0', weight: 0.28 },
    { domain_id: '5.0', weight: 0.2 }
  ]
};

const SCENARIO_PATTERN = /\b(scenario|you are|your (team|organization|company)|incident|administrator|analyst|client|user reports?)\b/i;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toPositiveNumber(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value <= 0) return fallback;
  return value;
}

function normalizeConfig(raw: unknown): ExamSimConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_CONFIG;
  const source = raw as Partial<ExamSimConfig>;
  const domainWeights = Array.isArray(source.domain_weights)
    ? source.domain_weights
      .filter((row): row is DomainWeightRule => {
        return Boolean(row)
          && typeof row.domain_id === 'string'
          && row.domain_id.trim().length > 0
          && typeof row.weight === 'number'
          && Number.isFinite(row.weight)
          && row.weight > 0;
      })
      .map((row) => ({ domain_id: row.domain_id.trim(), weight: row.weight }))
    : [];

  return {
    exam_code: typeof source.exam_code === 'string' && source.exam_code.trim() ? source.exam_code.trim() : DEFAULT_CONFIG.exam_code,
    version: typeof source.version === 'string' && source.version.trim() ? source.version.trim() : DEFAULT_CONFIG.version,
    total_questions: Math.round(toPositiveNumber(source.total_questions, DEFAULT_CONFIG.total_questions)),
    duration_minutes: Math.round(toPositiveNumber(source.duration_minutes, DEFAULT_CONFIG.duration_minutes)),
    min_scenario_questions: Math.round(toPositiveNumber(source.min_scenario_questions, DEFAULT_CONFIG.min_scenario_questions)),
    min_interactive_questions: Math.round(toPositiveNumber(source.min_interactive_questions, DEFAULT_CONFIG.min_interactive_questions)),
    domain_weights: domainWeights.length > 0 ? domainWeights : DEFAULT_CONFIG.domain_weights
  };
}

const EXAM_CONFIG = normalizeConfig(examWeightsJson);

export function getExamSimulationConfig() {
  return EXAM_CONFIG;
}

export function createExamSeed() {
  return `SIM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function isInteractiveQuestion(question: Question) {
  return question.type === 'multi_select' || question.type === 'matching' || question.type === 'ordering';
}

function isScenarioQuestion(question: Question) {
  if (question.legacyType && /scenario/i.test(question.legacyType)) return true;
  const stem = question.stem?.trim() ?? '';
  if (!stem) return false;
  if (stem.length >= 220) return true;
  return SCENARIO_PATTERN.test(stem);
}

function questionWeight(state: LocalState, question: Question) {
  const stat = state.questionStats[question.id];
  const attempts = stat?.attempts ?? 0;
  const correct = stat?.correct ?? 0;
  const wrongRate = attempts > 0 ? 1 - (correct / attempts) : 0.45;
  const notSeenBoost = attempts === 0 ? 0.45 : 0;
  const difficulty = typeof question.difficulty === 'number' ? question.difficulty : 3;
  const difficultyBoost = difficulty >= 4 ? 0.15 : 0;
  return Math.max(0.25, 1 + wrongRate * 1.2 + notSeenBoost + difficultyBoost);
}

function pickWeightedIndex<T>(items: T[], getWeight: (item: T) => number, rng: () => number) {
  const total = items.reduce((sum, item) => sum + Math.max(0.0001, getWeight(item)), 0);
  let threshold = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    threshold -= Math.max(0.0001, getWeight(items[i]));
    if (threshold <= 0) return i;
  }
  return items.length - 1;
}

function removeCandidate(pool: CandidateQuestion[], questionId: string) {
  const index = pool.findIndex((item) => item.question.id === questionId);
  if (index < 0) return null;
  const [removed] = pool.splice(index, 1);
  return removed;
}

function computeDomainTargets(domainIds: string[], domainWeights: DomainWeightRule[], total: number) {
  const activeRules = domainIds.map((domainId) => {
    const found = domainWeights.find((row) => row.domain_id === domainId);
    return { domainId, weight: found?.weight ?? 0 };
  });
  const totalWeight = activeRules.reduce((sum, row) => sum + row.weight, 0);
  const normalized = totalWeight > 0
    ? activeRules.map((row) => ({ domainId: row.domainId, weight: row.weight / totalWeight }))
    : activeRules.map((row) => ({ domainId: row.domainId, weight: 1 / Math.max(1, activeRules.length) }));

  const floors = normalized.map((row) => {
    const raw = row.weight * total;
    return {
      domainId: row.domainId,
      base: Math.floor(raw),
      remainder: raw - Math.floor(raw)
    };
  });

  let assigned = floors.reduce((sum, row) => sum + row.base, 0);
  const remaining = Math.max(0, total - assigned);
  floors
    .sort((a, b) => {
      if (b.remainder !== a.remainder) return b.remainder - a.remainder;
      return a.domainId.localeCompare(b.domainId, undefined, { numeric: true, sensitivity: 'base' });
    })
    .slice(0, remaining)
    .forEach((row) => {
      row.base += 1;
      assigned += 1;
    });

  const targetMap = new Map<string, number>();
  floors.forEach((row) => targetMap.set(row.domainId, row.base));
  return targetMap;
}

function chooseAssignedDomain(
  candidate: CandidateQuestion,
  domainTargets: Map<string, number>,
  domainCounts: Map<string, number>
) {
  if (candidate.domainIds.length === 0) return null;
  const ranked = [...candidate.domainIds]
    .map((domainId) => {
      const target = domainTargets.get(domainId) ?? 0;
      const count = domainCounts.get(domainId) ?? 0;
      return {
        domainId,
        deficit: target - count,
        count
      };
    })
    .sort((a, b) => {
      if (a.deficit !== b.deficit) return b.deficit - a.deficit;
      if (a.count !== b.count) return a.count - b.count;
      return a.domainId.localeCompare(b.domainId, undefined, { numeric: true, sensitivity: 'base' });
    });
  return ranked[0]?.domainId ?? candidate.domainIds[0];
}

function countSelected(selected: SelectedCandidate[], predicate: (candidate: CandidateQuestion) => boolean) {
  return selected.reduce((sum, row) => sum + (predicate(row.candidate) ? 1 : 0), 0);
}

function replacementIndex(
  selected: SelectedCandidate[],
  domainTargets: Map<string, number>,
  domainCounts: Map<string, number>,
  keepPredicate: (candidate: CandidateQuestion) => boolean
) {
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  selected.forEach((row, index) => {
    if (keepPredicate(row.candidate)) return;
    let score = row.candidate.weight;
    if (row.assignedDomain) {
      const current = domainCounts.get(row.assignedDomain) ?? 0;
      const target = domainTargets.get(row.assignedDomain) ?? 0;
      if (current <= target) score += 1000;
    }
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function enforceMinimum(
  selected: SelectedCandidate[],
  remaining: CandidateQuestion[],
  domainTargets: Map<string, number>,
  domainCounts: Map<string, number>,
  predicate: (candidate: CandidateQuestion) => boolean,
  minCount: number,
  rng: () => number
) {
  let count = countSelected(selected, predicate);
  while (count < minCount) {
    const candidatePool = remaining.filter(predicate);
    if (candidatePool.length === 0) break;

    const candidate = candidatePool[pickWeightedIndex(candidatePool, (item) => item.weight, rng)];
    const replaceAt = replacementIndex(selected, domainTargets, domainCounts, predicate);
    if (replaceAt < 0) break;

    const removed = selected[replaceAt];
    if (removed.assignedDomain) {
      domainCounts.set(removed.assignedDomain, Math.max(0, (domainCounts.get(removed.assignedDomain) ?? 0) - 1));
    }

    const assignedDomain = chooseAssignedDomain(candidate, domainTargets, domainCounts);
    if (assignedDomain) {
      domainCounts.set(assignedDomain, (domainCounts.get(assignedDomain) ?? 0) + 1);
    }

    selected[replaceAt] = { candidate, assignedDomain };
    removeCandidate(remaining, candidate.question.id);
    remaining.push(removed.candidate);
    count += 1;
  }
}

function shuffleInPlace<T>(items: T[], rng: () => number) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function scenarioCount(selected: SelectedCandidate[]) {
  return countSelected(selected, (candidate) => candidate.isScenario);
}

function interactiveCount(selected: SelectedCandidate[]) {
  return countSelected(selected, (candidate) => candidate.isInteractive);
}

export function generateExamSimulationPlan(input: {
  packs: { pack_id: string; question_bank: Question[] }[];
  objectivesDoc: ExamObjectivesDoc;
  state: LocalState;
  seed?: string;
  now?: Date;
}) {
  const { packs, objectivesDoc, state, now = new Date() } = input;
  const config = getExamSimulationConfig();
  const seed = input.seed?.trim() || createExamSeed();
  const rng = createSeededRng(seed);

  const objectiveDomainById = new Map(objectivesDoc.objectives.map((objective) => [objective.id, objective.domain_id]));
  const domainIds = objectivesDoc.domains.map((domain) => domain.id);

  const candidates: CandidateQuestion[] = packs.flatMap((pack) =>
    pack.question_bank.map((question) => {
      const domainIdsForQuestion = [...new Set(
        (question.objectiveIds ?? [])
          .map((objectiveId) => objectiveDomainById.get(objectiveId))
          .filter((domainId): domainId is string => typeof domainId === 'string' && domainId.length > 0)
      )].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

      return {
        packId: pack.pack_id,
        question,
        domainIds: domainIdsForQuestion,
        isScenario: isScenarioQuestion(question),
        isInteractive: isInteractiveQuestion(question),
        weight: questionWeight(state, question)
      };
    })
  );

  if (candidates.length === 0) {
    return {
      id: `exam-${hashSeed(seed).toString(16)}`,
      seed,
      startedAt: now.toISOString(),
      totalQuestions: 0,
      durationMinutes: config.duration_minutes,
      domainTargets: {},
      domainActual: {},
      minScenarioQuestions: config.min_scenario_questions,
      minInteractiveQuestions: config.min_interactive_questions,
      scenarioCount: 0,
      interactiveCount: 0,
      warnings: ['No questions are available to build an exam simulation.'],
      configVersion: config.version,
      questions: []
    } as ExamSimulationPlan;
  }

  const totalQuestions = clamp(config.total_questions, 1, candidates.length);
  const domainTargets = computeDomainTargets(domainIds, config.domain_weights, totalQuestions);

  const remaining = [...candidates];
  const selected: SelectedCandidate[] = [];
  const domainCounts = new Map<string, number>();
  domainIds.forEach((domainId) => domainCounts.set(domainId, 0));

  domainIds.forEach((domainId) => {
    const target = domainTargets.get(domainId) ?? 0;
    for (let index = 0; index < target; index += 1) {
      const pool = remaining.filter((candidate) => candidate.domainIds.includes(domainId));
      if (pool.length === 0) break;
      const next = pool[pickWeightedIndex(pool, (candidate) => candidate.weight, rng)];
      removeCandidate(remaining, next.question.id);
      selected.push({ candidate: next, assignedDomain: domainId });
      domainCounts.set(domainId, (domainCounts.get(domainId) ?? 0) + 1);
    }
  });

  while (selected.length < totalQuestions && remaining.length > 0) {
    const next = remaining[pickWeightedIndex(remaining, (candidate) => candidate.weight, rng)];
    removeCandidate(remaining, next.question.id);
    const assignedDomain = chooseAssignedDomain(next, domainTargets, domainCounts);
    if (assignedDomain) {
      domainCounts.set(assignedDomain, (domainCounts.get(assignedDomain) ?? 0) + 1);
    }
    selected.push({ candidate: next, assignedDomain });
  }

  const scenarioMinimum = Math.min(config.min_scenario_questions, totalQuestions);
  const interactiveMinimum = Math.min(config.min_interactive_questions, totalQuestions);

  enforceMinimum(
    selected,
    remaining,
    domainTargets,
    domainCounts,
    (candidate) => candidate.isScenario,
    scenarioMinimum,
    rng
  );

  enforceMinimum(
    selected,
    remaining,
    domainTargets,
    domainCounts,
    (candidate) => candidate.isInteractive,
    interactiveMinimum,
    rng
  );

  shuffleInPlace(selected, rng);

  const actualScenarioCount = scenarioCount(selected);
  const actualInteractiveCount = interactiveCount(selected);
  const warnings: string[] = [];

  if (selected.length < totalQuestions) {
    warnings.push(`Only ${selected.length} questions could be selected out of requested ${totalQuestions}.`);
  }

  domainIds.forEach((domainId) => {
    const target = domainTargets.get(domainId) ?? 0;
    const actual = domainCounts.get(domainId) ?? 0;
    if (actual < target) {
      warnings.push(`Domain ${domainId} target ${target} but only ${actual} tagged questions were available.`);
    }
  });

  if (actualScenarioCount < scenarioMinimum) {
    warnings.push(`Scenario target ${scenarioMinimum} but only ${actualScenarioCount} scenario questions were available.`);
  }

  if (actualInteractiveCount < interactiveMinimum) {
    warnings.push(`Interactive target ${interactiveMinimum} but only ${actualInteractiveCount} interactive questions were available.`);
  }

  const startedAt = now.toISOString();
  const signature = `${seed}:${startedAt}:${selected.length}`;
  const id = `exam-${hashSeed(signature).toString(16)}`;

  return {
    id,
    seed,
    startedAt,
    totalQuestions,
    durationMinutes: config.duration_minutes,
    domainTargets: Object.fromEntries(domainIds.map((domainId) => [domainId, domainTargets.get(domainId) ?? 0])),
    domainActual: Object.fromEntries(domainIds.map((domainId) => [domainId, domainCounts.get(domainId) ?? 0])),
    minScenarioQuestions: scenarioMinimum,
    minInteractiveQuestions: interactiveMinimum,
    scenarioCount: actualScenarioCount,
    interactiveCount: actualInteractiveCount,
    warnings,
    configVersion: config.version,
    questions: selected.map((row) => ({
      packId: row.candidate.packId,
      question: row.candidate.question
    }))
  } as ExamSimulationPlan;
}

export function examScorePercent(correct: number, total: number) {
  if (!total) return 0;
  return Math.round((correct / total) * 100);
}

export function computeExamObjectiveBreakdown(input: {
  results: RunQuestionResult[];
  questions: RunQuestion[];
  objectivesDoc: ExamObjectivesDoc;
}) {
  const { results, questions, objectivesDoc } = input;
  const questionById = new Map(questions.map((entry) => [entry.question.id, entry.question]));
  const objectiveMeta = new Map(
    objectivesDoc.objectives.map((objective) => [objective.id, { title: objective.title, domainId: objective.domain_id }])
  );

  const rows = new Map<string, {
    objectiveId: string;
    title: string;
    domainId: string;
    attempted: number;
    correct: number;
    incorrect: number;
    unsure: number;
    totalTimeMs: number;
  }>();

  results.forEach((result) => {
    const question = questionById.get(result.question_id);
    if (!question) return;
    const objectiveIds = (question.objectiveIds ?? []).filter(Boolean);
    objectiveIds.forEach((objectiveId) => {
      const meta = objectiveMeta.get(objectiveId);
      if (!meta) return;
      const row = rows.get(objectiveId) ?? {
        objectiveId,
        title: meta.title,
        domainId: meta.domainId,
        attempted: 0,
        correct: 0,
        incorrect: 0,
        unsure: 0,
        totalTimeMs: 0
      };
      const fullCorrect = result.correct && !result.unsure;
      row.attempted += 1;
      row.correct += fullCorrect ? 1 : 0;
      row.incorrect += fullCorrect ? 0 : 1;
      row.unsure += result.unsure ? 1 : 0;
      row.totalTimeMs += Number.isFinite(result.time_ms) ? result.time_ms : 0;
      rows.set(objectiveId, row);
    });
  });

  const breakdown = [...rows.values()]
    .map((row) => {
      const accuracy = row.attempted > 0 ? (row.correct / row.attempted) * 100 : 0;
      const wrongRate = row.attempted > 0 ? ((row.attempted - row.correct) / row.attempted) * 100 : 0;
      return {
        objectiveId: row.objectiveId,
        title: row.title,
        domainId: row.domainId,
        attempted: row.attempted,
        correct: row.correct,
        incorrect: row.incorrect,
        unsure: row.unsure,
        accuracy,
        wrongRate,
        avgTimeMs: row.attempted > 0 ? row.totalTimeMs / row.attempted : 0
      } as ExamObjectiveBreakdownRow;
    })
    .sort((a, b) => {
      if (a.wrongRate !== b.wrongRate) return b.wrongRate - a.wrongRate;
      if (a.attempted !== b.attempted) return b.attempted - a.attempted;
      return objectiveIdSort(a.objectiveId, b.objectiveId);
    });

  return breakdown;
}

export function weakestObjectiveIdsFromBreakdown(rows: ExamObjectiveBreakdownRow[], limit = 5) {
  return rows
    .filter((row) => row.attempted > 0)
    .sort((a, b) => {
      if (a.wrongRate !== b.wrongRate) return b.wrongRate - a.wrongRate;
      if (a.attempted !== b.attempted) return b.attempted - a.attempted;
      return objectiveIdSort(a.objectiveId, b.objectiveId);
    })
    .slice(0, limit)
    .map((row) => row.objectiveId);
}
