import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);
const generatedSegments = new Set(['node_modules', 'dist', 'coverage', '.angular']);
const omittedProductSegments = new Set(['mobile', 'courses', 'course', 'repertoire', 'training']);
const violations = [];

for (const file of tracked) {
  const segments = file.split('/');
  if (segments.some((segment) => generatedSegments.has(segment))) {
    violations.push(`${file}: generated/vendor content must not be committed`);
  }
  if (/^\.env(?:\..+)?$/.test(path.posix.basename(file)) && path.posix.basename(file) !== '.env.example') {
    violations.push(`${file}: environment secrets/config must not be committed`);
  }
  if (segments[0] === 'apps' && segments.some((segment) => omittedProductSegments.has(segment.toLowerCase()))) {
    violations.push(`${file}: CRT mobile/course/repertoire/training product breadth is out of scope`);
  }
}

if (violations.length > 0) {
  console.error('Repository hygiene violations:\n' + violations.map((value) => `- ${value}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Repository hygiene checks passed.');
}
