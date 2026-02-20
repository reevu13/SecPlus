export const DEFAULT_RUNTIME_MINUTES = 90;
export const DEFAULT_MINUTES_PER_QUESTION = 1;
export const MIN_RUNTIME_MINUTES = 5;
export const MAX_RUNTIME_MINUTES = 180;
export const MIN_MINUTES_PER_QUESTION = 0.25;
export const MAX_MINUTES_PER_QUESTION = 5;

export type RoguelikeRuntimeConfig = {
  runtimeMinutes: number;
  minutesPerQuestion: number;
  targetQuestionCount: number;
};

export type RoguelikeQueryConfig = {
  seed: string;
  focusTags: string[];
  chapterScope: string[];
  runtime: RoguelikeRuntimeConfig;
};

export function clampRuntimeMinutes(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_RUNTIME_MINUTES;
  return Math.max(MIN_RUNTIME_MINUTES, Math.min(MAX_RUNTIME_MINUTES, Math.round(value)));
}

export function clampMinutesPerQuestion(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_MINUTES_PER_QUESTION;
  const clamped = Math.max(MIN_MINUTES_PER_QUESTION, Math.min(MAX_MINUTES_PER_QUESTION, value));
  return Math.round(clamped * 100) / 100;
}

export function parseCsvParam(value?: string | null) {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildRuntimeConfig(runtimeMinutes: number, minutesPerQuestion: number): RoguelikeRuntimeConfig {
  const normalizedRuntimeMinutes = clampRuntimeMinutes(runtimeMinutes);
  const normalizedMinutesPerQuestion = clampMinutesPerQuestion(minutesPerQuestion);
  const targetQuestionCount = Math.max(1, Math.floor(normalizedRuntimeMinutes / normalizedMinutesPerQuestion));
  return {
    runtimeMinutes: normalizedRuntimeMinutes,
    minutesPerQuestion: normalizedMinutesPerQuestion,
    targetQuestionCount
  };
}

export function parseRoguelikeQueryParams(params: URLSearchParams): RoguelikeQueryConfig {
  const seed = (params.get('seed') || '').trim();
  const focusTags = parseCsvParam(params.get('focus'));
  const chapterScope = parseCsvParam(params.get('chapters'));
  const runtimeMinutes = Number(params.get('runtime'));
  const minutesPerQuestion = Number(params.get('mpq'));
  const runtime = buildRuntimeConfig(runtimeMinutes, minutesPerQuestion);
  return {
    seed,
    focusTags,
    chapterScope,
    runtime
  };
}
