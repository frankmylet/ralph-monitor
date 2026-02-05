# Docker AI Sandboxes: Technical Research Summary

**Last Updated**: 2026-02-05
**Purpose**: Evaluating Docker AI Sandboxes for running autonomous Claude Code agents with database and dev server access

---

## Executive Summary

Docker AI Sandboxes provide microVM-based isolation for running AI coding agents autonomously. While they offer strong security boundaries, **the default configuration blocks localhost/host service access** - a critical limitation for our use case. However, this can be configured through network policies to allow specific localhost ports.

**Verdict**: Suitable for autonomous agent infrastructure with proper network policy configuration.

---

## 1. Architecture and Isolation Model

### MicroVM Foundation

Docker Sandboxes use **hypervisor-level isolation** via system-native virtualization:
- **macOS**: Uses `virtualization.framework`
- **Windows**: Uses Hyper-V
- **Linux**: Uses legacy container-based sandboxes (Docker Desktop 4.57+)

Each sandbox runs:
- A complete, isolated virtual machine with its own kernel
- A private Docker daemon (completely isolated from host Docker)
- Bidirectional file syncing at matching absolute paths

### Key Isolation Properties

| Component | Isolation Level |
|-----------|-----------------|
| Process | Separate kernel execution space |
| Filesystem | Only workspace directories accessible |
| Docker | No host daemon/container/image access |
| Network | Sandboxes cannot communicate with each other |

### Resource Overhead

MicroVMs trade higher resource overhead (full VM plus daemon) for complete isolation:
- **Firecracker-style boot**: ~125ms
- **Memory overhead**: <5 MiB per VM
- **Scalability**: Up to 150 VMs per second per host

---

## 2. Network Connectivity Options

### Default Network Behavior

**Outbound Access**: Sandboxes can access external internet through the host's network connection.

**HTTP/HTTPS Proxy**: A filtering proxy runs on the host at `host.docker.internal:3128`. Agents automatically route web requests through this proxy.

**Default CIDR Blocks** (blocked by default):
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC 1918 private networks)
- `127.0.0.0/8` (localhost) - **THIS IS THE KEY LIMITATION**
- `169.254.0.0/16` (link-local)
- `::1/128`, `fc00::/7`, `fe80::/10` (IPv6 equivalents)

### Configuring Host Service Access (Databases, Dev Servers)

**Critical Finding**: Localhost access IS possible but requires explicit configuration.

To allow access to localhost services (databases, dev servers):

```bash
# Allow specific localhost port (e.g., PostgreSQL on 5432)
docker sandbox network proxy my-sandbox \
  --policy allow \
  --allow-host localhost:5432

# Allow multiple services
docker sandbox network proxy my-sandbox \
  --policy allow \
  --allow-host localhost:5432 \
  --allow-host localhost:3000 \
  --allow-host localhost:8080
```

**Important**: You MUST include the port number. Without a specific port, localhost connections are blocked by default CIDR rules.

### Network Policy Management

```bash
# View current policies
docker sandbox network log

# Apply policy (sandbox must be running)
docker sandbox network proxy my-sandbox \
  --policy allow \
  --block-cidr 192.168.0.0/16

# Deny all except specific hosts
docker sandbox network proxy my-sandbox \
  --policy deny \
  --allow-host api.anthropic.com \
  --allow-host "*.npmjs.org" \
  --allow-host localhost:5432
```

### Policy Configuration Files

- **Per-sandbox**: `~/.docker/sandboxes/vm/my-sandbox/proxy-config.json`
- **Default (new sandboxes)**: `~/.sandboxd/proxy-config.json`

Copy a sandbox policy to become the default:
```bash
cp ~/.docker/sandboxes/vm/my-sandbox/proxy-config.json ~/.sandboxd/proxy-config.json
```

---

## 3. Running Claude Code Inside Sandboxes

### Basic Usage

```bash
# Run Claude Code in sandbox
docker sandbox run claude ~/my-project

# List sandboxes
docker sandbox ls

# Access running sandbox interactively
docker sandbox exec -it <name> bash

# Remove sandbox
docker sandbox rm <name>
```

### Claude Code Configuration

