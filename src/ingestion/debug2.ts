#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initDb, insertMessage, insertToolCall, closeDb } from '../db/index.js';
import { parseJsonlLine, parseEntry, extractSessionId, extractProjectPath } from './parser.js';

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const testProject = '-home-frankmylet-code-mtngunsnammo';
const projectPath = path.join(PROJECTS_DIR, testProject);

// Get recent files
const files = fs
  .readdirSync(projectPath)
  .filter((f) => f.endsWith('.jsonl'))
  .map((f) => ({ name: f, mtime: fs.statSync(path.join(projectPath, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

const testFile = path.join(projectPath, files[0].name);
const sessionId = extractSessionId(files[0].name);

console.log('Testing full ingestion on:', files[0].name);
console.log('Session ID:', sessionId);
console.log('Project path:', extractProjectPath(testFile));

initDb();

const processedMessages = new Set<string>();
let messageCount = 0;
let toolCallCount = 0;

const content = fs.readFileSync(testFile, 'utf-8');
const lines = content.split('\n').filter((l) => l.trim());
console.log('Total lines:', lines.length);

for (const line of lines) {
  const entry = parseJsonlLine(line);
  if (!entry) continue;

  const parsed = parseEntry(entry, sessionId);
  if (!parsed) continue;

  if (processedMessages.has(parsed.id)) {
    console.log('Skipping duplicate:', parsed.id);
    continue;
  }
  processedMessages.add(parsed.id);

  try {
    insertMessage({
      id: parsed.id,
      sessionId: parsed.sessionId,
      parentId: parsed.parentId,
      type: parsed.type,
      timestamp: parsed.timestamp,
      role: parsed.role,
      contentPreview: parsed.contentPreview,
      contentFull: parsed.contentFull,
      model: parsed.model,
      stopReason: parsed.stopReason,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
    });
    messageCount++;
  } catch (err) {
    console.log('Insert message error:', err);
  }

  for (const tc of parsed.toolCalls) {
    try {
      insertToolCall({
        id: tc.id,
        messageId: parsed.id,
        sessionId: parsed.sessionId,
        timestamp: parsed.timestamp,
        toolName: tc.name,
        inputJson: JSON.stringify(tc.input),
        inputPreview: tc.inputPreview,
        status: 'success',
      });
      toolCallCount++;
    } catch (err) {
      console.log('Insert tool call error:', err);
    }
  }
}

console.log('\nMessages inserted:', messageCount);
console.log('Tool calls inserted:', toolCallCount);

closeDb();
