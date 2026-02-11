#!/bin/bash
# Run Claude Code in interactive mode with auto-restart

set -e

cd /Users/shingo/Develop/minecraftAIViewer

echo "🎮 Starting Claude Code interactive loop..."
echo "Claude will restart automatically if it exits"
echo "Press Ctrl+C to stop"
echo ""

ITERATION=0
INITIAL_PROMPT="Minecraftサーバーに接続してプレイを開始してください。

minecraft_connectツールを使用して以下の設定で接続：
- host: localhost
- port: 60038
- username: Claude

接続後、周囲を確認してサバイバルモードでプレイを開始してください。"

while true; do
  ITERATION=$((ITERATION + 1))
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🤖 Session #$ITERATION - $(date '+%Y-%m-%d %H:%M:%S')"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # On first iteration, use initial prompt
  # On subsequent iterations, use --continue to resume
  if [ $ITERATION -eq 1 ]; then
    echo "$INITIAL_PROMPT" | claude \
      --dangerously-skip-permissions \
      --mcp-config /Users/shingo/Develop/minecraftAIViewer/scripts/claude-mcp-config.json
  else
    # Continue previous session
    echo "Resuming previous session..."
    echo "continue" | claude \
      --continue \
      --dangerously-skip-permissions \
      --mcp-config /Users/shingo/Develop/minecraftAIViewer/scripts/claude-mcp-config.json
  fi

  EXIT_CODE=$?
  echo ""
  echo "Claude exited with code: $EXIT_CODE"
  echo "Restarting in 3 seconds..."
  sleep 3
done
