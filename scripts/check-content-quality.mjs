import fs from 'fs';
import path from 'path';

const MIN_RATIONALE_CHARS = Number.parseInt(process.env.CONTENT_QUALITY_MIN_RATIONALE ?? '40', 10);
const cwd = process.cwd();
const packsDir = path.join(cwd, 'content', 'chapter_packs');

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`invalid JSON (${err.message})`);
  }
}

function addError(store, file, questionId, jsonPath, message) {
  if (!store.has(file)) {
    store.set(file, []);
  }
  store.get(file).push({ questionId, jsonPath, message });
}

if (!Number.isFinite(MIN_RATIONALE_CHARS) || MIN_RATIONALE_CHARS < 1) {
  console.error(`Invalid CONTENT_QUALITY_MIN_RATIONALE value: ${process.env.CONTENT_QUALITY_MIN_RATIONALE}`);
  process.exit(1);
}

if (!fs.existsSync(packsDir)) {
  console.error(`Packs directory not found: ${packsDir}`);
  process.exit(1);
}

const files = fs
  .readdirSync(packsDir)
  .filter((file) => file.endsWith('.json') && !file.startsWith('chapter_pack.'));

let checkedQuestions = 0;
const errors = new Map();

files.forEach((file) => {
  const fullPath = path.join(packsDir, file);
  let pack;
  try {
    pack = readJson(fullPath);
  } catch (err) {
    addError(errors, file, '(pack)', '/', err.message);
    return;
  }

  const questionBank = Array.isArray(pack.question_bank) ? pack.question_bank : [];
  questionBank.forEach((question, index) => {
    checkedQuestions += 1;
    const questionId = typeof question?.id === 'string' && question.id.trim().length > 0
      ? question.id.trim()
      : `(index:${index})`;
    const basePath = `/question_bank/${index}`;

    if (typeof question?.rationaleCorrect !== 'string') {
      addError(errors, file, questionId, `${basePath}/rationaleCorrect`, 'must be string');
    } else if (question.rationaleCorrect.trim().length < MIN_RATIONALE_CHARS) {
      addError(
        errors,
        file,
        questionId,
        `${basePath}/rationaleCorrect`,
        `must be at least ${MIN_RATIONALE_CHARS} characters (trimmed)`
      );
    }

    if (!Array.isArray(question?.misconceptionTags)) {
      addError(errors, file, questionId, `${basePath}/misconceptionTags`, 'must be an array');
    } else {
      if (question.misconceptionTags.length < 1) {
        addError(errors, file, questionId, `${basePath}/misconceptionTags`, 'must include at least 1 tag');
      }
      question.misconceptionTags.forEach((tag, tagIndex) => {
        if (typeof tag !== 'string' || tag.trim().length === 0) {
          addError(
            errors,
            file,
            questionId,
            `${basePath}/misconceptionTags/${tagIndex}`,
            'must be a non-empty string'
          );
        }
      });
    }

    const options = question?.options;
    const optionIds = isPlainObject(options) ? Object.keys(options) : [];
    if (optionIds.length > 0) {
      const incorrect = question?.rationaleIncorrect;
      if (!isPlainObject(incorrect)) {
        addError(errors, file, questionId, `${basePath}/rationaleIncorrect`, 'must be an object keyed by optionId');
      } else {
        optionIds.forEach((optionId) => {
          if (typeof incorrect[optionId] !== 'string' || incorrect[optionId].trim().length === 0) {
            addError(
              errors,
              file,
              questionId,
              `${basePath}/rationaleIncorrect/${optionId}`,
              'must exist and be a non-empty string for every optionId'
            );
          }
        });
      }
    }
  });
});

const errorCount = [...errors.values()].reduce((count, group) => count + group.length, 0);

if (errorCount === 0) {
  console.log(`Content quality check passed: ${files.length} pack(s), ${checkedQuestions} question(s).`);
  process.exit(0);
}

errors.forEach((fileErrors, file) => {
  console.error(`\n${file}`);
  fileErrors.forEach((entry) => {
    console.error(`  - ${entry.questionId} ${entry.jsonPath}: ${entry.message}`);
  });
});

console.error(`\nContent quality check failed: ${errorCount} issue(s) across ${errors.size} file(s).`);
process.exit(1);
