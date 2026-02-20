import fs from 'fs';
import path from 'path';

const cwd = process.cwd();
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const patchArg = args.find((arg) => arg.startsWith('--patch='));
const defaultPatchPath = path.join(cwd, 'content', '_reports', 'objective_backfill_patch.json');
const patchPath = patchArg ? path.resolve(cwd, patchArg.slice('--patch='.length)) : defaultPatchPath;

const objectivesPath = path.join(cwd, 'content', 'objectives', 'sy0-701.objectives.json');
const packsDir = path.join(cwd, 'content', 'chapter_packs');
const lessonsDir = path.join(cwd, 'content', 'chapter_lessons');
const reportPath = path.join(cwd, 'content', '_reports', 'objective_backfill_apply_report.json');

const OBJECTIVE_ID_RE = /^\d+\.\d+$/;
const SCHEMA_PREFIX = 'chapter_pack.';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function objectiveIdSort(a, b) {
  const [aMajor, aMinor] = a.split('.').map((segment) => Number.parseInt(segment, 10));
  const [bMajor, bMinor] = b.split('.').map((segment) => Number.parseInt(segment, 10));
  if (aMajor !== bMajor) return aMajor - bMajor;
  return aMinor - bMinor;
}

function normalizeObjectiveIds(values, validObjectiveIdSet) {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => OBJECTIVE_ID_RE.test(value) && validObjectiveIdSet.has(value))
  )].sort(objectiveIdSort);
}

function objectiveIdsFromText(values, validObjectiveIdSet) {
  const set = new Set();
  values.forEach((value) => {
    if (typeof value !== 'string') return;
    value.match(/\b\d+\.\d+\b/g)?.forEach((candidate) => {
      if (validObjectiveIdSet.has(candidate)) {
        set.add(candidate);
      }
    });
  });
  return [...set].sort(objectiveIdSort);
}

function detectIndent(raw) {
  const match = raw.match(/\n( +)"/);
  if (!match) return 2;
  return Math.max(2, match[1].length);
}

function writeJsonPreserveStyle(filePath, data) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const indent = detectIndent(raw);
  const trailingNewline = raw.endsWith('\n');
  const nextRaw = `${JSON.stringify(data, null, indent)}${trailingNewline ? '\n' : ''}`;
  if (nextRaw !== raw) {
    if (!dryRun) {
      fs.writeFileSync(filePath, nextRaw, 'utf8');
    }
    return true;
  }
  return false;
}

if (!fs.existsSync(patchPath)) {
  fail(`Patch file not found: ${path.relative(cwd, patchPath)}`);
}
if (!fs.existsSync(objectivesPath)) {
  fail(`Objectives file not found: ${path.relative(cwd, objectivesPath)}`);
}
if (!fs.existsSync(packsDir)) {
  fail(`Packs directory not found: ${path.relative(cwd, packsDir)}`);
}
if (!fs.existsSync(lessonsDir)) {
  fail(`Lessons directory not found: ${path.relative(cwd, lessonsDir)}`);
}

const objectivesDoc = readJson(objectivesPath);
const validObjectiveIdSet = new Set(
  (objectivesDoc.objectives ?? [])
    .map((objective) => objective?.id)
    .filter((id) => typeof id === 'string' && OBJECTIVE_ID_RE.test(id))
);

const rawPatch = readJson(patchPath);
if (!Array.isArray(rawPatch)) {
  fail(`Patch file must be an array: ${path.relative(cwd, patchPath)}`);
}

const duplicateEntries = [];
const invalidEntries = [];
const patchByKey = new Map();

rawPatch.forEach((entry, index) => {
  const packId = typeof entry?.packId === 'string' ? entry.packId.trim() : '';
  const questionId = typeof entry?.questionId === 'string' ? entry.questionId.trim() : '';
  const objectiveIds = normalizeObjectiveIds(entry?.objectiveIds, validObjectiveIdSet);
  const key = `${packId}::${questionId}`;

  if (!packId || !questionId) {
    invalidEntries.push({
      index,
      reason: 'missing packId/questionId'
    });
    return;
  }

  const requestedObjectiveIds = Array.isArray(entry?.objectiveIds)
    ? entry.objectiveIds.filter((id) => typeof id === 'string').map((id) => id.trim()).filter(Boolean)
    : [];
  const invalidObjectiveIds = requestedObjectiveIds.filter((id) => !validObjectiveIdSet.has(id));
  if (requestedObjectiveIds.length === 0 || objectiveIds.length === 0) {
    invalidEntries.push({
      index,
      key,
      reason: 'no valid objectiveIds'
    });
    return;
  }
  if (invalidObjectiveIds.length > 0) {
    invalidEntries.push({
      index,
      key,
      reason: `invalid objectiveIds: ${invalidObjectiveIds.join(', ')}`
    });
  }

  if (patchByKey.has(key)) {
    duplicateEntries.push({ index, key });
  }

  patchByKey.set(key, {
    packId,
    questionId,
    objectiveIds
  });
});