**Autonomous Mode**: Claude launches with `--dangerously-skip-permissions` by default in sandboxes. This enables autonomous agent execution without constant permission prompts while maintaining security through sandbox isolation.

**Environment Variables**: Must be set in shell configuration file (~/.bashrc or ~/.zshrc), then restart Docker Desktop. The daemon doesn't inherit environment variables from current shell session.

```bash
# Add to ~/.bashrc or ~/.zshrc
export ANTHROPIC_API_KEY=sk-ant-api03-xxxxx

# Then restart Docker Desktop
```

**CLI Options**: Pass after `--` separator:
```bash
docker sandbox run my-sandbox -- --model claude-sonnet-4-20250514
```

### Pre-installed Tools

The sandbox includes:
- Docker CLI
- GitHub CLI (gh)
- Node.js
- Go
- Python 3
- Git

---

## 4. Security Model

### What's Isolated

| Protected Resource | Isolation Method |
|-------------------|------------------|
| Host Docker daemon | Private daemon per sandbox |
| Host containers | No access |
| SSH keys (~/.ssh/) | Not accessible |
| AWS credentials (~/.aws/) | Not accessible |
| Home directory | Only project directory accessible |
| Host network services | Blocked by default (configurable) |
| Other sandboxes | Network namespace separation |

### What's Shared/Accessible

| Resource | Access Method |
|----------|---------------|
| Project workspace | Bidirectional sync at same absolute path |
| External internet | Via host network + proxy |
| Docker socket | Optional: `--mount-docker-socket` flag (requires sudo inside) |
| Environment variables | Set at creation time via `-e` flags |

### Protection Against Prompt Injection

Even if an attacker manipulates Claude Code through prompt injection:

**Filesystem Protection**:
- Cannot modify critical config files (`~/.bashrc`)
- Cannot modify system files (`/bin/`)
- Cannot read denied files from permission settings

**Network Protection**:
- Cannot exfiltrate data to unapproved servers
- Cannot download malicious scripts from unauthorized domains
- Cannot make API calls to unapproved services

---

## 5. Configuration for Database/Dev Server Access

### Recommended Configuration for Our Use Case

For running autonomous agents that need PostgreSQL and dev server access:

```bash
# Create sandbox with project
docker sandbox run claude ~/code/ralph-monitor

# Configure network policies for local services
docker sandbox network proxy claude-sandbox \
  --policy allow \
  --allow-host localhost:5432 \
  --allow-host localhost:5433 \
  --allow-host localhost:3000 \
  --allow-host localhost:8080 \
  --allow-host api.anthropic.com \
  --allow-host "*.npmjs.org" \
  --allow-host "*.pypi.org" \
  --allow-host github.com
```

### Environment Variables for Database Access

```bash
# In ~/.bashrc or ~/.zshrc
export ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
export DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
```

---

## 6. Practical Limitations and Gotchas

### Critical Limitations

| Limitation | Impact | Workaround |
|------------|--------|------------|
| Localhost blocked by default | Cannot access databases/dev servers | Configure `--allow-host localhost:PORT` |
| One sandbox per workspace | Cannot run multiple agents per directory | Use different workspace paths |
| Environment variables not reloadable | Must destroy/recreate sandbox to change | Store config in project files |
| Linux requires Docker Desktop 4.57+ | Legacy container-based (not microVM) | Use macOS/Windows for full isolation |

### Known Issues

1. **Git identity auto-injection**: Broken - user name/email not injected despite host configuration
   - **Workaround**: Manually configure inside sandbox:
   ```bash
   git config --global user.name "Your Name"
   git config --global user.email "you@example.com"
   ```

2. **Docker commands require sudo**: When using `--mount-docker-socket`
   ```bash
   sudo docker ps  # Required inside sandbox
   ```

3. **State persistence trade-off**: Destroying sandbox loses installed packages

4. **watchman incompatible**: Use `jest --no-watchman` instead

5. **Docker CLI incompatible with native sandbox**: Add to `excludedCommands` to run outside sandbox

### Platform-Specific Notes

| Platform | Support Level | Notes |
|----------|--------------|-------|
| macOS | Full | MicroVM via virtualization.framework |
| Windows | Experimental | MicroVM via Hyper-V |
| Linux | Limited | Legacy container-based with Docker Desktop 4.57+ |
| WSL1 | Not Supported | Requires WSL2 for bubblewrap |

