import fs from 'fs';
import path from 'path';
import { objectiveIdsForQuestion, parseUniqueObjectiveIds } from './objective_fallback.mjs';

const cwd = process.cwd();
const args = process.argv.slice(2);
const strictMode = process.env.COVERAGE_STRICT === '1';
const explicitOnly = args.includes('--explicit-only');

const objectivesPath = path.join(cwd, 'content', 'objectives', 'sy0-701.objectives.json');
const rulesPath = path.join(cwd, 'content', '_rules', 'coverage_rules.json');
const packsDir = path.join(cwd, 'content', 'chapter_packs');
const lessonsDir = path.join(cwd, 'content', 'chapter_lessons');
const reportPath = path.join(cwd, 'content', '_reports', 'coverage_gate_report.json');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    fail(`Invalid JSON file ${filePath}: ${err.message}`);
  }
}

function isScenarioQuestion(question) {
  const baseType = typeof question.type === 'string' ? question.type.trim() : '';
  const legacyType = typeof question.legacyType === 'string' ? question.legacyType.trim() : '';
  const raw = `${legacyType} ${baseType}`.toLowerCase();
  return raw.includes('scenario');
}

function isInteractiveQuestion(question) {
  const baseType = typeof question.type === 'string' ? question.type.trim() : '';
  const legacyType = typeof question.legacyType === 'string' ? question.legacyType.trim() : '';
  const interactiveTypes = new Set(['matching', 'ordering', 'pbq_mini']);
  return interactiveTypes.has(baseType) || interactiveTypes.has(legacyType);
}

function safeNumber(value, fallback, name) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (value !== undefined) {
    console.warn(`coverage_rules.json: invalid ${name}, using fallback ${fallback}`);
  }
  return fallback;
}

if (!fs.existsSync(objectivesPath)) {
  fail(`Objectives file not found: ${objectivesPath}`);
}

if (!fs.existsSync(rulesPath)) {
  fail(`Coverage rules file not found: ${rulesPath}`);
}

if (!fs.existsSync(packsDir)) {
  fail(`Packs directory not found: ${packsDir}`);
}

if (!fs.existsSync(lessonsDir)) {
  fail(`Lessons directory not found: ${lessonsDir}`);
}

const rulesJson = readJson(rulesPath);
const rules = {
  minQuestionsPerObjective: safeNumber(rulesJson.minQuestionsPerObjective, 10, 'minQuestionsPerObjective'),
  minScenarioPerObjective: safeNumber(rulesJson.minScenarioPerObjective, 3, 'minScenarioPerObjective'),
  minInteractivePerObjective: safeNumber(rulesJson.minInteractivePerObjective, 1, 'minInteractivePerObjective'),
  allowZeroCoverage: typeof rulesJson.allowZeroCoverage === 'boolean' ? rulesJson.allowZeroCoverage : false
};

const objectivesDoc = readJson(objectivesPath);
const objectives = Array.isArray(objectivesDoc.objectives) ? objectivesDoc.objectives : [];

const objectiveRows = new Map(
  objectives.map((objective) => [
    objective.id,
    {
      id: objective.id,
      title: objective.title,
      domainId: objective.domain_id,
      questionCount: 0,
      scenarioCount: 0,
      interactiveCount: 0,
      lessonReferenceCount: 0,
      violations: [],
      strictViolations: []
    }
  ])
);

const packFiles = fs
  .readdirSync(packsDir)
  .filter((file) => file.endsWith('.json') && !file.startsWith('chapter_pack.'));

const lessonFiles = fs
  .readdirSync(lessonsDir)
  .filter((file) => file.endsWith('.lesson.json'));

let totalQuestions = 0;
let taggedQuestions = 0;
let untaggedQuestions = 0;

const unknownObjectiveIdsInQuestions = new Set();
const unknownObjectiveIdsInLessons = new Set();

