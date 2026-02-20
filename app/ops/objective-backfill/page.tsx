'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useMemo, useState } from 'react';
import { useObjectives } from '@/lib/useObjectives';

const OBJECTIVE_ID_RE = /^\d+\.\d+$/;

type SuggestionCandidate = {
  rank: number;
  objectiveId: string;
  objectiveTitle: string;
  domainId: string;
  score: number;
  confidence: number;
  reasons: string[];
};

type SuggestionRow = {
  packId: string;
  chapterNumber: number | null;
  chapterTitle: string;
  questionId: string;
  questionType: string;
  questionStem: string;
  candidates: SuggestionCandidate[];
};

type SuggestionReport = {
  generated_at: string;
  totals: {
    missingQuestions: number;
  };
  suggestions: SuggestionRow[];
};

type RawQuestion = {
  id: string;
  type?: string;
  stem?: string;
  options?: unknown;
  left?: unknown;
  right?: unknown;
  items?: unknown;
};

type RawPack = {
  pack_id: string;
  question_bank?: RawQuestion[];
};

type ObjectiveMeta = {
  id: string;
  title: string;
};

type EditState = {
  objectiveIds: string[];
  approved: boolean;
};

type PatchEntry = {
  questionId: string;
  packId: string;
  objectiveIds: string[];
};

function objectiveIdSort(a: string, b: string) {
  const [aMajor, aMinor] = a.split('.').map((segment) => Number.parseInt(segment, 10));
  const [bMajor, bMinor] = b.split('.').map((segment) => Number.parseInt(segment, 10));
  if (aMajor !== bMajor) return aMajor - bMajor;
  return aMinor - bMinor;
}

function parseObjectiveIds(value: string) {
  return [...new Set(value.split(',').map((id) => id.trim()).filter(Boolean))];
}

function normalizeObjectiveIds(ids: string[]) {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort(objectiveIdSort);
}

function questionKey(packId: string, questionId: string) {
  return `${packId}::${questionId}`;
}

function toQuestionIndex(packs: RawPack[]) {
  const index = new Map<string, RawQuestion>();
  packs.forEach((pack) => {
    (pack.question_bank ?? []).forEach((question) => {
      index.set(questionKey(pack.pack_id, question.id), question);
    });
  });
  return index;
}

