import { ChapterLesson, LessonModule, LessonPage, LessonRecallItem } from './types';

export const LESSON_XP_RULES = {
  per_check_correct: 5,
  per_page_complete: 20
};

export function buildLessonCheckId(pageId: string, checkIndex: number) {
  return `${pageId}::${checkIndex}`;
}

export function flattenLessonPages(lesson: ChapterLesson): LessonPage[] {
  return lesson.modules.flatMap((module) => module.pages);
}

export function getLessonTagSet(lesson: ChapterLesson) {
  const tags = new Set<string>();
  lesson.modules.forEach((module) => {
    module.tag_ids.forEach((tag) => tags.add(tag));
  });
  return tags;
}

export function getModuleById(lesson: ChapterLesson, moduleId: string) {
  return lesson.modules.find((module) => module.id === moduleId) ?? lesson.modules[0];
}

export function getPageById(module: LessonModule, pageId: string) {
  return module.pages.find((page) => page.id === pageId) ?? module.pages[0];
}

export function buildRecallItems(lesson: ChapterLesson): LessonRecallItem[] {
  const items: LessonRecallItem[] = [];

  lesson.modules.forEach((module) => {
    module.pages.forEach((page) => {
      const explainBlock = page.content_blocks.find((block) => block.type === 'explain')
        ?? page.content_blocks.find((block) => block.type === 'diagram')
        ?? page.content_blocks[0];
      if (explainBlock) {
        items.push({
          id: `${page.id}::explain`,
          type: 'explain',
          prompt: `Explain in one sentence: ${page.title}`,
          explanation: explainBlock.text,
          module_id: module.id,
          page_id: page.id,
          tag_ids: module.tag_ids
        });
      }

      page.checks.forEach((check, index) => {
        if (check.type !== 'cloze') return;
        items.push({
          id: buildLessonCheckId(page.id, index),
          type: 'cloze',
          prompt: check.prompt,
          answers: check.answers,
          explanation: check.explanation,
          module_id: module.id,
          page_id: page.id,
          tag_ids: module.tag_ids
        });
      });
    });
  });

  return items;
}
