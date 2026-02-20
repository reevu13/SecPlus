# SecPlus Quest

A Next.js + TypeScript study game for CompTIA Security+ SY0-701 with two modes:

- **Campaign (learn mode)**: play missions in order with coaching tips, hints, and explanations.
- **Roguelike Practice (exam mode)**: seeded, timed runs weighted by your weakest tags, with justification required for full points.

## Quickstart
1. **Install deps** (Node 18+):
   ```bash
   cd SecPlus
   npm install
   ```
2. **Run dev server**
   ```bash
   npm run dev
   ```
   Visit http://localhost:3000/map.

### Android access (LAN)
1. Connect phone and laptop to the same Wi-Fi.
2. Start server bound to LAN:
   ```bash
   npm run dev:android
   ```
3. Open on Android Chrome:
   `http://<your-laptop-ip>:3000/map`
   Example: `http://192.168.68.104:3000/map`
4. If it does not open:
   - allow Node/port `3000` through firewall
   - disable VPN/private relay
   - confirm your laptop IP with `ip a` (Linux) or `ipconfig` (Windows host)

## Content Loading
- Chapter packs live in `content/chapter_packs/*.json`.
- Packs are validated at startup against `content/chapter_packs/chapter_pack.v2.schema.json` (fallback: `chapter_pack.schema.json`).
- Packs that fail validation are skipped with a console warning.
- **Required**: `content/chapter_packs/ch1.json` is already included.
- Lessons live in `content/chapter_lessons/*.lesson.json` and are validated against `content/chapter_lessons/chapter_lessons.v2.schema.json` (fallback: `chapter_lessons.schema.json`).
- Enrichment lives in `content/chapter_enrichment/*.enrich.json`.
- Objectives live in `content/objectives/sy0-701.objectives.json` and are validated against `content/objectives/sy0-701.objectives.schema.json`.
- To regenerate objectives from the official PDF, place `SY0-701-Exam-Objectives.pdf` in `content/objectives/` and run:
  ```bash
  npm run objectives:parse
  ```

## Modes & Routes
- `/map` – Campaign map with chapters and missions in order.
- `/mission/[missionId]` – Campaign mission runner (learn mode).
- `/chapter/[packId]` – Bookless Lesson Mode (modules → pages → quick checks + Recall Mode).
- `/roguelike` – Roguelike Practice (exam mode) seed + start.
- `/roguelike/plan` – Run Plan screen (10/45/25/10 split).
- `/roguelike/run?seed=ABC123` – Timed run with weighted questions.
- `/roguelike/results?seed=ABC123` – Debrief + mistake cards.
- `/review` – Mistake cards due for spaced review.
- `/review/coverage` – Objective coverage report (question/scenario/PBQ counts + weakest/missing objectives).

### Roguelike run settings
- Select one or multiple chapters before starting a run.
- Configure runtime and pace (`minutes per question`).
- Default pacing is **1 question per 1 minute**.
- URL params supported: `seed`, `chapters`, `focus`, `runtime`, `mpq`.

## Question Types Supported
- **Single choice** (`mcq`)
- **Multi-select** (`multi_select`)
- **Matching** (`matching`)
- **Ordering** (`ordering`)

Legacy `scenario_mcq` entries are normalized to `mcq` at load time.

Explanations are always pulled from the JSON pack (`explanation` fields). Nothing is hardcoded.

## Offline Support
The app registers a service worker (`public/sw.js`) and caches pages + content JSON. After the first load, it works offline for cached routes and chapter content.

### Android PWA Install
1. Open the app in Chrome on Android.
2. When the **Install** button appears, tap it.
3. If it does not appear, use **⋮ menu → Add to Home screen**.
4. Note: full PWA install/service-worker behavior on Android requires a secure context (`https`) or `localhost`. A plain LAN URL (`http://192.168.x.x:3000`) is useful for testing UI, but may not expose full install/offline behavior.

### Offline + Refresh
- You’ll see **Offline Ready** after the first successful cache.
- Use **Refresh content** to fetch updated packs/lessons and reload.

## Local Storage
Progress data is stored in the browser:
- mastery per tag
- streaks
- run history
- mistake cards
- lesson progress + recall performance

Delete browser storage to reset.

## Progress Export / Import
Use the buttons in the header:
- **Export progress** downloads a JSON snapshot.
- **Import progress** merges progress safely into the current device.

## Static Hosting
- Works under subpaths if you set `NEXT_PUBLIC_BASE_PATH` before building (e.g., `/secplus-quest`).
- Example build:
  ```bash
  NEXT_PUBLIC_BASE_PATH=/secplus-quest npm run build
  ```

## Seeded Runs (PvP Optional)
Enter a seed on `/roguelike` to generate identical runs for multiple users. Sharing the seed reproduces the same question order.

## Notes
- Campaign mode allows **1 hint per question** and displays coaching tips based on trap fixes or tags.
- Roguelike mode is **timed**, **no hints**, and requires a **1-sentence justification** for full points.
- Mistake cards are created for wrong or unsure answers and scheduled for spaced review.

## Full check
```bash
cd SecPlus
npm run content:validate
npx tsc --noEmit
npm run lint
npm run build
```

### Objective coverage gate (CI-style)
- Warn-only by default:
  ```bash
  npm run objectives:coverage
  ```
- Fail when any objective has zero coverage:
  ```bash
  npm run objectives:coverage:gate
  ```
