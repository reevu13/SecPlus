import { NextResponse } from 'next/server';
import fs from 'fs';
import { loadChapterPacks } from '@/lib/packLoader';
import { CONTENT_DIR, ENRICH_DIR } from '@/lib/paths';

export const dynamic = 'force-dynamic';

export async function GET() {
  const packs = loadChapterPacks();
  const schemaFiles = new Set(['chapter_pack.schema.json', 'chapter_pack.v2.schema.json']);
  const packFiles = fs.existsSync(CONTENT_DIR)
    ? fs.readdirSync(CONTENT_DIR).filter((file) => file.endsWith('.json') && !schemaFiles.has(file))
    : [];
  const enrichmentFiles = fs.existsSync(ENRICH_DIR)
    ? fs.readdirSync(ENRICH_DIR).filter((file) => file.endsWith('.enrich.json'))
    : [];
  const compare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  return NextResponse.json({
    packs,
    pack_files: packFiles.sort(compare),
    enrichment_files: enrichmentFiles.sort(compare)
  });
}
