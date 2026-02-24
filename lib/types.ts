export type XpRules = {
  base_xp_per_correct: number;
  streak_bonus_per_5: number;
  time_bonus_threshold_seconds: number;
  time_bonus_xp: number;
  mistake_penalty_xp: number;
};

export type MasteryModel = {
  scale: string;
  update: string;
  tags_drive_mastery: boolean;
};

export type UnlockRule = {
  unlock: string;
  when: string;
};

export type Mission = {
  id: string;
  name: string;
  goal: string;
  mechanics: Record<string, unknown> & { minigame: string };
  question_ids: string[];
  rewards: {
    xp: number;
    loot: string[];
    unlock?: string;
  };
};

export type Boss = {
  id: string;
  name: string;
  premise: string;
  mechanics: Record<string, unknown>;
  question_ids: string[];
  rewards: {
    xp: number;
    loot: string[];
  };
};

export type RoguelikeCard = {
  id: string;
  name: string;
  tags?: string[];
  effect?: string;
};

export type ChapterPack = {
  schema_version: string;
  pack_id: string;
  objectiveIds: string[];
  exam: {
    vendor: string;
    name: string;
    code: string;
    max_exam_minutes: number;
  };
  chapter: {
    number: number;
    title: string;
    page_range_in_user_pdf: string;
  };
  design_intent: {
    mode: string[];
    pvp_optional: boolean;
    default_pvp_enabled: boolean;
    player_goal: string;
  };
  progression: {
    xp_rules: XpRules;
    mastery_model: MasteryModel;
    unlock_rules: UnlockRule[];
  };
  tags: {
    concepts: string[];
    difficulty_scale: Record<string, string>;
  };
  trap_list: {
    id: string;
    name: string;
    misconception: string;
    fix: string;
    drill_question_ids: string[];
  }[];
  missions: Mission[];
  boss: Boss;
  roguelike: {
    runset_id: string;
    run_minutes_target: number;
    structure: {
      acts: number;
      encounters_per_act: number;
      rest_sites_per_act: number;
      boss_per_run: string;
    };
    cards: {
      threat_cards: RoguelikeCard[];
      constraint_cards: RoguelikeCard[];
      control_cards: RoguelikeCard[];
    };
    question_pool_ids: string;
  };
  pvp: {
    enabled: boolean;
    modes: {
      id: string;
      name: string;
      description: string;
      rules: Record<string, unknown>;
    }[];
    fairness: {
      matchmaking: string;
      anti_cheat: string;
    };
  };
  question_bank: Question[];
  enrichment?: PackEnrichment;
};

export type ConfusionPair = {
  id: string;
  title: string;
  a: { term: string; definition: string };
  b: { term: string; definition: string };
  bullets: string[];
};

export type PackEnrichment = {
  confusion_pairs: ConfusionPair[];
  tag_rules: Record<string, { rule: string; micro_example: string; confusion_pair_id: string }>;
};

export type LessonContentBlock = {
  type: 'explain' | 'diagram' | 'example' | 'trap';
  text: string;
};

export type LessonCheckSingleChoice = {
  type: 'single_choice';
  prompt: string;
  options: string[];
  correct_index: number;
  explanation: string;
};

export type LessonCheckMultiSelect = {
  type: 'multi_select';
  prompt: string;
  options: string[];
  correct_indices: number[];
  explanation: string;
};

export type LessonCheckMatching = {
  type: 'matching';
  prompt: string;
  left: string[];
  right: string[];
  correct_map: Record<string, string>;
  explanation: string;
};

export type LessonCheckCloze = {
  type: 'cloze';
  prompt: string;
  answers: string[];
  explanation: string;
};

export type LessonCheck = LessonCheckSingleChoice | LessonCheckMultiSelect | LessonCheckMatching | LessonCheckCloze;

// ─── Micro-Interaction System ──────────────────────────────────────────────────

/** Discriminant for LessonCard interaction types. */
export type InteractionType =
  | 'mcq'
  | 'terminal_sim'
  | 'log_analyzer'
  | 'drag_and_drop_zone'
  | 'tap_to_highlight';

/** Multiple-choice question payload (mirrors QuestionBank MCQ but lightweight). */
export type McqPayload = {
  prompt: string;
  options: string[];
  correct_index: number;
  explanation: string;
};

