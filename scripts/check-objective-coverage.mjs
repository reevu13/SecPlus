import fs from 'fs';
import path from 'path';
import { objectiveIdsForQuestion, parseUniqueObjectiveIds } from './objective_fallback.mjs';

const args = process.argv.slice(2);
const failOnMissing = args.includes('--fail-on-missing') || process.env.OBJECTIVE_COVERAGE_FAIL === '1';
const explicitOnly = args.includes('--explicit-only');

const cwd = process.cwd();
const packsDir = path.join(cwd, 'content', 'chapter_packs');
const objectivesPath = path.join(cwd, 'content', 'objectives', 'sy0-701.objectives.json');

if (!fs.existsSync(objectivesPath)) {
  console.error(`Objectives file not found: ${objectivesPath}`);
  process.exit(1);
}

if (!fs.existsSync(packsDir)) {
  console.error(`Packs directory not found: ${packsDir}`);
  process.exit(1);
}

const objectivesDoc = JSON.parse(fs.readFileSync(objectivesPath, 'utf8'));
const objectiveRows = new Map(
  objectivesDoc.objectives.map((objective) => [
    objective.id,
    {
      id: objective.id,
      title: objective.title,
      questions: 0,
      scenario: 0,
      matching: 0,
      ordering: 0,
      pbq: 0
    }
  ])
);

const files = fs
  .readdirSync(packsDir)
  .filter((file) => file.endsWith('.json') && !file.startsWith('chapter_pack.'));

let untaggedQuestions = 0;

files.forEach((file) => {
  const pack = JSON.parse(fs.readFileSync(path.join(packsDir, file), 'utf8'));
  const questions = Array.isArray(pack.question_bank) ? pack.question_bank : [];
  questions.forEach((question) => {
    const objectiveIds = explicitOnly
      ? parseUniqueObjectiveIds(question?.objectiveIds)
      : objectiveIdsForQuestion(question, pack);

    if (objectiveIds.length === 0) {
      untaggedQuestions += 1;
      return;
    }

    objectiveIds.forEach((objectiveId) => {
      const row = objectiveRows.get(objectiveId);
      if (!row) return;
      row.questions += 1;
      if (question.type === 'scenario_mcq') row.scenario += 1;
      if (question.type === 'matching') {
        row.matching += 1;
        row.pbq += 1;
      }
      if (question.type === 'ordering') {
        row.ordering += 1;
        row.pbq += 1;
      }
    });
  });
});

const rows = [...objectiveRows.values()].sort((a, b) => {
  const [aMajor, aMinor] = a.id.split('.').map((part) => Number.parseInt(part, 10));
  const [bMajor, bMinor] = b.id.split('.').map((part) => Number.parseInt(part, 10));
  if (aMajor !== bMajor) return aMajor - bMajor;
  return aMinor - bMinor;
});

const missing = rows.filter((row) => row.questions === 0);
const weakest = [...rows].sort((a, b) => {
  if (a.questions !== b.questions) return a.questions - b.questions;
  if (a.pbq !== b.pbq) return a.pbq - b.pbq;
  if (a.scenario !== b.scenario) return a.scenario - b.scenario;
  return (a.matching + a.ordering) - (b.matching + b.ordering);
}).slice(0, 20);

console.log(`Coverage mode: ${explicitOnly ? 'explicit-only' : 'with-fallback'}`);
console.log(`Objective coverage check: ${rows.length} objectives.`);
console.log(`Untagged questions: ${untaggedQuestions}`);
console.log(`Missing objectives: ${missing.length}`);

console.log('\nTop 20 weakest objectives:');
weakest.forEach((row) => {
  console.log(`  - ${row.id}: q=${row.questions}, scenario=${row.scenario}, matching=${row.matching}, ordering=${row.ordering}, pbq=${row.pbq} :: ${row.title}`);
});

if (missing.length > 0) {
  console.warn('\nObjectives with zero coverage:');
  missing.forEach((row) => {
    console.warn(`  - ${row.id}: q=${row.questions}, scenario=${row.scenario}, matching=${row.matching}, ordering=${row.ordering}, pbq=${row.pbq} :: ${row.title}`);
  });
}

if (missing.length > 0 && failOnMissing) {
  process.exit(1);
}
