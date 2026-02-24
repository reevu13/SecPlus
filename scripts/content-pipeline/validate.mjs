#!/usr/bin/env node
/**
 * validate.mjs — Phase 3: Zod validation of generated lesson.json files
 *
 * Validates every .lesson.json in content/chapter_lessons/ against the
 * LessonCard schema defined in Zod.  Flags:
 *   - Missing interaction_payload
 *   - text field exceeding 250 characters
 *   - Invalid interaction_type values
 *   - Malformed payload structures
 *
 * Can also be used as a programmatic module:
 *   import { validateLessonFile, LessonCardSchema } from './validate.mjs';
 *
 * Usage:
 *   node scripts/content-pipeline/validate.mjs
 *   node scripts/content-pipeline/validate.mjs --dir content/chapter_lessons
 *   node scripts/content-pipeline/validate.mjs --file content/chapter_lessons/ch10.lesson.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = path.resolve(__dirname, '..', '..');

// ── CLI args ──────────────────────────────────────────────────────────────────

function getArg(flag, def) {
  const args = process.argv.slice(2);
  const idx  = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}

const TARGET_DIR  = path.resolve(REPO_ROOT, getArg('--dir', 'content/chapter_lessons'));
const TARGET_FILE = process.argv.includes('--file')
  ? path.resolve(REPO_ROOT, getArg('--file', ''))
  : null;

// ── Zod Schemas ───────────────────────────────────────────────────────────────

// Interaction type enum
const InteractionTypeSchema = z.enum([
  'mcq',
  'terminal_sim',
  'log_analyzer',
  'drag_and_drop_zone',
  'tap_to_highlight',
]);

// Payload schemas
const McqPayloadSchema = z.object({
  prompt:        z.string().min(10, 'prompt too short'),
  options:       z.array(z.string()).min(2, 'need ≥ 2 options'),
  correct_index: z.number().int().min(0),
  explanation:   z.string().min(5),
});

const TerminalSimPayloadSchema = z.object({
  scenario: z.string().min(10),
  commands: z.array(z.object({
    pattern:         z.string().min(1),
    success_message: z.string().min(1),
    hint:            z.string().optional(),
  })).min(1, 'need ≥ 1 command'),
  expected_output: z.string().optional(),
});

const LogAnalyzerPayloadSchema = z.object({
  log_lines:              z.array(z.string()).min(1),
  vulnerable_line_indices: z.array(z.number().int().min(0)).min(1),
  explanation:            z.string().min(5),
});

const DragAndDropPayloadSchema = z.object({
  items:         z.array(z.string()).min(2),
  zones:         z.array(z.string()).min(1),
  correct_pairs: z.record(z.string()),
  explanation:   z.string().min(5),
});

const TapToHighlightPayloadSchema = z.object({
  text: z.string().min(10),
  spans: z.array(z.object({
    start: z.number().int().min(0),
    end:   z.number().int().min(0),
    label: z.string().min(1),
  })).min(1),
  target_span_labels: z.array(z.string()).min(1),
  explanation:        z.string().min(5),
});

// LessonCard base fields
const LessonCardBaseSchema = z.object({
  id:             z.string().min(1),
  text:           z.string().max(250, '⚠️  text exceeds 250-char limit'),
  remediation_id: z.string().optional(),
  objectiveIds:   z.array(z.string()).optional(),
});

// Discriminated union for the full card shape
export const LessonCardSchema = z.discriminatedUnion('interaction_type', [
  LessonCardBaseSchema.extend({
    interaction_type:    z.literal('mcq'),
    interaction_payload: McqPayloadSchema,
  }),
  LessonCardBaseSchema.extend({
    interaction_type:    z.literal('terminal_sim'),
    interaction_payload: TerminalSimPayloadSchema,
  }),
  LessonCardBaseSchema.extend({
    interaction_type:    z.literal('log_analyzer'),
    interaction_payload: LogAnalyzerPayloadSchema,
  }),
  LessonCardBaseSchema.extend({
    interaction_type:    z.literal('drag_and_drop_zone'),
    interaction_payload: DragAndDropPayloadSchema,
  }),
  LessonCardBaseSchema.extend({
    interaction_type:    z.literal('tap_to_highlight'),
    interaction_payload: TapToHighlightPayloadSchema,
  }),
]);

// LessonPage — cards array optional (backward compat with v1/v2 pages)
const LessonPageSchema = z.object({
  id:             z.string().min(1),
  title:          z.string().min(1),
  objectiveIds:   z.array(z.string()).optional(),
  content_blocks: z.array(z.any()).optional().default([]),
  checks:         z.array(z.any()).optional().default([]),
  cards:          z.array(LessonCardSchema).optional(),
});

const LessonModuleSchema = z.object({
  id:           z.string().min(1),
  title:        z.string().min(1),
  tag_ids:      z.array(z.string()),
  objectiveIds: z.array(z.string()).optional(),
  pages:        z.array(LessonPageSchema).min(1),
});

const ChapterLessonSchema = z.object({
  pack_id:      z.string().min(1),
  version:      z.string().min(1),
  objectiveIds: z.array(z.string()).optional(),
  modules:      z.array(LessonModuleSchema).min(1),
});

// ── Validation helpers ────────────────────────────────────────────────────────

/**
 * @typedef {Object} ValidationIssue
 * @property {'error'|'warning'} severity
 * @property {string} path      - JSON path inside the lesson document
 * @property {string} message
 * @property {*}      [value]   - The failing value (truncated)
 */

