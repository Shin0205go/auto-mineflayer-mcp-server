#!/bin/bash
# Restrict subagent Bash to git/npm only (main session is unrestricted)
INPUT=$(cat)

# Check if running in a subagent
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // empty')

if [ -z "$AGENT_ID" ]; then
  # Main session — allow everything
  exit 0
fi

# Subagent — only allow git/npm
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$CMD" | grep -qE '^(git|npm)(\s|$)'; then
  exit 0
fi

echo "BLOCKED: Subagent can only use git/npm. Got: $CMD" >&2
exit 2
