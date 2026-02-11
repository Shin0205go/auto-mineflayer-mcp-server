#!/bin/bash
# Simple wrapper to run Claude Code with prompt via pipe

cd /Users/shingo/Develop/minecraftAIViewer

# Read the initial prompt
PROMPT=$(cat scripts/initial-prompt.txt)

# Pipe prompt to Claude Code
echo "$PROMPT" | exec claude \
  --dangerously-skip-permissions \
  --mcp-config /Users/shingo/Develop/minecraftAIViewer/scripts/claude-mcp-config.json
