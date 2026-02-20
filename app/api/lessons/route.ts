import { NextResponse } from 'next/server';
import fs from 'fs';
import { loadChapterLessons } from '@/lib/lessonLoader';
import { LESSON_DIR } from '@/lib/paths';

export const dynamic = 'force-dynamic';

export async function GET() {
  const lessons = loadChapterLessons();
  const lessonFiles = fs.existsSync(LESSON_DIR)
    ? fs.readdirSync(LESSON_DIR).filter((file) => file.endsWith('.lesson.json'))
    : [];
  return NextResponse.json({ lessons, lesson_files: lessonFiles });
}
