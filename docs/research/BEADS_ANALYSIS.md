# Beads Persistent Memory System - Technical Analysis

**Last Updated**: 2026-02-05
**Purpose**: Technical research for adapting Beads patterns to RALPH autonomous loop system

---

## Executive Summary

Beads (`bd`) is a distributed, git-backed graph issue tracker designed specifically for AI coding agents. It provides persistent, structured memory that replaces ad-hoc markdown task lists with a dependency-aware system enabling agents to manage long-horizon projects without losing context.

**Key Insight**: Beads solves the "context rot" problem where AI agents lose track of work state across sessions by externalizing task state to a git-synchronized database.

---

## 1. Problem Statement

### What Problem Does Beads Solve?

1. **Context Loss Across Sessions**: AI agents lose memory between invocations; Beads persists task state
2. **Dependency Blindness**: Traditional task lists don't track which work is blocked vs. ready
3. **Multi-Agent Coordination**: Multiple agents/humans working on same codebase need shared task awareness
4. **Merge Conflicts**: Sequential IDs cause collisions in distributed workflows
5. **Context Window Consumption**: Task history grows unboundedly, consuming precious tokens

### Pain Points Addressed

| Problem | Beads Solution |
|---------|----------------|
| Lost task context | Git-versioned JSONL persistence |
| "What should I work on?" | `bd ready` computes unblocked tasks |
| Merge collisions | Hash-based IDs (e.g., `bd-a1b2`) |
| Multi-agent conflicts | Per-workspace isolation + debounced sync |
| Token bloat | Semantic summarization of closed tasks |

---

## 2. Architecture Overview

### Three-Layer Data Model

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI Layer (bd)                          │
│  Cobra commands → JSON output → Daemon RPC or Direct DB     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   SQLite Database                           │
│  Local working copy (gitignored) - Fast queries, indexes    │
│  Tables: issues, dependencies, labels, comments, events     │
└─────────────────────────────────────────────────────────────┘
                              │
                     Export/Import (sync)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   JSONL File (.beads/issues.jsonl)          │
│  Git-tracked source of truth - One JSON line per entity     │
│  Human-readable, merge-friendly, recoverable from history   │
└─────────────────────────────────────────────────────────────┘
                              │
                         git push/pull
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Remote Repository                         │
│  Standard git history - Shared across collaborators         │
└─────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
.beads/
├── beads.db          # SQLite working database (gitignored)
├── issues.jsonl      # Source of truth (git-tracked)
├── bd.sock           # Daemon Unix socket (gitignored)
├── daemon.log        # Daemon logs (gitignored)
├── config.yaml       # Project configuration
└── export_hashes.db  # Export tracking for incremental sync (gitignored)
```

### Daemon Architecture

Each workspace runs an independent background daemon:

- **RPC Server**: Unix domain socket at `.beads/bd.sock`
- **Auto-Sync Manager**: Coordinates batching (500ms debounce) and export timing
- **File Watchers**: Platform-native (inotify/FSEvents) for instant mutation detection
- **Remote Sync**: Pulls git updates every 30 seconds by default

**Key Design**: LSP-inspired per-workspace isolation prevents cross-project pollution.

---

## 3. Data Model

### Core Entities

```typescript
interface Issue {
  id: string;           // Hash-based: "bd-a1b2" (4-6 chars, scales with DB size)
  title: string;
  description?: string;
  status: 'open' | 'in_progress' | 'closed';
  priority: number;     // 0 = highest
  type: 'epic' | 'task' | 'bug' | 'feature';
  created_at: string;
  updated_at: string;
  labels?: string[];
}

interface Dependency {
  parent_id: string;
  child_id: string;
  type: 'blocks' | 'related' | 'parent-child' | 'discovered-from';
}

// Hierarchical IDs
// bd-a3f8       (Epic)
// bd-a3f8.1     (Task under epic)
// bd-a3f8.1.1   (Sub-task, max 3 levels)
```

### ID Generation Strategy

**Problem**: Sequential IDs cause merge collisions when multiple agents create issues concurrently.

**Solution**: Hash-based IDs derived from random UUIDs:
- 4 characters for 0-500 issues
- 5 characters for 500-1,500 issues
- 6+ characters as database grows

**Benefits**:
- Collision-resistant across distributed creation
- No coordination required between agents
- Content hashing distinguishes updates from duplicates

### Dependency Types

| Type | Behavior |
|------|----------|
| `blocks` | Child cannot start until parent completes |
| `parent-child` | Hierarchical grouping (epics → tasks → subtasks) |
| `related` | Informational link, no blocking |
| `discovered-from` | Tracks issue provenance |

---

## 4. Synchronization Mechanics

### Write Path (Creation to Persistence)

```
CLI Command
    │
    ▼
SQLite Write (immediate)
    │
    ▼
Mark Database Dirty
    │
    ▼
FlushManager (5-second debounce)
    │
    ▼
Export to JSONL (incremental or full)
    │
    ▼
