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
const packsDir = path.join(cwd, 'content', 'chapter_packs');
const allSchemaFiles = ['chapter_pack.v2.schema.json', 'chapter_pack.schema.json'];
const schemaFiles = strictSchemaMode
  ? ['chapter_pack.v2.schema.json']
  : allSchemaFiles;

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

function normalizeForLint(value) {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getHintAnswerSignals(question) {
  if (!question || typeof question !== 'object') return [];
  const signals = [];

  const hasOptions = question.options && typeof question.options === 'object';
  const isMcqLike = typeof question.answer === 'string' && hasOptions;
  const isMultiSelectLike = Array.isArray(question.answers) && hasOptions;

  if (question.type === 'mcq' || isMcqLike) {
    const answerText = question.options[question.answer];
    if (typeof answerText === 'string') signals.push(answerText);
  } else if (question.type === 'multi_select' || isMultiSelectLike) {
    question.answers.forEach((answerId) => {
      const answerText = question.options[answerId];
      if (typeof answerText === 'string') signals.push(answerText);
    });
  } else if (question.type === 'matching' && question.pairs && typeof question.pairs === 'object') {
    Object.entries(question.pairs).forEach(([left, right]) => {
      if (typeof right === 'string') {
        signals.push(right);
        signals.push(`${left} ${right}`);
      }
    });
  } else if (question.type === 'ordering' && Array.isArray(question.correct_order)) {
    signals.push(question.correct_order.join(' '));
  }

  return signals
    .map((signal) => normalizeForLint(signal))
    .filter((signal) => signal.length >= 8);
}

function lintQuestionHints(question, index) {
  if (!question || typeof question !== 'object') return [];
  if (!Array.isArray(question.hints) || question.hints.length === 0) return [];

  const errors = [];
  const answerSignals = getHintAnswerSignals(question);
  const type = typeof question.type === 'string' ? question.type : '';
  const hasOptions = question.options && typeof question.options === 'object';
  const isMcqLike = type === 'mcq' || (typeof question.answer === 'string' && hasOptions);

  question.hints.forEach((hint, hintIndex) => {
    if (typeof hint !== 'string') return;
    const normalizedHint = normalizeForLint(hint);
    if (!normalizedHint) return;

    if (answerSignals.some((signal) => normalizedHint.includes(signal))) {
      errors.push(`/question_bank/${index}/hints/${hintIndex}: must not reveal the correct answer directly`);
      return;
    }

    if (isMcqLike && typeof question.answer === 'string') {
      const explicitAnswerPattern = new RegExp(`\\b(answer|correct)\\b[^\\n]{0,24}\\b${escapeRegex(question.answer)}\\b`, 'i');
      const optionAnswerPattern = new RegExp(`\\boption\\s+${escapeRegex(question.answer)}\\b`, 'i');
      if (explicitAnswerPattern.test(hint) || optionAnswerPattern.test(hint)) {
        errors.push(`/question_bank/${index}/hints/${hintIndex}: must not state the exact answer option`);
      }
    }
  });

  return errors;
}

const schemaPaths = schemaFiles
  .map((file) => path.join(packsDir, file))
  .filter((fullPath) => fs.existsSync(fullPath));

if (schemaPaths.length === 0) {
  console.error(`No pack schema found in ${packsDir}`);
  process.exit(1);
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validators = schemaPaths.map((schemaPath) => ajv.compile(JSON.parse(fs.readFileSync(schemaPath, 'utf8'))));

if (!fs.existsSync(packsDir)) {
  console.warn(`Packs directory not found: ${packsDir}`);
  process.exit(0);
}

const files = fs
  .readdirSync(packsDir)
  .filter((file) => file.endsWith('.json') && !allSchemaFiles.includes(file));

if (files.length === 0) {
  console.warn('No chapter pack JSON files found.');
  process.exit(0);
}

let invalidCount = 0;

files.forEach((file) => {
  const fullPath = path.join(packsDir, file);
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
    return;
  }

  const questionBank = Array.isArray(data?.question_bank) ? data.question_bank : [];
  const hintLintErrors = questionBank.flatMap((question, index) => lintQuestionHints(question, index));
  if (hintLintErrors.length > 0) {
    invalidCount += 1;
    console.error(`\n${file}`);
    hintLintErrors.forEach((err) => {
      console.error(`  - ${err}`);
    });
  }
});

if (invalidCount === 0) {
  console.log(`All ${files.length} pack(s) valid.`);
} else {
  console.warn(`\n${invalidCount} pack(s) failed validation.`);
}

if (shouldFail(invalidCount)) {
  process.exit(1);
}
