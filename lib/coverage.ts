import { objectiveIdSort } from './objectiveIds';
import { ChapterPack, ExamObjectivesDoc, LocalState, Question } from './types';

export type OutlineSectionNode = {
  order: number;
  title: string;
  href: string;
  word_count: number;
  hash?: string;
};

export type OutlineChapterNode = {
  order: number;
  title: string;
  href: string;
  word_count: number;
  hash?: string;
  sections: OutlineSectionNode[];
};

export type OutlineDoc = {
  generated_at: string;
  source_epub?: string;
  chapters: OutlineChapterNode[];
};

export type OutlineMapEntry = {
  outlineId: string;
  title: string;
  href: string;
  objectiveIds: string[];
  packId?: string;
  lessonIds?: string[];
  tags?: string[];
  status?: 'unmapped' | 'draft' | 'done';
};

export type OutlineMapDoc = {
  version: string;
  source_outline: string;
  updated_at?: string;
  entries: OutlineMapEntry[];
};

export type ObjectiveCoverageRow = {
  objectiveId: string;
  title: string;
  domainId: string;
  questionCount: number;
  mcqCount: number;
  multiSelectCount: number;
  scenarioCount: number;
  interactiveCount: number;
  matchingCount: number;
  orderingCount: number;
  pbqCount: number;
  mappedOutlineSectionsCount: number;
  averageWrongRate: number | null;
};

export type ObjectiveCoverageReport = {
  generatedAt: string;
  objectiveCount: number;
  missingObjectiveIds: string[];
  topWeakest: ObjectiveCoverageRow[];
  rows: ObjectiveCoverageRow[];
  untaggedQuestionCount: number;
};

export type OutlineSectionCoverageRow = {
  outlineId: string;
  chapterOrder: number;
  chapterTitle: string;
  sectionOrder: number;
  title: string;
  href: string;
  wordCount: number;
  status: 'unmapped' | 'draft' | 'done';
  mapped: boolean;
  objectiveIds: string[];
  mappedObjectiveIdsCount: number;
  packId: string | null;
  lessonIds: string[];
  tags: string[];
  questionCount: number;
  mcqCount: number;
  multiSelectCount: number;
  scenarioCount: number;
  interactiveCount: number;
  matchingCount: number;
  orderingCount: number;
  pbqCount: number;
  averageWrongRate: number | null;
  thinReasons: string[];
};

export type OpsCoverageReport = {
  generatedAt: string;
  thresholds: {
    minQuestionCount: number;
    minInteractiveCount: number;
  };
  objectiveReport: ObjectiveCoverageReport;
  zeroCoverageObjectiveIds: string[];
  topWeakObjectives: ObjectiveCoverageRow[];
  outlineSections: OutlineSectionCoverageRow[];
  unmappedOutlineSections: OutlineSectionCoverageRow[];
  thinOutlineSections: OutlineSectionCoverageRow[];
  topUnmappedOutlineSections: OutlineSectionCoverageRow[];
  topThinOutlineSections: OutlineSectionCoverageRow[];
};

type CoverageAccumulator = {
  questionCount: number;
  mcqCount: number;
  multiSelectCount: number;
  scenarioCount: number;
  interactiveCount: number;
  matchingCount: number;
  orderingCount: number;
  pbqCount: number;
  wrongRates: number[];
};

type QuestionIndexRow = {
  questionId: string;
  packId: string;
  type: Question['type'];
  rawType: string;
  objectiveIds: string[];
  objectiveIdSet: Set<string>;
  tags: string[];
  tagSet: Set<string>;
  wrongRate: number | null;
};

type FlatOutlineRow = {
  outlineId: string;
  chapterOrder: number;
  chapterTitle: string;
  sectionOrder: number;
  title: string;
  href: string;
  wordCount: number;
};

function createAccumulator(): CoverageAccumulator {
  return {
    questionCount: 0,
    mcqCount: 0,
    multiSelectCount: 0,
    scenarioCount: 0,
    interactiveCount: 0,
    matchingCount: 0,
    orderingCount: 0,
    pbqCount: 0,
    wrongRates: []
  };
}

function mean(values: number[]) {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return sum / values.length;
}

function normalizeObjectiveIdList(objectiveIds: string[]) {
  return [...new Set(objectiveIds.filter(Boolean))].sort(objectiveIdSort);
}

function normalizeTagList(tags: string[]) {
  return [...new Set(tags.filter(Boolean).map((tag) => tag.trim()))].sort((a, b) => a.localeCompare(b));
}

