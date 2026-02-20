import fs from 'fs';
import path from 'path';

const cwd = process.cwd();
const objectivesPath = path.join(cwd, 'content', 'objectives', 'sy0-701.objectives.json');
const packsDir = path.join(cwd, 'content', 'chapter_packs');
const outputPath = path.join(cwd, 'content', '_reports', 'objective_backfill_suggestions.json');

const OBJECTIVE_ID_PATTERN = /^\d+\.\d+$/;
const SCHEMA_PREFIX = 'chapter_pack.';
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'into', 'is', 'it',
  'of', 'on', 'or', 'that', 'the', 'to', 'using', 'with', 'within', 'without', 'your', 'you',
  'compare', 'contrast', 'explain', 'summarize', 'apply', 'types', 'type', 'various', 'common',
  'importance', 'important', 'concept', 'concepts', 'process', 'processes', 'elements', 'include'
]);

const CHAPTER_OBJECTIVE_PRIOR = {
  1: ['2.1'],
  2: ['2.2'],
  3: ['2.3'],
  4: ['1.1', '1.2'],
  5: ['1.3', '1.4'],
  6: ['1.5', '1.6'],
  7: ['3.1'],
  8: ['3.2'],
  9: ['3.3'],
  10: ['3.4'],
  11: ['4.1', '4.2'],
  12: ['4.3', '4.4'],
  13: ['4.5', '4.6'],
  14: ['4.7', '4.8'],
  15: ['5.1', '5.2'],
  16: ['5.3', '5.4'],
  17: ['5.5', '5.6', '5.7']
};

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

function compareText(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function collectTokensByCount(value) {
  const counts = new Map();
  tokenize(value).forEach((token) => {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  });
  return counts;
}

function buildNgrams(tokens, n) {
  const ngrams = [];
  for (let index = 0; index <= tokens.length - n; index += 1) {
    ngrams.push(tokens.slice(index, index + n).join(' '));
  }
  return ngrams;
}

function extractQuestionText(question) {
  const parts = [];
  const push = (value) => {
    if (typeof value === 'string' && value.trim()) parts.push(value.trim());
  };
  push(question.stem);
  push(question.prompt);
  push(question.explanation);

  if (Array.isArray(question.tags)) {
    parts.push(question.tags.join(' '));
  }

  if (question.options && typeof question.options === 'object') {
    const optionValues = Array.isArray(question.options)
      ? question.options
      : Object.values(question.options);
    optionValues.forEach((option) => push(option));
  }

  if (question.left && typeof question.left === 'object') {
    Object.keys(question.left).forEach((key) => push(key));
    Object.values(question.left).forEach((value) => push(value));
  }
  if (question.right && typeof question.right === 'object') {
    Object.keys(question.right).forEach((key) => push(key));
    Object.values(question.right).forEach((value) => push(value));
  }
  if (question.pairs && typeof question.pairs === 'object') {
    Object.keys(question.pairs).forEach((key) => push(key));
    Object.values(question.pairs).forEach((value) => push(value));
  }

  if (Array.isArray(question.items)) {
    question.items.forEach((item) => push(item));
  }
  if (Array.isArray(question.correct_order)) {
    question.correct_order.forEach((item) => push(item));
  }
  if (Array.isArray(question.answers)) {
    question.answers.forEach((item) => push(item));
  }

  return parts.join(' ');
}

function normalizeObjectiveIdList(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => OBJECTIVE_ID_PATTERN.test(value))
  )].sort(objectiveIdSort);
}

function buildObjectiveProfiles(objectivesDoc) {
  const domainsById = new Map(
    (objectivesDoc.domains ?? []).map((domain) => [domain.id, domain.title ?? ''])
  );

  return (objectivesDoc.objectives ?? []).map((objective) => {
    const titleTokens = tokenize(objective.title ?? '');
    const domainTokens = tokenize(domainsById.get(objective.domain_id) ?? '');
    const titleBigrams = buildNgrams(titleTokens, 2);
    const titleTrigrams = buildNgrams(titleTokens, 3);
    return {
      objectiveId: objective.id,
      title: objective.title,
      domainId: objective.domain_id,
      keywordSet: new Set(titleTokens),
      domainKeywordSet: new Set(domainTokens),
      phraseSet: new Set([...titleBigrams, ...titleTrigrams].filter((phrase) => phrase.split(' ').length >= 2))
    };
  });
}

