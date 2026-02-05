#!/usr/bin/env tsx
// One-time ingestion of all JSONL files
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initDb, upsertSession, insertMessage, insertToolCall, closeDb } from '../db/index.js';
import { parseJsonlLine, parseEntry, extractSessionId, extractProjectPath } from './parser.js';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

// Track processed message IDs to avoid duplicates
const processedMessages = new Set<string>();

function processJsonlFile(filePath: string, sessionId: string): { messages: number; toolCalls: number } {
  const projectPath = extractProjectPath(filePath);

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error(`  Error reading ${filePath}:`, err);
    return { messages: 0, toolCalls: 0 };
  }

  const lines = content.split('\n').filter((line) => line.trim());

  // Determine if session is active (modified in last 5 minutes)
  let isActive = false;
  try {
    const stats = fs.statSync(filePath);
    isActive = Date.now() - stats.mtimeMs < 5 * 60 * 1000;
  } catch {
    // Ignore
  }

  // Create session first to satisfy FK constraint
  upsertSession({
    id: sessionId,
    projectPath,
    startedAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    jsonlPath: filePath,
    isActive,
    totalMessages: 0,
    totalToolCalls: 0,
  });

  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let messageCount = 0;
  let toolCallCount = 0;

  for (const line of lines) {
    const entry = parseJsonlLine(line);
    if (!entry) continue;

    const timestamp = entry.timestamp;
    if (timestamp) {
      if (!firstTimestamp) firstTimestamp = timestamp;
      lastTimestamp = timestamp;
    }

    const parsed = parseEntry(entry, sessionId);
    if (!parsed) continue;

    // Skip if already processed
    if (processedMessages.has(parsed.id)) continue;
    processedMessages.add(parsed.id);

    // Insert message
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
    } catch {
      // Ignore duplicate key errors
    }

    // Insert tool calls
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
      } catch {
        // Ignore duplicate key errors
      }
    }
  }

  // Update session with final counts
  if (messageCount > 0 || toolCallCount > 0) {
    upsertSession({
      id: sessionId,
      projectPath,
      startedAt: firstTimestamp || new Date().toISOString(),
      lastActivity: lastTimestamp || new Date().toISOString(),
      jsonlPath: filePath,
      isActive,
      totalMessages: messageCount,
      totalToolCalls: toolCallCount,
    });
  }

  return { messages: messageCount, toolCalls: toolCallCount };
}

function main(): void {
  console.log('=== Ralph Monitor - One-Time Ingestion ===\n');
  console.log(`Claude directory: ${CLAUDE_DIR}`);
  console.log(`Projects directory: ${PROJECTS_DIR}\n`);

  if (!fs.existsSync(PROJECTS_DIR)) {
    console.error('Error: Projects directory not found');
    process.exit(1);
  }

  initDb();

  let totalFiles = 0;
  let totalMessages = 0;
  let totalToolCalls = 0;

  const projectDirs = fs.readdirSync(PROJECTS_DIR);

  for (const projectDir of projectDirs) {
    const projectPath = path.join(PROJECTS_DIR, projectDir);

    let stat;
    try {
      stat = fs.statSync(projectPath);
    } catch {
      continue;
    }

    if (!stat.isDirectory()) continue;

    // Find all .jsonl files
    let files: string[];
    try {
      files = fs.readdirSync(projectPath).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    if (files.length === 0) continue;

    console.log(`\n📁 ${projectDir}`);
    console.log(`   ${files.length} session file(s)`);

    for (const file of files) {
      const filePath = path.join(projectPath, file);
      const sessionId = extractSessionId(file);

      const { messages, toolCalls } = processJsonlFile(filePath, sessionId);

      if (messages > 0 || toolCalls > 0) {
        console.log(`   ✓ ${file}: ${messages} messages, ${toolCalls} tool calls`);
        totalFiles++;
        totalMessages += messages;
        totalToolCalls += toolCalls;
      }
    }
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`\n✅ Ingestion complete!`);
  console.log(`   Files processed: ${totalFiles}`);
  console.log(`   Total messages: ${totalMessages}`);
  console.log(`   Total tool calls: ${totalToolCalls}`);
  console.log(`\nRun 'npm run dev' to start the dashboard.`);

  closeDb();
}

main();
