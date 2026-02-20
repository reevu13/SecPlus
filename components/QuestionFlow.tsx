'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChapterPack, LocalState, Question, RunQuestionResult } from '@/lib/types';
import { deriveGuidance, updateMasteryByTags, updateQuestionStat, updateStreak, upsertMistakeCard } from '@/lib/progress';
import { useLocalState } from '@/lib/useLocalState';
import { getTrapTip } from '@/lib/packUtils';
import { remediationForObjectiveIds } from '@/lib/objectiveToLesson';

function isJustificationValid(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 6) return false;
  return /[.!?]$/.test(trimmed);
}

function optionEntries(options: Record<string, string>) {
  return Object.entries(options);
}

function formatOption(options: Record<string, string>, key?: string | null) {
  if (!key) return 'No answer';
  const value = options[key];
  return value ? `${key}: ${value}` : key;
}

function formatMulti(options: Record<string, string>, keys: string[]) {
  if (!keys.length) return 'No answer';
  return keys.map((key) => formatOption(options, key)).join(', ');
}

function formatPairs(pairs: Record<string, string>) {
  const entries = Object.entries(pairs);
  if (!entries.length) return 'No answer';
  return entries.map(([left, right]) => `${left} → ${right}`).join('\n');
}

function formatOrdering(items: string[]) {
  if (!items.length) return 'No answer';
  return items.join(' → ');
}

