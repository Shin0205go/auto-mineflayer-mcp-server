#!/bin/bash
#
# Minecraft自己改善ループ
# Claude Codeが自分でプレイ → 失敗分析 → コード修正 → 再プレイ
#

set -e

# ログディレクトリ
mkdir -p agent_logs

# ループカウンター
LOOP=0

echo "🎮 Starting Minecraft Self-Improvement Loop"
echo "   Running infinitely (Ctrl+C to stop)"
echo ""

while true; do
  LOOP=$((LOOP + 1))
  COMMIT=$(git rev-parse --short=6 HEAD)
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  LOGFILE="agent_logs/loop_${LOOP}_${COMMIT}_${TIMESTAMP}.log"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔄 Loop #$LOOP (commit: $COMMIT)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # プロンプトファイル作成（前回のログを含む）
  cat > /tmp/minecraft_prompt.md << 'PROMPT'
# Minecraft自己改善エージェント

## あなたの役割

Minecraftサーバー（localhost:60038）でサバイバルプレイをしながら、自己改善してください。

## タスク

1. **接続**: `minecraft_connect(host="localhost", port=60038, username="Claude", agentType="game")`
2. **状態確認**: `minecraft_get_status()` でHP/空腹度確認
3. **サバイバル**: 5分間プレイ
   - 食料確保（`minecraft_eat`）
   - 資源収集（`minecraft_dig_block`, `minecraft_collect_items`）
   - ツール作成（`minecraft_craft`）
   - 敵対MOB対策（`minecraft_attack`, `minecraft_flee`）
4. **エラー時の対応**:
   - ツール実行でエラーが発生したら：
     - ソースコードを読んで原因を特定
     - `Edit`ツールで修正
     - `npm run build` でビルド
     - 修正内容をGitコミット
5. **終了**: 5分経過したら `/exit` で終了

## 重要

- エラーが発生しても**諦めずに修正**してください
- 修正後は必ず `npm run build` を実行
- 修正内容は明確なコミットメッセージでGit保存

PROMPT

  # 前回のログがあれば追加
  PREV_LOG=$(ls -t agent_logs/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
    echo "" >> /tmp/minecraft_prompt.md
    echo "## 前回のログ（参考）" >> /tmp/minecraft_prompt.md
    echo "" >> /tmp/minecraft_prompt.md
    echo '```' >> /tmp/minecraft_prompt.md
    tail -100 "$PREV_LOG" >> /tmp/minecraft_prompt.md
    echo '```' >> /tmp/minecraft_prompt.md
  fi

  # Claude Code実行
  echo "▶️  Starting Claude Code..."
  echo "   Log: $LOGFILE"

  # Run Claude with timeout (10 minutes)
  cat /tmp/minecraft_prompt.md | claude --dangerously-skip-permissions \
    --print \
    --model sonnet \
    2>&1 | tee "$LOGFILE" &
  CLAUDE_PID=$!

  # Wait up to 600 seconds (10 minutes)
  EXIT_CODE=0
  for i in {1..600}; do
    if ! kill -0 $CLAUDE_PID 2>/dev/null; then
      wait $CLAUDE_PID
      EXIT_CODE=$?
      break
    fi
    sleep 1
  done

  # Kill if still running
  if kill -0 $CLAUDE_PID 2>/dev/null; then
    echo "" | tee -a "$LOGFILE"
    echo "⏱️  Timeout reached (10 minutes), stopping..." | tee -a "$LOGFILE"
    kill $CLAUDE_PID 2>/dev/null || true
    # Kill the entire process group (including tee)
    pkill -P $CLAUDE_PID 2>/dev/null || true
    wait $CLAUDE_PID 2>/dev/null || true
    EXIT_CODE=124
  fi

  echo ""
  if [ ${EXIT_CODE:-0} -eq 0 ]; then
    echo "✅ Completed successfully"
  elif [ ${EXIT_CODE:-0} -eq 124 ]; then
    echo "⏱️  Timeout (6 minutes) - moving to next loop"
  else
    echo "❌ Exited with code ${EXIT_CODE:-0}"
  fi

  # エラー数カウント
  ERROR_COUNT=$(grep -c "Error\|Failed\|Exception" "$LOGFILE" 2>/dev/null || true)
  TOOL_COUNT=$(grep -c "mcp__mineflayer" "$LOGFILE" 2>/dev/null || true)

  echo "📊 Stats:"
  echo "   - Tools used: $TOOL_COUNT"
  echo "   - Errors: $ERROR_COUNT"
  echo "   - Log: $LOGFILE"

  # Git変更チェック（新しいコミットがあるか）
  NEW_COMMIT=$(git rev-parse --short=6 HEAD)
  if [ "$NEW_COMMIT" != "$COMMIT" ]; then
    echo "🔧 Code improvements detected (new commit: $NEW_COMMIT)"

    # 自動プッシュ
    echo "📤 Pushing to remote..."
    if git push 2>&1 | tee -a "$LOGFILE"; then
      echo "✅ Pushed successfully"
    else
      echo "⚠️  Push failed (continuing anyway)"
    fi
  fi

  echo ""
  echo "⏳ Waiting 10 seconds before next loop..."
  sleep 10
done

echo ""
echo "🏁 Self-improvement loop stopped"
echo "📊 Completed $LOOP loops"
echo "📁 Logs saved in: agent_logs/"
