import { spawn, spawnSync } from 'child_process';

const cwd = process.cwd();
const port = Number.parseInt(process.env.SMOKE_PORT || '4317', 10);
const host = '127.0.0.1';
const baseUrl = `http://${host}:${port}`;
const crashMarkers = [
  'Application error',
  'Unhandled Runtime Error',
  'Unhandled',
  '__next_error__',
  'ReferenceError:',
  'TypeError:'
];

function runSync(cmd, args) {
  const pretty = [cmd, ...args].join(' ');
  console.log(`\n> ${pretty}`);
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: false
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(maxAttempts = 80) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(`${baseUrl}/map`, { redirect: 'follow' });
      if (res.ok) return;
    } catch {
      // ignore and retry
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for server at ${baseUrl}`);
}

function hasCrashMarker(html) {
  const lower = html.toLowerCase();
  return crashMarkers.find((marker) => lower.includes(marker.toLowerCase())) ?? null;
}

function firstLines(text, lineCount = 20) {
  return text.split('\n').slice(0, lineCount).join('\n');
}

async function fetchJson(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url} (${res.status})`);
  }
  return res.json();
}

function buildRoutesFromContent(payload) {
  const packs = Array.isArray(payload.packs) ? payload.packs : [];
  const lessons = Array.isArray(payload.lessons) ? payload.lessons : [];
  const chapterIds = new Set();
  const missionIds = new Set();

  packs.forEach((pack) => {
    if (typeof pack?.pack_id === 'string' && pack.pack_id.trim()) {
      chapterIds.add(pack.pack_id.trim());
    }
    const missions = Array.isArray(pack?.missions) ? pack.missions : [];
    missions.forEach((mission) => {
      if (typeof mission?.id === 'string' && mission.id.trim()) {
        missionIds.add(mission.id.trim());
      }
    });
  });

  lessons.forEach((lesson) => {
    if (typeof lesson?.pack_id === 'string' && lesson.pack_id.trim()) {
      chapterIds.add(lesson.pack_id.trim());
    }
  });

  const routes = [
    '/map',
    '/review',
    '/ops/coverage',
    '/ops/mapping',
    '/ops/objective-backfill'
  ];

  [...chapterIds]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .forEach((id) => routes.push(`/chapter/${encodeURIComponent(id)}`));

  [...missionIds]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .forEach((id) => routes.push(`/mission/${encodeURIComponent(id)}`));

  return [...new Set(routes)];
}

async function runSmoke() {
  runSync('npm', ['run', 'build']);

  console.log(`\n> npx next start -p ${port} -H ${host}`);
  const server = spawn('npx', ['next', 'start', '-p', String(port), '-H', host], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  });

  server.stdout.on('data', (chunk) => process.stdout.write(chunk));
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));

  let failedRoutes = [];

  try {
    await waitForServer();

    // Route list is derived from API responses so it uses the existing loader stack.
    const [packPayload, lessonPayload] = await Promise.all([
      fetchJson(`${baseUrl}/api/packs`),
      fetchJson(`${baseUrl}/api/lessons`)
    ]);
    const routes = buildRoutesFromContent({
      packs: packPayload.packs ?? [],
      lessons: lessonPayload.lessons ?? []
    });

    const results = [];
    for (const route of routes) {
      const url = `${baseUrl}${route}`;
      let status = 0;
      let html = '';
      let marker = null;
      let error = null;

      try {
        const res = await fetch(url, { redirect: 'follow' });
        status = res.status;
        html = await res.text();
        marker = hasCrashMarker(html);
      } catch (err) {
        error = (err instanceof Error ? err.message : String(err));
      }

      const passed = !error && status === 200 && !marker;
      results.push({ route, status, passed });
      if (!passed) {
        failedRoutes.push({
          route,
          status,
          error,
          marker,
          preview: firstLines(html)
        });
      }
    }

    const passedCount = results.filter((row) => row.passed).length;
    const totalCount = results.length;
    const failedCount = totalCount - passedCount;

    console.log('\nRoute smoke summary');
    console.table([
      {
        total_routes: totalCount,
        passed: passedCount,
        failed: failedCount,
        port
      }
    ]);

    if (failedCount > 0) {
      console.log('\nFailed routes:');
      failedRoutes.forEach((failed, index) => {
        console.log(`\n${index + 1}. ${failed.route} (status=${failed.status})`);
        if (failed.error) console.log(`Error: ${failed.error}`);
        if (failed.marker) console.log(`Crash marker: ${failed.marker}`);
        if (failed.preview) {
          console.log('Response preview (first 20 lines):');
          console.log(failed.preview);
        }
      });
      process.exit(1);
    }

    console.log('All chapter-related routes passed smoke checks.');
  } finally {
    if (!server.killed) {
      server.kill('SIGTERM');
    }
    await new Promise((resolve) => {
      server.once('close', () => resolve());
      setTimeout(() => resolve(), 1500);
    });
  }
}

runSmoke().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
