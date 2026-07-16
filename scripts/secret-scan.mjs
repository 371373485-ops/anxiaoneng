#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const EXTRA_FILES = ['.env', '.env.production.example', 'backend/.env.example'];
const SKIP_PARTS = new Set([
  '.git', '__pycache__', 'node_modules', 'pages-dist', 'deploy', 'gh-pages',
]);
const SKIP_FILES = new Set(['chart.umd.min.js', 'xlsx.full.min.js']);
const SKIP_EXTS = new Set([
  '.db', '.sqlite', '.sqlite3', '.pyc', '.xlsx', '.xls', '.docx', '.pdf',
  '.png', '.jpg', '.jpeg', '.gif', '.zip',
]);
const ALLOWED_VALUE_PATTERNS = [
  /^$/,
  /^\$\{[^}]+\}$/,
  /^test-only[-\w]*$/i,
  /^replace-with[-\w]*$/i,
  /^dummy[-\w]*$/i,
  /^example[-\w.]*$/i,
  /^your[-\w.]*$/i,
  /^required$/i,
  /^do-not-use$/i,
  /^\*+$/,
];
const CONFIG_ASSIGNMENT = /^\s*([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY|DATABASE_URL)[A-Z0-9_]*)\s*[:=]\s*(['"]?)([^'"\s#]+)\2\s*$/i;
const CODE_LITERAL_ASSIGNMENT = /\b(?:ZAI_API_KEY|ZHIPU_API_KEY|apiKey|authorization|password|secret|token)\b\s*[:=]\s*(['"])([^'"]{12,})\1/i;
const HARD_SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

function trackedFiles() {
  const result = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'git ls-files failed');
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function shouldSkip(relative) {
  const normalized = relative.replace(/\\/g, '/');
  if (normalized.startsWith('pages/data/') || normalized.startsWith('share/')) return true;
  const parts = normalized.split('/');
  if (parts.some((part) => SKIP_PARTS.has(part))) return true;
  const name = parts.at(-1);
  if (SKIP_FILES.has(name)) return true;
  return SKIP_EXTS.has(path.extname(name).toLowerCase());
}

function isAllowedValue(value) {
  const clean = String(value || '').trim();
  if (clean.includes('${') || clean.includes('process.env') || clean.includes('os.environ')) return true;
  if (/test-only/i.test(clean) || /replace-with/i.test(clean)) return true;
  return ALLOWED_VALUE_PATTERNS.some((pattern) => pattern.test(clean));
}

function isConfigFile(relative) {
  return (
    /^\.env(?:\.|$)/.test(relative)
    || relative.endsWith('.env.example')
    || relative.endsWith('.yml')
    || relative.endsWith('.yaml')
    || relative.endsWith('.template')
  );
}

function filesToScan() {
  const files = new Set(trackedFiles());
  for (const item of EXTRA_FILES) {
    if (fs.existsSync(path.join(root, item))) files.add(item);
  }
  return [...files].filter((file) => !shouldSkip(file)).sort();
}

const findings = [];
for (const relative of filesToScan()) {
  const absolute = path.join(root, relative);
  let text;
  try {
    text = fs.readFileSync(absolute, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (HARD_SECRET_PATTERNS.some((pattern) => pattern.test(line))) {
      findings.push(`${relative}:${index + 1}: hard-coded secret pattern`);
      return;
    }
    if (isConfigFile(relative)) {
      const assignment = line.match(CONFIG_ASSIGNMENT);
      if (assignment && !isAllowedValue(assignment[3])) {
        findings.push(`${relative}:${index + 1}: non-placeholder config secret`);
      }
      return;
    }
    const assignment = line.match(CODE_LITERAL_ASSIGNMENT);
    if (assignment && !isAllowedValue(assignment[2])) {
      findings.push(`${relative}:${index + 1}: hard-coded secret literal`);
    }
  });
}

if (findings.length) {
  console.error('Secret scan failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Secret scan passed (${filesToScan().length} files checked).`);
