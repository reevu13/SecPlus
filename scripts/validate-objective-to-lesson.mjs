import fs from 'fs';
import path from 'path';
import Ajv from 'ajv/dist/2020.js';

const cwd = process.cwd();
const mappingDir = path.join(cwd, 'content', 'mappings');
const lessonsDir = path.join(cwd, 'content', 'chapter_lessons');
const objectivesPath = path.join(cwd, 'content', 'objectives', 'sy0-701.objectives.json');
const schemaPath = path.join(mappingDir, 'objective_to_lesson.schema.json');
const mapPath = path.join(mappingDir, 'objective_to_lesson.json');

function formatAjvError(error) {
  let pathPart = error.instancePath || '';
  if (error.keyword === 'required' && error.params?.missingProperty) {
    pathPart += `/${error.params.missingProperty}`;
  }
  return `${pathPart || '/'}: ${error.message}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadLessonDocs() {
  if (!fs.existsSync(lessonsDir)) return new Map();
  const byPackId = new Map();
  const files = fs
    .readdirSync(lessonsDir)
    .filter((file) => file.endsWith('.lesson.json'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  for (const file of files) {
    const fullPath = path.join(lessonsDir, file);
    try {
      const lesson = readJson(fullPath);
      if (typeof lesson?.pack_id === 'string' && lesson.pack_id.trim()) {
        byPackId.set(lesson.pack_id.trim(), lesson);
      }
    } catch (error) {
      throw new Error(`Failed to parse lesson file ${file}: ${error.message}`);
    }
  }

  return byPackId;
}

if (!fs.existsSync(schemaPath)) {
  console.error(`Mapping schema not found: ${schemaPath}`);
  process.exit(1);
}

if (!fs.existsSync(mapPath)) {
  console.error(`Mapping file not found: ${mapPath}`);
  process.exit(1);
}

if (!fs.existsSync(objectivesPath)) {
  console.error(`Objectives file not found: ${objectivesPath}`);
  process.exit(1);
}

let schema;
let mapDoc;
let objectivesDoc;

try {
  schema = readJson(schemaPath);
} catch (error) {
  console.error(`Failed to parse schema: ${error.message}`);
  process.exit(1);
}

try {
  mapDoc = readJson(mapPath);
} catch (error) {
  console.error(`objective_to_lesson.json is not valid JSON: ${error.message}`);
  process.exit(1);
}

try {
  objectivesDoc = readJson(objectivesPath);
} catch (error) {
  console.error(`Failed to parse objectives file: ${error.message}`);
  process.exit(1);
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);
const valid = validate(mapDoc);

const errors = [];
if (!valid) {
  (validate.errors ?? []).forEach((error) => errors.push(formatAjvError(error)));
}

const objectiveSet = new Set(
  Array.isArray(objectivesDoc?.objectives)
    ? objectivesDoc.objectives
      .map((objective) => (typeof objective?.id === 'string' ? objective.id.trim() : ''))
      .filter(Boolean)
    : []
);

let lessonsByPackId;
try {
  lessonsByPackId = loadLessonDocs();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (valid && Array.isArray(mapDoc.entries)) {
  const seenObjectiveIds = new Map();

  mapDoc.entries.forEach((entry, index) => {
    const entryPath = `/entries/${index}`;
    if (!entry || typeof entry !== 'object') return;

    const objectiveId = typeof entry.objectiveId === 'string' ? entry.objectiveId.trim() : '';
    const chapterId = typeof entry.chapterId === 'string' ? entry.chapterId.trim() : '';
    const moduleId = typeof entry.moduleId === 'string' ? entry.moduleId.trim() : '';
    const pageId = typeof entry.pageId === 'string' ? entry.pageId.trim() : '';

    if (objectiveId) {
      const firstIndex = seenObjectiveIds.get(objectiveId);
      if (typeof firstIndex === 'number') {
        errors.push(`${entryPath}/objectiveId: duplicate objectiveId '${objectiveId}' (already used at /entries/${firstIndex})`);
      } else {
        seenObjectiveIds.set(objectiveId, index);
      }

      if (!objectiveSet.has(objectiveId)) {
        errors.push(`${entryPath}/objectiveId: unknown objectiveId '${objectiveId}'`);
      }
    }

    const lesson = lessonsByPackId.get(chapterId);
    if (!lesson) {
      errors.push(`${entryPath}/chapterId: chapter '${chapterId}' not found in lesson packs`);
      return;
    }

    const lessonModule = Array.isArray(lesson.modules)
      ? lesson.modules.find((mod) => mod && typeof mod.id === 'string' && mod.id === moduleId)
      : undefined;
    if (!lessonModule) {
      errors.push(`${entryPath}/moduleId: module '${moduleId}' not found in chapter '${chapterId}'`);
      return;
    }

    const pageExists = Array.isArray(lessonModule.pages)
      && lessonModule.pages.some((page) => page && typeof page.id === 'string' && page.id === pageId);
    if (!pageExists) {
      errors.push(`${entryPath}/pageId: page '${pageId}' not found in module '${moduleId}'`);
    }
  });
}

if (errors.length > 0) {
  console.error('objective_to_lesson.json failed validation:');
  errors.forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}

const entryCount = Array.isArray(mapDoc.entries) ? mapDoc.entries.length : 0;
console.log(`Objective-to-lesson mapping valid (${entryCount} entr${entryCount === 1 ? 'y' : 'ies'}).`);