function scoreCandidate(input) {
  const {
    profile,
    questionTokenCounts,
    normalizedQuestionText,
    questionTags,
    chapterPriorSet
  } = input;

  let score = 0;
  const matchedKeywords = [];
  const matchedDomainTokens = [];
  const matchedPhrases = [];
  let hasDirectTagObjective = false;
  let chapterPrior = false;

  profile.keywordSet.forEach((keyword) => {
    const count = questionTokenCounts.get(keyword) ?? 0;
    if (count > 0) {
      matchedKeywords.push(keyword);
      score += 4 * Math.min(2, count);
    }
  });

  profile.domainKeywordSet.forEach((keyword) => {
    if ((questionTokenCounts.get(keyword) ?? 0) > 0) {
      matchedDomainTokens.push(keyword);
      score += 1.5;
    }
  });

  profile.phraseSet.forEach((phrase) => {
    if (phrase && normalizedQuestionText.includes(phrase)) {
      matchedPhrases.push(phrase);
      score += 5;
    }
  });

  if (questionTags.has(profile.objectiveId)) {
    hasDirectTagObjective = true;
    score += 30;
  }

  if (chapterPriorSet.has(profile.objectiveId)) {
    chapterPrior = true;
    score += 1.2;
  }

  const reasons = [];
  if (hasDirectTagObjective) reasons.push(`tag contains objective ID ${profile.objectiveId}`);
  if (matchedKeywords.length > 0) reasons.push(`keyword overlap: ${matchedKeywords.slice(0, 6).join(', ')}`);
  if (matchedPhrases.length > 0) reasons.push(`phrase overlap: ${matchedPhrases.slice(0, 3).join(' | ')}`);
  if (matchedDomainTokens.length > 0) reasons.push(`domain-token overlap: ${matchedDomainTokens.slice(0, 4).join(', ')}`);
  if (chapterPrior) reasons.push('chapter prior match');
  if (reasons.length === 0) reasons.push('no lexical overlap; deterministic fallback');

  return {
    objectiveId: profile.objectiveId,
    objectiveTitle: profile.title,
    domainId: profile.domainId,
    score: Number(score.toFixed(3)),
    reasons
  };
}

function confidence(score, topScore) {
  if (topScore <= 0 || score <= 0) return 0;
  const relative = score / topScore;
  const magnitude = score / (score + 10);
  return Number(Math.max(0.05, Math.min(0.99, (relative * 0.6) + (magnitude * 0.4))).toFixed(3));
}

if (!fs.existsSync(objectivesPath)) fail(`Objectives file not found: ${path.relative(cwd, objectivesPath)}`);
if (!fs.existsSync(packsDir)) fail(`Packs directory not found: ${path.relative(cwd, packsDir)}`);

const objectivesDoc = readJson(objectivesPath);
const objectiveProfiles = buildObjectiveProfiles(objectivesDoc);

const packFiles = fs
  .readdirSync(packsDir)
  .filter((file) => file.endsWith('.json') && !file.startsWith(SCHEMA_PREFIX))
  .sort(compareText);

const suggestions = [];
const suggestionsByChapter = new Map();
const topObjectiveCounts = new Map();

let missingQuestions = 0;