Git Hooks Auto-Commit (if enabled)
```

### Read Path (Pull to Query)

```
git pull
    │
    ▼
Auto-Import Detection (JSONL newer than DB?)
    │
    ▼
Parse JSONL + Merge with Local State
    │
    ▼
Content Hash Collision Detection
    │
    ▼
SQLite Queries (fast local reads)
```

### FlushManager Implementation

**Channel-Based State Management** (no mutexes):
```go
type FlushManager struct {
    markDirtyCh  chan struct{} // buffer: 10
    timerFiredCh chan struct{} // buffer: 1
    flushNowCh   chan struct{} // buffer: 1
    shutdownCh   chan struct{} // buffer: 1

    // Internal state (single goroutine owns)
    isDirty         bool
    needsFullExport bool
    debounceTimer   *time.Timer
}
```

**Export Modes**:
- **Incremental**: Only dirty issues merged with existing JSONL
- **Full**: Rebuilds JSONL entirely (required after ID changes)

---

## 5. Claude/AI Agent Integration

### Integration Approaches (Ranked by Efficiency)

| Approach | Token Overhead | Best For |
|----------|---------------|----------|
| CLI + Hooks | ~1-2k tokens | Claude Code, terminal-based agents |
| MCP Server | ~10-50k tokens | Claude Desktop, VS Code Copilot |
| Plugin | Variable | Claude-specific enhancements |

### CLI Integration (Recommended)

```bash
# Setup
bd setup claude              # Global installation
bd setup claude --project    # Project-only

