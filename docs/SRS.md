# Software Requirements Specification – SecPlus Quest

## 1. Purpose

SecPlus Quest is a Security+ SY0-701 study app that replaces textbook-only study with interactive lessons, missions, adaptive practice, review scheduling, and exam simulation.

---

## 2. Scope

- Runs as a **Next.js + TypeScript** web app.
- Uses local content JSON files for packs, lessons, enrichment, objectives, and mappings.
- Persists user progress locally (IndexedDB / local storage).
- Supports offline/PWA usage after first load.

---

## 3. User Roles

| Role | Description |
|---|---|
| **Learner** | Studies chapters, runs practice/exam sessions, reviews mistakes. |
| **Content Maintainer** | Adds/validates chapter packs, lessons, and mappings. |
| **Ops/QA User** | Checks coverage, mapping, smoke pages, and validation outputs. |

---

## 4. Functional Requirements

| ID | Requirement |
|---|---|
| FR-01 | **Content ingestion**: load all chapter packs from `content/chapter_packs/*.json`. |
| FR-02 | **Lesson ingestion**: load lessons from `content/chapter_lessons/*.lesson.json`. |
| FR-03 | **Enrichment ingestion**: load optional chapter enrichment from `content/chapter_enrichment/*.enrich.json`. |
| FR-04 | **Campaign map**: show chapters, progress, mastery, and next actions. |
| FR-05 | **Mission play**: support question flow with explanations after answer. |
| FR-06 | **Question types**: support `mcq`, `multi_select`, `ordering`, `matching`. |
| FR-07 | **Lesson mode**: module/page reader with quick checks, progress tracking, and deep-link support via `/chapter/[id]?module=<moduleId>&page=<pageId>`. |
| FR-08 | **Recall mode**: daily lesson recall drills (cloze/explain style). |
| FR-09 | **Roguelike mode**: randomized runs weighted by weakness/mastery. |
| FR-10 | **Mistake cards**: create cards for wrong/unsure answers, persist, and schedule reviews. |
| FR-11 | **Remediation links**: mistake cards can include `Review lesson` deep links based on objective mapping. |
| FR-12 | **Review queue**: due-first queue with spaced repetition behavior. |
| FR-13 | **Coverage/ops views**: objective and mapping coverage pages. |
| FR-14 | **PWA/offline**: installable on Android Chrome; usable offline after first cache. |
| FR-15 | **Import/export**: user can export/import local progress JSON. |
| FR-16 | **Validation tooling**: schema validation scripts for packs/lessons/enrichment/mappings. |

---

## 5. Non-Functional Requirements

- **Responsive UI**: supports mobile and desktop viewports.
- **Accessibility**: keyboard focus visibility and readable contrast ratios.
- **Offline resilience**: app remains functional after first successful cache.
- **Determinism**: scoring and scheduling behavior is deterministic where applicable.
- **Performance**: fast startup with no mandatory backend calls.
- **Privacy**: local-only data model — no data transmitted externally.

---

## 6. Data / Content Requirements

- Chapter packs, lessons, enrichment, and mappings must validate against defined schemas.
- Objective mappings must reference valid objective IDs and valid lesson module/page targets.

---

## 7. Constraints

- **Local-first persistence only** — no backend dependency for primary learner flow.
- **No EPUB text extraction/storage** in app runtime content path (Mode A policy).
- All content consumed at runtime must be pre-validated JSON files.