function shortenPrompt(text: string, max = 160) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function moveItem<T>(items: T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

interface Props {
  pack: ChapterPack;
  questions: Question[];
  mode: 'campaign' | 'roguelike' | 'exam';
  title: string;
  subtitle?: string;
  onComplete?: (results: RunQuestionResult[]) => void;
  resolvePackId?: (questionId: string) => string;
  resolvePack?: (questionId: string) => ChapterPack | undefined;
  sessionKey?: string;
  stateBridge?: {
    state: LocalState;
    loaded: boolean;
    updateState: (updater: (state: LocalState) => LocalState) => void;
  };
}

export default function QuestionFlow({
  pack,
  questions,
  mode,
  title,
  subtitle,
  onComplete,
  resolvePackId,
  resolvePack,
  sessionKey,
  stateBridge
}: Props) {
  const localState = useLocalState();
  const { state, updateState, loaded } = stateBridge ?? localState;
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  const [matching, setMatching] = useState<Record<string, string>>({});
  const [activeMatchingLeft, setActiveMatchingLeft] = useState<string | null>(null);
  const [ordering, setOrdering] = useState<string[]>([]);
  const [orderingDragIndex, setOrderingDragIndex] = useState<number | null>(null);
  const [orderingDropIndex, setOrderingDropIndex] = useState<number | null>(null);
  const [orderingFocusIndex, setOrderingFocusIndex] = useState(0);
  const [hintUsed, setHintUsed] = useState(false);
  const [revealedHintCount, setRevealedHintCount] = useState(0);
  const [unsure, setUnsure] = useState(false);
  const [justification, setJustification] = useState('');
  const [results, setResults] = useState<RunQuestionResult[]>([]);
  const [questionStart, setQuestionStart] = useState<number>(() => Date.now());
  const [sessionXp, setSessionXp] = useState(0);
  const [sessionHydrated, setSessionHydrated] = useState(false);

  const question = questions[index];

  useEffect(() => {
    setSelected(null);
    setMultiSelected([]);
    setMatching({});
    setActiveMatchingLeft(null);
    setOrdering(question && question.type === 'ordering' ? [...question.items] : []);
    setOrderingDragIndex(null);
    setOrderingDropIndex(null);
    setOrderingFocusIndex(0);
    setHintUsed(false);
    setRevealedHintCount(0);
    setUnsure(false);
    setJustification('');
    setRevealed(false);
    setQuestionStart(Date.now());
  }, [index, question]);

  useEffect(() => {
    if (!loaded || sessionHydrated) return;
    if (sessionKey) {
      const saved = state.activeSessions?.[sessionKey];
      if (saved?.results?.length) {
        setResults(saved.results);
        const nextIndex = Math.min(saved.results.length, Math.max(questions.length - 1, 0));
        setIndex(nextIndex);
      }
    }
    setSessionHydrated(true);
  }, [loaded, sessionHydrated, sessionKey, state.activeSessions, questions.length]);

  const matchingAvailableRights = useMemo(() => {
    if (!question || question.type !== 'matching') return [];
    return question.right;
  }, [question]);
  const remediationLinks = question ? remediationForObjectiveIds(question.objectiveIds ?? []) : [];

  if (!question || !loaded) {
    return <div className="card">Loading mission...</div>;
  }

  const packForQuestion = resolvePack ? resolvePack(question.id) ?? pack : pack;
  const trapTip = getTrapTip(packForQuestion, question.id);
  const progressiveHints = question.hints?.length ? question.hints : trapTip ? [trapTip] : [];
  const visibleHints = progressiveHints.slice(0, revealedHintCount);
  const hasMoreHints = revealedHintCount < progressiveHints.length;
  const coachingTip = trapTip || (question.tags.length ? `Focus tag: ${question.tags[0]}` : '');

  const baseXp = pack.progression.xp_rules.base_xp_per_correct;
  const timeBonusThreshold = pack.progression.xp_rules.time_bonus_threshold_seconds * 1000;
  const timeBonus = pack.progression.xp_rules.time_bonus_xp;

  const assignMatching = (leftItem: string, rightItem: string) => {
    setMatching((prev) => {
      const next = { ...prev };
      Object.entries(next).forEach(([left, right]) => {
        if (left !== leftItem && right === rightItem) delete next[left];
      });
      next[leftItem] = rightItem;
      return next;
    });
  };

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
    if (question.type === 'ordering') return ordering.length === question.items.length;
    return false;
  };

  const answeredCorrect = revealed ? evaluateCorrect() : null;

  const rationaleFeedback = (() => {
    if (!revealed) return [] as string[];
    if (answeredCorrect) {
      return question.rationaleCorrect ? [question.rationaleCorrect] : [];
    }

    if (question.type === 'mcq') {
      return selected && question.rationaleIncorrect[selected] ? [question.rationaleIncorrect[selected]] : [];
    }
    if (question.type === 'multi_select') {
      const missed = question.answers.filter((answer) => !multiSelected.includes(answer));
      const picked = [...multiSelected, ...missed];
      return [...new Set(picked.map((key) => question.rationaleIncorrect[key]).filter(Boolean))];
    }
    if (question.type === 'matching') {
      const wrongLeft = question.left.filter((left) => matching[left] !== question.pairs[left]);
      return [...new Set(wrongLeft.map((left) => question.rationaleIncorrect[left]).filter(Boolean))];
    }
    if (question.type === 'ordering') {
      const wrongItems = ordering.filter((item, idx) => question.correct_order[idx] !== item);
      return [...new Set(wrongItems.map((item) => question.rationaleIncorrect[item]).filter(Boolean))];
    }
    return [];
  })();

  const submitAnswer = () => {
    if (revealed) return;
    const correct = evaluateCorrect();
    const autoRevealHint = mode === 'campaign' && !correct && progressiveHints.length > revealedHintCount;
    const hintsUsed = hintUsed || revealedHintCount > 0 || autoRevealHint;
    const justificationValid = mode === 'roguelike' ? isJustificationValid(justification) : true;
    const fullCredit = correct && justificationValid && !unsure;
    const effectiveCorrect = fullCredit;
    const now = new Date();
    const timeMs = now.getTime() - questionStart;
    const xpGain = fullCredit ? baseXp + (timeMs <= timeBonusThreshold ? timeBonus : 0) : correct ? Math.round(baseXp * 0.4) : 0;
    const packId = resolvePackId ? resolvePackId(question.id) : packForQuestion.pack_id;

    const myAnswer = (() => {
      if (question.type === 'mcq') return formatOption(question.options, selected);
      if (question.type === 'multi_select') return formatMulti(question.options, multiSelected);
      if (question.type === 'matching') return formatPairs(matching);
      if (question.type === 'ordering') return formatOrdering(ordering);
      return 'No answer';
    })();

    const correctAnswer = (() => {
      if (question.type === 'mcq') return formatOption(question.options, question.answer);
      if (question.type === 'multi_select') return formatMulti(question.options, question.answers);
      if (question.type === 'matching') return formatPairs(question.pairs);
      if (question.type === 'ordering') return formatOrdering(question.correct_order);
      return 'No answer';
    })();

    const guidance = deriveGuidance(packForQuestion, question);

    const nextResult: RunQuestionResult = {
      question_id: question.id,
      correct,
      unsure: unsure || (correct && !justificationValid),
      time_ms: timeMs,
      justification: justification.trim()
    };
    const nextResults = [...results, nextResult];

    updateState((prev) => {
      let next = updateStreak(prev, now);
      const prevStat = next.questionStats[question.id];
      const firstCorrect = !prevStat || prevStat.correct === 0;
      const updatedStat = updateQuestionStat(prevStat, effectiveCorrect, now);
      next = {
        ...next,
        questionStats: { ...next.questionStats, [question.id]: updatedStat }
      };
      next = updateMasteryByTags(next, question.tags, effectiveCorrect, firstCorrect && effectiveCorrect);

      if (!fullCredit || unsure) {
        const status = correct ? 'unsure' : 'wrong';
        next = upsertMistakeCard(
          next,
          {
            pack_id: packId,
            question_id: question.id,
            question_type: question.type,
            hints_used: hintsUsed,
            objectiveIds: question.objectiveIds,
            misconceptionTags: question.misconceptionTags,
            prompt: shortenPrompt(question.stem),
            my_answer: myAnswer,
            correct_answer: correctAnswer,
            rule_of_thumb: guidance.rule_of_thumb,
            micro_example: guidance.micro_example,
            confusion_pair_id: guidance.confusion_pair_id,
            tags: question.tags,
            remediation: remediationLinks
          },
          status,
          now
        );
      }

      if (sessionKey) {
        next = {
          ...next,
          activeSessions: {
            ...next.activeSessions,
            [sessionKey]: {
              results: nextResults,
              updated_at: now.toISOString()
            }
          }
        };
      }

      return next;
    });

    setResults(nextResults);
    setSessionXp((prev) => prev + xpGain);
    if (autoRevealHint) {
      setRevealedHintCount((prev) => Math.min(progressiveHints.length, prev + 1));
      setHintUsed(true);
    }
    setRevealed(true);
  };

  const nextQuestion = () => {
    if (index < questions.length - 1) {
      setIndex((prev) => prev + 1);
    } else {
      if (sessionKey) {
        updateState((prev) => {
          const nextSessions = { ...prev.activeSessions };
          delete nextSessions[sessionKey];
          return { ...prev, activeSessions: nextSessions };
        });
      }
      onComplete?.(results.concat([]));
    }
  };

  const progressPct = Math.round(((index + 1) / questions.length) * 100);
  const correctCount = results.filter((r) => r.correct).length;
  const modeLabel = mode === 'campaign' ? 'Campaign' : mode === 'roguelike' ? 'Roguelike' : 'Exam Sim';

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="tag">{modeLabel}</div>
          <h1 style={{ margin: '6px 0' }}>{title}</h1>
          {subtitle && <p style={{ color: 'var(--muted)' }}>{subtitle}</p>}
          <div className="flex" style={{ marginTop: 8 }}>
            <div className="stat-pill">Progress {progressPct}%</div>
            <div className="stat-pill">Correct {correctCount}/{results.length}</div>
            <div className="stat-pill">XP {sessionXp}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="chip">Question {index + 1} / {questions.length}</div>
          <div className="progress-bar" style={{ marginTop: 10, minWidth: 180 }}>
            <span style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      </div>

      <div className="card">
        {mode === 'campaign' && coachingTip && (
          <div className="answer-card" style={{ marginBottom: 12 }}>
            <div className="tag">Coach Tip</div>
            <div style={{ color: 'var(--muted)' }}>{coachingTip}</div>
          </div>
        )}

        {mode === 'campaign' && progressiveHints.length > 0 && (
          <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <div className="tag">Hints {visibleHints.length}/{progressiveHints.length}</div>
            <button
              className="button secondary"
              onClick={() => {
                if (!hasMoreHints) return;
                setHintUsed(true);
                setRevealedHintCount((prev) => Math.min(progressiveHints.length, prev + 1));
              }}
              disabled={!hasMoreHints}
            >
              {hasMoreHints ? 'Show hint' : 'No more hints'}
            </button>
          </div>
        )}

        {visibleHints.length > 0 && (
          <div className="answer-card" style={{ marginBottom: 12 }}>
            <div className="tag">Hints</div>
            <ol style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {visibleHints.map((hint, idx) => (
                <li key={`${question.id}_hint_${idx}`} style={{ color: 'var(--muted)' }}>
                  {hint}
                </li>
              ))}
            </ol>
          </div>
        )}

        <h3 style={{ marginTop: 0 }}>{question.stem}</h3>

        {question.type === 'ordering' && (
          <div className="grid" style={{ gap: 10 }}>
            <div className="tag">Drag and drop into order. Keyboard: focus an item and use arrow keys.</div>
            {ordering.map((item, idx) => {
              const isDropTarget = orderingDropIndex === idx;
              const isFocused = orderingFocusIndex === idx;
              return (
                <div
                  key={item}
                  className="answer-card"
                  draggable={!revealed}
                  tabIndex={0}
                  role="option"
                  aria-selected={orderingFocusIndex === idx}
                  aria-grabbed={orderingDragIndex === idx}
                  style={{
                    borderColor: isDropTarget ? 'rgba(126,231,255,0.8)' : isFocused ? 'rgba(126,231,255,0.5)' : 'rgba(255,255,255,0.08)',
                    background: isDropTarget ? 'rgba(126,231,255,0.08)' : 'transparent',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10
                  }}
                  onFocus={() => setOrderingFocusIndex(idx)}
                  onDragStart={(event) => {
                    if (revealed) return;
                    setOrderingDragIndex(idx);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', String(idx));
                  }}
                  onDragOver={(event) => {
                    if (revealed) return;
                    event.preventDefault();
                    setOrderingDropIndex(idx);
                  }}
                  onDrop={(event) => {
                    if (revealed) return;
                    event.preventDefault();
                    const raw = orderingDragIndex ?? Number.parseInt(event.dataTransfer.getData('text/plain'), 10);
                    if (Number.isInteger(raw)) {
                      setOrdering((prev) => moveItem(prev, raw, idx));
                    }
                    setOrderingDragIndex(null);
                    setOrderingDropIndex(null);
                    setOrderingFocusIndex(idx);
                  }}
                  onDragEnd={() => {
                    setOrderingDragIndex(null);
                    setOrderingDropIndex(null);
                  }}
                  onKeyDown={(event) => {
                    if (revealed) return;
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      setOrdering((prev) => moveItem(prev, idx, Math.max(0, idx - 1)));
                      setOrderingFocusIndex(Math.max(0, idx - 1));
                    } else if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setOrdering((prev) => moveItem(prev, idx, Math.min(ordering.length - 1, idx + 1)));
                      setOrderingFocusIndex(Math.min(ordering.length - 1, idx + 1));
                    }
                  }}
                >
                  <div>
                    <div className="tag">Step {idx + 1}</div>
                    <div style={{ marginTop: 6 }}>{item}</div>
                  </div>
                  <div className="flex">
                    <button
                      className="button secondary"
                      onClick={() => {
                        if (revealed) return;
                        setOrdering((prev) => moveItem(prev, idx, Math.max(0, idx - 1)));
                        setOrderingFocusIndex(Math.max(0, idx - 1));
                      }}
                      disabled={revealed || idx === 0}
                    >
                      Up
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => {
                        if (revealed) return;
                        setOrdering((prev) => moveItem(prev, idx, Math.min(prev.length - 1, idx + 1)));
                        setOrderingFocusIndex(Math.min(ordering.length - 1, idx + 1));
                      }}
                      disabled={revealed || idx === ordering.length - 1}
                    >
                      Down
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {question.type === 'matching' && (
          <div className="grid" style={{ gap: 10 }}>
            <div className="tag">Choose a left item, then assign its right-side match.</div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              <div className="answer-card">
                <div className="tag" style={{ marginBottom: 8 }}>Left concepts</div>
                <div className="grid" style={{ gap: 8 }}>
                  {question.left.map((leftItem) => {
                    const pairedRight = matching[leftItem];
                    const active = activeMatchingLeft === leftItem;
                    return (
                      <button
                        key={leftItem}
                        className="button secondary"
                        style={{
                          justifyContent: 'space-between',
                          textAlign: 'left',
                          borderColor: active ? 'rgba(126,231,255,0.7)' : 'rgba(255,255,255,0.14)',
                          background: active ? 'rgba(126,231,255,0.12)' : 'transparent'
                        }}
                        disabled={revealed}
                        onClick={() => setActiveMatchingLeft(leftItem)}
                      >
                        <span>{leftItem}</span>
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{pairedRight ? `→ ${pairedRight}` : 'Not paired'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="answer-card">
                <div className="tag" style={{ marginBottom: 8 }}>Right meanings</div>
                <div className="grid" style={{ gap: 8 }}>
                  {matchingAvailableRights.map((rightItem) => {
                    const usedBy = question.left.find((left) => matching[left] === rightItem);
                    const disabled = revealed || !activeMatchingLeft;
                    return (
                      <button
                        key={rightItem}
                        className="button secondary"
                        style={{
                          justifyContent: 'space-between',
                          textAlign: 'left',
                          borderColor: usedBy ? 'rgba(142,240,167,0.5)' : 'rgba(255,255,255,0.14)',
                          background: usedBy ? 'rgba(142,240,167,0.12)' : 'transparent'
                        }}
                        disabled={disabled}
                        onClick={() => {
                          if (!activeMatchingLeft) return;
                          assignMatching(activeMatchingLeft, rightItem);
                        }}
                      >
                        <span>{rightItem}</span>
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{usedBy ? `Used by ${usedBy}` : 'Available'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="grid" style={{ gap: 8 }}>
              {question.left.map((leftItem) => (
                <div key={leftItem} className="answer-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{leftItem}</div>
                    <div style={{ color: 'var(--muted)' }}>{matching[leftItem] ?? 'No pair selected yet'}</div>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => {
                      if (revealed) return;
                      setMatching((prev) => {
                        const next = { ...prev };
                        delete next[leftItem];
                        return next;
                      });
                      setActiveMatchingLeft(leftItem);
                    }}
                    disabled={revealed || !matching[leftItem]}
                  >
                    Clear
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {question.type === 'mcq' && (
          <div className="grid" style={{ gap: 10 }}>
            {optionEntries(question.options).map(([key, value]) => {
              const isSelected = selected === key;
              const isAnswer = question.answer === key;
              const stateColor = revealed && isAnswer ? 'var(--success)' : revealed && isSelected && !isAnswer ? 'var(--danger)' : 'inherit';
              const borderColor = revealed && isAnswer
                ? 'rgba(142,240,167,0.8)'
                : revealed && isSelected && !isAnswer
                  ? 'rgba(255,123,123,0.8)'
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
                  style={{ textAlign: 'left', cursor: revealed ? 'default' : 'pointer', borderColor, color: stateColor, background }}
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
          <div className="grid" style={{ gap: 10 }}>
            {optionEntries(question.options).map(([key, value]) => {
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
                    onChange={(event) => {
                      if (revealed) return;
                      if (event.target.checked) setMultiSelected((prev) => [...prev, key]);
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

        {mode === 'roguelike' && (
          <div style={{ marginTop: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>1-sentence justification (required for full points)</label>
            <textarea
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              rows={3}
              style={{ width: '100%', borderRadius: 10, padding: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text)' }}
              placeholder="Write one sentence ending in a period."
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, color: 'var(--muted)' }}>
              <input type="checkbox" checked={unsure} onChange={(event) => setUnsure(event.target.checked)} />
              Mark as unsure (adds to mistake cards)
            </label>
          </div>
        )}

        <div className="flex" style={{ justifyContent: 'space-between', marginTop: 16 }}>
          <div style={{ color: 'var(--muted)' }}>{question.type.toUpperCase()}</div>
          <button className="button" onClick={submitAnswer} disabled={revealed || !readyToSubmit()}>Submit</button>
        </div>

        {revealed && (
          <div className="answer-card" style={{ marginTop: 14 }}>
            <div className="tag">Explanation</div>
            {answeredCorrect !== null && (
              <div style={{ color: answeredCorrect ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
                {answeredCorrect ? 'Correct' : 'Review needed'}
              </div>
            )}
            <div style={{ color: 'var(--muted)' }}>{question.explanation}</div>
            {rationaleFeedback.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="tag">Why this is right/wrong</div>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {rationaleFeedback.map((line) => (
                    <li key={line} style={{ color: 'var(--muted)' }}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            {mode === 'roguelike' && !isJustificationValid(justification) && (
              <div style={{ marginTop: 8, color: 'var(--danger)' }}>Add a one-sentence justification for full points.</div>
            )}
            {answeredCorrect === false && remediationLinks.length > 0 && (
              <div className="flex" style={{ marginTop: 10 }}>
                {remediationLinks.map((link) => (
                  <a key={link.href} href={link.href} className="button secondary">
                    {link.label || 'Review lesson'}
                  </a>
                ))}
              </div>
            )}
            <button className="button secondary" onClick={nextQuestion} style={{ marginTop: 10 }}>Next question</button>
          </div>
        )}
      </div>
    </div>
  );
}
