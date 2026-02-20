'use client';

import { useEffect, useRef, useState } from 'react';
import { loadLocalState } from '@/lib/localState';
import { useLocalState } from '@/lib/useLocalState';
import type { LocalState, MistakeCard, RunHistoryItem } from '@/lib/types';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type ProgressExport = {
  version: number;
  exported_at: string;
  settings?: { require_lessons?: boolean };
  state: Partial<
    Pick<
      LocalState,
      'masteryByTag' | 'streak' | 'runHistory' | 'mistakeCards' | 'questionStats' | 'lessonProgress' | 'lessonRecall' | 'xpTotal'
    >
  >;
};

function parseDate(value?: string | null) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function mergeRecords<T>(current: Record<string, T>, incoming: Record<string, T>, chooser: (a: T, b: T) => T) {
  const merged: Record<string, T> = { ...current };
  Object.entries(incoming).forEach(([key, value]) => {
    merged[key] = merged[key] ? chooser(merged[key], value) : value;
  });
  return merged;
}

function normalizeRemediation(remediation: unknown) {
  if (!Array.isArray(remediation)) return [];
  return remediation
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      label: typeof (entry as { label?: unknown }).label === 'string'
        ? (entry as { label: string }).label.trim()
        : '',
      href: typeof (entry as { href?: unknown }).href === 'string'
        ? (entry as { href: string }).href.trim()
        : '',
      objectiveIds: Array.isArray((entry as { objectiveIds?: unknown }).objectiveIds)
        ? (entry as { objectiveIds: unknown[] }).objectiveIds.filter((value): value is string => typeof value === 'string')
        : undefined
    }))
    .filter((entry) => entry.label.length > 0 && entry.href.length > 0);
}

function isRunHistoryItem(value: unknown): value is RunHistoryItem {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RunHistoryItem>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.seed === 'string' &&
    (candidate.mode === 'campaign' || candidate.mode === 'roguelike' || candidate.mode === 'exam') &&
    typeof candidate.started_at === 'string'
  );
}

function isMistakeCard(value: unknown): value is MistakeCard {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MistakeCard>;
  return typeof candidate.question_id === 'string' && typeof candidate.pack_id === 'string';
}