packFiles.forEach((file) => {
  const packPath = path.join(packsDir, file);
  const pack = readJson(packPath);
  const chapterNumber = Number.isFinite(pack?.chapter?.number)
    ? Number(pack.chapter.number)
    : Number.parseInt(file.replace(/\D/g, ''), 10);
  const chapterKey = Number.isFinite(chapterNumber) ? `ch${chapterNumber}` : pack.pack_id;
  const chapterPriorSet = new Set(normalizeObjectiveIdList(CHAPTER_OBJECTIVE_PRIOR[chapterNumber] ?? []));

  const chapterStats = suggestionsByChapter.get(chapterKey) ?? {
    chapter: chapterKey,
    chapterNumber: Number.isFinite(chapterNumber) ? chapterNumber : null,
    packId: pack.pack_id,
    missingQuestionCount: 0,
    avgTopConfidence: 0
  };

  const questions = Array.isArray(pack.question_bank) ? pack.question_bank : [];
  questions.forEach((question) => {
    const explicitObjectiveIds = normalizeObjectiveIdList(question.objectiveIds);
    if (explicitObjectiveIds.length > 0) return;

    missingQuestions += 1;
    chapterStats.missingQuestionCount += 1;

    const questionText = extractQuestionText(question);
    const normalizedQuestionText = normalizeText(questionText);
    const questionTokenCounts = collectTokensByCount(questionText);
    const questionTags = new Set(
      (Array.isArray(question.tags) ? question.tags : [])
        .filter((tag) => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean)
    );

    const scored = objectiveProfiles
      .map((profile) => scoreCandidate({
        profile,
        questionTokenCounts,
        normalizedQuestionText,
        questionTags,
        chapterPriorSet
      }))
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return objectiveIdSort(a.objectiveId, b.objectiveId);
      });

    const topScore = scored[0]?.score ?? 0;
    const candidates = scored.slice(0, 3).map((candidate, index) => ({
      rank: index + 1,
      objectiveId: candidate.objectiveId,
      objectiveTitle: candidate.objectiveTitle,
      domainId: candidate.domainId,
      score: candidate.score,
      confidence: confidence(candidate.score, topScore),
      reasons: candidate.reasons
    }));

    const topCandidate = candidates[0];
    if (topCandidate) {
      topObjectiveCounts.set(topCandidate.objectiveId, (topObjectiveCounts.get(topCandidate.objectiveId) ?? 0) + 1);
      chapterStats.avgTopConfidence += topCandidate.confidence;
    }

    suggestions.push({
      packId: pack.pack_id,
      chapterNumber: Number.isFinite(chapterNumber) ? chapterNumber : null,
      chapterTitle: pack.chapter?.title ?? '',
      questionId: question.id,
      questionType: question.type ?? 'mcq',
      questionStem: typeof question.stem === 'string' ? question.stem : '',
      candidates
    });
  });

  if (chapterStats.missingQuestionCount > 0) {
    chapterStats.avgTopConfidence = Number((chapterStats.avgTopConfidence / chapterStats.missingQuestionCount).toFixed(3));
    suggestionsByChapter.set(chapterKey, chapterStats);
  }
});

const topSuggestedObjectives = [...topObjectiveCounts.entries()]
  .sort((a, b) => {
    if (a[1] !== b[1]) return b[1] - a[1];
    return objectiveIdSort(a[0], b[0]);
  })
  .slice(0, 20)
  .map(([objectiveId, count]) => {
    const objective = objectiveProfiles.find((profile) => profile.objectiveId === objectiveId);
    return {
      objectiveId,
      count,
      title: objective?.title ?? '',
      domainId: objective?.domainId ?? ''
    };
  });

const chapterDistribution = [...suggestionsByChapter.values()]
  .sort((a, b) => {
    if ((a.chapterNumber ?? Number.MAX_SAFE_INTEGER) !== (b.chapterNumber ?? Number.MAX_SAFE_INTEGER)) {
      return (a.chapterNumber ?? Number.MAX_SAFE_INTEGER) - (b.chapterNumber ?? Number.MAX_SAFE_INTEGER);
    }
    return compareText(a.chapter, b.chapter);
  });

const report = {
  generated_at: new Date().toISOString(),
  deterministic: true,
  mode: 'keyword-overlap-no-llm',
  sources: {
    objectives: path.relative(cwd, objectivesPath),
    packsDir: path.relative(cwd, packsDir)
  },
  totals: {
    packs: packFiles.length,
    objectives: objectiveProfiles.length,
    missingQuestions
  },
  topSuggestedObjectives,
  chapterDistribution,
  suggestions
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log('Objective backfill suggestion report generated.');
console.log(`Mode: ${report.mode}`);
console.log(`Missing questions: ${missingQuestions}`);
console.log(`Output: ${path.relative(cwd, outputPath)}`);

if (topSuggestedObjectives.length > 0) {
  console.log('\nTop suggested objectives:');
  topSuggestedObjectives.slice(0, 10).forEach((row) => {
    console.log(`  - ${row.objectiveId}: ${row.count} (${row.title})`);
  });
}

if (chapterDistribution.length > 0) {
  console.log('\nMissing-question distribution by chapter:');
  chapterDistribution.forEach((row) => {
    console.log(`  - ${row.chapter}: missing=${row.missingQuestionCount}, avg_top_confidence=${row.avgTopConfidence}`);
  });
}
