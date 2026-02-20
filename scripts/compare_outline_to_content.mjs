import fs from 'fs';
import path from 'path';

const cwd = process.cwd();
const outlinePath = path.join(cwd, 'content', '_source_outline', 'book_outline.json');
const packsDir = path.join(cwd, 'content', 'chapter_packs');
const lessonsDir = path.join(cwd, 'content', 'chapter_lessons');
const outputPath = path.join(cwd, 'content', '_reports', 'content_gap_report.json');

const stopWords = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'into',
  'your',
  'over',
  'under',
  'about',
  'using',
  'what',
  'when',
  'where',
  'why',
  'how',
  'are',
  'is',
  'was',
  'were',
  'can',
  'not',
  'you',
  'its',
  'their',
  'them',
  'will',
  'should',
  'could'
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

function tokenSet(value) {
  return new Set(tokenize(value));
}

function countOverlap(needleTokens, haystackSet) {
  if (!needleTokens.length || !haystackSet.size) return 0;
  let overlap = 0;
  needleTokens.forEach((token) => {
    if (haystackSet.has(token)) overlap += 1;
  });
  return overlap;
}

function parseChapterNumber(text) {
  const source = String(text ?? '');
  const chapterMatch = source.match(/\bchapter\s*0*(\d{1,3})\b/i);
  if (chapterMatch) return Number.parseInt(chapterMatch[1], 10);
  const shortMatch = source.match(/\bch(?:apter)?[_\-\s]*0*(\d{1,3})\b/i);
  if (shortMatch) return Number.parseInt(shortMatch[1], 10);
  return null;
}