const packFiles = fs.readdirSync(packsDir)
  .filter((file) => file.endsWith('.json') && !file.startsWith(SCHEMA_PREFIX))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

const missingTargets = [];
const touchedPackFiles = [];
const appliedEntries = [];
const packObjectiveIds = new Map();

let totalQuestionsUpdated = 0;

packFiles.forEach((file) => {
  const fullPath = path.join(packsDir, file);
  const doc = readJson(fullPath);
  const packId = typeof doc?.pack_id === 'string' ? doc.pack_id.trim() : '';
  const questions = Array.isArray(doc?.question_bank) ? doc.question_bank : [];
  const questionById = new Map(
    questions
      .filter((question) => typeof question?.id === 'string')
      .map((question) => [question.id, question])
  );

  let fileChanged = false;

  patchByKey.forEach((patchEntry) => {
    if (patchEntry.packId !== packId) return;
    const question = questionById.get(patchEntry.questionId);
    if (!question) {
      missingTargets.push({
        key: `${patchEntry.packId}::${patchEntry.questionId}`,
        reason: `question not found in ${file}`
      });
      return;
    }

    const currentObjectiveIds = normalizeObjectiveIds(question.objectiveIds, validObjectiveIdSet);
    const nextObjectiveIds = normalizeObjectiveIds(patchEntry.objectiveIds, validObjectiveIdSet);
    const changed = JSON.stringify(currentObjectiveIds) !== JSON.stringify(nextObjectiveIds);
    if (!changed) return;

    question.objectiveIds = nextObjectiveIds;
    fileChanged = true;
    totalQuestionsUpdated += 1;
    appliedEntries.push({
      key: `${patchEntry.packId}::${patchEntry.questionId}`,
      objectiveIds: nextObjectiveIds
    });
  });

  const collectedObjectiveIds = normalizeObjectiveIds(
    questions.flatMap((question) => question?.objectiveIds ?? []),
    validObjectiveIdSet
  );
  if (packId) {
    packObjectiveIds.set(packId, collectedObjectiveIds);
  }

  if (fileChanged) {
    writeJsonPreserveStyle(fullPath, doc);
    touchedPackFiles.push(file);
  }
});

const touchedLessonFiles = [];
const lessonUpdates = {
  lessonObjectiveIdsUpdated: 0,
  moduleObjectiveIdsUpdated: 0,
  pageObjectiveIdsUpdated: 0,
  checkObjectiveIdsUpdated: 0
};

const lessonFiles = fs.readdirSync(lessonsDir)
  .filter((file) => file.endsWith('.lesson.json'))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

lessonFiles.forEach((file) => {
  const fullPath = path.join(lessonsDir, file);
  const doc = readJson(fullPath);
  const packId = typeof doc?.pack_id === 'string' ? doc.pack_id.trim() : '';
  const packIdsForLesson = packObjectiveIds.get(packId) ?? [];
  const modules = Array.isArray(doc?.modules) ? doc.modules : [];

  let lessonChanged = false;

  modules.forEach((module) => {
    const inferredModuleObjectiveIds = objectiveIdsFromText(module?.tag_ids ?? [], validObjectiveIdSet);
    const existingModuleObjectiveIds = normalizeObjectiveIds(module?.objectiveIds, validObjectiveIdSet);
    const moduleBaseObjectiveIds = normalizeObjectiveIds(
      [...existingModuleObjectiveIds, ...inferredModuleObjectiveIds, ...packIdsForLesson],
      validObjectiveIdSet
    );

    const pages = Array.isArray(module?.pages) ? module.pages : [];
    const pageObjectiveIds = [];

    pages.forEach((page) => {
      const existingPageObjectiveIds = normalizeObjectiveIds(page?.objectiveIds, validObjectiveIdSet);
      const nextPageObjectiveIds = normalizeObjectiveIds(
        [...existingPageObjectiveIds, ...moduleBaseObjectiveIds],
        validObjectiveIdSet
      );
      pageObjectiveIds.push(...nextPageObjectiveIds);

      const checks = Array.isArray(page?.checks) ? page.checks : [];
      checks.forEach((check) => {
        const existingCheckObjectiveIds = normalizeObjectiveIds(check?.objectiveIds, validObjectiveIdSet);
        const nextCheckObjectiveIds = normalizeObjectiveIds(
          [...existingCheckObjectiveIds, ...nextPageObjectiveIds],
          validObjectiveIdSet
        );
        if (JSON.stringify(existingCheckObjectiveIds) !== JSON.stringify(nextCheckObjectiveIds)) {
          check.objectiveIds = nextCheckObjectiveIds;
          lessonChanged = true;
          lessonUpdates.checkObjectiveIdsUpdated += 1;
        }
      });

      if (JSON.stringify(existingPageObjectiveIds) !== JSON.stringify(nextPageObjectiveIds)) {
        page.objectiveIds = nextPageObjectiveIds;
        lessonChanged = true;
        lessonUpdates.pageObjectiveIdsUpdated += 1;
      }
    });

    const nextModuleObjectiveIds = normalizeObjectiveIds(
      [...moduleBaseObjectiveIds, ...pageObjectiveIds],
      validObjectiveIdSet
    );

    if (JSON.stringify(existingModuleObjectiveIds) !== JSON.stringify(nextModuleObjectiveIds)) {
      module.objectiveIds = nextModuleObjectiveIds;
      lessonChanged = true;
      lessonUpdates.moduleObjectiveIdsUpdated += 1;
    }
  });

  const existingLessonObjectiveIds = normalizeObjectiveIds(doc?.objectiveIds, validObjectiveIdSet);
  const nextLessonObjectiveIds = normalizeObjectiveIds(
    [...existingLessonObjectiveIds, ...packIdsForLesson, ...modules.flatMap((module) => module?.objectiveIds ?? [])],
    validObjectiveIdSet
  );
  if (JSON.stringify(existingLessonObjectiveIds) !== JSON.stringify(nextLessonObjectiveIds)) {
    doc.objectiveIds = nextLessonObjectiveIds;
    lessonChanged = true;
    lessonUpdates.lessonObjectiveIdsUpdated += 1;
  }

  if (lessonChanged) {
    writeJsonPreserveStyle(fullPath, doc);
    touchedLessonFiles.push(file);
  }
});

