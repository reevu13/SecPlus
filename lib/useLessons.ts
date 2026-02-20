'use client';

import { useEffect, useState } from 'react';
import { ChapterLesson } from './types';

const CACHE_KEY = 'secplus_lessons_cache_v1';
const VERSION_KEY = 'secplus_lessons_versions_v1';
const UPDATE_KEY = 'secplus_lessons_update_available';

function getLessonVersions(lessons: ChapterLesson[]) {
  return lessons.reduce<Record<string, string>>((acc, lesson) => {
    acc[lesson.pack_id] = lesson.version;
    return acc;
  }, {});
}

function hasVersionChange(prev: Record<string, string> | null, next: Record<string, string>) {
  if (!prev) return false;
  return Object.keys(next).some((key) => prev[key] && prev[key] !== next[key])
    || Object.keys(prev).some((key) => !(key in next));
}

export function useLessons() {
  const [lessons, setLessons] = useState<ChapterLesson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const loadCached = () => {
      try {
        const raw = window.localStorage.getItem(CACHE_KEY);
        if (raw) setLessons(JSON.parse(raw));
      } catch {
        // ignore cache errors
      }
    };

    const load = async () => {
      try {
        const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
        const res = await fetch(`${basePath}/api/lessons`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load lessons');
        const data = await res.json();
        setLessons(data.lessons);
        window.localStorage.setItem(CACHE_KEY, JSON.stringify(data.lessons));
        const versions = getLessonVersions(data.lessons);
        window.localStorage.setItem(VERSION_KEY, JSON.stringify(versions));
        const lessonFiles: string[] = data.lesson_files ?? [];
        lessonFiles.forEach((file) => fetch(`${basePath}/content/chapter_lessons/${file}`).catch(() => null));

        const checkForUpdates = async () => {
          try {
            if (!navigator.onLine) return;
            const freshRes = await fetch(`${basePath}/api/lessons?fresh=1`, {
              cache: 'no-store',
              headers: { 'x-skip-cache': '1' }
            });
            if (!freshRes.ok) return;
            const freshData = await freshRes.json();
            const nextVersions = getLessonVersions(freshData.lessons ?? []);
            const prevRaw = window.localStorage.getItem(VERSION_KEY);
            const prevVersions = prevRaw ? (JSON.parse(prevRaw) as Record<string, string>) : null;
            if (hasVersionChange(prevVersions, nextVersions)) {
              window.localStorage.setItem(UPDATE_KEY, new Date().toISOString());
              window.dispatchEvent(new CustomEvent('secplus-content-update', { detail: { type: 'lessons' } }));
            }
            window.localStorage.setItem(VERSION_KEY, JSON.stringify(nextVersions));
          } catch {
            // ignore background check errors
          }
        };

        window.setTimeout(checkForUpdates, 1200);
      } catch (err) {
        loadCached();
        setError((err as Error).message);
      } finally {
        setLoaded(true);
      }
    };

    load();
  }, []);

  return { lessons, error, loaded };
}