function getPackFiles() {
  const schemaFiles = new Set(['chapter_pack.schema.json', 'chapter_pack.v2.schema.json']);
  return fs
    .readdirSync(packsDir)
    .filter((file) => file.endsWith('.json') && !schemaFiles.has(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function getLessonFiles() {
  const schemaFiles = new Set(['chapter_lessons.schema.json', 'chapter_lessons.v2.schema.json']);
  return fs
    .readdirSync(lessonsDir)
    .filter((file) => file.endsWith('.json') && !schemaFiles.has(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function buildChapterMapping(outlineChapter, outlineIndex, packsSorted) {
  const inferredNumber =
    outlineChapter.chapter_number
    ?? parseChapterNumber(outlineChapter.title)
    ?? parseChapterNumber(outlineChapter.href);

  let mappedPack = null;
  if (Number.isInteger(inferredNumber)) {
    mappedPack = packsSorted.find((pack) => pack.chapter?.number === inferredNumber) ?? null;
  }

  if (!mappedPack) {
    mappedPack = packsSorted[outlineIndex] ?? null;
  }

  return {
    inferredNumber: Number.isInteger(inferredNumber) ? inferredNumber : null,
    pack: mappedPack
  };
}

function buildPackQuestionIndex(pack) {
  if (!pack?.question_bank) return [];
  return pack.question_bank.map((question) => ({
    id: question.id,
    tokens: tokenSet([question.stem, question.explanation, ...(question.tags ?? []), ...(question.objectiveIds ?? [])].join(' ')),
    type: question.type
  }));
}

function buildLessonIndex(lesson) {
  if (!lesson?.modules) {
    return { moduleEntries: [], pageEntries: [] };
  }

  const moduleEntries = [];
  const pageEntries = [];
  lesson.modules.forEach((module, moduleIndex) => {
    const moduleText = [module.title, ...(module.tag_ids ?? []), ...(module.objectiveIds ?? [])].join(' ');
    moduleEntries.push({
      id: module.id ?? `module-${moduleIndex + 1}`,
      title: module.title ?? `Module ${moduleIndex + 1}`,
      tokens: tokenSet(moduleText)
    });

    (module.pages ?? []).forEach((page, pageIndex) => {
      const blockText = (page.content_blocks ?? []).map((block) => block.text ?? '').join(' ');
      const checksText = (page.checks ?? []).map((check) => check.prompt ?? '').join(' ');
      const pageText = [page.title, blockText, checksText, ...(page.objectiveIds ?? [])].join(' ');
      pageEntries.push({
        id: page.id ?? `page-${moduleIndex + 1}-${pageIndex + 1}`,
        title: page.title ?? `Page ${pageIndex + 1}`,
        moduleTitle: module.title ?? `Module ${moduleIndex + 1}`,
        tokens: tokenSet(pageText)
      });
    });
  });

  return { moduleEntries, pageEntries };
}

function evaluateSectionCoverage(section, lessonIndex, questionIndex) {
  const sectionTokens = tokenize(section.title);
  const minTokenOverlap = sectionTokens.length > 4 ? 2 : 1;

  const moduleHits = lessonIndex.moduleEntries.filter((entry) => countOverlap(sectionTokens, entry.tokens) >= minTokenOverlap);
  const pageHits = lessonIndex.pageEntries.filter((entry) => countOverlap(sectionTokens, entry.tokens) >= minTokenOverlap);
  const questionHits = questionIndex.filter((entry) => countOverlap(sectionTokens, entry.tokens) >= minTokenOverlap);

  const signals = moduleHits.length + pageHits.length + questionHits.length;

  let status = 'covered';
  const reasons = [];

  if (signals === 0) {
    status = 'missing';
    reasons.push('No matching modules, pages, or questions.');
  } else {
    if (pageHits.length === 0) reasons.push('No lesson page clearly maps to this section.');
    if (questionHits.length === 0) reasons.push('No question coverage found for this section.');
    if (signals < 2 || reasons.length > 0) status = 'weak';
  }

  return {
    status,
    signals,
    reasons,
    evidence: {
      module_hits: moduleHits.length,
      page_hits: pageHits.length,
      question_hits: questionHits.length
    }
  };
}

function buildReport() {
  if (!fs.existsSync(outlinePath)) {
    throw new Error(`Outline not found: ${outlinePath}. Run \"npm run content:outline\" first.`);
  }
  if (!fs.existsSync(packsDir)) throw new Error(`Packs directory missing: ${packsDir}`);
  if (!fs.existsSync(lessonsDir)) throw new Error(`Lessons directory missing: ${lessonsDir}`);

  const outline = readJson(outlinePath);
  const packFiles = getPackFiles();
  const lessonFiles = getLessonFiles();

  const packs = packFiles.map((file) => readJson(path.join(packsDir, file)));
  const lessons = lessonFiles.map((file) => readJson(path.join(lessonsDir, file)));

  const packsSorted = [...packs].sort((a, b) => {
    const left = Number.isFinite(a.chapter?.number) ? a.chapter.number : Number.MAX_SAFE_INTEGER;
    const right = Number.isFinite(b.chapter?.number) ? b.chapter.number : Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return String(a.pack_id).localeCompare(String(b.pack_id), undefined, { numeric: true, sensitivity: 'base' });
  });

  const lessonByPackId = new Map(lessons.map((lesson) => [lesson.pack_id, lesson]));
  const chapters = Array.isArray(outline.chapters) ? outline.chapters : [];

  const chapterRows = [];
  const gapRows = [];

  chapters.forEach((outlineChapter, chapterIndex) => {
    const chapterOrder = chapterIndex + 1;
    const { inferredNumber, pack } = buildChapterMapping(outlineChapter, chapterIndex, packsSorted);
    const lesson = pack ? lessonByPackId.get(pack.pack_id) : null;

    const questionIndex = buildPackQuestionIndex(pack);
    const lessonIndex = buildLessonIndex(lesson);

    const sections = Array.isArray(outlineChapter.sections) ? outlineChapter.sections : [];
    const sectionRows = sections.map((section) => {
      const evalRow = evaluateSectionCoverage(section, lessonIndex, questionIndex);
      const sectionRow = {
        order: section.order,
        title: section.title,
        href: section.href,
        word_count: section.word_count,
        status: evalRow.status,
        evidence: evalRow.evidence,
        reasons: evalRow.reasons
      };
      if (evalRow.status !== 'covered') {
        gapRows.push({
          chapter_order: chapterOrder,
          chapter_title: outlineChapter.title,
          section_order: section.order,
          section_title: section.title,
          section_href: section.href,
          status: evalRow.status,
          word_count: section.word_count,
          reasons: evalRow.reasons
        });
      }
      return sectionRow;
    });

    const missingSections = sectionRows.filter((section) => section.status === 'missing');
    const weakSections = sectionRows.filter((section) => section.status === 'weak');

    const moduleCount = lesson?.modules?.length ?? 0;
    const pageCount = lesson?.modules?.reduce((sum, module) => sum + (module.pages?.length ?? 0), 0) ?? 0;
    const questionCount = pack?.question_bank?.length ?? 0;
    const scenarioCount = pack?.question_bank?.filter((question) => question.type === 'scenario_mcq').length ?? 0;
    const matchingCount = pack?.question_bank?.filter((question) => question.type === 'matching').length ?? 0;
    const orderingCount = pack?.question_bank?.filter((question) => question.type === 'ordering').length ?? 0;

    let chapterStatus = 'covered';
    const chapterReasons = [];
    if (!pack && !lesson) {
      chapterStatus = 'missing';
      chapterReasons.push('No pack and no lesson mapped to this chapter.');
    } else {
      if (!pack) chapterReasons.push('No chapter pack mapped.');
      if (!lesson) chapterReasons.push('No chapter lesson mapped.');
      if (missingSections.length > 0) chapterReasons.push(`${missingSections.length} section(s) with no coverage.`);
      if (weakSections.length > Math.max(1, Math.floor(sectionRows.length * 0.3))) {
        chapterReasons.push('High ratio of weak section coverage.');
      }
      if (questionCount < 8) chapterReasons.push('Question count is thin for chapter scope.');
      if (pageCount < 6) chapterReasons.push('Lesson page count is thin for chapter scope.');
      if (chapterReasons.length > 0) chapterStatus = 'weak';
    }

    chapterRows.push({
      outline_order: chapterOrder,
      outline_chapter_number: outlineChapter.chapter_number ?? null,
      inferred_chapter_number: inferredNumber,
      outline_title: outlineChapter.title,
      outline_href: outlineChapter.href,
      outline_word_count: outlineChapter.word_count,
      status: chapterStatus,
      reasons: chapterReasons,
      mapped_pack_id: pack?.pack_id ?? null,
      mapped_pack_title: pack?.chapter?.title ?? null,
      mapped_lesson_pack_id: lesson?.pack_id ?? null,
      coverage: {
        questions: questionCount,
        scenario_questions: scenarioCount,
        matching_questions: matchingCount,
        ordering_questions: orderingCount,
        modules: moduleCount,
        pages: pageCount,
        sections_total: sectionRows.length,
        sections_missing: missingSections.length,
        sections_weak: weakSections.length
      },
      sections: sectionRows
    });
  });

  const missingChapters = chapterRows.filter((chapter) => chapter.status === 'missing');
  const weakChapters = chapterRows.filter((chapter) => chapter.status === 'weak');
  const missingSections = gapRows.filter((section) => section.status === 'missing');
  const weakSections = gapRows.filter((section) => section.status === 'weak');

  gapRows.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'missing' ? -1 : 1;
    if (a.word_count !== b.word_count) return b.word_count - a.word_count;
    if (a.chapter_order !== b.chapter_order) return a.chapter_order - b.chapter_order;
    return a.section_order - b.section_order;
  });

  return {
    generated_at: new Date().toISOString(),
    source_outline: path.relative(cwd, outlinePath),
    summary: {
      chapters_total: chapterRows.length,
      chapters_missing: missingChapters.length,
      chapters_weak: weakChapters.length,
      sections_total: chapterRows.reduce((sum, chapter) => sum + chapter.coverage.sections_total, 0),
      sections_missing: missingSections.length,
      sections_weak: weakSections.length
    },
    chapters: chapterRows,
    top_gaps: gapRows.slice(0, 50)
  };
}

function printSummary(report) {
  console.log(`Gap report generated: ${path.relative(cwd, outputPath)}`);
  console.log(`Chapters total: ${report.summary.chapters_total}`);
  console.log(`Chapters missing: ${report.summary.chapters_missing}`);
  console.log(`Chapters weak: ${report.summary.chapters_weak}`);
  console.log(`Sections total: ${report.summary.sections_total}`);
  console.log(`Sections missing: ${report.summary.sections_missing}`);
  console.log(`Sections weak: ${report.summary.sections_weak}`);

  if (report.top_gaps.length === 0) {
    console.log('No missing/weak gaps detected.');
    return;
  }

  console.log('\nTop section gaps:');
  report.top_gaps.slice(0, 10).forEach((gap) => {
    console.log(
      `  - [${gap.status}] Chapter ${gap.chapter_order} · Section ${gap.section_order} ` +
      `"${gap.section_title}" (words: ${gap.word_count})`
    );
  });
}

try {
  const report = buildReport();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  printSummary(report);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
