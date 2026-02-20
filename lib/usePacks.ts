'use client';

import { useEffect, useState } from 'react';
import { ChapterPack } from './types';

const CACHE_KEY = 'secplus_packs_cache_v1';

function sortPacks(packs: ChapterPack[]) {
  return [...packs].sort((a, b) => {
    const chapterA = Number.isFinite(a.chapter?.number) ? a.chapter.number : Number.MAX_SAFE_INTEGER;
    const chapterB = Number.isFinite(b.chapter?.number) ? b.chapter.number : Number.MAX_SAFE_INTEGER;
    if (chapterA !== chapterB) return chapterA - chapterB;
    return a.pack_id.localeCompare(b.pack_id, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export function usePacks() {
  const [packs, setPacks] = useState<ChapterPack[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const loadCached = () => {
      try {
        const raw = window.localStorage.getItem(CACHE_KEY);
        if (raw) setPacks(sortPacks(JSON.parse(raw)));
      } catch {
        // ignore cache errors
      }
    };

    const load = async () => {
      try {
        const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
        const res = await fetch(`${basePath}/api/packs`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load packs');
        const data = await res.json();
        const sortedPacks = sortPacks(data.packs ?? []);
        setPacks(sortedPacks);
        window.localStorage.setItem(CACHE_KEY, JSON.stringify(sortedPacks));
        const packFiles: string[] = data.pack_files ?? [];
        const enrichFiles: string[] = data.enrichment_files ?? [];
        [...packFiles.map((file) => `${basePath}/content/chapter_packs/${file}`),
          ...enrichFiles.map((file) => `${basePath}/content/chapter_enrichment/${file}`)]
          .forEach((url) => fetch(url).catch(() => null));
      } catch (err) {
        loadCached();
        setError((err as Error).message);
      } finally {
        setLoaded(true);
      }
    };

    load();
  }, []);

  return { packs, error, loaded };
}
