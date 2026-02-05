# RALPH Pattern Methodology

**Last Updated**: 2026-02-05

A comprehensive guide to the RALPH (Recursive Agent Loop for Persistent Handling) pattern for autonomous AI coding agents.

---

## Table of Contents

1. [Overview](#overview)
2. [Core Principles](#core-principles)
3. [How It Works](#how-it-works)
4. [Implementation Patterns](#implementation-patterns)
5. [Execution Modes](#execution-modes)
6. [Task Structuring](#task-structuring)
7. [Error Handling & Recovery](#error-handling--recovery)
8. [Iteration Control & Cost Management](#iteration-control--cost-management)
9. [Progress Tracking](#progress-tracking)
10. [Completion Signals](#completion-signals)
11. [Safety & Sandboxing](#safety--sandboxing)
12. [Best Practices](#best-practices)
13. [Advanced Patterns](#advanced-patterns)

---

## Overview

RALPH is a technique for executing AI coding agents in repetitive loops. Named after Ralph Wiggum from The Simpsons (known for his persistent, undeterred nature), the pattern enables AI agents to autonomously work through task lists without continuous human oversight.

**Key Insight**: Rather than running an AI agent once and stopping, RALPH runs identical prompts repeatedly. The agent independently selects tasks from a Product Requirements Document (PRD), commits changes after each feature, and delivers working code autonomously.

**Important Distinction from ReAct**: While ReAct relies on the LLM's internal self-assessment to determine completion, RALPH uses external control mechanisms. This addresses the fundamental problem that "the self-assessment mechanism of LLMs is unreliable" - they tend to exit prematurely rather than meeting objective standards.

---

## Core Principles

### 1. External Persistence Over Internal State

Progress persists not in the LLM's context window but in:
- **Git history** - Objective record of changes
- **Progress file** (`progress.txt`) - Cumulative learnings
- **Task tracker** (`prd.json`) - Structured completion markers

### 2. Stateless Iterations

Each cycle operates with a fresh AI context. Continuity derives from persistent files, not conversation memory.

### 3. Single Task per Iteration

The strict instruction "ONLY DO ONE TASK AT A TIME" forces:
- Incremental commits
- Clear progress tracking
- Prevents context rot
- Enables rollback on failures

### 4. File-Based Communication

The agent reads context files (`@PRD.md`, `@progress.txt`) to:
- Extract requirements
- Determine outstanding tasks
- Understand previous decisions

### 5. Verification-Driven Completion

Tasks complete only when external verification passes (tests, type checks, linting), not when the AI declares completion.

---

## How It Works

### The RALPH Cycle

```
┌─────────────────────────────────────────────────────────┐
│                    RALPH ITERATION                       │
├─────────────────────────────────────────────────────────┤
│  1. Read PRD and progress file                          │
│  2. Select highest-priority incomplete task             │
│  3. Explore codebase for context                        │
│  4. Implement the feature                               │
│  5. Run verification (tests, types, lint)               │
│  6. Commit changes (if verification passes)             │
│  7. Update progress.txt with learnings                  │
│  8. Update task status to complete                      │
│  9. Check for completion signal                         │
│  10. Loop or exit                                       │
└─────────────────────────────────────────────────────────┘
```

### Stop Hook Mechanism

The core innovation intercepts exit attempts:
- External control script scans output
- If predefined "Completion Promise" not found, system reloads
- Prevents premature termination

---

## Implementation Patterns

### Basic RALPH Script (Human-in-the-Loop)

```bash
#!/bin/bash
# ralph-once.sh - Single iteration with human oversight

claude --permission-mode acceptEdits "@PRD.md @progress.txt \
1. Read the PRD and progress file. \
2. Find the next incomplete task and implement it. \
3. Commit your changes. \
4. Update progress.txt with what you did. \
ONLY DO ONE TASK AT A TIME."
```

### Autonomous RALPH Script (AFK Mode)

```bash
#!/bin/bash
# afk-ralph.sh - Fully autonomous with iteration cap

set -e

MAX_ITERATIONS=${1:-10}
COMPLETION_SIGNAL="<promise>COMPLETE</promise>"

for i in $(seq 1 $MAX_ITERATIONS); do
    echo "=== RALPH Iteration $i of $MAX_ITERATIONS ==="

    OUTPUT=$(claude -p --permission-mode acceptEdits "@PRD.md @progress.txt \
        1. Read the PRD and progress file. \
        2. Find the next incomplete task and implement it. \
        3. Commit your changes. \
        4. Update progress.txt with what you did. \
        5. If ALL tasks are complete, output: $COMPLETION_SIGNAL \
        ONLY DO ONE TASK AT A TIME.")

    echo "$OUTPUT"

    if echo "$OUTPUT" | grep -q "$COMPLETION_SIGNAL"; then
        echo "=== All tasks complete! ==="
        exit 0
    fi
done

echo "=== Reached iteration limit ($MAX_ITERATIONS) ==="
```

### Key Configuration Elements

| Flag | Purpose |
|------|---------|
| `--permission-mode acceptEdits` | Auto-approve file modifications |
| `-p` | Print mode for non-interactive execution |
| `@filename` | Inject file as context |

---

## Execution Modes

### Human-in-the-Loop (HITL)

**When to use:**
- Learning the pattern
- Refining prompts
- High-risk tasks
- Unfamiliar codebases

**Characteristics:**
- Watch each iteration
- Intervene when needed
- Validate quality manually
- Build intuition before automation

### Away From Keyboard (AFK)

**When to use:**
- Well-defined tasks
- Established patterns
- Low-risk implementations
- Bulk work

**Characteristics:**
- Capped iterations
- Runs unsupervised
- Docker sandbox recommended
- Overnight execution viable

### Progression Strategy

```
HITL (learning) → HITL (refining) → Hybrid → AFK (confident)
```

Start supervised, transition to autonomous only after validation.

---

## Task Structuring

### PRD Design Principles

**Define the end state, not implementation steps:**
```markdown
## Feature: User Authentication

### Requirements
- [ ] Users can register with email/password
- [ ] Email verification required before login
- [ ] Password reset via email link
- [ ] Session expires after 24 hours

### Acceptance Criteria
- All tests pass
- No TypeScript errors
- Login flow works in browser
```

**Avoid vague objectives:**
- ❌ "Make the authentication better"
- ✅ "Add password complexity requirements: min 8 chars, 1 uppercase, 1 number"

### Task Granularity

**Appropriate sizing (single context window):**
- Database migration
- UI component addition
- Server endpoint implementation
- Test suite for a module

**Inappropriate sizing (requires splitting):**
- Complete dashboard
- Full authentication system
- API refactoring

### Structured PRD Format (JSON)

```json
{
  "projectName": "Feature Name",
  "branchName": "feat/feature-name",
  "userStories": [
    {
      "id": "US-001",
      "title": "User Registration",
      "description": "Implement user registration endpoint",
      "acceptanceCriteria": [
        "POST /api/register accepts email/password",
        "Returns 201 on success",
        "Returns 400 for invalid input",
        "Unit tests cover all cases"
      ],
      "passes": false
    }
  ]
}
```

### Prioritization Strategy

Sequence tasks by risk, not ease:

1. **Architectural decisions** - Core abstractions first
2. **Integration points** - Module boundaries
3. **Unknown challenges** - Spike work
4. **Standard implementations** - Known patterns
5. **Polish and quick wins** - Last

> "This prevents easy wins from masking foundational problems."

---

## Error Handling & Recovery

### Feedback Loops

Implement multiple validation mechanisms:

```bash
# Quality gate script
npm run typecheck && \
npm run lint && \
npm run test && \
npm run build
```

**Essential feedback mechanisms:**
- TypeScript type checking
- Unit tests (Jest, Vitest)
- Linting (ESLint)
- Integration tests
- Pre-commit hooks

> "The more loops you give it, the higher quality code it produces."

### Automatic Recovery

When verification fails:
1. Error captured in output
2. Progress file updated with failure reason
3. Next iteration receives failure context
4. Agent attempts fix or different approach

### Pre-commit Hooks

Block commits that fail quality gates:

```bash
#!/bin/bash
# .git/hooks/pre-commit

npm run typecheck || exit 1
npm run lint || exit 1
npm run test || exit 1
```

This prevents bad code from accumulating across iterations.

---

## Iteration Control & Cost Management

### Setting Iteration Limits

| Task Type | Recommended Limit |
|-----------|-------------------|
| Small fixes | 5-10 iterations |
| Medium features | 15-30 iterations |
| Large features | 30-50 iterations |

**Never run infinite loops with stochastic systems.**

### Cost Estimation

Typical ranges per task:
- Simple: $5-20
- Medium: $20-50
- Complex: $50-150

One documented case: $50,000 contract completed for $297 in API costs.

### Cost Control Strategies

1. **Start HITL** - Validate approach before AFK
2. **Tight scope** - Clear, bounded tasks
3. **Feedback loops** - Prevent costly rework
4. **Iteration caps** - Hard limits on spending

### Mid-Flight Adjustments

Since progress files track state:
- Modify PRD items during execution
- Set completed items back to incomplete
- Add new requirements as discovered
- Pause and resume across sessions

---

## Progress Tracking

### Progress File Structure

```markdown
# Progress Log

## Session: 2026-02-05

### Iteration 1: US-001 User Registration
- Implemented POST /api/register endpoint
- Added Zod validation schema
- Created user.service.ts
- Tests: 5/5 passing
- Commit: abc1234

### Iteration 2: US-002 Email Verification
- Added email service with Resend
- Created verification token table
- Blocked: Need SMTP credentials in .env

### Architectural Decisions
- Using Zod for all request validation
- JWT stored in httpOnly cookie, not localStorage
- Passwords hashed with bcrypt, cost factor 12

### Discovered Patterns
- All routes follow /api/v1/resource pattern
- Error responses use { error: string, code: string } format

### Blockers
- US-003 blocked on email service credentials
```

### Purpose of Progress File

1. **Context efficiency** - Skip redundant exploration
2. **Decision history** - Why choices were made
3. **Blocker tracking** - What needs human intervention
4. **Cross-iteration learning** - Patterns to follow

### Session Management

Progress files are **temporary**:
- Delete after sprint completes
- Archive with completed feature branches
- Not permanent documentation

### Git Integration

Commit after each feature:
- Readable project history
- Diff against previous work
- Rollback capability

```bash
git log --oneline -10  # View recent RALPH commits
```

---

## Completion Signals

### The Promise Pattern

```
<promise>COMPLETE</promise>
```

This explicit signal:
- Terminates the loop gracefully
- Indicates all requirements met
- Prevents endless iteration
- Enables early exit before iteration limits

### Verification Before Promise

Only output completion when:
- All PRD items show `passes: true`
- All tests passing
- All type checks passing
- All lint rules satisfied

### Alternative Completion Checks

```bash
# Check PRD status programmatically
INCOMPLETE=$(cat prd.json | jq '[.userStories[] | select(.passes == false)] | length')
if [ "$INCOMPLETE" -eq 0 ]; then
    echo "<promise>COMPLETE</promise>"
fi
```

---

## Safety & Sandboxing

### Docker Containerization

For AFK RALPH, run in containers:

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -w /workspace \
  claude-code-image \
  ./ralph.sh
```

**Benefits:**
- Mounted project directory editable
- System files protected
- SSH keys isolated
- Home directory restricted

**Trade-offs:**
- Global AGENTS.md won't load
- User skills unavailable

> "For AFK Ralph, especially overnight loops, they're essential insurance against runaway agents."

### Credential Separation

- Main worktree: Production access
- Feature worktrees: Staging only
- Prevents accidental production changes

---

## Best Practices

### 1. Codebase Quality

> "Agents amplify existing patterns - poor code produces poorer outputs."

Before launching RALPH:
- Clean up existing issues
- Establish clear patterns
- Document conventions
- Enable strict linting

### 2. Explicit Quality Communication

```markdown
## Quality Standards for this PRD

- Production code standards apply
- All functions must have JSDoc comments
- Test coverage minimum 80%
- No console.log in production code
- Error handling required for all async operations
```

### 3. AGENTS.md Documentation

Update project-level instruction files after completion:

```markdown
# AGENTS.md

## Discovered Patterns
- API routes use /api/v1/ prefix
- Database queries use Drizzle ORM
- State management via Zustand

## Critical Warnings
- Never import from @/lib/legacy/*
- Always use the Logger service, not console
- Auth middleware required on all /api/private/* routes
```

### 4. Frontend Verification

For UI tasks, include acceptance criteria:

```markdown
### Acceptance Criteria
- [ ] Component renders without errors
- [ ] Verify in browser using dev-browser skill
- [ ] Responsive on mobile viewport
- [ ] Keyboard navigation works
```

### 5. Watch Initial Runs

Always observe first iterations to:
- Validate prompt effectiveness
- Catch misunderstandings early
- Refine task definitions
- Build confidence before AFK

---

## Advanced Patterns

### Alternative Task Sources

RALPH can pull work from:
- Local JSON/Markdown files
- GitHub Issues
- Linear sprints
- Jira tickets
- Custom databases

### Specialized Loop Types

**Test Coverage Loop:**
```
1. Identify uncovered lines
2. Write test for highest-impact uncovered code
3. Verify coverage increased
4. Commit and repeat
```

**Linting Loop:**
```
1. Run linter, capture first error
2. Fix the error
3. Commit
4. Repeat until clean
```

**Duplication Loop:**
```
1. Detect code clones
2. Refactor into shared utility
3. Verify all usages work
4. Commit and repeat
```

**Entropy/Code Smell Loop:**
```
1. Identify worst code smell
2. Refactor to clean pattern
3. Verify tests pass
4. Commit and repeat
```

### Alternative Outputs

Instead of direct commits, RALPH can:
- Create branches and open PRs
- Add issue comments
- Update changelogs
- Generate reports
- Post to Slack/Discord

### Branch-and-PR Workflow

```bash
# PR-based RALPH
git checkout -b feat/ralph-$(date +%s)

# Run RALPH iterations...

gh pr create --title "RALPH: Feature Implementation" \
  --body "Automated implementation via RALPH pattern"
```

---

## Quick Reference

### Minimal RALPH Setup

1. Create `PRD.md` with task list
2. Create empty `progress.txt`
3. Run: `claude --permission-mode acceptEdits "@PRD.md @progress.txt [prompt]"`
4. Repeat until complete

### Essential Files

| File | Purpose |
|------|---------|
| `PRD.md` or `prd.json` | Task definitions |
| `progress.txt` | Iteration learnings |
| `AGENTS.md` | Project conventions |
| `ralph.sh` | Loop orchestration |

### Key Commands

```bash
# Single HITL iteration
./ralph-once.sh

# Autonomous with 20 iteration cap
./afk-ralph.sh 20

# Check task status
cat prd.json | jq '.userStories[] | {id, title, passes}'

# View learnings
cat progress.txt

# View git history
git log --oneline -10
```

---

## Sources

- [Getting Started With Ralph](https://www.aihero.dev/getting-started-with-ralph) - AI Hero
- [11 Tips For AI Coding With Ralph Wiggum](https://www.aihero.dev/tips-for-ai-coding-with-ralph-wiggum) - AI Hero
- [snarktank/ralph GitHub Repository](https://github.com/snarktank/ralph)
- [From ReAct to Ralph Loop](https://www.alibabacloud.com/blog/from-react-to-ralph-loop-a-continuous-iteration-paradigm-for-ai-agents_602799) - Alibaba Cloud
