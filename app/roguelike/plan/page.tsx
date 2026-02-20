'use client';

import Link from 'next/link';
import { usePacks } from '@/lib/usePacks';

const SEGMENTS = [
  { label: 'Warm-up', minutes: 10, color: 'rgba(124,243,200,0.8)' },
  { label: 'Main Run', minutes: 45, color: 'rgba(106,168,255,0.8)' },
  { label: 'Review', minutes: 25, color: 'rgba(255,224,130,0.9)' },
  { label: 'Wrap-up', minutes: 10, color: 'rgba(255,123,123,0.8)' }
];

export default function RunPlanPage() {
  const { packs } = usePacks();
  const total = packs[0]?.exam.max_exam_minutes ?? 90;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="tag">90-minute Session</div>
        <h1 style={{ marginBottom: 6 }}>Run Plan</h1>
        <p style={{ color: 'var(--muted)' }}>Use this split to stay on pace during exam-mode practice.</p>
        <div className="progress-bar" style={{ margin: '16px 0' }}>
          <span style={{ width: '100%', background: 'linear-gradient(90deg, rgba(124,243,200,0.8), rgba(106,168,255,0.8), rgba(255,224,130,0.9), rgba(255,123,123,0.8))' }} />
        </div>
        <div className="grid" style={{ gap: 8 }}>
          {SEGMENTS.map((segment) => (
            <div key={segment.label} className="answer-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{segment.label}</span>
              <span style={{ fontWeight: 700 }}>{segment.minutes} min</span>
            </div>
          ))}
        </div>
        <div className="flex" style={{ marginTop: 14 }}>
          <Link href="/roguelike" className="button">Start a run</Link>
          <div className="stat-pill">Total time: {total} min</div>
        </div>
      </div>
    </div>
  );
}
