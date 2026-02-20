'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePacks } from '@/lib/usePacks';
import { useLessons } from '@/lib/useLessons';
import { useLocalState } from '@/lib/useLocalState';
import {
  applyMistakeReview,
  getMistakeCardDueAt,
  isMistakeCardDue,
  updateMasteryByTags,
  updateQuestionStat
} from '@/lib/progress';
import MistakeCardItem from '@/components/MistakeCardItem';
import { useObjectives } from '@/lib/useObjectives';
import {
  buildNextBestActivityPlan,
  computeMisconceptionMastery,
  computeMisconceptionPriority,
  computeObjectiveMastery,
  storeCoachingPlan
} from '@/lib/adaptiveSequencing';
import type { OutlineMapDoc } from '@/lib/coverage';
import type { MistakeCard } from '@/lib/types';

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function primaryObjectiveKey(card: MistakeCard) {
  if (card.objectiveIds.length > 0) return `obj:${card.objectiveIds[0]}`;
  if (card.misconceptionTags.length > 0) return `mis:${card.misconceptionTags[0]}`;
  if (card.tags.length > 0) return `tag:${card.tags[0]}`;
  return 'unassigned';
}

type RankedCard = {
  card: MistakeCard;
  dueTs: number;
  score: number;
  objectiveKey: string;
};

function balanceQueueByObjective(cards: RankedCard[]) {
  const groups = new Map<string, RankedCard[]>();
  cards.forEach((entry) => {
    const bucket = groups.get(entry.objectiveKey) ?? [];
    bucket.push(entry);
    groups.set(entry.objectiveKey, bucket);
  });

  const usage = new Map<string, number>();
  const result: MistakeCard[] = [];
  let previousKey: string | null = null;

  while (result.length < cards.length) {
    let candidateKeys = [...groups.entries()]
      .filter(([, queue]) => queue.length > 0)
      .map(([key]) => key);
    if (candidateKeys.length === 0) break;

    if (previousKey && candidateKeys.length > 1) {
      const diversified = candidateKeys.filter((key) => key !== previousKey);
      if (diversified.length > 0) candidateKeys = diversified;
    }

    candidateKeys.sort((a, b) => {
      const headA = groups.get(a)?.[0];
      const headB = groups.get(b)?.[0];
      if (!headA || !headB) return a.localeCompare(b);
      if (headA.dueTs !== headB.dueTs) return headA.dueTs - headB.dueTs;
      if (headA.score !== headB.score) return headB.score - headA.score;
      const usageDelta = (usage.get(a) ?? 0) - (usage.get(b) ?? 0);
      if (usageDelta !== 0) return usageDelta;
      return a.localeCompare(b);
    });

    const selectedKey = candidateKeys[0];
    const queue = groups.get(selectedKey);
    if (!queue || queue.length === 0) break;
    const next = queue.shift();
    if (!next) break;
    result.push(next.card);
    usage.set(selectedKey, (usage.get(selectedKey) ?? 0) + 1);
    previousKey = selectedKey;
  }

  return result;
}

