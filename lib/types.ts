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

export type LessonPage = {
  id: string;
  title: string;
  objectiveIds: string[];
  content_blocks: LessonContentBlock[];
  checks: LessonCheck[];
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

export type LocalState = {
  version: 1;
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
  question_type: 'mcq' | 'multi_select' | 'matching' | 'ordering' | 'lesson';
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