const report = {
  generated_at: new Date().toISOString(),
  dry_run: dryRun,
  patch_file: path.relative(cwd, patchPath),
  totals: {
    patchEntries: rawPatch.length,
    uniquePatchTargets: patchByKey.size,
    duplicates: duplicateEntries.length,
    invalidEntries: invalidEntries.length,
    missingTargets: missingTargets.length,
    questionObjectiveIdsUpdated: totalQuestionsUpdated,
    packsTouched: touchedPackFiles.length,
    lessonsTouched: touchedLessonFiles.length
  },
  lessonUpdates,
  duplicates: duplicateEntries.slice(0, 100),
  invalidEntries: invalidEntries.slice(0, 200),
  missingTargets: missingTargets.slice(0, 200),
  touchedPackFiles,
  touchedLessonFiles
};

if (!dryRun) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
}

function buildExplicitCoverageSummary() {
  const objectiveCounts = new Map(
    [...validObjectiveIdSet].map((objectiveId) => [objectiveId, 0])
  );
  let untaggedQuestions = 0;
  let totalQuestions = 0;

  packFiles.forEach((file) => {
    const pack = readJson(path.join(packsDir, file));
    const questions = Array.isArray(pack?.question_bank) ? pack.question_bank : [];
    questions.forEach((question) => {
      totalQuestions += 1;
      const objectiveIds = normalizeObjectiveIds(question?.objectiveIds, validObjectiveIdSet);
      if (objectiveIds.length === 0) {
        untaggedQuestions += 1;
        return;
      }
      objectiveIds.forEach((objectiveId) => {
        objectiveCounts.set(objectiveId, (objectiveCounts.get(objectiveId) ?? 0) + 1);
      });
    });
  });

  const missingObjectiveIds = [...objectiveCounts.entries()]
    .filter(([, count]) => count === 0)
    .map(([objectiveId]) => objectiveId)
    .sort(objectiveIdSort);

  return {
    totalQuestions,
    untaggedQuestions,
    missingObjectiveIds
  };
}

const explicitCoverage = buildExplicitCoverageSummary();
if (!dryRun) {
  const reportWithCoverage = {
    ...report,
    explicitCoverage
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(reportWithCoverage, null, 2)}\n`, 'utf8');
}

console.log(`Objective patch apply (${dryRun ? 'dry-run' : 'write'})`);
console.log(`Patch file: ${path.relative(cwd, patchPath)}`);
console.log(`Patch entries: ${rawPatch.length} (${patchByKey.size} unique targets)`);
console.log(`Duplicates: ${duplicateEntries.length}`);
console.log(`Invalid entries: ${invalidEntries.length}`);
console.log(`Missing targets: ${missingTargets.length}`);
console.log(`Question objectiveIds updated: ${totalQuestionsUpdated}`);
console.log(`Pack files touched: ${touchedPackFiles.length}`);
console.log(`Lesson files touched: ${touchedLessonFiles.length}`);
console.log(`Explicit-only summary: untagged=${explicitCoverage.untaggedQuestions}/${explicitCoverage.totalQuestions}, missingObjectives=${explicitCoverage.missingObjectiveIds.length}`);
if (explicitCoverage.missingObjectiveIds.length > 0) {
  console.log(`Missing objective IDs: ${explicitCoverage.missingObjectiveIds.join(', ')}`);
}
if (!dryRun) {
  console.log(`Report: ${path.relative(cwd, reportPath)}`);
}
