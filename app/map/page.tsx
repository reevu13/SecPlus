'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Route } from 'next';
import { usePacks } from '@/lib/usePacks';
import { useLessons } from '@/lib/useLessons';
import { useLocalState } from '@/lib/useLocalState';
import { useObjectives } from '@/lib/useObjectives';
import { ChapterLesson, ChapterPack, LocalState } from '@/lib/types';
import type { OutlineMapDoc } from '@/lib/coverage';
import { packProgressSummary, missionStats } from '@/lib/stats';
import { resetChapterCampaignProgress, topWeakTags } from '@/lib/progress';
import { getLessonTagSet } from '@/lib/lessonUtils';
import {
  buildNextBestActivityPlan,
  computeMisconceptionMastery,
  computeMisconceptionPriority,
  computeObjectiveMastery,
  storeCoachingPlan
} from '@/lib/adaptiveSequencing';
import CampaignHero from '@/components/map/CampaignHero';
import FocusAreasPanel, { FocusAreaItem } from '@/components/map/FocusAreasPanel';
import LessonGateCard from '@/components/map/LessonGateCard';
import ChapterCard, { ChapterMissionRow } from '@/components/map/ChapterCard';
import CampaignUtilityMenu from '@/components/map/CampaignUtilityMenu';

const MASTERY_THRESHOLD = 95;

type NextMission = {
  id: string;
  label: string;
  href: Route;
  isBoss: boolean;
};

type ChapterCardModel = {
  pack: ChapterPack;
  progressPercent: number;
  lessonPercent: number | null;
  gateLocked: boolean;
  gateHint: string | null;
  primaryLabel: string;
  primaryHref: Route;
  primaryDisabled: boolean;
  nextRecommendedText: string | null;
  missions: ChapterMissionRow[];
};

function bossStats(state: LocalState, pack: ChapterPack) {
  const questionIds = pack.boss.question_ids;
  const total = questionIds.length;
  const touched = questionIds.filter((id) => state.questionStats[id]).length;
  let attempts = 0;
  let correct = 0;
  questionIds.forEach((id) => {
    const stat = state.questionStats[id];
    if (!stat) return;
    attempts += stat.attempts;
    correct += stat.correct;
  });
  return {
    completion: total ? Math.min(100, Math.round((touched / total) * 100)) : 0,
    accuracy: attempts ? Math.round((correct / attempts) * 100) : 0
  };
}

function getNextMission(pack: ChapterPack, state: LocalState): NextMission | null {
  for (const mission of pack.missions) {
    const stats = missionStats(state, pack, mission);
    if (stats.completion < 100) {
      return {
        id: mission.id,
        label: mission.name,
        href: `/mission/${encodeURIComponent(mission.id)}` as Route,
        isBoss: false
      };
    }
  }
  const boss = bossStats(state, pack);
  if (boss.completion < 100) {
    return {
      id: pack.boss.id,
      label: pack.boss.name,
      href: `/mission/${encodeURIComponent(pack.boss.id)}` as Route,
      isBoss: true
    };
  }
  return null;
}

function calculateLessonGate(pack: ChapterPack, lesson: ChapterLesson | undefined, state: LocalState) {
  if (!lesson) return { gateLocked: false, lessonPercent: null, lessonUnlocked: true };

  const lessonProgress = state.lessonProgress[pack.pack_id] ?? { completedPages: [], checkResults: {}, xp: 0 };
  const completedPages = new Set(lessonProgress.completedPages);
  const totalLessonPages = lesson.modules.reduce((sum, module) => sum + module.pages.length, 0);
  const completedLessonPages = lesson.modules.reduce(
    (sum, module) => sum + module.pages.filter((page) => completedPages.has(page.id)).length,
    0
  );
  const lessonPercent = totalLessonPages ? Math.round((completedLessonPages / totalLessonPages) * 100) : 0;
  const lessonTags = getLessonTagSet(lesson);
  const masteryAverage = lessonTags.size
    ? Math.round(Array.from(lessonTags).reduce((sum, tag) => sum + (state.masteryByTag[tag] ?? 50), 0) / lessonTags.size)
    : 0;
  const modulesComplete = lesson.modules.every((module) => module.pages.every((page) => completedPages.has(page.id)));
  const lessonUnlocked = modulesComplete || masteryAverage >= MASTERY_THRESHOLD;

  return { gateLocked: !lessonUnlocked, lessonPercent, lessonUnlocked };
}

