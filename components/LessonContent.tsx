'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import { LessonCheck, LessonContentBlock, LessonModule, LessonPage } from '@/lib/types';

const SECTION_ORDER: LessonContentBlock['type'][] = ['explain', 'diagram', 'example', 'trap'];

const SECTION_LABELS: Record<LessonContentBlock['type'], string> = {
  explain: 'Explain',
  diagram: 'Diagram',
  example: 'Example',
  trap: 'Trap'
};

type LessonContentProps = {
  activeModule?: LessonModule;
  activePage?: LessonPage;
  completedPages: Set<string>;
  onSelectPage: (pageId: string) => void;
  renderCheck: (check: LessonCheck, index: number) => ReactNode;
  moduleNumber: number;
  onPreviousPage?: () => void;
  onNextPage?: () => void;
  previousLabel?: string;
  nextLabel?: string;
};

export default function LessonContent({
  activeModule,
  activePage,
  completedPages,
  onSelectPage,
  renderCheck,
  moduleNumber,
  onPreviousPage,
  onNextPage,
  previousLabel,
  nextLabel
}: LessonContentProps) {
  const blocksByType = useMemo(() => {
    const grouped: Record<LessonContentBlock['type'], LessonContentBlock[]> = {
      explain: [],
      diagram: [],
      example: [],
      trap: []
    };
    (activePage?.content_blocks ?? []).forEach((block) => {
      grouped[block.type].push(block);
    });
    return grouped;
  }, [activePage]);

  const availableSections = useMemo(
    () => SECTION_ORDER.filter((type) => blocksByType[type].length > 0),
    [blocksByType]
  );
  const sectionKey = availableSections.join('|');

  const [activeSection, setActiveSection] = useState<LessonContentBlock['type']>('explain');

  useEffect(() => {
    if (availableSections.length === 0) return;
    if (!availableSections.includes(activeSection)) {
      setActiveSection(availableSections[0]);
    }
  }, [activeSection, availableSections, sectionKey]);

  if (!activeModule || !activePage) {
    return (
      <div className="card lesson-content-card">
        <div className="lesson-empty-state">Pick a module and page to begin.</div>
      </div>
    );
  }

  const activePageNumber = activeModule.pages.findIndex((page) => page.id === activePage.id) + 1;
  const visibleBlocks = blocksByType[activeSection] ?? [];

  return (
    <section className="card lesson-content-card">
      <div className="lesson-module-head">
        <div>
          <div className="tag">{`Module ${moduleNumber}`}</div>
          <h2>{activeModule.title}</h2>
          <p>Select a page, read the concept breakdown, and complete quick checks.</p>
        </div>
        <div className="chip">{`${activeModule.pages.length} pages`}</div>
      </div>

      <div className="lesson-page-strip" role="tablist" aria-label="Pages in selected module">
        {activeModule.pages.map((page, index) => {
          const done = completedPages.has(page.id);
          const active = page.id === activePage.id;
          return (
            <button
              key={page.id}
              className={`lesson-page-pill ${active ? 'is-active' : ''} ${done ? 'is-complete' : ''}`}
              onClick={() => onSelectPage(page.id)}
              role="tab"
              aria-selected={active}
            >
              <span>{`Page ${index + 1}`}</span>
              <span>{page.title}</span>
            </button>
          );
        })}
      </div>

      {(onPreviousPage || onNextPage) && (
        <div className="lesson-mobile-nav" aria-label="Lesson page navigation">
          <button
            className="button secondary"
            onClick={onPreviousPage}
            disabled={!onPreviousPage}
            title={previousLabel}
          >
            Previous page
          </button>
          <button
            className="button secondary"
            onClick={onNextPage}
            disabled={!onNextPage}
            title={nextLabel}
          >
            Next page
          </button>
        </div>
      )}

      <article className="lesson-reading-shell">
        <header className="lesson-reading-head">
          <div className="tag">{`Page ${activePageNumber}`}</div>
          <h3>{activePage.title}</h3>
        </header>

        {availableSections.length > 0 && (
          <>
            <div className="lesson-block-tabs" role="tablist" aria-label="Lesson section tabs">
              {availableSections.map((type) => (
                <button
                  key={type}
                  className={`lesson-block-tab ${type === activeSection ? 'is-active' : ''}`}
                  onClick={() => setActiveSection(type)}
                  role="tab"
                  aria-selected={type === activeSection}
                >
                  {`${SECTION_LABELS[type]} (${blocksByType[type].length})`}
                </button>
              ))}
            </div>
            <div className="lesson-block-panel" role="tabpanel">
              {visibleBlocks.map((block, index) => (
                <section key={`${activePage.id}-${block.type}-${index}`} className="lesson-block-panel-card">
                  <div className="lesson-block-kicker">{SECTION_LABELS[block.type]}</div>
                  <div className="lesson-reading-measure">{block.text}</div>
                </section>
              ))}
            </div>
          </>
        )}
      </article>

      <section className="lesson-checks-section">
        <div className="panel-header">
          <h3>Quick checks</h3>
          <span className="tag">{`${activePage.checks.length} checks`}</span>
        </div>
        <div className="lesson-check-list">
          {activePage.checks.map((check, index) => (
            <div key={`${activePage.id}-check-${index}`} className="lesson-check">
              {renderCheck(check, index)}
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
