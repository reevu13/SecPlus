import { ChapterPack, Mission, LocalState } from './types';
import { getMissionQuestions } from './packUtils';

export function missionStats(state: LocalState, pack: ChapterPack, mission: Mission) {
  const questions = getMissionQuestions(pack, mission);
  const total = questions.length;
  let attempts = 0;
  let correct = 0;
  questions.forEach((q) => {
    const stat = state.questionStats[q.id];
    if (stat) {
      attempts += stat.attempts;
      correct += stat.correct;
    }
  });
  const completion = total ? Math.min(100, Math.round((questions.filter((q) => state.questionStats[q.id]).length / total) * 100)) : 0;
  const accuracy = attempts ? Math.round((correct / attempts) * 100) : 0;
  return { attempts, correct, completion, accuracy };
}

export function packProgressSummary(state: LocalState, pack: ChapterPack) {
  const missionsTotal = pack.missions.length + 1; // include boss as final
  const touched = pack.missions.filter((mission) => {
    const stats = missionStats(state, pack, mission);
    return stats.attempts > 0;
  }).length;
  const bossTouched = pack.boss.question_ids.some((id) => state.questionStats[id]);
  const completed = touched + (bossTouched ? 1 : 0);
  return {
    missionsTotal,
    completed,
    percent: missionsTotal ? Math.round((completed / missionsTotal) * 100) : 0
  };
}

export function masteryByTagFromState(state: LocalState) {
  return state.masteryByTag;
}
