import { ChapterPack, Mission, Question } from './types';

export function buildQuestionMap(pack: ChapterPack) {
  const map = new Map<string, Question>();
  pack.question_bank.forEach((q) => map.set(q.id, q));
  return map;
}

export function getMissionQuestions(pack: ChapterPack, mission: Mission) {
  const map = buildQuestionMap(pack);
  return mission.question_ids.map((id) => map.get(id)).filter(Boolean) as Question[];
}

export function getBossQuestions(pack: ChapterPack) {
  const map = buildQuestionMap(pack);
  return pack.boss.question_ids.map((id) => map.get(id)).filter(Boolean) as Question[];
}

export function getTrapTip(pack: ChapterPack, questionId: string) {
  const trap = pack.trap_list.find((t) => t.drill_question_ids.includes(questionId));
  return trap ? trap.fix : null;
}

export function getQuestionById(pack: ChapterPack, questionId: string) {
  return pack.question_bank.find((q) => q.id === questionId) ?? null;
}
