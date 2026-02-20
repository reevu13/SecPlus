import { ChapterPack, Question } from './types';
import { createSeededRng } from './seededRandom';
import { topWeakTags } from './progress';

export type RunQuestion = {
  packId: string;
  question: Question;
};

export type RunPlan = {
  seed: string;
  questions: RunQuestion[];
  weakTags: string[];
  focusTags: string[];
  chapterScope: string[];
  runtimeMinutes: number;
  minutesPerQuestion: number;
  targetCount: number;
};

function getQuestionWeight(
  question: Question,
  masteryByTag: Record<string, number>,
  focusTagSet: Set<string>
) {
  const tags = question.tags.length ? question.tags : ['untagged'];
  const avg = tags.reduce((sum, tag) => sum + (masteryByTag[tag] ?? 50), 0) / tags.length;
  const weakBoost = (100 - avg) / 50; // 0 to 2
  const hasFocusTag = tags.some((tag) => focusTagSet.has(tag));
  const focusBoost = hasFocusTag ? 0.8 : 0;
  return Math.max(0.3, 1 + weakBoost + focusBoost);
}

function weightedPick<T>(items: T[], weights: number[], rng: () => number) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let threshold = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    threshold -= weights[i];
    if (threshold <= 0) return i;
  }
  return items.length - 1;
}

export function generateRunPlan(
  packs: ChapterPack[],
  masteryByTag: Record<string, number>,
  seed: string,
  targetCount = 30,
  focusTags: string[] = [],
  options: { runtimeMinutes?: number; minutesPerQuestion?: number } = {}
): RunPlan {
  const rng = createSeededRng(seed);
  const focusTagSet = new Set(focusTags);
  const runtimeMinutes = Number.isFinite(options.runtimeMinutes) ? Number(options.runtimeMinutes) : 90;
  const minutesPerQuestion = Number.isFinite(options.minutesPerQuestion) ? Number(options.minutesPerQuestion) : 1;
  const pool: RunQuestion[] = packs.flatMap((pack) =>
    pack.question_bank.map((question) => ({ packId: pack.pack_id, question }))
  );

  const selected: RunQuestion[] = [];
  const available = [...pool];
  const weights = available.map((item) => getQuestionWeight(item.question, masteryByTag, focusTagSet));

  while (selected.length < targetCount && available.length > 0) {
    const idx = weightedPick(available, weights, rng);
    selected.push(available[idx]);
    available.splice(idx, 1);
    weights.splice(idx, 1);
  }

  const weakTags = topWeakTags(masteryByTag, 6);
  const prioritized = Array.from(new Set([...focusTags, ...weakTags])).slice(0, 6);

  return {
    seed,
    questions: selected,
    weakTags: prioritized,
    focusTags,
    chapterScope: packs
      .map((pack) => pack.pack_id)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })),
    runtimeMinutes,
    minutesPerQuestion,
    targetCount
  };
}
