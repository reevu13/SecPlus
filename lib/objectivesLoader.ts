import fs from 'fs';
import path from 'path';
import Ajv from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { ExamObjectivesDoc } from './types';
import { OBJECTIVES_DIR } from './paths';

const OBJECTIVES_FILE = 'sy0-701.objectives.json';
const OBJECTIVES_SCHEMA_FILE = 'sy0-701.objectives.schema.json';

let cache: ExamObjectivesDoc | null = null;
let validator: ValidateFunction | null = null;

function getValidator() {
  if (validator) return validator;
  const schemaPath = path.join(OBJECTIVES_DIR, OBJECTIVES_SCHEMA_FILE);
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Objectives schema not found: ${schemaPath}`);
  }
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  validator = ajv.compile(schema);
  return validator;
}

export function loadObjectivesDoc() {
  if (cache) return cache;
  const fullPath = path.join(OBJECTIVES_DIR, OBJECTIVES_FILE);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Objectives file not found: ${fullPath}`);
  }
  const raw = fs.readFileSync(fullPath, 'utf8');
  const parsed = JSON.parse(raw) as ExamObjectivesDoc;
  const validate = getValidator();
  if (!validate(parsed)) {
    const errors = (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    throw new Error(`Invalid objectives file: ${errors}`);
  }
  cache = parsed;
  return parsed;
}
