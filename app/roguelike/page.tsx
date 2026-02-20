'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { useLocalState } from '@/lib/useLocalState';
import { usePacks } from '@/lib/usePacks';
import { topWeakTags } from '@/lib/progress';
import {
  buildRuntimeConfig,
  clampMinutesPerQuestion,
  clampRuntimeMinutes,
  parseRoguelikeQueryParams
} from '@/lib/roguelikeConfig';

function createSeed() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function RoguelikeLanding() {
  const router = useRouter();
  const { state } = useLocalState();
  const { packs } = usePacks();
  const [seed, setSeed] = useState('');
  const [focusTags, setFocusTags] = useState<string[]>([]);
  const [requestedScope, setRequestedScope] = useState<string[]>([]);
  const [selectedPackIds, setSelectedPackIds] = useState<string[]>([]);
  const [scopeInitialized, setScopeInitialized] = useState(false);
  const [runtimeMinutes, setRuntimeMinutes] = useState(90);
  const [minutesPerQuestion, setMinutesPerQuestion] = useState(1);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const config = parseRoguelikeQueryParams(new URLSearchParams(window.location.search));
    setFocusTags(config.focusTags);
    setRequestedScope(config.chapterScope);
    setRuntimeMinutes(config.runtime.runtimeMinutes);
    setMinutesPerQuestion(config.runtime.minutesPerQuestion);
  }, []);

  useEffect(() => {
    if (scopeInitialized || packs.length === 0) return;
    if (requestedScope.length > 0) {
      const requestedSet = new Set(requestedScope);
      const validScope = packs.map((pack) => pack.pack_id).filter((id) => requestedSet.has(id));
      setSelectedPackIds(validScope.length > 0 ? validScope : packs.map((pack) => pack.pack_id));
    } else {
      setSelectedPackIds(packs.map((pack) => pack.pack_id));
    }
    setScopeInitialized(true);
  }, [packs, requestedScope, scopeInitialized]);

  const allSelected = packs.length > 0 && selectedPackIds.length === packs.length;
  const selectedChaptersLabel = useMemo(() => {
    if (selectedPackIds.length === 0) return 'No chapters selected';
    if (allSelected) return 'All chapters';
    return `${selectedPackIds.length} chapter${selectedPackIds.length === 1 ? '' : 's'} selected`;
  }, [allSelected, selectedPackIds.length]);

  const weakTags = topWeakTags(state.masteryByTag, 6);
  const exam = packs[0]?.exam;
  const packsReady = packs.length > 0 && selectedPackIds.length > 0;
  const runtimeConfig = buildRuntimeConfig(runtimeMinutes, minutesPerQuestion);
  const targetQuestions = runtimeConfig.targetQuestionCount;

  const togglePack = (packId: string) => {
    setSelectedPackIds((prev) => {
      if (prev.includes(packId)) {
        return prev.filter((id) => id !== packId);
      }
      const next = [...prev, packId];
      const packOrder = new Map(packs.map((pack, index) => [pack.pack_id, index]));
      next.sort((a, b) => (packOrder.get(a) ?? 0) - (packOrder.get(b) ?? 0));
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedPackIds([]);
      return;
    }
    setSelectedPackIds(packs.map((pack) => pack.pack_id));
  };

  const startRun = () => {
    if (!packsReady) return;
    const runSeed = seed.trim() || createSeed();
    const packIdSet = new Set(selectedPackIds);
    const scopedPackIds = packs.map((pack) => pack.pack_id).filter((id) => packIdSet.has(id));
    if (scopedPackIds.length === 0) return;
    const chapterQuery = `&chapters=${encodeURIComponent(scopedPackIds.join(','))}`;
    const timingQuery = `&runtime=${runtimeConfig.runtimeMinutes}&mpq=${runtimeConfig.minutesPerQuestion}`;
    const focusQuery = focusTags.length ? `&focus=${encodeURIComponent(focusTags.join(','))}` : '';
    router.push(`/roguelike/run?seed=${runSeed}${chapterQuery}${timingQuery}${focusQuery}` as Route);
  };

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="card">
        <div className="tag">Exam Mode</div>
        <h1 style={{ marginBottom: 6 }}>Roguelike Practice</h1>
        <p style={{ color: 'var(--muted)' }}>Randomized runs weighted by your weakest tags. No hints, timed, with justification required for full points.</p>
        {focusTags.length > 0 && (
          <p style={{ color: 'var(--muted)', marginTop: 8 }}>
            Focus filter active: {focusTags.join(', ')}
          </p>
        )}
        {!packsReady && <p style={{ color: 'var(--danger)' }}>No valid chapter packs loaded yet.</p>}
        <div className="flex" style={{ marginTop: 12 }}>
          <Link href={'/roguelike/plan' as Route} className="button secondary">View Run Plan</Link>
          <div className="stat-pill">Runtime: {runtimeConfig.runtimeMinutes} min</div>
          <div className="stat-pill">Pace: {runtimeConfig.minutesPerQuestion} min/question</div>
          <div className="stat-pill">Target: {targetQuestions} questions</div>
          <div className="stat-pill">{selectedChaptersLabel}</div>
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="panel-header">
          <div>
            <div className="tag">Run Settings</div>
            <p style={{ color: 'var(--muted)', margin: '8px 0 0' }}>
              Default pacing is 1 question per 1 minute. Adjust runtime and pace as needed.
            </p>
          </div>
          <span className="chip">{exam?.code ?? 'SY0-701'}</span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <label className="answer-card" style={{ display: 'grid', gap: 6 }}>
            <span className="tag">Runtime (minutes)</span>
            <input
              type="number"
              min={5}
              max={180}
              step={1}
              value={runtimeMinutes}
              onChange={(event) => setRuntimeMinutes(clampRuntimeMinutes(Number(event.target.value)))}
            />
          </label>
          <label className="answer-card" style={{ display: 'grid', gap: 6 }}>
            <span className="tag">Minutes per question</span>
            <input
              type="number"
              min={0.25}
              max={5}
              step={0.25}
              value={minutesPerQuestion}
              onChange={(event) => setMinutesPerQuestion(clampMinutesPerQuestion(Number(event.target.value)))}
            />
          </label>
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="panel-header">
          <div>
            <div className="tag">Chapter Scope</div>
            <p style={{ color: 'var(--muted)', margin: '8px 0 0' }}>Choose one or multiple chapters for this run.</p>
          </div>
          <button className="button secondary" onClick={toggleAll} disabled={packs.length === 0}>
            {allSelected ? 'Clear all' : 'Select all'}
          </button>
        </div>
        <div className="grid" style={{ gap: 8 }}>
          {packs.map((pack) => {
            const checked = selectedPackIds.includes(pack.pack_id);
            return (
              <label
                key={pack.pack_id}
                className="answer-card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  borderColor: checked ? 'rgba(126,231,255,0.55)' : 'rgba(255,255,255,0.08)',
                  background: checked ? 'rgba(126,231,255,0.08)' : 'rgba(255,255,255,0.03)'
                }}
              >
                <div style={{ display: 'grid', gap: 2 }}>
                  <strong>{`Chapter ${pack.chapter.number}: ${pack.chapter.title}`}</strong>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {pack.question_bank.length} questions
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => togglePack(pack.pack_id)}
                  aria-label={`Include Chapter ${pack.chapter.number}`}
                />
              </label>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div>
          <div className="tag">Seeded Run (optional)</div>
          <p style={{ color: 'var(--muted)' }}>Share a seed with a friend to replay the same run asynchronously.</p>
        </div>
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder="Enter seed or leave blank"
          style={{ padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text)' }}
        />
        <div className="flex" style={{ justifyContent: 'space-between' }}>
          <button className="button secondary" onClick={() => setSeed(createSeed())} disabled={!packsReady}>Generate Seed</button>
          <button className="button" onClick={startRun} disabled={!packsReady}>Start Run</button>
        </div>
      </div>

      <div className="card">
        <div className="panel-header">
          <b>Weak Tags (weighted)</b>
          <span className="tag">next run focus</span>
        </div>
        <div className="grid" style={{ gap: 8 }}>
          {weakTags.length === 0 && <div style={{ color: 'var(--muted)' }}>No mastery data yet. Play a campaign mission first.</div>}
          {weakTags.map((tag) => (
            <div key={tag} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="chip">{tag}</span>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>Mastery {state.masteryByTag[tag] ?? 50}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
