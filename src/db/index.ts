import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCHEMA, VIEWS } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../data/ralph-monitor.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function initDb(): void {
  const database = getDb();
  database.exec(SCHEMA);
  database.exec(VIEWS);
  console.log('✓ Database initialized at:', DB_PATH);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Session operations
export function upsertSession(session: {
  id: string;
  projectPath: string;
  startedAt: string;
  lastActivity: string;
  jsonlPath: string;
  isActive?: boolean;
  totalMessages?: number;
  totalToolCalls?: number;
  metadata?: Record<string, unknown>;
}): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO sessions (id, project_path, started_at, last_activity, jsonl_path, is_active, total_messages, total_tool_calls, metadata)
    VALUES (@id, @projectPath, @startedAt, @lastActivity, @jsonlPath, @isActive, @totalMessages, @totalToolCalls, @metadata)
    ON CONFLICT(id) DO UPDATE SET
      last_activity = @lastActivity,
      is_active = @isActive,
      total_messages = @totalMessages,
      total_tool_calls = @totalToolCalls,
      metadata = @metadata
  `);

  stmt.run({
    id: session.id,
    projectPath: session.projectPath,
    startedAt: session.startedAt,
    lastActivity: session.lastActivity,
    jsonlPath: session.jsonlPath,
    isActive: session.isActive === undefined ? 1 : session.isActive ? 1 : 0,
    totalMessages: session.totalMessages ?? 0,
    totalToolCalls: session.totalToolCalls ?? 0,
    metadata: session.metadata ? JSON.stringify(session.metadata) : null,
  });
}

// Message operations
export function insertMessage(message: {
  id: string;
  sessionId: string;
  parentId?: string;
  type: string;
  timestamp: string;
  role?: string;
  contentPreview?: string;
  contentFull?: string;
  model?: string;
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO messages (id, session_id, parent_id, type, timestamp, role, content_preview, content_full, model, stop_reason, input_tokens, output_tokens)
    VALUES (@id, @sessionId, @parentId, @type, @timestamp, @role, @contentPreview, @contentFull, @model, @stopReason, @inputTokens, @outputTokens)
  `);

  stmt.run({
    id: message.id,
    sessionId: message.sessionId,
    parentId: message.parentId ?? null,
    type: message.type,
    timestamp: message.timestamp,
    role: message.role ?? null,
    contentPreview: message.contentPreview ?? null,
    contentFull: message.contentFull ?? null,
    model: message.model ?? null,
    stopReason: message.stopReason ?? null,
    inputTokens: message.inputTokens ?? null,
    outputTokens: message.outputTokens ?? null,
  });
}

// Tool call operations
export function insertToolCall(toolCall: {
  id: string;
  messageId: string;
  sessionId: string;
  timestamp: string;
  toolName: string;
  inputJson?: string;
  inputPreview?: string;
  outputJson?: string;
  outputPreview?: string;
  durationMs?: number;
  status?: string;
  errorMessage?: string;
}): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO tool_calls (id, message_id, session_id, timestamp, tool_name, input_json, input_preview, output_json, output_preview, duration_ms, status, error_message)
    VALUES (@id, @messageId, @sessionId, @timestamp, @toolName, @inputJson, @inputPreview, @outputJson, @outputPreview, @durationMs, @status, @errorMessage)
  `);

  stmt.run({
    id: toolCall.id,
    messageId: toolCall.messageId,
    sessionId: toolCall.sessionId,
    timestamp: toolCall.timestamp,
    toolName: toolCall.toolName,
    inputJson: toolCall.inputJson ?? null,
    inputPreview: toolCall.inputPreview ?? null,
    outputJson: toolCall.outputJson ?? null,
    outputPreview: toolCall.outputPreview ?? null,
    durationMs: toolCall.durationMs ?? null,
    status: toolCall.status ?? 'pending',
    errorMessage: toolCall.errorMessage ?? null,
  });
}

// Query helpers
export function getActiveSessions(): Array<Record<string, unknown>> {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM sessions
    WHERE is_active = 1
    ORDER BY last_activity DESC
  `).all() as Array<Record<string, unknown>>;
}

export function getRecentToolCalls(limit = 50): Array<Record<string, unknown>> {
  const db = getDb();
  return db.prepare(`
    SELECT tc.*, s.project_path
    FROM tool_calls tc
    JOIN sessions s ON tc.session_id = s.id
    ORDER BY tc.timestamp DESC
    LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>;
}

export function getSessionStats(sessionId: string): Record<string, unknown> | undefined {
  const db = getDb();
  return db.prepare(`
    SELECT
      s.*,
      COUNT(DISTINCT m.id) as message_count,
      COUNT(DISTINCT tc.id) as tool_call_count,
      MIN(m.timestamp) as first_message,
      MAX(m.timestamp) as last_message
    FROM sessions s
    LEFT JOIN messages m ON s.id = m.session_id
    LEFT JOIN tool_calls tc ON s.id = tc.session_id
    WHERE s.id = ?
    GROUP BY s.id
  `).get(sessionId) as Record<string, unknown> | undefined;
}

export function getToolCallsBySession(sessionId: string): Array<Record<string, unknown>> {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM tool_calls
    WHERE session_id = ?
    ORDER BY timestamp ASC
  `).all(sessionId) as Array<Record<string, unknown>>;
}

export function getToolFrequency(): Array<Record<string, unknown>> {
  const db = getDb();
  return db.prepare(`
    SELECT tool_name, COUNT(*) as count
    FROM tool_calls
    GROUP BY tool_name
    ORDER BY count DESC
  `).all() as Array<Record<string, unknown>>;
}
