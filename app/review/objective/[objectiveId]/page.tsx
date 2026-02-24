'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useParams, useSearchParams } from 'next/navigation';
import QuestionFlow from '@/components/QuestionFlow';
import { useLocalState } from '@/lib/useLocalState';
import { useObjectives } from '@/lib/useObjectives';
import { usePacks } from '@/lib/usePacks';
import { Question, QuestionStat, RunQuestionResult } from '@/lib/types';

const MAX_DRILL_QUESTIONS = 18;
const VALID_TYPES: Question['type'][] = ['mcq', 'multi_select', 'matching', 'ordering'];
const VALID_ACTIVITY = new Set(['lesson_quick_check', 'easier_interactive', 'scenario_matching', 'mixed_mini']);

function normalizeTags(value: string | null) {
  if (!value) return [];
  return [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function normalizeTypes(value: string | null) {
  if (!value) return [] as Question['type'][];
  const candidates = value.split(',').map((item) => item.trim()).filter(Boolean);
  const filtered = candidates.filter((item): item is Question['type'] => VALID_TYPES.includes(item as Question['type']));
  return [...new Set(filtered)];
}

function isScenarioQuestion(question: Question) {
  const legacyType = question.legacyType?.toLowerCase() ?? '';
  if (legacyType.includes('scenario')) return true;
  return question.stem.trim().toLowerCase().startsWith('scenario:');
}

function recencyPenalty(lastAnswered: string | undefined) {
  if (!lastAnswered) return 1;
  const answeredMs = Date.parse(lastAnswered);
  if (Number.isNaN(answeredMs)) return 0.7;
  const days = Math.max(0, (Date.now() - answeredMs) / (24 * 60 * 60 * 1000));
  return Math.min(1, days / 21);
}

function questionPriority(question: Question, stat: QuestionStat | undefined) {
  const difficulty = question.difficulty ?? 3;
  if (!stat || stat.attempts <= 0) return 1.4 + difficulty * 0.05;
  const wrongRate = Math.max(0, (stat.attempts - stat.correct) / stat.attempts);
  const staleWeight = recencyPenalty(stat.lastAnswered);
  const typeBoost = question.type === 'matching' || question.type === 'ordering' ? 0.08 : 0;
  return wrongRate * 1.5 + staleWeight * 0.6 + typeBoost;
}

export default function ObjectiveDrillPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const { packs, loaded: packsLoaded } = usePacks();
  const { doc: objectivesDoc, loaded: objectivesLoaded } = useObjectives();
  const { state, updateState, loaded: stateLoaded } = useLocalState();
  const [results, setResults] = useState<RunQuestionResult[] | null>(null);

  const rawObjectiveId = Array.isArray(params?.objectiveId) ? params.objectiveId[0] : (params?.objectiveId ?? '');
  const objectiveId = decodeURIComponent(rawObjectiveId).trim();
  const packIdFilter = searchParams?.get('packId')?.trim() ?? '';
  const outlineId = searchParams?.get('outlineId')?.trim() ?? '';
  const sectionTitle = searchParams?.get('sectionTitle')?.trim() ?? '';
  const sectionHref = searchParams?.get('sectionHref')?.trim() ?? '';
  const tagFilter = normalizeTags(searchParams?.get('tags') ?? null);
  const activity = searchParams?.get('activity')?.trim() ?? '';
  const selectedTypes = normalizeTypes(searchParams?.get('types') ?? null);
  const parsedLimit = Number.parseInt(searchParams?.get('limit') ?? '', 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(MAX_DRILL_QUESTIONS, parsedLimit)
    : MAX_DRILL_QUESTIONS;
  const parsedMaxDifficulty = Number.parseInt(searchParams?.get('maxDifficulty') ?? '', 10);
  const maxDifficulty = Number.isFinite(parsedMaxDifficulty) && parsedMaxDifficulty >= 1 && parsedMaxDifficulty <= 5
    ? parsedMaxDifficulty
    : null;
  const preferScenario = searchParams?.get('preferScenario') === '1';
  const planId = searchParams?.get('planId')?.trim() ?? '';

  const filteredPacks = useMemo(() => {
    if (!packIdFilter) return packs;
    return packs.filter((pack) => pack.pack_id === packIdFilter);
  }, [packs, packIdFilter]);

  const drillEntries = useMemo(() => {
    const tagSet = new Set(tagFilter);
    const hasTagFilter = tagSet.size > 0;
    const activeTypes = selectedTypes.length > 0 ? new Set(selectedTypes) : null;

    const baseEntries = filteredPacks.flatMap((pack) =>
      pack.question_bank
        .filter((question) => question.objectiveIds.includes(objectiveId))
        .filter((question) => {
          if (!hasTagFilter) return true;
          return question.tags.some((tag) => tagSet.has(tag));
        })
        .map((question) => ({ pack, question }))
    );

    const typeFiltered = activeTypes
      ? baseEntries.filter((entry) => activeTypes.has(entry.question.type))
      : baseEntries;
    const difficultyFiltered = maxDifficulty
      ? typeFiltered.filter((entry) => (entry.question.difficulty ?? 3) <= maxDifficulty)
      : typeFiltered;
    const activityEntries = difficultyFiltered.length > 0 ? difficultyFiltered : (typeFiltered.length > 0 ? typeFiltered : baseEntries);

    const sorted = [...activityEntries].sort((a, b) => {
      if (preferScenario) {
        const scenarioDelta = Number(isScenarioQuestion(b.question)) - Number(isScenarioQuestion(a.question));
        if (scenarioDelta !== 0) return scenarioDelta;
      }
      const delta = questionPriority(b.question, state.questionStats[b.question.id])
        - questionPriority(a.question, state.questionStats[a.question.id]);
      if (delta !== 0) return delta;
      return a.question.id.localeCompare(b.question.id, undefined, { numeric: true, sensitivity: 'base' });
    });

    if (activity === 'mixed_mini' && sorted.length > 0) {
      const buckets = new Map<Question['type'], typeof sorted>();
      sorted.forEach((entry) => {
        const bucket = buckets.get(entry.question.type) ?? [];
        bucket.push(entry);
        buckets.set(entry.question.type, bucket);
      });
      const typeOrder: Question['type'][] = ['matching', 'ordering', 'multi_select', 'mcq'];
      const mixed: typeof sorted = [];
      const used = new Set<string>();
      while (mixed.length < Math.min(limit, sorted.length)) {
        let picked = false;
        for (const type of typeOrder) {
          const bucket = buckets.get(type);
          if (!bucket || bucket.length === 0) continue;
          while (bucket.length > 0 && used.has(bucket[0].question.id)) {
            bucket.shift();
          }
          if (bucket.length === 0) continue;
          const next = bucket.shift();
          if (!next) continue;
          mixed.push(next);
          used.add(next.question.id);
          picked = true;
          if (mixed.length >= Math.min(limit, sorted.length)) break;
        }
        if (!picked) break;
      }
      if (mixed.length < Math.min(limit, sorted.length)) {
        mixed.push(...sorted.filter((entry) => !used.has(entry.question.id)).slice(0, Math.min(limit, sorted.length) - mixed.length));
      }
      return mixed;
    }

    return sorted.slice(0, Math.min(limit, sorted.length));
  }, [filteredPacks, objectiveId, tagFilter, selectedTypes, maxDifficulty, preferScenario, activity, limit, state.questionStats]);

  const objectiveTitle = useMemo(
    () => objectivesDoc?.objectives.find((objective) => objective.id === objectiveId)?.title ?? 'Objective drill',
    [objectivesDoc, objectiveId]
  );

  const questionPackMap = useMemo(() => {
    const map = new Map<string, string>();
    drillEntries.forEach((entry) => map.set(entry.question.id, entry.pack.pack_id));
    return map;
  }, [drillEntries]);

  const packById = useMemo(() => new Map(packs.map((pack) => [pack.pack_id, pack])), [packs]);
  const primaryPack = drillEntries[0]?.pack ?? filteredPacks[0] ?? packs[0];

  if (!packsLoaded || !objectivesLoaded || !stateLoaded) {
    return <div className="card">Loading objective drill...</div>;
  }

  if (!objectiveId) {
    return (
      <div className="card">
        Missing objective ID. <Link href={'/review' as Route}>Back to review</Link>
      </div>
    );
  }

  if (!primaryPack) {
    return (
      <div className="card">
        No chapter packs loaded. <Link href={'/map' as Route}>Back to map</Link>
      </div>
    );
  }

  if (drillEntries.length === 0) {
    return (
      <div className="card">
        <div className="tag">Objective Drill</div>
        <h1 style={{ marginTop: 8 }}>No questions available</h1>
        <p style={{ color: 'var(--muted)' }}>
          Objective {objectiveId} currently has no matching questions for this filter.
        </p>
        <div className="flex">
          <Link href={'/review' as Route} className="button">Back to review</Link>
          <Link href={'/review/coverage' as Route} className="button secondary">Coverage report</Link>
        </div>
      </div>
    );
  }

  if (results) {
    const correct = results.filter((result) => result.correct).length;
    const unsure = results.filter((result) => result.unsure).length;
    const total = results.length;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

    return (
      <div className="grid" style={{ gap: 16 }}>
        <div className="card">
          <div className="tag">Objective Drill Complete</div>
          <h1 style={{ marginTop: 8 }}>Objective {objectiveId}</h1>
          <p style={{ color: 'var(--muted)' }}>{objectiveTitle}</p>
          <div className="flex" style={{ marginTop: 10 }}>
            <div className="stat-pill">Questions {total}</div>
            <div className="stat-pill">Accuracy {accuracy}%</div>
            <div className="stat-pill">Unsure {unsure}</div>
          </div>
          <div className="flex" style={{ marginTop: 12 }}>
            <Link href={'/review' as Route} className="button">Back to review</Link>
            <button className="button secondary" onClick={() => setResults(null)}>Run again</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="tag">Interactive objective set</div>
        <h1 style={{ marginTop: 8 }}>
          Objective {objectiveId}: {objectiveTitle}
        </h1>
        <p style={{ color: 'var(--muted)' }}>
          Adaptive queue ranked by weak history (wrong rate + recency). Questions include full explanations and rationales.
        </p>
        <div className="flex" style={{ marginTop: 10 }}>
          <div className="stat-pill">Questions {drillEntries.length}</div>
          {activity && VALID_ACTIVITY.has(activity) && <div className="stat-pill">Activity {activity}</div>}
          {packIdFilter && <div className="stat-pill">Pack {packIdFilter}</div>}
          {tagFilter.length > 0 && <div className="stat-pill">Tags {tagFilter.join(', ')}</div>}
          {selectedTypes.length > 0 && <div className="stat-pill">Types {selectedTypes.join(', ')}</div>}
          {maxDifficulty && <div className="stat-pill">Max difficulty {maxDifficulty}</div>}
          {preferScenario && <div className="stat-pill">Scenario priority</div>}
          {planId && <div className="stat-pill">Plan {planId}</div>}
          {outlineId && <div className="stat-pill">Outline {outlineId}</div>}
        </div>
        {sectionTitle && (
          <div className="answer-card" style={{ marginTop: 10 }}>
            <div className="tag">Mapped outline section</div>
            <div style={{ fontWeight: 700, marginTop: 4 }}>{sectionTitle}</div>
            {sectionHref && <div style={{ color: 'var(--muted)', marginTop: 4 }}><code>{sectionHref}</code></div>}
          </div>
        )}
      </div>

      <QuestionFlow
        pack={primaryPack}
        questions={drillEntries.map((entry) => entry.question)}
        mode="campaign"
        title={`Objective ${objectiveId} drill`}
        subtitle="Targeted remediation sequence."
        sessionKey={`objective:${objectiveId}:${packIdFilter || 'all'}:${tagFilter.join('|') || 'all'}`}
        stateBridge={{ state, updateState, loaded: stateLoaded }}
        resolvePackId={(questionId) => questionPackMap.get(questionId) ?? primaryPack.pack_id}
        resolvePack={(questionId) => {
          const packId = questionPackMap.get(questionId);
          return packId ? packById.get(packId) : primaryPack;
        }}
        onComplete={(nextResults) => setResults(nextResults)}
      />
    </div>
  );
}
