'use client';

import { useMemo, useState } from 'react';
import { Question } from '@/lib/types';

function shuffle<T>(items: T[]) {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

interface Props {
  question: Question;
  onResult: (result: { correct: boolean; unsure: boolean }) => void;
}

export default function RetryQuestion({ question, onResult }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  const [matching, setMatching] = useState<Record<string, string>>({});
  const [ordering, setOrdering] = useState<string[]>(() =>
    question.type === 'ordering' ? shuffle(question.items) : []
  );
  const [unsure, setUnsure] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const options = useMemo(() => {
    if (question.type === 'mcq' || question.type === 'multi_select') {
      return shuffle(Object.entries(question.options));
    }
    return [] as [string, string][];
  }, [question]);

  const rightOptions = useMemo(() => {
    if (question.type === 'matching') {
      return shuffle(question.right);
    }
    return [] as string[];
  }, [question]);

  const evaluateCorrect = () => {
    if (question.type === 'mcq') {
      return selected === question.answer;
    }
    if (question.type === 'multi_select') {
      const target = new Set(question.answers);
      const picked = new Set(multiSelected);
      return target.size === picked.size && [...target].every((key) => picked.has(key));
    }
    if (question.type === 'matching') {
      return question.left.every((left) => matching[left] === question.pairs[left]);
    }
    if (question.type === 'ordering') {
      return question.correct_order.every((item, idx) => ordering[idx] === item);
    }
    return false;
  };

  const readyToSubmit = () => {
    if (question.type === 'mcq') return !!selected;
    if (question.type === 'multi_select') return multiSelected.length > 0;
    if (question.type === 'matching') return question.left.every((left) => matching[left]);
    if (question.type === 'ordering') return ordering.length > 0;
    return false;
  };

  const submit = () => {
    if (revealed) return;
    const correct = evaluateCorrect();
    setRevealed(true);
    onResult({ correct, unsure });
  };

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="tag">Retry Variant</div>
      <h4 style={{ marginTop: 8 }}>{question.stem}</h4>

      {question.type === 'mcq' && (
        <div className="grid" style={{ gap: 8 }}>
          {options.map(([key, value]) => {
            const isSelected = selected === key;
            const borderColor = revealed
              ? 'rgba(255,255,255,0.08)'
              : isSelected
                ? 'rgba(126,231,255,0.7)'
                : 'rgba(255,255,255,0.08)';
            const background = revealed
              ? 'rgba(255,255,255,0.02)'
              : isSelected
                ? 'rgba(126,231,255,0.08)'
                : 'transparent';
            return (
            <button
              key={key}
              className="card"
              style={{ textAlign: 'left', cursor: revealed ? 'default' : 'pointer', borderColor, background }}
              onClick={() => {
                if (revealed) return;
                setSelected(key);
              }}
            >
              <div style={{ fontWeight: 600 }}>{key}</div>
              <div style={{ color: 'var(--muted)' }}>{value}</div>
            </button>
          );
          })}
        </div>
      )}

      {question.type === 'multi_select' && (
        <div className="grid" style={{ gap: 8 }}>
          {options.map(([key, value]) => {
            const checked = multiSelected.includes(key);
            return (
            <label
              key={key}
              className="card"
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                borderColor: checked ? 'rgba(126,231,255,0.7)' : 'rgba(255,255,255,0.08)',
                background: checked ? 'rgba(126,231,255,0.08)' : 'transparent'
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={revealed}
                onChange={(e) => {
                  if (revealed) return;
                  if (e.target.checked) setMultiSelected((prev) => [...prev, key]);
                  else setMultiSelected((prev) => prev.filter((item) => item !== key));
                }}
              />
              <div>
                <div style={{ fontWeight: 600 }}>{key}</div>
                <div style={{ color: 'var(--muted)' }}>{value}</div>
              </div>
            </label>
          );
          })}
        </div>
      )}

      {question.type === 'matching' && (
        <div className="grid" style={{ gap: 8 }}>
          {question.left.map((leftItem) => (
            <div key={leftItem} className="answer-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div>{leftItem}</div>
              <select
                value={matching[leftItem] ?? ''}
                disabled={revealed}
                onChange={(e) => setMatching((prev) => ({ ...prev, [leftItem]: e.target.value }))}
              >
                <option value="">Select</option>
                {rightOptions.map((rightItem) => (
                  <option key={rightItem} value={rightItem}>{rightItem}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {question.type === 'ordering' && (
        <div className="grid" style={{ gap: 8 }}>
          {ordering.map((item, idx) => (
            <div key={item} className="answer-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>{idx + 1}. {item}</div>
              <div className="flex">
                <button
                  className="button secondary"
                  onClick={() => {
                    if (revealed || idx === 0) return;
                    setOrdering((prev) => {
                      const next = [...prev];
                      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                      return next;
                    });
                  }}
                >
                  Up
                </button>
                <button
                  className="button secondary"
                  onClick={() => {
                    if (revealed || idx === ordering.length - 1) return;
                    setOrdering((prev) => {
                      const next = [...prev];
                      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                      return next;
                    });
                  }}
                >
                  Down
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, color: 'var(--muted)' }}>
        <input type="checkbox" checked={unsure} disabled={revealed} onChange={(e) => setUnsure(e.target.checked)} />
        Mark as unsure
      </label>

      <button className="button" onClick={submit} disabled={revealed || !readyToSubmit()} style={{ marginTop: 10 }}>Submit retry</button>
    </div>
  );
}
