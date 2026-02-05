# Ralph Monitor

Real-time monitoring dashboard for Claude Code sessions and Ralph AFK automation loops.

## Features

- **Real-time Dashboard**: Visual timeline of all tool calls across sessions
- **Session Tracking**: Monitor multiple Claude Code sessions simultaneously
- **Tool Analytics**: See which tools are being used most frequently
- **WebSocket Updates**: Live updates without manual refresh
- **SQLite Storage**: Persistent storage of all session activity
- **CLI Tool**: Quick terminal-based status check

## Quick Start

```bash
# Install dependencies
npm install

# Initialize database
npm run db:reset

# Ingest existing session data
npm run ingest:once

# Start the dashboard
npm run dev
```

Open http://localhost:5174 to view the dashboard.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Data Flow                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ~/.claude/projects/*/[session].jsonl                           │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐                                            │
│  │  Ingestion      │  Watches JSONL files, parses entries      │
│  │  Service        │  Extracts messages, tool calls             │
│  └────────┬────────┘                                            │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐                                            │
│  │  SQLite DB      │  Stores sessions, messages, tool_calls    │
│  │  ralph-monitor  │                                            │
│  └────────┬────────┘                                            │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐     ┌─────────────────┐                    │
│  │  Express API    │────▶│  React Dashboard │                   │
│  │  + WebSocket    │     │  Real-time UI    │                   │
│  └─────────────────┘     └─────────────────┘                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both server and client in development mode |
| `npm run dev:server` | Start only the API server (port 3600) |
| `npm run dev:client` | Start only the Vite client (port 5174) |
| `npm run ingest` | Start the file watcher for real-time ingestion |
| `npm run ingest:once` | One-time ingestion of all existing sessions |
| `npm run db:reset` | Reset and reinitialize the database |
| `npm run cli` | Show status in terminal |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /api/dashboard` | Full dashboard summary |
| `GET /api/sessions` | List active sessions |
| `GET /api/sessions/:id` | Get session details |
| `GET /api/sessions/:id/tool-calls` | Get tool calls for session |
| `GET /api/tool-calls/recent` | Get recent tool calls |
| `GET /api/tool-frequency` | Get tool usage statistics |

## Data Sources

The monitor reads from Claude Code's internal data structures:

- **Session JSONL files**: `~/.claude/projects/[project]/[session-id].jsonl`
  - Full conversation history
  - Message content and metadata
  - Tool call inputs and outputs
  - Token usage statistics

## Database Schema

```sql
-- Sessions
sessions (id, project_path, started_at, last_activity, jsonl_path, is_active)

-- Messages (user and assistant)
messages (id, session_id, type, timestamp, role, content_preview, model, tokens)

-- Tool calls
tool_calls (id, message_id, session_id, timestamp, tool_name, input_json, input_preview)
```

## Development

The project uses:
- **Backend**: Express + better-sqlite3 + WebSocket
- **Frontend**: React + Vite + Tailwind CSS
- **Ingestion**: chokidar file watcher

## License

MIT
