import fs from 'fs';
import path from 'path';
import Ajv from 'ajv/dist/2020.js';

const args = process.argv.slice(2);
const failHard = args.includes('--fail');
const modeArg = args.find((arg) => arg.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'prod';
const strictSchemaMode = ['1', 'true'].includes(String(process.env.CI ?? '').toLowerCase())
  || ['1', 'true'].includes(String(process.env.CONTENT_STRICT ?? '').toLowerCase());

const cwd = process.cwd();
const lessonsDir = path.join(cwd, 'content', 'chapter_lessons');
const schemaFiles = strictSchemaMode
  ? ['chapter_lessons.v2.schema.json']
  : ['chapter_lessons.v2.schema.json', 'chapter_lessons.schema.json'];

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
  if (strictSchemaMode) return true;
  if (mode === 'dev') return false;
  return process.env.CI === 'true' || process.env.CI === '1';
}

const schemaPaths = schemaFiles
  .map((file) => path.join(lessonsDir, file))
  .filter((fullPath) => fs.existsSync(fullPath));

if (schemaPaths.length === 0) {
  console.error(`No lesson schema found in ${lessonsDir}`);
  process.exit(1);
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validators = schemaPaths.map((schemaPath) => ajv.compile(JSON.parse(fs.readFileSync(schemaPath, 'utf8'))));

if (!fs.existsSync(lessonsDir)) {
  console.warn(`Lessons directory not found: ${lessonsDir}`);
  process.exit(0);
}

const files = fs
  .readdirSync(lessonsDir)
  .filter((file) => file.endsWith('.lesson.json'));

if (files.length === 0) {
  console.warn('No chapter lesson JSON files found.');
  process.exit(0);
}

let invalidCount = 0;

files.forEach((file) => {
  const fullPath = path.join(lessonsDir, file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (err) {
    invalidCount += 1;
    console.error(`\n${file}`);
    console.error(`  - /: invalid JSON (${err.message})`);
    return;
  }

  const valid = validators.some((validate) => validate(data));
  if (!valid) {
    invalidCount += 1;
    console.error(`\n${file}`);
    const errors = validators.flatMap((validate) => validate.errors ?? []);
    errors.forEach((error) => {
      console.error(`  - ${formatAjvError(error)}`);
    });
  }
});

if (invalidCount === 0) {
  console.log(`All ${files.length} lesson file(s) valid.`);
} else {
  console.warn(`\n${invalidCount} lesson file(s) failed validation.`);
}

if (shouldFail(invalidCount)) {
  process.exit(1);
}
