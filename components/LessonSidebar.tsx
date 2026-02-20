'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChapterLesson, LessonModule, LessonPage } from '@/lib/types';

export type LessonTocModuleEntry = {
  module: LessonModule;
  pages: LessonPage[];
};

type LessonSidebarProps = {
  lesson: ChapterLesson;
  tocModules: LessonTocModuleEntry[];
  query: string;
  onQueryChange: (value: string) => void;
  activeModuleId: string;
  activePageId: string;
  completedPages: Set<string>;
  onSelectModule: (moduleId: string) => void;
  onSelectPage: (moduleId: string, pageId: string) => void;
  onContinue: () => void;
  continueLabel: string | null;
  onJumpModule: (moduleId: string) => void;
  onNavigateToContent?: () => void;
};

function moduleProgress(module: LessonModule, completedPages: Set<string>) {
  const total = module.pages.length;
  const completed = module.pages.filter((page) => completedPages.has(page.id)).length;
  return { total, completed };
}

export default function LessonSidebar({
  lesson,
  tocModules,
  query,
  onQueryChange,
  activeModuleId,
  activePageId,
  completedPages,
  onSelectModule,
  onSelectPage,
  onContinue,
  continueLabel,
  onJumpModule,
  onNavigateToContent
}: LessonSidebarProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openModules, setOpenModules] = useState<Record<string, boolean>>({});

  const moduleNumberById = useMemo(
    () => new Map(lesson.modules.map((module, index) => [module.id, index + 1])),
    [lesson.modules]
  );

  useEffect(() => {
    if (!activeModuleId) return;
    setOpenModules((prev) => {
      if (prev[activeModuleId] !== undefined) return prev;
      return { ...prev, [activeModuleId]: true };
    });
  }, [activeModuleId]);

  useEffect(() => {
    if (!query.trim()) return;
    setOpenModules((prev) => {
      const next = { ...prev };
      tocModules.forEach(({ module }) => {
        next[module.id] = true;
      });
      return next;
    });
  }, [query, tocModules]);

  const openModule = (moduleId: string) => {
    setOpenModules((prev) => ({ ...prev, [moduleId]: true }));
  };

  const navigateToContent = () => {
    onNavigateToContent?.();
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches) {
      setSidebarCollapsed(true);
    }
  };

  return (
    <aside className={`lesson-sidebar-shell ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
      <div className="card lesson-sidebar-card">
        <div className="lesson-sidebar-top">
          <div>
            <div className="tag">Contents</div>
            <h3>Modules</h3>
          </div>
          <button
            className="button secondary lesson-collapse-button"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!sidebarCollapsed}
          >
            {sidebarCollapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>

        {sidebarCollapsed ? (
          <div className="lesson-sidebar-rail" aria-label="Module rail">
            {lesson.modules.map((module) => {
              const moduleNumber = moduleNumberById.get(module.id) ?? 0;
              const isActive = module.id === activeModuleId;
              return (
                <button
                  key={module.id}
                  className={`lesson-rail-module ${isActive ? 'is-active' : ''}`}
                  onClick={() => {
                    onSelectModule(module.id);
                    navigateToContent();
                  }}
                  title={`Module ${moduleNumber}: ${module.title}`}
                  aria-label={`Module ${moduleNumber}`}
                >
                  {moduleNumber}
                </button>
              );
            })}
          </div>
        ) : (
          <>
            <div className="lesson-sidebar-controls">
              <input
                className="lesson-sidebar-search"
                type="search"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search modules or pages"
                aria-label="Search modules or pages"
              />
              <div className="lesson-sidebar-actions">
                <button
                  className="button"
                  onClick={() => {
                    onContinue();
                    navigateToContent();
                  }}
                  disabled={!continueLabel}
                >
                  Continue lesson
                </button>
                <label className="lesson-jump-label">
                  <span className="tag">Jump to module</span>
                  <select
                    className="lesson-jump-select"
                    value={activeModuleId}
                    onChange={(event) => {
                      onJumpModule(event.target.value);
                      openModule(event.target.value);
                      navigateToContent();
                    }}
                  >
                    {lesson.modules.map((module) => {
                      const moduleNumber = moduleNumberById.get(module.id) ?? 0;
                      return (
                        <option key={module.id} value={module.id}>
                          {`Module ${moduleNumber}: ${module.title}`}
                        </option>
                      );
                    })}
                  </select>
                </label>
                {continueLabel && (
                  <div className="chip lesson-continue-chip" title={continueLabel}>
                    {continueLabel}
                  </div>
                )}
              </div>
            </div>

            <div className="lesson-sidebar-list">
              {tocModules.length === 0 && (
                <div className="answer-card lesson-empty-state">No matching modules.</div>
              )}

              {tocModules.map(({ module, pages }) => {
                const moduleNumber = moduleNumberById.get(module.id) ?? 0;
                const stats = moduleProgress(module, completedPages);
                const isActiveModule = module.id === activeModuleId;
                const isOpen = query.trim().length > 0 || (openModules[module.id] ?? isActiveModule);

                return (
                  <section key={module.id} className="lesson-module-group">
                    <button
                      className={`lesson-module-toggle ${isActiveModule ? 'is-active' : ''}`}
                      onClick={() => {
                        onSelectModule(module.id);
                        openModule(module.id);
                        navigateToContent();
                      }}
                      aria-expanded={isOpen}
                    >
                      <div className="lesson-module-title-wrap">
                        <span className="tag">{`Module ${moduleNumber}`}</span>
                        <span className="lesson-module-title">{module.title}</span>
                      </div>
                      <span className="chip">{`${stats.completed}/${stats.total}`}</span>
                    </button>

                    {isOpen && (
                      <div className="lesson-page-list">
                        {pages.map((page) => {
                          const pageNumber = module.pages.findIndex((item) => item.id === page.id) + 1;
                          const done = completedPages.has(page.id);
                          const isActivePage = page.id === activePageId;
                          return (
                            <button
                              key={page.id}
                              className={`lesson-page-link ${isActivePage ? 'is-active' : ''} ${done ? 'is-complete' : ''}`}
                              onClick={() => {
                                onSelectPage(module.id, page.id);
                                navigateToContent();
                              }}
                            >
                              <span className="lesson-page-meta">{`Page ${pageNumber}`}</span>
                              <span className="lesson-page-title">{page.title}</span>
                              <span className="lesson-page-state">{done ? 'Complete' : 'In progress'}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
