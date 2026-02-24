#!/usr/bin/env node
/**
 * map_objectives.cjs
 * 
 * Maps known SY0-701 exam objective IDs from the chapter level explicitly down to 
 * all modules, pages, and generated LessonCards in the content_lessons directory.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LESSONS_DIR = path.resolve(REPO_ROOT, 'content/chapter_lessons');

// SY0-701 Objective Mapping per chapter (Sybex mapping)
const CHAPTER_OBJECTIVE_PRIOR = {
  1: ['2.1'],
  2: ['2.2'],
  3: ['2.3'],
  4: ['1.1', '1.2'],
  5: ['1.3', '1.4'],
  6: ['1.5', '1.6'],
  7: ['3.1'],
  8: ['3.2'],
  9: ['3.3'],
  10: ['3.4'],
  11: ['4.1', '4.2'],
  12: ['4.3', '4.4'],
  13: ['4.5', '4.6'],
  14: ['4.7', '4.8'],
  15: ['5.1', '5.2'],
  16: ['5.3', '5.4'],
  17: ['5.5', '5.6', '5.7']
};

function main() {
  const files = fs.readdirSync(LESSONS_DIR).filter(f => f.endsWith('.lesson.json'));
  let totalCardsUpdated = 0;
  let totalPagesUpdated = 0;
  let totalFilesUpdated = 0;

  for (const file of files) {
    // Extract chapter number from filename (e.g., ch01.lesson.json or ch1.lesson.json)
    const match = file.match(/^ch0*(\d+)\.lesson\.json$/);
    if (!match) continue;

    const chapterNum = parseInt(match[1], 10);
    const priors = CHAPTER_OBJECTIVE_PRIOR[chapterNum];

    if (!priors || priors.length === 0) {
      console.log(`Skipping ${file} - no known objective priors for chapter ${chapterNum}.`);
      continue;
    }

    const filePath = path.join(LESSONS_DIR, file);
    const lesson = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    let fileUpdated = false;

    // Apply to lesson root
    if (!lesson.objectiveIds || lesson.objectiveIds.length === 0) {
      lesson.objectiveIds = [...priors];
      fileUpdated = true;
    }

    // Cascade down
    for (const mod of lesson.modules || []) {
      if (!mod.objectiveIds || mod.objectiveIds.length === 0) {
        mod.objectiveIds = [...priors];
        fileUpdated = true;
      }

      for (const page of mod.pages || []) {
        if (!page.objectiveIds || page.objectiveIds.length === 0) {
          page.objectiveIds = [...priors];
          totalPagesUpdated++;
          fileUpdated = true;
        }

        for (const card of page.cards || []) {
          // Overwrite or fill card objectiveIds
          if (!card.objectiveIds || card.objectiveIds.length === 0) {
            card.objectiveIds = [...priors];
            totalCardsUpdated++;
            fileUpdated = true;
          }
        }
      }
    }

    if (fileUpdated) {
      fs.writeFileSync(filePath, JSON.stringify(lesson, null, 2), 'utf8');
      totalFilesUpdated++;
      console.log(`✅ Mapped objectives [${priors.join(', ')}] to ${file}`);
    }
  }

  console.log(`\n🎉 Done! Mapped objectives across ${totalFilesUpdated} files (${totalPagesUpdated} pages, ${totalCardsUpdated} cards).`);
}

main();
