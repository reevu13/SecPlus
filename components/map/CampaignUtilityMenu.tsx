'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LocalState } from '@/lib/types';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type ProgressExport = {
  version: number;
  exported_at: string;
  settings?: { require_lessons?: boolean };
  state: LocalState;
};

type CampaignUtilityMenuProps = {
  state: LocalState;
  updateState: (updater: (state: LocalState) => LocalState) => void;
  requireLessons: boolean;
  onRequireLessonsImported: (enabled: boolean) => void;
  offlineStatus: 'Online' | 'Offline';
};

function parseDate(value?: string | null) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
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

function mergeProgress(current: LocalState, incoming: Partial<LocalState>): LocalState {
  const incomingMastery = incoming.masteryByTag ?? {};
  const masteryByTag: Record<string, number> = { ...current.masteryByTag };
  Object.entries(incomingMastery).forEach(([tag, score]) => {
    masteryByTag[tag] = Math.max(masteryByTag[tag] ?? 0, typeof score === 'number' ? score : 0);
  });

  const runHistory = [...current.runHistory, ...(incoming.runHistory ?? [])].slice(0, 50);

  const mistakeByQuestion = new Map(current.mistakeCards.map((card) => [card.question_id, card]));
  (incoming.mistakeCards ?? []).forEach((card) => {
    if (!card || typeof card.question_id !== 'string') return;
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
    const existing = mistakeByQuestion.get(card.question_id);
    if (!existing || parseDate(normalizedCard.last_reviewed) > parseDate(existing.last_reviewed)) {
      mistakeByQuestion.set(card.question_id, normalizedCard);
    }
  });

  const questionStats = { ...current.questionStats, ...(incoming.questionStats ?? {}) };

  const lessonProgress = { ...current.lessonProgress };
  Object.entries(incoming.lessonProgress ?? {}).forEach(([packId, progress]) => {
    const currentProgress = lessonProgress[packId];
    if (!currentProgress) {
      lessonProgress[packId] = progress;
      return;
    }
    lessonProgress[packId] = {
      ...currentProgress,
      ...progress,
      completedPages: Array.from(new Set([...(currentProgress.completedPages ?? []), ...(progress.completedPages ?? [])])),
      checkResults: { ...currentProgress.checkResults, ...(progress.checkResults ?? {}) },
      xp: Math.max(currentProgress.xp ?? 0, progress.xp ?? 0)
    };
  });

  const lessonRecall = { ...current.lessonRecall, ...(incoming.lessonRecall ?? {}) };

  const nextLastActive =
    parseDate(incoming.streak?.lastActive) > parseDate(current.streak.lastActive)
      ? incoming.streak?.lastActive ?? current.streak.lastActive
      : current.streak.lastActive;

  return {
    ...current,
    masteryByTag,
    streak: {
      days: Math.max(current.streak.days, incoming.streak?.days ?? 0),
      lastActive: nextLastActive
    },
    runHistory,
    mistakeCards: Array.from(mistakeByQuestion.values()),
    questionStats,
    lessonProgress,
    lessonRecall,
    xpTotal: Math.max(current.xpTotal, incoming.xpTotal ?? 0)
  };
}

export default function CampaignUtilityMenu({
  state,
  updateState,
  requireLessons,
  onRequireLessonsImported,
  offlineStatus
}: CampaignUtilityMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installHint, setInstallHint] = useState<string>('');
  const [installResult, setInstallResult] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
      setInstallHint('');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const canInstall = useMemo(() => Boolean(installPrompt), [installPrompt]);

  const refreshContent = async () => {
    window.localStorage.removeItem('secplus_packs_cache_v1');
    window.localStorage.removeItem('secplus_lessons_cache_v1');
    window.localStorage.removeItem('secplus_lessons_update_available');
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      await registration?.update();
    }
    window.location.reload();
  };

  const exportProgress = () => {
    const payload: ProgressExport = {
      version: 1,
      exported_at: new Date().toISOString(),
      settings: { require_lessons: requireLessons },
      state
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `secplus-progress-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importProgress = async (file: File) => {
    let data: any;
    try {
      data = JSON.parse(await file.text());
    } catch {
      alert('Invalid JSON file.');
      return;
    }

    if (!data || typeof data !== 'object' || !data.state || typeof data.state !== 'object') {
      alert('Missing progress payload.');
      return;
    }

    updateState((current) => mergeProgress(current, data.state as Partial<LocalState>));

    if (data.settings && typeof data.settings.require_lessons === 'boolean') {
      window.localStorage.setItem('secplus_require_lessons', data.settings.require_lessons ? 'true' : 'false');
      onRequireLessonsImported(data.settings.require_lessons);
    }
  };

  const handleInstall = async () => {
    if (!installPrompt) {
      setInstallHint('Use browser menu -> Add to Home screen');
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallResult(choice.outcome === 'accepted' ? 'Installed' : 'Install dismissed');
    setInstallPrompt(null);
  };

  return (
    <div className="campaign-menu-shell">
      <button
        className="button secondary campaign-menu-button"
        onClick={() => setMenuOpen((prev) => !prev)}
        aria-expanded={menuOpen}
      >
        More
      </button>

      {menuOpen && (
        <div className="campaign-menu-popover">
          <button className="campaign-menu-item" onClick={handleInstall}>
            <span>Install app</span>
            <span className="campaign-menu-meta">{canInstall ? 'Available' : 'Manual'}</span>
          </button>
          <div className="campaign-menu-item static">
            <span>Offline</span>
            <span className="campaign-menu-meta">{offlineStatus}</span>
          </div>
          <button className="campaign-menu-item" onClick={refreshContent}>
            <span>Refresh content</span>
            <span className="campaign-menu-meta">Reload</span>
          </button>
          <button className="campaign-menu-item" onClick={exportProgress}>
            <span>Export progress</span>
            <span className="campaign-menu-meta">JSON</span>
          </button>
          <button className="campaign-menu-item" onClick={() => fileInputRef.current?.click()}>
            <span>Import progress</span>
            <span className="campaign-menu-meta">JSON</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="campaign-hidden-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importProgress(file);
              event.target.value = '';
            }}
          />
          {(installHint || installResult) && (
            <div className="campaign-menu-note">{installResult || installHint}</div>
          )}
        </div>
      )}
    </div>
  );
}
