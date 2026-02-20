import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const cwd = process.cwd();
const contentDir = path.join(cwd, 'content');

const disallowedExtractionDirs = [
  'content/_source_text',
  'content/_extract_tmp',
  'content/_epub_extract',
  'content/source_extracted',
  'content/tmp',
  'content/_tmp'
];

const authoredContentRoots = [
  'content/chapter_packs',
  'content/chapter_lessons',
  'content/chapter_enrichment',
  'content/mappings',
  'content/objectives'
];

const supportedTextExtensions = new Set(['.json', '.md', '.txt', '.yaml', '.yml']);

const suspiciousFindings = [];
const policyErrors = [];

function isProbablyText(raw) {
  if (raw.length === 0) return true;
  const sample = raw.subarray(0, Math.min(raw.length, 2048));
  let nonPrintable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte >= 32 && byte <= 126) continue;
    if (byte >= 128) continue;
    nonPrintable += 1;
  }
  return nonPrintable / sample.length < 0.1;
}

function walkFiles(dirPath, callback) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, callback);
      return;
    }
    callback(fullPath);
  });
}

function wordCount(text) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  return parts.length;
}

function looksLikePastedBookText(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const chars = trimmed.length;
  const words = wordCount(trimmed);
  const lines = trimmed.split('\n').length;
  if (words >= 900) return true;
  if (chars >= 2500 && words >= 380) return true;
  if (lines >= 80 && words >= 500) return true;
  return false;
}

function recordSuspicious(filePath, dataPath, value) {
  if (!looksLikePastedBookText(value)) return;
  suspiciousFindings.push({
    file: path.relative(cwd, filePath),
    path: dataPath,
    chars: value.trim().length,
    words: wordCount(value)
  });
}

function scanJsonNode(filePath, node, currentPath = '$') {
  if (typeof node === 'string') {
    recordSuspicious(filePath, currentPath, node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => scanJsonNode(filePath, item, `${currentPath}[${index}]`));
    return;
  }
  if (node && typeof node === 'object') {
    Object.entries(node).forEach(([key, value]) => {
      scanJsonNode(filePath, value, `${currentPath}.${key}`);
    });
  }
}

function scanAuthoredContent() {
  authoredContentRoots.forEach((relativeRoot) => {
    const absoluteRoot = path.join(cwd, relativeRoot);
    walkFiles(absoluteRoot, (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (!supportedTextExtensions.has(ext)) return;
      const raw = fs.readFileSync(filePath);
      if (!isProbablyText(raw)) return;
      const text = raw.toString('utf8');

      if (ext === '.json') {
        try {
          const parsed = JSON.parse(text);
          scanJsonNode(filePath, parsed);
          return;
        } catch {
          // Fall back to whole-file check for malformed JSON.
        }
      }
      recordSuspicious(filePath, '$', text);
    });
  });
}

function checkDisallowedExtractionDirs() {
  disallowedExtractionDirs.forEach((relativeDir) => {
    const absoluteDir = path.join(cwd, relativeDir);
    if (!fs.existsSync(absoluteDir)) return;
    let fileCount = 0;
    walkFiles(absoluteDir, () => {
      fileCount += 1;
    });
    if (fileCount > 0) {
      policyErrors.push(`${relativeDir} contains extracted text artifacts (${fileCount} file(s)).`);
    }
  });
}

function checkTrackedEpubFiles() {
  const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8'
  });
  if (rootResult.status !== 0) {
    policyErrors.push('Unable to resolve git repository root for tracked-file checks.');
    return;
  }
  const gitRoot = rootResult.stdout.trim();
  const relativeCwd = path.relative(gitRoot, cwd).split(path.sep).filter(Boolean).join('/');
  const sourceRoot = relativeCwd ? `${relativeCwd}/content/source` : 'content/source';
  const prefix = `${sourceRoot}/`;

  const listResult = spawnSync('git', ['ls-files', '--', sourceRoot], {
    cwd: gitRoot,
    encoding: 'utf8'
  });
  if (listResult.status !== 0) {
    policyErrors.push('Unable to list tracked files for EPUB policy checks.');
    return;
  }

  const trackedEpub = listResult.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => file.startsWith(prefix) && file.toLowerCase().endsWith('.epub'));

  if (trackedEpub.length > 0) {
    policyErrors.push(
      `Tracked EPUB files found under content/source/: ${trackedEpub.join(', ')}`
    );
  }
}

if (!fs.existsSync(contentDir)) {
  console.error(`Missing content directory: ${contentDir}`);
  process.exit(1);
}

checkDisallowedExtractionDirs();
checkTrackedEpubFiles();
scanAuthoredContent();

if (suspiciousFindings.length > 0) {
  const lines = suspiciousFindings
    .slice(0, 25)
    .map((finding) => `${finding.file} at ${finding.path} (chars=${finding.chars}, words=${finding.words})`);
  policyErrors.push(
    `Suspiciously large text blocks detected in authored content:\n  - ${lines.join('\n  - ')}`
  );
}

if (policyErrors.length > 0) {
  console.error('Content policy check failed:');
  policyErrors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('Content policy check passed.');
