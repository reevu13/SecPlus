# Content Policy (Mode A)

This repository follows **Mode A** for source material handling.

## Hard Rules

1. **Do not extract, store, or commit EPUB text** into this repo.
2. EPUB files are local source inputs only and must stay under `content/source/*.epub` and remain gitignored.
3. App content must be original and authored for this project.
4. Source alignment is allowed only through metadata pointers (for example `sourceRef` with `outlineId`, `href`, `title`), not copied source text.

## Allowed

- `content/source/sybex.epub` kept locally and ignored by git.
- Outline metadata only (chapter/section titles, order, href, hashes, word counts) in:
  - `content/_source_outline/book_outline.json`
  - `content/_source_outline/book_outline.md`
- Objective and mapping references:
  - `content/objectives/*.json`
  - `content/mappings/*.json`
- Question metadata pointers such as:
  - `sourceRef: { "outlineId": "...", "href": "...", "title": "..." }`

## Disallowed

- Copying chapter or section prose from EPUB into:
  - `content/chapter_packs/*.json`
  - `content/chapter_lessons/*.json`
  - `content/chapter_enrichment/*.json`
- Committing raw extraction dumps (txt/html/xhtml) under `content/`.
- Tracking any `*.epub` file in git.
- Adding extraction output folders with source text (for example `content/_source_text/`).
