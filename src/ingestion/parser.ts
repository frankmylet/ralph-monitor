// Parser for Claude Code JSONL conversation files

export interface ParsedEntry {
  type: 'user' | 'assistant' | 'queue-operation' | 'unknown';
  uuid?: string;
  parentUuid?: string;
  sessionId?: string;
  timestamp?: string;
  message?: {
    id?: string;
    role?: string;
    model?: string;
    content?: string | ContentItem[];  // User messages have string content, assistant has array
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  cwd?: string;
  gitBranch?: string;
  permissionMode?: string;
}

export interface ContentItem {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string | ContentItem[];
  is_error?: boolean;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  inputPreview: string;
}

export interface ParsedMessage {
  id: string;
  sessionId: string;
  parentId?: string;
  type: 'user' | 'assistant';
  timestamp: string;
  role?: string;
  model?: string;
  contentPreview: string;
  contentFull: string;
  inputTokens?: number;
  outputTokens?: number;
  stopReason?: string;
  toolCalls: ToolCallInfo[];
}

export function parseJsonlLine(line: string): ParsedEntry | null {
  try {
    return JSON.parse(line) as ParsedEntry;
  } catch {
    return null;
  }
}

export function extractTextPreview(content: string | ContentItem[], maxLength = 500): string {
  // Handle string content (user messages)
  if (typeof content === 'string') {
    if (content.length > maxLength) {
      return content.substring(0, maxLength) + '...';
    }
    return content;
  }

  // Handle array content (assistant messages)
  const textParts: string[] = [];

  for (const item of content) {
    if (item.type === 'text' && item.text) {
      textParts.push(item.text);
    }
  }

  const fullText = textParts.join('\n');
  if (fullText.length > maxLength) {
    return fullText.substring(0, maxLength) + '...';
  }
  return fullText;
}

export function extractToolCalls(content: string | ContentItem[]): ToolCallInfo[] {
  // User messages (string content) have no tool calls
  if (typeof content === 'string') {
    return [];
  }

  const toolCalls: ToolCallInfo[] = [];

  for (const item of content) {
    if (item.type === 'tool_use' && item.id && item.name) {
      const input = item.input || {};
      let inputPreview = '';

      // Create human-readable preview based on tool type
      switch (item.name) {
        case 'Bash':
          inputPreview = (input.command as string)?.substring(0, 200) || '';
          break;
        case 'Read':
          inputPreview = `Read: ${input.file_path}`;
          break;
        case 'Write':
          inputPreview = `Write: ${input.file_path}`;
          break;
        case 'Edit':
          inputPreview = `Edit: ${input.file_path}`;
          break;
        case 'Grep':
          inputPreview = `Grep: "${input.pattern}" in ${input.path || '.'}`;
          break;
        case 'Glob':
          inputPreview = `Glob: ${input.pattern}`;
          break;
        case 'Task':
          inputPreview = `Task: ${input.description || (typeof input.prompt === 'string' ? input.prompt.substring(0, 100) : '')}`;
          break;
        default:
          inputPreview = JSON.stringify(input).substring(0, 200);
      }

      toolCalls.push({
        id: item.id,
        name: item.name,
        input,
        inputPreview,
      });
    }
  }

  return toolCalls;
}

export function parseEntry(entry: ParsedEntry, sessionId: string): ParsedMessage | null {
  if (entry.type !== 'user' && entry.type !== 'assistant') {
    return null;
  }

  const message = entry.message;
  if (!message) return null;

  const content = message.content || (entry.type === 'user' ? '' : []);
  const contentPreview = extractTextPreview(content);
  const toolCalls = entry.type === 'assistant' ? extractToolCalls(content) : [];

  return {
    id: entry.uuid || message.id || `${sessionId}-${entry.timestamp}`,
    sessionId,
    parentId: entry.parentUuid,
    type: entry.type,
    timestamp: entry.timestamp || new Date().toISOString(),
    role: message.role,
    model: message.model,
    contentPreview,
    contentFull: JSON.stringify(content),
    inputTokens: message.usage?.input_tokens,
    outputTokens: message.usage?.output_tokens,
    stopReason: message.stop_reason,
    toolCalls,
  };
}

export function extractSessionId(filePath: string): string {
  // Extract UUID from filename like "e52de424-a383-4754-a265-f00cc1db9582.jsonl"
  const match = filePath.match(/([a-f0-9-]{36})\.jsonl$/);
  return match ? match[1] : filePath;
}

export function extractProjectPath(filePath: string): string {
  // Extract project path from ~/.claude/projects/-home-user-code-project/
  const match = filePath.match(/projects\/([^/]+)\//);
  if (match) {
    // Convert -home-user-code-project to /home/user/code/project
    return '/' + match[1].replace(/-/g, '/').replace(/^\//, '');
  }
  return 'unknown';
}
