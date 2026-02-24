#!/usr/bin/env node
/**
 * extract.mjs — Phase 1: EPUB Content Extractor
 *
 * Reads the sybex.epub spine using ONLY Node.js built-ins (fs, zlib, Buffer).
 * No third-party npm dependencies required.
 *
 * Usage:
 *   node scripts/content-pipeline/extract.mjs
 *   node scripts/content-pipeline/extract.mjs \
 *       --epub content/source/sybex.epub \
 *       --out  scripts/content-pipeline/raw_chunks.json
 *
 * Output shape: RawChunk[]  (see typedef below)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { inflateRawSync } from 'zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ── CLI args ─────────────────────────────────────────────────────────────────

function getArg(flag, defaultVal) {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const EPUB_PATH = path.resolve(REPO_ROOT, getArg('--epub', 'content/source/sybex.epub'));
const OUT_PATH  = path.resolve(REPO_ROOT, getArg('--out', 'scripts/content-pipeline/raw_chunks.json'));

// ── Utilities ─────────────────────────────────────────────────────────────────

const WS_RE      = /\s+/g;
const CHAPTER_RE = /\bchapter\s*0*(\d{1,3})\b/i;
const CH_RE      = /\bch(?:apter)?[_\-\s]*0*(\d{1,3})\b/i;

function normalizeSpace(str) {
  return str.replace(WS_RE, ' ').trim();
}

function slugToTitle(href) {
  const stem = path.basename(href, path.extname(href));
  return stem.replace(/[_\-]+/g, ' ').trim() || href;
}

function inferChapterNumber(title, href, fallback) {
  for (const cand of [title, href]) {
    let m = CHAPTER_RE.exec(cand);
    if (m) return parseInt(m[1], 10);
    m = CH_RE.exec(cand);
    if (m) return parseInt(m[1], 10);
  }
  return fallback;
}

// ── Minimal ZIP reader (Node.js stdlib only) ──────────────────────────────────

function findEocd(buf) {
  // Scan backward for End-of-Central-Directory signature (0x06054b50)
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('EPUB: End-of-Central-Directory record not found');
}

/**
 * Read the ZIP central directory and return a Map<filename, entryInfo>.
 */
function readCentralDirectory(buf) {
  const eocd = findEocd(buf);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdSize   = buf.readUInt32LE(eocd + 12);
  const entries  = new Map();

  let pos = cdOffset;
  const cdEnd = cdOffset + cdSize;

  while (pos < cdEnd && pos + 46 <= buf.length) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break; // Central dir signature

    const method     = buf.readUInt16LE(pos + 10);
    const compSize   = buf.readUInt32LE(pos + 20);
    const uncompSize = buf.readUInt32LE(pos + 24);
    const nameLen    = buf.readUInt16LE(pos + 28);
    const extraLen   = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOff   = buf.readUInt32LE(pos + 42);
    const name       = buf.slice(pos + 46, pos + 46 + nameLen).toString('utf8');

    entries.set(name, { method, compSize, uncompSize, localOff });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf, entry) {
  const { localOff, compSize, method } = entry;
  if (buf.readUInt32LE(localOff) !== 0x04034b50) {
    throw new Error(`Bad local file header at offset ${localOff}`);
  }
  const localNameLen  = buf.readUInt16LE(localOff + 26);
  const localExtraLen = buf.readUInt16LE(localOff + 28);
  const dataStart     = localOff + 30 + localNameLen + localExtraLen;
  const data          = buf.slice(dataStart, dataStart + compSize);

  if (method === 0) return data;               // Stored
  if (method === 8) return inflateRawSync(data); // Deflate
  throw new Error(`Unsupported ZIP compression method: ${method}`);
}

function readEpubFile(buf, entries, archivePath) {
  let entry = entries.get(archivePath);
  if (!entry) {
    // Case-insensitive fallback
    const lower = archivePath.toLowerCase();
    for (const [k, v] of entries) {
      if (k.toLowerCase() === lower) { entry = v; break; }
    }
  }
  if (!entry) throw new Error(`Not found in EPUB: ${archivePath}`);
  return readEntry(buf, entry);
}

// ── Posix path helpers (for EPUB internal paths) ──────────────────────────────

