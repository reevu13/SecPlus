import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const cwd = process.cwd();
const packagePath = path.join(cwd, 'package.json');

if (!fs.existsSync(packagePath)) {
  console.error(`package.json not found at ${packagePath}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const scripts = pkg.scripts ?? {};

const requiredCommands = [
  { cmd: 'npm', args: ['run', 'policy:check'] },
  { cmd: 'npm', args: ['run', 'content:validate'], env: { CONTENT_STRICT: '1' } },
  { cmd: 'npm', args: ['run', 'content:quality'] },
  { cmd: 'npm', args: ['run', 'content:mapping-validate'] },
  { cmd: 'npm', args: ['run', 'coverage:check:strict:explicit'] },
  { cmd: 'npm', args: ['run', 'lint'] },
  { cmd: 'npx', args: ['tsc', '--noEmit'] },
  { cmd: 'npm', args: ['run', 'build'] }
];

function run({ cmd, args, env }) {
  const pretty = [cmd, ...args].join(' ');
  console.log(`\n> ${pretty}`);
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      ...(env ?? {})
    }
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

['policy:check', 'content:validate', 'content:quality', 'content:mapping-validate', 'coverage:check:strict:explicit'].forEach((name) => {
  if (!scripts[name]) {
    console.error(`Missing required script in package.json: ${name}`);
    process.exit(1);
  }
});

requiredCommands.forEach(run);

console.log('\nAll verification checks passed.');
