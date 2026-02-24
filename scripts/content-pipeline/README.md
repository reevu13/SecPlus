# Content Ingestion Pipeline

Offline-only EPUB → LessonCard JSON pipeline for SecPlus Quest.
**No Next.js runtime involvement** — runs entirely in Node.js scripts.

## Directory layout

```
scripts/content-pipeline/
├── extract.mjs    Phase 1 — EPUB → raw_chunks.json
├── transform.mjs  Phase 2 — raw_chunks.json → *.lesson.json
├── validate.mjs   Phase 3 — Zod validation of generated files
├── run.mjs        Full pipeline runner
└── README.md      This file
```

## Prerequisites

- Node.js ≥ 18
- EPUB file at `content/source/sybex.epub`
- `zod` (already in repo devDependencies)

No additional npm packages — `extract.mjs` uses only Node.js built-ins
(`fs`, `zlib`, `Buffer`) to read the EPUB ZIP.

## Run the full pipeline

```bash
# First run
node scripts/content-pipeline/run.mjs

# Re-run transform + validate only (skip slow EPUB extraction)
node scripts/content-pipeline/run.mjs --skip-extract

# Overwrite existing lesson files (use carefully — may discard hand edits)
node scripts/content-pipeline/run.mjs --skip-extract --overwrite
```

Or run each phase individually:

```bash
# Phase 1 — extract EPUB sections
node scripts/content-pipeline/extract.mjs
# → scripts/content-pipeline/raw_chunks.json

# Phase 2 — transform to LessonCard JSON
node scripts/content-pipeline/transform.mjs
# → content/chapter_lessons/ch01.lesson.json … ch25.lesson.json

# Phase 3 — validate all generated files
node scripts/content-pipeline/validate.mjs
# or validate a single file:
node scripts/content-pipeline/validate.mjs --file content/chapter_lessons/ch10.lesson.json
```

Also available as npm scripts:

```bash
npm run pipeline          # full run
npm run pipeline:extract  # phase 1 only
npm run pipeline:validate # phase 3 only
```

## Output schema

Each generated file is a `ChapterLesson` v3 document:

```
content/chapter_lessons/ch01.lesson.json   ← ch01
                        ch02.lesson.json   ← ch02
                        ...
                        ch20.lesson.json   ← ch20
```

Each `LessonPage` contains a `cards` array of `LessonCard` objects:

| interaction_type      | Trigger keywords                      |
|-----------------------|---------------------------------------|
| `terminal_sim`        | chmod, nmap, iptables, ssh, ...       |
| `log_analyzer`        | syslog, SIEM, audit log, access log   |
| `tap_to_highlight`    | SQL injection, XSS, MITM, exploit ... |
| `drag_and_drop_zone`  | CIA triad, AAA, MFA, Kerberos ...     |
| `mcq`                 | (default for all other content)       |

## Post-generation workflow

1. Run the pipeline → review console warnings (🟡) for cards needing manual editing
2. Open flagged `.lesson.json` files and fix:
   - `text` fields > 250 chars: shorten to contextual summary
   - MCQ distractors: improve plausibility
   - terminal_sim patterns: refine regex for specific commands
3. Re-run `validate.mjs` to confirm clean
4. Commit `.lesson.json` files to source control

## Mode A policy compliance

- EPUB is never imported into the Next.js runtime
- `extract.mjs` runs only as an offline Node.js script
- Generated `.lesson.json` files are static JSON — read by `lessonLoader.ts` via `fs`
- The `content/source/` directory is not served by Next.js