export default function ReviewPage() {
  const { packs } = usePacks();
  const { lessons } = useLessons();
  const { state, updateState } = useLocalState();
  const { doc: objectivesDoc, loaded: objectivesLoaded } = useObjectives();
  const [queueMode, setQueueMode] = useState<'due' | 'upcoming' | 'all'>('due');
  const [statusFilter, setStatusFilter] = useState<'all' | 'wrong' | 'unsure'>('all');
  const [packFilter, setPackFilter] = useState<string>('all');
  const [objectiveFilter, setObjectiveFilter] = useState<string>('all');
  const [misconceptionFilter, setMisconceptionFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [outlineMapDoc, setOutlineMapDoc] = useState<OutlineMapDoc | null>(null);
  const [mappingLoaded, setMappingLoaded] = useState(false);

  const questionMap = useMemo(() => {
    const map = new Map<string, { packId: string; question: any }>();
    packs.forEach((pack) => {
      pack.question_bank.forEach((q) => map.set(q.id, { packId: pack.pack_id, question: q }));
    });
    return map;
  }, [packs]);

  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    const load = async () => {
      try {
        const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
        const res = await fetch(`${basePath}/content/mappings/outline_map.json`, { cache: 'no-store' });
        if (!res.ok) {
          setOutlineMapDoc(null);
          return;
        }
        const data = (await res.json()) as OutlineMapDoc;
        setOutlineMapDoc(data);
      } catch {
        setOutlineMapDoc(null);
      } finally {
        setMappingLoaded(true);
      }
    };
    load();
  }, []);

  const objectiveMastery = useMemo(() => {
    if (!objectivesDoc) {
      return { rows: [], sortedWeakest: [] };
    }
    return computeObjectiveMastery(objectivesDoc, packs, state, now);
  }, [objectivesDoc, packs, state, now]);

  const misconceptionPriority = useMemo(
    () => {
      const misconceptionMastery = computeMisconceptionMastery(packs, state, now);
      return computeMisconceptionPriority(state, objectiveMastery.rows, misconceptionMastery.rows, now);
    },
    [packs, state, objectiveMastery.rows, now]
  );

  const objectiveWeaknessById = useMemo(
    () => new Map(objectiveMastery.rows.map((row) => [row.objectiveId, row.weaknessScore])),
    [objectiveMastery.rows]
  );
  const misconceptionPriorityByTag = useMemo(
    () => new Map(misconceptionPriority.map((row) => [row.tag, row.priorityScore])),
    [misconceptionPriority]
  );

  const nextBestPlan = useMemo(
    () => buildNextBestActivityPlan({
      weakestObjectives: objectiveMastery.sortedWeakest,
      misconceptionPriority,
      outlineMap: outlineMapDoc,
      packs,
      lessons,
      state,
      now
    }),
    [objectiveMastery.sortedWeakest, misconceptionPriority, outlineMapDoc, packs, lessons, state, now]
  );

  useEffect(() => {
    if (!nextBestPlan) return;
    storeCoachingPlan(nextBestPlan);
  }, [nextBestPlan]);

  const filteredCards = useMemo(() => {
    const query = search.trim().toLowerCase();
    const ranked = [...state.mistakeCards]
      .filter((card) => {
        const isDue = isMistakeCardDue(card, now);
        if (queueMode === 'due') return isDue;
        if (queueMode === 'upcoming') return !isDue;
        return true;
      })
      .filter((card) => (statusFilter === 'all' ? true : card.status === statusFilter))
      .filter((card) => (packFilter === 'all' ? true : card.pack_id === packFilter))
      .filter((card) => (objectiveFilter === 'all' ? true : card.objectiveIds.includes(objectiveFilter)))
      .filter((card) => (misconceptionFilter === 'all' ? true : card.misconceptionTags.includes(misconceptionFilter)))
      .filter((card) =>
        query
          ? card.prompt.toLowerCase().includes(query)
            || card.question_id.toLowerCase().includes(query)
            || card.objectiveIds.some((objectiveId) => objectiveId.toLowerCase().includes(query))
            || card.misconceptionTags.some((tag) => tag.toLowerCase().includes(query))
          : true
      )
      .map((card): RankedCard => {
        const objectiveWeakness = card.objectiveIds.length > 0
          ? Math.max(...card.objectiveIds.map((objectiveId) => objectiveWeaknessById.get(objectiveId) ?? 50))
          : 40;
        const misconceptionTags = card.misconceptionTags.length > 0 ? card.misconceptionTags : card.tags;
        const misconceptionWeakness = misconceptionTags.length > 0
          ? Math.max(...misconceptionTags.map((tag) => misconceptionPriorityByTag.get(tag) ?? 0))
          : 0;
        const dueBoost = isMistakeCardDue(card, now) ? 30 : 0;
        const statusBoost = card.status === 'wrong' ? 18 : 10;
        const score = objectiveWeakness + misconceptionWeakness + dueBoost + statusBoost;
        return {
          card,
          dueTs: new Date(getMistakeCardDueAt(card)).getTime(),
          score,
          objectiveKey: primaryObjectiveKey(card)
        };
      })
      .sort((a, b) => {
        if (a.dueTs !== b.dueTs) return a.dueTs - b.dueTs;
        if (a.score !== b.score) return b.score - a.score;
        return a.card.id.localeCompare(b.card.id);
      });

    return balanceQueueByObjective(ranked);
  }, [
    state.mistakeCards,
    queueMode,
    statusFilter,
    packFilter,
    objectiveFilter,
    misconceptionFilter,
    search,
    now,
    objectiveWeaknessById,
    misconceptionPriorityByTag
  ]);

  const dueCount = state.mistakeCards.filter((card) => isMistakeCardDue(card, now)).length;
  const upcomingCount = Math.max(0, state.mistakeCards.length - dueCount);
  const packOptions = useMemo(() => {
    const used = new Set(state.mistakeCards.map((card) => card.pack_id));
    return packs.filter((pack) => used.has(pack.pack_id)).sort((a, b) => a.chapter.number - b.chapter.number);
  }, [packs, state.mistakeCards]);

  const objectiveOptions = useMemo(
    () =>
      [...new Set(state.mistakeCards.flatMap((card) => card.objectiveIds))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })),
    [state.mistakeCards]
  );

  const misconceptionOptions = useMemo(
    () => [...new Set(state.mistakeCards.flatMap((card) => card.misconceptionTags))].sort((a, b) => a.localeCompare(b)),
    [state.mistakeCards]
  );

  const handleRetry = (cardId: string, result: { correct: boolean; unsure: boolean }) => {
    updateState((prev) => {
      const card = prev.mistakeCards.find((item) => item.id === cardId);
      if (!card) return prev;
      const mapped = questionMap.get(card.question_id);
      const question = mapped?.question;
      let next = { ...prev };

      const reviewResult = result.correct ? (result.unsure ? 'correct_unsure' : 'correct_confident') : 'wrong';
      const reviewDate = new Date();
      const updatedCard = applyMistakeReview(card, reviewResult, reviewDate);
      next = {
        ...next,
        mistakeCards: next.mistakeCards.map((item) => (item.id === cardId ? updatedCard : item))
      };

      if (question) {
        const prevStat = next.questionStats[question.id];
        const effectiveCorrect = result.correct && !result.unsure;
        const firstCorrect = !prevStat || prevStat.correct === 0;
        const stat = updateQuestionStat(prevStat, effectiveCorrect, reviewDate);
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
        <div className="tag">Spaced Review</div>
        <h1 style={{ marginBottom: 6 }}>Mistake Cards</h1>
        <p style={{ color: 'var(--muted)' }}>
          Queue is scheduled by next due time, then diversified across objectives with weakness-aware tie breaks.
        </p>
        <div className="flex" style={{ marginTop: 10 }}>
          <div className="stat-pill">Due now: {dueCount}</div>
          <div className="stat-pill">Upcoming: {upcomingCount}</div>
          <div className="stat-pill">Total: {state.mistakeCards.length}</div>
          <Link href={'/review/coverage' as Route} className="button secondary">Coverage report</Link>
        </div>
        <div className="grid" style={{ gap: 12, marginTop: 12 }}>
          <div className="answer-card">
            <div className="panel-header">
              <div>
                <div className="tag">Next Best Activity</div>
                <div style={{ marginTop: 6, fontWeight: 700 }}>
                  {nextBestPlan
                    ? `Objective ${nextBestPlan.objectiveId}: ${nextBestPlan.objectiveTitle}`
                    : 'Not enough objective data yet'}
                </div>
              </div>
              {nextBestPlan && (
                <Link href={nextBestPlan.href as Route} className="button">
                  {nextBestPlan.activityKind === 'lesson_quick_check' ? 'Start lesson check' : 'Start drill'}
                </Link>
              )}
            </div>
            {nextBestPlan && (
              <div style={{ color: 'var(--muted)', marginTop: 8 }}>
                Mastery {formatPercent(nextBestPlan.masteryScore)}
                {' · '}
                {nextBestPlan.activityLabel}
                {' · '}
                Candidate questions {nextBestPlan.questionCount}
                {nextBestPlan.section
                  ? ` · Outline section: ${nextBestPlan.section.title}`
                  : ' · No mapped outline section yet (objective-only drill)'}
                {' · '}
                Plan {nextBestPlan.planId}
              </div>
            )}
            {!nextBestPlan && (
              <div style={{ color: 'var(--muted)', marginTop: 8 }}>
                Answer a few objective-tagged questions to unlock adaptive sequencing.
              </div>
            )}
          </div>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            <div className="answer-card">
              <div className="panel-header">
                <b>Weakest objectives</b>
                <span className="chip">Top {Math.min(6, objectiveMastery.sortedWeakest.length)}</span>
              </div>
              <div className="grid" style={{ gap: 8, marginTop: 8 }}>
                {objectiveMastery.sortedWeakest.slice(0, 6).map((row) => (
                  <div key={row.objectiveId} className="card" style={{ padding: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontWeight: 700 }}>{row.objectiveId}</span>
                      <span style={{ color: 'var(--muted)' }}>{formatPercent(row.masteryScore)}</span>
                    </div>
                    <div style={{ color: 'var(--muted)', marginTop: 4, fontSize: 13, lineHeight: 1.4 }}>
                      {row.objectiveTitle}
                    </div>
                    <div className="progress-bar" style={{ marginTop: 8 }}>
                      <span style={{ width: `${Math.max(4, Math.min(100, row.masteryScore))}%` }} />
                    </div>
                  </div>
                ))}
                {objectiveMastery.sortedWeakest.length === 0 && (
                  <div style={{ color: 'var(--muted)' }}>
                    {objectivesLoaded ? 'No objectives loaded.' : 'Loading objective mastery...'}
                  </div>
                )}
              </div>
            </div>

            <div className="answer-card">
              <div className="panel-header">
                <b>Priority misconceptions</b>
                <span className="chip">Top {Math.min(8, misconceptionPriority.length)}</span>
              </div>
              <div className="flex" style={{ marginTop: 10 }}>
                {misconceptionPriority.slice(0, 8).map((row) => (
                  <div key={row.tag} className="chip">
                    {row.tag} · {row.cardCount} cards
                  </div>
                ))}
                {misconceptionPriority.length === 0 && (
                  <div style={{ color: 'var(--muted)' }}>No misconception-tagged cards yet.</div>
                )}
              </div>
            </div>
          </div>
          {!mappingLoaded && (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              Loading outline mapping...
            </div>
          )}
        </div>
        <div className="flex" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <button className={queueMode === 'due' ? 'button' : 'button secondary'} onClick={() => setQueueMode('due')}>Due</button>
          <button className={queueMode === 'upcoming' ? 'button' : 'button secondary'} onClick={() => setQueueMode('upcoming')}>Upcoming</button>
          <button className={queueMode === 'all' ? 'button' : 'button secondary'} onClick={() => setQueueMode('all')}>All cards</button>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | 'wrong' | 'unsure')}>
            <option value="all">All statuses</option>
            <option value="wrong">Wrong only</option>
            <option value="unsure">Unsure only</option>
          </select>
          <select value={packFilter} onChange={(e) => setPackFilter(e.target.value)}>
            <option value="all">All chapters</option>
            {packOptions.map((pack) => (
              <option key={pack.pack_id} value={pack.pack_id}>
                Chapter {pack.chapter.number}: {pack.chapter.title}
              </option>
            ))}
          </select>
          <select value={objectiveFilter} onChange={(e) => setObjectiveFilter(e.target.value)}>
            <option value="all">All objectives</option>
            {objectiveOptions.map((objectiveId) => (
              <option key={objectiveId} value={objectiveId}>
                Objective {objectiveId}
              </option>
            ))}
          </select>
          <select value={misconceptionFilter} onChange={(e) => setMisconceptionFilter(e.target.value)}>
            <option value="all">All misconceptions</option>
            {misconceptionOptions.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search prompt, question ID, objective, or misconception"
            style={{
              minWidth: 220,
              borderRadius: 10,
              padding: '8px 10px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.05)',
              color: 'var(--text)'
            }}
          />
        </div>
      </div>

      <div className="grid" style={{ gap: 12 }}>
        {filteredCards.length === 0 && (
          <div className="card" style={{ color: 'var(--muted)' }}>
            {queueMode === 'due'
              ? 'No cards due right now. Switch to Upcoming or All cards to review immediately.'
              : 'No cards match this filter yet.'}
          </div>
        )}
        {filteredCards.map((card) => {
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
  );
}
