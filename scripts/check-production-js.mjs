#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const htmlPath = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scripts = [];

for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
  const src = match[1];
  if (/^(?:https?:)?\/\//.test(src) || src.startsWith('data:')) continue;
  const clean = src.split('?')[0].replace(/^\.\//, '');
  if (!clean.endsWith('.js')) continue;
  scripts.push(clean);
}

const uniqueScripts = [...new Set(scripts)];
if (!uniqueScripts.length) {
  console.error('No production JavaScript files referenced by index.html');
  process.exit(1);
}

for (const relative of uniqueScripts) {
  if (relative.includes('..') || path.isAbsolute(relative)) {
    console.error(`Unsafe script path in index.html: ${relative}`);
    process.exit(1);
  }
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) {
    console.error(`Missing production JavaScript file: ${relative}`);
    process.exit(1);
  }
  const result = spawnSync(process.execPath, ['--check', absolute], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    console.error(`JavaScript syntax check failed: ${relative}`);
    process.exit(result.status || 1);
  }
}

console.log(`Checked ${uniqueScripts.length} production JavaScript files from index.html.`);