/**
 * Validate a parsed lesson object, returning issues.
 * @returns {ValidationIssue[]}
 */
export function validateLesson(lesson) {
  const result = ChapterLessonSchema.safeParse(lesson);
  const issues = [];

  if (!result.success) {
    for (const issue of result.error.issues) {
      const pathStr = issue.path.join('.');
      // Classify 250-char limit as warning; everything else is error
      const severity = issue.message.includes('250-char') ? 'warning' : 'error';
      issues.push({ severity, path: pathStr, message: issue.message });
    }
  }

  // Additional semantic checks beyond Zod
  if (result.data || result.success === false) {
    const raw = lesson;
    (raw.modules ?? []).forEach((mod, mi) => {
      (mod.pages ?? []).forEach((page, pi) => {
        (page.cards ?? []).forEach((card, ci) => {
          const prefix = `modules[${mi}].pages[${pi}].cards[${ci}]`;

          // Missing interaction_payload entirely
          if (!card.interaction_payload || typeof card.interaction_payload !== 'object') {
            issues.push({
              severity: 'error',
              path:     `${prefix}.interaction_payload`,
              message:  'Missing or invalid interaction_payload',
              value:    card.interaction_payload,
            });
          }

          // text length (belt-and-suspenders in case Zod missed it)
          if (typeof card.text === 'string' && card.text.length > 250) {
            issues.push({
              severity: 'warning',
              path:     `${prefix}.text`,
              message:  `text is ${card.text.length} chars (max 250) — needs manual shortening`,
              value:    card.text.slice(0, 60) + '…',
            });
          }

          // Validate that interaction_type is one of the known values
          const validTypes = ['mcq', 'terminal_sim', 'log_analyzer', 'drag_and_drop_zone', 'tap_to_highlight'];
          if (!validTypes.includes(card.interaction_type)) {
            issues.push({
              severity: 'error',
              path:     `${prefix}.interaction_type`,
              message:  `Unknown interaction_type: "${card.interaction_type}"`,
              value:    card.interaction_type,
            });
          }
        });
      });
    });
  }

  return issues;
}

/**
 * Validate a single .lesson.json file on disk.
 * @param {string} filePath
 * @returns {{ ok: boolean, errors: number, warnings: number, issues: ValidationIssue[] }}
 */
export function validateLessonFile(filePath) {
  let lesson;
  try {
    lesson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      errors: 1,
      warnings: 0,
      issues: [{ severity: 'error', path: '/', message: `JSON parse error: ${err.message}` }],
    };
  }

  const issues   = validateLesson(lesson);
  const errors   = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  return { ok: errors === 0, errors, warnings, issues };
}

// ── CLI runner ────────────────────────────────────────────────────────────────

async function main() {
  // Determine list of files to validate
  const files = TARGET_FILE
    ? [TARGET_FILE]
    : fs.readdirSync(TARGET_DIR)
        .filter((f) => f.endsWith('.lesson.json'))
        .map((f) => path.join(TARGET_DIR, f));

  if (files.length === 0) {
    console.log('No .lesson.json files found to validate.');
    return;
  }

  console.log(`\n🔍  Validating ${files.length} lesson file(s)…\n`);

  let totalErrors   = 0;
  let totalWarnings = 0;
  let totalCards    = 0;
  let passCount     = 0;

  for (const file of files) {
    const rel    = path.relative(REPO_ROOT, file);
    const result = validateLessonFile(file);

    // Count cards for reporting
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const cardCount = (raw.modules ?? [])
        .flatMap((m) => m.pages ?? [])
        .flatMap((p) => p.cards ?? [])
        .length;
      totalCards += cardCount;
    } catch { /* ignore */ }

    if (result.ok && result.warnings === 0) {
      console.log(`  ✅  ${rel}`);
      passCount++;
    } else {
      const status = result.ok ? '⚠️ ' : '❌ ';
      console.log(`  ${status} ${rel}  (${result.errors} errors, ${result.warnings} warnings)`);

      for (const issue of result.issues) {
        const icon = issue.severity === 'error' ? '    🔴' : '    🟡';
        const val  = issue.value !== undefined ? `  [value: ${JSON.stringify(issue.value).slice(0, 60)}]` : '';
        console.log(`${icon} ${issue.path}: ${issue.message}${val}`);
      }

      if (result.ok) passCount++;
    }

    totalErrors   += result.errors;
    totalWarnings += result.warnings;
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passCount}/${files.length} files OK`);
  console.log(`Cards validated: ${totalCards}`);
  if (totalErrors   > 0) console.log(`🔴  Errors:   ${totalErrors}`);
  if (totalWarnings > 0) console.log(`🟡  Warnings: ${totalWarnings} — review flagged cards manually`);
  if (totalErrors === 0) console.log(`\n✅  All validated lesson files are schema-compliant.`);
  else {
    console.log(`\n❌  ${totalErrors} error(s) require fixing before committing.`);
    process.exit(1);
  }
}

// Run when invoked directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Validation runner failed:', err.message);
    process.exit(1);
  });
}
