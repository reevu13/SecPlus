'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useParams, useSearchParams } from 'next/navigation';
import QuestionFlow from '@/components/QuestionFlow';
import LessonSidebar, { LessonTocModuleEntry } from '@/components/LessonSidebar';
import LessonContent from '@/components/LessonContent';
import { useLocalState } from '@/lib/useLocalState';
import { useLessons } from '@/lib/useLessons';
import { usePacks } from '@/lib/usePacks';
import { ChapterLesson, LessonCheck, LessonRecallItem, RunQuestionResult } from '@/lib/types';
import { buildLessonCheckId, buildRecallItems, getLessonTagSet, LESSON_XP_RULES } from '@/lib/lessonUtils';
import { deriveTagGuidance, updateMasteryByTags, upsertMistakeCard } from '@/lib/progress';

const MASTERY_THRESHOLD = 95;
const DAILY_DRILL_LIMIT = 12;

function shuffle<T>(items: T[]) {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function normalizeAnswer(text: string) {
  return text.trim().toLowerCase();
}

function isOneSentence(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 6) return false;
  return /[.!?]$/.test(trimmed);
}

function lessonProgressSummary(lesson: ChapterLesson, completedPages: Set<string>) {
  const totalPages = lesson.modules.reduce((sum, mod) => sum + mod.pages.length, 0);
  const completed = lesson.modules.reduce((sum, mod) => sum + mod.pages.filter((p) => completedPages.has(p.id)).length, 0);
  const percent = totalPages ? Math.round((completed / totalPages) * 100) : 0;
  return { totalPages, completed, percent };
}