function posixDirname(p) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

function posixNormalize(p) {
  const out = [];
  for (const part of p.split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}

function resolveEpubPath(opfDir, href) {
  return posixNormalize(opfDir ? `${opfDir}/${href}` : href);
}

// ── OPF parser (plain regex — no DOM lib needed) ──────────────────────────────

function extractAttr(tagContent, attrName) {
  const re = new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`, 'i');
  const m = re.exec(tagContent);
  return m ? m[1] : null;
}

function parseOPF(xml) {
  const manifest    = new Map(); // id → href
  const manifestMT  = new Map(); // id → mediaType
  const spineIds    = [];

  // Manifest items — handle both self-closing <item .../> and inline tags
  const itemRe = /<item\s([^>]+?)(?:\s*\/>|>)/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const id        = extractAttr(m[1], 'id');
    const href      = extractAttr(m[1], 'href');
    const mediaType = extractAttr(m[1], 'media-type') ?? '';
    if (id && href) { manifest.set(id, href); manifestMT.set(id, mediaType); }
  }

  // Spine itemrefs
  const itemrefRe = /<itemref\s([^>]+?)(?:\s*\/>|>)/gi;
  while ((m = itemrefRe.exec(xml)) !== null) {
    const idref = extractAttr(m[1], 'idref');
    if (idref) spineIds.push(idref);
  }

  return { manifest, manifestMT, spineIds };
}

// ── HTML → text → sections ────────────────────────────────────────────────────

/**
 * Strip HTML tags and decode entities.  Returns plain text.
 */
function stripTags(html) {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  // Preserve block-level whitespace
  t = t.replace(/<\/(p|li|dd|dt|blockquote|div|section|tr|td|th)>/gi, '\n');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<[^>]+>/g, '');
  // Entities
  t = t
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n)  => String.fromCharCode(parseInt(n, 10)))
    .replace(/&[a-z]{2,8};/gi, ' ');
  return t;
}

/**
 * Extract <p> and <li> text blocks from an HTML fragment.
 */
function extractParagraphs(html) {
  const results = [];
  const blockRe = /<(?:p|li|dd)([^>]*)>([\s\S]*?)<\/(?:p|li|dd)>/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const text = normalizeSpace(stripTags(m[2]));
    // Keep paragraphs that have meaningful content (≥ 30 chars, ≥ 4 words)
    if (text.length >= 30 && text.split(/\s+/).length >= 4) {
      results.push(text);
    }
  }
  return results;
}

/**
 * Split XHTML content into sections, one per heading element.
 * Returns SectionChunk[].
 */
function chunkByHeadings(html) {
  // Find all heading positions
  const headingRe = /<(h[1-6])([^>]*)>([\s\S]*?)<\/\1>/gi;
  const headings  = [];
  let m;
  while ((m = headingRe.exec(html)) !== null) {
    headings.push({
      level:    parseInt(m[1][1], 10),
      rawTitle: normalizeSpace(stripTags(m[3])),
      start:    m.index,
      end:      m.index + m[0].length,
    });
  }

  const sections = [];

  // Pre-heading content (level 0)
  const preEnd = headings.length > 0 ? headings[0].start : html.length;
  const preParagraphs = extractParagraphs(html.slice(0, preEnd));
  if (preParagraphs.length > 0) {
    sections.push({ title: '', level: 0, paragraphs: preParagraphs });
  }

  // One section per heading
  for (let i = 0; i < headings.length; i++) {
    const h        = headings[i];
    const title    = h.rawTitle;
    if (!title) continue;
    const bodyStart = h.end;
    const bodyEnd   = i + 1 < headings.length ? headings[i + 1].start : html.length;
    const body      = html.slice(bodyStart, bodyEnd);
    const paragraphs = extractParagraphs(body);
    sections.push({ title, level: h.level, paragraphs });
  }

  return sections;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(EPUB_PATH)) {
    console.error(`\nEPUB not found at: ${EPUB_PATH}`);
    console.error('Run from the repo root or pass --epub <path>.');
    process.exit(1);
  }

  console.log(`\n📖  Reading EPUB: ${EPUB_PATH}`);
  const epubBuf = fs.readFileSync(EPUB_PATH);
  console.log(`    Size: ${(epubBuf.length / 1024 / 1024).toFixed(1)} MB`);

  // Parse ZIP central directory
  const entries = readCentralDirectory(epubBuf);
  console.log(`    ZIP entries: ${entries.size}`);

  // Locate OPF
  const containerXml = readEpubFile(epubBuf, entries, 'META-INF/container.xml').toString('utf8');
  const rootfileMatch = /full-path\s*=\s*["']([^"']+)["']/i.exec(containerXml);
  if (!rootfileMatch) throw new Error('container.xml: cannot locate rootfile full-path');
  const opfPath = rootfileMatch[1];
  const opfDir  = posixDirname(opfPath);
  console.log(`    OPF: ${opfPath}  (base dir: "${opfDir}")`);

  // Parse OPF → manifest + spine
  const opfXml = readEpubFile(epubBuf, entries, opfPath).toString('utf8');
  const { manifest, manifestMT, spineIds } = parseOPF(opfXml);
  console.log(`    Manifest items: ${manifest.size}   Spine items: ${spineIds.length}`);

  // Walk spine and extract text chunks
  const chunks   = [];
  let   docOrder = 0;
  const seenHrefs = new Set();

  for (const spineId of spineIds) {
    const href = manifest.get(spineId);
    if (!href) continue;

    const mt = manifestMT.get(spineId) ?? '';
    if (!mt.includes('html') && !mt.includes('xhtml')) continue;
    if (seenHrefs.has(href)) continue;
    seenHrefs.add(href);

    const archivePath = resolveEpubPath(opfDir, href);
    let html;
    try {
      html = readEpubFile(epubBuf, entries, archivePath).toString('utf8');
    } catch (err) {
      console.warn(`  [SKIP] ${archivePath}: ${err.message}`);
      continue;
    }

    // Skip trivially short pages (TOC, blanks, etc.)
    const rawText = stripTags(html);
    if (normalizeSpace(rawText).length < 300) continue;

    docOrder++;

    // Chapter title: prefer first h1/h2 in document
    const h1Match = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(html);
    const chapterTitle = h1Match
      ? normalizeSpace(stripTags(h1Match[1]))
      : slugToTitle(href);
    const chapterNumber = inferChapterNumber(chapterTitle, href, docOrder);

    const sections = chunkByHeadings(html);
    for (let si = 0; si < sections.length; si++) {
      const sect = sections[si];
      const wordCount = sect.paragraphs.join(' ').split(/\s+/).filter(Boolean).length;
      // Skip sections with no extractable paragraphs
      if (sect.paragraphs.length === 0) continue;

      /** @type {RawChunk} */
      chunks.push({
        chapterOrder: docOrder,
        chapterHref:  href,
        chapterTitle,
        chapterNumber,
        sectionOrder: si,
        sectionTitle: sect.title,
        headingLevel: sect.level,
        paragraphs:   sect.paragraphs,
        wordCount,
      });
    }

    process.stdout.write(
      `\r  [${String(docOrder).padStart(3, '0')}] ${chapterTitle.slice(0, 55).padEnd(55)} ` +
      `sections: ${sections.length}`
    );
  }

  console.log(`\n\n✅  Extracted ${chunks.length} section chunks from ${docOrder} spine documents.`);

  // Write output
  const outDir = path.dirname(OUT_PATH);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(chunks, null, 2), 'utf8');
  console.log(`💾  Saved → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('\n\n❌  Extraction failed:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

/**
 * @typedef {Object} RawChunk
 * @property {number}   chapterOrder   - 1-indexed spine document position
 * @property {string}   chapterHref    - EPUB-internal href of the spine item
 * @property {string}   chapterTitle   - Chapter-level title (h1/h2 or slug)
 * @property {number}   chapterNumber  - Inferred numeric chapter (0 = non-chapter)
 * @property {number}   sectionOrder   - Section index within this chapter
 * @property {string}   sectionTitle   - Heading text (empty string = pre-heading)
 * @property {number}   headingLevel   - 1-6 (0 = pre-heading content)
 * @property {string[]} paragraphs     - Cleaned plain-text paragraph strings
 * @property {number}   wordCount      - Approximate word count
 */
