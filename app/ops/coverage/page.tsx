'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  computeOpsCoverageReport,
  ObjectiveCoverageRow,
  OpsCoverageReport,
  OutlineDoc,
  OutlineMapDoc,
  OutlineSectionCoverageRow
} from '@/lib/coverage';
import { useLocalState } from '@/lib/useLocalState';
import { useObjectives } from '@/lib/useObjectives';
import { usePacks } from '@/lib/usePacks';
import { ChapterPack } from '@/lib/types';

type QuestionTypeFilter = 'all' | 'mcq' | 'multi_select' | 'scenario' | 'matching' | 'ordering' | 'interactive' | 'pbq';
type StatusFilter = 'all' | 'unmapped' | 'draft' | 'done';
type CoverageMode = 'explicit' | 'fallback';

function formatPercent(value: number | null) {
  if (value === null) return 'n/a';
  return `${Math.round(value * 100)}%`;
}

function objectiveLabel(objectiveIds: string[]) {
  if (objectiveIds.length === 0) return 'None';
  return objectiveIds.join(', ');
}

function objectiveWeakScore(row: ObjectiveCoverageRow) {
  if (row.questionCount === 0) return 10_000;
  const wrongRate = row.averageWrongRate ?? 0;
  const mappingPenalty = row.mappedOutlineSectionsCount === 0
    ? 120
    : Math.max(0, 40 - row.mappedOutlineSectionsCount * 6);
  const interactivePenalty = Math.max(0, 3 - row.interactiveCount) * 14;
  const scenarioPenalty = row.scenarioCount === 0 ? 10 : 0;
  return wrongRate * 1_000 + (100 - Math.min(100, row.questionCount)) + mappingPenalty + interactivePenalty + scenarioPenalty;
}

function objectiveMatchesType(row: ObjectiveCoverageRow, questionTypeFilter: QuestionTypeFilter) {
  if (questionTypeFilter === 'all') return true;
  if (questionTypeFilter === 'mcq') return row.mcqCount > 0;
  if (questionTypeFilter === 'multi_select') return row.multiSelectCount > 0;
  if (questionTypeFilter === 'scenario') return row.scenarioCount > 0;
  if (questionTypeFilter === 'matching') return row.matchingCount > 0;
  if (questionTypeFilter === 'ordering') return row.orderingCount > 0;
  if (questionTypeFilter === 'interactive') return row.interactiveCount > 0;
  if (questionTypeFilter === 'pbq') return row.pbqCount > 0;
  return true;
}

