#!/usr/bin/env node
/**
 * extract.cjs — Phase 1: EPUB Content Extractor (CommonJS)
 *
 * Zero-dependency EPUB reader using Node.js builtins.
 * Reads the spine, extracts text per heading section.
 *
 * Usage:
 *   node scripts/content-pipeline/extract.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { inflateRawSync } = require('zlib');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EPUB_PATH = path.resolve(REPO_ROOT, 'content/source/sybex.epub');
const OUT_PATH  = path.resolve(REPO_ROOT, 'scripts/content-pipeline/raw_chunks.json');

// ── Utilities ─────────────────────────────────────────────────────────────────
const WS_RE      = /\s+/g;
const CHAPTER_RE = /\bchapter\s*0*(\d{1,3})\b/i;
const CH_RE      = /\bch(?:apter)?[_\-\s]*0*(\d{1,3})\b/i;

function normalizeSpace(str) { return str.replace(WS_RE, ' ').trim(); }

function inferChapterNumber(title, href, fallback) {
  for (const c of [title, href]) {
    let m = CHAPTER_RE.exec(c); if (m) return parseInt(m[1], 10);
    m = CH_RE.exec(c); if (m) return parseInt(m[1], 10);
  }
  return fallback;
}

function slugToTitle(href) {
  return path.basename(href, path.extname(href)).replace(/[_\-]+/g, ' ').trim() || href;
}

// ── ZIP reader ────────────────────────────────────────────────────────────────
function findEocd(buf) {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  throw new Error('No EOCD');
}

function readCentralDirectory(buf) {
  const eocd = findEocd(buf);
  const cdOff = buf.readUInt32LE(eocd + 16);
  const cdSz  = buf.readUInt32LE(eocd + 12);
  const entries = new Map();
  let pos = cdOff;
  while (pos < cdOff + cdSz && pos + 46 <= buf.length) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method  = buf.readUInt16LE(pos + 10);
    const compSz  = buf.readUInt32LE(pos + 20);
    const localOff = buf.readUInt32LE(pos + 42);
    const nameLen  = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    entries.set(buf.slice(pos + 46, pos + 46 + nameLen).toString('utf8'),
                { method, compSz, localOff });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf, entry) {
  const { localOff, compSz, method } = entry;
  const nameLen  = buf.readUInt16LE(localOff + 26);
  const extraLen = buf.readUInt16LE(localOff + 28);
  const data = buf.slice(localOff + 30 + nameLen + extraLen,
                         localOff + 30 + nameLen + extraLen + compSz);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  throw new Error('Unsupported ZIP method: ' + method);
}

function readEpubFile(buf, entries, archivePath) {
  let entry = entries.get(archivePath);
  if (!entry) {
    const lower = archivePath.toLowerCase();
    for (const [k, v] of entries) { if (k.toLowerCase() === lower) { entry = v; break; } }
  }
  if (!entry) throw new Error('Not found: ' + archivePath);
  return readEntry(buf, entry);
}

// ── OPF parser ────────────────────────────────────────────────────────────────
function parseOPF(xml) {
  const manifest = new Map(), manifestMT = new Map(), spineIds = [];
  let m;
  const itemRe = /<item\s([^>]+?)(?:\s*\/>|>)/gi;
  while ((m = itemRe.exec(xml)) !== null) {
    const id  = (/id\s*=\s*["']([^"']+)["']/i.exec(m[1]) || [])[1];
    const href = (/href\s*=\s*["']([^"']+)["']/i.exec(m[1]) || [])[1];
    const mt  = (/media-type\s*=\s*["']([^"']+)["']/i.exec(m[1]) || [])[1] || '';
    if (id && href) { manifest.set(id, href); manifestMT.set(id, mt); }
  }
  const spineRe = /<itemref\s([^>]+?)(?:\s*\/>|>)/gi;
  while ((m = spineRe.exec(xml)) !== null) {
    const idref = (/idref\s*=\s*["']([^"']+)["']/i.exec(m[1]) || [])[1];
    if (idref) spineIds.push(idref);
  }
  return { manifest, manifestMT, spineIds };
}

// ── HTML text extraction ──────────────────────────────────────────────────────
function stripTags(html) {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
              .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<\/(p|li|dd|dt|blockquote|div|section|tr|td|th)>/gi, '\n');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
       .replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g,' ')
       .replace(/&#x([0-9a-f]+);/gi, (_,h) => String.fromCharCode(parseInt(h,16)))
       .replace(/&#(\d+);/g, (_,n) => String.fromCharCode(parseInt(n,10)))
       .replace(/&[a-z]{2,8};/gi, ' ');
  return t;
}

function extractParagraphs(html) {
  const results = [];
  const re = /<(?:p|li|dd)([^>]*)>([\s\S]*?)<\/(?:p|li|dd)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = normalizeSpace(stripTags(m[2]));
    if (text.length >= 30 && text.split(/\s+/).length >= 4) results.push(text);
  }
  return results;
}

function chunkByHeadings(html) {
  const headingRe = /<(h[1-6])([^>]*)>([\s\S]*?)<\/\1>/gi;
  const headings = [];
  let m;
  while ((m = headingRe.exec(html)) !== null) {
    headings.push({
      level: parseInt(m[1][1], 10),
      rawTitle: normalizeSpace(stripTags(m[3])),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  const sections = [];
  const preEnd = headings.length > 0 ? headings[0].start : html.length;
  const preParagraphs = extractParagraphs(html.slice(0, preEnd));
  if (preParagraphs.length > 0) sections.push({ title: '', level: 0, paragraphs: preParagraphs });
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    if (!h.rawTitle) continue;
    const bodyEnd = i + 1 < headings.length ? headings[i + 1].start : html.length;
    const paras = extractParagraphs(html.slice(h.end, bodyEnd));
    sections.push({ title: h.rawTitle, level: h.level, paragraphs: paras });
  }
  return sections;
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(EPUB_PATH)) { console.error('EPUB not found:', EPUB_PATH); process.exit(1); }
  console.log('📖  Reading EPUB:', EPUB_PATH);
  const buf = fs.readFileSync(EPUB_PATH);
  console.log('    Size:', (buf.length / 1024 / 1024).toFixed(1), 'MB');

  const entries = readCentralDirectory(buf);
  console.log('    ZIP entries:', entries.size);

  const containerXml = readEpubFile(buf, entries, 'META-INF/container.xml').toString('utf8');
  const opfMatch = /full-path\s*=\s*["']([^"']+)["']/i.exec(containerXml);
  if (!opfMatch) throw new Error('Cannot find OPF path');
  const opfPath = opfMatch[1];
  const opfDir  = path.posix.dirname(opfPath);
  console.log('    OPF:', opfPath);

  const opfXml = readEpubFile(buf, entries, opfPath).toString('utf8');
  const { manifest, manifestMT, spineIds } = parseOPF(opfXml);
  console.log('    Spine items:', spineIds.length);

  const chunks = [];
  let docOrder = 0;
  const seenHrefs = new Set();

  for (const sid of spineIds) {
    const href = manifest.get(sid);
    if (!href) continue;
    const mt = manifestMT.get(sid) || '';
    if (!mt.includes('html') && !mt.includes('xhtml')) continue;
    if (seenHrefs.has(href)) continue;
    seenHrefs.add(href);

    const archivePath = path.posix.normalize(opfDir ? opfDir + '/' + href : href);
    let html;
    try { html = readEpubFile(buf, entries, archivePath).toString('utf8'); }
    catch (err) { console.warn('  [SKIP]', archivePath, err.message); continue; }

    const rawText = stripTags(html);
    if (normalizeSpace(rawText).length < 300) continue;

    docOrder++;
    const h1Match = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(html);
    const chapterTitle = h1Match ? normalizeSpace(stripTags(h1Match[1])) : slugToTitle(href);
    const chapterNumber = inferChapterNumber(chapterTitle, href, docOrder);

    const sections = chunkByHeadings(html);
    for (let si = 0; si < sections.length; si++) {
      const sect = sections[si];
      if (sect.paragraphs.length === 0) continue;
      const wordCount = sect.paragraphs.join(' ').split(/\s+/).filter(Boolean).length;
      chunks.push({
        chapterOrder: docOrder, chapterHref: href, chapterTitle, chapterNumber,
        sectionOrder: si, sectionTitle: sect.title, headingLevel: sect.level,
        paragraphs: sect.paragraphs, wordCount,
      });
    }
    process.stdout.write('\r  [' + String(docOrder).padStart(3, '0') + '] ' +
      chapterTitle.slice(0, 55).padEnd(55) + ' sections: ' + sections.length);
  }

  console.log('\n\n✅  Extracted', chunks.length, 'section chunks from', docOrder, 'spine docs.');
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(chunks, null, 2), 'utf8');
  console.log('💾  Saved →', OUT_PATH);
}

main();
