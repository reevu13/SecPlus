'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLessons } from '@/lib/useLessons';
import { usePacks } from '@/lib/usePacks';

type OutlineSection = {
  order: number;
  title: string;
  href: string;
  word_count: number;
  hash?: string;
};

type OutlineChapter = {
  order: number;
  title: string;
  href: string;
  word_count: number;
  hash?: string;
  sections: OutlineSection[];
};

type OutlineDoc = {
  generated_at: string;
  source_epub: string;
  chapters: OutlineChapter[];
};

type OutlineMapEntry = {
  outlineId: string;
  title: string;
  href: string;
  objectiveIds: string[];
  packId?: string;
  lessonIds?: string[];
  tags?: string[];
  status?: 'unmapped' | 'draft' | 'done';
};

type OutlineMapDoc = {
  version: string;
  source_outline: string;
  updated_at?: string;
  entries: OutlineMapEntry[];
};

type FlatOutlineRow = {
  outlineId: string;
  chapterOrder: number;
  sectionOrder: number;
  chapterTitle: string;
  title: string;
  href: string;
  wordCount: number;
  entry?: OutlineMapEntry;
  status: 'unmapped' | 'draft' | 'done';
  mapped: boolean;
};

const OBJECTIVE_ID_RE = /^\d+\.\d+$/;
const STATUS_VALUES = ['unmapped', 'draft', 'done'] as const;
type MappingStatus = (typeof STATUS_VALUES)[number];

