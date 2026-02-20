'use client';

import { useEffect, useState } from 'react';
import { ExamObjectivesDoc } from './types';

const CACHE_KEY = 'secplus_objectives_cache_v1';

export function useObjectives() {
  const [doc, setDoc] = useState<ExamObjectivesDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const loadCached = () => {
      try {
        const raw = window.localStorage.getItem(CACHE_KEY);
        if (raw) setDoc(JSON.parse(raw) as ExamObjectivesDoc);
      } catch {
        // ignore stale cache parsing failures
      }
    };

    const load = async () => {
      try {
        const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
        const res = await fetch(`${basePath}/api/objectives`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load objectives');
        const data = await res.json();
        const next = data.objectives as ExamObjectivesDoc;
        setDoc(next);
        window.localStorage.setItem(CACHE_KEY, JSON.stringify(next));
      } catch (err) {
        loadCached();
        setError((err as Error).message);
      } finally {
        setLoaded(true);
      }
    };

    load();
  }, []);

  return { doc, error, loaded };
}