export default function MapPage() {
  const { packs, loaded, error } = usePacks();
  const { lessons } = useLessons();
  const { doc: objectivesDoc } = useObjectives();
  const { state, updateState } = useLocalState();
  const [requireLessons, setRequireLessons] = useState(false);
  const [offlineStatus, setOfflineStatus] = useState<'Online' | 'Offline'>('Online');
  const [selectedFocusTags, setSelectedFocusTags] = useState<string[]>([]);
  const [outlineMapDoc, setOutlineMapDoc] = useState<OutlineMapDoc | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('secplus_require_lessons');
    if (saved) setRequireLessons(saved === 'true');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('secplus_require_lessons', requireLessons ? 'true' : 'false');
  }, [requireLessons]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateOnlineStatus = () => setOfflineStatus(window.navigator.onLine ? 'Online' : 'Offline');
    updateOnlineStatus();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    const loadOutlineMap = async () => {
      try {
        const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
        const res = await fetch(`${basePath}/content/mappings/outline_map.json`, { cache: 'no-store' });
        if (!res.ok) {
          setOutlineMapDoc(null);
          return;
        }
        const data = (await res.json()) as OutlineMapDoc;
        setOutlineMapDoc(data);
      } catch {
        setOutlineMapDoc(null);
      }
    };
    loadOutlineMap();
  }, []);

  const now = useMemo(() => new Date(), []);

  const lessonsByPack = useMemo(() => new Map(lessons.map((lesson) => [lesson.pack_id, lesson])), [lessons]);
  const weakTags = useMemo(() => topWeakTags(state.masteryByTag, 8), [state.masteryByTag]);

  const focusAreas = useMemo<FocusAreaItem[]>(
    () => weakTags.map((tag) => ({ tag, mastery: state.masteryByTag[tag] ?? 50 })),
    [state.masteryByTag, weakTags]
  );

  const masteryAcrossAllTags = useMemo(() => {
    const allTags = new Set(packs.flatMap((pack) => pack.tags.concepts));
    if (allTags.size === 0) return 0;
    const total = Array.from(allTags).reduce((sum, tag) => sum + (state.masteryByTag[tag] ?? 50), 0);
    return Math.round(total / allTags.size);
  }, [packs, state.masteryByTag]);

  const objectiveMastery = useMemo(() => {
    if (!objectivesDoc) return { rows: [], sortedWeakest: [] };
    return computeObjectiveMastery(objectivesDoc, packs, state, now);
  }, [objectivesDoc, packs, state, now]);

  const misconceptionPriority = useMemo(() => {
    const misconceptionMastery = computeMisconceptionMastery(packs, state, now);
    return computeMisconceptionPriority(state, objectiveMastery.rows, misconceptionMastery.rows, now);
  }, [packs, state, objectiveMastery.rows, now]);

  const nextBestPlan = useMemo(() => buildNextBestActivityPlan({
    weakestObjectives: objectiveMastery.sortedWeakest,
    misconceptionPriority,
    outlineMap: outlineMapDoc,
    packs,
    lessons,
    state,
    now
  }), [objectiveMastery.sortedWeakest, misconceptionPriority, outlineMapDoc, packs, lessons, state, now]);

  useEffect(() => {
    if (!nextBestPlan) return;
    storeCoachingPlan(nextBestPlan);
  }, [nextBestPlan]);

  const chapterCards = useMemo<ChapterCardModel[]>(() => {
    return packs.map((pack) => {
      const summary = packProgressSummary(state, pack);
      const lesson = lessonsByPack.get(pack.pack_id);
      const lessonGate = calculateLessonGate(pack, lesson, state);
      const gateLocked = requireLessons && lessonGate.gateLocked;
      const nextMission = getNextMission(pack, state);

      const missionRows: ChapterMissionRow[] = pack.missions.map((mission, index) => {
        const stats = missionStats(state, pack, mission);
        return {
          id: mission.id,
          kicker: `Mission ${index + 1}`,
          label: mission.name,
          meta: `Accuracy ${stats.accuracy}% · Completion ${stats.completion}%`,
          href: `/mission/${encodeURIComponent(mission.id)}` as Route,
          actionLabel: stats.completion >= 100 ? 'Replay' : 'Play',
          locked: gateLocked
        };
      });

      const boss = bossStats(state, pack);
      missionRows.push({
        id: pack.boss.id,
        kicker: 'Boss',
        label: pack.boss.name,
        meta: `Boss · Accuracy ${boss.accuracy}% · Completion ${boss.completion}%`,
        href: `/mission/${encodeURIComponent(pack.boss.id)}` as Route,
        actionLabel: boss.completion >= 100 ? 'Replay' : 'Fight',
        locked: gateLocked
      });

      let primaryLabel = 'Learn';
      let primaryHref = `/chapter/${pack.pack_id}` as Route;
      let primaryDisabled = false;
      let nextRecommendedText: string | null = null;

      const hasLesson = Boolean(lesson);
      if (hasLesson) {
        if ((lessonGate.lessonPercent ?? 0) > 0 && (lessonGate.lessonPercent ?? 0) < 100) {
          primaryLabel = 'Continue learning';
        } else if ((lessonGate.lessonPercent ?? 0) >= 100) {
          primaryLabel = 'Review';
        } else {
          primaryLabel = 'Learn';
        }
        primaryHref = `/chapter/${pack.pack_id}` as Route;
      } else if (!gateLocked && nextMission) {
        primaryLabel = 'Continue';
        primaryHref = nextMission.href;
      } else if (!gateLocked && !nextMission) {
        primaryLabel = 'Review';
      }

      if (!gateLocked && nextMission) {
        nextRecommendedText = `Next mission: ${nextMission.isBoss ? 'Boss' : 'Mission'} · ${nextMission.label}`;
      }

      return {
        pack,
        progressPercent: summary.percent,
        lessonPercent: lessonGate.lessonPercent,
        gateLocked,
        gateHint: gateLocked ? `Lesson gate active · reach mastery ${MASTERY_THRESHOLD}+ or complete lesson modules` : null,
        primaryLabel,
        primaryHref,
        primaryDisabled,
        nextRecommendedText,
        missions: missionRows
      };
    });
  }, [lessonsByPack, packs, requireLessons, state]);

  const chaptersComplete = useMemo(
    () => chapterCards.filter((card) => card.progressPercent >= 100).length,
    [chapterCards]
  );

  const heroContinue = useMemo(() => {
    const nextLearningChapter = chapterCards.find(
      (card) => card.lessonPercent === null || card.lessonPercent < 100
    );
    const fallback = nextLearningChapter ?? chapterCards[0];
    if (!fallback) {
      return { href: '/map' as Route, label: 'Continue', meta: 'No chapters available yet.' };
    }
    const hasLessonProgress = (fallback.lessonPercent ?? 0) > 0;
    return {
      href: `/chapter/${fallback.pack.pack_id}` as Route,
      label: hasLessonProgress ? 'Continue learning' : 'Start learning',
      meta: `Chapter ${fallback.pack.chapter.number} · ${fallback.pack.chapter.title}`
    };
  }, [chapterCards]);

  const practiceHref = (selectedFocusTags.length
    ? `/roguelike?focus=${encodeURIComponent(selectedFocusTags.join(','))}`
    : '/roguelike') as Route;

  if (!loaded) {
    return <div className="card">Loading campaign map...</div>;
  }

  if (error && packs.length === 0) {
    return <div className="card">Unable to load packs. Check your local JSON files.</div>;
  }

  return (
    <div className="grid campaign-map-page">
      <section className="campaign-hero-grid">
        <CampaignHero
          continueHref={heroContinue.href}
          continueLabel={heroContinue.label}
          continueMeta={heroContinue.meta}
          nextBestHref={nextBestPlan?.href as Route | undefined}
          nextBestLabel={nextBestPlan ? (nextBestPlan.activityKind === 'lesson_quick_check' ? 'Coach: lesson check' : 'Coach: next drill') : undefined}
          nextBestMeta={nextBestPlan ? `${nextBestPlan.objectiveId} · ${nextBestPlan.activityLabel} · Plan ${nextBestPlan.planId}` : undefined}
          mastery={masteryAcrossAllTags}
          chaptersComplete={chaptersComplete}
          chaptersTotal={packs.length}
          streakDays={state.streak.days}
          offlineStatus={offlineStatus}
          utilityMenu={(
            <CampaignUtilityMenu
              state={state}
              updateState={updateState}
              requireLessons={requireLessons}
              onRequireLessonsImported={setRequireLessons}
              offlineStatus={offlineStatus}
            />
          )}
        />

        <FocusAreasPanel
          items={focusAreas}
          selected={selectedFocusTags}
          onToggle={(tag) => {
            setSelectedFocusTags((prev) => (
              prev.includes(tag)
                ? prev.filter((item) => item !== tag)
                : [...prev, tag]
            ));
          }}
          practiceHref={practiceHref}
        />
      </section>

      <LessonGateCard
        threshold={MASTERY_THRESHOLD}
        enabled={requireLessons}
        onChange={setRequireLessons}
      />

      <section className="campaign-chapter-grid">
        {chapterCards.length === 0 && (
          <div className="card">No chapter packs found in `content/chapter_packs`.</div>
        )}
        {chapterCards.map((card) => (
          <ChapterCard
            key={card.pack.pack_id}
            chapterNumber={card.pack.chapter.number}
            title={card.pack.chapter.title}
            description={card.pack.design_intent.player_goal}
            progressPercent={card.progressPercent}
            lessonPercent={card.lessonPercent}
            primaryLabel={card.primaryLabel}
            primaryHref={card.primaryHref}
            primaryDisabled={card.primaryDisabled}
            nextRecommendedText={card.nextRecommendedText}
            gateHint={card.gateHint}
            missions={card.missions}
            onReset={() => {
              if (typeof window !== 'undefined') {
                const approved = window.confirm(
                  `Reset campaign progress for Chapter ${card.pack.chapter.number}? This removes mission stats and chapter mistake cards.`
                );
                if (!approved) return;
              }
              updateState((prev) => resetChapterCampaignProgress(prev, card.pack));
            }}
          />
        ))}
      </section>
    </div>
  );
}
