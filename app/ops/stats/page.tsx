'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useObjectives } from '@/lib/useObjectives';
import { usePacks } from '@/lib/usePacks';
import { useLocalState } from '@/lib/useLocalState';
import { computeObjectiveMastery } from '@/lib/adaptiveSequencing';
import { isMistakeCardDue } from '@/lib/progress';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function heatColorForMastery(mastery: number) {
  const normalized = clamp(mastery, 0, 100);
  if (normalized < 35) return 'rgba(255, 118, 118, 0.3)';
  if (normalized < 60) return 'rgba(255, 195, 107, 0.28)';
  if (normalized < 80) return 'rgba(143, 215, 132, 0.22)';
  return 'rgba(109, 226, 184, 0.24)';
}

export default function OpsStatsPage() {
  const { packs, loaded: packsLoaded } = usePacks();
  const { doc: objectivesDoc, loaded: objectivesLoaded } = useObjectives();
  const { state, loaded: stateLoaded } = useLocalState();
  const now = useMemo(() => new Date(), []);

  const objectiveMastery = useMemo(() => {
    if (!objectivesDoc) return { rows: [] as ReturnType<typeof computeObjectiveMastery>['rows'] };
    return computeObjectiveMastery(objectivesDoc, packs, state, now);
  }, [objectivesDoc, packs, state, now]);

  const overdueCards = useMemo(
    () => state.mistakeCards.filter((card) => isMistakeCardDue(card, now)),
    [state.mistakeCards, now]
  );

  const misconceptionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    state.mistakeCards.forEach((card) => {
      const tags = card.misconceptionTags.length > 0 ? card.misconceptionTags : card.tags;
      tags.forEach((tag) => {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      });
    });
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => {
        if (a.count !== b.count) return b.count - a.count;
        return a.tag.localeCompare(b.tag);
      });
  }, [state.mistakeCards]);

  if (!packsLoaded || !objectivesLoaded || !stateLoaded) {
    return <div className="card">Loading ops stats...</div>;
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="panel-header">
          <div>
            <div className="tag">Ops</div>
            <h1 style={{ margin: '8px 0 0' }}>Learning Stats</h1>
          </div>
          <div className="flex">
            <Link href={'/review' as Route} className="button secondary">Review</Link>
            <Link href={'/ops/coverage' as Route} className="button secondary">Coverage</Link>
          </div>
        </div>
        <div className="flex" style={{ marginTop: 12 }}>
          <div className="stat-pill">Objectives tracked {objectiveMastery.rows.length}</div>
          <div className="stat-pill">Overdue cards {overdueCards.length}</div>
          <div className="stat-pill">Tagged misconceptions {misconceptionCounts.length}</div>
        </div>
      </div>

      <div className="card">
        <div className="panel-header">
          <b>Mastery heatmap by objective</b>
          <span className="chip">{objectiveMastery.rows.length} rows</span>
        </div>
        <div className="grid" style={{ gap: 8, marginTop: 10 }}>
          {objectiveMastery.rows
            .slice()
            .sort((a, b) => a.objectiveId.localeCompare(b.objectiveId, undefined, { numeric: true, sensitivity: 'base' }))
            .map((row) => (
              <div
                key={row.objectiveId}
                className="answer-card"
                style={{ background: heatColorForMastery(row.masteryScore) }}
              >
                <div className="panel-header">
                  <div>
                    <div style={{ fontWeight: 700 }}>Objective {row.objectiveId}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>{row.objectiveTitle}</div>
                  </div>
                  <div className="chip">{Math.round(row.masteryScore)}%</div>
                </div>
                <div className="progress-bar" style={{ marginTop: 8 }}>
                  <span style={{ width: `${clamp(row.masteryScore, 2, 100)}%` }} />
                </div>
              </div>
            ))}
        </div>
      </div>

      <div className="card">
        <div className="panel-header">
          <b>Most common misconception tags</b>
          <span className="chip">Top {Math.min(25, misconceptionCounts.length)}</span>
        </div>
        {misconceptionCounts.length === 0 ? (
          <div style={{ color: 'var(--muted)', marginTop: 10 }}>
            No misconception tags collected yet.
          </div>
        ) : (
          <div className="grid" style={{ gap: 8, marginTop: 10 }}>
            {misconceptionCounts.slice(0, 25).map((item) => (
              <div key={item.tag} className="answer-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span>{item.tag}</span>
                <span className="chip">{item.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