/**
 * Terminal Simulator payload.
 * The user types commands into a fake shell; each command is validated
 * against a regex `pattern`. The first matching command wins.
 */
export type TerminalSimPayload = {
  /** Short scenario description shown above the terminal prompt. */
  scenario: string;
  commands: {
    /** JS-compatible regex string tested against the full user input line. */
    pattern: string;
    success_message: string;
    hint?: string;
  }[];
  /** Optional text rendered as fake terminal output after success. */
  expected_output?: string;
};

/**
 * Log / code-block Analyzer payload.
 * Renders `log_lines` as a numbered list; the user taps the lines
 * identified by `vulnerable_line_indices`.
 */
export type LogAnalyzerPayload = {
  log_lines: string[];
  /** 0-based indices of lines the user must select to succeed. */
  vulnerable_line_indices: number[];
  explanation: string;
};

/**
 * Drag-and-Drop Zone payload.
 * Draggable `items` must be dropped on correct `zones`.
 */
export type DragAndDropPayload = {
  items: string[];
  zones: string[];
  /** Maps item label → correct zone label. */
  correct_pairs: Record<string, string>;
  explanation: string;
};

/**
 * Tap-to-Highlight payload.
 * Renders a paragraph or code block as plain text; the user taps
 * character spans identified by `target_span_labels` to succeed.
 */
export type TapToHighlightPayload = {
  /** Full text rendered in the widget. */
  text: string;
  spans: {
    start: number; // char offset, inclusive
    end: number;   // char offset, exclusive
    label: string;
  }[];
  /** Labels that must be selected for success. */
  target_span_labels: string[];
  explanation: string;
};

/** Base fields shared by every LessonCard. */
export type LessonCardBase = {
  id: string;
  /**
   * Contextual framing text shown above the interaction widget.
   * Hard maximum: 250 characters.
   */
  text: string;
  /** Card ID to surface as a remediation slide-up when this card is failed. */
  remediation_id?: string;
  objectiveIds?: string[];
};

/**
 * Discriminated union over all interaction types.
 * TypeScript narrows `interaction_payload` automatically via `interaction_type`.
 */
export type LessonCard =
  | (LessonCardBase & { interaction_type: 'mcq';                interaction_payload: McqPayload })
  | (LessonCardBase & { interaction_type: 'terminal_sim';       interaction_payload: TerminalSimPayload })
  | (LessonCardBase & { interaction_type: 'log_analyzer';       interaction_payload: LogAnalyzerPayload })
  | (LessonCardBase & { interaction_type: 'drag_and_drop_zone'; interaction_payload: DragAndDropPayload })
  | (LessonCardBase & { interaction_type: 'tap_to_highlight';   interaction_payload: TapToHighlightPayload });

// ─── Lesson Structure ──────────────────────────────────────────────────────────

export type LessonPage = {
  id: string;
  title: string;
  objectiveIds: string[];
  /** Legacy long-form content blocks (v1/v2 lessons). Retained for backward compat. */
  content_blocks: LessonContentBlock[];
  /** Legacy inline checks (v1/v2 lessons). Retained for backward compat. */
  checks: LessonCheck[];
  /**
   * Micro-interaction cards (v3+).
   * When present, the UI renders card-by-card instead of the scroll reader.
   * Each card must be completed before the user can advance.
   */
  cards?: LessonCard[];
};

export type LessonModule = {
  id: string;
  title: string;
  tag_ids: string[];
  objectiveIds: string[];
  pages: LessonPage[];
};

export type ChapterLesson = {
  pack_id: string;
  version: string;
  objectiveIds: string[];
  modules: LessonModule[];
};

export type QuestionBase = {
  id: string;
  type: 'mcq' | 'multi_select' | 'matching' | 'ordering';
  legacyType?: string;
  stem: string;
  hints?: string[];
  explanation: string;
  tags: string[];
  objectiveIds: string[];
  rationaleCorrect: string;
  rationaleIncorrect: Record<string, string>;
  misconceptionTags: string[];
  sourceRef?: {
    outlineId: string;
    href?: string;
    title?: string;
  };
  difficulty?: 1 | 2 | 3 | 4 | 5;
  estimated_seconds: number;
};

