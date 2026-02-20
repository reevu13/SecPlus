import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

const CONTENT_ROOT = path.resolve(process.cwd(), 'content');

function isPathInsideRoot(root: string, candidate: string) {
  if (candidate === root) return true;
  const normalizedRoot = `${root}${path.sep}`;
  return candidate.startsWith(normalizedRoot);
}

export async function GET(
  _: Request,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const resolvedParams = await params;
  const parts = Array.isArray(resolvedParams.path) ? resolvedParams.path : [];
  const relPath = parts.join('/');
  if (!relPath || !relPath.endsWith('.json')) {
    return new NextResponse('Not found', { status: 404 });
  }

  const fullPath = path.resolve(CONTENT_ROOT, relPath);
  if (!isPathInsideRoot(CONTENT_ROOT, fullPath)) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return new NextResponse('Not found', { status: 404 });
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