function toOptionList(question: RawQuestion | undefined) {
  if (!question || !question.options) return [] as string[];
  if (Array.isArray(question.options)) {
    return question.options
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value, index) => `${String.fromCharCode(65 + index)}. ${value}`);
  }
  if (typeof question.options === 'object') {
    return Object.entries(question.options as Record<string, unknown>)
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }))
      .map(([optionId, value]) => `${optionId}. ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }
  return [];
}

function toList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function ObjectiveBackfillPage() {
  const { doc: objectivesDoc, loaded: objectivesLoaded, error: objectivesError } = useObjectives();
  const [report, setReport] = useState<SuggestionReport | null>(null);
  const [questionIndex, setQuestionIndex] = useState<Map<string, RawQuestion>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [chapterFilter, setChapterFilter] = useState('all');
  const [objectiveFilter, setObjectiveFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(30);

  useEffect(() => {
    const load = async () => {
      try {
        const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
        const suggestionsRes = await fetch(`${basePath}/content/_reports/objective_backfill_suggestions.json`, { cache: 'no-store' });
        if (!suggestionsRes.ok) {
          throw new Error('Suggestions file missing. Run `npm run objectives:suggest` first.');
        }
        const nextReport = (await suggestionsRes.json()) as SuggestionReport;
        const suggestions = Array.isArray(nextReport.suggestions) ? nextReport.suggestions : [];

        const packsRes = await fetch(`${basePath}/api/packs`, { cache: 'no-store' });
        if (!packsRes.ok) {
          throw new Error('Failed to load pack index for question previews.');
        }
        const packsPayload = (await packsRes.json()) as { pack_files?: string[] };
        const packFiles = (packsPayload.pack_files ?? [])
          .filter((file) => file.endsWith('.json') && !file.startsWith('chapter_pack.'))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

        const rawPacks = await Promise.all(
          packFiles.map(async (file) => {
            const packRes = await fetch(`${basePath}/content/chapter_packs/${file}`, { cache: 'no-store' });
            if (!packRes.ok) {
              throw new Error(`Failed to load ${file}`);
            }
            return packRes.json() as Promise<RawPack>;
          })
        );

        setQuestionIndex(toQuestionIndex(rawPacks));
        setReport({
          ...nextReport,
          suggestions
        });

        const initialEdits: Record<string, EditState> = {};
        suggestions.forEach((row) => {
          const key = questionKey(row.packId, row.questionId);
          initialEdits[key] = {
            objectiveIds: normalizeObjectiveIds(row.candidates.slice(0, 1).map((candidate) => candidate.objectiveId)),
            approved: false
          };
        });
        setEdits(initialEdits);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoaded(true);
      }
    };

    load();
  }, []);

  useEffect(() => {
    setVisibleCount(30);
  }, [chapterFilter, objectiveFilter]);

  const objectives = useMemo(() => {
    if (!objectivesDoc) return [] as ObjectiveMeta[];
    return objectivesDoc.objectives
      .map((objective) => ({ id: objective.id, title: objective.title }))
      .sort((a, b) => objectiveIdSort(a.id, b.id));
  }, [objectivesDoc]);

  const objectiveIdSet = useMemo(() => new Set(objectives.map((objective) => objective.id)), [objectives]);

  const chapterOptions = useMemo(() => {
    if (!report) return [] as string[];
    return [...new Set(
      report.suggestions
        .map((row) => (typeof row.chapterNumber === 'number' ? row.chapterNumber : null))
        .filter((value): value is number => value !== null)
    )]
      .sort((a, b) => a - b)
      .map((chapterNumber) => String(chapterNumber));
  }, [report]);

  const filteredRows = useMemo(() => {
    if (!report) return [] as SuggestionRow[];
    return report.suggestions
      .filter((row) => chapterFilter === 'all' || String(row.chapterNumber ?? '') === chapterFilter)
      .filter((row) => {
        if (objectiveFilter === 'all') return true;
        const key = questionKey(row.packId, row.questionId);
        const selectedObjectiveIds = edits[key]?.objectiveIds ?? [];
        if (selectedObjectiveIds.includes(objectiveFilter)) return true;
        return row.candidates.some((candidate) => candidate.objectiveId === objectiveFilter);
      })
      .sort((a, b) => {
        if ((a.chapterNumber ?? Number.MAX_SAFE_INTEGER) !== (b.chapterNumber ?? Number.MAX_SAFE_INTEGER)) {
          return (a.chapterNumber ?? Number.MAX_SAFE_INTEGER) - (b.chapterNumber ?? Number.MAX_SAFE_INTEGER);
        }
        const packDelta = a.packId.localeCompare(b.packId, undefined, { numeric: true, sensitivity: 'base' });
        if (packDelta !== 0) return packDelta;
        return a.questionId.localeCompare(b.questionId, undefined, { numeric: true, sensitivity: 'base' });
      });
  }, [report, chapterFilter, objectiveFilter, edits]);

  const visibleRows = filteredRows.slice(0, visibleCount);

  const patchEntries = useMemo(() => {
    if (!report) return [] as PatchEntry[];
    const rows: PatchEntry[] = [];
    report.suggestions.forEach((row) => {
      const key = questionKey(row.packId, row.questionId);
      const edit = edits[key];
      if (!edit?.approved) return;
      const objectiveIds = normalizeObjectiveIds(edit.objectiveIds);
      if (objectiveIds.length === 0) return;
      if (objectiveIds.some((id) => !objectiveIdSet.has(id))) return;
      rows.push({
        questionId: row.questionId,
        packId: row.packId,
        objectiveIds
      });
    });
    return rows;
  }, [report, edits, objectiveIdSet]);

  const approvedCount = useMemo(
    () => Object.values(edits).filter((edit) => edit.approved).length,
    [edits]
  );

  const invalidApprovedCount = useMemo(() => {
    if (!report) return 0;
    let count = 0;
    report.suggestions.forEach((row) => {
      const key = questionKey(row.packId, row.questionId);
      const edit = edits[key];
      if (!edit?.approved) return;
      const objectiveIds = normalizeObjectiveIds(edit.objectiveIds);
      if (objectiveIds.length === 0 || objectiveIds.some((id) => !objectiveIdSet.has(id))) {
        count += 1;
      }
    });
    return count;
  }, [report, edits, objectiveIdSet]);

  const updateEdit = (key: string, update: (prev: EditState) => EditState) => {
    setEdits((prev) => {
      const base = prev[key] ?? { objectiveIds: [], approved: false };
      return {
        ...prev,
        [key]: update(base)
      };
    });
  };

  const exportPatch = () => {
    downloadJson('objective_backfill_patch.json', patchEntries);
  };

  if (!loaded || !objectivesLoaded) {
    return (
      <div className="card">
        <div className="tag">Ops</div>
        <h1 style={{ marginTop: 8 }}>Objective backfill review</h1>
        <p style={{ color: 'var(--muted)', margin: 0 }}>Loading suggestions, objectives, and question previews...</p>
      </div>
    );
  }

  if (error || objectivesError || !report) {
    return (
      <div className="card">
        <div className="tag">Ops</div>
        <h1 style={{ marginTop: 8 }}>Objective backfill unavailable</h1>
        <p style={{ color: 'var(--danger)', margin: 0 }}>
          {error ?? objectivesError ?? 'Failed to load objective backfill report.'}
        </p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="panel-header">
          <div>
            <div className="tag">Ops</div>
            <h1 style={{ marginTop: 8, marginBottom: 8 }}>Objective backfill review</h1>
            <p style={{ color: 'var(--muted)', margin: 0 }}>
              Review deterministic suggestions for untagged questions, edit objective IDs, mark approved, and export a patch file.
            </p>
          </div>
          <div className="flex">
            <Link href={'/ops/coverage' as Route} className="button secondary">
              Coverage ops
            </Link>
            <Link href={'/map' as Route} className="button secondary">
              Back to map
            </Link>
          </div>
        </div>
        <div className="flex" style={{ marginTop: 12 }}>
          <div className="stat-pill">Missing in report: {report.totals.missingQuestions}</div>
          <div className="stat-pill">Filtered rows: {filteredRows.length}</div>
          <div className="stat-pill">Approved: {approvedCount}</div>
          <div className="stat-pill">Valid patch rows: {patchEntries.length}</div>
          <div className="stat-pill">Approved with validation issues: {invalidApprovedCount}</div>
        </div>
        <div className="chip" style={{ marginTop: 10 }}>
          Suggestions generated: {new Date(report.generated_at).toLocaleString()}
        </div>
      </section>

      <section className="card">
        <div className="grid" style={{ gap: 10, gridTemplateColumns: '1fr 1fr auto' }}>
          <select
            value={chapterFilter}
            onChange={(event) => setChapterFilter(event.target.value)}
            style={{
              borderRadius: 10,
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--text)'
            }}
          >
            <option value="all">All chapters</option>
            {chapterOptions.map((chapter) => (
              <option key={chapter} value={chapter}>Chapter {chapter}</option>
            ))}
          </select>
          <select
            value={objectiveFilter}
            onChange={(event) => setObjectiveFilter(event.target.value)}
            style={{
              borderRadius: 10,
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--text)'
            }}
          >
            <option value="all">All objective IDs</option>
            {objectives.map((objective) => (
              <option key={objective.id} value={objective.id}>
                {objective.id} · {objective.title}
              </option>
            ))}
          </select>
          <button className="button" onClick={exportPatch} disabled={patchEntries.length === 0}>
            Export patch
          </button>
        </div>
        <p style={{ marginTop: 10, marginBottom: 0, color: 'var(--muted)' }}>
          Export creates <code>objective_backfill_patch.json</code>. Move it to <code>content/_reports/objective_backfill_patch.json</code> if needed.
        </p>
      </section>

      {visibleRows.length === 0 ? (
        <section className="card">
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            No suggestions match the selected filters.
          </p>
        </section>
      ) : (
        <section className="grid" style={{ gap: 14 }}>
          {visibleRows.map((row) => {
            const key = questionKey(row.packId, row.questionId);
            const edit = edits[key] ?? { objectiveIds: [], approved: false };
            const normalizedObjectiveIds = normalizeObjectiveIds(edit.objectiveIds);
            const invalidObjectiveIds = normalizedObjectiveIds.filter(
              (objectiveId) => !OBJECTIVE_ID_RE.test(objectiveId) || !objectiveIdSet.has(objectiveId)
            );
            const hasValidationError = normalizedObjectiveIds.length === 0 || invalidObjectiveIds.length > 0;
            const question = questionIndex.get(key);
            const stem = question?.stem ?? row.questionStem;
            const questionType = question?.type ?? row.questionType;
            const optionRows = toOptionList(question);
            const matchingLeft = toList(question?.left);
            const matchingRight = toList(question?.right);
            const orderingItems = toList(question?.items);

            return (
              <article key={key} className="card" style={{ display: 'grid', gap: 10 }}>
                <div className="panel-header">
                  <div>
                    <div className="tag">
                      {row.packId} · {row.questionId}
                    </div>
                    <h2 style={{ margin: '8px 0 4px' }}>{stem || '(No stem found)'}</h2>
                    <p style={{ margin: 0, color: 'var(--muted)' }}>
                      Chapter {row.chapterNumber ?? 'n/a'} · {row.chapterTitle || 'Untitled'} · type: {questionType}
                    </p>
                  </div>
                  <button
                    className={`button ${edit.approved ? '' : 'secondary'}`}
                    onClick={() => updateEdit(key, (prev) => ({ ...prev, approved: !prev.approved }))}
                  >
                    {edit.approved ? 'Approved' : 'Mark approved'}
                  </button>
                </div>

                {optionRows.length > 0 ? (
                  <div>
                    <div className="chip" style={{ marginBottom: 6 }}>Options</div>
                    <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--muted)' }}>
                      {optionRows.map((optionText) => (
                        <li key={optionText}>{optionText}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {matchingLeft.length > 0 || matchingRight.length > 0 ? (
                  <div className="flex">
                    {matchingLeft.length > 0 ? (
                      <div className="chip">Left side: {matchingLeft.slice(0, 4).join(' | ')}</div>
                    ) : null}
                    {matchingRight.length > 0 ? (
                      <div className="chip">Right side: {matchingRight.slice(0, 4).join(' | ')}</div>
                    ) : null}
                  </div>
                ) : null}

                {orderingItems.length > 0 ? (
                  <div className="chip">Ordering items: {orderingItems.slice(0, 6).join(' → ')}</div>
                ) : null}

                <div className="grid" style={{ gap: 8 }}>
                  <div className="chip">Suggested objective IDs</div>
                  <div className="flex">
                    {row.candidates.map((candidate) => (
                      <button
                        key={`${key}:${candidate.objectiveId}`}
                        className="button secondary"
                        onClick={() => updateEdit(key, (prev) => ({
                          ...prev,
                          objectiveIds: [candidate.objectiveId]
                        }))}
                      >
                        {candidate.objectiveId} ({Math.round(candidate.confidence * 100)}%)
                      </button>
                    ))}
                  </div>
                  <details>
                    <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>Show scoring reasons</summary>
                    <div className="grid" style={{ gap: 8, marginTop: 8 }}>
                      {row.candidates.map((candidate) => (
                        <div key={`${key}:reason:${candidate.objectiveId}`} className="chip" style={{ display: 'block', whiteSpace: 'normal' }}>
                          <strong>{candidate.objectiveId}</strong>: {candidate.reasons.join('; ')}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>

                <div className="grid" style={{ gap: 8 }}>
                  <label htmlFor={`${key}:objective-ids`} style={{ fontWeight: 700 }}>
                    Objective IDs (comma-separated)
                  </label>
                  <input
                    id={`${key}:objective-ids`}
                    type="text"
                    value={edit.objectiveIds.join(', ')}
                    onChange={(event) => {
                      const nextObjectiveIds = parseObjectiveIds(event.target.value);
                      updateEdit(key, (prev) => ({
                        ...prev,
                        objectiveIds: nextObjectiveIds
                      }));
                    }}
                    placeholder="Example: 2.3, 4.8"
                  />
                  {hasValidationError ? (
                    <p style={{ margin: 0, color: 'var(--danger)' }}>
                      {normalizedObjectiveIds.length === 0
                        ? 'At least one objective ID is required for approval.'
                        : `Invalid objective IDs: ${invalidObjectiveIds.join(', ')}`}
                    </p>
                  ) : (
                    <p style={{ margin: 0, color: 'var(--success)' }}>
                      Valid objective IDs: {normalizedObjectiveIds.join(', ')}
                    </p>
                  )}
                </div>
              </article>
            );
          })}

          {visibleCount < filteredRows.length ? (
            <button className="button secondary" onClick={() => setVisibleCount((prev) => prev + 30)}>
              Load 30 more
            </button>
          ) : null}
        </section>
      )}
    </div>
  );
}
