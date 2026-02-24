#!/usr/bin/env node
/**
 * transform.mjs — Phase 2: Raw Chunks → LessonCard JSON
 *
 * Reads raw_chunks.json (output of extract.mjs) and transforms each section
 * into LessonCard objects, outputting one .lesson.json per chapter.
 *
 * Keyword table drives automatic interaction_type assignment:
 *   - terminal_sim   : command-oriented content (chmod, nmap, iptables, …)
 *   - log_analyzer   : log/audit/event content
 *   - tap_to_highlight: vulnerability / attack technique content
 *   - drag_and_drop  : categorisation content (CIA, AAA, protocols…)
 *   - mcq            : default for all others
 *
 * Usage:
 *   node scripts/content-pipeline/transform.mjs
 *   node scripts/content-pipeline/transform.mjs \
 *       --chunks scripts/content-pipeline/raw_chunks.json \
 *       --out    content/chapter_lessons
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = path.resolve(__dirname, '..', '..');

// ── CLI args ──────────────────────────────────────────────────────────────────

function getArg(flag, def) {
  const args = process.argv.slice(2);
  const idx  = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}

const CHUNKS_PATH = path.resolve(REPO_ROOT, getArg('--chunks', 'scripts/content-pipeline/raw_chunks.json'));
const OUT_DIR     = path.resolve(REPO_ROOT, getArg('--out',    'content/chapter_lessons'));

// ── Keyword → interaction_type mapping ───────────────────────────────────────

/** Each entry: { pattern: RegExp, type: InteractionType, weight: number } */
const KEYWORD_RULES = [
  // terminal_sim: command-execution content
  {
    pattern: /\b(chmod|chown|nmap|ssh|ping|iptables|ufw|netstat|tcpdump|wireshark|nessus|openssl|curl|wget|nc|netcat|grep|awk|sed|ps\s+aux|sudo|systemctl|journalctl|dmesg)\b/i,
    type: 'terminal_sim',
    weight: 10,
  },
  // log_analyzer: log, event, audit content
  {
    pattern: /\b(syslog|event log|audit log|SIEM|splunk|logfile|log entry|log analysis|IDS alert|firewall log|failed login|authentication failure|access log)\b/i,
    type: 'log_analyzer',
    weight: 9,
  },
  // tap_to_highlight: attack / vulnerability content
  {
    pattern: /\b(SQL injection|XSS|cross-site scripting|CSRF|buffer overflow|race condition|privilege escalation|man-in-the-middle|MITM|ARP poisoning|DNS poisoning|zero.day|exploit|payload|shellcode|malware|ransomware|phishing|vishing|smishing|social engineering)\b/i,
    type: 'tap_to_highlight',
    weight: 8,
  },
  // drag_and_drop: categorisation / matching content
  {
    pattern: /\b(CIA triad|AAA|authentication|authoriz|confidentiality|integrity|availability|symmetric|asymmetric|TLS|SSL|PKI|X\.509|RADIUS|TACACS|LDAP|OAuth|SAML|MFA|2FA|Kerberos)\b/i,
    type: 'drag_and_drop_zone',
    weight: 7,
  },
  // mcq: default (catch-all — applied last)
];

/**
 * Choose the best interaction_type for a block of text.
 * Returns the type with the highest total match weight.
 */
function assignInteractionType(text) {
  const scores = {};
  for (const rule of KEYWORD_RULES) {
    if (!rule.pattern) continue;
    const matches = (text.match(new RegExp(rule.pattern.source, 'gi')) ?? []).length;
    if (matches > 0) {
      scores[rule.type] = (scores[rule.type] ?? 0) + matches * rule.weight;
    }
  }
  if (Object.keys(scores).length === 0) return 'mcq';
  return /** @type {string} */ (Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]);
}

// ── Text utilities ────────────────────────────────────────────────────────────

const WS_RE = /\s+/g;

