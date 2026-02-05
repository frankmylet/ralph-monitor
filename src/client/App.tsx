import { useState, useEffect, useRef } from 'react';

interface ToolCall {
  id: string;
  tool_name: string;
  input_preview: string;
  timestamp: string;
  status: string;
  project_path: string;
}

interface Session {
  id: string;
  project_path: string;
  last_activity: string;
  is_active: number;
  message_count: number;
  tool_call_count: number;
  last_tool_call: string;
}

interface ToolStat {
  tool_name: string;
  count: number;
}

interface TotalStats {
  active_sessions: number;
  total_messages: number;
  total_tool_calls: number;
  recent_tool_calls: number;
}

interface DashboardData {
  sessions: Session[];
  recentToolCalls: ToolCall[];
  toolStats: ToolStat[];
  totalStats: TotalStats;
  timestamp: string;
}

function getToolColor(toolName: string): string {
  const colors: Record<string, string> = {
    Bash: 'bg-emerald-500/20 text-emerald-400 border-emerald-500',
    Read: 'bg-blue-500/20 text-blue-400 border-blue-500',
    Write: 'bg-amber-500/20 text-amber-400 border-amber-500',
    Edit: 'bg-violet-500/20 text-violet-400 border-violet-500',
    Grep: 'bg-pink-500/20 text-pink-400 border-pink-500',
    Glob: 'bg-teal-500/20 text-teal-400 border-teal-500',
    Task: 'bg-orange-500/20 text-orange-400 border-orange-500',
    TaskOutput: 'bg-orange-500/20 text-orange-400 border-orange-500',
    TaskStop: 'bg-red-500/20 text-red-400 border-red-500',
  };
  return colors[toolName] || 'bg-gray-500/20 text-gray-400 border-gray-500';
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
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${diffHour}h ${diffMin % 60}m ago`;
}

function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const colorClasses = getToolColor(toolCall.tool_name);

  return (
    <div
      className={`border-l-4 ${colorClasses} p-3 mb-2 rounded-r bg-gray-800/50 hover:bg-gray-800 transition-colors`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={`px-2 py-0.5 rounded text-xs font-bold ${colorClasses}`}>
          {toolCall.tool_name}
        </span>
        <span className="text-xs text-gray-500">{formatTimestamp(toolCall.timestamp)}</span>
      </div>
      <div className="text-sm text-gray-300 font-mono truncate">{toolCall.input_preview || '(no preview)'}</div>
      <div className="text-xs text-gray-600 mt-1 truncate">{toolCall.project_path}</div>
    </div>
  );
}

function SessionCard({ session }: { session: Session }) {
  const isRecent = new Date().getTime() - new Date(session.last_activity).getTime() < 5 * 60 * 1000;

  return (
    <div
      className={`p-4 rounded-lg border ${
        isRecent ? 'border-green-500/50 bg-green-900/10' : 'border-gray-700 bg-gray-800/30'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isRecent && <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse-subtle" />}
          <span className="text-sm font-mono text-gray-300">{session.project_path.split('/').pop()}</span>
        </div>
        <span className="text-xs text-gray-500">{formatRelativeTime(session.last_activity)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-gray-500">Messages:</span>{' '}
          <span className="text-gray-300">{session.message_count}</span>
        </div>
        <div>
          <span className="text-gray-500">Tool Calls:</span>{' '}
          <span className="text-gray-300">{session.tool_call_count}</span>
        </div>
      </div>
      <div className="text-xs text-gray-600 mt-2 truncate">{session.project_path}</div>
    </div>
  );
}

function StatsBar({ stats }: { stats: TotalStats }) {
  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="text-2xl font-bold text-green-400">{stats.active_sessions}</div>
        <div className="text-xs text-gray-500">Active Sessions</div>
      </div>
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="text-2xl font-bold text-blue-400">{stats.total_messages}</div>
        <div className="text-xs text-gray-500">Total Messages</div>
      </div>
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="text-2xl font-bold text-purple-400">{stats.total_tool_calls}</div>
        <div className="text-xs text-gray-500">Total Tool Calls</div>
      </div>
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="text-2xl font-bold text-amber-400">{stats.recent_tool_calls}</div>
        <div className="text-xs text-gray-500">Last Hour</div>
      </div>
    </div>
  );
}

