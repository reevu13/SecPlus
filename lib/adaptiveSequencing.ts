import { objectiveIdSort } from './objectiveIds';
import { OutlineMapDoc, OutlineMapEntry } from './coverage';
import { ChapterLesson, ChapterPack, ExamObjectivesDoc, LocalState, Question, QuestionStat } from './types';
import { getMistakeCardDueAt } from './progress';

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENCY_HALF_LIFE_DAYS = 21;
const COACH_PLAN_STORAGE_KEY = 'secplus_coach_plan_v1';

type ObjectiveAccumulator = {
  questionIds: Set<string>;
  attemptedQuestionIds: Set<string>;
  attempts: number;
  correct: number;
  weightedScore: number;
  weightTotal: number;
  latestAnsweredMs: number | null;
};

type MisconceptionAccumulator = {
  tag: string;
  questionIds: Set<string>;
  attemptedQuestionIds: Set<string>;
  attempts: number;
  correct: number;
  weightedScore: number;
  weightTotal: number;
  latestAnsweredMs: number | null;
  linkedObjectiveIds: Set<string>;
};

function round(value: number, digits = 1) {
  const precision = 10 ** digits;
  return Math.round(value * precision) / precision;
}

function simpleHash(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeObjectiveIds(values: string[] | undefined) {
  return [...new Set((values ?? []).filter(Boolean))].sort(objectiveIdSort);
}

function normalizeTags(values: string[] | undefined) {
  return [...new Set((values ?? []).filter(Boolean).map((value) => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function recencyScore(lastAnswered: string | undefined, nowMs: number) {
  if (!lastAnswered) return 0;
  const answeredMs = Date.parse(lastAnswered);
  if (Number.isNaN(answeredMs)) return 0;
  const deltaDays = Math.max(0, (nowMs - answeredMs) / DAY_MS);
  return Math.exp(-deltaDays / RECENCY_HALF_LIFE_DAYS);
}

function attemptConfidence(attempts: number) {
  if (attempts <= 0) return 0;
  return Math.min(1, Math.log2(attempts + 1) / 3);
}

function blendedMasteryFromStat(stat: QuestionStat, nowMs: number) {
  if (stat.attempts <= 0) return { blended: 0, weight: 0 };
  const accuracy = stat.correct / stat.attempts;
  const freshness = recencyScore(stat.lastAnswered, nowMs);
  const confidence = attemptConfidence(stat.attempts);
  const blended = accuracy * (0.55 + confidence * 0.25) + freshness * 0.2;
  const weight = 1 + Math.log2(stat.attempts + 1);
  return { blended, weight };
}

function createObjectiveAccumulator(): ObjectiveAccumulator {
  return {
    questionIds: new Set<string>(),
    attemptedQuestionIds: new Set<string>(),
    attempts: 0,
    correct: 0,
    weightedScore: 0,
    weightTotal: 0,
    latestAnsweredMs: null
  };
}

function createMisconceptionAccumulator(tag: string): MisconceptionAccumulator {
  return {
    tag,
    questionIds: new Set<string>(),
    attemptedQuestionIds: new Set<string>(),
    attempts: 0,
    correct: 0,
    weightedScore: 0,
    weightTotal: 0,
    latestAnsweredMs: null,
    linkedObjectiveIds: new Set<string>()
  };
}

function updateLatestAnswered(acc: { latestAnsweredMs: number | null }, lastAnswered?: string) {
  if (!lastAnswered) return;
  const answeredMs = Date.parse(lastAnswered);
  if (Number.isNaN(answeredMs)) return;
  acc.latestAnsweredMs = acc.latestAnsweredMs === null ? answeredMs : Math.max(acc.latestAnsweredMs, answeredMs);
}

function isScenarioQuestion(question: Question) {
  const legacyType = question.legacyType?.toLowerCase() ?? '';
  if (legacyType.includes('scenario')) return true;
  return question.stem.trim().toLowerCase().startsWith('scenario:');
}

function questionCountForMappedSection(entry: OutlineMapEntry, objectiveId: string, packs: ChapterPack[]) {
  const candidatePacks = entry.packId
    ? packs.filter((pack) => pack.pack_id === entry.packId)
    : packs;
  if (candidatePacks.length === 0) return 0;

  const tagSet = new Set(normalizeTags(entry.tags));
  const hasTagFilter = tagSet.size > 0;

  return candidatePacks.reduce((count, pack) => {
    const matches = pack.question_bank.filter((question) => {
      if (!question.objectiveIds.includes(objectiveId)) return false;
      if (!hasTagFilter) return true;
      return question.tags.some((tag) => tagSet.has(tag));
    });
    return count + matches.length;
  }, 0);
}

function sourceRefSectionForObjective(objectiveId: string, packs: ChapterPack[]) {
  const candidates = new Map<string, { entry: OutlineMapEntry; questionCount: number }>();

  packs.forEach((pack) => {
    pack.question_bank.forEach((question) => {
      if (!question.objectiveIds.includes(objectiveId)) return;
      const sourceRef = question.sourceRef;
      if (!sourceRef?.outlineId) return;

      const outlineId = sourceRef.outlineId.trim();
      if (!outlineId) return;
      const href = sourceRef.href?.trim() || outlineId;
      const title = sourceRef.title?.trim() || `Outline ${outlineId}`;
      const key = `${outlineId}|${pack.pack_id}|${href}`;

      const existing = candidates.get(key);
      if (existing) {
        existing.questionCount += 1;
        return;
      }

      candidates.set(key, {
        entry: {
          outlineId,
          title,
          href,
          objectiveIds: [objectiveId],
          packId: pack.pack_id,
          tags: normalizeTags(question.tags).slice(0, 4)
        },
        questionCount: 1
      });
    });
  });

  return [...candidates.values()]
    .sort((a, b) => b.questionCount - a.questionCount)[0] ?? null;
}

function scoreQuestionForPlan(
  question: Question,
  stat: QuestionStat | undefined,
  nowMs: number,
  activity: CoachingActivityKind
) {
  if (!stat || stat.attempts <= 0) {
    const base = 1.2 + (question.difficulty ?? 3) * 0.06;
    return activity === 'scenario_matching' && isScenarioQuestion(question) ? base + 0.3 : base;
  }

  const wrongRate = Math.max(0, (stat.attempts - stat.correct) / stat.attempts);
  const freshness = 1 - recencyScore(stat.lastAnswered, nowMs);
  const confidence = attemptConfidence(stat.attempts);
  const repetitionPressure = wrongRate * (1 + confidence * 0.45);
  const scenarioBoost = activity === 'scenario_matching' && isScenarioQuestion(question) ? 0.4 : 0;
  const interactiveBoost = activity === 'mixed_mini' && (question.type === 'matching' || question.type === 'ordering') ? 0.1 : 0;
  return repetitionPressure * 1.35 + freshness * 0.55 + scenarioBoost + interactiveBoost;
}

type QuestionCandidate = {
  packId: string;
  question: Question;
  score: number;
};

function mixedMiniSelect(candidates: QuestionCandidate[], limit: number) {
  const byType = new Map<Question['type'], QuestionCandidate[]>();
  candidates.forEach((candidate) => {
    const bucket = byType.get(candidate.question.type) ?? [];
    bucket.push(candidate);
    byType.set(candidate.question.type, bucket);
  });

  byType.forEach((bucket) => {
    bucket.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.question.id.localeCompare(b.question.id, undefined, { numeric: true, sensitivity: 'base' });
    });
  });

  const typeOrder: Question['type'][] = ['matching', 'ordering', 'multi_select', 'mcq'];
  const chosen: QuestionCandidate[] = [];
  const used = new Set<string>();

  while (chosen.length < limit) {
    let pickedInPass = false;
    for (const type of typeOrder) {
      const bucket = byType.get(type);
      if (!bucket || bucket.length === 0) continue;
      while (bucket.length > 0 && used.has(bucket[0].question.id)) {
        bucket.shift();
      }
      if (bucket.length === 0) continue;
      const next = bucket.shift();
      if (!next) continue;
      chosen.push(next);
      used.add(next.question.id);
      pickedInPass = true;
      if (chosen.length >= limit) break;
    }
    if (!pickedInPass) break;
  }

  if (chosen.length < limit) {
    const fallback = [...candidates]
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return a.question.id.localeCompare(b.question.id, undefined, { numeric: true, sensitivity: 'base' });
      })
      .filter((candidate) => !used.has(candidate.question.id))
      .slice(0, limit - chosen.length);
    chosen.push(...fallback);
  }

  return chosen;
}

function questionTypeAllowed(question: Question, allowedTypes: Set<Question['type']>) {
  return allowedTypes.has(question.type);
}

function selectPlanQuestions(input: {
  objectiveId: string;
  activity: CoachingActivityKind;
  packs: ChapterPack[];
  state: LocalState;
  nowMs: number;
  section: OutlineMapEntry | null;
  limit: number;
  allowedTypes: Question['type'][];
  maxDifficulty?: 1 | 2 | 3 | 4 | 5;
  preferScenario?: boolean;
}) {
  const {
    objectiveId,
    activity,
    packs,
    state,
    nowMs,
    section,
    limit,
    allowedTypes,
    maxDifficulty,
    preferScenario
  } = input;

  const sectionTags = new Set(normalizeTags(section?.tags));
  const applyTagFilter = sectionTags.size > 0;
  const allowedTypeSet = new Set(allowedTypes);

  const scopedPacks = section?.packId
    ? packs.filter((pack) => pack.pack_id === section.packId)
    : packs;
  const broadPacks = scopedPacks.length > 0 ? scopedPacks : packs;

  const buildCandidates = (candidatePacks: ChapterPack[], strict = true) => {
    const rows: QuestionCandidate[] = [];
    candidatePacks.forEach((pack) => {
      pack.question_bank.forEach((question) => {
        if (!question.objectiveIds.includes(objectiveId)) return;
        if (strict && applyTagFilter && !question.tags.some((tag) => sectionTags.has(tag))) return;
        if (!questionTypeAllowed(question, allowedTypeSet)) return;
        if (maxDifficulty && (question.difficulty ?? 3) > maxDifficulty) return;
        rows.push({
          packId: pack.pack_id,
          question,
          score: scoreQuestionForPlan(question, state.questionStats[question.id], nowMs, activity)
        });
      });
    });
    return rows;
  };

  let candidates = buildCandidates(broadPacks, true);
  if (candidates.length === 0) {
    candidates = buildCandidates(packs, false);
  }

  if (candidates.length === 0 && maxDifficulty) {
    candidates = broadPacks.flatMap((pack) =>
      pack.question_bank
        .filter((question) => question.objectiveIds.includes(objectiveId))
        .filter((question) => questionTypeAllowed(question, allowedTypeSet))
        .map((question) => ({
          packId: pack.pack_id,
          question,
          score: scoreQuestionForPlan(question, state.questionStats[question.id], nowMs, activity)
        }))
    );
  }

  if (candidates.length === 0) {
    return [] as QuestionCandidate[];
  }

  if (preferScenario) {
    candidates.sort((a, b) => {
      const aScenario = isScenarioQuestion(a.question) ? 1 : 0;
      const bScenario = isScenarioQuestion(b.question) ? 1 : 0;
      if (aScenario !== bScenario) return bScenario - aScenario;
      if (a.score !== b.score) return b.score - a.score;
      return a.question.id.localeCompare(b.question.id, undefined, { numeric: true, sensitivity: 'base' });
    });
  } else {
    candidates.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.question.id.localeCompare(b.question.id, undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  if (activity === 'mixed_mini') {
    return mixedMiniSelect(candidates, limit);
  }

  return candidates.slice(0, limit);
}

function lessonTargetForSection(input: {
  section: OutlineMapEntry | null;
  objectiveId: string;
  lessons: ChapterLesson[];
  fallbackPackId?: string;
}) {
  const { section, objectiveId, lessons, fallbackPackId } = input;
  if (lessons.length === 0) return null;
  const lessonIds = section?.lessonIds ?? [];

  const candidatePackIds = new Set<string>();
  if (section?.packId) candidatePackIds.add(section.packId);
  if (fallbackPackId) candidatePackIds.add(fallbackPackId);

  const candidateLessons = lessons.filter((lesson) => {
    if (candidatePackIds.size === 0) return true;
    return candidatePackIds.has(lesson.pack_id);
  });

  for (const lesson of candidateLessons) {
    for (const lessonId of lessonIds) {
      const lessonModule = lesson.modules.find((item) => item.id === lessonId);
      if (lessonModule) {
        const page = lessonModule.pages[0];
        if (!page) continue;
        return { packId: lesson.pack_id, moduleId: lessonModule.id, pageId: page.id };
      }

      for (const moduleCandidate of lesson.modules) {
        const page = moduleCandidate.pages.find((item) => item.id === lessonId);
        if (page) {
          return { packId: lesson.pack_id, moduleId: moduleCandidate.id, pageId: page.id };
        }
      }
    }

    const objectiveModule = lesson.modules.find((module) => module.objectiveIds.includes(objectiveId));
    if (objectiveModule?.pages[0]) {
      return { packId: lesson.pack_id, moduleId: objectiveModule.id, pageId: objectiveModule.pages[0].id };
    }

    const firstModule = lesson.modules[0];
    const firstPage = firstModule?.pages[0];
    if (firstModule && firstPage) {
      return { packId: lesson.pack_id, moduleId: firstModule.id, pageId: firstPage.id };
    }
  }

  return null;
}

export type ObjectiveMasteryRow = {
  objectiveId: string;
  objectiveTitle: string;
  domainId: string;
  questionCount: number;
  attemptedQuestionCount: number;
  attempts: number;
  correct: number;
  accuracy: number | null;
  recencyScore: number;
  masteryScore: number;
  weaknessScore: number;
};

export type MisconceptionMasteryRow = {
  tag: string;
  questionCount: number;
  attemptedQuestionCount: number;
  attempts: number;
  correct: number;
  accuracy: number | null;
  recencyScore: number;
  masteryScore: number;
  weaknessScore: number;
  linkedObjectiveIds: string[];
};

export type MisconceptionPriorityRow = {
  tag: string;
  cardCount: number;
  dueCount: number;
  wrongCount: number;
  unsureCount: number;
  linkedObjectiveIds: string[];
  objectiveWeakness: number;
  masteryScore: number;
  weaknessScore: number;
  priorityScore: number;
};

export function computeObjectiveMastery(
  objectivesDoc: ExamObjectivesDoc,
  packs: ChapterPack[],
  state: LocalState,
  now = new Date()
) {
  const accByObjective = new Map<string, ObjectiveAccumulator>();
  objectivesDoc.objectives.forEach((objective) => {
    accByObjective.set(objective.id, createObjectiveAccumulator());
  });

  const nowMs = now.getTime();

  packs.forEach((pack) => {
    pack.question_bank.forEach((question) => {
      const objectiveIds = normalizeObjectiveIds(question.objectiveIds);
      if (objectiveIds.length === 0) return;
      const stat = state.questionStats[question.id];

      objectiveIds.forEach((objectiveId) => {
        const acc = accByObjective.get(objectiveId);
        if (!acc) return;
        acc.questionIds.add(question.id);

        if (!stat || stat.attempts <= 0) return;
        acc.attemptedQuestionIds.add(question.id);
        acc.attempts += stat.attempts;
        acc.correct += stat.correct;

        const { blended, weight } = blendedMasteryFromStat(stat, nowMs);
        acc.weightedScore += blended * weight;
        acc.weightTotal += weight;
        updateLatestAnswered(acc, stat.lastAnswered);
      });
    });
  });

  const rows: ObjectiveMasteryRow[] = objectivesDoc.objectives.map((objective) => {
    const acc = accByObjective.get(objective.id) ?? createObjectiveAccumulator();
    const masteryScore = acc.weightTotal > 0
      ? round((acc.weightedScore / acc.weightTotal) * 100)
      : 0;
    const recency = acc.latestAnsweredMs ? recencyScore(new Date(acc.latestAnsweredMs).toISOString(), nowMs) : 0;
    const weaknessScore = round(Math.max(0, 100 - masteryScore));
    return {
      objectiveId: objective.id,
      objectiveTitle: objective.title,
      domainId: objective.domain_id,
      questionCount: acc.questionIds.size,
      attemptedQuestionCount: acc.attemptedQuestionIds.size,
      attempts: acc.attempts,
      correct: acc.correct,
      accuracy: acc.attempts > 0 ? acc.correct / acc.attempts : null,
      recencyScore: round(recency * 100),
      masteryScore,
      weaknessScore
    };
  });

  const sortedWeakest = [...rows].sort((a, b) => {
    if (a.masteryScore !== b.masteryScore) return a.masteryScore - b.masteryScore;
    if (a.attemptedQuestionCount !== b.attemptedQuestionCount) return a.attemptedQuestionCount - b.attemptedQuestionCount;
    if (a.questionCount !== b.questionCount) return a.questionCount - b.questionCount;
    return objectiveIdSort(a.objectiveId, b.objectiveId);
  });

  return {
    rows,
    sortedWeakest
  };
}

export function computeMisconceptionMastery(
  packs: ChapterPack[],
  state: LocalState,
  now = new Date()
) {
  const nowMs = now.getTime();
  const accByTag = new Map<string, MisconceptionAccumulator>();

  packs.forEach((pack) => {
    pack.question_bank.forEach((question) => {
      const misconceptionTags = normalizeTags(question.misconceptionTags);
      if (misconceptionTags.length === 0) return;

      const stat = state.questionStats[question.id];
      misconceptionTags.forEach((tag) => {
        const acc = accByTag.get(tag) ?? createMisconceptionAccumulator(tag);
        acc.questionIds.add(question.id);
        normalizeObjectiveIds(question.objectiveIds).forEach((objectiveId) => acc.linkedObjectiveIds.add(objectiveId));

        if (stat && stat.attempts > 0) {
          acc.attemptedQuestionIds.add(question.id);
          acc.attempts += stat.attempts;
          acc.correct += stat.correct;
          const { blended, weight } = blendedMasteryFromStat(stat, nowMs);
          acc.weightedScore += blended * weight;
          acc.weightTotal += weight;
          updateLatestAnswered(acc, stat.lastAnswered);
        }
        accByTag.set(tag, acc);
      });
    });
  });

  state.mistakeCards.forEach((card) => {
    const misconceptionTags = normalizeTags(card.misconceptionTags.length > 0 ? card.misconceptionTags : card.tags);
    misconceptionTags.forEach((tag) => {
      const acc = accByTag.get(tag) ?? createMisconceptionAccumulator(tag);
      normalizeObjectiveIds(card.objectiveIds).forEach((objectiveId) => acc.linkedObjectiveIds.add(objectiveId));
      if (acc.weightTotal === 0) {
        const baseline = card.status === 'wrong' ? 0.2 : 0.35;
        const freshness = recencyScore(card.last_reviewed ?? card.created_at, nowMs);
        const weight = 0.8;
        acc.weightedScore += (baseline * 0.75 + freshness * 0.25) * weight;
        acc.weightTotal += weight;
      }
      accByTag.set(tag, acc);
    });
  });

  const rows: MisconceptionMasteryRow[] = [...accByTag.values()].map((acc) => {
    const masteryScore = acc.weightTotal > 0 ? round((acc.weightedScore / acc.weightTotal) * 100) : 0;
    const recency = acc.latestAnsweredMs ? recencyScore(new Date(acc.latestAnsweredMs).toISOString(), nowMs) : 0;
    return {
      tag: acc.tag,
      questionCount: acc.questionIds.size,
      attemptedQuestionCount: acc.attemptedQuestionIds.size,
      attempts: acc.attempts,
      correct: acc.correct,
      accuracy: acc.attempts > 0 ? acc.correct / acc.attempts : null,
      recencyScore: round(recency * 100),
      masteryScore,
      weaknessScore: round(Math.max(0, 100 - masteryScore)),
      linkedObjectiveIds: [...acc.linkedObjectiveIds].sort(objectiveIdSort)
    };
  });

  rows.sort((a, b) => {
    if (a.masteryScore !== b.masteryScore) return a.masteryScore - b.masteryScore;
    if (a.attemptedQuestionCount !== b.attemptedQuestionCount) return a.attemptedQuestionCount - b.attemptedQuestionCount;
    return a.tag.localeCompare(b.tag);
  });

  return {
    rows,
    sortedWeakest: rows
  };
}

export function computeMisconceptionPriority(
  state: LocalState,
  objectiveMasteryRows: ObjectiveMasteryRow[],
  misconceptionMasteryRows: MisconceptionMasteryRow[],
  now = new Date()
) {
  const weaknessByObjectiveId = new Map(
    objectiveMasteryRows.map((row) => [row.objectiveId, row.weaknessScore])
  );
  const byTag = new Map<string, MisconceptionPriorityRow>();
  const nowMs = now.getTime();

  misconceptionMasteryRows.forEach((row) => {
    const objectiveWeakness = row.linkedObjectiveIds.length > 0
      ? Math.max(...row.linkedObjectiveIds.map((objectiveId) => weaknessByObjectiveId.get(objectiveId) ?? 50))
      : 50;
    byTag.set(row.tag, {
      tag: row.tag,
      cardCount: 0,
      dueCount: 0,
      wrongCount: 0,
      unsureCount: 0,
      linkedObjectiveIds: row.linkedObjectiveIds,
      objectiveWeakness: round(objectiveWeakness),
      masteryScore: row.masteryScore,
      weaknessScore: row.weaknessScore,
      priorityScore: round(row.weaknessScore * 0.9 + objectiveWeakness * 0.35, 2)
    });
  });

  state.mistakeCards.forEach((card) => {
    const fallbackTags = card.tags ?? [];
    const tags = normalizeTags(card.misconceptionTags.length > 0 ? card.misconceptionTags : fallbackTags);
    if (tags.length === 0) return;
    const objectiveIds = normalizeObjectiveIds(card.objectiveIds);
    const due = Date.parse(getMistakeCardDueAt(card));
    const dueNow = !Number.isNaN(due) && due <= nowMs;
    const statusWeight = card.status === 'wrong' ? 1.4 : 1.1;
    const dueWeight = dueNow ? 1.2 : 1;
    const objectiveWeakness = objectiveIds.length > 0
      ? Math.max(...objectiveIds.map((objectiveId) => weaknessByObjectiveId.get(objectiveId) ?? 50))
      : 50;
    const scoreDelta = dueWeight * statusWeight * (1 + objectiveWeakness / 100) * 8;

    tags.forEach((tag) => {
      const existing = byTag.get(tag) ?? {
        tag,
        cardCount: 0,
        dueCount: 0,
        wrongCount: 0,
        unsureCount: 0,
        linkedObjectiveIds: [],
        objectiveWeakness: round(objectiveWeakness),
        masteryScore: 0,
        weaknessScore: 100,
        priorityScore: 0
      };
      existing.cardCount += 1;
      if (dueNow) existing.dueCount += 1;
      if (card.status === 'wrong') existing.wrongCount += 1;
      if (card.status === 'unsure') existing.unsureCount += 1;
      existing.priorityScore = round(existing.priorityScore + scoreDelta, 2);
      const linkedObjectiveIds = new Set([...existing.linkedObjectiveIds, ...objectiveIds]);
      existing.linkedObjectiveIds = [...linkedObjectiveIds].sort(objectiveIdSort);
      const weaknessValues = existing.linkedObjectiveIds.map((objectiveId) => weaknessByObjectiveId.get(objectiveId) ?? 50);
      existing.objectiveWeakness = weaknessValues.length > 0
        ? round(weaknessValues.reduce((sum, value) => sum + value, 0) / weaknessValues.length)
        : existing.objectiveWeakness;
      byTag.set(tag, existing);
    });
  });

  return [...byTag.values()].sort((a, b) => {
    if (a.priorityScore !== b.priorityScore) return b.priorityScore - a.priorityScore;
    if (a.weaknessScore !== b.weaknessScore) return b.weaknessScore - a.weaknessScore;
    return a.tag.localeCompare(b.tag);
  });
}

export function buildObjectiveDrillHref(input: {
  objectiveId: string;
  packId?: string;
  outlineId?: string;
  sectionTitle?: string;
  sectionHref?: string;
  tags?: string[];
  activity?: CoachingActivityKind;
  types?: Question['type'][];
  maxDifficulty?: number;
  limit?: number;
  preferScenario?: boolean;
  planId?: string;
}) {
  const params = new URLSearchParams();
  if (input.packId) params.set('packId', input.packId);
  if (input.outlineId) params.set('outlineId', input.outlineId);
  if (input.sectionTitle) params.set('sectionTitle', input.sectionTitle);
  if (input.sectionHref) params.set('sectionHref', input.sectionHref);
  if (input.tags && input.tags.length > 0) params.set('tags', normalizeTags(input.tags).join(','));
  if (input.activity) params.set('activity', input.activity);
  if (input.types && input.types.length > 0) params.set('types', input.types.join(','));
  if (Number.isFinite(input.maxDifficulty)) params.set('maxDifficulty', String(input.maxDifficulty));
  if (Number.isFinite(input.limit)) params.set('limit', String(input.limit));
  if (input.preferScenario) params.set('preferScenario', '1');
  if (input.planId) params.set('planId', input.planId);
  const query = params.toString();
  return `/review/objective/${encodeURIComponent(input.objectiveId)}${query ? `?${query}` : ''}`;
}

export type CoachingActivityKind =
  | 'lesson_quick_check'
  | 'easier_interactive'
  | 'scenario_matching'
  | 'mixed_mini';

export type CoachingBand = 'low' | 'medium' | 'high';

export type CoachingPlan = {
  planId: string;
  version: '1';
  generatedAt: string;
  objectiveId: string;
  objectiveTitle: string;
  domainId: string;
  masteryScore: number;
  weaknessScore: number;
  band: CoachingBand;
  activityKind: CoachingActivityKind;
  activityLabel: string;
  activityReason: string;
  section: {
    outlineId: string;
    title: string;
    href: string;
    packId?: string;
    tags: string[];
    lessonIds: string[];
  } | null;
  mappingSource: 'outline_map' | 'source_ref' | 'objective_only';
  fallbackUsed: boolean;
  packId?: string;
  questionCount: number;
  questionIds: string[];
  misconceptionTags: string[];
  href: string;
  debug: {
    candidateSectionCount: number;
    consideredObjectives: string[];
  };
};

function coachingBandForMastery(masteryScore: number): CoachingBand {
  if (masteryScore < 45) return 'low';
  if (masteryScore < 75) return 'medium';
  return 'high';
}

function activityDefinitionForBand(band: CoachingBand) {
  if (band === 'low') {
    return {
      kind: 'easier_interactive' as const,
      label: 'Coach activity: Easier interactive set',
      reason: 'Low mastery detected. Reinforce fundamentals with easier, high-signal questions.',
      allowedTypes: ['mcq', 'multi_select'] as Question['type'][],
      maxDifficulty: 2 as const,
      limit: 10,
      preferScenario: false
    };
  }
  if (band === 'medium') {
    return {
      kind: 'scenario_matching' as const,
      label: 'Coach activity: Scenario + matching set',
      reason: 'Medium mastery detected. Push transfer with scenario and classification questions.',
      allowedTypes: ['mcq', 'matching'] as Question['type'][],
      maxDifficulty: undefined,
      limit: 12,
      preferScenario: true
    };
  }
  return {
    kind: 'mixed_mini' as const,
    label: 'Coach activity: Mixed mini set',
    reason: 'High mastery detected. Use a short mixed set to keep retention and speed sharp.',
    allowedTypes: ['mcq', 'multi_select', 'matching', 'ordering'] as Question['type'][],
    maxDifficulty: undefined,
    limit: 8,
    preferScenario: false
  };
}

function sectionSummary(section: OutlineMapEntry | null) {
  if (!section) return null;
  return {
    outlineId: section.outlineId,
    title: section.title,
    href: section.href,
    packId: section.packId,
    tags: normalizeTags(section.tags),
    lessonIds: section.lessonIds ?? []
  };
}

export function buildNextBestActivityPlan(input: {
  weakestObjectives: ObjectiveMasteryRow[];
  misconceptionPriority: MisconceptionPriorityRow[];
  outlineMap: OutlineMapDoc | null;
  packs: ChapterPack[];
  lessons?: ChapterLesson[];
  state: LocalState;
  now?: Date;
}): CoachingPlan | null {
  const {
    weakestObjectives,
    misconceptionPriority,
    outlineMap,
    packs,
    lessons = [],
    state,
    now = new Date()
  } = input;

  if (weakestObjectives.length === 0) return null;
  const mapEntries = outlineMap?.entries ?? [];
  const nowMs = now.getTime();
  const consideredObjectives: string[] = [];

  for (const objective of weakestObjectives) {
    consideredObjectives.push(objective.objectiveId);
    const band = coachingBandForMastery(objective.masteryScore);
    const activity = activityDefinitionForBand(band);
    const objectiveMapEntries = mapEntries
      .filter((entry) => entry.objectiveIds.includes(objective.objectiveId))
      .map((entry) => ({
        entry,
        questionCount: questionCountForMappedSection(entry, objective.objectiveId, packs)
      }))
      .sort((a, b) => {
        if (a.questionCount !== b.questionCount) return b.questionCount - a.questionCount;
        if (Boolean(a.entry.packId) !== Boolean(b.entry.packId)) return a.entry.packId ? -1 : 1;
        return a.entry.title.localeCompare(b.entry.title);
      });

    let chosenSection: OutlineMapEntry | null = null;
    let mappingSource: CoachingPlan['mappingSource'] = 'objective_only';
    let fallbackUsed = false;

    if (objectiveMapEntries.length > 0) {
      chosenSection = objectiveMapEntries[0].entry;
      mappingSource = 'outline_map';
    } else {
      const sourceRefFallback = sourceRefSectionForObjective(objective.objectiveId, packs);
      if (sourceRefFallback) {
        chosenSection = sourceRefFallback.entry;
        mappingSource = 'source_ref';
        fallbackUsed = true;
      }
    }

    const selectedQuestions = selectPlanQuestions({
      objectiveId: objective.objectiveId,
      activity: activity.kind,
      packs,
      state,
      nowMs,
      section: chosenSection,
      limit: activity.limit,
      allowedTypes: activity.allowedTypes,
      maxDifficulty: activity.maxDifficulty,
      preferScenario: activity.preferScenario
    });

    if (selectedQuestions.length === 0 && objective.questionCount === 0) {
      continue;
    }

    const sectionData = sectionSummary(chosenSection);
    const fallbackPackId = selectedQuestions[0]?.packId ?? sectionData?.packId;
    const misconceptionTags = misconceptionPriority
      .filter((row) => row.linkedObjectiveIds.includes(objective.objectiveId))
      .slice(0, 4)
      .map((row) => row.tag);

    let activityKind: CoachingActivityKind = activity.kind;
    let activityLabel = activity.label;
    let activityReason = activity.reason;
    let href = buildObjectiveDrillHref({
      objectiveId: objective.objectiveId,
      packId: fallbackPackId,
      outlineId: sectionData?.outlineId,
      sectionTitle: sectionData?.title,
      sectionHref: sectionData?.href,
      tags: sectionData?.tags,
      activity: activity.kind,
      types: activity.allowedTypes,
      maxDifficulty: activity.maxDifficulty,
      limit: activity.limit,
      preferScenario: activity.preferScenario
    });

    if (band === 'low') {
      const lessonTarget = lessonTargetForSection({
        section: chosenSection,
        objectiveId: objective.objectiveId,
        lessons,
        fallbackPackId
      });
      if (lessonTarget) {
        activityKind = 'lesson_quick_check';
        activityLabel = 'Coach activity: Lesson quick-check';
        activityReason = 'Low mastery detected. Start with guided lesson checks before heavier drills.';
        const params = new URLSearchParams({
          mode: 'learn',
          coach: 'quick-check',
          objectiveId: objective.objectiveId,
          module: lessonTarget.moduleId,
          page: lessonTarget.pageId
        });
        href = `/chapter/${encodeURIComponent(lessonTarget.packId)}?${params.toString()}`;
      }
    }

    const signature = JSON.stringify({
      objectiveId: objective.objectiveId,
      band,
      activityKind,
      section: sectionData?.outlineId ?? 'none',
      packId: fallbackPackId ?? 'none',
      questions: selectedQuestions.map((entry) => entry.question.id)
    });
    const planId = `coach-${simpleHash(signature)}`;
    if (!href.includes('planId=')) {
      if (href.includes('?')) href = `${href}&planId=${encodeURIComponent(planId)}`;
      else href = `${href}?planId=${encodeURIComponent(planId)}`;
    }

    return {
      planId,
      version: '1',
      generatedAt: new Date(nowMs).toISOString(),
      objectiveId: objective.objectiveId,
      objectiveTitle: objective.objectiveTitle,
      domainId: objective.domainId,
      masteryScore: objective.masteryScore,
      weaknessScore: objective.weaknessScore,
      band,
      activityKind,
      activityLabel,
      activityReason,
      section: sectionData,
      mappingSource,
      fallbackUsed,
      packId: fallbackPackId,
      questionCount: selectedQuestions.length > 0 ? selectedQuestions.length : objective.questionCount,
      questionIds: selectedQuestions.map((entry) => entry.question.id),
      misconceptionTags,
      href,
      debug: {
        candidateSectionCount: objectiveMapEntries.length,
        consideredObjectives
      }
    };
  }

  const fallback = weakestObjectives[0];
  const fallbackPlanId = `coach-${simpleHash(`${fallback.objectiveId}|fallback`)}`;
  return {
    planId: fallbackPlanId,
    version: '1',
    generatedAt: new Date(nowMs).toISOString(),
    objectiveId: fallback.objectiveId,
    objectiveTitle: fallback.objectiveTitle,
    domainId: fallback.domainId,
    masteryScore: fallback.masteryScore,
    weaknessScore: fallback.weaknessScore,
    band: coachingBandForMastery(fallback.masteryScore),
    activityKind: 'mixed_mini',
    activityLabel: 'Coach activity: Mixed mini set',
    activityReason: 'Fallback objective drill because mapped content was unavailable.',
    section: null,
    mappingSource: 'objective_only',
    fallbackUsed: true,
    packId: undefined,
    questionCount: fallback.questionCount,
    questionIds: [],
    misconceptionTags: [],
    href: buildObjectiveDrillHref({
      objectiveId: fallback.objectiveId,
      activity: 'mixed_mini',
      types: ['mcq', 'multi_select', 'matching', 'ordering'],
      limit: 8,
      planId: fallbackPlanId
    }),
    debug: {
      candidateSectionCount: 0,
      consideredObjectives
    }
  };
}

export function loadStoredCoachingPlan() {
  if (typeof window === 'undefined') return null as CoachingPlan | null;
  try {
    const raw = window.localStorage.getItem(COACH_PLAN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CoachingPlan;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.planId !== 'string' || typeof parsed.objectiveId !== 'string' || typeof parsed.href !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeCoachingPlan(plan: CoachingPlan) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COACH_PLAN_STORAGE_KEY, JSON.stringify(plan));
  } catch {
    // Ignore storage errors (private mode/quota).
  }
}

export type NextBestActivity = {
  objective: ObjectiveMasteryRow;
  section: OutlineMapEntry | null;
  questionCount: number;
  href: string;
};

// Backward-compatible wrapper used by existing callers.
export function pickNextBestActivity(
  weakestObjectives: ObjectiveMasteryRow[],
  outlineMap: OutlineMapDoc | null,
  packs: ChapterPack[]
): NextBestActivity | null {
  const dummyState: LocalState = {
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
  const plan = buildNextBestActivityPlan({
    weakestObjectives,
    misconceptionPriority: [],
    outlineMap,
    packs,
    lessons: [],
    state: dummyState
  });
  if (!plan) return null;

  const objective = weakestObjectives.find((row) => row.objectiveId === plan.objectiveId) ?? weakestObjectives[0];
  const section: OutlineMapEntry | null = plan.section
    ? {
      outlineId: plan.section.outlineId,
      title: plan.section.title,
      href: plan.section.href,
      objectiveIds: [plan.objectiveId],
      packId: plan.section.packId,
      lessonIds: plan.section.lessonIds,
      tags: plan.section.tags
    }
    : null;

  return {
    objective,
    section,
    questionCount: plan.questionCount,
    href: plan.href
  };
}