function normalizeSpace(s) {
  return s.replace(WS_RE, ' ').trim();
}

/** Truncate a string to maxLen characters at a word boundary. */
function truncateToWords(str, maxLen = 250) {
  if (str.length <= maxLen) return str;
  const cut = str.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 100 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

/** Stable deterministic ID for a card. */
function cardId(packId, chapterOrder, sectionOrder, cardIndex) {
  const raw = `${packId}|${chapterOrder}|${sectionOrder}|${cardIndex}`;
  return `${packId}-c${String(chapterOrder).padStart(3,'0')}-s${String(sectionOrder).padStart(3,'0')}-k${String(cardIndex).padStart(3,'0')}`;
}

/** Stable page / module IDs from chapter metadata. */
function pageId(packId, chapterOrder, sectionOrder) {
  return `${packId}-ch${String(chapterOrder).padStart(3,'0')}-s${String(sectionOrder).padStart(3,'0')}`;
}

function moduleId(packId, chapterOrder) {
  return `${packId}-ch${String(chapterOrder).padStart(3,'0')}`;
}

// ── Interaction payload builders ──────────────────────────────────────────────

/**
 * Build an MCQ payload from a paragraph.
 * Generates plausible wrong options by negating key phrases.
 */
function buildMcqPayload(paragraph, sectionTitle) {
  const prompt = sectionTitle
    ? `Regarding "${sectionTitle}": which statement is most accurate?`
    : 'Which of the following statements is most accurate?';

  const correct = paragraph.length > 200 ? paragraph.slice(0, 200).trimEnd() + '…' : paragraph;

  // Generate three distractors by semantic inversion
  const distractors = [
    `${correct.replace(/is /i, 'is not ')}`,
    `The opposite approach is preferred in all ${sectionTitle || 'security'} scenarios.`,
    `This concept applies only to physical security, not information security.`,
  ].map((d) => truncateToWords(d, 200));

  // Shuffle options but keep correct at a deterministic position (index 0 for now;
  // transform.mjs is deterministic — shuffle is done in the quiz engine at runtime)
  const options = [correct, ...distractors];

  return {
    prompt,
    options,
    correct_index: 0,
    explanation: `Based on: "${correct}"`,
  };
}

/**
 * Build a terminal_sim payload from paragraphs that mention commands.
 */
function buildTerminalSimPayload(paragraphs, sectionTitle) {
  // Extract command mentions for scenario text
  const cmdRe = /\b(chmod\s+[\d]+|nmap\s+-\w+|iptables\s+-\w+|ssh\s+\S+|sudo\s+\w+|openssl\s+\w+|curl\s+\S+|systemctl\s+\w+\s+\w+)\b/gi;
  const allText = paragraphs.join(' ');
  const commands = [];
  let m;
  while ((m = cmdRe.exec(allText)) !== null) {
    commands.push(m[1].trim());
  }

  const scenario = sectionTitle
    ? `You are investigating a system related to "${sectionTitle}". Run the appropriate diagnostic command.`
    : 'Run the appropriate command to complete the security task described.';

  if (commands.length > 0) {
    return {
      scenario,
      commands: commands.slice(0, 3).map((cmd) => ({
        pattern: escapeRegex(cmd).replace(/\\\s+/g, '\\s+'),
        success_message: `✓ Correct: \`${cmd}\` executed successfully.`,
        hint: `Try: \`${cmd}\``,
      })),
      expected_output: `Command completed. Review the ${sectionTitle || 'security'} output above.`,
    };
  }

  // Fallback when no literal command extracted
  return {
    scenario,
    commands: [
      {
        pattern: '^(help|man|info|--help)$',
        success_message: '✓ Good start — check the man page or --help flag first.',
        hint: 'Try `help` or the command name with `--help`',
      },
    ],
  };
}

/**
 * Build a log_analyzer payload from paragraph lines.
 */
function buildLogAnalyzerPayload(paragraphs) {
  // Use the first 10 sentences/lines from the paragraphs as fake log lines
  const logLines = paragraphs
    .flatMap((p) => p.split(/\.\s+/).filter((s) => s.trim().length > 15))
    .slice(0, 12)
    .map((line) => line.trim());

  // Pick a random ~30% of lines as "vulnerable" — deterministic via index parity
  const vulnerableIndices = logLines
    .map((_, i) => i)
    .filter((i) => i % 3 === 1) // every third line starting at index 1
    .slice(0, Math.max(1, Math.floor(logLines.length * 0.3)));

  const explanation = `Anomalous lines detected at position(s) ${vulnerableIndices.map((i) => i + 1).join(', ')}. ` +
    `These indicate a potential security event requiring investigation.`;

  return {
    log_lines: logLines.length > 0 ? logLines : ['No log data extracted — review source content.'],
    vulnerable_line_indices: vulnerableIndices.length > 0 ? vulnerableIndices : [0],
    explanation,
  };
}

/**
 * Build a tap_to_highlight payload from paragraph text.
 */
function buildTapToHighlightPayload(paragraphs, sectionTitle) {
  const text = paragraphs.slice(0, 2).join(' ');
  // Find security keywords to highlight
  const targetRe = /\b(SQL injection|XSS|CSRF|buffer overflow|privilege escalation|MITM|ARP poisoning|DNS poisoning|zero.day|exploit|phishing|social engineering|malware|ransomware)\b/gi;
  const spans    = [];
  let m;
  const lower = text;
  while ((m = targetRe.exec(lower)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length, label: m[0] });
  }

  // Deduplicate labels
  const seenLabels = new Set();
  const uniqueSpans = spans.filter((s) => {
    if (seenLabels.has(s.label.toLowerCase())) return false;
    seenLabels.add(s.label.toLowerCase());
    return true;
  });

  if (uniqueSpans.length === 0) {
    // Fallback: highlight the section title keyword if present
    const titleIdx = text.indexOf(sectionTitle ?? '');
    if (titleIdx >= 0 && sectionTitle) {
      uniqueSpans.push({ start: titleIdx, end: titleIdx + sectionTitle.length, label: sectionTitle });
    } else {
      // Generic fallback
      uniqueSpans.push({ start: 0, end: Math.min(20, text.length), label: text.slice(0, 20) });
    }
  }

  return {
    text: truncateToWords(text, 600),
    spans: uniqueSpans.slice(0, 5),
    target_span_labels: uniqueSpans.slice(0, 3).map((s) => s.label),
    explanation: `The highlighted terms are the key concepts in this ${sectionTitle || 'section'}.`,
  };
}

