#!/bin/bash
# Run Claude Code in a loop for continuous autonomous play

set -e

cd /Users/shingo/Develop/minecraftAIViewer

echo "🔄 Starting Claude Code autonomous loop..."
echo "Press Ctrl+C to stop"
echo ""

ITERATION=0

while true; do
  ITERATION=$((ITERATION + 1))
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🤖 Iteration #$ITERATION - $(date '+%Y-%m-%d %H:%M:%S')"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Run Claude Code without continue (fresh connection each time)
  # --print mode will execute and exit, then loop restarts
  claude \
    --dangerously-skip-permissions \
    --mcp-config /Users/shingo/Develop/minecraftAIViewer/scripts/claude-mcp-config.json \
    --print \
    "Minecraftサーバー（localhost:60038）に接続して1つのタスクを完了してください。minecraft_connectで接続、木を集める/食料を探す/ツールを作るなどの具体的な行動を1つ実行して終了。"

  EXIT_CODE=$?
  echo ""
  echo "Exit code: $EXIT_CODE"

  # Wait before next iteration
  echo "Waiting 5 seconds before next iteration..."
  sleep 5
done
