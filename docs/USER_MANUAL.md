# User Manual – SecPlus Quest

## 1. Install & Run

1. Open a terminal in the `SecPlus/` directory.
2. Run `npm install` *(first time only)*.
3. Start the app: `npm run dev`.
4. Open **[http://localhost:3000/map](http://localhost:3000/map)** in your browser.

---

## 2. Main Navigation

| Section | Description |
|---|---|
| **Map** | Chapter overview — continue or start chapters from here. |
| **Chapter Learn** | Lesson modules and pages with quick checks. |
| **Mission** | Chapter mission question flow with post-answer explanations. |
| **Roguelike** | Exam-style randomized practice run weighted by your weaknesses. |
| **Review** | Mistake cards and scheduled spaced-repetition retries. |
| **Coverage / Ops** | Content, mapping, and coverage diagnostics (for maintainers). |

---

## 3. Recommended Study Workflow

1. From **Map**, open a chapter you want to study.
2. In **Learn**, work through module pages and complete quick checks.
3. Run **Mission** for applied questions on the chapter material.
4. Run **Roguelike** for mixed, adaptive practice across chapters.
5. Visit **Review** daily and clear any due mistake cards.

---

## 4. Mistake Remediation

- Answering a question **wrong** or marking it **unsure** automatically creates a mistake card.
- If an objective mapping exists for that question, the card will display a **Review lesson** link.
- Clicking **Review lesson** deep-links you directly to the target module and page in lesson mode.

---

## 5. Android / PWA Use

1. Open the app in **Chrome on Android**.
2. Tap the in-app **Install** button, or use the browser menu → *Add to Home Screen*.
3. Open the app **once online** to cache all content for offline use.
4. When JSON content is updated, tap **Refresh Content** inside the app to pull the latest files.

---

## 6. Progress Management

- Progress is **auto-saved locally** — no account or sign-in required.
- Use the **Export** button to download a backup of your progress as a JSON file.
- Use the **Import** button to restore from a previously exported file.

---

## 7. Troubleshooting

| Symptom | Resolution |
|---|---|
| "Content not found" error | Run `npm run content:validate` and check schema errors. |
| Build / type / lint issues | Run `npm run lint`, `npx tsc --noEmit`, or `npm run build`. |
| Stale or outdated content | Tap **Refresh Content** in the app, then hard-refresh your browser. |

---

## 8. Content Ingestion & Objective Mapping (Maintainers)

The app now uses a Mode A (offline-only) content extraction pipeline to generate interactive `LessonCard` content from the EPUB source, and tools to map them to the SY0-701 objectives.

**Running the Pipeline:**
1. Ensure the source book is placed at `content/source/sybex.epub`.
2. Run `npm run pipeline` (this runs extract, transform, and validate).
   - This creates new `ch*.lesson.json` files and merges pipeline-generated cards into existing hand-authored `content_blocks` without overwriting them.
3. If you want to completely overwrite existing files (destroying hand-authored blocks), use `npm run pipeline -- --overwrite`.

**Objective Mapping & Coverage:**
1. **Map chapters to objectives**: Run tool scripts, such as `npm run objectives:suggest` then `npm run objectives:apply-patch` to map `LessonPage`s to specific exam objectives.
2. **Check Coverage**: Run `npm run objectives:coverage` to see which SY0-701 objectives lack content (Cards, Lessons, or Questions).
3. **Card-level mapping**: Currently, objective inheritance (from page to child cards) must be run via node script or manually assigned, so the Adaptive Coach knows which cards belong to which objectives.
