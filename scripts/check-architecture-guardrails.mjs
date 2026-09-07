import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceExtensions = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);

async function sourceFiles(directory) {
  const absolute = path.join(root, directory);
  const entries = await readdir(absolute, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(relative));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(relative);
  }
  return files;
}

function importedSpecifiers(content) {
  return [...content.matchAll(/(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

const violations = [];

for (const file of await sourceFiles('packages/chess-domain')) {
  const imports = importedSpecifiers(await readFile(path.join(root, file), 'utf8'));
  for (const specifier of imports) {
    if (specifier === '@prisma/client' || /(^|\/)prisma(?:\/|$)/i.test(specifier)) {
      violations.push(`${file}: chess-domain must not import Prisma (${specifier})`);
    }
  }
}

for (const file of await sourceFiles('apps/api/src/modules/diagnosis')) {
  const imports = importedSpecifiers(await readFile(path.join(root, file), 'utf8'));
  for (const specifier of imports) {
    if (/lichess|provider|account-imports\/providers/i.test(specifier)) {
      violations.push(`${file}: diagnosis must not import provider code (${specifier})`);
    }
  }
}

for (const detectorRoot of [
  'apps/api/src/modules/evidence/detectors',
  'packages/chess-domain/src/detectors',
]) {
  for (const file of await sourceFiles(detectorRoot)) {
    const imports = importedSpecifiers(await readFile(path.join(root, file), 'utf8'));
    for (const specifier of imports) {
      if (/openai|anthropic|gemini|ai-sdk|(^|\/)ai(?:\/|$)/i.test(specifier)) {
        violations.push(`${file}: deterministic detectors must not depend on AI (${specifier})`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Architecture guardrail violations:\n' + violations.map((value) => `- ${value}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Architecture guardrails passed.');
}
