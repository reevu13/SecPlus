#!/usr/bin/env node
/**
 * transform.cjs — Phase 2: Raw Chunks → LessonCard JSON (CommonJS)
 *
 * Reads raw_chunks.json and generates LessonCard objects.
 * Supports merge mode: appends cards to existing lesson files (preserving
 * hand-authored content_blocks and checks) instead of overwriting.
 *
 * Usage:
 *   node scripts/content-pipeline/transform.cjs
 *   node scripts/content-pipeline/transform.cjs --overwrite
 *   node scripts/content-pipeline/transform.cjs --merge   # DEFAULT
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const REPO_ROOT   = path.resolve(__dirname, '..', '..');
const CHUNKS_PATH = path.resolve(REPO_ROOT, 'scripts/content-pipeline/raw_chunks.json');
const OUT_DIR     = path.resolve(REPO_ROOT, 'content/chapter_lessons');

const overwriteMode = process.argv.includes('--overwrite');

// ── Keyword → interaction_type mapping ───────────────────────────────────────
const KEYWORD_RULES = [
  { pattern: /\b(chmod|chown|nmap|ssh|ping|iptables|ufw|netstat|tcpdump|wireshark|nessus|openssl|curl|wget|nc|netcat|grep|awk|sed|sudo|systemctl|journalctl|dmesg)\b/i, type: 'terminal_sim', weight: 10 },
  { pattern: /\b(syslog|event log|audit log|SIEM|splunk|logfile|log entry|log analysis|IDS alert|firewall log|failed login|authentication failure|access log)\b/i, type: 'log_analyzer', weight: 9 },
  { pattern: /\b(SQL injection|XSS|cross-site scripting|CSRF|buffer overflow|race condition|privilege escalation|man-in-the-middle|MITM|ARP poisoning|DNS poisoning|zero.day|exploit|payload|shellcode|malware|ransomware|phishing|vishing|smishing|social engineering)\b/i, type: 'tap_to_highlight', weight: 8 },
  { pattern: /\b(CIA triad|AAA|authentication|authoriz|confidentiality|integrity|availability|symmetric|asymmetric|TLS|SSL|PKI|X\.509|RADIUS|TACACS|LDAP|OAuth|SAML|MFA|2FA|Kerberos)\b/i, type: 'drag_and_drop_zone', weight: 7 },
];

function assignInteractionType(text) {
  const scores = {};
  for (const rule of KEYWORD_RULES) {
    const matches = (text.match(new RegExp(rule.pattern.source, 'gi')) || []).length;
    if (matches > 0) scores[rule.type] = (scores[rule.type] || 0) + matches * rule.weight;
  }
  if (Object.keys(scores).length === 0) return 'mcq';
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

// ── Text utilities ────────────────────────────────────────────────────────────
function truncate(str, max = 250) {
  if (str.length <= max) return str;
  const cut = str.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > 100 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ── Payload builders ─────────────────────────────────────────────────────────
function buildMcqPayload(para, sectionTitle) {
  const prompt = sectionTitle
    ? `Regarding "${truncate(sectionTitle, 80)}": which statement is most accurate?`
    : 'Which of the following statements is most accurate?';
  const correct = truncate(para, 200);
  return {
    prompt,
    options: [correct,
      `The opposite principle applies in ${sectionTitle || 'security'} contexts.`,
      'This only applies to physical security, not information security.',
      'This concept has been deprecated in modern security frameworks.'],
    correct_index: 0,
    explanation: `Key fact: "${correct}"`,
  };
}

function buildTerminalSimPayload(paragraphs, sectionTitle) {
  const allText = paragraphs.join(' ');
  const cmdRe = /\b(chmod\s+[\d]+|nmap\s+-\w+|iptables\s+-\w+|ssh\s+\S+|sudo\s+\w+|openssl\s+\w+|curl\s+\S+|systemctl\s+\w+\s+\w+)\b/gi;
  const cmds = [];
  let m;
  while ((m = cmdRe.exec(allText)) !== null) cmds.push(m[1].trim());
  const scenario = sectionTitle
    ? `You need to complete a task related to "${sectionTitle}". Run the appropriate command.`
    : 'Run the appropriate security diagnostic command.';
  if (cmds.length > 0) {
    return {
      scenario,
      commands: cmds.slice(0, 3).map(c => ({
        pattern: escapeRegex(c).replace(/\\\s+/g, '\\s+'),
        success_message: `✓ Correct: \`${c}\``,
        hint: `Try: \`${c}\``,
      })),
    };
  }
  return {
    scenario,
    commands: [{ pattern: '^(help|man|--help)$', success_message: '✓ Good start!', hint: 'Try `help` or `--help`' }],
  };
}

function buildLogAnalyzerPayload(paragraphs) {
  const logLines = paragraphs.flatMap(p => p.split(/\.\s+/).filter(s => s.trim().length > 15)).slice(0, 12).map(l => l.trim());
  const vulnIdx = logLines.map((_, i) => i).filter(i => i % 3 === 1).slice(0, Math.max(1, Math.floor(logLines.length * 0.3)));
  return {
    log_lines: logLines.length > 0 ? logLines : ['No log data extracted.'],
    vulnerable_line_indices: vulnIdx.length > 0 ? vulnIdx : [0],
    explanation: `Lines ${vulnIdx.map(i => i+1).join(', ')} indicate potential security events.`,
  };
}

function buildTapToHighlightPayload(paragraphs, sectionTitle) {
  const text = paragraphs.slice(0, 2).join(' ');
  const re = /\b(SQL injection|XSS|CSRF|buffer overflow|privilege escalation|MITM|ARP poisoning|DNS poisoning|zero.day|exploit|phishing|social engineering|malware|ransomware)\b/gi;
  const spans = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    if (seen.has(m[0].toLowerCase())) continue;
    seen.add(m[0].toLowerCase());
    spans.push({ start: m.index, end: m.index + m[0].length, label: m[0] });
  }
  if (spans.length === 0) {
    const idx = text.indexOf(sectionTitle || '');
    if (idx >= 0 && sectionTitle) spans.push({ start: idx, end: idx + sectionTitle.length, label: sectionTitle });
    else spans.push({ start: 0, end: Math.min(20, text.length), label: text.slice(0, 20) });
  }
  return {
    text: truncate(text, 600),
    spans: spans.slice(0, 5),
    target_span_labels: spans.slice(0, 3).map(s => s.label),
    explanation: `Key concepts in this ${sectionTitle || 'section'}.`,
  };
}

function buildDragAndDropPayload(paragraphs, sectionTitle) {
  const PAIRS = [
    { items: ['Confidentiality', 'Integrity', 'Availability'], zones: ['CIA Triad Components'] },
    { items: ['Authentication', 'Authorization', 'Accounting'], zones: ['AAA Components'] },
    { items: ['Symmetric encryption', 'Asymmetric encryption'], zones: ['Encryption Types'] },
    { items: ['Something you know', 'Something you have', 'Something you are'], zones: ['MFA Factors'] },
  ];
  const allText = paragraphs.join(' ');
  let best = PAIRS[0], bestScore = 0;
  for (const p of PAIRS) {
    const score = p.items.filter(i => allText.toLowerCase().includes(i.toLowerCase())).length;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  const zones = best.zones.length < best.items.length
    ? [...best.zones, ...best.items.slice(best.zones.length).map((_, i) => `Category ${i + 1}`)]
    : best.zones;
  const pairs = {};
  best.items.forEach((item, i) => { pairs[item] = zones[i] || zones[0]; });
  return {
    items: best.items,
    zones,
    correct_pairs: pairs,
    explanation: `${best.items.join(', ')} — core concepts in ${sectionTitle || 'security'}.`,
  };
}

// ── Chunk → Card ──────────────────────────────────────────────────────────────
function chunkToCard(chunk, cardIndex, packId) {
  const combined = chunk.paragraphs.join(' ');
  const iType = assignInteractionType(`${chunk.sectionTitle} ${combined}`);
  const text = truncate(chunk.sectionTitle
    ? `${chunk.sectionTitle}: ${chunk.paragraphs[0] || ''}`
    : (chunk.paragraphs[0] || ''), 250);
  const id = `${packId}-c${String(chunk.chapterOrder).padStart(3,'0')}-s${String(chunk.sectionOrder).padStart(3,'0')}-k${String(cardIndex).padStart(3,'0')}`;

  let payload;
  switch (iType) {
    case 'terminal_sim':       payload = buildTerminalSimPayload(chunk.paragraphs, chunk.sectionTitle); break;
    case 'log_analyzer':       payload = buildLogAnalyzerPayload(chunk.paragraphs); break;
    case 'tap_to_highlight':   payload = buildTapToHighlightPayload(chunk.paragraphs, chunk.sectionTitle); break;
    case 'drag_and_drop_zone': payload = buildDragAndDropPayload(chunk.paragraphs, chunk.sectionTitle); break;
    default:                   payload = buildMcqPayload(chunk.paragraphs[0] || combined, chunk.sectionTitle);
  }
  return { id, text, interaction_type: iType, interaction_payload: payload };
}

// ── Grouping ──────────────────────────────────────────────────────────────────
function groupChunksToModules(packId, chapChunks) {
  const docMap = new Map();
  for (const chunk of chapChunks) {
    if (!docMap.has(chunk.chapterOrder)) docMap.set(chunk.chapterOrder, { title: chunk.chapterTitle, sections: new Map() });
    const doc = docMap.get(chunk.chapterOrder);
    if (!doc.sections.has(chunk.sectionOrder)) doc.sections.set(chunk.sectionOrder, { title: chunk.sectionTitle, chunks: [] });
    doc.sections.get(chunk.sectionOrder).chunks.push(chunk);
  }

  const modules = [];
  for (const [docOrder, doc] of docMap) {
    const modId = `${packId}-ch${String(docOrder).padStart(3,'0')}`;
    const pages = [];
    for (const [sectOrder, sect] of doc.sections) {
      const pgId = `${packId}-ch${String(docOrder).padStart(3,'0')}-s${String(sectOrder).padStart(3,'0')}`;
      const pgTitle = sect.title || doc.title;
      const cards = sect.chunks.flatMap((chunk, ci) =>
        chunk.paragraphs.map((para, pi) => chunkToCard({ ...chunk, paragraphs: [para], sectionTitle: chunk.sectionTitle || pgTitle }, ci * 100 + pi, packId))
      );
      // Split into max 8 cards per page for UX
      for (let i = 0; i < cards.length; i += 8) {
        const slice = cards.slice(i, i + 8);
        const pageNum = Math.floor(i / 8) + 1;
        const totalP = Math.ceil(cards.length / 8);
        pages.push({
          id: totalP > 1 ? `${pgId}-${String(pageNum).padStart(2,'0')}` : pgId,
          title: totalP > 1 ? `${pgTitle} (${pageNum}/${totalP})` : pgTitle,
          objectiveIds: [],
          content_blocks: [],
          checks: [],
          cards: slice,
        });
      }
    }
    if (pages.length > 0) {
      modules.push({ id: modId, title: doc.title, tag_ids: [], objectiveIds: [], pages });
    }
  }
  return modules;
}

// ── Merge logic ───────────────────────────────────────────────────────────────
function mergeWithExisting(existingLesson, newModules) {
  // Strategy: keep all existing modules/pages intact, add cards to matching pages
  // or append new modules for sections not already covered
  const existing = JSON.parse(JSON.stringify(existingLesson)); // deep clone
  const existingPageIds = new Set();
  for (const mod of existing.modules) {
    for (const page of mod.pages) {
      existingPageIds.add(page.id);
      // Clear existing cards if any (replace with fresh pipeline cards)
      page.cards = [];
    }
  }

  // Collect all new cards by module
  const newCardsByModTitle = new Map();
  for (const mod of newModules) {
    for (const page of mod.pages) {
      if (!newCardsByModTitle.has(mod.title)) newCardsByModTitle.set(mod.title, []);
      newCardsByModTitle.get(mod.title).push(...(page.cards || []));
    }
  }

  // Distribute cards to existing modules
  for (const mod of existing.modules) {
    const cards = newCardsByModTitle.get(mod.title) || [];
    if (cards.length > 0 && mod.pages.length > 0) {
      // Spread cards across existing pages
      const perPage = Math.ceil(cards.length / mod.pages.length);
      for (let pi = 0; pi < mod.pages.length; pi++) {
        mod.pages[pi].cards = cards.slice(pi * perPage, (pi + 1) * perPage);
      }
      newCardsByModTitle.delete(mod.title);
    }
  }

  // Append new modules for content not covered by existing pages
  for (const mod of newModules) {
    if (newCardsByModTitle.has(mod.title)) {
      existing.modules.push(mod);
      newCardsByModTitle.delete(mod.title);
    }
  }

  return existing;
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(CHUNKS_PATH)) {
    console.error('❌  raw_chunks.json not found. Run extract.cjs first.');
    process.exit(1);
  }

  const chunks = JSON.parse(fs.readFileSync(CHUNKS_PATH, 'utf8'));
  console.log(`\n⚙️   Loaded ${chunks.length} raw chunks.`);

  // Group by chapter number
  const byChapter = new Map();
  for (const chunk of chunks) {
    const key = chunk.chapterNumber;
    if (!byChapter.has(key)) byChapter.set(key, []);
    byChapter.get(key).push(chunk);
  }
  console.log(`    Found ${byChapter.size} distinct chapters.`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let totalCards = 0, totalFiles = 0;
  const skipped = [];

  for (const [chapterNum, chapChunks] of byChapter) {
    const packId = `ch${String(chapterNum).padStart(2, '0')}`;

    // Skip front matter / appendices
    if (chapterNum === 0 || chapterNum > 25) {
      skipped.push({ chapterNum, title: chapChunks[0]?.chapterTitle, reason: 'front-matter/appendix' });
      continue;
    }

    const newModules = groupChunksToModules(packId, chapChunks);
    if (newModules.length === 0) continue;

    const outPath = path.join(OUT_DIR, `${packId}.lesson.json`);
    let lesson;

    if (fs.existsSync(outPath) && !overwriteMode) {
      // MERGE: keep existing content, inject new cards
      const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      lesson = mergeWithExisting(existing, newModules);
      console.log(`  🔀  ${packId}.lesson.json — MERGED (existing content preserved, cards added)`);
    } else {
      // NEW or OVERWRITE
      lesson = {
        pack_id: packId,
        version: '3.0.0-generated',
        objectiveIds: [],
        modules: newModules,
      };
      console.log(`  ✅  ${packId}.lesson.json — ${overwriteMode ? 'OVERWRITTEN' : 'NEW'}`);
    }

    const cardCount = lesson.modules.flatMap(m => m.pages).flatMap(p => p.cards || []).length;
    totalCards += cardCount;
    totalFiles++;
    console.log(`       ${lesson.modules.length} modules, ${cardCount} cards`);

    fs.writeFileSync(outPath, JSON.stringify(lesson, null, 2), 'utf8');
  }

  console.log(`\n🎉  Done! ${totalFiles} files written, ${totalCards} cards total.`);
  if (skipped.length > 0) {
    console.log(`\n⚠️   Skipped ${skipped.length} items:`);
    skipped.forEach(s => console.log(`      ch${s.chapterNum}: ${s.title} — ${s.reason}`));
  }
}

main();