function sectionMatchesType(row: OutlineSectionCoverageRow, questionTypeFilter: QuestionTypeFilter) {
  if (questionTypeFilter === 'all') return true;
  if (questionTypeFilter === 'mcq') return row.mcqCount > 0;
  if (questionTypeFilter === 'multi_select') return row.multiSelectCount > 0;
  if (questionTypeFilter === 'scenario') return row.scenarioCount > 0;
  if (questionTypeFilter === 'matching') return row.matchingCount > 0;
  if (questionTypeFilter === 'ordering') return row.orderingCount > 0;
  if (questionTypeFilter === 'interactive') return row.interactiveCount > 0;
  if (questionTypeFilter === 'pbq') return row.pbqCount > 0;
  return true;
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

function sortPacks(packs: ChapterPack[]) {
  return [...packs].sort((a, b) => {
    const chapterA = Number.isFinite(a.chapter?.number) ? a.chapter.number : Number.MAX_SAFE_INTEGER;
    const chapterB = Number.isFinite(b.chapter?.number) ? b.chapter.number : Number.MAX_SAFE_INTEGER;
    if (chapterA !== chapterB) return chapterA - chapterB;
    return a.pack_id.localeCompare(b.pack_id, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function snapshot(report: OpsCoverageReport) {
  return {
    zeroCoverage: report.zeroCoverageObjectiveIds.length,
    untagged: report.objectiveReport.untaggedQuestionCount,
    unmapped: report.unmappedOutlineSections.length,
    thin: report.thinOutlineSections.length
  };
}

export default function OpsCoveragePage() {
  const { packs, loaded: packsLoaded, error: packsError } = usePacks();
  const { doc: objectivesDoc, loaded: objectivesLoaded, error: objectivesError } = useObjectives();
  const { state, loaded: stateLoaded } = useLocalState();

  const [outlineDoc, setOutlineDoc] = useState<OutlineDoc | null>(null);
  const [outlineMapDoc, setOutlineMapDoc] = useState<OutlineMapDoc | null>(null);
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [outlineLoaded, setOutlineLoaded] = useState(false);
  const [explicitPacks, setExplicitPacks] = useState<ChapterPack[]>([]);
  const [explicitPacksError, setExplicitPacksError] = useState<string | null>(null);
  const [explicitPacksLoaded, setExplicitPacksLoaded] = useState(false);
  const [coverageMode, setCoverageMode] = useState<CoverageMode>('explicit');
  const [domainFilter, setDomainFilter] = useState('all');
  const [questionTypeFilter, setQuestionTypeFilter] = useState<QuestionTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

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
        setOutlineDoc(outline);

        if (mapRes.ok) {
          const mapping = (await mapRes.json()) as OutlineMapDoc;
          setOutlineMapDoc(mapping);
        } else {
          setOutlineMapDoc(null);
        }
      } catch (err) {
        setOutlineError((err as Error).message);
      } finally {
        setOutlineLoaded(true);
      }
    };
    load();
  }, []);

  useEffect(() => {
    const loadExplicitPacks = async () => {
      try {
        const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
        const packsRes = await fetch(`${basePath}/api/packs`, { cache: 'no-store' });
        if (!packsRes.ok) throw new Error('Failed to load pack file index for explicit coverage.');
        const payload = await packsRes.json();
        const packFiles = (payload.pack_files ?? []).filter((file: string) =>
          file.endsWith('.json') && !file.startsWith('chapter_pack.')
        );
        const rawPacks = await Promise.all(
          packFiles.map(async (file: string) => {
            const fileRes = await fetch(`${basePath}/content/chapter_packs/${file}`, { cache: 'no-store' });
            if (!fileRes.ok) throw new Error(`Failed to load ${file}`);
            return fileRes.json();
          })
        );
        setExplicitPacks(sortPacks(rawPacks as ChapterPack[]));
      } catch (err) {
        setExplicitPacksError((err as Error).message);
      } finally {
        setExplicitPacksLoaded(true);
      }
    };
    loadExplicitPacks();
  }, []);

  const fallbackReport = useMemo(() => {
    if (!objectivesDoc) return null;
    return computeOpsCoverageReport({
      objectivesDoc,
      packs,
      state: stateLoaded ? state : undefined,
      outlineDoc,
      outlineMapDoc
    });
  }, [objectivesDoc, packs, state, stateLoaded, outlineDoc, outlineMapDoc]);

  const explicitReport = useMemo(() => {
    if (!objectivesDoc || !explicitPacksLoaded) return null;
    return computeOpsCoverageReport({
      objectivesDoc,
      packs: explicitPacks,
      state: stateLoaded ? state : undefined,
      outlineDoc,
      outlineMapDoc
    });
  }, [objectivesDoc, explicitPacks, explicitPacksLoaded, state, stateLoaded, outlineDoc, outlineMapDoc]);

  const report = coverageMode === 'explicit' ? explicitReport : fallbackReport;

  const domainMap = useMemo(() => new Map((objectivesDoc?.domains ?? []).map((domain) => [domain.id, domain.title])), [objectivesDoc]);
  const objectiveToDomain = useMemo(
    () => new Map((objectivesDoc?.objectives ?? []).map((objective) => [objective.id, objective.domain_id])),
    [objectivesDoc]
  );

  const topWeakObjectives = useMemo(() => {
    if (!report) return [] as ObjectiveCoverageRow[];
    return [...report.objectiveReport.rows]
      .filter((row) => domainFilter === 'all' || row.domainId === domainFilter)
      .filter((row) => objectiveMatchesType(row, questionTypeFilter))
      .sort((a, b) => objectiveWeakScore(b) - objectiveWeakScore(a))
      .slice(0, 20);
  }, [report, domainFilter, questionTypeFilter]);

  const zeroCoverageObjectiveIds = useMemo(() => {
    if (!report) return [] as string[];
    return report.zeroCoverageObjectiveIds.filter((objectiveId) => {
      if (domainFilter === 'all') return true;
      return objectiveToDomain.get(objectiveId) === domainFilter;
    });
  }, [report, domainFilter, objectiveToDomain]);

  const topUnmappedSections = useMemo(() => {
    if (!report) return [] as OutlineSectionCoverageRow[];
    return report.unmappedOutlineSections
      .filter((row) => {
        if (statusFilter !== 'all' && row.status !== statusFilter) return false;
        if (domainFilter !== 'all') {
          if (row.objectiveIds.length === 0) return false;
          if (!row.objectiveIds.some((objectiveId) => objectiveToDomain.get(objectiveId) === domainFilter)) return false;
        }
        return sectionMatchesType(row, questionTypeFilter);
      })
      .slice(0, 50);
  }, [report, domainFilter, questionTypeFilter, statusFilter, objectiveToDomain]);

  const topThinSections = useMemo(() => {
    if (!report) return [] as OutlineSectionCoverageRow[];
    return report.thinOutlineSections
      .filter((row) => {
        if (statusFilter !== 'all' && row.status !== statusFilter) return false;
        if (domainFilter !== 'all') {
          if (row.objectiveIds.length === 0) return false;
          if (!row.objectiveIds.some((objectiveId) => objectiveToDomain.get(objectiveId) === domainFilter)) return false;
        }
        return sectionMatchesType(row, questionTypeFilter);
      })
      .slice(0, 50);
  }, [report, domainFilter, questionTypeFilter, statusFilter, objectiveToDomain]);

  const handleDownloadReport = () => {
    if (!report) return;
    downloadJson('coverage_report.json', {
      activeMode: coverageMode,
      activeReport: report,
      explicitOnlyReport: explicitReport,
      fallbackReport,
      exportedAt: new Date().toISOString(),
      filters: {
        domainFilter,
        questionTypeFilter,
        statusFilter
      }
    });
  };

  if (!packsLoaded || !objectivesLoaded || !stateLoaded || !outlineLoaded || !explicitPacksLoaded) {
    return (
      <div className="card">
        <div className="tag">Ops</div>
        <h1 style={{ marginTop: 8 }}>Coverage Ops</h1>
        <p style={{ color: 'var(--muted)', margin: 0 }}>Loading objectives, packs, stats, outline, and mapping...</p>
      </div>
    );
  }

  if (packsError || objectivesError || outlineError || explicitPacksError || !report || !objectivesDoc || !explicitReport || !fallbackReport) {
    return (
      <div className="card">
        <div className="tag">Ops</div>
        <h1 style={{ marginTop: 8 }}>Coverage Ops unavailable</h1>
        <p style={{ color: 'var(--danger)', margin: 0 }}>
          {packsError ?? objectivesError ?? outlineError ?? explicitPacksError ?? 'Coverage report could not be generated.'}
        </p>
      </div>
    );
  }

  const explicitSnapshot = snapshot(explicitReport);
  const fallbackSnapshot = snapshot(fallbackReport);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="panel-header">
          <div>
            <div className="tag">Ops</div>
            <h1 style={{ marginTop: 8, marginBottom: 8 }}>Coverage operations report</h1>
            <p style={{ color: 'var(--muted)', margin: 0 }}>
              Actionable objective and outline coverage with mapping-aware thin-section detection.
            </p>
          </div>
          <button className="button" onClick={handleDownloadReport}>
            Export JSON report
          </button>
        </div>
        <div className="flex" style={{ marginTop: 12 }}>
          <div className="stat-pill">Objectives: {fallbackReport.objectiveReport.objectiveCount}</div>
          <div className="stat-pill">Explicit zero coverage: {explicitSnapshot.zeroCoverage}</div>
          <div className="stat-pill">Fallback zero coverage: {fallbackSnapshot.zeroCoverage}</div>
          <div className="stat-pill">Explicit untagged: {explicitSnapshot.untagged}</div>
          <div className="stat-pill">Fallback untagged: {fallbackSnapshot.untagged}</div>
          <div className="stat-pill">Unmapped sections: {fallbackSnapshot.unmapped}</div>
          <div className="stat-pill">Thin sections: {fallbackSnapshot.thin}</div>
          <div className="stat-pill">
            Thin thresholds q&gt;={report.thresholds.minQuestionCount}, interactive&gt;={report.thresholds.minInteractiveCount}
          </div>
        </div>
        <p style={{ margin: '10px 0 0', color: 'var(--muted)' }}>
          Download saves a file named <code>coverage_report.json</code>; place it in <code>content/_reports/coverage_report.json</code> if you want to keep it in-repo.
        </p>
      </section>

      <section className="card">
        <div className="grid" style={{ gap: 10, gridTemplateColumns: '1fr 1fr 1fr 1fr auto' }}>
          <select
            value={domainFilter}
            onChange={(event) => setDomainFilter(event.target.value)}
            style={{
              borderRadius: 10,
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--text)'
            }}
          >
            <option value="all">All domains</option>
            {objectivesDoc.domains.map((domain) => (
              <option key={domain.id} value={domain.id}>
                {domain.id} · {domain.title}
              </option>
            ))}
          </select>
          <select
            value={questionTypeFilter}
            onChange={(event) => setQuestionTypeFilter(event.target.value as QuestionTypeFilter)}
            style={{
              borderRadius: 10,
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--text)'
            }}
          >
            <option value="all">All question types</option>
            <option value="mcq">MCQ</option>
            <option value="multi_select">Multi-select</option>
            <option value="scenario">Scenario</option>
            <option value="matching">Matching</option>
            <option value="ordering">Ordering</option>
            <option value="interactive">Interactive (matching + ordering)</option>
            <option value="pbq">PBQ-style</option>
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            style={{
              borderRadius: 10,
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--text)'
            }}
          >
            <option value="all">All statuses</option>
            <option value="unmapped">Unmapped</option>
            <option value="draft">Draft</option>
            <option value="done">Done</option>
          </select>
          <select
            value={coverageMode}
            onChange={(event) => setCoverageMode(event.target.value as CoverageMode)}
            style={{
              borderRadius: 10,
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--text)'
            }}
          >
            <option value="explicit">Detail mode: explicit-only</option>
            <option value="fallback">Detail mode: with fallback</option>
          </select>
          <div className="chip">Generated {new Date(report.generatedAt).toLocaleString()}</div>
        </div>
      </section>

      <section className="card">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Top 20 weakest objectives</h2>
          <div className="chip">{coverageMode === 'explicit' ? 'explicit-only' : 'with fallback'} · {topWeakObjectives.length}</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1060 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                <th style={{ padding: '8px 6px' }}>Objective</th>
                <th style={{ padding: '8px 6px' }}>Domain</th>
                <th style={{ padding: '8px 6px' }}>Mapped sections</th>
                <th style={{ padding: '8px 6px' }}>Questions</th>
                <th style={{ padding: '8px 6px' }}>Scenario</th>
                <th style={{ padding: '8px 6px' }}>Interactive</th>
                <th style={{ padding: '8px 6px' }}>Avg wrong rate</th>
              </tr>
            </thead>
            <tbody>
              {topWeakObjectives.map((row) => (
                <tr key={row.objectiveId} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <td style={{ padding: '8px 6px' }}>
                    <div style={{ fontWeight: 700 }}>{row.objectiveId}</div>
                    <div style={{ color: 'var(--muted)', lineHeight: 1.4 }}>{row.title}</div>
                  </td>
                  <td style={{ padding: '8px 6px', color: 'var(--muted)' }}>
                    {row.domainId}{domainMap.get(row.domainId) ? ` · ${domainMap.get(row.domainId)}` : ''}
                  </td>
                  <td style={{ padding: '8px 6px' }}>{row.mappedOutlineSectionsCount}</td>
                  <td style={{ padding: '8px 6px' }}>{row.questionCount}</td>
                  <td style={{ padding: '8px 6px' }}>{row.scenarioCount}</td>
                  <td style={{ padding: '8px 6px' }}>{row.interactiveCount}</td>
                  <td style={{ padding: '8px 6px', color: row.averageWrongRate && row.averageWrongRate > 0.35 ? 'var(--danger)' : 'var(--muted)' }}>
                    {formatPercent(row.averageWrongRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Objectives with zero coverage</h2>
          <div className="chip">{coverageMode === 'explicit' ? 'explicit-only' : 'with fallback'} · {zeroCoverageObjectiveIds.length}</div>
        </div>
        {zeroCoverageObjectiveIds.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--success)' }}>No zero-coverage objectives for the current filter.</p>
        ) : (
          <div className="flex">
            {zeroCoverageObjectiveIds.slice(0, 100).map((objectiveId) => {
              const row = report.objectiveReport.rows.find((entry) => entry.objectiveId === objectiveId);
              return (
                <div key={objectiveId} className="chip" style={{ border: '1px solid rgba(255,123,123,0.45)', color: 'var(--danger)' }}>
                  {objectiveId} · {row?.title ?? 'Unknown objective'}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Top 50 unmapped outline sections</h2>
          <div className="chip">{coverageMode === 'explicit' ? 'explicit-only' : 'with fallback'} · {topUnmappedSections.length}</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1060 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                <th style={{ padding: '8px 6px' }}>Section</th>
                <th style={{ padding: '8px 6px' }}>Status</th>
                <th style={{ padding: '8px 6px' }}>Mapped objectives</th>
                <th style={{ padding: '8px 6px' }}>Href</th>
                <th style={{ padding: '8px 6px' }}>Questions</th>
                <th style={{ padding: '8px 6px' }}>Scenario</th>
                <th style={{ padding: '8px 6px' }}>Interactive</th>
                <th style={{ padding: '8px 6px' }}>Avg wrong rate</th>
              </tr>
            </thead>
            <tbody>
              {topUnmappedSections.map((row) => (
                <tr key={row.outlineId} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <td style={{ padding: '8px 6px' }}>
                    <div style={{ fontWeight: 700 }}>
                      Ch {row.chapterOrder}
                      {row.sectionOrder > 0 ? ` · Sec ${row.sectionOrder}` : ''}
                    </div>
                    <div style={{ color: 'var(--muted)', lineHeight: 1.4 }}>{row.title}</div>
                  </td>
                  <td style={{ padding: '8px 6px' }}>{row.status}</td>
                  <td style={{ padding: '8px 6px' }}>{row.mappedObjectiveIdsCount}</td>
                  <td style={{ padding: '8px 6px', color: 'var(--muted)' }}><code>{row.href}</code></td>
                  <td style={{ padding: '8px 6px' }}>{row.questionCount}</td>
                  <td style={{ padding: '8px 6px' }}>{row.scenarioCount}</td>
                  <td style={{ padding: '8px 6px' }}>{row.interactiveCount}</td>
                  <td style={{ padding: '8px 6px' }}>{formatPercent(row.averageWrongRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Top 50 thin outline sections</h2>
          <div className="chip">{coverageMode === 'explicit' ? 'explicit-only' : 'with fallback'} · {topThinSections.length}</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1220 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                <th style={{ padding: '8px 6px' }}>Section</th>
                <th style={{ padding: '8px 6px' }}>Status</th>
                <th style={{ padding: '8px 6px' }}>Objectives</th>
                <th style={{ padding: '8px 6px' }}>Pack</th>
                <th style={{ padding: '8px 6px' }}>Questions</th>
                <th style={{ padding: '8px 6px' }}>Scenario</th>
                <th style={{ padding: '8px 6px' }}>Interactive</th>
                <th style={{ padding: '8px 6px' }}>Avg wrong</th>
                <th style={{ padding: '8px 6px' }}>Thin reason(s)</th>
              </tr>
            </thead>
            <tbody>
              {topThinSections.map((row) => (
                <tr key={row.outlineId} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <td style={{ padding: '8px 6px' }}>
                    <div style={{ fontWeight: 700 }}>
                      Ch {row.chapterOrder}
                      {row.sectionOrder > 0 ? ` · Sec ${row.sectionOrder}` : ''}
                    </div>
                    <div style={{ color: 'var(--muted)', lineHeight: 1.4 }}>{row.title}</div>
                    <div style={{ color: 'var(--muted)' }}><code>{row.href}</code></div>
                  </td>
                  <td style={{ padding: '8px 6px' }}>{row.status}</td>
                  <td style={{ padding: '8px 6px' }}>{objectiveLabel(row.objectiveIds)}</td>
                  <td style={{ padding: '8px 6px' }}>{row.packId ?? 'Any'}</td>
                  <td style={{ padding: '8px 6px' }}>{row.questionCount}</td>
                  <td style={{ padding: '8px 6px' }}>{row.scenarioCount}</td>
                  <td style={{ padding: '8px 6px' }}>{row.interactiveCount}</td>
                  <td style={{ padding: '8px 6px', color: row.averageWrongRate && row.averageWrongRate > 0.35 ? 'var(--danger)' : 'var(--muted)' }}>
                    {formatPercent(row.averageWrongRate)}
                  </td>
                  <td style={{ padding: '8px 6px' }}>{row.thinReasons.join(', ') || 'n/a'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
