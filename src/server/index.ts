import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  initDb,
  getActiveSessions,
  getRecentToolCalls,
  getSessionStats,
  getToolCallsBySession,
  getToolFrequency,
  getDb,
} from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3600;

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files in production
app.use(express.static(path.join(__dirname, '../../dist')));

// API Routes
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/sessions', (_req, res) => {
  try {
    const sessions = getActiveSessions();
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/sessions/:id', (req, res) => {
  try {
    const stats = getSessionStats(req.params.id);
    if (!stats) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/sessions/:id/tool-calls', (req, res) => {
  try {
    const toolCalls = getToolCallsBySession(req.params.id);
    res.json(toolCalls);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/tool-calls/recent', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const toolCalls = getRecentToolCalls(limit);
    res.json(toolCalls);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/tool-frequency', (_req, res) => {
  try {
    const frequency = getToolFrequency();
    res.json(frequency);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Dashboard summary endpoint
app.get('/api/dashboard', (_req, res) => {
  try {
    const db = getDb();

    const sessions = db
      .prepare(
        `
      SELECT
        s.id,
        s.project_path,
        s.last_activity,
        s.is_active,
        (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count,
        (SELECT COUNT(*) FROM tool_calls WHERE session_id = s.id) as tool_call_count,
        (SELECT MAX(timestamp) FROM tool_calls WHERE session_id = s.id) as last_tool_call
      FROM sessions s
      WHERE datetime(s.last_activity) > datetime('now', '-1 hour')
      ORDER BY s.last_activity DESC
      LIMIT 10
    `
      )
      .all();

    const recentToolCalls = db
      .prepare(
        `
      SELECT
        tc.id,
        tc.tool_name,
        tc.input_preview,
        tc.timestamp,
        tc.status,
        s.project_path
      FROM tool_calls tc
      JOIN sessions s ON tc.session_id = s.id
      ORDER BY tc.timestamp DESC
      LIMIT 50
    `
      )
      .all();

    const toolStats = db
      .prepare(
        `
      SELECT tool_name, COUNT(*) as count
      FROM tool_calls
      WHERE datetime(timestamp) > datetime('now', '-1 hour')
      GROUP BY tool_name
      ORDER BY count DESC
    `
      )
      .all();

    const totalStats = db
      .prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM sessions WHERE is_active = 1) as active_sessions,
        (SELECT COUNT(*) FROM messages) as total_messages,
        (SELECT COUNT(*) FROM tool_calls) as total_tool_calls,
        (SELECT COUNT(*) FROM tool_calls WHERE datetime(timestamp) > datetime('now', '-1 hour')) as recent_tool_calls
    `
      )
      .get();

    res.json({
      sessions,
      recentToolCalls,
      toolStats,
      totalStats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Create HTTP server
const server = createServer(app);

// WebSocket server for real-time updates
const wss = new WebSocketServer({ server });

const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  clients.add(ws);

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });

  // Send initial data
  try {
    const db = getDb();
    const recentToolCalls = db
      .prepare(
        `
      SELECT
        tc.id,
        tc.tool_name,
        tc.input_preview,
        tc.timestamp,
        tc.status,
        s.project_path
      FROM tool_calls tc
      JOIN sessions s ON tc.session_id = s.id
      ORDER BY tc.timestamp DESC
      LIMIT 20
    `
      )
      .all();

    ws.send(
      JSON.stringify({
        type: 'initial',
        data: { recentToolCalls },
      })
    );
  } catch (error) {
    console.error('Error sending initial data:', error);
  }
});

// Broadcast updates to all connected clients
export function broadcastUpdate(data: unknown): void {
  const message = JSON.stringify({ type: 'update', data });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Poll for new data and broadcast (simple approach)
let lastToolCallCount = 0;

setInterval(() => {
  try {
    const db = getDb();
    const result = db.prepare('SELECT COUNT(*) as count FROM tool_calls').get() as { count: number };
    const currentCount = result.count;

    if (currentCount > lastToolCallCount) {
      // New tool calls detected, broadcast update
      const newCalls = db
        .prepare(
          `
        SELECT
          tc.id,
          tc.tool_name,
          tc.input_preview,
          tc.timestamp,
          tc.status,
          s.project_path
        FROM tool_calls tc
        JOIN sessions s ON tc.session_id = s.id
        ORDER BY tc.timestamp DESC
        LIMIT ?
      `
        )
        .all(currentCount - lastToolCallCount);

      broadcastUpdate({ newToolCalls: newCalls });
      lastToolCallCount = currentCount;
    }
  } catch {
    // Ignore errors during polling
  }
}, 2000);

// Initialize and start
initDb();

server.listen(PORT, () => {
  console.log(`\n=== Ralph Monitor Server ===`);
  console.log(`API: http://localhost:${PORT}/api`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
  console.log(`\nPress Ctrl+C to stop\n`);
});
