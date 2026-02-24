import fs from 'fs';
import path from 'path';
import Ajv from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { ChapterLesson } from './types';
import { normalizeLessonObjectives } from './objectiveIds';
import { LESSON_DIR } from './paths';

const SCHEMA_FILES = ['chapter_lessons.v3.schema.json', 'chapter_lessons.v2.schema.json', 'chapter_lessons.schema.json'];
let cache: ChapterLesson[] | null = null;
let validators: ValidateFunction[] | null = null;

function getValidators() {
  if (validators) return validators;
  const ajv = new Ajv({ allErrors: true, strict: false });
  validators = SCHEMA_FILES
    .map((file) => {
      const schemaPath = path.join(LESSON_DIR, file);
      if (!fs.existsSync(schemaPath)) return null;
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      return ajv.compile(schema);
    })
    .filter(Boolean) as ValidateFunction[];
  if (validators.length === 0) {
    throw new Error(`Lesson schema not found in ${LESSON_DIR}`);
  }
  return validators;
}

function validateLesson(lesson: unknown) {
  const activeValidators = getValidators();
  for (const validate of activeValidators) {
    if (validate(lesson)) {
      return { valid: true as const, errors: [] as string[] };
    }
  }
  const errors = activeValidators.flatMap((validate) =>
    (validate.errors ?? []).map((err) => `${err.instancePath || '/'} ${err.message}`)
  );
  return { valid: false as const, errors };
}

export function loadChapterLessons(): ChapterLesson[] {
  if (process.env.NODE_ENV !== 'production') {
    cache = null;
  }
  if (cache) return cache;
  if (!fs.existsSync(LESSON_DIR)) return [];

  const files = fs
    .readdirSync(LESSON_DIR)
    .filter((file) => file.endsWith('.lesson.json'));

  const lessons: ChapterLesson[] = [];

  files.forEach((file) => {
    const fullPath = path.join(LESSON_DIR, file);
    let lesson: ChapterLesson;
    try {
      lesson = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as ChapterLesson;
    } catch (err) {
      console.warn(`Failed to parse lesson ${file}:`, err);
      return;
    }
    const validation = validateLesson(lesson);
    if (!validation.valid) {
      console.warn(`Invalid lesson ${file}: ${validation.errors.join('; ')}`);
      return;
    }
    lessons.push(normalizeLessonObjectives(lesson));
  });

  cache = lessons;
  return lessons;
}

export function getLessonByPackId(packId: string) {
  return loadChapterLessons().find((lesson) => lesson.pack_id === packId);
}
