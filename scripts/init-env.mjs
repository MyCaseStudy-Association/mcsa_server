#!/usr/bin/env node
/**
 * Environment bootstrap — `npm run env:init`.
 *
 * Builds `.env` from `.env.example`:
 *   - keeps every value already present in `.env` (never overwrites);
 *   - fills `<generate>` placeholders with 32 cryptographically random bytes
 *     (hex) — secrets are created on this machine and never displayed;
 *   - copies any other example value as-is (documented defaults);
 *   - preserves keys that exist in `.env` but not in the example.
 *
 * `npm run env:init -- --rotate=KEY[,KEY...]` regenerates the named
 * `<generate>` keys even when set. Rotate every secret before the first
 * production deploy; rotating the Stage 7 keys invalidates existing receipts.
 *
 * Output names variables and what happened to them — never values. The file
 * is written atomically (temp file + rename) so a crash never leaves a
 * half-written `.env`.
 */
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = join(root, '.env.example');
const envPath = join(root, '.env');
const tempPath = join(root, '.env.tmp');
const GENERATE = '<generate>';

// A CA certificate downloaded from the Aiven console lands in the repo root
// as `ca.pem` / `aiven-ca.pem`; file it under certs/ (gitignored) where
// DATABASE_SSL_CA_PATH expects it.
const certsDir = join(root, 'certs');
const caTarget = join(certsDir, 'aiven-ca.pem');
for (const name of ['aiven-ca.pem', 'ca.pem']) {
  const downloaded = join(root, name);
  if (existsSync(downloaded) && !existsSync(caTarget)) {
    mkdirSync(certsDir, { recursive: true });
    renameSync(downloaded, caTarget);
    console.log(`Moved ${name} -> certs/aiven-ca.pem`);
  }
}

/** `--flag=A,B` -> Set {A, B}. */
function listFlag(flag) {
  const arg = process.argv.find((value) => value.startsWith(`--${flag}=`));
  return new Set(
    (arg ? arg.slice(flag.length + 3) : '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean),
  );
}

// --rotate=KEY: regenerate a <generate> key even when set.
// --ask=KEY:    prompt for a human-supplied key even when set (e.g. a new DATABASE_URL).
const rotate = listFlag('rotate');
const ask = listFlag('ask');

/** `<like this>` marks a value a human must supply. */
const isPlaceholder = (value) => value.startsWith('<') && value.endsWith('>');

/** KEY=value lines only; comments and blanks are ignored. Values kept verbatim. */
function parseEnv(text) {
  const values = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return values;
}

const example = readFileSync(examplePath, 'utf8');
const existing = existsSync(envPath)
  ? parseEnv(readFileSync(envPath, 'utf8'))
  : new Map();

const report = [];
const seen = new Set();

// Walk the example line by line so comments and grouping carry over to .env.
const output = example.split(/\r?\n/).map((raw) => {
  const line = raw.trim();
  if (!line || line.startsWith('#')) return raw;
  const eq = line.indexOf('=');
  if (eq < 0) return raw;

  const key = line.slice(0, eq).trim();
  const exampleValue = line.slice(eq + 1).trim();
  seen.add(key);

  const current = existing.get(key);
  const rotating = rotate.has(key) && exampleValue === GENERATE;

  if (current !== undefined && current !== '' && !rotating) {
    const needsValue = isPlaceholder(current) || ask.has(key);
    report.push([key, needsValue ? 'NEEDS VALUE' : 'kept']);
    return `${key}=${current}`;
  }
  if (exampleValue === GENERATE) {
    report.push([key, rotating ? 'rotated' : 'generated']);
    return `${key}=${randomBytes(32).toString('hex')}`;
  }
  report.push([key, isPlaceholder(exampleValue) ? 'NEEDS VALUE' : 'default']);
  return `${key}=${exampleValue}`;
});

const extras = [...existing].filter(([key]) => !seen.has(key));
if (extras.length > 0) {
  output.push('', '# Not in .env.example — preserved from the previous .env');
  for (const [key, value] of extras) {
    output.push(`${key}=${value}`);
    report.push([key, 'kept (not in example)']);
  }
}

// Human-supplied values: ask for them here when running interactively, so
// nobody has to open .env in an editor. Empty answer = leave the placeholder.
if (process.stdin.isTTY) {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (const entry of report) {
    const [key, status] = entry;
    if (status !== 'NEEDS VALUE') continue;
    const answer = (
      await rl.question(`\n${key} — paste value (Enter to skip): `)
    ).trim();
    if (!answer) continue;
    const index = output.findIndex((line) => line.startsWith(`${key}=`));
    output[index] = `${key}=${answer}`;
    entry[1] = 'set';
  }
  rl.close();
}

try {
  writeFileSync(tempPath, output.join('\n').replace(/\n*$/, '\n'), 'utf8');
  renameSync(tempPath, envPath);
} catch (error) {
  console.error(`\nCould not write ${envPath}: ${error.message}`);
  console.error(
    'If the file is locked, close editors or tools holding .env open and rerun.',
  );
  process.exit(1);
}

const width = Math.max(...report.map(([key]) => key.length));
console.log(`\n.env written from .env.example (${report.length} variables):\n`);
for (const [key, status] of report) {
  console.log(`  ${key.padEnd(width)}  ${status}`);
}

const missing = report.filter(([, status]) => status === 'NEEDS VALUE');
if (missing.length > 0) {
  console.log(
    `\nACTION NEEDED — open .env and replace the placeholder for: ${missing
      .map(([key]) => key)
      .join(', ')}`,
  );
} else {
  console.log('\nAll variables set.');
}
