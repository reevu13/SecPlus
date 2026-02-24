#!/usr/bin/env node
/**
 * inherit_objectives.cjs
 * 
 * Maps objectiveIds from parent LessonPages down to child LessonCards.
 * This ensures the Adaptive Coach can route users to the generated interactive cards.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LESSONS_DIR = path.resolve(REPO_ROOT, 'content/chapter_lessons');

function main() {
  const files = fs.readdirSync(LESSONS_DIR).filter(f => f.endsWith('.lesson.json'));
  let totalCardsUpdated = 0;
  let totalPagesWithObjectives = 0;

  for (const file of files) {
    const filePath = path.join(LESSONS_DIR, file);
    const lesson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let fileUpdated = false;

    for (const mod of lesson.modules || []) {
      for (const page of mod.pages || []) {
        // Did the page have objectiveIds?
        if (page.objectiveIds && page.objectiveIds.length > 0) {
          totalPagesWithObjectives++;
          
          for (const card of page.cards || []) {
            // Apply page objectives to card if card doesn't already have them
            if (!card.objectiveIds || card.objectiveIds.length === 0) {
              card.objectiveIds = [...page.objectiveIds];
              totalCardsUpdated++;
              fileUpdated = true;
            }
          }
        }
      }
    }

    if (fileUpdated) {
      fs.writeFileSync(filePath, JSON.stringify(lesson, null, 2), 'utf8');
      console.log(`Updated ${file} with inherited objectives.`);
    }
  }

  console.log(`\n🎉 Done! Inherited objectives from ${totalPagesWithObjectives} pages to ${totalCardsUpdated} child cards.`);
}

main();
