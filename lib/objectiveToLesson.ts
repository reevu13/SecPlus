import mapDoc from '@/content/mappings/objective_to_lesson.json';
import { MistakeCardRemediation } from './types';

type ObjectiveToLessonEntry = {
  objectiveId: string;
  chapterId: string;
  moduleId: string;
  pageId: string;
  label: string;
};

function normalizeEntries(entries: unknown): ObjectiveToLessonEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry): entry is ObjectiveToLessonEntry => (
      !!entry
      && typeof entry === 'object'
      && typeof (entry as { objectiveId?: unknown }).objectiveId === 'string'
      && typeof (entry as { chapterId?: unknown }).chapterId === 'string'
      && typeof (entry as { moduleId?: unknown }).moduleId === 'string'
      && typeof (entry as { pageId?: unknown }).pageId === 'string'
      && typeof (entry as { label?: unknown }).label === 'string'
    ))
    .map((entry) => ({
      objectiveId: entry.objectiveId.trim(),
      chapterId: entry.chapterId.trim(),
      moduleId: entry.moduleId.trim(),
      pageId: entry.pageId.trim(),
      label: entry.label.trim()
    }))
    .filter((entry) => (
      entry.objectiveId.length > 0
      && entry.chapterId.length > 0
      && entry.moduleId.length > 0
      && entry.pageId.length > 0
      && entry.label.length > 0
    ));
}

const objectiveMapEntries = normalizeEntries((mapDoc as { entries?: unknown }).entries);
const objectiveMapById = new Map(objectiveMapEntries.map((entry) => [entry.objectiveId, entry]));

function buildHref(entry: ObjectiveToLessonEntry) {
  const params = new URLSearchParams({
    module: entry.moduleId,
    page: entry.pageId
  });
  return `/chapter/${encodeURIComponent(entry.chapterId)}?${params.toString()}`;
}

export function remediationForObjectiveIds(objectiveIds: string[]): MistakeCardRemediation[] {
  for (const objectiveId of objectiveIds) {
    if (!objectiveId) continue;
    const entry = objectiveMapById.get(objectiveId);
    if (!entry) continue;
    return [{
      label: entry.label,
      href: buildHref(entry),
      objectiveIds: [entry.objectiveId]
    }];
  }
  return [];
}