/**
 * Build a drag_and_drop_zone payload from paragraph text.
 */
function buildDragAndDropPayload(paragraphs, sectionTitle) {
  // Common categorisation pairs in security content
  const CATEGORY_PAIRS = [
    { items: ['Confidentiality', 'Integrity', 'Availability'], zones: ['CIA Triad Components'] },
    { items: ['Authentication', 'Authorization', 'Accounting'], zones: ['AAA Components'] },
    { items: ['Symmetric encryption', 'Asymmetric encryption'], zones: ['Encryption Types'] },
    { items: ['Something you know', 'Something you have', 'Something you are'], zones: ['MFA Factors'] },
  ];

  // Pick the best pair based on keyword presence
  const allText = paragraphs.join(' ');
  let bestPair = CATEGORY_PAIRS[0];
  let bestScore = 0;
  for (const pair of CATEGORY_PAIRS) {
    const score = pair.items.filter((item) => allText.toLowerCase().includes(item.toLowerCase())).length;
    if (score > bestScore) { bestScore = score; bestPair = pair; }
  }

  const items  = bestPair.items;
  const zones  = bestPair.zones.length < items.length
    ? [...bestPair.zones, ...items.slice(bestPair.zones.length).map((_, i) => `Category ${i + 1}`)]
    : bestPair.zones;

  const correctPairs = {};
  items.forEach((item, i) => {
    correctPairs[item] = zones[i] ?? zones[0];
  });

  return {
    items,
    zones,
    correct_pairs: correctPairs,
    explanation: `${items.join(', ')} are core concepts in ${sectionTitle || 'this security domain'}.`,
  };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Chunk → LessonCard ────────────────────────────────────────────────────────

/**
 * Convert one RawChunk + paragraph into a LessonCard object.
 */
function chunkToCard(chunk, cardIndex, packId) {
  const combinedText     = chunk.paragraphs.join(' ');
  const interactionType  = assignInteractionType(`${chunk.sectionTitle} ${combinedText}`);
  const contextText      = truncateToWords(
    chunk.sectionTitle
      ? `${chunk.sectionTitle}: ${chunk.paragraphs[0] ?? ''}`
      : (chunk.paragraphs[0] ?? ''),
    250
  );

  const id = cardId(packId, chunk.chapterOrder, chunk.sectionOrder, cardIndex);

  let interaction_payload;
  switch (interactionType) {
    case 'terminal_sim':
      interaction_payload = buildTerminalSimPayload(chunk.paragraphs, chunk.sectionTitle);
      break;
    case 'log_analyzer':
      interaction_payload = buildLogAnalyzerPayload(chunk.paragraphs);
      break;
    case 'tap_to_highlight':
      interaction_payload = buildTapToHighlightPayload(chunk.paragraphs, chunk.sectionTitle);
      break;
    case 'drag_and_drop_zone':
      interaction_payload = buildDragAndDropPayload(chunk.paragraphs, chunk.sectionTitle);
      break;
    default:
      interaction_payload = buildMcqPayload(chunk.paragraphs[0] ?? combinedText, chunk.sectionTitle);
  }

  return {
    id,
    text: contextText,
    interaction_type: interactionType,
    interaction_payload,
  };
}

// ── Chunk grouping → LessonPage / Module / Lesson ────────────────────────────

/**
 * Group raw chunks by (chapterNumber, chapterOrder) to build LessonModule/Page
 * structures compatible with the ChapterLesson schema.
 *
 * Each distinct EPUB spine chapter → one LessonModule.
 * Each section within the chapter → one LessonPage with `cards`.
 */
function groupChunksToLesson(packId, chapChunks) {
  // Group sections by (chapterOrder, chapterTitle) — one module per EPUB doc
  const docMap = new Map(); // chapterOrder → { title, sections: [{sectionOrder, sectionTitle, chunks}] }

  for (const chunk of chapChunks) {
    if (!docMap.has(chunk.chapterOrder)) {
      docMap.set(chunk.chapterOrder, {
        title: chunk.chapterTitle,
        sections: new Map(),
      });
    }
    const doc = docMap.get(chunk.chapterOrder);
    const key = chunk.sectionOrder;
    if (!doc.sections.has(key)) {
      doc.sections.set(key, { sectionTitle: chunk.sectionTitle, chunks: [] });
    }
    doc.sections.get(key).chunks.push(chunk);
  }

  const modules = [];
  for (const [docOrder, doc] of docMap) {
    const modId = moduleId(packId, docOrder);
    const pages = [];

    for (const [sectOrder, sect] of doc.sections) {
      const pgId   = pageId(packId, docOrder, sectOrder);
      const pgTitle = sect.sectionTitle || doc.title;

      // One card per paragraph (paragraph-level granularity for micro-interactions)
      const cards = sect.chunks.flatMap((chunk, chunkIdx) =>
        chunk.paragraphs.map((para, paraIdx) => {
          const syntheticChunk = {
            ...chunk,
            paragraphs: [para],
            sectionTitle: chunk.sectionTitle || pgTitle,
          };
          return chunkToCard(syntheticChunk, chunkIdx * 100 + paraIdx, packId);
        })
      );

      // Keep pages to a reasonable size (max 8 cards per page for UX)
      const cardPages = [];
      for (let i = 0; i < cards.length; i += 8) {
        cardPages.push(cards.slice(i, i + 8));
      }

      for (let pi = 0; pi < cardPages.length; pi++) {
        pages.push({
          id:    `${pgId}-${String(pi + 1).padStart(2, '0')}`,
          title: cardPages.length > 1 ? `${pgTitle} (${pi + 1}/${cardPages.length})` : pgTitle,
          objectiveIds: [],
          content_blocks: [],
          checks: [],
          cards: cardPages[pi],
        });
      }
    }

    if (pages.length > 0) {
      modules.push({
        id: modId,
        title: doc.title,
        tag_ids: [],
        objectiveIds: [],
        pages,
      });
    }
  }

  return modules;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(CHUNKS_PATH)) {
    console.error(`\n❌  raw_chunks.json not found at: ${CHUNKS_PATH}`);
    console.error('    Run extract.mjs first.');
    process.exit(1);
  }

  /** @type {import('./extract.mjs').RawChunk[]} */
  const chunks = JSON.parse(fs.readFileSync(CHUNKS_PATH, 'utf8'));
  console.log(`\n⚙️   Loaded ${chunks.length} raw chunks from ${CHUNKS_PATH}`);

  // Group by chapter number
  const byChapter = new Map(); // chapterNumber → RawChunk[]
  for (const chunk of chunks) {
    const key = chunk.chapterNumber;
    if (!byChapter.has(key)) byChapter.set(key, []);
    byChapter.get(key).push(chunk);
  }
  console.log(`    Found ${byChapter.size} distinct chapters.`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let totalCards   = 0;
  let totalFiles   = 0;
  const skippedChs = [];

  for (const [chapterNum, chapChunks] of byChapter) {
    const packId     = `ch${String(chapterNum).padStart(2, '0')}`;
    const chapterTitle = chapChunks[0]?.chapterTitle ?? `Chapter ${chapterNum}`;

    // Skip front matter / appendices (chapter 0 or > 25)
    if (chapterNum === 0 || chapterNum > 25) {
      skippedChs.push({ chapterNum, chapterTitle, reason: 'front-matter / appendix' });
      continue;
    }

    const modules = groupChunksToLesson(packId, chapChunks);
    if (modules.length === 0) continue;

    const cardCount = modules
      .flatMap((m) => m.pages)
      .flatMap((p) => p.cards ?? [])
      .length;

    /** @type {ChapterLesson} */
    const lesson = {
      pack_id:      packId,
      version:      '3.0.0-generated',
      objectiveIds: [],
      modules,
    };

    const outPath = path.join(OUT_DIR, `${packId}.lesson.json`);

    // Check if file already exists — don't overwrite hand-edited files by default
    const overwrite = process.argv.includes('--overwrite');
    if (fs.existsSync(outPath) && !overwrite) {
      console.warn(`  [SKIP] ${packId}.lesson.json already exists. Use --overwrite to replace.`);
      continue;
    }

    fs.writeFileSync(outPath, JSON.stringify(lesson, null, 2), 'utf8');
    process.stdout.write(`  ✅  ${packId}.lesson.json  (${modules.length} modules, ${cardCount} cards)\n`);

    totalCards += cardCount;
    totalFiles++;
  }

  console.log(`\n🎉  Done! ${totalFiles} lesson files written, ${totalCards} cards generated.`);
  if (skippedChs.length > 0) {
    console.log(`\n⚠️   Skipped ${skippedChs.length} non-chapter spine items (front matter / appendices):`);
    skippedChs.forEach((s) => console.log(`      ch${s.chapterNum}: ${s.chapterTitle} — ${s.reason}`));
  }
}

main().catch((err) => {
  console.error('\n\n❌  Transform failed:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