packFiles.forEach((file) => {
  const pack = readJson(path.join(packsDir, file));
  const questions = Array.isArray(pack.question_bank) ? pack.question_bank : [];

  questions.forEach((question) => {
    totalQuestions += 1;
    const objectiveIds = explicitOnly
      ? parseUniqueObjectiveIds(question?.objectiveIds)
      : objectiveIdsForQuestion(question, pack);
    if (objectiveIds.length === 0) {
      untaggedQuestions += 1;
      return;
    }

    taggedQuestions += 1;
    const scenario = isScenarioQuestion(question);
    const interactive = isInteractiveQuestion(question);

    objectiveIds.forEach((objectiveId) => {
      const row = objectiveRows.get(objectiveId);
      if (!row) {
        unknownObjectiveIdsInQuestions.add(objectiveId);
        return;
      }
      row.questionCount += 1;
      if (scenario) row.scenarioCount += 1;
      if (interactive) row.interactiveCount += 1;
    });
  });
});

lessonFiles.forEach((file) => {
  const lesson = readJson(path.join(lessonsDir, file));
  const lessonObjectiveIds = new Set(parseUniqueObjectiveIds(lesson.objectiveIds));
  const modules = Array.isArray(lesson.modules) ? lesson.modules : [];

  modules.forEach((module) => {
    parseUniqueObjectiveIds(module.objectiveIds).forEach((objectiveId) => lessonObjectiveIds.add(objectiveId));
    const pages = Array.isArray(module.pages) ? module.pages : [];
    pages.forEach((page) => {
      parseUniqueObjectiveIds(page.objectiveIds).forEach((objectiveId) => lessonObjectiveIds.add(objectiveId));
    });
  });

  lessonObjectiveIds.forEach((objectiveId) => {
    const row = objectiveRows.get(objectiveId);
    if (!row) {
      unknownObjectiveIdsInLessons.add(objectiveId);
      return;
    }
    row.lessonReferenceCount += 1;
  });
});

const rows = [...objectiveRows.values()];
const enforceThresholdsInStrictMode = !explicitOnly;

rows.forEach((row) => {
  if (row.questionCount < rules.minQuestionsPerObjective) {
    row.violations.push(`questions ${row.questionCount} < ${rules.minQuestionsPerObjective}`);
  }
  if (row.scenarioCount < rules.minScenarioPerObjective) {
    row.violations.push(`scenario ${row.scenarioCount} < ${rules.minScenarioPerObjective}`);
  }
  if (row.interactiveCount < rules.minInteractivePerObjective) {
    row.violations.push(`interactive ${row.interactiveCount} < ${rules.minInteractivePerObjective}`);
  }

  if (!rules.allowZeroCoverage && row.questionCount === 0) {
    row.strictViolations.push('zero coverage not allowed');
  }
  if (enforceThresholdsInStrictMode) {
    row.strictViolations.push(...row.violations);
  }
});

const rowsWithViolations = rows.filter((row) => row.violations.length > 0);
const rowsWithStrictViolations = rows.filter((row) => row.strictViolations.length > 0);
const zeroCoverageRows = rows.filter((row) => row.questionCount === 0);
const strictGlobalViolations = [];
if (untaggedQuestions > 0) {
  strictGlobalViolations.push(`untagged questions present: ${untaggedQuestions}`);
}
if (unknownObjectiveIdsInQuestions.size > 0) {
  strictGlobalViolations.push(`unknown question objectiveIds: ${[...unknownObjectiveIdsInQuestions].sort().join(', ')}`);
}
if (unknownObjectiveIdsInLessons.size > 0) {
  strictGlobalViolations.push(`unknown lesson objectiveIds: ${[...unknownObjectiveIdsInLessons].sort().join(', ')}`);
}

const topWeakest = [...rows]
  .sort((a, b) => {
    const aDeficit =
      Math.max(0, rules.minQuestionsPerObjective - a.questionCount)
      + Math.max(0, rules.minScenarioPerObjective - a.scenarioCount)
      + Math.max(0, rules.minInteractivePerObjective - a.interactiveCount);
    const bDeficit =
      Math.max(0, rules.minQuestionsPerObjective - b.questionCount)
      + Math.max(0, rules.minScenarioPerObjective - b.scenarioCount)
      + Math.max(0, rules.minInteractivePerObjective - b.interactiveCount);
    if (aDeficit !== bDeficit) return bDeficit - aDeficit;
    return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
  })
  .slice(0, 20);

