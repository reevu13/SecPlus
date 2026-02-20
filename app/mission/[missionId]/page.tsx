'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useParams } from 'next/navigation';
import { usePacks } from '@/lib/usePacks';
import { useLessons } from '@/lib/useLessons';
import { getBossQuestions, getMissionQuestions } from '@/lib/packUtils';
import QuestionFlow from '@/components/QuestionFlow';
import { useLocalState } from '@/lib/useLocalState';
import { applyMistakeReview, updateMasteryByTags, updateQuestionStat } from '@/lib/progress';
import MistakeCardItem from '@/components/MistakeCardItem';
import { getLessonTagSet } from '@/lib/lessonUtils';

const MASTERY_THRESHOLD = 95;

export default function MissionPage() {
  const params = useParams();
  const { packs, loaded } = usePacks();
  const { lessons } = useLessons();
  const { state, updateState, loaded: stateLoaded } = useLocalState();
  const [completed, setCompleted] = useState(false);
  const paramValue = params?.missionId;
  const missionId = decodeURIComponent(Array.isArray(paramValue) ? paramValue[0] : (paramValue ?? '')).trim();
  const [requireLessons, setRequireLessons] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('secplus_require_lessons');
    if (saved) setRequireLessons(saved === 'true');
  }, []);

  const missionData = useMemo(() => {
    for (const pack of packs) {
      const mission = pack.missions.find((m) => String(m.id) === missionId);
      if (mission) return { pack, mission, questions: getMissionQuestions(pack, mission), title: mission.name, subtitle: mission.goal };
      if (String(pack.boss.id) === missionId) {
        return { pack, mission: null, questions: getBossQuestions(pack), title: pack.boss.name, subtitle: pack.boss.premise };
      }
    }
    return null;
  }, [packs, missionId]);

  if (!loaded) {
    return <div className="card">Loading mission...</div>;
  }

  if (packs.length === 0) {
    return <div className="card">No chapter packs loaded.</div>;
  }

  if (!stateLoaded) {
    return <div className="card">Loading progress...</div>;
  }

  if (!missionData) {
    return (
      <div className="card">
        Mission not found. <Link href={'/map' as Route}>Back to map</Link>
      </div>
    );
  }

  const lesson = lessons.find((item) => item.pack_id === missionData.pack.pack_id);
  if (requireLessons && lesson) {
    const lessonProgress = state.lessonProgress[missionData.pack.pack_id] ?? { completedPages: [], checkResults: {}, xp: 0 };
    const completedPages = new Set(lessonProgress.completedPages);
    const modulesComplete = lesson.modules.every((module) => module.pages.every((page) => completedPages.has(page.id)));
    const lessonTags = getLessonTagSet(lesson);
    const masteryAverage = lessonTags.size
      ? Math.round(Array.from(lessonTags).reduce((sum, tag) => sum + (state.masteryByTag[tag] ?? 50), 0) / lessonTags.size)
      : 0;
    const lessonUnlocked = modulesComplete || masteryAverage >= MASTERY_THRESHOLD;
    if (!lessonUnlocked) {
      return (
        <div className="card">
          <div className="tag">Lessons required</div>
          <h2 style={{ marginTop: 6 }}>Complete lesson modules first</h2>
          <p style={{ color: 'var(--muted)' }}>Finish the lesson pages for this chapter or reach mastery {MASTERY_THRESHOLD}+ on the lesson tags to unlock missions.</p>
          <Link href={`/chapter/${missionData.pack.pack_id}` as Route} className="button secondary">Go to lessons</Link>
        </div>
      );
    }
  }

  if (missionData.questions.length === 0) {
    return <div className="card">No questions found for this mission.</div>;
  }

  if (completed) {
    const runQuestionIds = new Set(missionData.questions.map((question) => question.id));
    const mistakeCards = state.mistakeCards.filter((card) => runQuestionIds.has(card.question_id));
    const questionMap = new Map(missionData.questions.map((q) => [q.id, q]));
    const now = new Date();

    const handleRetry = (cardId: string, retryResult: { correct: boolean; unsure: boolean }) => {
      updateState((prev) => {
        const card = prev.mistakeCards.find((item) => item.id === cardId);
        if (!card) return prev;
        const question = questionMap.get(card.question_id);
        let next = { ...prev };

        const reviewResult = retryResult.correct
          ? (retryResult.unsure ? 'correct_unsure' : 'correct_confident')
          : 'wrong';
        const updatedCard = applyMistakeReview(card, reviewResult, now);
        next = {
          ...next,
          mistakeCards: next.mistakeCards.map((item) => (item.id === cardId ? updatedCard : item))
        };

        if (question) {
          const prevStat = next.questionStats[question.id];
          const effectiveCorrect = retryResult.correct && !retryResult.unsure;
          const firstCorrect = !prevStat || prevStat.correct === 0;
          const stat = updateQuestionStat(prevStat, effectiveCorrect, now);
          next = {
            ...next,
            questionStats: { ...next.questionStats, [question.id]: stat }
          };
          next = updateMasteryByTags(next, question.tags, effectiveCorrect, firstCorrect && effectiveCorrect);
        }

        return next;
      });
    };

    return (
      <div className="grid" style={{ gap: 16 }}>
        <div className="card">
          <div className="tag">Campaign Complete</div>
          <h1>{missionData.title}</h1>
          <p style={{ color: 'var(--muted)' }}>Mission complete. Head back to the map or jump into roguelike practice.</p>
          <div className="flex">
            <Link href={'/map' as Route} className="button">Back to map</Link>
            <Link href={'/roguelike' as Route} className="button secondary">Roguelike mode</Link>
          </div>
        </div>

        <div className="card">
          <div className="panel-header">
            <b>Mistake Cards</b>
            <span className="tag">wrong or unsure</span>
          </div>
          <div className="grid" style={{ gap: 12 }}>
            {mistakeCards.length === 0 && <div style={{ color: 'var(--muted)' }}>No mistake cards for this mission.</div>}
            {mistakeCards.map((card) => (
              <MistakeCardItem
                key={card.id}
                card={card}
                question={questionMap.get(card.question_id)}
                pack={missionData.pack}
                onRetry={handleRetry}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <QuestionFlow
      pack={missionData.pack}
      questions={missionData.questions}
      mode="campaign"
      title={missionData.title}
      subtitle={missionData.subtitle}
      sessionKey={`mission:${missionId}`}
      stateBridge={{ state, updateState, loaded: stateLoaded }}
      onComplete={() => {
        setCompleted(true);
      }}
    />
  );
}