function ToolFrequencyChart({ stats }: { stats: ToolStat[] }) {
  const maxCount = Math.max(...stats.map((s) => s.count), 1);

  return (
    <div className="space-y-2">
      {stats.slice(0, 10).map((stat) => (
        <div key={stat.tool_name} className="flex items-center gap-2">
          <span className={`w-16 text-xs ${getToolColor(stat.tool_name).split(' ')[1]}`}>{stat.tool_name}</span>
          <div className="flex-1 h-4 bg-gray-800 rounded overflow-hidden">
            <div
              className={`h-full ${getToolColor(stat.tool_name).split(' ')[0]}`}
              style={{ width: `${(stat.count / maxCount) * 100}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 w-8 text-right">{stat.count}</span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const toolCallListRef = useRef<HTMLDivElement>(null);

  // Fetch dashboard data
  const fetchData = async () => {
    try {
      const response = await fetch('/api/dashboard');
      if (!response.ok) throw new Error('Failed to fetch data');
      const json = await response.json();
      setData(json);
      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  };

  // Initial fetch and polling
  useEffect(() => {
    fetchData();

    if (autoRefresh) {
      const interval = setInterval(fetchData, 3000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  // WebSocket connection for real-time updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'update' && message.data.newToolCalls) {
            // Prepend new tool calls to the list
            setData((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                recentToolCalls: [...message.data.newToolCalls, ...prev.recentToolCalls].slice(0, 50),
              };
            });
            setLastUpdate(new Date());
          }
        } catch (err) {
          console.error('WebSocket message error:', err);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting...');
        setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-4">Error</h1>
          <p className="text-gray-400 mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Ralph Monitor</h1>
          <p className="text-sm text-gray-500">Claude Code Session Dashboard</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded bg-gray-700 border-gray-600"
            />
            Auto-refresh
          </label>
          <span className="text-xs text-gray-600">Updated: {lastUpdate.toLocaleTimeString()}</span>
          <button
            onClick={fetchData}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      {data && (
        <>
          {/* Stats Bar */}
          <StatsBar stats={data.totalStats} />

          {/* Main Content */}
          <div className="grid grid-cols-3 gap-6">
            {/* Tool Calls Timeline */}
            <div className="col-span-2">
              <h2 className="text-lg font-semibold mb-4 text-gray-300">Recent Tool Calls</h2>
              <div
                ref={toolCallListRef}
                className="h-[600px] overflow-y-auto pr-2 space-y-2"
              >
                {data.recentToolCalls.map((tc) => (
                  <ToolCallCard key={tc.id} toolCall={tc} />
                ))}
                {data.recentToolCalls.length === 0 && (
                  <div className="text-center text-gray-500 py-8">No tool calls yet. Run the ingestion service.</div>
                )}
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Active Sessions */}
              <div>
                <h2 className="text-lg font-semibold mb-4 text-gray-300">Active Sessions</h2>
                <div className="space-y-3">
                  {data.sessions.map((session) => (
                    <SessionCard key={session.id} session={session} />
                  ))}
                  {data.sessions.length === 0 && (
                    <div className="text-center text-gray-500 py-4">No active sessions</div>
                  )}
                </div>
              </div>

              {/* Tool Frequency */}
              <div>
                <h2 className="text-lg font-semibold mb-4 text-gray-300">Tool Usage (Last Hour)</h2>
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                  <ToolFrequencyChart stats={data.toolStats} />
                  {data.toolStats.length === 0 && (
                    <div className="text-center text-gray-500 py-4">No tool usage data</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {!data && (
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading...</div>
        </div>
      )}
    </div>
  );
}
