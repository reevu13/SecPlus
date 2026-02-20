'use client';

import { useMemo } from 'react';
import { computeObjectiveCoverageReport } from '@/lib/coverage';
import { useLocalState } from '@/lib/useLocalState';
import { useObjectives } from '@/lib/useObjectives';
import { usePacks } from '@/lib/usePacks';

function formatPercent(value: number | null) {
  if (value === null) return 'n/a';
  return `${Math.round(value * 100)}%`;
}

export default function CoveragePage() {
  const { packs, loaded: packsLoaded, error: packsError } = usePacks();
  const { doc, loaded: objectivesLoaded, error: objectivesError } = useObjectives();
  const { state, loaded: stateLoaded } = useLocalState();

  const report = useMemo(() => {
    if (!doc) return null;
    return computeObjectiveCoverageReport(doc, packs, stateLoaded ? state : undefined);
  }, [doc, packs, state, stateLoaded]);

  if (!packsLoaded || !objectivesLoaded || !stateLoaded) {
    return (
      <div className="card">
        <div className="tag">Coverage</div>
        <h1 style={{ marginTop: 8 }}>Objective coverage report</h1>
        <p style={{ color: 'var(--muted)' }}>Loading objectives, packs, and local performance stats...</p>
      </div>
    );
  }

  if (packsError || objectivesError || !report || !doc) {
    return (
      <div className="card">
        <div className="tag">Coverage</div>
        <h1 style={{ marginTop: 8 }}>Objective coverage report unavailable</h1>
        <p style={{ color: 'var(--muted)' }}>{packsError ?? objectivesError ?? 'Coverage data is not available.'}</p>
      </div>
    );
  }

  const missingSet = new Set(report.missingObjectiveIds);
  const domainTitleById = new Map(doc.domains.map((domain) => [domain.id, domain.title]));

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="tag">SY0-701 Objectives</div>
        <h1 style={{ marginTop: 8, marginBottom: 8 }}>Coverage report</h1>
        <p style={{ color: 'var(--muted)', margin: 0 }}>
          Tracks objective coverage from question objective tags and local wrong-rate trends.
        </p>
        <div className="flex" style={{ marginTop: 12 }}>
          <div className="stat-pill">Objectives: {report.objectiveCount}</div>
          <div className="stat-pill">Missing: {report.missingObjectiveIds.length}</div>
          <div className="stat-pill">Untagged questions: {report.untaggedQuestionCount}</div>
          <div className="stat-pill">Generated: {new Date(report.generatedAt).toLocaleString()}</div>
        </div>
      </section>

      <section className="card">
        <div className="panel-header">
          <h2 style={{ margin: 0 }}>Top 20 weakest objectives</h2>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                <th style={{ padding: '8px 6px' }}>Objective</th>
                <th style={{ padding: '8px 6px' }}>Domain</th>
                <th style={{ padding: '8px 6px' }}>Questions</th>
                <th style={{ padding: '8px 6px' }}>Scenario</th>
                <th style={{ padding: '8px 6px' }}>Matching</th>
                <th style={{ padding: '8px 6px' }}>Ordering</th>
                <th style={{ padding: '8px 6px' }}>PBQ-style</th>
                <th style={{ padding: '8px 6px' }}>Avg wrong rate</th>
              </tr>
            </thead>
            <tbody>
              {report.topWeakest.map((row) => (
                <tr key={row.objectiveId} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <td style={{ padding: '8px 6px' }}>
                    <div style={{ fontWeight: 700 }}>{row.objectiveId}</div>
                    <div style={{ color: 'var(--muted)', lineHeight: 1.4 }}>{row.title}</div>
                  </td>
                  <td style={{ padding: '8px 6px', color: 'var(--muted)' }}>
                    {row.domainId} {domainTitleById.get(row.domainId) ? `· ${domainTitleById.get(row.domainId)}` : ''}
                  </td>
                  <td style={{ padding: '8px 6px' }}>{row.questionCount}</td>
                  <td style={{ padding: '8px 6px' }}>{row.scenarioCount}</td>
                  <td style={{ padding: '8px 6px' }}>{row.matchingCount}</td>
                  <td style={{ padding: '8px 6px' }}>{row.orderingCount}</td>
                  <td style={{ padding: '8px 6px' }}>{row.pbqCount}</td>
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
          <h2 style={{ margin: 0 }}>Missing objectives</h2>
          <div className="chip">{report.missingObjectiveIds.length} with zero tagged questions</div>
        </div>
        {report.missingObjectiveIds.length === 0 ? (
          <p style={{ color: 'var(--success)', margin: 0 }}>All objectives have at least one tagged question.</p>
        ) : (
          <div className="flex" style={{ alignItems: 'flex-start' }}>
            {report.missingObjectiveIds.map((objectiveId) => {
              const row = report.rows.find((item) => item.objectiveId === objectiveId);
              return (
                <div key={objectiveId} className="chip" style={{ border: '1px solid rgba(255,123,123,0.45)', color: missingSet.has(objectiveId) ? 'var(--danger)' : 'var(--text)' }}>
                  {objectiveId}: {row?.title ?? 'Untitled objective'}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
