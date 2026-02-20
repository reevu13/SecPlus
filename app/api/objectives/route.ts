import { NextResponse } from 'next/server';
import { loadObjectivesDoc } from '@/lib/objectivesLoader';

export const dynamic = 'force-dynamic';

export async function GET() {
  const objectives = loadObjectivesDoc();
  return NextResponse.json({ objectives });
}