---

## 7. Suitability for Autonomous Claude Code Agents

### Advantages

1. **True isolation**: Hypervisor-level separation prevents kernel exploits
2. **Autonomous execution**: `--dangerously-skip-permissions` runs safely within boundaries
3. **Full Docker access**: Agents can build/run containers without affecting host
4. **Path preservation**: Absolute paths match between host and sandbox
5. **Network policy control**: Fine-grained control over what agents can access

### Challenges for Our Use Case

1. **Database access requires configuration**: Must explicitly allow localhost ports
2. **MCP servers**: May need Unix socket access (security consideration)
3. **Dev server access**: Must whitelist each port
4. **Linux limitations**: Only container-based isolation (not microVM)

### Recommended Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Host Machine                          │
│                                                          │
│  ┌──────────────────┐  ┌──────────────────┐             │
│  │  PostgreSQL      │  │  Dev Server      │             │
│  │  localhost:5432  │  │  localhost:3000  │             │
│  └────────┬─────────┘  └────────┬─────────┘             │
│           │                     │                        │
│           │    Network Policy   │                        │
│           │    (allow-host)     │                        │
│           ▼                     ▼                        │
│  ┌───────────────────────────────────────────────┐      │
│  │              Docker Sandbox (MicroVM)          │      │
│  │                                                │      │
│  │  ┌─────────────────────────────────────────┐  │      │
│  │  │           Claude Code Agent              │  │      │
│  │  │     --dangerously-skip-permissions       │  │      │
│  │  │                                          │  │      │
│  │  │  Can access:                             │  │      │
│  │  │  - localhost:5432 (PostgreSQL)           │  │      │
│  │  │  - localhost:3000 (Dev server)           │  │      │
│  │  │  - api.anthropic.com (Claude API)        │  │      │
│  │  │  - Package registries                    │  │      │
│  │  └─────────────────────────────────────────┘  │      │
│  │                                                │      │
│  │  Private Docker daemon (isolated)             │      │
│  │  Workspace synced at /home/user/code/project  │      │
│  └───────────────────────────────────────────────┘      │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 8. Alternative Approaches Comparison

| Approach | Startup | Security | Host DB Access | Recommendation |
|----------|---------|----------|----------------|----------------|
| Docker Sandbox (MicroVM) | ~125ms | Hardware-enforced | Configurable | **Best for untrusted agents** |
| gVisor | Milliseconds | Syscall-level | Easier | Good for compute-heavy workloads |
| Standard Docker | Milliseconds | Process-level | Native | Only for trusted code |
| Claude Code Native Sandbox | Instant | OS-level (bubblewrap/Seatbelt) | Configurable | Good for single-machine use |

---

## 9. Getting Started Checklist

For autonomous agents with database access:

- [ ] Install Docker Desktop 4.58+
- [ ] Set `ANTHROPIC_API_KEY` in shell config (~/.bashrc or ~/.zshrc)
- [ ] Restart Docker Desktop
- [ ] Create sandbox: `docker sandbox run claude ~/project`
- [ ] Configure network policies for localhost ports
- [ ] Test database connectivity from within sandbox
- [ ] Configure default proxy-config.json for new sandboxes

---

## Sources

- [Docker Sandboxes Documentation](https://docs.docker.com/ai/sandboxes/)
- [Docker Sandbox Architecture](https://docs.docker.com/ai/sandboxes/architecture/)
- [Network Policies Documentation](https://docs.docker.com/ai/sandboxes/network-policies/)
- [Claude Code Sandboxing Documentation](https://code.claude.com/docs/en/sandboxing)
- [Configure Claude Code in Docker](https://docs.docker.com/ai/sandboxes/claude-code/)
- [Docker Sandboxes: A New Approach for Coding Agent Safety](https://www.docker.com/blog/docker-sandboxes-a-new-approach-for-coding-agent-safety/)
- [How to Sandbox AI Agents in 2026](https://northflank.com/blog/how-to-sandbox-ai-agents)
- [Getting Started with Docker Sandboxes Tutorial](https://dev.to/ajeetraina/getting-started-with-docker-sandboxes-a-complete-hands-on-tutorials-and-guide-15b2)
