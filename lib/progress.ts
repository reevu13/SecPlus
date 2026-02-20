import { ChapterPack, LocalState, MistakeCard, Question, QuestionStat } from './types';

const SM2_MIN_EASE = 1.3;
const SM2_MAX_EASE = 2.8;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function getMistakeCardDueAt(card: MistakeCard) {
  return card.nextDueAt ?? card.due;
}

export function isMistakeCardDue(card: MistakeCard, now = new Date()) {
  return new Date(getMistakeCardDueAt(card)).getTime() <= now.getTime();
}

export function formatDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function daysBetween(a: Date, b: Date) {
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function updateStreak(state: LocalState, now = new Date()): LocalState {
  const today = formatDate(now);
  const lastActive = state.streak.lastActive ? new Date(state.streak.lastActive) : null;
  let days = state.streak.days;

  if (!lastActive) {
    days = 1;
  } else {
    const diff = daysBetween(lastActive, now);
    if (diff === 1) days += 1;
    else if (diff > 1) days = 1;
  }

  return {
    ...state,
    streak: { days, lastActive: today }
  };
}

export function updateQuestionStat(stat: QuestionStat | undefined, correct: boolean, now = new Date()): QuestionStat {
  const base: QuestionStat = stat ?? {
    attempts: 0,
    correct: 0,
    interval: 1,
    easiness: 2.5,
    due: now.toISOString()
  };

  const next = { ...base };
  next.attempts += 1;
  if (correct) next.correct += 1;

  if (correct) {
    next.easiness = Math.max(1.3, next.easiness + 0.1);
    if (next.correct === 1) next.interval = 1;
    else if (next.correct === 2) next.interval = 6;
    else next.interval = Math.round(next.interval * next.easiness);
  } else {
    next.easiness = Math.max(1.3, next.easiness - 0.2);
    next.interval = 1;
  }

  const due = new Date(now.getTime() + next.interval * 24 * 60 * 60 * 1000);
  next.due = due.toISOString();
  next.lastAnswered = now.toISOString();

  return next;
}

export function updateMasteryByTags(state: LocalState, tags: string[], correct: boolean, firstCorrect: boolean): LocalState {
  const masteryByTag = { ...state.masteryByTag };
  const delta = correct ? (firstCorrect ? 8 : 4) : -6;
  tags.forEach((tag) => {
    const current = masteryByTag[tag] ?? 50;
    masteryByTag[tag] = Math.min(100, Math.max(0, current + delta));
  });
  return { ...state, masteryByTag };
}

function firstSentence(text: string) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const match = cleaned.match(/.+?[.!?](\s|$)/);
  return match ? match[0].trim() : cleaned;
}

export function deriveGuidance(pack: ChapterPack, question: Question) {
  const tagRules = pack.enrichment?.tag_rules ?? {};
  for (const tag of question.tags) {
    const rule = tagRules[tag];
    if (rule) {
      return {
        rule_of_thumb: rule.rule,
        micro_example: rule.micro_example,
        confusion_pair_id: rule.confusion_pair_id
      };
    }
  }
  const fallbackRule = firstSentence(question.explanation) || 'Review the core concept and its definition.';
  return {
    rule_of_thumb: fallbackRule,
    micro_example: 'Example: apply the rule to a similar scenario from the chapter.',
    confusion_pair_id: undefined
  };
}

export function deriveTagGuidance(pack: ChapterPack, tags: string[], fallbackText: string) {
  const tagRules = pack.enrichment?.tag_rules ?? {};
  for (const tag of tags) {
    const rule = tagRules[tag];
    if (rule) {
      return {
        rule_of_thumb: rule.rule,
        micro_example: rule.micro_example,
        confusion_pair_id: rule.confusion_pair_id
      };
    }
  }
  const fallbackRule = firstSentence(fallbackText) || 'Focus on the core definition and its most common use case.';
  return {
    rule_of_thumb: fallbackRule,
    micro_example: 'Example: apply the rule to a similar scenario from the lesson.',
    confusion_pair_id: undefined
  };
}

export function upsertMistakeCard(
  state: LocalState,
  base: Omit<MistakeCard, 'id' | 'created_at' | 'nextDueAt' | 'due' | 'interval' | 'ease' | 'lapses' | 'status' | 'last_reviewed'>,
  status: 'wrong' | 'unsure',
  now = new Date()
) {
  const existing = state.mistakeCards.find((card) => card.question_id === base.question_id);
  const baseEase = existing?.ease ?? 2.3;
  let interval = status === 'wrong' ? 1 : 2;
  let ease = baseEase;
  let lapses = existing?.lapses ?? 0;

  if (status === 'wrong') {
    ease = Math.max(SM2_MIN_EASE, baseEase - 0.2);
    lapses += 1;
  }

  const nextDueAt = new Date(now.getTime() + interval * MS_PER_DAY).toISOString();

  const nextCard: MistakeCard = {
    ...base,
    id: existing?.id ?? `${base.question_id}_${formatDate(now)}`,
    created_at: existing?.created_at ?? now.toISOString(),
    nextDueAt,
    due: nextDueAt,
    interval,
    ease,
    lapses,
    status
  };

  const cards = existing
    ? state.mistakeCards.map((card) => (card.question_id === base.question_id ? nextCard : card))
    : [...state.mistakeCards, nextCard];

  return { ...state, mistakeCards: cards };
}

export function applyMistakeReview(card: MistakeCard, result: 'correct_confident' | 'correct_unsure' | 'wrong', now = new Date()) {
  let interval = card.interval;
  let ease = card.ease;
  let lapses = card.lapses;

  if (result === 'correct_confident') {
    interval = interval * ease;
    ease = Math.min(SM2_MAX_EASE, ease + 0.1);
  } else if (result === 'correct_unsure') {
    interval = interval * 1.6;
  } else {
    interval = 1;
    ease = Math.max(SM2_MIN_EASE, ease - 0.2);
    lapses += 1;
  }

  const nextInterval = Math.max(1, Math.round(interval));
  const nextDueAt = new Date(now.getTime() + nextInterval * MS_PER_DAY).toISOString();
  return {
    ...card,
    interval: nextInterval,
    ease,
    lapses,
    nextDueAt,
    due: nextDueAt,
    last_reviewed: now.toISOString(),
    status: result === 'wrong' ? 'wrong' : card.status
  };
}

export function topWeakTags(masteryByTag: Record<string, number>, count = 5) {
  return Object.entries(masteryByTag)
    .sort((a, b) => a[1] - b[1])
    .slice(0, count)
    .map(([tag]) => tag);
}

export function resetChapterCampaignProgress(state: LocalState, pack: ChapterPack): LocalState {
  const questionIds = new Set(pack.question_bank.map((question) => question.id));

  const questionStats = Object.fromEntries(
    Object.entries(state.questionStats).filter(([questionId]) => !questionIds.has(questionId))
  );

  const mistakeCards = state.mistakeCards.filter((card) => !questionIds.has(card.question_id));

  const activeSessions = Object.fromEntries(
    Object.entries(state.activeSessions).filter(([, session]) =>
      !session.results.some((result) => questionIds.has(result.question_id))
    )
  );

  return {
    ...state,
    questionStats,
    mistakeCards,
    activeSessions
  };
}
