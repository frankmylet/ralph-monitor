// SQLite schema for Ralph Monitor
export const SCHEMA = `
-- Sessions table: tracks each Claude Code session
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_activity TEXT NOT NULL,
  jsonl_path TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  total_messages INTEGER DEFAULT 0,
  total_tool_calls INTEGER DEFAULT 0,
  metadata TEXT -- JSON blob for extra data
);

-- Messages table: user and assistant messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_id TEXT,
  type TEXT NOT NULL, -- 'user' | 'assistant'
  timestamp TEXT NOT NULL,
  role TEXT,
  content_preview TEXT, -- First 500 chars of text content
  content_full TEXT, -- Full content as JSON
  model TEXT,
  stop_reason TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Tool calls table: every tool invocation
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_json TEXT, -- Tool input parameters
  input_preview TEXT, -- Human-readable preview
  output_json TEXT, -- Tool output (if captured)
  output_preview TEXT,
  duration_ms INTEGER,
  status TEXT DEFAULT 'pending', -- 'pending' | 'success' | 'error'
  error_message TEXT,
  FOREIGN KEY (message_id) REFERENCES messages(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Ralph tasks: high-level task progress from Ralph logs
CREATE TABLE IF NOT EXISTS ralph_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  task_id TEXT, -- e.g., "4.2"
  task_name TEXT,
  status TEXT DEFAULT 'pending', -- 'pending' | 'in_progress' | 'completed' | 'failed'
  started_at TEXT,
  completed_at TEXT,
  iteration INTEGER,
  log_file TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Process snapshots: periodic captures of process tree
CREATE TABLE IF NOT EXISTS process_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  session_id TEXT,
  process_tree TEXT, -- JSON of process tree
  docker_containers TEXT, -- JSON of running containers
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_timestamp ON tool_calls(timestamp);
CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity);
`;

export const VIEWS = `
-- View: Recent activity summary
CREATE VIEW IF NOT EXISTS v_recent_activity AS
SELECT
  s.id as session_id,
  s.project_path,
  s.last_activity,
  COUNT(DISTINCT m.id) as message_count,
  COUNT(DISTINCT tc.id) as tool_call_count,
  GROUP_CONCAT(DISTINCT tc.tool_name) as tools_used
FROM sessions s
LEFT JOIN messages m ON s.id = m.session_id
LEFT JOIN tool_calls tc ON s.id = tc.session_id
WHERE s.is_active = 1
GROUP BY s.id
ORDER BY s.last_activity DESC;

-- View: Tool call frequency
CREATE VIEW IF NOT EXISTS v_tool_frequency AS
SELECT
  tool_name,
  COUNT(*) as call_count,
  AVG(duration_ms) as avg_duration_ms
FROM tool_calls
GROUP BY tool_name
ORDER BY call_count DESC;
`;
