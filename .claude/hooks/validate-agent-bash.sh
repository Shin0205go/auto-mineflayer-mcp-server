#!/bin/bash
# Restrict Bash: block /tmp writes for all sessions, subagent git/npm only
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Block /tmp file creation for ALL sessions (main + subagent)
if echo "$CMD" | grep -qE '(>|tee|cp|mv|touch|mkdir)\s+/tmp'; then
  echo "BLOCKED: Writing to /tmp is not allowed. Pass code directly to mc_execute." >&2
  exit 2
fi

# Check if running in a subagent
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // empty')

if [ -z "$AGENT_ID" ]; then
  # Main session — allow everything else
  exit 0
fi

# Subagent — allow git/npm/node scripts (CLI mode)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Block daemon restart — agents must NOT restart the daemon (disconnects all 7 bots)
if echo "$CMD" | grep -qE 'npm run daemon|npm run dev|node dist/daemon'; then
  echo "BLOCKED: Agents must not restart the daemon. Daemon is managed externally." >&2
  exit 2
fi

if echo "$CMD" | grep -qE '^(git|npm)(\s|$)'; then
  exit 0
fi

# Block admin-chat.cjs with admin commands (/, /give, /tp, /fill, /setblock, /place, /execute, /locate, /summon, /kill, /gamemode, /gamerule)
# Agents must NOT use admin powers — harness principle: agents play the game, not cheat it
if echo "$CMD" | grep -q 'admin-chat\.cjs'; then
  # Extract the message argument (everything after admin-chat.cjs)
  MSG=$(echo "$CMD" | sed 's/.*admin-chat\.cjs[[:space:]]*//')
  if echo "$MSG" | grep -qE '"[[:space:]]*/|'"'"'[[:space:]]*/|^[[:space:]]*/'; then
    echo "BLOCKED: Agents must not use admin commands via admin-chat.cjs. Chat messages only (no leading '/'). Got: $MSG" >&2
    exit 2
  fi
  exit 0
fi

# Allow Minecraft CLI scripts
if echo "$CMD" | grep -qE '(scripts/mc-execute\.cjs|scripts/mc-connect\.cjs|BOT_USERNAME=|MC_TIMEOUT=)'; then
  exit 0
fi

echo "BLOCKED: Subagent can only use git/npm/mc-scripts. Got: $CMD" >&2
exit 2
