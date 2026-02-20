import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import Ajv from 'ajv/dist/2020.js';

const cwd = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
};

const objectivesDir = path.join(cwd, 'content', 'objectives');
const pdfPath = path.resolve(getArg('--pdf', path.join(objectivesDir, 'SY0-701-Exam-Objectives.pdf')));
const outPath = path.resolve(getArg('--out', path.join(objectivesDir, 'sy0-701.objectives.json')));
const schemaPath = path.resolve(getArg('--schema', path.join(objectivesDir, 'sy0-701.objectives.schema.json')));

if (!fs.existsSync(pdfPath)) {
  console.error(`Objective PDF not found: ${pdfPath}`);
  process.exit(1);
}

if (!fs.existsSync(schemaPath)) {
  console.error(`Objectives schema not found: ${schemaPath}`);
  process.exit(1);
}

const rawText = execFileSync('pdftotext', [pdfPath, '-'], {
  encoding: 'utf8',
  maxBuffer: 50 * 1024 * 1024
});

const normalizeLine = (line) => line.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

const ignoredLinePatterns = [
  /^CompTIA /i,
  /^Copyright /i,
  /^Version [\d.]+$/i,
  /^Exam Objectives$/i,
  /^Page \d+ of \d+$/i,
  /^SY0-701$/i
];

const shouldIgnoreLine = (line) => {
  if (!line) return true;
  return ignoredLinePatterns.some((pattern) => pattern.test(line));
};

const domains = new Map();
const objectives = new Map();
let lastTarget = null;

for (const rawLine of rawText.split('\n')) {
  const line = normalizeLine(rawLine);
  if (shouldIgnoreLine(line)) continue;

  const domainMatch = line.match(/^(\d+\.0)\s+(.+)$/);
  if (domainMatch) {
    const id = domainMatch[1];
    const title = domainMatch[2].trim();
    domains.set(id, { id, title });
    lastTarget = { type: 'domain', id };
    continue;
  }

  const objectiveMatch = line.match(/^(\d+\.\d+)\s+(.+)$/);
  if (objectiveMatch && !objectiveMatch[1].endsWith('.0')) {
    const id = objectiveMatch[1];
    const title = objectiveMatch[2].trim();
    const domainId = `${id.split('.')[0]}.0`;
    objectives.set(id, { id, title, domain_id: domainId });
    if (!domains.has(domainId)) {
      domains.set(domainId, { id: domainId, title: `Domain ${domainId}` });
    }
    lastTarget = { type: 'objective', id };
    continue;
  }

  // Objective titles in the CompTIA PDF often wrap to the next line.
  if (lastTarget?.type === 'objective') {
    const current = objectives.get(lastTarget.id);
    if (current) {
      current.title = `${current.title} ${line}`.replace(/\s+/g, ' ').trim();
      objectives.set(lastTarget.id, current);
    }
  }
}

const numericSort = (a, b) => {
  const [aMajor, aMinor] = a.split('.').map((part) => Number.parseInt(part, 10));
  const [bMajor, bMinor] = b.split('.').map((part) => Number.parseInt(part, 10));
  if (aMajor !== bMajor) return aMajor - bMajor;
  return aMinor - bMinor;
};

const output = {
  exam_code: 'SY0-701',
  version: '1.0.0',
  source_pdf: path.basename(pdfPath),
  generated_at: new Date().toISOString(),
  domains: [...domains.values()].sort((a, b) => numericSort(a.id, b.id)),
  objectives: [...objectives.values()].sort((a, b) => numericSort(a.id, b.id))
};

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
if (!validate(output)) {
  const errors = (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`);
  console.error('Generated objectives JSON is invalid:');
  errors.forEach((line) => console.error(`  - ${line}`));
  process.exit(1);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Parsed ${output.objectives.length} objective(s) across ${output.domains.length} domain(s).`);
console.log(`Wrote ${outPath}`);
