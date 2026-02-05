#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseJsonlLine, parseEntry, extractSessionId } from './parser.js';

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const testProject = '-home-frankmylet-code-mtngunsnammo';
const projectPath = path.join(PROJECTS_DIR, testProject);

// Get a recent file
const files = fs
  .readdirSync(projectPath)
  .filter((f) => f.endsWith('.jsonl'))
  .map((f) => ({ name: f, mtime: fs.statSync(path.join(projectPath, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

const testFile = path.join(projectPath, files[0].name);
const sessionId = extractSessionId(files[0].name);

console.log('Testing file:', files[0].name);
console.log('Session ID:', sessionId);

const content = fs.readFileSync(testFile, 'utf-8');
const lines = content.split('\n').filter((l) => l.trim()).slice(0, 10);

let parsed = 0;
let unparsed = 0;

for (const line of lines) {
  const entry = parseJsonlLine(line);
  if (!entry) {
    console.log('Failed to parse JSON line');
    continue;
  }

  console.log('Entry type:', entry.type, '| Has message:', !!entry.message);

  const result = parseEntry(entry, sessionId);
  if (result) {
    parsed++;
    console.log('  -> Parsed:', result.type, 'toolCalls:', result.toolCalls.length);
  } else {
    unparsed++;
    console.log('  -> Skipped (parseEntry returned null)');
  }
}

console.log('\nParsed:', parsed, 'Unparsed:', unparsed);