# Core workflow
bd ready                     # What's unblocked?
bd create "Fix auth bug" -p 0  # Create task
bd update bd-a1b2 --status in_progress
bd close bd-a1b2 --reason "Implemented JWT refresh"
bd sync                      # Force flush + git push
```

### Agent Instructions Pattern

From `AGENT_INSTRUCTIONS.md`:

1. **Never use `bd edit`** - Opens interactive editor (agents can't use)
2. **Use `bd update` with flags** instead:
   ```bash
   bd update <id> --description "new text"
   bd update <id> --status in_progress
   ```
3. **Always `bd sync` at session end** - Bypasses 30-second debounce
4. **"Land the plane" protocol** - Complete ALL steps before ending:
   - File remaining work as issues
   - Run quality gates
   - Close finished issues
   - **Push to remote** (mandatory)
   - Clean git state

### MCP Server Integration

```json
// .vscode/mcp.json
{
  "servers": {
    "beads": {
      "command": "beads-mcp"
    }
  }
}
```

**Available MCP Tools**:
- `beads_ready` - List unblocked issues
- `beads_create` - Create issues
- `beads_show` - Display details
- `beads_update` - Modify issues
- `beads_close` - Complete issues
- `beads_sync` - Commit to git
- `beads_dep_add` / `beads_dep_tree` - Manage dependencies

---

## 6. Multi-Agent Coordination

### Per-Workspace Isolation

Each workspace (directory) gets:
- Own daemon instance
- Own SQLite database
- Own socket connection
- Complete isolation from other workspaces

### Concurrent Access Handling

1. **Database Locking Prevention**: 500ms debouncer batches writes
2. **Git-Based Sync**: Periodic remote pull (30s default)
3. **Hash-Based IDs**: No coordination needed for ID generation
4. **Exclusive Lock Protocol**: Create `.beads/.exclusive-lock` for CI/testing

### Shared Database Pattern

For parallel agents in same workspace:
```bash
# Primary clone owns the database
# Secondary clones redirect
echo "/path/to/primary/.beads" > .beads/redirect
```

### Worktree Safety

```bash
# Disable daemon in worktrees to prevent branch contamination
export BEADS_NO_DAEMON=1
```

---

## 7. Memory Compaction

### Problem

As issues accumulate, context window consumption grows unboundedly.

### Solution: Semantic Summarization

Closed tasks can be compacted into summaries, reducing token consumption while preserving essential context:
- Original task details archived
- Summary captures key decisions/outcomes
- Context window stays bounded

### Wisps: Ephemeral Tracking

**Wisps** are template work items for structured workflows:
- Local-only (never exported to JSONL)
- Fast iteration without sync overhead
- Hard-deleted when squashed into permanent issues

---

## 8. Key Design Decisions

### Why JSONL?

1. **Git-friendly**: One line per entity = clean diffs
2. **Human-readable**: Can inspect with `jq`, `grep`, text editors
3. **Merge-friendly**: Line-based merging rarely conflicts
4. **Recoverable**: Git history serves as backup

### Why SQLite + JSONL (Not Just One)?

| SQLite | JSONL |
|--------|-------|
| Fast queries (ms) | Git distribution |
| Complex indexes | Human readable |
| Foreign keys | Merge-friendly |
| Local working copy | Source of truth |

### Why Hash-Based IDs?

Sequential IDs fail in distributed scenarios:
```
Agent A: Creates issue #42
Agent B: Creates issue #42 (conflict!)
```

Hash-based IDs:
```
Agent A: Creates bd-a1b2
Agent B: Creates bd-x9y8 (no conflict)
```

---

## 9. Patterns for RALPH Adaptation

### Applicable Patterns

1. **Three-Layer Architecture**
   - Fast local database (SQLite)
   - Git-tracked source of truth (JSONL)
   - Background sync daemon

2. **Hash-Based Entity IDs**
   - Prevents conflicts in autonomous loop
   - No coordination overhead

3. **Dependency Graph**
   - Track which RALPH tasks block others
   - Compute ready work efficiently
   - `blocked_issues_cache` table pattern for fast queries

4. **Channel-Based State Management**
   - No mutexes, single goroutine owns state
   - Debounced writes for efficiency

5. **Session Lifecycle Hooks**
   - `SessionStart`: Inject context
   - `PreCompact`: Preserve instructions
   - `SessionEnd`: Mandatory sync

6. **CLI-First Integration**
   - ~1-2k tokens vs 10-50k for MCP
   - Universal across editors/agents

### RALPH-Specific Adaptations

| Beads Concept | RALPH Equivalent |
|---------------|------------------|
| Issue | Monitoring Task / Alert |
| Dependency | Alert Correlation |
| `bd ready` | Next Action Recommendation |
| Daemon sync | State persistence loop |
| Wisps | Ephemeral investigation notes |
| Memory compaction | Historical alert summarization |

### Suggested RALPH Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   RALPH CLI / API                           │
│  Commands: status, alert, investigate, resolve, history     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              SQLite (Local State Cache)                     │
│  - Current alerts                                           │
│  - Investigation history                                    │
│  - Correlation graph                                        │
│  - Agent action log                                         │
└─────────────────────────────────────────────────────────────┘
                              │
                       Sync (debounced)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              JSONL Files (Git-Tracked)                      │
│  - alerts.jsonl                                             │
│  - investigations.jsonl                                     │
│  - actions.jsonl                                            │
│  - correlations.jsonl                                       │
└─────────────────────────────────────────────────────────────┘
                              │
                         Async push
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              External Systems                               │
│  - Railway metrics                                          │
│  - Supabase logs                                            │
│  - Alert channels (Slack, etc.)                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. Implementation Recommendations

### Phase 1: Core Persistence

1. Implement SQLite-backed local state store
2. Define JSONL schema for RALPH entities (alerts, investigations, actions)
3. Build export/import sync layer with content hashing

### Phase 2: Dependency Tracking

1. Add correlation graph for related alerts
2. Implement `ralph ready` to surface actionable items
3. Cache blocking relationships for fast queries

### Phase 3: Agent Integration

1. Create `ralph prime` for context injection (~1-2k tokens)
2. Add session lifecycle hooks
3. Implement `ralph sync` for manual flush

### Phase 4: Advanced Features

1. Memory compaction for historical data
2. Wisps-style ephemeral investigation notes
3. Multi-agent coordination (if running multiple RALPH instances)

---

## 11. Dependencies & Requirements

### Beads Requirements

- **Runtime**: Linux, macOS, FreeBSD, Windows 11
- **Languages**: Go 1.24+ (94.9%), Python 3.10+ (for MCP server)
- **Storage**: SQLite (embedded, pure Go driver)
- **Package Managers**: npm, Homebrew, go install, pip/uv

### RALPH Adaptation Requirements

- **TypeScript/Node.js** (aligns with existing stack)
- **better-sqlite3** or **sql.js** for embedded SQLite
- **Git integration** for JSONL versioning
- **Background process** for sync daemon (or event-driven alternative)

---

## 12. References

- **Repository**: https://github.com/steveyegge/beads
- **Author**: Steve Yegge
- **License**: MIT
- **Activity**: 5,720 commits, 212 contributors

### Key Documentation Files

| File | Purpose |
|------|---------|
| `AGENT_INSTRUCTIONS.md` | Workflow guidance for AI agents |
| `docs/ARCHITECTURE.md` | System architecture overview |
| `docs/CLAUDE_INTEGRATION.md` | Claude-specific setup |
| `docs/INTERNALS.md` | Implementation details |
| `docs/DAEMON.md` | Background process architecture |
| `docs/ADVANCED.md` | Complex usage patterns |

---

## 13. Conclusion

Beads provides a well-architected solution to the persistent memory problem for AI agents. Its key innovations:

1. **Git as distribution layer** - No special sync servers needed
2. **Hash-based IDs** - Eliminates distributed coordination
3. **Dependency-aware task tracking** - Agents know what's ready
4. **Efficient token usage** - CLI approach uses ~1-2k tokens vs 10-50k for MCP
5. **Memory compaction** - Bounded context growth

For RALPH, the most valuable patterns are:
- Three-layer architecture (SQLite → JSONL → Git)
- Dependency graph for alert correlation
- Session lifecycle management
- Debounced sync for efficient writes

The system is production-ready with an active community and MIT license, making it suitable as either a direct integration or architectural inspiration.
