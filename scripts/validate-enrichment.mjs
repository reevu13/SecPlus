import fs from 'fs';
import path from 'path';
import Ajv from 'ajv/dist/2020.js';

const args = process.argv.slice(2);
const failHard = args.includes('--fail');
const modeArg = args.find((arg) => arg.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'prod';

const cwd = process.cwd();
const enrichDir = path.join(cwd, 'content', 'chapter_enrichment');
const schemaPath = path.join(enrichDir, 'chapter_enrichment.schema.json');

function formatAjvError(error) {
  let pathPart = error.instancePath || '';
  if (error.keyword === 'required' && error.params?.missingProperty) {
    pathPart += `/${error.params.missingProperty}`;
  }
  const pathLabel = pathPart || '/';
  return `${pathLabel}: ${error.message}`;
}

function shouldFail(invalidCount) {
  if (invalidCount === 0) return false;
  if (failHard) return true;
  if (mode === 'dev') return false;
  return process.env.CI === 'true' || process.env.CI === '1';
}

if (!fs.existsSync(schemaPath)) {
  console.error(`Schema not found: ${schemaPath}`);
  process.exit(1);
}

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

if (!fs.existsSync(enrichDir)) {
  console.warn(`Enrichment directory not found: ${enrichDir}`);
  process.exit(0);
}

const files = fs
  .readdirSync(enrichDir)
  .filter((file) => file.endsWith('.enrich.json'));

if (files.length === 0) {
  console.warn('No enrichment JSON files found.');
  process.exit(0);
}

let invalidCount = 0;

files.forEach((file) => {
  const fullPath = path.join(enrichDir, file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (err) {
    invalidCount += 1;
    console.error(`\n${file}`);
    console.error(`  - /: invalid JSON (${err.message})`);
    return;
  }

  const valid = validate(data);
  if (!valid) {
    invalidCount += 1;
    console.error(`\n${file}`);
    const errors = validate.errors ?? [];
    errors.forEach((error) => {
      console.error(`  - ${formatAjvError(error)}`);
    });
  }
});

if (invalidCount === 0) {
  console.log(`All ${files.length} enrichment file(s) valid.`);
} else {
  console.warn(`\n${invalidCount} enrichment file(s) failed validation.`);
}

if (shouldFail(invalidCount)) {
  process.exit(1);
}