const report = {
  generated_at: new Date().toISOString(),
  strict_mode: strictMode,
  objective_mode: explicitOnly ? 'explicit-only' : 'with-fallback',
  strict_threshold_enforced: enforceThresholdsInStrictMode,
  rules,
  paths: {
    objectives: path.relative(cwd, objectivesPath),
    rules: path.relative(cwd, rulesPath),
    packs: path.relative(cwd, packsDir),
    lessons: path.relative(cwd, lessonsDir)
  },
  totals: {
    objectives: rows.length,
    packs: packFiles.length,
    lessons: lessonFiles.length,
    questions: totalQuestions,
    taggedQuestions,
    untaggedQuestions,
    objectivesWithWarnings: rowsWithViolations.length,
    objectivesWithStrictViolations: rowsWithStrictViolations.length,
    zeroCoverageObjectives: zeroCoverageRows.length,
    strictGlobalViolations: strictGlobalViolations.length
  },
  unknownObjectiveReferences: {
    inQuestions: [...unknownObjectiveIdsInQuestions].sort(),
    inLessons: [...unknownObjectiveIdsInLessons].sort()
  },
  violations: {
    strictGlobalViolations,
    zeroCoverageObjectiveIds: zeroCoverageRows.map((row) => row.id),
    belowMinQuestions: rows.filter((row) => row.questionCount < rules.minQuestionsPerObjective).map((row) => row.id),
    belowMinScenario: rows.filter((row) => row.scenarioCount < rules.minScenarioPerObjective).map((row) => row.id),
    belowMinInteractive: rows.filter((row) => row.interactiveCount < rules.minInteractivePerObjective).map((row) => row.id)
  },
  topWeakest: topWeakest.map((row) => ({
    id: row.id,
    title: row.title,
    domainId: row.domainId,
    questionCount: row.questionCount,
    scenarioCount: row.scenarioCount,
    interactiveCount: row.interactiveCount,
    lessonReferenceCount: row.lessonReferenceCount,
    violations: row.violations
  })),
  objectives: rows.map((row) => ({
    id: row.id,
    title: row.title,
    domainId: row.domainId,
    questionCount: row.questionCount,
    scenarioCount: row.scenarioCount,
    interactiveCount: row.interactiveCount,
    lessonReferenceCount: row.lessonReferenceCount,
    violations: row.violations,
    strictViolations: row.strictViolations
  }))
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`Coverage gate (${strictMode ? 'strict' : 'warn-only'})`);
console.log(`Objective mode: ${explicitOnly ? 'explicit-only' : 'with-fallback'}`);
console.log(`Rules: minQ=${rules.minQuestionsPerObjective}, minScenario=${rules.minScenarioPerObjective}, minInteractive=${rules.minInteractivePerObjective}, allowZeroCoverage=${rules.allowZeroCoverage}`);
console.log(`Scanned: ${packFiles.length} packs, ${lessonFiles.length} lessons, ${totalQuestions} questions.`);
console.log(`Coverage warnings: ${rowsWithViolations.length} objective(s).`);
console.log(`Zero coverage objectives: ${zeroCoverageRows.length}.`);
console.log(`Report written: ${path.relative(cwd, reportPath)}`);

if (unknownObjectiveIdsInQuestions.size > 0 || unknownObjectiveIdsInLessons.size > 0) {
  console.warn('Unknown objective IDs found in content:');
  if (unknownObjectiveIdsInQuestions.size > 0) {
    console.warn(`  - question objectiveIds: ${[...unknownObjectiveIdsInQuestions].sort().join(', ')}`);
  }
  if (unknownObjectiveIdsInLessons.size > 0) {
    console.warn(`  - lesson objectiveIds: ${[...unknownObjectiveIdsInLessons].sort().join(', ')}`);
  }
}

if (topWeakest.length > 0) {
  console.log('\nTop 20 weakest objectives:');
  topWeakest.forEach((row) => {
    console.log(
      `  - ${row.id}: q=${row.questionCount}, scenario=${row.scenarioCount}, interactive=${row.interactiveCount}, lessonRefs=${row.lessonReferenceCount} :: ${row.title}`
    );
  });
}

if (strictMode && (rowsWithStrictViolations.length > 0 || strictGlobalViolations.length > 0)) {
  console.error(`\nStrict mode failed: ${rowsWithStrictViolations.length} objective(s) with strict violations, ${strictGlobalViolations.length} global violation(s).`);
  strictGlobalViolations.forEach((violation) => {
    console.error(`  - ${violation}`);
  });
  process.exit(1);
}

if (!strictMode && rowsWithViolations.length > 0) {
  console.warn('\nCoverage warnings detected (warn-only mode).');
}
