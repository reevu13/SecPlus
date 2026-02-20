'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import QuestionFlow from '@/components/QuestionFlow';
import { usePacks } from '@/lib/usePacks';
import { useLocalState } from '@/lib/useLocalState';
import { generateRunPlan } from '@/lib/runEngine';
import { expandStoredRun, getStoredRun, storeRunPlan } from '@/lib/runStorage';
import { storeRunResult } from '@/lib/runResults';
import { RunHistoryItem, RunQuestionResult } from '@/lib/types';
import { buildRuntimeConfig, parseRoguelikeQueryParams } from '@/lib/roguelikeConfig';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function RoguelikeRunPage() {
  const router = useRouter();
  const { packs, loaded } = usePacks();
  const { state, updateState, loaded: stateLoaded } = useLocalState();
  const [seed, setSeed] = useState('');
  const [focusTags, setFocusTags] = useState<string[]>([]);
  const [requestedChapterScope, setRequestedChapterScope] = useState<string[]>([]);
  const [runtimeMinutes, setRuntimeMinutes] = useState(90);
  const [minutesPerQuestion, setMinutesPerQuestion] = useState(1);
  const focusKey = focusTags.join(',');
  const [secondsLeft, setSecondsLeft] = useState(90 * 60);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const config = parseRoguelikeQueryParams(new URLSearchParams(window.location.search));
    setSeed(config.seed);
    setFocusTags(config.focusTags);
    setRequestedChapterScope(config.chapterScope);
    setRuntimeMinutes(config.runtime.runtimeMinutes);
    setMinutesPerQuestion(config.runtime.minutesPerQuestion);
  }, []);

  const chapterScopedPacks = useMemo(() => {
    if (requestedChapterScope.length === 0) return packs;
    const selectedSet = new Set(requestedChapterScope);
    return packs.filter((pack) => selectedSet.has(pack.pack_id));
  }, [packs, requestedChapterScope]);

  const chapterScope = useMemo(
    () => chapterScopedPacks
      .map((pack) => pack.pack_id)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })),
    [chapterScopedPacks]
  );
  const chapterScopeKey = chapterScope.join(',');
  const runtimeConfig = buildRuntimeConfig(runtimeMinutes, minutesPerQuestion);
  const targetCount = runtimeConfig.targetQuestionCount;

  const plan = useMemo(() => {
    if (!loaded || !stateLoaded || !seed || chapterScopedPacks.length === 0) return null;
    const stored = getStoredRun(seed, focusTags, chapterScope, {
      runtimeMinutes: runtimeConfig.runtimeMinutes,
      minutesPerQuestion: runtimeConfig.minutesPerQuestion,
      targetCount
    });
    if (stored) return expandStoredRun(stored, chapterScopedPacks);
    const generated = generateRunPlan(
      chapterScopedPacks,
      state.masteryByTag,
      seed,
      targetCount,
      focusTags,
      {
        runtimeMinutes: runtimeConfig.runtimeMinutes,
        minutesPerQuestion: runtimeConfig.minutesPerQuestion
      }
    );
    storeRunPlan(generated);
    return generated;
  }, [
    loaded,
    stateLoaded,
    seed,
    chapterScopedPacks,
    chapterScope,
    state.masteryByTag,
    focusTags,
    runtimeConfig.runtimeMinutes,
    runtimeConfig.minutesPerQuestion,
    targetCount
  ]);
  const packIdMap = useMemo(() => {
    if (!plan) return new Map<string, string>();
    return new Map(plan.questions.map((item) => [item.question.id, item.packId]));
  }, [plan]);
  const packById = useMemo(() => new Map(packs.map((item) => [item.pack_id, item])), [packs]);

  useEffect(() => {
    setSecondsLeft(runtimeConfig.runtimeMinutes * 60);
  }, [runtimeConfig.runtimeMinutes]);

  useEffect(() => {
    if (!seed) return;
    const timer = setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [seed]);

  if (!seed) {
    return <div className="card">Missing seed. Return to <Link href={'/roguelike' as Route}>Roguelike start</Link>.</div>;
  }

  if (!plan) {
    if (loaded && packs.length === 0) {
      return <div className="card">No chapter packs available.</div>;
    }
    if (loaded && packs.length > 0 && chapterScopedPacks.length === 0) {
      return <div className="card">No chapters match your selected scope. Go back and choose at least one chapter.</div>;
    }
    return <div className="card">Generating run...</div>;
  }

  const pack = chapterScopedPacks.find((p) => p.pack_id === plan.questions[0]?.packId) ?? chapterScopedPacks[0];

  if (!pack) {
    return <div className="card">No chapter packs available.</div>;
  }

  if (plan.questions.length === 0) {
    return <div className="card">No questions available for this run.</div>;
  }

  const handleComplete = (results: RunQuestionResult[]) => {
    if (!pack) return;
    const xpRules = pack.progression.xp_rules;
    const correct = results.filter((r) => r.correct).length;
    const unsure = results.filter((r) => r.unsure).length;
    const incorrect = results.length - correct;
    const xp = results.reduce((sum, r) => {
      if (r.correct && !r.unsure) {
        const bonus = r.time_ms <= xpRules.time_bonus_threshold_seconds * 1000 ? xpRules.time_bonus_xp : 0;
        return sum + xpRules.base_xp_per_correct + bonus;
      }
      if (r.correct && r.unsure) return sum + Math.round(xpRules.base_xp_per_correct * 0.4);
      return sum;
    }, 0);

    storeRunResult({
      seed,
      ended_at: new Date().toISOString(),
      total: results.length,
      correct,
      incorrect,
      unsure,
      xp,
      results
    });

    const history: RunHistoryItem = {
      id: `${seed}_${Date.now()}`,
      seed,
      mode: 'roguelike',
      started_at: new Date(Date.now() - 1000 * (runtimeConfig.runtimeMinutes * 60 - secondsLeft)).toISOString(),
      ended_at: new Date().toISOString(),
      total: results.length,
      correct,
      incorrect,
      unsure,
      xp,
      weak_tags: plan.weakTags
    };

    updateState((prev) => ({
      ...prev,
      runHistory: [history, ...prev.runHistory].slice(0, 20)
    }));

    router.push(`/roguelike/results?seed=${seed}` as Route);
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="tag">Seed {seed}</div>
          <h2 style={{ margin: '6px 0' }}>Roguelike Run</h2>
          <p style={{ color: 'var(--muted)' }}>Weighted by weak tags: {plan.weakTags.join(', ') || 'baseline'}</p>
          {focusTags.length > 0 && (
            <p style={{ color: 'var(--muted)', marginTop: 6 }}>
              Focus filter: {focusTags.join(', ')}
            </p>
          )}
          {chapterScope.length > 0 && (
            <p style={{ color: 'var(--muted)', marginTop: 6 }}>
              Chapters: {chapterScope.join(', ')}
            </p>
          )}
          <div className="flex" style={{ marginTop: 8 }}>
            <div className="stat-pill">Questions: {plan.questions.length}</div>
            <div className="stat-pill">Timer: {formatTime(secondsLeft)}</div>
            <div className="stat-pill">Runtime: {runtimeConfig.runtimeMinutes} min</div>
            <div className="stat-pill">Pace: {runtimeConfig.minutesPerQuestion} min/question</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="chip">Exam Mode</div>
          <div style={{ color: secondsLeft < 300 ? 'var(--danger)' : 'var(--muted)', marginTop: 8 }}>Time remaining</div>
        </div>
      </div>

      {secondsLeft === 0 && (
        <div className="card" style={{ borderColor: 'rgba(255,123,123,0.6)' }}>
          <div className="tag">Time</div>
          <div style={{ color: 'var(--danger)' }}>Time is up. Finish the current question and review your results.</div>
        </div>
      )}

      <QuestionFlow
        pack={pack}
        questions={plan.questions.map((item) => item.question)}
        mode="roguelike"
        title="Roguelike Practice"
        subtitle="No hints. One-sentence justification required for full points."
        sessionKey={`roguelike:${seed}:${chapterScopeKey || 'all'}:${focusKey || 'none'}`}
        stateBridge={{ state, updateState, loaded: stateLoaded }}
        onComplete={handleComplete}
        resolvePackId={(questionId) => packIdMap.get(questionId) ?? pack.pack_id}
        resolvePack={(questionId) => {
          const packId = packIdMap.get(questionId);
          return packId ? packById.get(packId) : pack;
        }}
      />
    </div>
  );
}