export type McqQuestion = QuestionBase & {
  type: 'mcq';
  options: Record<string, string>;
  answer: string;
};

export type MultiSelectQuestion = QuestionBase & {
  type: 'multi_select';
  options: Record<string, string>;
  answers: string[];
};

export type MatchingQuestion = QuestionBase & {
  type: 'matching';
  left: string[];
  right: string[];
  pairs: Record<string, string>;
};

export type OrderingQuestion = QuestionBase & {
  type: 'ordering';
  items: string[];
  correct_order: string[];
};

export type Question = McqQuestion | MultiSelectQuestion | MatchingQuestion | OrderingQuestion;

/**
 * Per-card completion tracking stored in IndexedDB.
 * Key: `LessonCard.id`
 */
export type CardProgress = {
  attempts: number;
  successes: number;
  lastAnswered?: string; // ISO string
  /** True once the card has been completed correctly at least once. */
  mastered: boolean;
};

export type LocalState = {
  version: 2;
  masteryByTag: Record<string, number>;
  streak: {
    days: number;
    lastActive: string | null;
  };
  runHistory: RunHistoryItem[];
  mistakeCards: MistakeCard[];
  questionStats: Record<string, QuestionStat>;
  activeSessions: Record<string, ActiveSession>;
  lessonProgress: Record<string, LessonProgress>;
  lessonRecall: Record<string, LessonRecallState>;
  xpTotal: number;
  /** Per-card interaction progress. Key: LessonCard.id */
  cardProgress: Record<string, CardProgress>;
};

export type QuestionStat = {
  attempts: number;
  correct: number;
  lastAnswered?: string;
  interval: number;
  easiness: number;
  due: string;
};

export type MistakeCard = {
  id: string;
  pack_id: string;
  question_id: string;
  question_type: 'mcq' | 'multi_select' | 'matching' | 'ordering' | 'lesson' | 'lesson_card';
  hints_used: boolean;
  objectiveIds: string[];
  misconceptionTags: string[];
  prompt: string;
  my_answer: string;
  correct_answer: string;
  rule_of_thumb: string;
  micro_example: string;
  confusion_pair_id?: string;
  tags: string[];
  created_at: string;
  nextDueAt: string;
  // Legacy alias retained for backward compatibility with existing exports/imports.
  due: string;
  interval: number;
  ease: number;
  lapses: number;
  status: 'wrong' | 'unsure';
  last_reviewed?: string;
  remediation?: MistakeCardRemediation[];
};

export type MistakeCardRemediation = {
  label: string;
  href: string;
  objectiveIds?: string[];
};

export type RunHistoryItem = {
  id: string;
  seed: string;
  mode: 'campaign' | 'roguelike' | 'exam';
  started_at: string;
  ended_at?: string;
  total: number;
  correct: number;
  incorrect: number;
  unsure: number;
  xp: number;
  weak_tags: string[];
};

export type RunQuestionResult = {
  question_id: string;
  correct: boolean;
  unsure: boolean;
  time_ms: number;
  justification?: string;
};

export type ActiveSession = {
  results: RunQuestionResult[];
  updated_at: string;
};

export type LessonCheckResult = {
  attempts: number;
  correct: number;
  lastAnswered?: string;
};

export type LessonProgress = {
  completedPages: string[];
  checkResults: Record<string, LessonCheckResult>;
  xp: number;
  lastViewed?: string;
  lastModuleId?: string;
  lastPageId?: string;
};

export type LessonRecallItemState = {
  interval: number;
  ease: number;
  due: string;
  attempts: number;
  correct: number;
  lastAnswered?: string;
};

export type LessonRecallState = {
  items: Record<string, LessonRecallItemState>;
  lastRun?: string;
};

export type LessonRecallItem = {
  id: string;
  type: 'cloze' | 'explain';
  prompt: string;
  answers?: string[];
  explanation: string;
  module_id: string;
  page_id: string;
  tag_ids: string[];
};

export type ExamObjectiveDomain = {
  id: string;
  title: string;
};

export type ExamObjective = {
  id: string;
  title: string;
  domain_id: string;
};

export type ExamObjectivesDoc = {
  exam_code: string;
  version: string;
  source_pdf: string;
  generated_at: string;
  domains: ExamObjectiveDomain[];
  objectives: ExamObjective[];
};
