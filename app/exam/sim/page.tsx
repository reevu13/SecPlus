'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import QuestionFlow from '@/components/QuestionFlow';
import {
  buildNextBestActivityPlan,
  computeMisconceptionMastery,
  computeMisconceptionPriority,
  computeObjectiveMastery
} from '@/lib/adaptiveSequencing';
import {
  computeExamObjectiveBreakdown,
  createExamSeed,
  examScorePercent,
  generateExamSimulationPlan,
  getExamSimulationConfig,
  weakestObjectiveIdsFromBreakdown,
  type ExamSimulationPlan
} from '@/lib/examSim';
import {
  clearActiveExamPlan,
  expandStoredActiveExamPlan,
  getLatestExamSimResult,
  storeActiveExamPlan,
  storeExamSimResult,
  type StoredExamSimResult
} from '@/lib/examSimStorage';
import type { OutlineMapDoc } from '@/lib/coverage';
import type { RunHistoryItem, RunQuestionResult } from '@/lib/types';
import { useLessons } from '@/lib/useLessons';
import { useLocalState } from '@/lib/useLocalState';
import { useObjectives } from '@/lib/useObjectives';
import { usePacks } from '@/lib/usePacks';

function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function domainSort(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export default function ExamSimulationPage() {
  const examConfig = getExamSimulationConfig();
  const { packs, loaded: packsLoaded } = usePacks();
  const { lessons } = useLessons();
  const { doc: objectivesDoc, loaded: objectivesLoaded } = useObjectives();
  const { state, updateState, loaded: stateLoaded } = useLocalState();
  const [plan, setPlan] = useState<ExamSimulationPlan | null>(null);
  const [result, setResult] = useState<StoredExamSimResult | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [restored, setRestored] = useState(false);
  const [outlineMapDoc, setOutlineMapDoc] = useState<OutlineMapDoc | null>(null);
  const finalizeLockRef = useRef(false);

  const sessionKey = plan ? `exam:${plan.id}` : null;

  const packById = useMemo(() => new Map(packs.map((pack) => [pack.pack_id, pack])), [packs]);
  const questionPackById = useMemo(() => {
    if (!plan) return new Map<string, string>();
    return new Map(plan.questions.map((entry) => [entry.question.id, entry.packId]));
  }, [plan]);

  const domainTitleById = useMemo(() => {
    return new Map((objectivesDoc?.domains ?? []).map((domain) => [domain.id, domain.title]));
  }, [objectivesDoc]);

  useEffect(() => {
    const loadOutlineMap = async () => {
      try {
        const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
        const res = await fetch(`${basePath}/content/mappings/outline_map.json`, { cache: 'no-store' });
        if (!res.ok) {
          setOutlineMapDoc(null);
          return;
        }
        setOutlineMapDoc((await res.json()) as OutlineMapDoc);
      } catch {
        setOutlineMapDoc(null);
      }
    };
    loadOutlineMap();
  }, []);

  useEffect(() => {
    if (!packsLoaded || restored) return;
    const active = expandStoredActiveExamPlan(packs);
    if (active) {
      setPlan(active);
      setResult(null);
      const elapsed = Math.max(0, Math.floor((Date.now() - new Date(active.startedAt).getTime()) / 1000));
      setSecondsLeft(Math.max(0, active.durationMinutes * 60 - elapsed));
    } else {
      setResult(getLatestExamSimResult());
    }
    setRestored(true);
  }, [packs, packsLoaded, restored]);

  useEffect(() => {
    if (!plan || result) return;
    const update = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - new Date(plan.startedAt).getTime()) / 1000));
      setSecondsLeft(Math.max(0, plan.durationMinutes * 60 - elapsed));
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [plan, result]);

  const finishExam = useCallback((runResults: RunQuestionResult[], timedOut: boolean) => {
    if (!plan || !objectivesDoc) return;
    if (finalizeLockRef.current) return;
    finalizeLockRef.current = true;

    const endedAt = new Date();
    const correct = runResults.filter((entry) => entry.correct && !entry.unsure).length;
    const unsure = runResults.filter((entry) => entry.unsure).length;
    const incorrect = Math.max(0, runResults.length - correct);
    const scorePercent = examScorePercent(correct, runResults.length);
    const objectiveBreakdown = computeExamObjectiveBreakdown({
      results: runResults,
      questions: plan.questions,
      objectivesDoc
    });
    const weakestObjectiveIds = weakestObjectiveIdsFromBreakdown(objectiveBreakdown, 5);
    const elapsedSeconds = Math.max(0, Math.floor((endedAt.getTime() - new Date(plan.startedAt).getTime()) / 1000));
    const durationSeconds = Math.min(plan.durationMinutes * 60, elapsedSeconds);

    const warnings = [...plan.warnings];
    if (timedOut) warnings.push('Timer expired before all questions were submitted.');

    const persistedResult: StoredExamSimResult = {
      id: `${plan.id}-${endedAt.getTime()}`,
      seed: plan.seed,
      startedAt: plan.startedAt,
      endedAt: endedAt.toISOString(),
      total: runResults.length,
      correct,
      incorrect,
      unsure,
      scorePercent,
      durationSeconds,
      objectiveBreakdown,
      weakestObjectiveIds,
      warnings,
      results: runResults
    };

    storeExamSimResult(persistedResult);
    clearActiveExamPlan();
    setResult(persistedResult);
    setPlan(null);
    setSecondsLeft(0);

    const xp = runResults.reduce((sum, entry) => {
      const fullCredit = entry.correct && !entry.unsure;
      if (!fullCredit) return sum;
      const packId = questionPackById.get(entry.question_id);
      if (!packId) return sum;
      const pack = packById.get(packId);
      if (!pack) return sum;
      const xpRules = pack.progression.xp_rules;
      const bonus = entry.time_ms <= xpRules.time_bonus_threshold_seconds * 1000 ? xpRules.time_bonus_xp : 0;
      return sum + xpRules.base_xp_per_correct + bonus;
    }, 0);

    const history: RunHistoryItem = {
      id: `${plan.id}:${endedAt.getTime()}`,
      seed: plan.seed,
      mode: 'exam',
      started_at: plan.startedAt,
      ended_at: endedAt.toISOString(),
      total: runResults.length,
      correct,
      incorrect,
      unsure,
      xp,
      weak_tags: weakestObjectiveIds.map((objectiveId) => `objective:${objectiveId}`)
    };

    updateState((previous) => {
      const nextActiveSessions = { ...previous.activeSessions };
      if (sessionKey) delete nextActiveSessions[sessionKey];
      return {
        ...previous,
        activeSessions: nextActiveSessions,
        runHistory: [history, ...previous.runHistory].slice(0, 50)
      };
    });

  }, [objectivesDoc, packById, plan, questionPackById, sessionKey, updateState]);

  useEffect(() => {
    if (!plan || result) return;
    if (secondsLeft > 0) return;
    if (!sessionKey) return;
    const partialResults = state.activeSessions[sessionKey]?.results ?? [];
    finishExam(partialResults, true);
  }, [finishExam, plan, result, secondsLeft, sessionKey, state.activeSessions]);

  const objectiveMastery = useMemo(() => {
    if (!objectivesDoc) return null;
    return computeObjectiveMastery(objectivesDoc, packs, state, new Date());
  }, [objectivesDoc, packs, state]);

  const recommendations = useMemo(() => {
    if (!result || !objectivesDoc || !objectiveMastery) return [];
    const misconceptionMastery = computeMisconceptionMastery(packs, state, new Date());
    const misconceptionPriority = computeMisconceptionPriority(state, objectiveMastery.rows, misconceptionMastery.rows, new Date());

    const rowByObjectiveId = new Map(objectiveMastery.rows.map((row) => [row.objectiveId, row]));
    const fallbackWeakest = objectiveMastery.sortedWeakest;
    const targetObjectiveIds = result.weakestObjectiveIds.length > 0
      ? result.weakestObjectiveIds
      : fallbackWeakest.slice(0, 5).map((row) => row.objectiveId);

    const plans = [];
    const seenObjectives = new Set<string>();

    for (const objectiveId of targetObjectiveIds) {
      const targetRow = rowByObjectiveId.get(objectiveId);
      if (!targetRow) continue;
      const rankedRows = [targetRow, ...fallbackWeakest.filter((row) => row.objectiveId !== objectiveId)];
      const plan = buildNextBestActivityPlan({
        weakestObjectives: rankedRows,
        misconceptionPriority,
        outlineMap: outlineMapDoc,
        packs,
        lessons,
        state,
        now: new Date()
      });
      if (!plan) continue;
      if (seenObjectives.has(plan.objectiveId)) continue;
      plans.push(plan);
      seenObjectives.add(plan.objectiveId);
      if (plans.length >= 3) break;
    }

    if (plans.length === 0) {
      const fallbackPlan = buildNextBestActivityPlan({
        weakestObjectives: fallbackWeakest,
        misconceptionPriority,
        outlineMap: outlineMapDoc,
        packs,
        lessons,
        state,
        now: new Date()
      });
      if (fallbackPlan) plans.push(fallbackPlan);
    }

    return plans;
  }, [lessons, objectiveMastery, objectivesDoc, outlineMapDoc, packs, result, state]);

  const startSimulation = () => {
    if (!packsLoaded || !stateLoaded || !objectivesLoaded || !objectivesDoc) return;
    finalizeLockRef.current = false;
    const nextPlan = generateExamSimulationPlan({
      packs,
      objectivesDoc,
      state,
      seed: createExamSeed(),
      now: new Date()
    });
    if (nextPlan.questions.length === 0) return;
    storeActiveExamPlan(nextPlan);
    setPlan(nextPlan);
    setResult(null);
    setSecondsLeft(nextPlan.durationMinutes * 60);
  };

  const abandonSimulation = () => {
    finalizeLockRef.current = false;
    clearActiveExamPlan();
    setPlan(null);
    setSecondsLeft(0);
    setResult(getLatestExamSimResult());
    if (!sessionKey) return;
    updateState((previous) => {
      const nextActiveSessions = { ...previous.activeSessions };
      delete nextActiveSessions[sessionKey];
      return { ...previous, activeSessions: nextActiveSessions };
    });
  };

  if (!packsLoaded || !stateLoaded || !objectivesLoaded) {
    return <div className="card">Loading exam simulator...</div>;
  }

  if (!objectivesDoc) {
    return (
      <div className="card">
        <div className="tag">Exam Simulator</div>
        <h1 style={{ marginBottom: 8 }}>Objective metadata missing</h1>
        <p style={{ color: 'var(--muted)' }}>
          Exam simulation needs the SY0-701 objectives file to balance domains.
        </p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="panel-header">
          <div>
            <div className="tag">Exam Simulation</div>
            <h1 style={{ margin: '8px 0 0' }}>Security+ {objectivesDoc.exam_code} Simulator</h1>
          </div>
          <div className="flex">
            <Link href={'/review' as Route} className="button secondary">Review</Link>
            <Link href={'/map' as Route} className="button secondary">Campaign map</Link>
          </div>
        </div>
        <p style={{ color: 'var(--muted)', marginTop: 10 }}>
          Full-length simulation: {examConfig.total_questions} questions in {examConfig.duration_minutes} minutes,
          balanced by objective-domain weights.
        </p>
        <div className="flex" style={{ marginTop: 12 }}>
          <div className="stat-pill">Scenario minimum {examConfig.min_scenario_questions}</div>
          <div className="stat-pill">Interactive minimum {examConfig.min_interactive_questions}</div>
          <div className="stat-pill">Objectives {objectivesDoc.objectives.length}</div>
          <div className="stat-pill">Question pool {packs.reduce((sum, pack) => sum + pack.question_bank.length, 0)}</div>
        </div>
      </div>

      {!plan && (
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <div className="panel-header">
            <div>
              <b>Start a simulation</b>
              <div style={{ color: 'var(--muted)', marginTop: 4 }}>
                Includes scenario and interactive questions where available.
              </div>
            </div>
            <button className="button" onClick={startSimulation}>Start 90-question exam</button>
          </div>

          <div className="grid" style={{ gap: 8 }}>
            {examConfig.domain_weights
              .slice()
              .sort((a, b) => domainSort(a.domain_id, b.domain_id))
              .map((rule) => (
                <div key={rule.domain_id} className="answer-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>Domain {rule.domain_id}: {domainTitleById.get(rule.domain_id) ?? 'Unknown domain'}</span>
                  <span className="chip">{Math.round(rule.weight * 100)}%</span>
                </div>
              ))}
          </div>

          {result && (
            <div className="answer-card">
              <div className="panel-header">
                <b>Latest simulation</b>
                <span className="chip">{new Date(result.endedAt).toLocaleString()}</span>
              </div>
              <div className="flex" style={{ marginTop: 8 }}>
                <div className="stat-pill">Score {result.scorePercent}%</div>
                <div className="stat-pill">Correct {result.correct}/{result.total}</div>
                <div className="stat-pill">Duration {formatClock(result.durationSeconds)}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {plan && (
        <>
          <div className="card">
            <div className="panel-header">
              <div>
                <div className="tag">Exam in progress</div>
                <h2 style={{ margin: '8px 0 0' }}>Seed {plan.seed}</h2>
              </div>
              <div className="flex">
                <div className="stat-pill">Timer {formatClock(secondsLeft)}</div>
                <div className="stat-pill">Q {plan.questions.length}</div>
                <button className="button secondary" onClick={abandonSimulation}>Abort</button>
              </div>
            </div>
            <div className="grid" style={{ gap: 8, marginTop: 10 }}>
              {Object.entries(plan.domainTargets)
                .sort(([left], [right]) => domainSort(left, right))
                .map(([domainId, target]) => {
                  const actual = plan.domainActual[domainId] ?? 0;
                  const title = domainTitleById.get(domainId) ?? 'Unknown domain';
                  return (
                    <div key={domainId} className="answer-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <span>Domain {domainId} · {title}</span>
                      <span className="chip">{actual}/{target}</span>
                    </div>
                  );
                })}
            </div>
            {plan.warnings.length > 0 && (
              <div className="answer-card" style={{ marginTop: 10, borderColor: 'rgba(255, 195, 107, 0.45)' }}>
                <div className="tag">Coverage notes</div>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--muted)' }}>
                  {plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            )}
          </div>

          <QuestionFlow
            pack={packById.get(plan.questions[0]?.packId ?? '') ?? packs[0]}
            questions={plan.questions.map((entry) => entry.question)}
            mode="exam"
            title="Security+ Exam Simulation"
            subtitle="Timed full-length run. No hints, no coaching overlays."
            sessionKey={sessionKey ?? undefined}
            stateBridge={{ state, updateState, loaded: stateLoaded }}
            onComplete={(runResults) => finishExam(runResults, false)}
            resolvePackId={(questionId) => questionPackById.get(questionId) ?? packs[0]?.pack_id ?? ''}
            resolvePack={(questionId) => {
              const packId = questionPackById.get(questionId);
              return packId ? packById.get(packId) : packs[0];
            }}
          />
        </>
      )}

      {result && !plan && (
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <div className="panel-header">
            <div>
              <div className="tag">Simulation complete</div>
              <h2 style={{ margin: '8px 0 0' }}>Score {result.scorePercent}%</h2>
            </div>
            <button className="button" onClick={startSimulation}>Run another simulation</button>
          </div>

          <div className="flex">
            <div className="stat-pill">Correct {result.correct}/{result.total}</div>
            <div className="stat-pill">Incorrect {result.incorrect}</div>
            <div className="stat-pill">Unsure {result.unsure}</div>
            <div className="stat-pill">Duration {formatClock(result.durationSeconds)}</div>
          </div>

          {result.warnings.length > 0 && (
            <div className="answer-card" style={{ borderColor: 'rgba(255, 195, 107, 0.45)' }}>
              <div className="tag">Warnings</div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--muted)' }}>
                {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          )}

          <div className="answer-card">
            <div className="panel-header">
              <b>Breakdown by objective</b>
              <span className="chip">{result.objectiveBreakdown.length} objectives attempted</span>
            </div>
            {result.objectiveBreakdown.length === 0 ? (
              <div style={{ color: 'var(--muted)' }}>
                No objective-tagged questions were attempted, so objective breakdown is unavailable.
              </div>
            ) : (
              <div className="grid" style={{ gap: 8, marginTop: 8 }}>
                {result.objectiveBreakdown.map((row) => (
                  <div key={row.objectiveId} className="answer-card" style={{ display: 'grid', gap: 8 }}>
                    <div className="panel-header">
                      <div>
                        <div style={{ fontWeight: 700 }}>Objective {row.objectiveId}</div>
                        <div style={{ color: 'var(--muted)', fontSize: 13 }}>{row.title}</div>
                      </div>
                      <div className="chip">Accuracy {formatPercent(row.accuracy)}</div>
                    </div>
                    <div className="flex">
                      <div className="stat-pill">Attempted {row.attempted}</div>
                      <div className="stat-pill">Wrong {formatPercent(row.wrongRate)}</div>
                      <div className="stat-pill">Avg time {Math.round(row.avgTimeMs / 1000)}s</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="answer-card">
            <div className="panel-header">
              <b>Recommended next best activities</b>
              <span className="chip">Weak areas</span>
            </div>
            {recommendations.length === 0 ? (
              <div style={{ color: 'var(--muted)' }}>
                No recommendation available yet. Continue with <Link href={'/review' as Route}>Review</Link>.
              </div>
            ) : (
              <div className="grid" style={{ gap: 10, marginTop: 8 }}>
                {recommendations.map((planRecommendation) => (
                  <div key={planRecommendation.planId} className="answer-card" style={{ display: 'grid', gap: 8 }}>
                    <div className="panel-header">
                      <div>
                        <div style={{ fontWeight: 700 }}>
                          Objective {planRecommendation.objectiveId}: {planRecommendation.objectiveTitle}
                        </div>
                        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                          {planRecommendation.activityLabel}
                          {' · '}
                          Mastery {formatPercent(planRecommendation.masteryScore)}
                        </div>
                      </div>
                      <Link href={planRecommendation.href as Route} className="button">Start activity</Link>
                    </div>
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                      {planRecommendation.activityReason}
                      {planRecommendation.section ? ` · Section: ${planRecommendation.section.title}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
