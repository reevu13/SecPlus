#!/usr/bin/env node
/**
 * validate.mjs — Phase 3: Validation of generated lesson.json files (Vanilla JS)
 *
 * Validates every .lesson.json in content/chapter_lessons/ for:
 *   - Missing interaction_payload
 *   - text field exceeding 250 characters
 *   - Invalid interaction_type values
 *   - Basic structural checks
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ── CLI args ──────────────────────────────────────────────────────────────────
function getArg(flag, def) {
  const args = process.argv.slice(2);
  const idx  = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}

const TARGET_DIR  = path.resolve(REPO_ROOT, getArg('--dir', 'content/chapter_lessons'));
const TARGET_FILE = process.argv.includes('--file') ? path.resolve(REPO_ROOT, getArg('--file', '')) : null;

export function validateLesson(lesson) {
  const issues = [];
  
  if (!lesson || typeof lesson !== 'object') {
    return [{ severity: 'error', path: 'root', message: 'Lesson is not a valid JSON object' }];
  }

  (lesson.modules ?? []).forEach((mod, mi) => {
    (mod.pages ?? []).forEach((page, pi) => {
      (page.cards ?? []).forEach((card, ci) => {
        const prefix = `modules[${mi}].pages[${pi}].cards[${ci}]`;

        if (!card.id || typeof card.id !== 'string') {
          issues.push({ severity: 'error', path: `${prefix}.id`, message: 'Missing or invalid id' });
        }

        // Missing interaction_payload entirely
        if (!card.interaction_payload || typeof card.interaction_payload !== 'object') {
          issues.push({
            severity: 'error',
            path: `${prefix}.interaction_payload`,
            message: 'Missing or invalid interaction_payload',
            value: card.interaction_payload,
          });
        }

        // text length
        if (typeof card.text !== 'string') {
          issues.push({ severity: 'error', path: `${prefix}.text`, message: 'text must be a string' });
        } else if (card.text.length > 250) {
          issues.push({
            severity: 'warning',
            path: `${prefix}.text`,
            message: `text is ${card.text.length} chars (max 250) — needs manual shortening`,
            value: card.text.slice(0, 60) + '…',
          });
        }

        // Validate interaction_type
        const validTypes = ['mcq', 'terminal_sim', 'log_analyzer', 'drag_and_drop_zone', 'tap_to_highlight'];
        if (!validTypes.includes(card.interaction_type)) {
          issues.push({
            severity: 'error',
            path: `${prefix}.interaction_type`,
            message: `Unknown interaction_type: "${card.interaction_type}"`,
            value: card.interaction_type,
          });
        }
      });
    });
  });

  return issues;
}

export function validateLessonFile(filePath) {
  let lesson;
  try {
    lesson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { ok: false, errors: 1, warnings: 0, issues: [{ severity: 'error', path: '/', message: `JSON parse error: ${err.message}` }] };
  }

  const issues = validateLesson(lesson);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  return { ok: errors === 0, errors, warnings, issues };
}

async function main() {
  const files = TARGET_FILE ? [TARGET_FILE] : fs.readdirSync(TARGET_DIR).filter((f) => f.endsWith('.lesson.json')).map((f) => path.join(TARGET_DIR, f));
  if (files.length === 0) { console.log('No .lesson.json files found to validate.'); return; }
  console.log(`\n🔍  Validating ${files.length} lesson file(s)…\n`);

  let totalErrors = 0, totalWarnings = 0, totalCards = 0, passCount = 0;

  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    const result = validateLessonFile(file);

    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      totalCards += (raw.modules ?? []).flatMap(m => m.pages ?? []).flatMap(p => p.cards ?? []).length;
    } catch { /* ignore */ }

    if (result.ok && result.warnings === 0) {
      console.log(`  ✅  ${rel}`);
      passCount++;
    } else {
      const status = result.ok ? '⚠️ ' : '❌ ';
      console.log(`  ${status} ${rel}  (${result.errors} errors, ${result.warnings} warnings)`);
      for (const issue of result.issues) {
        const icon = issue.severity === 'error' ? '    🔴' : '    🟡';
        const val = issue.value !== undefined ? `  [value: ${JSON.stringify(issue.value).slice(0, 60)}]` : '';
        console.log(`${icon} ${issue.path}: ${issue.message}${val}`);
      }
      if (result.ok) passCount++;
    }
    totalErrors += result.errors;
    totalWarnings += result.warnings;
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passCount}/${files.length} files OK`);
  console.log(`Cards validated: ${totalCards}`);
  if (totalErrors > 0) console.log(`🔴  Errors:   ${totalErrors}`);
  if (totalWarnings > 0) console.log(`🟡  Warnings: ${totalWarnings} — review flagged cards manually`);
  
  if (totalErrors === 0) {
    console.log(`\n✅  All validated lesson files are schema-compliant.`);
  } else {
    console.log(`\n❌  ${totalErrors} error(s) require fixing before committing.`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error('Validation runner failed:', err.stack); process.exit(1); });
}
