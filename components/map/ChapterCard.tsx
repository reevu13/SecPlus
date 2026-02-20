'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';

export type ChapterMissionRow = {
  id: string;
  kicker: string;
  label: string;
  meta: string;
  href: Route;
  actionLabel: string;
  locked: boolean;
};

type ChapterCardProps = {
  chapterNumber: number;
  title: string;
  description: string;
  progressPercent: number;
  lessonPercent: number | null;
  primaryLabel: string;
  primaryHref: Route;
  primaryDisabled: boolean;
  nextRecommendedText: string | null;
  gateHint: string | null;
  missions: ChapterMissionRow[];
  onReset: () => void;
};

export default function ChapterCard({
  chapterNumber,
  title,
  description,
  progressPercent,
  lessonPercent,
  primaryLabel,
  primaryHref,
  primaryDisabled,
  nextRecommendedText,
  gateHint,
  missions,
  onReset
}: ChapterCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="card chapter-card">
      <div className="chapter-card-top">
        <div>
          <div className="tag">{`Chapter ${chapterNumber}`}</div>
          <h3 className="campaign-h3">{title}</h3>
          <p className="chapter-summary" title={description}>{description}</p>
        </div>
        <div className="chapter-badges">
          <span className="chip">{progressPercent}% complete</span>
          {lessonPercent !== null && <span className="chip">{`Lessons ${lessonPercent}%`}</span>}
        </div>
      </div>

      <div className="progress-bar chapter-progress">
        <span style={{ width: `${progressPercent}%` }} />
      </div>

      {nextRecommendedText && <div className="chapter-next">{nextRecommendedText}</div>}
      {gateHint && <div className="chapter-gate-hint">{gateHint}</div>}

      <div className="chapter-actions">
        {primaryDisabled ? (
          <span className="button secondary campaign-button-disabled">{primaryLabel}</span>
        ) : (
          <Link href={primaryHref} className="button secondary chapter-primary-btn">
            {primaryLabel}
          </Link>
        )}
        <button
          className="button secondary chapter-ghost-btn"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
        >
          {expanded ? 'Hide missions' : 'View missions'}
        </button>
      </div>

      {expanded && (
        <div className="chapter-mission-panel">
          {missions.map((mission) => (
            <div key={mission.id} className="chapter-mission-row">
              <div>
                <div className="chapter-mission-index">{mission.kicker}</div>
                <div className="chapter-mission-title">{mission.label}</div>
                <div className="chapter-mission-meta">{mission.meta}</div>
              </div>
              {mission.locked ? (
                <span className="button secondary campaign-button-disabled">{mission.actionLabel}</span>
              ) : (
                <Link href={mission.href} className="button secondary">{mission.actionLabel}</Link>
              )}
            </div>
          ))}
          <div className="chapter-panel-footer">
            <button className="button secondary chapter-ghost-btn" onClick={onReset}>
              Reset chapter progress
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
