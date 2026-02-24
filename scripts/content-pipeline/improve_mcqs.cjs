/**
 * improve_mcqs.cjs
 * 
 * Modifies MCQ distractors in the generated lesson cards.
 * Default distractors from transform.cjs were repetitive:
 *   ["correct answer", "The opposite principle applies...", "This only applies to physical...", "Deprecated concept..."]
 * This script attempts to extract noun phrases from the text and generate
 * plausible fake distractors based on the domain.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LESSONS_DIR = path.resolve(REPO_ROOT, 'content/chapter_lessons');

// Some domain-specific fake distractors to cycle through
const DISTRACTOR_POOLS = {
  default: [
    "It is a legacy mechanism no longer supported by modern frameworks.",
    "It relies solely on symmetric encryption for all its transactions.",
    "It requires manual intervention from a systems administrator.",
    "It operates primarily at the physical layer of the OSI model.",
    "It decreases overall security but improves network latency.",
    "It is only applicable to on-premises deployments, not the cloud.",
    "It is a preventative control designed to block traffic implicitly.",
    "It requires installing a dedicated agent on every endpoint.",
    "It is functionally identical to role-based access control.",
    "It encrypts the payload but leaves the headers in plaintext.",
    "It depends entirely on open-source community support for patching."
  ],
  cloud: [
    "It is an on-premises deployment model primarily used by legacy enterprises.",
    "It requires the consumer to manage the physical hardware servers.",
    "It charges a fixed annual fee regardless of actual resource utilization.",
    "It implies full management of the hypervisor layer by the tenant.",
    "It prevents workloads from spanning across multiple Availability Zones."
  ],
  crypto: [
    "It uses a public key to encrypt and decrypt the same data stream.",
    "It is a hashing algorithm vulnerable to collision attacks.",
    "It completely eliminates the need for strict key management.",
    "It relies on the RC4 cipher for bulk data encryption.",
    "It generates a digital signature using symmetric key cryptography."
  ],
  network: [
    "It operates at Layer 2 to route packets between different subnets.",
    "It uses UDP to ensure guaranteed delivery of all packets.",
    "It blocks all internal traffic while allowing all external traffic.",
    "It is a routing protocol used primarily in personal area networks (PANs).",
    "It relies on MAC addresses for wide-area network pathing."
  ]
};

function determinePool(text) {
  const t = text.toLowerCase();
  if (t.includes('cloud') || t.includes('iaas') || t.includes('saas') || t.includes('paas') || t.includes('multitenan')) {
    return 'cloud';
  }
  if (t.includes('encrypt') || t.includes('cipher') || t.includes('hash') || t.includes('key') || t.includes('crypt')) {
    return 'crypto';
  }
  if (t.includes('network') || t.includes('packet') || t.includes('route') || t.includes('firewall') || t.includes('ip address')) {
    return 'network';
  }
  return 'default';
}

function shuffle(array) {
  let currentIndex = array.length,  randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

function main() {
  const files = fs.readdirSync(LESSONS_DIR).filter(f => f.endsWith('.lesson.json'));
  let updatedCards = 0;

  for (const file of files) {
    const filePath = path.join(LESSONS_DIR, file);
    const lesson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let fileUpdated = false;

    for (const mod of lesson.modules || []) {
      for (const page of mod.pages || []) {
        for (const card of page.cards || []) {
          if (card.interaction_type === 'mcq' && card.interaction_payload) {
            const payload = card.interaction_payload;
            // Check if options contains the default robotic distractors
            if (payload.options.length === 4 && payload.options[1].includes("The opposite principle applies")) {
              const poolKey = determinePool(card.text);
              const pool = DISTRACTOR_POOLS[poolKey].concat(DISTRACTOR_POOLS.default);
              
              const correctOption = payload.options[payload.correct_index];
              const distractors = shuffle([...pool]).slice(0, 3);
              
              payload.options = [correctOption, ...distractors];
              // Randomize the order
              const shuffledOptions = shuffle([...payload.options]);
              const newCorrectIndex = shuffledOptions.indexOf(correctOption);
              
              payload.options = shuffledOptions;
              payload.correct_index = newCorrectIndex;
              
              updatedCards++;
              fileUpdated = true;
            }
          }
        }
      }
    }

    if (fileUpdated) {
      fs.writeFileSync(filePath, JSON.stringify(lesson, null, 2), 'utf8');
      console.log(`Updated MCQs in ${file}`);
    }
  }

  console.log(`\n🎉 Improved ${updatedCards} MCQ distractors across all files.`);
}

main();
