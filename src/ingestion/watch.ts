import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initDb, upsertSession, insertMessage, insertToolCall, closeDb } from '../db/index.js';
import {
  parseJsonlLine,
  parseEntry,
  extractSessionId,
  extractProjectPath,
} from './parser.js';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

// Track file positions for incremental reading
const filePositions = new Map<string, number>();

// Track processed message IDs to avoid duplicates
const processedMessages = new Set<string>();

function processJsonlFile(filePath: string, sessionId: string): void {
  const projectPath = extractProjectPath(filePath);
  const stats = fs.statSync(filePath);
  const currentPosition = filePositions.get(filePath) || 0;

  if (stats.size <= currentPosition) {
    return; // No new data
  }

  // Ensure session exists before inserting messages (FK constraint)
  const isActive = Date.now() - stats.mtimeMs < 5 * 60 * 1000;
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

  // Read only new content
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(stats.size - currentPosition);
  fs.readSync(fd, buffer, 0, buffer.length, currentPosition);
  fs.closeSync(fd);

  const newContent = buffer.toString('utf-8');
  const lines = newContent.split('\n').filter((line: string) => line.trim());

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

    // Insert tool calls
    for (const tc of parsed.toolCalls) {
      insertToolCall({
        id: tc.id,
        messageId: parsed.id,
        sessionId: parsed.sessionId,
        timestamp: parsed.timestamp,
        toolName: tc.name,
        inputJson: JSON.stringify(tc.input),
        inputPreview: tc.inputPreview,
        status: 'success', // We'll update this when we see tool_result
      });
      toolCallCount++;
    }
  }

  // Update file position
  filePositions.set(filePath, stats.size);

  // Update session
  if (messageCount > 0 || toolCallCount > 0) {
    upsertSession({
      id: sessionId,
      projectPath,
      startedAt: firstTimestamp || new Date().toISOString(),
      lastActivity: lastTimestamp || new Date().toISOString(),
      jsonlPath: filePath,
      isActive: true,
      totalMessages: messageCount,
      totalToolCalls: toolCallCount,
    });

    console.log(
      `[${new Date().toISOString()}] Processed ${filePath}: +${messageCount} messages, +${toolCallCount} tool calls`
    );
  }
}

function scanExistingFiles(): void {
  console.log('Scanning existing JSONL files...');

  if (!fs.existsSync(PROJECTS_DIR)) {
    console.log('No projects directory found at:', PROJECTS_DIR);
    return;
  }

  const projectDirs = fs.readdirSync(PROJECTS_DIR);

  for (const projectDir of projectDirs) {
    const projectPath = path.join(PROJECTS_DIR, projectDir);
    const stat = fs.statSync(projectPath);

    if (!stat.isDirectory()) continue;

    // Find all .jsonl files in this project
    const files = fs.readdirSync(projectPath).filter((f) => f.endsWith('.jsonl'));

    for (const file of files) {
      const filePath = path.join(projectPath, file);
      const sessionId = extractSessionId(file);

      try {
        processJsonlFile(filePath, sessionId);
      } catch (err) {
        console.error(`Error processing ${filePath}:`, err);
      }
    }
  }

  console.log('Initial scan complete.');
}

function startWatching(): void {
  console.log('Starting file watcher...');

  const watcher = chokidar.watch(`${PROJECTS_DIR}/**/*.jsonl`, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  watcher.on('add', (filePath) => {
    console.log(`New file detected: ${filePath}`);
    const sessionId = extractSessionId(filePath);
    processJsonlFile(filePath, sessionId);
  });

  watcher.on('change', (filePath) => {
    const sessionId = extractSessionId(filePath);
    processJsonlFile(filePath, sessionId);
  });

  watcher.on('error', (error) => {
    console.error('Watcher error:', error);
  });

  console.log(`Watching for changes in: ${PROJECTS_DIR}`);
}

// Periodic re-scan of recently modified files
function startPeriodicScan(): void {
  setInterval(() => {
    if (!fs.existsSync(PROJECTS_DIR)) return;

    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    const projectDirs = fs.readdirSync(PROJECTS_DIR);

    for (const projectDir of projectDirs) {
      const projectPath = path.join(PROJECTS_DIR, projectDir);
      try {
        const stat = fs.statSync(projectPath);
        if (!stat.isDirectory()) continue;

        const files = fs.readdirSync(projectPath).filter((f) => f.endsWith('.jsonl'));

        for (const file of files) {
          const filePath = path.join(projectPath, file);
          const fileStat = fs.statSync(filePath);

          // Only process recently modified files
          if (fileStat.mtimeMs > fiveMinutesAgo) {
            const sessionId = extractSessionId(file);
            processJsonlFile(filePath, sessionId);
          }
        }
      } catch {
        // Ignore permission errors
      }
    }
  }, 10000); // Every 10 seconds
}

// Main
console.log('=== Ralph Monitor Ingestion Service ===');
console.log(`Claude directory: ${CLAUDE_DIR}`);
console.log(`Projects directory: ${PROJECTS_DIR}`);

initDb();
scanExistingFiles();
startWatching();
startPeriodicScan();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  closeDb();
  process.exit(0);
});
