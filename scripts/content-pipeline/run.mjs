#!/usr/bin/env node
/**
 * run.mjs — Full content ingestion pipeline runner
 *
 * Runs: extract → transform → validate
 *
 * Usage:
 *   node scripts/content-pipeline/run.mjs
 *   node scripts/content-pipeline/run.mjs --overwrite   # replace existing lesson files
 *   node scripts/content-pipeline/run.mjs --skip-extract # use existing raw_chunks.json
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE  = __dirname;

function run(label, cmd) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`▶  ${label}`);
  console.log('═'.repeat(60));
  execSync(cmd, { stdio: 'inherit', cwd: path.resolve(__dirname, '..', '..') });
}

const args = process.argv.slice(2);
const skipExtract = args.includes('--skip-extract');
const overwrite   = args.includes('--overwrite') ? '--overwrite' : '';

try {
  if (!skipExtract) {
    run(
      'Phase 1 — Extract EPUB content',
      `node ${path.join(PIPELINE, 'extract.mjs')}`
    );
  } else {
    console.log('\n⏭   Skipping extract (--skip-extract).');
  }

  run(
    'Phase 2 — Transform chunks → LessonCard JSON',
    `node ${path.join(PIPELINE, 'transform.mjs')} ${overwrite}`
  );

  run(
    'Phase 3 — Validate generated lesson files',
    `node ${path.join(PIPELINE, 'validate.mjs')}`
  );

  console.log('\n\n🎉  Pipeline complete!');
  console.log('    Generated files are in content/chapter_lessons/');
  console.log('    Review ⚠️  warnings above for cards that need manual editing.');
} catch (err) {
  console.error('\n\n❌  Pipeline failed:', err.message);
  process.exit(1);
}
