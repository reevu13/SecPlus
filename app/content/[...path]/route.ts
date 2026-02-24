import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

const CONTENT_ROOT = path.resolve(process.cwd(), 'content');

/** Allowed first-level subdirectories under content/. */
const ALLOWED_SUBDIRS = new Set([
  'chapter_lessons',
  'chapter_packs',
  'enrichment',
  '_source_outline',
  'objectives',
  'outline_map',
]);

const NOT_FOUND = new NextResponse('Not found', { status: 404 });

/**
 * Defence-in-depth path traversal guard:
 *   1. Reject null bytes (poison-null attacks)
 *   2. Reject ".." segments before path.resolve can normalize them
 *   3. Reject segments with backslashes (Windows alt separator)
 *   4. Allowlist first path segment to known subdirectories
 *   5. Verify the resolved path is still under CONTENT_ROOT
 *   6. Use fs.realpathSync to resolve symlinks before the root check
 */
function isSafePath(parts: string[]): boolean {
  // 1. Null byte check
  if (parts.some((p) => p.includes('\0'))) return false;
  // 2. Traversal segment check (before path.resolve)
  if (parts.some((p) => p === '..' || p === '.' || p.includes('..'))) return false;
  // 3. Reject backslashes
  if (parts.some((p) => p.includes('\\'))) return false;
  // 4. Subdirectory allowlist
  if (parts.length === 0 || !ALLOWED_SUBDIRS.has(parts[0])) return false;
  return true;
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate === root || candidate.startsWith(normalizedRoot);
}

export async function GET(
  _: Request,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const resolvedParams = await params;
  const parts = Array.isArray(resolvedParams.path) ? resolvedParams.path : [];
  const relPath = parts.join('/');

  // Only serve .json files
  if (!relPath || !relPath.endsWith('.json')) return NOT_FOUND;

  // Pre-resolve safety checks
  if (!isSafePath(parts)) return NOT_FOUND;

  const fullPath = path.resolve(CONTENT_ROOT, relPath);

  // Post-resolve containment check
  if (!isPathInsideRoot(CONTENT_ROOT, fullPath)) return NOT_FOUND;

  // Existence + file check
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return NOT_FOUND;

  // Resolve symlinks and re-check containment
  try {
    const realPath = fs.realpathSync(fullPath);
    if (!isPathInsideRoot(CONTENT_ROOT, realPath)) return NOT_FOUND;
  } catch {
    return NOT_FOUND;
  }

  const data = fs.readFileSync(fullPath, 'utf8');
  return new NextResponse(data, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}
