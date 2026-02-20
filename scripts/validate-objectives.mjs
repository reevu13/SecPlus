import fs from 'fs';
import path from 'path';
import Ajv from 'ajv/dist/2020.js';

const cwd = process.cwd();
const objectivesDir = path.join(cwd, 'content', 'objectives');
const schemaPath = path.join(objectivesDir, 'sy0-701.objectives.schema.json');
const filePath = path.join(objectivesDir, 'sy0-701.objectives.json');

if (!fs.existsSync(schemaPath)) {
  console.error(`Schema not found: ${schemaPath}`);
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`Objectives file not found: ${filePath}`);
  process.exit(1);
}

function formatAjvError(error) {
  let pathPart = error.instancePath || '';
  if (error.keyword === 'required' && error.params?.missingProperty) {
    pathPart += `/${error.params.missingProperty}`;
  }
  return `${pathPart || '/'}: ${error.message}`;
}

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
if (!validate(data)) {
  console.error('\nsy0-701.objectives.json');
  (validate.errors ?? []).forEach((error) => {
    console.error(`  - ${formatAjvError(error)}`);
  });
  process.exit(1);
}

console.log('Objectives file valid.');