function simpleHash(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildOutlineId(chapter: OutlineChapterNode, section?: OutlineSectionNode) {
  const sectionOrder = section?.order ?? 0;
  const href = section?.href ?? chapter.href;
  const title = section?.title ?? chapter.title;
  const hashInput = `${chapter.order}|${href}|${title}`;
  return `ol-${chapter.order}-${sectionOrder}-${simpleHash(hashInput)}`;
}

function flattenOutline(outlineDoc: OutlineDoc | null | undefined) {
  if (!outlineDoc?.chapters) return [] as FlatOutlineRow[];
  return outlineDoc.chapters.flatMap((chapter) => {
    if (Array.isArray(chapter.sections) && chapter.sections.length > 0) {
      return chapter.sections.map((section) => ({
        outlineId: buildOutlineId(chapter, section),
        chapterOrder: chapter.order,
        chapterTitle: chapter.title,
        sectionOrder: section.order,
        title: section.title,
        href: section.href,
        wordCount: section.word_count
      }));
    }
    return [
      {
        outlineId: buildOutlineId(chapter),
        chapterOrder: chapter.order,
        chapterTitle: chapter.title,
        sectionOrder: 0,
        title: chapter.title,
        href: chapter.href,
        wordCount: chapter.word_count
      }
    ];
  });
}

function isMappedOutlineEntry(entry: OutlineMapEntry | undefined) {
  if (!entry) return false;
  return (
    (entry.objectiveIds ?? []).length > 0
    || Boolean(entry.packId?.trim())
    || Boolean(entry.lessonIds && entry.lessonIds.length > 0)
    || Boolean(entry.tags && entry.tags.length > 0)
  );
}

function normalizeMappingStatus(status: string | undefined) {
  if (status === 'unmapped' || status === 'draft' || status === 'done') return status;
  return undefined;
}

function resolveOutlineStatus(entry: OutlineMapEntry | undefined): 'unmapped' | 'draft' | 'done' {
  const normalized = normalizeMappingStatus(entry?.status);
  if (normalized) return normalized;
  return isMappedOutlineEntry(entry) ? 'draft' : 'unmapped';
}

function intersects(setA: Set<string>, setB: Set<string>) {
  if (setA.size === 0 || setB.size === 0) return false;
  for (const value of setA) {
    if (setB.has(value)) return true;
  }
  return false;
}

function buildQuestionIndex(packs: ChapterPack[], state?: LocalState) {
  const rows: QuestionIndexRow[] = [];
  packs.forEach((pack) => {
    pack.question_bank.forEach((question) => {
      const rawType = (question as { legacyType?: string; type?: string }).legacyType
        ?? (question as { type?: string }).type
        ?? '';
      const objectiveIds = normalizeObjectiveIdList(question.objectiveIds ?? []);
      const tags = normalizeTagList(question.tags ?? []);
      const stat = state?.questionStats?.[question.id];
      const wrongRate = stat && stat.attempts > 0
        ? Math.max(0, (stat.attempts - stat.correct) / stat.attempts)
        : null;
      rows.push({
        questionId: question.id,
        packId: pack.pack_id,
        type: question.type,
        rawType,
        objectiveIds,
        objectiveIdSet: new Set(objectiveIds),
        tags,
        tagSet: new Set(tags),
        wrongRate
      });
    });
  });
  return rows;
}

function objectiveWeight(row: ObjectiveCoverageRow) {
  if (row.questionCount === 0) return 10_000;
  const wrongRate = row.averageWrongRate ?? 0;
  const mappingPenalty = row.mappedOutlineSectionsCount === 0
    ? 120
    : Math.max(0, 40 - row.mappedOutlineSectionsCount * 6);
  const interactivePenalty = Math.max(0, 3 - row.interactiveCount) * 14;
  const scenarioPenalty = row.scenarioCount === 0 ? 10 : 0;
  return wrongRate * 1_000 + (100 - Math.min(100, row.questionCount)) + mappingPenalty + interactivePenalty + scenarioPenalty;
}

function thinSectionWeight(row: OutlineSectionCoverageRow) {
  if (!row.mapped) return -1;
  const typeDiversity = [
    row.mcqCount > 0,
    row.multiSelectCount > 0,
    row.scenarioCount > 0,
    row.matchingCount > 0,
    row.orderingCount > 0
  ].filter(Boolean).length;
  const questionPenalty = row.questionCount === 0 ? 1_000 : Math.max(0, 100 - row.questionCount * 10);
  const diversityPenalty = Math.max(0, 3 - typeDiversity) * 20;
  const wrongRatePenalty = (row.averageWrongRate ?? 0) * 120;
  const metadataPenalty = (row.objectiveIds.length === 0 && !row.packId && row.tags.length === 0) ? 45 : 0;
  const sizePenalty = row.wordCount > 600 ? 20 : row.wordCount > 300 ? 10 : 0;
  return questionPenalty + diversityPenalty + wrongRatePenalty + metadataPenalty + sizePenalty;
}

const OUTLINE_THIN_THRESHOLDS = {
  minQuestionCount: 3,
  minInteractiveCount: 1
} as const;

function mappedOutlineCountByObjective(outlineMapDoc?: OutlineMapDoc) {
  const counts = new Map<string, number>();
  if (!outlineMapDoc?.entries) return counts;
  outlineMapDoc.entries.forEach((entry) => {
    if (!isMappedOutlineEntry(entry)) return;
    normalizeObjectiveIdList(entry.objectiveIds ?? []).forEach((objectiveId) => {
      counts.set(objectiveId, (counts.get(objectiveId) ?? 0) + 1);
    });
  });
  return counts;
}

export function computeObjectiveCoverageReport(
  objectivesDoc: ExamObjectivesDoc,
  packs: ChapterPack[],
  state?: LocalState,
  outlineMapDoc?: OutlineMapDoc
): ObjectiveCoverageReport {
  const coverageByObjective = new Map<string, CoverageAccumulator>();
  objectivesDoc.objectives.forEach((objective) => {
    coverageByObjective.set(objective.id, createAccumulator());
  });
  const mappedSectionCounts = mappedOutlineCountByObjective(outlineMapDoc);

  let untaggedQuestionCount = 0;

  packs.forEach((pack) => {
    pack.question_bank.forEach((question) => {
      const rawType = (question as { legacyType?: string; type?: string }).legacyType
        ?? (question as { type?: string }).type
        ?? '';
      const objectiveIds = normalizeObjectiveIdList(question.objectiveIds ?? []);
      if (objectiveIds.length === 0) {
        untaggedQuestionCount += 1;
        return;
      }

      const stat = state?.questionStats?.[question.id];
      const wrongRate =
        stat && stat.attempts > 0
          ? Math.max(0, (stat.attempts - stat.correct) / stat.attempts)
          : null;

      objectiveIds.forEach((objectiveId) => {
        const acc = coverageByObjective.get(objectiveId);
        if (!acc) return;
        acc.questionCount += 1;
        if (question.type === 'mcq') acc.mcqCount += 1;
        if (question.type === 'multi_select') acc.multiSelectCount += 1;
        if (rawType === 'scenario_mcq') acc.scenarioCount += 1;
        if (question.type === 'matching') {
          acc.interactiveCount += 1;
          acc.matchingCount += 1;
          acc.pbqCount += 1;
        }
        if (question.type === 'ordering') {
          acc.interactiveCount += 1;
          acc.orderingCount += 1;
          acc.pbqCount += 1;
        }
        if (wrongRate !== null) acc.wrongRates.push(wrongRate);
      });
    });
  });

  const rows = objectivesDoc.objectives
    .map((objective) => {
      const acc = coverageByObjective.get(objective.id) ?? createAccumulator();
      return {
        objectiveId: objective.id,
        title: objective.title,
        domainId: objective.domain_id,
        questionCount: acc.questionCount,
        mcqCount: acc.mcqCount,
        multiSelectCount: acc.multiSelectCount,
        scenarioCount: acc.scenarioCount,
        interactiveCount: acc.interactiveCount,
        matchingCount: acc.matchingCount,
        orderingCount: acc.orderingCount,
        pbqCount: acc.pbqCount,
        mappedOutlineSectionsCount: mappedSectionCounts.get(objective.id) ?? 0,
        averageWrongRate: mean(acc.wrongRates)
      };
    })
    .sort((a, b) => objectiveIdSort(a.objectiveId, b.objectiveId));

  const missingObjectiveIds = rows
    .filter((row) => row.questionCount === 0)
    .map((row) => row.objectiveId)
    .sort(objectiveIdSort);

  const topWeakest = [...rows]
    .sort((a, b) => objectiveWeight(b) - objectiveWeight(a))
    .slice(0, 20);

  return {
    generatedAt: new Date().toISOString(),
    objectiveCount: rows.length,
    missingObjectiveIds,
    topWeakest,
    rows,
    untaggedQuestionCount
  };
}

export function computeOpsCoverageReport(input: {
  objectivesDoc: ExamObjectivesDoc;
  packs: ChapterPack[];
  state?: LocalState;
  outlineDoc?: OutlineDoc | null;
  outlineMapDoc?: OutlineMapDoc | null;
}): OpsCoverageReport {
  const { objectivesDoc, packs, state, outlineDoc, outlineMapDoc } = input;
  const objectiveReport = computeObjectiveCoverageReport(objectivesDoc, packs, state, outlineMapDoc ?? undefined);
  const questionIndex = buildQuestionIndex(packs, state);
  const mappingIndex = new Map((outlineMapDoc?.entries ?? []).map((entry) => [entry.outlineId, entry]));

  const outlineSections = flattenOutline(outlineDoc).map((outlineRow) => {
    const mappingEntry = mappingIndex.get(outlineRow.outlineId);
    const mapped = isMappedOutlineEntry(mappingEntry);
    const status = resolveOutlineStatus(mappingEntry);
    const objectiveIds = normalizeObjectiveIdList(mappingEntry?.objectiveIds ?? []);
    const objectiveIdSet = new Set(objectiveIds);
    const tags = normalizeTagList(mappingEntry?.tags ?? []);
    const tagSet = new Set(tags);
    const packId = mappingEntry?.packId?.trim() ? mappingEntry.packId.trim() : null;

    const hasPackFilter = Boolean(packId);
    const hasObjectiveFilter = objectiveIdSet.size > 0;
    const hasTagFilter = tagSet.size > 0;

    const matchedQuestions = questionIndex.filter((question) => {
      if (!mapped) return false;
      if (!hasPackFilter && !hasObjectiveFilter && !hasTagFilter) return false;
      if (hasPackFilter && question.packId !== packId) return false;
      if (hasObjectiveFilter && !intersects(question.objectiveIdSet, objectiveIdSet)) return false;
      if (hasTagFilter && !intersects(question.tagSet, tagSet)) return false;
      return true;
    });

    const wrongRates = matchedQuestions
      .map((question) => question.wrongRate)
      .filter((wrongRate): wrongRate is number => wrongRate !== null);

    const mcqCount = matchedQuestions.filter((question) => question.type === 'mcq').length;
    const multiSelectCount = matchedQuestions.filter((question) => question.type === 'multi_select').length;
    const matchingCount = matchedQuestions.filter((question) => question.type === 'matching').length;
    const orderingCount = matchedQuestions.filter((question) => question.type === 'ordering').length;
    const scenarioCount = matchedQuestions.filter((question) => question.rawType === 'scenario_mcq').length;
    const interactiveCount = matchingCount + orderingCount;
    const thinReasons: string[] = [];

    if (mapped && matchedQuestions.length < OUTLINE_THIN_THRESHOLDS.minQuestionCount) {
      thinReasons.push(`questionCount<${OUTLINE_THIN_THRESHOLDS.minQuestionCount}`);
    }
    if (mapped && interactiveCount < OUTLINE_THIN_THRESHOLDS.minInteractiveCount) {
      thinReasons.push(`interactiveCount<${OUTLINE_THIN_THRESHOLDS.minInteractiveCount}`);
    }

    return {
      outlineId: outlineRow.outlineId,
      chapterOrder: outlineRow.chapterOrder,
      chapterTitle: outlineRow.chapterTitle,
      sectionOrder: outlineRow.sectionOrder,
      title: outlineRow.title,
      href: outlineRow.href,
      wordCount: outlineRow.wordCount,
      status,
      mapped,
      objectiveIds,
      mappedObjectiveIdsCount: objectiveIds.length,
      packId,
      lessonIds: mappingEntry?.lessonIds ?? [],
      tags,
      questionCount: matchedQuestions.length,
      mcqCount,
      multiSelectCount,
      scenarioCount,
      interactiveCount,
      matchingCount,
      orderingCount,
      pbqCount: matchingCount + orderingCount,
      averageWrongRate: mean(wrongRates),
      thinReasons
    } as OutlineSectionCoverageRow;
  });

  const unmappedOutlineSections = [...outlineSections]
    .filter((row) => row.status === 'unmapped' || !row.mapped)
    .sort((a, b) => {
      if (a.wordCount !== b.wordCount) return b.wordCount - a.wordCount;
      if (a.chapterOrder !== b.chapterOrder) return a.chapterOrder - b.chapterOrder;
      return a.sectionOrder - b.sectionOrder;
    });

  const thinOutlineSections = [...outlineSections]
    .filter((row) => row.mapped && row.thinReasons.length > 0)
    .sort((a, b) => {
      const delta = thinSectionWeight(b) - thinSectionWeight(a);
      if (delta !== 0) return delta;
      if (a.questionCount !== b.questionCount) return a.questionCount - b.questionCount;
      return b.wordCount - a.wordCount;
    });

  const topUnmappedOutlineSections = unmappedOutlineSections.slice(0, 50);
  const topThinOutlineSections = thinOutlineSections.slice(0, 50);

  return {
    generatedAt: new Date().toISOString(),
    thresholds: { ...OUTLINE_THIN_THRESHOLDS },
    objectiveReport,
    zeroCoverageObjectiveIds: objectiveReport.missingObjectiveIds,
    topWeakObjectives: objectiveReport.topWeakest.slice(0, 20),
    outlineSections,
    unmappedOutlineSections,
    thinOutlineSections,
    topUnmappedOutlineSections,
    topThinOutlineSections
  };
}
