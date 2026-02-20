'use client';

import Link from 'next/link';
import type { Route } from 'next';

export type FocusAreaItem = {
  tag: string;
  mastery: number;
};

type FocusAreasPanelProps = {
  items: FocusAreaItem[];
  selected: string[];
  onToggle: (tag: string) => void;
  practiceHref: Route;
};

export default function FocusAreasPanel({ items, selected, onToggle, practiceHref }: FocusAreasPanelProps) {
  return (
    <aside className="card focus-panel">
      <div className="panel-header">
        <div>
          <div className="tag">Focus Areas</div>
          <h2 className="campaign-h2">Practice Targets</h2>
        </div>
        <span className="chip">{items.length} tags</span>
      </div>

      <div className="focus-list">
        {items.length === 0 && <div className="campaign-muted">No mastery data yet.</div>}
        {items.map((item) => {
          const isSelected = selected.includes(item.tag);
          return (
            <button
              key={item.tag}
              className={`focus-row ${isSelected ? 'is-selected' : ''}`}
              onClick={() => onToggle(item.tag)}
              aria-pressed={isSelected}
            >
              <div className="focus-row-top">
                <span className="focus-tag">{item.tag}</span>
                <span className="focus-score">{item.mastery}%</span>
              </div>
              <div className="focus-mini-track">
                <span style={{ width: `${Math.max(4, Math.min(100, item.mastery))}%` }} />
              </div>
            </button>
          );
        })}
      </div>

      <Link href={practiceHref} className="button secondary focus-practice-btn">
        Practice weak tags
      </Link>
    </aside>
  );
}