function simpleHash(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeList(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function parseCsv(value: string) {
  return normalizeList(value.split(','));
}

function buildOutlineId(chapter: OutlineChapter, section?: OutlineSection) {
  const sectionOrder = section?.order ?? 0;
  const href = section?.href ?? chapter.href;
  const title = section?.title ?? chapter.title;
  const hashInput = `${chapter.order}|${href}|${title}`;
  return `ol-${chapter.order}-${sectionOrder}-${simpleHash(hashInput)}`;
}

function flattenOutline(doc: OutlineDoc): FlatOutlineRow[] {
  return doc.chapters.flatMap((chapter) => {
    if (Array.isArray(chapter.sections) && chapter.sections.length > 0) {
      return chapter.sections.map((section) => ({
        outlineId: buildOutlineId(chapter, section),
        chapterOrder: chapter.order,
        sectionOrder: section.order,
        chapterTitle: chapter.title,
        title: section.title,
        href: section.href,
        wordCount: section.word_count,
        status: 'unmapped',
        mapped: false
      }));
    }

    return [
      {
        outlineId: buildOutlineId(chapter),
        chapterOrder: chapter.order,
        sectionOrder: 0,
        chapterTitle: chapter.title,
        title: chapter.title,
        href: chapter.href,
        wordCount: chapter.word_count,
        status: 'unmapped',
        mapped: false
      }
    ];
  });
}

function buildEntryIndex(mapDoc: OutlineMapDoc | null) {
  return new Map((mapDoc?.entries ?? []).map((entry) => [entry.outlineId, entry]));
}

function isMapped(entry?: OutlineMapEntry) {
  if (!entry) return false;
  return (
    entry.objectiveIds.length > 0
    || Boolean(entry.packId)
    || Boolean(entry.lessonIds && entry.lessonIds.length > 0)
    || Boolean(entry.tags && entry.tags.length > 0)
  );
}

function normalizeStatus(status: string | undefined): MappingStatus | undefined {
  if (!status) return undefined;
  if ((STATUS_VALUES as readonly string[]).includes(status)) {
    return status as MappingStatus;
  }
  return undefined;
}

function effectiveStatus(entry?: OutlineMapEntry): MappingStatus {
  const explicit = normalizeStatus(entry?.status);
  if (explicit) return explicit;
  return isMapped(entry) ? 'draft' : 'unmapped';
}

function normalizeEntry(entry: OutlineMapEntry): OutlineMapEntry {
  const next: OutlineMapEntry = {
    outlineId: entry.outlineId,
    title: entry.title.trim(),
    href: entry.href.trim(),
    objectiveIds: normalizeList(entry.objectiveIds)
  };

  if (entry.packId?.trim()) next.packId = entry.packId.trim();
  if (entry.lessonIds && entry.lessonIds.length > 0) next.lessonIds = normalizeList(entry.lessonIds);
  if (entry.tags && entry.tags.length > 0) next.tags = normalizeList(entry.tags);
  const status = normalizeStatus(entry.status);
  if (status) next.status = status;

  return next;
}

function defaultMapDoc(): OutlineMapDoc {
  return {
    version: '1.0.0',
    source_outline: 'content/_source_outline/book_outline.json',
    updated_at: new Date().toISOString(),
    entries: []
  };
}

export default function MappingOpsPage() {
  const { packs, loaded: packsLoaded } = usePacks();
  const { lessons, loaded: lessonsLoaded } = useLessons();

  const [outlineDoc, setOutlineDoc] = useState<OutlineDoc | null>(null);
  const [mapDoc, setMapDoc] = useState<OutlineMapDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [titleSearch, setTitleSearch] = useState('');
  const [objectiveSearch, setObjectiveSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | MappingStatus>('all');
  const [visibleCount, setVisibleCount] = useState(120);

  useEffect(() => {
    const load = async () => {
      try {
        const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
        const [outlineRes, mapRes] = await Promise.all([
          fetch(`${basePath}/content/_source_outline/book_outline.json`, { cache: 'no-store' }),
          fetch(`${basePath}/content/mappings/outline_map.json`, { cache: 'no-store' })
        ]);

        if (!outlineRes.ok) {
          throw new Error('book_outline.json not found. Run `npm run content:outline` first.');
        }

        const outline = (await outlineRes.json()) as OutlineDoc;
        const outlineChapters = Array.isArray(outline.chapters) ? outline.chapters : [];
        setOutlineDoc({ ...outline, chapters: outlineChapters });

        if (!mapRes.ok) {
          setMapDoc(defaultMapDoc());
        } else {
          const mapData = (await mapRes.json()) as OutlineMapDoc;
          setMapDoc({
            version: mapData.version || '1.0.0',
            source_outline: mapData.source_outline || 'content/_source_outline/book_outline.json',
            updated_at: mapData.updated_at,
            entries: Array.isArray(mapData.entries) ? mapData.entries.map(normalizeEntry) : []
          });
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoaded(true);
      }
    };

    load();
  }, []);

  useEffect(() => {
    setVisibleCount(120);
  }, [titleSearch, objectiveSearch, statusFilter]);

  const lessonOptions = useMemo(
    () =>
      lessons.flatMap((lesson) =>
        lesson.modules.map((module) => ({
          id: module.id,
          label: `${lesson.pack_id} · ${module.title}`
        }))
      ),
    [lessons]
  );
  const packIdSet = useMemo(() => new Set(packs.map((pack) => pack.pack_id)), [packs]);
  const lessonIdSet = useMemo(() => new Set(lessonOptions.map((option) => option.id)), [lessonOptions]);

  const rows = useMemo(() => {
    if (!outlineDoc) return [] as FlatOutlineRow[];
    const entryIndex = buildEntryIndex(mapDoc);
    const normalizedTitleSearch = titleSearch.trim().toLowerCase();
    const normalizedObjectiveSearch = objectiveSearch.trim().toLowerCase();
    const statusOrder: Record<MappingStatus, number> = {
      unmapped: 0,
      draft: 1,
      done: 2
    };

    return flattenOutline(outlineDoc)
      .map((row) => {
        const entry = entryIndex.get(row.outlineId);
        const status = effectiveStatus(entry);
        return {
          ...row,
          entry,
          status,
          mapped: isMapped(entry)
        };
      })
      .filter((row) => {
        if (statusFilter !== 'all' && row.status !== statusFilter) return false;
        if (normalizedObjectiveSearch) {
          const objectiveHaystack = (row.entry?.objectiveIds ?? []).join(' ').toLowerCase();
          if (!objectiveHaystack.includes(normalizedObjectiveSearch)) return false;
        }
        if (!normalizedTitleSearch) return true;

        const haystack = [
          row.title,
          row.chapterTitle,
          row.href,
          row.entry?.packId ?? '',
          (row.entry?.objectiveIds ?? []).join(' '),
          (row.entry?.lessonIds ?? []).join(' '),
          (row.entry?.tags ?? []).join(' ')
        ]
          .join(' ')
          .toLowerCase();

        return haystack.includes(normalizedTitleSearch);
      })
      .sort((a, b) => {
        const statusDelta = statusOrder[a.status] - statusOrder[b.status];
        if (statusDelta !== 0) return statusDelta;
        if (a.chapterOrder !== b.chapterOrder) return a.chapterOrder - b.chapterOrder;
        return a.sectionOrder - b.sectionOrder;
      });
  }, [outlineDoc, mapDoc, titleSearch, objectiveSearch, statusFilter]);

  const visibleRows = rows.slice(0, visibleCount);

  const unmappedCount = rows.filter((row) => row.status === 'unmapped').length;
  const draftCount = rows.filter((row) => row.status === 'draft').length;
  const doneCount = rows.filter((row) => row.status === 'done').length;

  const upsertRowEntry = (row: FlatOutlineRow, updater: (entry: OutlineMapEntry) => OutlineMapEntry) => {
    setMapDoc((prev) => {
      if (!prev) return prev;
      const entries = [...prev.entries];
      const existingIndex = entries.findIndex((entry) => entry.outlineId === row.outlineId);
      const baseEntry: OutlineMapEntry =
        existingIndex >= 0
          ? entries[existingIndex]
          : {
              outlineId: row.outlineId,
              title: row.title,
              href: row.href,
              objectiveIds: []
            };
      const nextEntry = normalizeEntry(updater(baseEntry));
      if (existingIndex >= 0) entries[existingIndex] = nextEntry;
      else entries.push(nextEntry);
      return {
        ...prev,
        updated_at: new Date().toISOString(),
        entries
      };
    });
  };

  const clearEntry = (outlineId: string) => {
    setMapDoc((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        updated_at: new Date().toISOString(),
        entries: prev.entries.filter((entry) => entry.outlineId !== outlineId)
      };
    });
  };

  const downloadMap = () => {
    if (!mapDoc) return;
    const entries = [...mapDoc.entries]
      .map(normalizeEntry)
      .sort((a, b) => a.outlineId.localeCompare(b.outlineId));
    const payload: OutlineMapDoc = {
      ...mapDoc,
      updated_at: new Date().toISOString(),
      entries
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'outline_map.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  if (!loaded || !packsLoaded || !lessonsLoaded) {
    return (
      <div className="card">
        <div className="tag">Ops</div>
        <h1 style={{ marginTop: 8 }}>Outline Mapping</h1>
        <p style={{ color: 'var(--muted)', margin: 0 }}>Loading outline, mapping, packs, and lessons...</p>
      </div>
    );
  }

  if (error || !outlineDoc || !mapDoc) {
    return (
      <div className="card">
        <div className="tag">Ops</div>
        <h1 style={{ marginTop: 8 }}>Outline Mapping Unavailable</h1>
        <p style={{ color: 'var(--danger)', margin: 0 }}>{error ?? 'Failed to load outline mapping data.'}</p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="panel-header">
          <div>
            <div className="tag">Ops</div>
            <h1 style={{ margin: '8px 0 4px' }}>Book outline mapping</h1>
            <p style={{ color: 'var(--muted)', margin: 0 }}>
              Client-side editor only. Save by downloading JSON and replacing `content/mappings/outline_map.json`.
            </p>
          </div>
          <button className="button" onClick={downloadMap}>Download updated JSON</button>
        </div>
        <div className="flex" style={{ marginTop: 10 }}>
          <div className="stat-pill">Total rows {rows.length}</div>
          <div className="stat-pill">Unmapped {unmappedCount}</div>
          <div className="stat-pill">Draft {draftCount}</div>
          <div className="stat-pill">Done {doneCount}</div>
          <div className="stat-pill">Map entries {(mapDoc.entries ?? []).length}</div>
          <div className="stat-pill">Outline chapters {outlineDoc.chapters.length}</div>
        </div>
      </section>

      <section className="card">
        <div className="grid" style={{ gap: 10, gridTemplateColumns: '2fr 1fr 1fr auto' }}>
          <input
            value={titleSearch}
            onChange={(event) => setTitleSearch(event.target.value)}
            placeholder="Search title or href"
            style={{
              width: '100%',
              borderRadius: 10,
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--text)'
            }}
          />
          <input
            value={objectiveSearch}
            onChange={(event) => setObjectiveSearch(event.target.value)}
            placeholder="Filter by objective ID (e.g. 2.1)"
            style={{
              width: '100%',
              borderRadius: 10,
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--text)'
            }}
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | MappingStatus)}
            style={{
              borderRadius: 10,
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--text)'
            }}
          >
            <option value="all">All rows</option>
            <option value="unmapped">Unmapped</option>
            <option value="draft">Draft</option>
            <option value="done">Done</option>
          </select>
          <div className="chip">Showing {visibleRows.length} / {rows.length}</div>
        </div>
      </section>

      <section className="grid" style={{ gap: 12 }}>
        {visibleRows.map((row) => {
          const entry = row.entry;
          const objectiveValue = (entry?.objectiveIds ?? []).join(', ');
          const tagValue = (entry?.tags ?? []).join(', ');
          const invalidObjectiveIds = (entry?.objectiveIds ?? []).filter((id) => !OBJECTIVE_ID_RE.test(id));
          const invalidPack = entry?.packId ? !packIdSet.has(entry.packId) : false;
          const invalidLessonIds = (entry?.lessonIds ?? []).filter((lessonId) => !lessonIdSet.has(lessonId));
          const invalidStatus = entry?.status ? !STATUS_VALUES.includes(entry.status) : false;
          const validationErrors = [
            ...invalidObjectiveIds.map((id) => `Invalid objective ID: ${id}`),
            ...(invalidPack ? [`Unknown packId: ${entry?.packId}`] : []),
            ...invalidLessonIds.map((lessonId) => `Unknown lessonId: ${lessonId}`),
            ...(invalidStatus ? [`Invalid status: ${entry?.status}`] : [])
          ];
          return (
            <article key={row.outlineId} className="card">
              <div className="panel-header">
                <div>
                  <div className="tag">
                    Chapter {row.chapterOrder}
                    {row.sectionOrder > 0 ? ` · Section ${row.sectionOrder}` : ''}
                  </div>
                  <h3 style={{ margin: '8px 0 4px' }}>{row.title}</h3>
                  <p style={{ margin: 0, color: 'var(--muted)' }}>{row.chapterTitle}</p>
                  <p style={{ margin: '6px 0 0', color: 'var(--muted)' }}>
                    <code>{row.href}</code> · {row.wordCount} words · <code>{row.outlineId}</code>
                  </p>
                </div>
                <div
                  className="chip"
                  style={{
                    color:
                      row.status === 'done'
                        ? 'var(--success)'
                        : row.status === 'draft'
                          ? 'rgb(255, 196, 107)'
                          : 'var(--danger)'
                  }}
                >
                  {row.status.toUpperCase()}
                </div>
              </div>

              <div className="grid" style={{ gap: 10, marginTop: 10 }}>
                <label>
                  <div className="tag" style={{ marginBottom: 6 }}>Objective IDs (comma-separated)</div>
                  <input
                    value={objectiveValue}
                    onChange={(event) =>
                      upsertRowEntry(row, (current) => ({
                        ...current,
                        objectiveIds: parseCsv(event.target.value)
                      }))}
                    placeholder="e.g. 2.1, 2.2"
                    style={{
                      width: '100%',
                      borderRadius: 10,
                      padding: '10px 12px',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      color: 'var(--text)'
                    }}
                  />
                </label>

                <label>
                  <div className="tag" style={{ marginBottom: 6 }}>Pack link</div>
                  <select
                    value={entry?.packId ?? ''}
                    onChange={(event) =>
                      upsertRowEntry(row, (current) => ({
                        ...current,
                        packId: event.target.value || undefined
                      }))}
                    style={{
                      width: '100%',
                      borderRadius: 10,
                      padding: '10px 12px',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      color: 'var(--text)'
                    }}
                  >
                    <option value="">Unlinked</option>
                    {packs.map((pack) => (
                      <option key={pack.pack_id} value={pack.pack_id}>
                        {pack.pack_id} · Ch {pack.chapter.number} · {pack.chapter.title}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <div className="tag" style={{ marginBottom: 6 }}>Status</div>
                  <select
                    value={entry?.status ?? row.status}
                    onChange={(event) =>
                      upsertRowEntry(row, (current) => ({
                        ...current,
                        status: event.target.value as MappingStatus
                      }))}
                    style={{
                      width: '100%',
                      borderRadius: 10,
                      padding: '10px 12px',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      color: 'var(--text)'
                    }}
                  >
                    <option value="unmapped">unmapped</option>
                    <option value="draft">draft</option>
                    <option value="done">done</option>
                  </select>
                </label>

                <label>
                  <div className="tag" style={{ marginBottom: 6 }}>Lesson links (multi-select module IDs)</div>
                  <select
                    multiple
                    value={entry?.lessonIds ?? []}
                    onChange={(event) => {
                      const values = Array.from(event.target.selectedOptions).map((option) => option.value);
                      upsertRowEntry(row, (current) => ({ ...current, lessonIds: values }));
                    }}
                    style={{
                      width: '100%',
                      minHeight: 120,
                      borderRadius: 10,
                      padding: '10px 12px',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      color: 'var(--text)'
                    }}
                  >
                    {lessonOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label>
                  <div className="tag" style={{ marginBottom: 6 }}>Tags (comma-separated)</div>
                  <input
                    value={tagValue}
                    onChange={(event) =>
                      upsertRowEntry(row, (current) => ({
                        ...current,
                        tags: parseCsv(event.target.value)
                      }))}
                    placeholder="e.g. phishing, iam, cryptography"
                    style={{
                      width: '100%',
                      borderRadius: 10,
                      padding: '10px 12px',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      color: 'var(--text)'
                    }}
                  />
                </label>

                {validationErrors.length > 0 && (
                  <div style={{ color: 'var(--danger)' }}>
                    <div className="tag" style={{ marginBottom: 6 }}>Validation errors</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {validationErrors.map((errorText) => (
                        <li key={errorText}>{errorText}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="flex" style={{ marginTop: 10 }}>
                <button className="button secondary" onClick={() => clearEntry(row.outlineId)}>
                  Clear mapping for this row
                </button>
              </div>
            </article>
          );
        })}
      </section>

      {visibleCount < rows.length && (
        <section className="card" style={{ textAlign: 'center' }}>
          <button className="button secondary" onClick={() => setVisibleCount((count) => count + 120)}>
            Load 120 more rows
          </button>
        </section>
      )}
    </div>
  );
}
