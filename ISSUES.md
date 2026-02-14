# Known Issues - Claude1 Bot

## Issue #1: MCP Port Conflict (2026-02-14)

### Problem
Multiple bot instances (bot1, bot2, bot3) cannot run simultaneously because they all try to use port 8765 for the MCP WebSocket server.

### Root Cause
- `src/mcp-ws-server.ts` hardcodes port 8765
- `.claude/mcp.json` hardcodes ws://localhost:8765
- When bot3's MCP server is running, bot1 cannot start its own server

### Impact
- **Critical**: Claude Code agents cannot connect to their respective MCP servers
- Prevents multi-bot parallel gameplay
- Breaks the "Claude1, Claude2, Claude3" multi-agent architecture mentioned in CLAUDE.md

### Solution Options

#### Option A: Dynamic Port Assignment (Recommended)
```typescript
// src/mcp-ws-server.ts
const PORT = parseInt(process.env.MCP_WS_PORT || "8765");
```

```bash
# .env for bot1
MCP_WS_PORT=8765

# .env for bot2
MCP_WS_PORT=8766

# .env for bot3
MCP_WS_PORT=8767
```

#### Option B: Single Shared MCP Server
- One MCP server handles multiple bot connections
- Each bot identified by username
- Requires refactoring bot state management

#### Option C: Project-Specific Ports
- bot1: 8765
- bot2: 8766
- bot3: 8767
- Update `.claude/mcp.json` per project

### Status
🔴 **BLOCKING** - Claude1 cannot play Minecraft until this is fixed

### Attempted Workarounds
- ❌ Starting MCP server for bot1 → EADDRINUSE error
- ❌ Connecting to bot3's MCP server → Wrong project context
- ❌ Killing bot3 MCP server → Processes respawn automatically

### Additional Investigation
Bot3 processes (PID 95313, 95344, 95473) keep respawning, suggesting:
1. They are managed by a process supervisor (PM2, systemd, etc.)
2. Or they are launched by Claude Code in another window
3. Need to identify the parent process or stop mechanism

### Immediate Fix Required
Since bot1, bot2, bot3 are separate project directories, they MUST use different ports:
- bot1: Port 8765 + update `.claude/mcp.json` to ws://localhost:8765
- bot2: Port 8766 + update `.claude/mcp.json` to ws://localhost:8766
- bot3: Port 8767 + update `.claude/mcp.json` to ws://localhost:8767

**Action**: Stop all other bot instances, then start bot1 MCP server on port 8765

---

## Issue #2: Inventory Loss After Death (from previous log)

### Problem
After dying and respawning, the bot had only "dirt x2" in inventory, lost the birch_log that was collected.

### Root Cause
Minecraft death mechanics - items drop at death location unless keepInventory gamerule is enabled.

### Solution
```bash
/gamerule keepInventory true
```

### Status
⚠️ **MINOR** - Can be worked around by retrieving items from death location
