'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePacks } from '@/lib/usePacks';
import { useLocalState } from '@/lib/useLocalState';
import { applyMistakeReview, updateMasteryByTags, updateQuestionStat } from '@/lib/progress';
import { getRunResult } from '@/lib/runResults';
import MistakeCardItem from '@/components/MistakeCardItem';

export default function RoguelikeResultsPage() {
  const [seed, setSeed] = useState('');
  const { packs } = usePacks();
  const { state, updateState } = useLocalState();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setSeed((params.get('seed') || '').trim());
  }, []);

  const result = useMemo(() => (seed ? getRunResult(seed) : null), [seed]);

  const questionMap = useMemo(() => {
    const map = new Map<string, { packId: string; question: any }>();
    packs.forEach((pack) => {
      pack.question_bank.forEach((q) => {
        map.set(q.id, { packId: pack.pack_id, question: q });
      });
    });
    return map;
  }, [packs]);

  if (!seed) {
    return <div className="card">Missing run seed. Return to <Link href={'/roguelike' as Route}>Roguelike</Link>.</div>;
  }

  if (!result) {
    return <div className="card">Run results not found yet. Finish the run first.</div>;
  }

  const mistakeIds = result.results.filter((r) => !r.correct || r.unsure).map((r) => r.question_id);
  const mistakeCards = state.mistakeCards.filter((card) => mistakeIds.includes(card.question_id));
  const now = new Date();

  const handleRetry = (cardId: string, retryResult: { correct: boolean; unsure: boolean }) => {
    updateState((prev) => {
      const card = prev.mistakeCards.find((item) => item.id === cardId);
      if (!card) return prev;
      const mapped = questionMap.get(card.question_id);
      const question = mapped?.question;
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
        <div className="tag">Debrief</div>
        <h1 style={{ marginBottom: 6 }}>Run Results</h1>
        <div className="flex" style={{ marginTop: 8 }}>
          <div className="stat-pill">Seed {seed}</div>
          <div className="stat-pill">Score {result.correct}/{result.total}</div>
          <div className="stat-pill">Incorrect {result.incorrect}</div>
          <div className="stat-pill">Unsure {result.unsure}</div>
          <div className="stat-pill">XP {result.xp}</div>
        </div>
        <div className="flex" style={{ marginTop: 12 }}>
          <Link href={'/roguelike' as Route} className="button">Start another run</Link>
          <Link href={'/review' as Route} className="button secondary">Review mistake cards</Link>
        </div>
      </div>

      <div className="card">
        <div className="panel-header">
          <b>Mistake Cards</b>
          <span className="tag">wrong or unsure</span>
        </div>
        <div className="grid" style={{ gap: 12 }}>
          {mistakeCards.length === 0 && <div style={{ color: 'var(--muted)' }}>No mistake cards this run. Nice work.</div>}
          {mistakeCards.map((card) => {
            const info = questionMap.get(card.question_id);
            const pack = packs.find((p) => p.pack_id === card.pack_id);
            return (
              <MistakeCardItem
                key={card.id}
                card={card}
                question={info?.question}
                pack={pack}
                onRetry={handleRetry}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
