#!/usr/bin/env tsx
import { initDb, getActiveSessions, getRecentToolCalls, getToolFrequency, closeDb } from '../db/index.js';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}

function getToolColor(toolName: string): keyof typeof colors {
  const toolColors: Record<string, keyof typeof colors> = {
    Bash: 'green',
    Read: 'blue',
    Write: 'yellow',
    Edit: 'magenta',
    Grep: 'red',
    Glob: 'cyan',
    Task: 'yellow',
  };
  return toolColors[toolName] || 'dim';
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ${diffMin % 60}m ago`;
}

function printHeader(text: string): void {
  console.log();
  console.log(colorize(`═══ ${text} ═══`, 'bold'));
  console.log();
}

function main(): void {
  initDb();

  console.log(colorize('\n╔══════════════════════════════════════╗', 'cyan'));
  console.log(colorize('║       RALPH MONITOR - STATUS         ║', 'cyan'));
  console.log(colorize('╚══════════════════════════════════════╝', 'cyan'));

  // Active Sessions
  printHeader('Active Sessions');
  const sessions = getActiveSessions() as Array<{
    id: string;
    project_path: string;
    last_activity: string;
  }>;

  if (sessions.length === 0) {
    console.log(colorize('  No active sessions found.', 'dim'));
    console.log(colorize('  Run: npm run ingest', 'dim'));
  } else {
    for (const session of sessions.slice(0, 5)) {
      const projectName = session.project_path.split('/').pop() || session.project_path;
      const lastActivity = formatRelativeTime(session.last_activity);
      const isRecent = new Date().getTime() - new Date(session.last_activity).getTime() < 5 * 60 * 1000;

      console.log(
        `  ${isRecent ? colorize('●', 'green') : colorize('○', 'dim')} ${colorize(projectName, 'bold')} ${colorize(
          `(${lastActivity})`,
          'dim'
        )}`
      );
      console.log(colorize(`    ${session.project_path}`, 'dim'));
    }
  }

  // Tool Frequency
  printHeader('Tool Usage');
  const toolFreq = getToolFrequency() as Array<{ tool_name: string; count: number }>;

  if (toolFreq.length === 0) {
    console.log(colorize('  No tool usage data.', 'dim'));
  } else {
    const maxCount = Math.max(...toolFreq.map((t) => t.count));
    for (const tool of toolFreq.slice(0, 8)) {
      const barWidth = Math.round((tool.count / maxCount) * 20);
      const bar = '█'.repeat(barWidth) + '░'.repeat(20 - barWidth);
      console.log(
        `  ${colorize(tool.tool_name.padEnd(12), getToolColor(tool.tool_name))} ${colorize(bar, 'dim')} ${tool.count}`
      );
    }
  }

  // Recent Tool Calls
  printHeader('Recent Tool Calls');
  const recentCalls = getRecentToolCalls(15) as Array<{
    tool_name: string;
    input_preview: string;
    timestamp: string;
    project_path: string;
  }>;

  if (recentCalls.length === 0) {
    console.log(colorize('  No recent tool calls.', 'dim'));
  } else {
    for (const call of recentCalls) {
      const time = formatTimestamp(call.timestamp);
      const preview = (call.input_preview || '').substring(0, 60);
      console.log(
        `  ${colorize(time, 'dim')} ${colorize(call.tool_name.padEnd(10), getToolColor(call.tool_name))} ${preview}`
      );
    }
  }

  console.log();
  console.log(colorize('─'.repeat(42), 'dim'));
  console.log(colorize(`  Last update: ${new Date().toLocaleTimeString()}`, 'dim'));
  console.log(colorize('  Dashboard: http://localhost:3600', 'dim'));
  console.log();

  closeDb();
}

main();