export default function ChapterLessonPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const rawId = Array.isArray(params?.id) ? params?.id[0] : (params?.id ?? '');
  const packId = decodeURIComponent(rawId).trim();
  const moduleFromQuery = searchParams?.get('module')?.trim() ?? '';
  const pageFromQuery = searchParams?.get('page')?.trim() ?? '';
  const modeFromQuery = searchParams?.get('mode')?.trim() ?? '';
  const { packs, loaded: packsLoaded } = usePacks();
  const { lessons, loaded: lessonsLoaded } = useLessons();
  const { state, updateState, loaded: stateLoaded } = useLocalState();

  const pack = useMemo(() => packs.find((item) => item.pack_id === packId), [packs, packId]);
  const lesson = useMemo(() => lessons.find((item) => item.pack_id === packId), [lessons, packId]);

  const [tab, setTab] = useState<'learn' | 'recall'>('learn');
  const [activeModuleId, setActiveModuleId] = useState<string>('');
  const [activePageId, setActivePageId] = useState<string>('');
  const [checkInputs, setCheckInputs] = useState<Record<string, any>>({});
  const [bossMode, setBossMode] = useState(false);
  const [bossResults, setBossResults] = useState<RunQuestionResult[] | null>(null);
  const [tocQuery, setTocQuery] = useState('');
  const contentColumnRef = useRef<HTMLDivElement | null>(null);

  const lessonProgress = state.lessonProgress[packId] ?? { completedPages: [], checkResults: {}, xp: 0 };
  const completedPages = useMemo(() => new Set(lessonProgress.completedPages), [lessonProgress.completedPages]);

  useEffect(() => {
    if (!lesson) return;
    if (!activeModuleId) {
      setActiveModuleId(lesson.modules[0]?.id ?? '');
    }
  }, [lesson, activeModuleId]);

  useEffect(() => {
    if (!lesson || !activeModuleId) return;
    const activeModule = lesson.modules.find((m) => m.id === activeModuleId) ?? lesson.modules[0];
    if (!activeModule) return;
    if (!activePageId || !activeModule.pages.some((p) => p.id === activePageId)) {
      setActivePageId(activeModule.pages[0]?.id ?? '');
    }
  }, [lesson, activeModuleId, activePageId]);

  useEffect(() => {
    if (!lesson || !activeModuleId || !activePageId) return;
    updateState((prev) => {
      const current = prev.lessonProgress[packId] ?? { completedPages: [], checkResults: {}, xp: 0 };
      if (current.lastModuleId === activeModuleId && current.lastPageId === activePageId) return prev;
      return {
        ...prev,
        lessonProgress: {
          ...prev.lessonProgress,
          [packId]: {
            ...current,
            lastViewed: new Date().toISOString(),
            lastModuleId: activeModuleId,
            lastPageId: activePageId
          }
        }
      };
    });
  }, [lesson, activeModuleId, activePageId, packId, updateState]);

  useEffect(() => {
    setCheckInputs({});
  }, [activePageId]);

  const recallItems = useMemo(() => (lesson ? buildRecallItems(lesson) : []), [lesson]);
  const recallState = state.lessonRecall[packId]?.items ?? {};
  const now = new Date();
  const dueRecallItems = recallItems.filter((item) => {
    const saved = recallState[item.id];
    if (!saved) return true;
    return new Date(saved.due) <= now;
  });

  const continueTarget = useMemo(() => {
    if (!lesson) return null;
    const lastModuleId = lessonProgress.lastModuleId;
    const lastPageId = lessonProgress.lastPageId;
    if (lastModuleId && lastPageId) {
      const mod = lesson.modules.find((m) => m.id === lastModuleId);
      const page = mod?.pages.find((p) => p.id === lastPageId);
      if (mod && page) {
        return {
          moduleId: mod.id,
          pageId: page.id,
          label: `${mod.title} • ${page.title}`
        };
      }
    }
    for (const mod of lesson.modules) {
      for (const page of mod.pages) {
        if (!completedPages.has(page.id)) {
          return {
            moduleId: mod.id,
            pageId: page.id,
            label: `${mod.title} • ${page.title}`
          };
        }
      }
    }
    const firstModule = lesson.modules[0];
    const firstPage = firstModule?.pages[0];
    return firstModule && firstPage
      ? { moduleId: firstModule.id, pageId: firstPage.id, label: `${firstModule.title} • ${firstPage.title}` }
      : null;
  }, [lesson, lessonProgress.lastModuleId, lessonProgress.lastPageId, completedPages]);

  const tocModules = useMemo<LessonTocModuleEntry[]>(() => {
    if (!lesson) return [];
    const query = tocQuery.trim().toLowerCase();
    return lesson.modules
      .map((module) => {
        if (!query) {
          return { module, pages: module.pages };
        }
        const matchesModule = module.title.toLowerCase().includes(query);
        const filteredPages = matchesModule
          ? module.pages
          : module.pages.filter((page) => page.title.toLowerCase().includes(query));
        return { module, pages: filteredPages };
      })
      .filter((entry) => entry.pages.length > 0);
  }, [lesson, tocQuery]);

  const [activeRecallItems, setActiveRecallItems] = useState<LessonRecallItem[]>([]);
  const [recallInputs, setRecallInputs] = useState<Record<string, any>>({});
  const [recallRevealed, setRecallRevealed] = useState<Record<string, boolean>>({});
  const [recallPendingGrade, setRecallPendingGrade] = useState<Record<string, boolean>>({});
  const [queryTargetApplied, setQueryTargetApplied] = useState(false);
  const [queryScrollRequested, setQueryScrollRequested] = useState(false);

  useEffect(() => {
    setQueryTargetApplied(false);
  }, [packId, moduleFromQuery, pageFromQuery, modeFromQuery]);

  useEffect(() => {
    if (!lesson || queryTargetApplied) return;

    if (modeFromQuery === 'recall') {
      setTab('recall');
    }

    if (!moduleFromQuery && !pageFromQuery) {
      setQueryTargetApplied(true);
      return;
    }

    const moduleById = moduleFromQuery
      ? lesson.modules.find((module) => module.id === moduleFromQuery)
      : undefined;
    const pageById = pageFromQuery
      ? lesson.modules.flatMap((module) => module.pages.map((page) => ({ moduleId: module.id, page })))
        .find((item) => item.page.id === pageFromQuery)
      : undefined;

    if (moduleById) {
      setActiveModuleId(moduleById.id);
      if (pageFromQuery && moduleById.pages.some((page) => page.id === pageFromQuery)) {
        setActivePageId(pageFromQuery);
      } else {
        setActivePageId(moduleById.pages[0]?.id ?? '');
      }
      setTab('learn');
      setQueryScrollRequested(true);
      setQueryTargetApplied(true);
      return;
    }

    if (pageById) {
      setActiveModuleId(pageById.moduleId);
      setActivePageId(pageById.page.id);
      setTab('learn');
      setQueryScrollRequested(true);
      setQueryTargetApplied(true);
      return;
    }

    setQueryTargetApplied(true);
  }, [lesson, moduleFromQuery, pageFromQuery, modeFromQuery, queryTargetApplied]);

  useEffect(() => {
    if (!queryScrollRequested) return;
    if (!activeModuleId || !activePageId) return;
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => contentColumnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    setQueryScrollRequested(false);
  }, [queryScrollRequested, activeModuleId, activePageId]);

  useEffect(() => {
    if (tab !== 'recall') return;
    if (activeRecallItems.length === 0 && dueRecallItems.length > 0) {
      setActiveRecallItems(shuffle(dueRecallItems).slice(0, DAILY_DRILL_LIMIT));
    }
  }, [tab, dueRecallItems, activeRecallItems.length]);

  const startRecallDrill = () => {
    const picks = shuffle(dueRecallItems).slice(0, DAILY_DRILL_LIMIT);
    setActiveRecallItems(picks);
    setRecallInputs({});
    setRecallRevealed({});
    setRecallPendingGrade({});
  };

  const applyRecallResult = (item: LessonRecallItem, result: 'correct' | 'wrong', myAnswer: string) => {
    if (!pack) return;
    const nowStamp = new Date();
    updateState((prev) => {
      const currentRecall = prev.lessonRecall[packId] ?? { items: {}, lastRun: undefined };
      const prevItem = currentRecall.items[item.id];
      let interval = prevItem?.interval ?? 1;
      let ease = prevItem?.ease ?? 2.3;
      let attempts = prevItem?.attempts ?? 0;
      let correct = prevItem?.correct ?? 0;

      attempts += 1;
      if (result === 'correct') {
        correct += 1;
        interval = Math.max(1, Math.round(interval * 2.2));
        ease = Math.min(2.8, ease + 0.1);
      } else {
        interval = 1;
        ease = Math.max(1.3, ease - 0.2);
      }

      const due = new Date(nowStamp.getTime() + interval * 24 * 60 * 60 * 1000).toISOString();
      const nextRecall = {
        ...currentRecall,
        items: {
          ...currentRecall.items,
          [item.id]: {
            interval,
            ease,
            due,
            attempts,
            correct,
            lastAnswered: nowStamp.toISOString()
          }
        },
        lastRun: nowStamp.toISOString()
      };

      let next = {
        ...prev,
        lessonRecall: { ...prev.lessonRecall, [packId]: nextRecall }
      };

      next = updateMasteryByTags(next, item.tag_ids, result === 'correct', false);

      if (result === 'wrong') {
        const guidance = deriveTagGuidance(pack, item.tag_ids, item.explanation);
        next = upsertMistakeCard(
          next,
          {
            pack_id: pack.pack_id,
            question_id: `lesson:${item.id}`,
            question_type: 'lesson',
            hints_used: false,
            objectiveIds: [],
            misconceptionTags: item.tag_ids,
            prompt: item.prompt,
            my_answer: myAnswer || 'No answer',
            correct_answer: item.answers ? item.answers.join(', ') : item.explanation,
            rule_of_thumb: guidance.rule_of_thumb,
            micro_example: guidance.micro_example,
            confusion_pair_id: guidance.confusion_pair_id,
            tags: item.tag_ids
          },
          'wrong',
          nowStamp
        );
      }

      return next;
    });
  };

  const handleCheckSubmit = (check: LessonCheck, checkIndex: number) => {
    if (!activePage) return;
    const checkKey = buildLessonCheckId(activePage.id, checkIndex);
    const input = checkInputs[checkKey];

    let correct = false;
    if (check.type === 'single_choice') {
      correct = typeof input === 'number' && input === check.correct_index;
    } else if (check.type === 'multi_select') {
      const selected = Array.isArray(input) ? input : [];
      const target = new Set(check.correct_indices);
      const picked = new Set(selected);
      correct = target.size === picked.size && Array.from(target).every((idx) => picked.has(idx));
    } else if (check.type === 'matching') {
      const matching = input ?? {};
      correct = check.left.every((left) => matching[left] === check.correct_map[left]);
    } else if (check.type === 'cloze') {
      const answers = Array.isArray(input) ? input : [];
      correct = check.answers.every((answer, idx) => normalizeAnswer(answer) === normalizeAnswer(answers[idx] ?? ''));
    }

    const nowStamp = new Date();
    updateState((prev) => {
      const current = prev.lessonProgress[packId] ?? { completedPages: [], checkResults: {}, xp: 0 };
      const prevResult = current.checkResults[checkKey];
      const nextResult = {
        attempts: (prevResult?.attempts ?? 0) + 1,
        correct: (prevResult?.correct ?? 0) + (correct ? 1 : 0),
        lastAnswered: nowStamp.toISOString()
      };
      const nextCheckResults = { ...current.checkResults, [checkKey]: nextResult };
      let completedPagesNext = [...current.completedPages];
      let xpGain = 0;

      if (correct && (!prevResult || prevResult.correct === 0)) {
        xpGain += LESSON_XP_RULES.per_check_correct;
      }

      const pageComplete = activePage.checks.every((_, idx) => {
        const key = buildLessonCheckId(activePage.id, idx);
        const result = key === checkKey ? nextResult : nextCheckResults[key];
        return (result?.correct ?? 0) > 0;
      });

      if (pageComplete && !completedPagesNext.includes(activePage.id)) {
        completedPagesNext = [...completedPagesNext, activePage.id];
        xpGain += LESSON_XP_RULES.per_page_complete;
      }

      return {
        ...prev,
        lessonProgress: {
          ...prev.lessonProgress,
          [packId]: {
            ...current,
            completedPages: completedPagesNext,
            checkResults: nextCheckResults,
            xp: current.xp + xpGain,
            lastViewed: nowStamp.toISOString()
          }
        },
        xpTotal: prev.xpTotal + xpGain
      };
    });
  };

  const renderCheck = (check: LessonCheck, index: number) => {
    const checkKey = buildLessonCheckId(activePage?.id ?? 'page', index);
    const result = lessonProgress.checkResults[checkKey];
    const attempts = result?.attempts ?? 0;
    const passed = (result?.correct ?? 0) > 0;

    if (check.type === 'single_choice') {
      const selected = checkInputs[checkKey] ?? null;
      return (
        <div className="answer-card" key={checkKey} style={{ marginBottom: 12 }}>
          <div className="tag">Single choice</div>
          <div style={{ fontWeight: 600, marginTop: 6 }}>{check.prompt}</div>
          <div className="grid" style={{ gap: 8, marginTop: 8 }}>
            {check.options.map((option, optionIndex) => {
              const isSelected = selected === optionIndex;
              const borderColor = passed
                ? optionIndex === check.correct_index
                  ? 'rgba(142,240,167,0.8)'
                  : 'rgba(255,255,255,0.08)'
                : isSelected
                  ? 'rgba(126,231,255,0.7)'
                  : 'rgba(255,255,255,0.08)';
              const background = passed
                ? 'rgba(255,255,255,0.02)'
                : isSelected
                  ? 'rgba(126,231,255,0.08)'
                  : 'transparent';
              return (
                <button
                  key={`${checkKey}-${option}`}
                  className="card"
                  style={{ textAlign: 'left', borderColor, background }}
                  disabled={passed}
                  onClick={() => setCheckInputs((prev) => ({ ...prev, [checkKey]: optionIndex }))}
                >
                  {option}
                </button>
              );
            })}
          </div>
          <button className="button secondary" disabled={passed || selected === null} style={{ marginTop: 8 }} onClick={() => handleCheckSubmit(check, index)}>
            {passed ? 'Completed' : 'Check answer'}
          </button>
          {attempts > 0 && (
            <div style={{ marginTop: 8, color: passed ? 'var(--success)' : 'var(--danger)' }}>
              {passed ? 'Correct' : 'Review needed'} · {check.explanation}
            </div>
          )}
        </div>
      );
    }

    if (check.type === 'multi_select') {
      const selected = (Array.isArray(checkInputs[checkKey]) ? checkInputs[checkKey] : []) as number[];
      return (
        <div className="answer-card" key={checkKey} style={{ marginBottom: 12 }}>
          <div className="tag">Multi-select</div>
          <div style={{ fontWeight: 600, marginTop: 6 }}>{check.prompt}</div>
          <div className="grid" style={{ gap: 8, marginTop: 8 }}>
            {check.options.map((option, optionIndex) => {
              const checked = selected.includes(optionIndex);
              return (
                <label
                  key={`${checkKey}-${option}`}
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
                    disabled={passed}
                    onChange={(e) => {
                      if (passed) return;
                      if (e.target.checked) {
                        setCheckInputs((prev) => ({ ...prev, [checkKey]: [...selected, optionIndex] }));
                      } else {
                        setCheckInputs((prev) => ({ ...prev, [checkKey]: selected.filter((idx) => idx !== optionIndex) }));
                      }
                    }}
                  />
                  {option}
                </label>
              );
            })}
          </div>
          <button className="button secondary" disabled={passed || selected.length === 0} style={{ marginTop: 8 }} onClick={() => handleCheckSubmit(check, index)}>
            {passed ? 'Completed' : 'Check answer'}
          </button>
          {attempts > 0 && (
            <div style={{ marginTop: 8, color: passed ? 'var(--success)' : 'var(--danger)' }}>
              {passed ? 'Correct' : 'Review needed'} · {check.explanation}
            </div>
          )}
        </div>
      );
    }

    if (check.type === 'matching') {
      const matching = checkInputs[checkKey] ?? {};
      const ready = check.left.every((left) => matching[left]);
      return (
        <div className="answer-card" key={checkKey} style={{ marginBottom: 12 }}>
          <div className="tag">Matching</div>
          <div style={{ fontWeight: 600, marginTop: 6 }}>{check.prompt}</div>
          <div className="grid" style={{ gap: 8, marginTop: 8 }}>
            {check.left.map((left) => (
              <div key={`${checkKey}-${left}`} className="answer-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div>{left}</div>
                <select
                  value={matching[left] ?? ''}
                  disabled={passed}
                  onChange={(e) => setCheckInputs((prev) => ({ ...prev, [checkKey]: { ...matching, [left]: e.target.value } }))}
                >
                  <option value="">Select</option>
                  {check.right.map((right) => (
                    <option key={`${checkKey}-${right}`} value={right}>{right}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <button className="button secondary" disabled={passed || !ready} style={{ marginTop: 8 }} onClick={() => handleCheckSubmit(check, index)}>
            {passed ? 'Completed' : 'Check answer'}
          </button>
          {attempts > 0 && (
            <div style={{ marginTop: 8, color: passed ? 'var(--success)' : 'var(--danger)' }}>
              {passed ? 'Correct' : 'Review needed'} · {check.explanation}
            </div>
          )}
        </div>
      );
    }

    const clozeAnswers = (Array.isArray(checkInputs[checkKey]) ? checkInputs[checkKey] : []) as string[];
    const ready = clozeAnswers.length === check.answers.length && clozeAnswers.every((value) => value.trim().length > 0);
    return (
      <div className="answer-card" key={checkKey} style={{ marginBottom: 12 }}>
        <div className="tag">Cloze</div>
        <div style={{ fontWeight: 600, marginTop: 6 }}>{check.prompt}</div>
        <div className="grid" style={{ gap: 8, marginTop: 8 }}>
          {check.answers.map((_, idx) => (
            <input
              key={`${checkKey}-answer-${idx}`}
              type="text"
              placeholder={`Answer ${idx + 1}`}
              value={clozeAnswers[idx] ?? ''}
              disabled={passed}
              onChange={(e) => {
                if (passed) return;
                const next = [...clozeAnswers];
                next[idx] = e.target.value;
                setCheckInputs((prev) => ({ ...prev, [checkKey]: next }));
              }}
            />
          ))}
        </div>
        <button className="button secondary" disabled={passed || !ready} style={{ marginTop: 8 }} onClick={() => handleCheckSubmit(check, index)}>
          {passed ? 'Completed' : 'Check answer'}
        </button>
        {attempts > 0 && (
          <div style={{ marginTop: 8, color: passed ? 'var(--success)' : 'var(--danger)' }}>
            {passed ? 'Correct' : `Review needed · Answer: ${check.answers.join(', ')}`} · {check.explanation}
          </div>
        )}
      </div>
    );
  };

  const renderRecallItem = (item: LessonRecallItem) => {
    const itemState = recallState[item.id];
    const dueLabel = itemState ? `Due ${new Date(itemState.due).toLocaleDateString()}` : 'New';
    const revealed = recallRevealed[item.id];
    const pendingGrade = recallPendingGrade[item.id];

    if (item.type === 'cloze') {
      const inputs = (Array.isArray(recallInputs[item.id]) ? recallInputs[item.id] : []) as string[];
      const ready = inputs.length === (item.answers?.length ?? 0) && inputs.every((value) => value.trim().length > 0);
      const handleSubmit = () => {
        if (!item.answers) return;
        const correct = item.answers.every((answer, idx) => normalizeAnswer(answer) === normalizeAnswer(inputs[idx] ?? ''));
        setRecallRevealed((prev) => ({ ...prev, [item.id]: true }));
        applyRecallResult(item, correct ? 'correct' : 'wrong', inputs.join(', '));
      };

      return (
        <div key={item.id} className="answer-card">
          <div className="panel-header">
            <div>
              <div className="tag">Cloze recall</div>
              <div style={{ fontWeight: 600 }}>{item.prompt}</div>
            </div>
            <div className="chip">{dueLabel}</div>
          </div>
          <div className="grid" style={{ gap: 8 }}>
            {(item.answers ?? []).map((_, idx) => (
              <input
                key={`${item.id}-${idx}`}
                type="text"
                placeholder={`Answer ${idx + 1}`}
                value={inputs[idx] ?? ''}
                disabled={revealed}
                onChange={(e) => {
                  if (revealed) return;
                  const next = [...inputs];
                  next[idx] = e.target.value;
                  setRecallInputs((prev) => ({ ...prev, [item.id]: next }));
                }}
              />
            ))}
          </div>
          <button className="button secondary" style={{ marginTop: 8 }} disabled={revealed || !ready} onClick={handleSubmit}>
            {revealed ? 'Completed' : 'Check recall'}
          </button>
          {revealed && (
            <div style={{ marginTop: 8, color: 'var(--muted)' }}>
              Expected: {(item.answers ?? []).join(', ')} · {item.explanation}
            </div>
          )}
        </div>
      );
    }

    const draft = (recallInputs[item.id] ?? '') as string;
    const reveal = () => {
      setRecallRevealed((prev) => ({ ...prev, [item.id]: true }));
      setRecallPendingGrade((prev) => ({ ...prev, [item.id]: true }));
    };

    return (
      <div key={item.id} className="answer-card">
        <div className="panel-header">
          <div>
            <div className="tag">Explain recall</div>
            <div style={{ fontWeight: 600 }}>{item.prompt}</div>
          </div>
          <div className="chip">{dueLabel}</div>
        </div>
        <textarea
          rows={3}
          value={draft}
          disabled={revealed}
          onChange={(e) => setRecallInputs((prev) => ({ ...prev, [item.id]: e.target.value }))}
          style={{ width: '100%', borderRadius: 10, padding: 10 }}
          placeholder="Write one sentence and end with a period."
        />
        <button className="button secondary" style={{ marginTop: 8 }} disabled={revealed || !isOneSentence(draft)} onClick={reveal}>
          {revealed ? 'Completed' : 'Reveal model answer'}
        </button>
        {revealed && (
          <div style={{ marginTop: 8, color: 'var(--muted)' }}>
            Model answer: {item.explanation}
          </div>
        )}
        {pendingGrade && (
          <div className="flex" style={{ marginTop: 10 }}>
            <button
              className="button"
              onClick={() => {
                setRecallPendingGrade((prev) => ({ ...prev, [item.id]: false }));
                applyRecallResult(item, 'correct', draft);
              }}
            >
              I got it
            </button>
            <button
              className="button secondary"
              onClick={() => {
                setRecallPendingGrade((prev) => ({ ...prev, [item.id]: false }));
                applyRecallResult(item, 'wrong', draft);
              }}
            >
              Missed it
            </button>
          </div>
        )}
      </div>
    );
  };

  const handleContinue = () => {
    if (!continueTarget) return;
    setActiveModuleId(continueTarget.moduleId);
    setActivePageId(continueTarget.pageId);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches) {
      window.requestAnimationFrame(() => contentColumnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  const bossQuestions = useMemo(() => {
    if (!pack) return [];
    const tagSet = lesson ? getLessonTagSet(lesson) : new Set<string>();
    const pool = pack.question_bank.filter((question) => question.tags.some((tag) => tagSet.has(tag)));
    return shuffle(pool).slice(0, Math.min(12, pool.length));
  }, [lesson, pack]);

  const scrollToContent = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    window.requestAnimationFrame(() => contentColumnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, []);

  if (!packsLoaded || !lessonsLoaded || !stateLoaded) {
    return <div className="card">Loading lessons...</div>;
  }

  if (!pack || !lesson) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return (
        <div className="card">
          <div className="tag">Offline</div>
          <h2 style={{ marginTop: 6 }}>Open once online to cache content</h2>
          <p style={{ color: 'var(--muted)' }}>Lesson content is not cached yet. Connect to the internet and refresh.</p>
          <Link href={'/map' as Route} className="button secondary">Back to map</Link>
        </div>
      );
    }
    return (
      <div className="card">
        Lesson content not found. Return to <Link href={'/map' as Route}>Campaign map</Link>.
      </div>
    );
  }

  const activeModule = lesson.modules.find((m) => m.id === activeModuleId) ?? lesson.modules[0];
  const activePage = activeModule?.pages.find((p) => p.id === activePageId) ?? activeModule?.pages[0];
  const activeModuleNumber = Math.max(1, lesson.modules.findIndex((module) => module.id === activeModule?.id) + 1);
  const linearLessonPages = lesson.modules.flatMap((module, moduleIndex) =>
    module.pages.map((page, pageIndex) => ({
      moduleId: module.id,
      pageId: page.id,
      label: `Module ${moduleIndex + 1}, Page ${pageIndex + 1}: ${page.title}`
    }))
  );
  const activeLinearIndex = activePage ? linearLessonPages.findIndex((entry) => entry.pageId === activePage.id) : -1;
  const previousLinearPage = activeLinearIndex > 0 ? linearLessonPages[activeLinearIndex - 1] : null;
  const nextLinearPage = activeLinearIndex >= 0 && activeLinearIndex < linearLessonPages.length - 1
    ? linearLessonPages[activeLinearIndex + 1]
    : null;

  const navigateToLinearPage = (target: { moduleId: string; pageId: string } | null) => {
    if (!target) return;
    setActiveModuleId(target.moduleId);
    setActivePageId(target.pageId);
    scrollToContent();
  };

  const chapterStats = lessonProgressSummary(lesson, completedPages);
  const lessonTags = getLessonTagSet(lesson);
  const masteryAverage = lessonTags.size
    ? Math.round(Array.from(lessonTags).reduce((sum, tag) => sum + (state.masteryByTag[tag] ?? 50), 0) / lessonTags.size)
    : 0;
  const allModulesComplete = lesson.modules.every((module) => module.pages.every((page) => completedPages.has(page.id)));
  const chapterUnlocked = allModulesComplete || masteryAverage >= MASTERY_THRESHOLD;

  return (
    <div className="lesson-shell grid" style={{ gap: 18 }}>
      <div className="card lesson-hero" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="tag">Lesson Mode</div>
          <h1 style={{ marginBottom: 6 }}>{pack.chapter.title}</h1>
          <p style={{ color: 'var(--muted)', maxWidth: 520 }}>Learn the chapter without the textbook. Complete modules or hit mastery {MASTERY_THRESHOLD}+ to unlock.</p>
          <div className="flex" style={{ marginTop: 10 }}>
            <div className="stat-pill">Lesson progress {chapterStats.percent}%</div>
            <div className="stat-pill">Lesson XP {lessonProgress.xp}</div>
            <div className="stat-pill">Mastery avg {masteryAverage}</div>
            <div className="stat-pill">{chapterUnlocked ? 'Chapter unlocked' : 'Chapter locked'}</div>
          </div>
          {process.env.NODE_ENV !== 'production' && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
              Lessons loaded: {lesson.modules.length} modules, {chapterStats.totalPages} pages total
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="chip">{chapterStats.completed}/{chapterStats.totalPages} pages</div>
          <div className="progress-bar" style={{ marginTop: 10, minWidth: 200 }}>
            <span style={{ width: `${chapterStats.percent}%` }} />
          </div>
        </div>
      </div>

      <div className="flex lesson-tabs">
        <button className={tab === 'learn' ? 'button' : 'button secondary'} onClick={() => setTab('learn')}>Learn</button>
        <button className={tab === 'recall' ? 'button' : 'button secondary'} onClick={() => setTab('recall')}>Recall Mode</button>
        <Link href={'/map' as Route} className="button secondary">Back to map</Link>
      </div>

      {tab === 'learn' && (
        <div className="grid lesson-layout">
          <LessonSidebar
            lesson={lesson}
            tocModules={tocModules}
            query={tocQuery}
            onQueryChange={setTocQuery}
            activeModuleId={activeModule?.id ?? ''}
            activePageId={activePage?.id ?? ''}
            completedPages={completedPages}
            onSelectModule={setActiveModuleId}
            onSelectPage={(moduleId, pageId) => {
              setActiveModuleId(moduleId);
              setActivePageId(pageId);
            }}
            onContinue={handleContinue}
            continueLabel={continueTarget?.label ?? null}
            onJumpModule={(moduleId) => {
              setActiveModuleId(moduleId);
              const targetModule = lesson.modules.find((module) => module.id === moduleId);
              const firstPageId = targetModule?.pages[0]?.id;
              if (firstPageId) setActivePageId(firstPageId);
            }}
            onNavigateToContent={scrollToContent}
          />

          <div ref={contentColumnRef} className="grid lesson-content-column">
            <div className="card lesson-boss-card">
              <div className="panel-header">
                <b>Chapter Boss Drill</b>
                <span className="tag">Lesson tags</span>
              </div>
              <p style={{ color: 'var(--muted)' }}>Run a short drill generated from this chapter&apos;s lesson tags.</p>
              {!bossMode && (
                <button className="button" onClick={() => { setBossMode(true); setBossResults(null); }}>Start boss drill</button>
              )}
              {bossResults && (
                <div className="answer-card lesson-boss-result">
                  <div style={{ fontWeight: 600 }}>Boss results</div>
                  <div style={{ color: 'var(--muted)' }}>Score {bossResults.filter((result) => result.correct).length}/{bossResults.length}</div>
                </div>
              )}
            </div>

            {bossMode ? (
              <div className="card">
                <div className="panel-header">
                  <b>Chapter Boss Drill</b>
                  <button className="button secondary" onClick={() => setBossMode(false)}>Exit</button>
                </div>
                {bossQuestions.length === 0 ? (
                  <div className="answer-card">No questions match the lesson tags yet.</div>
                ) : (
                  <QuestionFlow
                    pack={pack}
                    questions={bossQuestions}
                    mode="campaign"
                    title="Chapter Boss Drill"
                    subtitle="Questions drawn from lesson tags."
                    sessionKey={`lesson-boss:${packId}`}
                    stateBridge={{ state, updateState, loaded: stateLoaded }}
                    onComplete={(results) => {
                      setBossResults(results);
                      setBossMode(false);
                    }}
                    />
                )}
              </div>
            ) : (
              <LessonContent
                activeModule={activeModule}
                activePage={activePage}
                completedPages={completedPages}
                onSelectPage={(pageId) => {
                  setActivePageId(pageId);
                  scrollToContent();
                }}
                renderCheck={renderCheck}
                moduleNumber={activeModuleNumber}
                onPreviousPage={previousLinearPage ? () => navigateToLinearPage(previousLinearPage) : undefined}
                onNextPage={nextLinearPage ? () => navigateToLinearPage(nextLinearPage) : undefined}
                previousLabel={previousLinearPage?.label}
                nextLabel={nextLinearPage?.label}
              />
            )}
          </div>
        </div>
      )}

      {tab === 'recall' && (
        <div className="grid lesson-recall" style={{ gap: 16 }}>
          <div className="card">
            <div className="panel-header">
              <div>
                <div className="tag">Recall Mode</div>
                <h2 style={{ margin: '6px 0' }}>Daily drill</h2>
                <p style={{ color: 'var(--muted)' }}>Cloze prompts plus 1-sentence explain prompts. Misses create mistake cards.</p>
              </div>
              <div className="chip">Due {dueRecallItems.length}</div>
            </div>
            <div className="flex">
              <button className="button" onClick={startRecallDrill}>Start new drill</button>
              <Link href={'/review' as Route} className="button secondary">Review mistake cards</Link>
            </div>
          </div>

          <div className="grid" style={{ gap: 12 }}>
            {activeRecallItems.length === 0 && (
              <div className="card" style={{ color: 'var(--muted)' }}>No recall items due right now.</div>
            )}
            {activeRecallItems.map((item) => renderRecallItem(item))}
          </div>
        </div>
      )}
    </div>
  );
}
