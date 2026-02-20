import { ChapterLesson, ChapterPack, LessonModule, LessonPage, Question } from './types';

const OBJECTIVE_ID_PATTERN = /^\d+\.\d+$/;
const CHAPTER_OBJECTIVE_FALLBACK: Record<number, string[]> = {
  1: ['2.1'],
  2: ['2.2'],
  3: ['2.3'],
  4: ['1.1', '1.2'],
  5: ['1.3', '1.4'],
  6: ['1.5', '1.6'],
  7: ['3.1'],
  8: ['3.2'],
  9: ['3.3'],
  10: ['3.4'],
  11: ['4.1', '4.2'],
  12: ['4.3', '4.4'],
  13: ['4.5', '4.6'],
  14: ['4.7', '4.8'],
  15: ['5.1', '5.2'],
  16: ['5.3', '5.4'],
  17: ['5.5', '5.6', '5.7']
};

function numericParts(id: string) {
  return id.split('.').map((segment) => Number.parseInt(segment, 10));
}

export function objectiveIdSort(a: string, b: string) {
  const [aMajor, aMinor] = numericParts(a);
  const [bMajor, bMinor] = numericParts(b);
  if (aMajor !== bMajor) return aMajor - bMajor;
  return aMinor - bMinor;
}

function collectObjectiveIds(values: unknown[]): string[] {
  const ids = new Set<string>();
  values.forEach((value) => {
    if (!Array.isArray(value)) return;
    value.forEach((entry) => {
      if (typeof entry !== 'string') return;
      const normalized = entry.trim();
      if (OBJECTIVE_ID_PATTERN.test(normalized)) ids.add(normalized);
    });
  });
  return [...ids].sort(objectiveIdSort);
}

function chapterObjectiveFallback(pack: ChapterPack) {
  const chapterNumber = Number.isFinite(pack.chapter?.number) ? Number(pack.chapter.number) : null;
  if (!chapterNumber) return [] as string[];
  return collectObjectiveIds([CHAPTER_OBJECTIVE_FALLBACK[chapterNumber] ?? []]);
}

function extractObjectiveIdsFromStrings(values: string[]): string[] {
  const ids = new Set<string>();
  values.forEach((value) => {
    value.match(/\b\d+\.\d+\b/g)?.forEach((id) => {
      if (OBJECTIVE_ID_PATTERN.test(id)) ids.add(id);
    });
  });
  return [...ids].sort(objectiveIdSort);
}

function normalizeSourceRef(sourceRef: unknown) {
  if (!sourceRef || typeof sourceRef !== 'object') return undefined;
  const raw = sourceRef as { outlineId?: unknown; href?: unknown; title?: unknown };
  if (typeof raw.outlineId !== 'string' || !raw.outlineId.trim()) return undefined;
  const normalized: { outlineId: string; href?: string; title?: string } = {
    outlineId: raw.outlineId.trim()
  };
  if (typeof raw.href === 'string' && raw.href.trim()) normalized.href = raw.href.trim();
  if (typeof raw.title === 'string' && raw.title.trim()) normalized.title = raw.title.trim();
  return normalized;
}

function normalizeDifficulty(value: unknown): 1 | 2 | 3 | 4 | 5 {
  if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) {
    return value;
  }
  return 3;
}

function normalizeRationaleIncorrect(value: unknown) {
  if (!value || typeof value !== 'object') return {} as Record<string, string>;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, rationale]) => typeof rationale === 'string' && rationale.trim())
    .map(([optionId, rationale]) => [optionId, (rationale as string).trim()]);
  return Object.fromEntries(entries);
}

function normalizeMisconceptionTags(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return [...new Set(value.filter((tag) => typeof tag === 'string').map((tag) => (tag as string).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function normalizeHints(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .filter((hint) => typeof hint === 'string')
    .map((hint) => (hint as string).trim())
    .filter(Boolean)
    .slice(0, 3);
}

function normalizeQuestion(question: any, fallbackObjectiveIds: string[]): Question {
  const rawType = typeof question.type === 'string' ? question.type : '';
  const normalizedType =
    rawType === 'multi_select' || rawType === 'matching' || rawType === 'ordering' || rawType === 'mcq'
      ? rawType
      : 'mcq';
  const explicitLegacyType = typeof question.legacyType === 'string' ? question.legacyType.trim() : '';
  const legacyType = explicitLegacyType || (rawType && rawType !== normalizedType ? rawType : undefined);
  const inferred = extractObjectiveIdsFromStrings(question.tags ?? []);
  const explicitObjectiveIds = collectObjectiveIds([question.objectiveIds, inferred]);
  const objectiveIds = collectObjectiveIds([explicitObjectiveIds, fallbackObjectiveIds]);
  return {
    ...question,
    legacyType,
    type: normalizedType,
    hints: normalizeHints(question.hints),
    objectiveIds,
    rationaleCorrect: typeof question.rationaleCorrect === 'string' ? question.rationaleCorrect : '',
    rationaleIncorrect: normalizeRationaleIncorrect(question.rationaleIncorrect),
    misconceptionTags: normalizeMisconceptionTags(question.misconceptionTags),
    sourceRef: normalizeSourceRef(question.sourceRef),
    difficulty: normalizeDifficulty(question.difficulty)
  } as Question;
}

function normalizeLessonPage(page: LessonPage, fallbackObjectiveIds: string[]): LessonPage {
  const objectiveIds = collectObjectiveIds([page.objectiveIds, fallbackObjectiveIds]);
  return { ...page, objectiveIds };
}

function normalizeLessonModule(module: LessonModule, fallbackObjectiveIds: string[]): LessonModule {
  const inferred = extractObjectiveIdsFromStrings(module.tag_ids ?? []);
  const moduleObjectiveIds = collectObjectiveIds([module.objectiveIds, inferred, fallbackObjectiveIds]);
  const pages = module.pages.map((page) => normalizeLessonPage(page, moduleObjectiveIds));
  const pageObjectiveIds = pages.flatMap((page) => page.objectiveIds);
  const objectiveIds = collectObjectiveIds([moduleObjectiveIds, pageObjectiveIds]);
  return { ...module, objectiveIds, pages };
}

export function normalizePackObjectives(pack: ChapterPack): ChapterPack {
  const fallbackObjectiveIds = collectObjectiveIds([pack.objectiveIds, chapterObjectiveFallback(pack)]);
  const question_bank = pack.question_bank.map((question) => normalizeQuestion(question, fallbackObjectiveIds));
  const questionObjectiveIds = question_bank.flatMap((question) => question.objectiveIds);
  const objectiveIds = collectObjectiveIds([pack.objectiveIds, fallbackObjectiveIds, questionObjectiveIds]);
  return { ...pack, objectiveIds, question_bank };
}

export function normalizeLessonObjectives(lesson: ChapterLesson): ChapterLesson {
  const modules = lesson.modules.map((module) => normalizeLessonModule(module, collectObjectiveIds([lesson.objectiveIds])));
  const moduleObjectiveIds = modules.flatMap((module) => module.objectiveIds);
  const objectiveIds = collectObjectiveIds([lesson.objectiveIds, moduleObjectiveIds]);
  return { ...lesson, objectiveIds, modules };
}