export default function PwaControls() {
  const { updateState } = useLocalState();
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [installAvailable, setInstallAvailable] = useState(false);
  const [installOutcome, setInstallOutcome] = useState<string | null>(null);
  const [fallbackHint, setFallbackHint] = useState<string | null>(null);
  const [contentUpdate, setContentUpdate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
      setInstallAvailable(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => {
      setInstallPrompt(null);
      setInstallAvailable(false);
      setInstallOutcome('Installed');
    });
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OFFLINE_READY') {
        setOfflineReady(true);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    navigator.serviceWorker.ready.then(() => setOfflineReady(true)).catch(() => null);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('secplus_lessons_update_available');
    if (saved) setContentUpdate(true);
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || detail.type === 'lessons') {
        setContentUpdate(true);
      }
    };
    window.addEventListener('secplus-content-update', handler as EventListener);
    return () => window.removeEventListener('secplus-content-update', handler as EventListener);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone || installAvailable) {
      setFallbackHint(null);
    } else {
      setFallbackHint('Use browser menu → Add to Home screen');
    }
  }, [installAvailable]);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const result = await installPrompt.userChoice;
    setInstallOutcome(result.outcome === 'accepted' ? 'Installed' : 'Install dismissed');
    setInstallPrompt(null);
    setInstallAvailable(false);
  };

  const refreshContent = async () => {
    if (!('serviceWorker' in navigator)) return;
    window.localStorage.removeItem('secplus_packs_cache_v1');
    window.localStorage.removeItem('secplus_lessons_cache_v1');
    window.localStorage.removeItem('secplus_lessons_update_available');
    setContentUpdate(false);
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      window.location.reload();
      return;
    }
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      await registration.update();
    }
    const onControllerChange = () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    setTimeout(() => window.location.reload(), 1500);
  };

  const exportProgress = async () => {
    const state = await loadLocalState();
    const payload: ProgressExport = {
      version: 1,
      exported_at: new Date().toISOString(),
      settings: {
        require_lessons: window.localStorage.getItem('secplus_require_lessons') === 'true'
      },
      state: {
        masteryByTag: state.masteryByTag,
        streak: state.streak,
        runHistory: state.runHistory,
        mistakeCards: state.mistakeCards,
        questionStats: state.questionStats,
        lessonProgress: state.lessonProgress,
        lessonRecall: state.lessonRecall,
        xpTotal: state.xpTotal
      }
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `secplus-progress-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importProgress = async (file: File) => {
    const text = await file.text();
    let data: ProgressExport;
    try {
      data = JSON.parse(text);
    } catch {
      alert('Invalid JSON file.');
      return;
    }

    if (!data?.state || typeof data.state !== 'object') {
      alert('Missing progress data.');
      return;
    }

    updateState((current) => {
      const incoming = data.state;
      const mergedMastery = mergeRecords(current.masteryByTag, incoming.masteryByTag ?? {}, (a, b) => Math.max(a, b));
      const mergedStreak = {
        days: Math.max(current.streak.days, incoming.streak?.days ?? 0),
        lastActive: parseDate(incoming.streak?.lastActive) > parseDate(current.streak.lastActive)
          ? incoming.streak?.lastActive ?? current.streak.lastActive
          : current.streak.lastActive
      };
      const incomingRunHistory = (incoming.runHistory ?? []).filter(isRunHistoryItem);
      const mergedRunHistory = [...current.runHistory, ...incomingRunHistory]
        .reduce((map, item) => {
          map.set(item.id, item);
          return map;
        }, new Map<string, RunHistoryItem>());
      const runHistory = Array.from(mergedRunHistory.values())
        .sort((a, b) => parseDate(b.started_at) - parseDate(a.started_at))
        .slice(0, 50);

      const mergedMistakeCards = [...current.mistakeCards];
      (incoming.mistakeCards ?? []).filter(isMistakeCard).forEach((card) => {
        const normalizedCard = {
          ...card,
          nextDueAt: card.nextDueAt ?? card.due ?? new Date().toISOString(),
          due: card.due ?? card.nextDueAt ?? new Date().toISOString(),
          question_type: card.question_type ?? 'mcq',
          hints_used: card.hints_used ?? false,
          objectiveIds: card.objectiveIds ?? [],
          misconceptionTags: card.misconceptionTags ?? [],
          tags: card.tags ?? [],
          remediation: normalizeRemediation(card.remediation)
        };
        const idx = mergedMistakeCards.findIndex((c) => c.question_id === normalizedCard.question_id);
        if (idx === -1) {
          mergedMistakeCards.push(normalizedCard);
        } else {
          const existing = mergedMistakeCards[idx];
          mergedMistakeCards[idx] = parseDate(normalizedCard.last_reviewed) > parseDate(existing.last_reviewed) ? normalizedCard : existing;
        }
      });

      const mergedQuestionStats = mergeRecords(current.questionStats, incoming.questionStats ?? {}, (a: any, b: any) => {
        const choose = parseDate(b.lastAnswered) > parseDate(a.lastAnswered) ? b : a;
        return {
          ...choose,
          attempts: Math.max(a.attempts ?? 0, b.attempts ?? 0),
          correct: Math.max(a.correct ?? 0, b.correct ?? 0)
        };
      });

      const mergedLessonProgress = mergeRecords(current.lessonProgress, incoming.lessonProgress ?? {}, (a: any, b: any) => {
        const completed = Array.from(new Set([...(a.completedPages ?? []), ...(b.completedPages ?? [])]));
        const checkResults = mergeRecords(a.checkResults ?? {}, b.checkResults ?? {}, (x: any, y: any) => {
          const pick = parseDate(y.lastAnswered) > parseDate(x.lastAnswered) ? y : x;
          return {
            ...pick,
            attempts: Math.max(x.attempts ?? 0, y.attempts ?? 0),
            correct: Math.max(x.correct ?? 0, y.correct ?? 0)
          };
        });
        return {
          ...a,
          ...b,
          completedPages: completed,
          checkResults,
          xp: Math.max(a.xp ?? 0, b.xp ?? 0)
        };
      });

      const mergedLessonRecall = mergeRecords(current.lessonRecall, incoming.lessonRecall ?? {}, (a: any, b: any) => {
        const items = mergeRecords(a.items ?? {}, b.items ?? {}, (x: any, y: any) => {
          return parseDate(y.lastAnswered) > parseDate(x.lastAnswered) ? y : x;
        });
        return {
          ...a,
          ...b,
          items,
          lastRun: parseDate(b.lastRun) > parseDate(a.lastRun) ? b.lastRun : a.lastRun
        };
      });

      return {
        ...current,
        masteryByTag: mergedMastery,
        streak: mergedStreak,
        runHistory,
        mistakeCards: mergedMistakeCards,
        questionStats: mergedQuestionStats,
        lessonProgress: mergedLessonProgress,
        lessonRecall: mergedLessonRecall,
        xpTotal: Math.max(current.xpTotal, incoming.xpTotal ?? 0)
      };
    });

    if (data.settings?.require_lessons !== undefined) {
      window.localStorage.setItem('secplus_require_lessons', data.settings.require_lessons ? 'true' : 'false');
    }
  };

  return (
    <div className="flex" style={{ gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', paddingTop: 10 }}>
      {installAvailable && (
        <button className="button" onClick={handleInstall}>Install</button>
      )}
      {!installAvailable && fallbackHint && (
        <span className="stat-pill">{fallbackHint}</span>
      )}
      {installOutcome && <span className="stat-pill">{installOutcome}</span>}
      <span className="stat-pill">{offlineReady ? 'Offline Ready' : 'Caching...'}</span>
      {contentUpdate && <span className="stat-pill">Lesson updates available — refresh</span>}
      <button className="button secondary" onClick={refreshContent}>Refresh content</button>
      <button className="button secondary" onClick={exportProgress}>Export progress</button>
      <button
        className="button secondary"
        onClick={() => fileInputRef.current?.click()}
      >
        Import progress
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) importProgress(file);
          event.target.value = '';
        }}
      />
    </div>
  );
}
