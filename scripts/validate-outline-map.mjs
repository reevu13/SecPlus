import fs from 'fs';
import path from 'path';
import Ajv from 'ajv/dist/2020.js';

const cwd = process.cwd();
const mappingsDir = path.join(cwd, 'content', 'mappings');
const schemaPath = path.join(mappingsDir, 'outline_map.schema.json');
const mapPath = path.join(mappingsDir, 'outline_map.json');

function formatAjvError(error) {
  let pathPart = error.instancePath || '';
  if (error.keyword === 'required' && error.params?.missingProperty) {
    pathPart += `/${error.params.missingProperty}`;
  }
  return `${pathPart || '/'}: ${error.message}`;
}

if (!fs.existsSync(schemaPath)) {
  console.error(`Mapping schema not found: ${schemaPath}`);
  process.exit(1);
}

if (!fs.existsSync(mapPath)) {
  console.error(`Mapping file not found: ${mapPath}`);
  process.exit(1);
}

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
let mapDoc;
try {
  mapDoc = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
} catch (err) {
  console.error(`outline_map.json is not valid JSON: ${err.message}`);
  process.exit(1);
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);
const valid = validate(mapDoc);

const errors = [];
if (!valid) {
  (validate.errors ?? []).forEach((error) => errors.push(formatAjvError(error)));
}

if (valid && Array.isArray(mapDoc.entries)) {
  const seen = new Set();
  mapDoc.entries.forEach((entry, index) => {
    const key = entry?.outlineId;
    if (typeof key !== 'string') return;
    if (seen.has(key)) {
      errors.push(`/entries/${index}/outlineId: duplicate outlineId '${key}'`);
      return;
    }
    seen.add(key);
  });
}

if (errors.length > 0) {
  console.error('outline_map.json failed validation:');
  errors.forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}

const entryCount = Array.isArray(mapDoc.entries) ? mapDoc.entries.length : 0;
console.log(`Mapping file valid (${entryCount} entr${entryCount === 1 ? 'y' : 'ies'}).`);
