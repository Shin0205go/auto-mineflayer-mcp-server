#!/bin/bash
#
# Game Agent自動実行ループ（WebSocket版MCP使用）
#

set -e

mkdir -p agent_logs/game_agent

LOOP=0
MAX_LOOPS=50

echo "🎮 Starting Game Agent Self-Improvement Loop"
echo "   Using WebSocket MCP (port 8765)"
echo "   Max loops: $MAX_LOOPS"
echo ""

while [ $LOOP -lt $MAX_LOOPS ]; do
  LOOP=$((LOOP + 1))
  COMMIT=$(git rev-parse --short=6 HEAD)
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  LOGFILE="agent_logs/game_agent/loop_${LOOP}_${COMMIT}_${TIMESTAMP}.log"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔄 Loop #$LOOP (commit: $COMMIT)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Game Agent実行（5分でタイムアウト）
  echo "▶️  Starting Game Agent..."
  echo "   Log: $LOGFILE"

  npm run start:game-agent 2>&1 | tee "$LOGFILE" &
  AGENT_PID=$!

  # 5分待機
  for i in {1..300}; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      wait $AGENT_PID
      EXIT_CODE=$?
      break
    fi
    sleep 1
  done

  # タイムアウト処理
  if kill -0 $AGENT_PID 2>/dev/null; then
    echo "" | tee -a "$LOGFILE"
    echo "⏱️  Timeout (5 minutes), stopping..." | tee -a "$LOGFILE"
    kill $AGENT_PID 2>/dev/null
    wait $AGENT_PID 2>/dev/null
    EXIT_CODE=124
  fi

  echo ""
  if [ ${EXIT_CODE:-0} -eq 0 ]; then
    echo "✅ Completed successfully"
  else
    echo "⚠️  Exited with code ${EXIT_CODE:-0}"
  fi

  # エラー数カウント
  ERROR_COUNT=$(grep -c "Error\|Failed" "$LOGFILE" 2>/dev/null || true)
  echo "📊 Errors found: $ERROR_COUNT"

  # Git変更チェック
  if ! git diff --quiet; then
    echo "🔧 Code changes detected"
    NEW_COMMIT=$(git rev-parse --short=6 HEAD)
    if [ "$NEW_COMMIT" != "$COMMIT" ]; then
      echo "   New commit: $NEW_COMMIT"
    fi
  fi

  echo ""
  echo "⏳ Waiting 10 seconds before next loop..."
  sleep 10
done

echo ""
echo "🏁 Completed $MAX_LOOPS loops"
