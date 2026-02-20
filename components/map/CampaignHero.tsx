'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Route } from 'next';

type CampaignHeroProps = {
  continueHref: Route;
  continueLabel: string;
  continueMeta: string;
  nextBestHref?: Route;
  nextBestLabel?: string;
  nextBestMeta?: string;
  mastery: number;
  chaptersComplete: number;
  chaptersTotal: number;
  streakDays: number;
  offlineStatus: 'Online' | 'Offline';
  utilityMenu: ReactNode;
};

export default function CampaignHero({
  continueHref,
  continueLabel,
  continueMeta,
  nextBestHref,
  nextBestLabel,
  nextBestMeta,
  mastery,
  chaptersComplete,
  chaptersTotal,
  streakDays,
  offlineStatus,
  utilityMenu
}: CampaignHeroProps) {
  return (
    <section className="card campaign-hero-main">
      <div className="campaign-hero-header">
        <div>
          <div className="tag">Campaign</div>
          <h1 className="campaign-h1">Security+ SY0-701</h1>
          <p className="campaign-hero-subtitle">
            Progress through chapter missions with clear next actions and mastery-driven practice.
          </p>
        </div>
        {utilityMenu}
      </div>

      <div className="campaign-hero-actions">
        <Link href={continueHref} className="button campaign-cta-primary">
          {continueLabel}
        </Link>
        {nextBestHref && nextBestLabel && (
          <Link href={nextBestHref} className="button secondary">
            {nextBestLabel}
          </Link>
        )}
        <div className="campaign-hero-meta">{continueMeta}</div>
        {nextBestMeta && <div className="campaign-hero-meta">{nextBestMeta}</div>}
      </div>

      <div className="campaign-stat-row">
        <div className="campaign-stat-card">
          <span className="campaign-stat-label">Overall mastery</span>
          <span className="campaign-stat-value">{mastery}%</span>
        </div>
        <div className="campaign-stat-card">
          <span className="campaign-stat-label">Chapters complete</span>
          <span className="campaign-stat-value">{chaptersComplete}/{chaptersTotal}</span>
        </div>
        <div className="campaign-stat-card">
          <span className="campaign-stat-label">Streak</span>
          <span className="campaign-stat-value">{streakDays} day{streakDays === 1 ? '' : 's'}</span>
        </div>
        <div className="campaign-stat-card">
          <span className="campaign-stat-label">Offline status</span>
          <span className={`campaign-stat-value ${offlineStatus === 'Offline' ? 'is-danger' : 'is-success'}`}>
            {offlineStatus}
          </span>
        </div>
      </div>
    </section>
  );
}
