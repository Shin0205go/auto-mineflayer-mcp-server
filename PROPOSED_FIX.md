# Proposed Fix: Two-Tier Self-Improvement Architecture

## Current Issue

The `self-improve-minecraft.sh` script invokes Claude Code CLI with a prompt that includes instructions to:
1. Connect to Minecraft via `minecraft_connect()`
2. Play for 5 minutes
3. Fix errors if they occur

However, there's architectural confusion about whether Claude Code CLI has access to Minecraft MCP tools.

## Investigation Results

### Configured MCP Server
- `.claude/mcp.json` points to `ws://localhost:8765`
- MCP WS Server is running (PID 95344)
- Should theoretically provide minecraft tools to Claude Code CLI

### Two Separate Processes
1. **Game Agent** (`dist/agent/claude-agent.js`)
   - Connects to MCP WS Server
   - Uses Claude SDK to play Minecraft autonomously
   - Has direct access to minecraft_ MCP tools

2. **Claude Code CLI** (invoked by script)
   - Command-line tool for code analysis
   - Configured to connect to MCP servers via `.claude/mcp.json`
   - Unclear if it actually loads MCP tools from WS transport

## Proposed Solution A: Two-Tier Architecture (Recommended)

Update `self-improve-minecraft.sh` to separate gameplay from debugging:

```bash
# Phase 1: Gameplay (5 minutes)
echo "🎮 Phase 1: Gameplay ($BOT_NAME)"
BOT_USERNAME="$BOT_NAME" START_MCP_SERVER=false \
  timeout 300 node dist/agent/claude-agent.js > "$LOGFILE.gameplay" 2>&1
GAMEPLAY_EXIT=$?

# Phase 2: Analysis (only if errors occurred)
if [ $GAMEPLAY_EXIT -ne 0 ] || grep -q "Error\|Exception\|Failed" "$LOGFILE.gameplay"; then
  echo "🔧 Phase 2: Error Analysis & Code Fix"

  cat > /tmp/claude_fix_prompt_bot${BOT_ID}.md << PROMPT
# Debug and Fix Errors - $BOT_NAME

## Gameplay Log
\`\`\`
$(tail -200 "$LOGFILE.gameplay")
\`\`\`

## Your Task
1. Analyze the errors above
2. Read relevant source files
3. Use Edit tool to fix the bugs
4. Run \`npm run build\`
5. Commit with message: [$BOT_NAME] Fix: <description>

PROMPT

  cat /tmp/claude_fix_prompt_bot${BOT_ID}.md | claude \
    --dangerously-skip-permissions \
    --model opus \
    > "$LOGFILE.fix" 2>&1
fi
```

### Benefits
- Clear separation of concerns
- Game Agent plays Minecraft (what it's designed for)
- Claude Code analyzes errors (what it's good at)
- More efficient (only invoke Claude Code when errors occur)

## Proposed Solution B: Verify MCP Access (Quick Test)

Before changing the architecture, verify if Claude Code CLI actually has MCP access:

```bash
# Test if Claude Code can see MCP tools
echo "List available MCP tools" | claude --print

# If tools are listed, current architecture works
# If not, need Solution A
```

## Implementation Plan

1. Test Solution B first (quick verification)
2. If Claude Code has MCP access:
   - Current script is fine, just need to wait longer for gameplay
3. If Claude Code lacks MCP access:
   - Implement Solution A (two-tier architecture)
   - Update all 3 bot scripts (bot1, bot2, bot3)

## Expected Outcome

- Bot1, Bot2, Bot3 can play Minecraft concurrently
- Errors are automatically debugged and fixed
- Improvements are shared via git pull/push
- True self-improvement loop achieved
