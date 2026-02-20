import fs from 'fs';
import path from 'path';
import Ajv from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { ChapterPack, Mission, PackEnrichment, Question } from './types';
import { normalizePackObjectives } from './objectiveIds';
import { CONTENT_DIR, ENRICH_DIR } from './paths';

const SCHEMA_FILES = ['chapter_pack.v2.schema.json', 'chapter_pack.schema.json'];
const ENRICH_SCHEMA_FILE = 'chapter_enrichment.schema.json';
let cache: ChapterPack[] | null = null;
let validators: ValidateFunction[] | null = null;
let enrichmentValidator: ValidateFunction | null = null;
let enrichmentCache: Map<string, { data: PackEnrichment; file: string }> | null = null;

function comparePackOrder(a: ChapterPack, b: ChapterPack) {
  const chapterA = Number.isFinite(a.chapter?.number) ? a.chapter.number : Number.MAX_SAFE_INTEGER;
  const chapterB = Number.isFinite(b.chapter?.number) ? b.chapter.number : Number.MAX_SAFE_INTEGER;
  if (chapterA !== chapterB) return chapterA - chapterB;
  return a.pack_id.localeCompare(b.pack_id, undefined, { numeric: true, sensitivity: 'base' });
}

function getValidators() {
  if (validators) return validators;
  const ajv = new Ajv({ allErrors: true, strict: false });
  validators = SCHEMA_FILES
    .map((file) => {
      const schemaPath = path.join(CONTENT_DIR, file);
      if (!fs.existsSync(schemaPath)) return null;
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      return ajv.compile(schema);
    })
    .filter(Boolean) as ValidateFunction[];
  if (validators.length === 0) {
    throw new Error(`No pack schema found in ${CONTENT_DIR}`);
  }
  return validators;
}

function validatePack(pack: unknown) {
  const activeValidators = getValidators();
  for (const validate of activeValidators) {
    if (validate(pack)) {
      return { valid: true as const, errors: [] as string[] };
    }
  }
  const errors = activeValidators.flatMap((validate) =>
    (validate.errors ?? []).map((err) => `${err.instancePath || '/'} ${err.message}`)
  );
  return { valid: false as const, errors };
}

function getEnrichmentValidator() {
  if (enrichmentValidator) return enrichmentValidator;
  const schemaPath = path.join(ENRICH_DIR, ENRICH_SCHEMA_FILE);
  if (!fs.existsSync(schemaPath)) {
    console.warn(`Enrichment schema not found: ${schemaPath}`);
    enrichmentValidator = null;
    return null;
  }
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  enrichmentValidator = ajv.compile(schema);
  return enrichmentValidator;
}

function loadEnrichmentMap() {
  if (enrichmentCache) return enrichmentCache;
  const map = new Map<string, { data: PackEnrichment; file: string }>();
  if (!fs.existsSync(ENRICH_DIR)) {
    enrichmentCache = map;
    return map;
  }
  const files = fs.readdirSync(ENRICH_DIR).filter((file) => file.endsWith('.enrich.json'));
  const validate = getEnrichmentValidator();

  files.forEach((file) => {
    const fullPath = path.join(ENRICH_DIR, file);
    let raw: string;
    try {
      raw = fs.readFileSync(fullPath, 'utf8');
    } catch (err) {
      console.warn(`Failed to read enrichment ${file}:`, err);
      return;
    }
    let data: PackEnrichment & { pack_id?: string };
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.warn(`Failed to parse enrichment ${file}:`, err);
      return;
    }
    if (validate && !validate(data)) {
      const errors = validate.errors?.map((err) => `${err.instancePath || '/'} ${err.message}`).join('; ');
      console.warn(`Invalid enrichment ${file}: ${errors}`);
      return;
    }
    if (!data.pack_id) {
      console.warn(`Invalid enrichment ${file}: missing pack_id`);
      return;
    }
    map.set(data.pack_id, {
      data: {
        confusion_pairs: data.confusion_pairs ?? [],
        tag_rules: data.tag_rules ?? {}
      },
      file
    });
  });

  enrichmentCache = map;
  return map;
}

export function loadChapterPacks(): ChapterPack[] {
  if (cache) return cache;
  if (!fs.existsSync(CONTENT_DIR)) return [];
  const files = fs
    .readdirSync(CONTENT_DIR)
    .filter((file) => file.endsWith('.json') && !SCHEMA_FILES.includes(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  const enrichments = loadEnrichmentMap();
  const packs: ChapterPack[] = [];
  files.forEach((file) => {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8');
    let pack: ChapterPack;
    try {
      pack = JSON.parse(raw) as ChapterPack;
    } catch (err) {
      console.warn(`Failed to parse pack ${file}:`, err);
      return;
    }
    const validation = validatePack(pack);
    if (!validation.valid) {
      console.warn(`Invalid pack ${file}: ${validation.errors.join('; ')}`);
      return;
    }
    pack = normalizePackObjectives(pack);
    const enrichment = enrichments.get(pack.pack_id);
    if (enrichment) {
      const tagSet = new Set([
        ...pack.tags.concepts,
        ...pack.question_bank.flatMap((question) => question.tags ?? [])
      ]);
      Object.keys(enrichment.data.tag_rules).forEach((tagId) => {
        if (!tagSet.has(tagId)) {
          console.warn(`[enrichment] ${enrichment.file}: tag_rules references unknown tag '${tagId}' for pack ${pack.pack_id}`);
        }
      });
      pack.enrichment = enrichment.data;
    } else {
      pack.enrichment = { confusion_pairs: [], tag_rules: {} };
    }
    packs.push(pack);
  });
  packs.sort(comparePackOrder);
  cache = packs;
  return packs;
}

export function getPackById(packId: string) {
  return loadChapterPacks().find((pack) => pack.pack_id === packId);
}

export function findMission(missionId: string): { packId: string; packTitle: string; mission: Mission } | null {
  const packs = loadChapterPacks();
  for (const pack of packs) {
    const mission = pack.missions.find((m) => m.id === missionId);
    if (mission) return { packId: pack.pack_id, packTitle: pack.chapter.title, mission };
  }
  return null;
}

export function getQuestionById(packs: ChapterPack[], questionId: string): Question | null {
  for (const pack of packs) {
    const question = pack.question_bank.find((q) => q.id === questionId);
    if (question) return question;
  }
  return null;
}

export function buildQuestionMap(pack: ChapterPack) {
  const map = new Map<string, Question>();
  pack.question_bank.forEach((q) => map.set(q.id, q));
  return map;
}
