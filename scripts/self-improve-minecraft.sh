#!/bin/bash
#
# Minecraft自己改善ループ（並行稼働対応）
# Claude Codeが自分でプレイ → 失敗分析 → コード修正 → 再プレイ
#
# 使い方: ./scripts/self-improve-minecraft.sh [bot-id]
# 例:
#   Terminal 1: ./scripts/self-improve-minecraft.sh 1
#   Terminal 2: ./scripts/self-improve-minecraft.sh 2
#   Terminal 3: ./scripts/self-improve-minecraft.sh 3

set -e

# ボットID（引数で指定、デフォルト: 1）
BOT_ID=${1:-1}
BOT_NAME="Claude${BOT_ID}"

# ログディレクトリ（ボットごとに分離）
LOG_DIR="agent_logs/bot${BOT_ID}"
mkdir -p "$LOG_DIR"

# ループカウンター
LOOP=0

echo "🎮 Starting Minecraft Self-Improvement Loop"
echo "   Bot: $BOT_NAME (ID: $BOT_ID)"
echo "   Log directory: $LOG_DIR"
echo "   Running infinitely (Ctrl+C to stop)"
echo ""

while true; do
  LOOP=$((LOOP + 1))
  COMMIT=$(git rev-parse --short=6 HEAD)
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  LOGFILE="$LOG_DIR/loop_${LOOP}_${COMMIT}_${TIMESTAMP}.log"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔄 $BOT_NAME - Loop #$LOOP (commit: $COMMIT)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # 他のボットの改善を取り込む
  echo "📥 Pulling improvements from other bots..."
  git stash push -m "[$BOT_NAME] Auto-stash before loop $LOOP" 2>/dev/null || true

  if git pull --rebase origin $(git branch --show-current) 2>&1 | tee -a "$LOGFILE"; then
    NEW_COMMIT=$(git rev-parse --short=6 HEAD)
    if [ "$NEW_COMMIT" != "$COMMIT" ]; then
      echo "✅ Got new improvements ($COMMIT → $NEW_COMMIT), rebuilding..."
      npm run build > /dev/null 2>&1 && echo "✅ Rebuild complete"
      COMMIT=$NEW_COMMIT
    else
      echo "✅ Already up to date"
    fi
  else
    echo "⚠️  Pull failed, continuing with current version" | tee -a "$LOGFILE"
    git rebase --abort 2>/dev/null || true
  fi

  git stash pop 2>/dev/null || true
  echo ""

  # プロンプトファイル作成（前回のログを含む）
  cat > /tmp/minecraft_prompt_bot${BOT_ID}.md << PROMPT
# Minecraft自己改善エージェント - $BOT_NAME

## あなたの役割

Minecraftサーバー（localhost:25565）でサバイバルプレイをしながら、自己改善してください。
あなたは **$BOT_NAME** です（複数ボットが並行稼働中）。

## タスク

1. **接続**: \`minecraft_connect(host="localhost", port=25565, username="$BOT_NAME", agentType="game")\`
2. **状態確認**: \`minecraft_get_status()\` でHP/空腹度確認
3. **サバイバル**: 5分間プレイ
   - 食料確保（\`minecraft_eat\`）
   - 資源収集（\`minecraft_dig_block\`, \`minecraft_collect_items\`）
   - ツール作成（\`minecraft_craft\`）
   - 敵対MOB対策（\`minecraft_attack\`, \`minecraft_flee\`）
4. **エラー時の対応**:
   - ツール実行でエラーが発生したら：
     - ソースコードを読んで原因を特定
     - \`Edit\`ツールで修正
     - \`npm run build\` でビルド
     - 修正内容をGitコミット（コミットメッセージに[$BOT_NAME]を含める）
5. **終了**: 5分経過したら \`/exit\` で終了

## 重要

- エラーが発生しても**諦めずに修正**してください
- 修正後は必ず \`npm run build\` を実行
- 修正内容は明確なコミットメッセージでGit保存
- コミットメッセージの先頭に **[$BOT_NAME]** を付けてください
- 他のボット（Claude1, Claude2...）が同じワールドでプレイしている可能性があります

PROMPT

  # 前回のログがあれば追加
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
    echo "" >> /tmp/minecraft_prompt_bot${BOT_ID}.md
    echo "## 前回のログ（参考）" >> /tmp/minecraft_prompt_bot${BOT_ID}.md
    echo "" >> /tmp/minecraft_prompt_bot${BOT_ID}.md
    echo '```' >> /tmp/minecraft_prompt_bot${BOT_ID}.md
    tail -100 "$PREV_LOG" >> /tmp/minecraft_prompt_bot${BOT_ID}.md
    echo '```' >> /tmp/minecraft_prompt_bot${BOT_ID}.md
  fi

  # Claude Code実行
  echo "▶️  Starting Claude Code ($BOT_NAME)..."
  echo "   Log: $LOGFILE"

  # Run Claude with timeout (20 minutes)
  # stream-json でリアルタイム出力
  (cat /tmp/minecraft_prompt_bot${BOT_ID}.md | claude --dangerously-skip-permissions \
    --print \
    --verbose \
    --output-format stream-json \
    --model sonnet) > "$LOGFILE" 2>&1 &
  CLAUDE_PID=$!

  # Wait up to 1200 seconds (20 minutes)
  EXIT_CODE=0
  for i in {1..1200}; do
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
    echo "⏱️  Timeout reached (20 minutes), stopping..." | tee -a "$LOGFILE"
    # Kill the subshell and all its children
    pkill -P $CLAUDE_PID 2>/dev/null || true
    kill $CLAUDE_PID 2>/dev/null || true
    wait $CLAUDE_PID 2>/dev/null || true
    EXIT_CODE=124
  fi

  echo ""
  if [ ${EXIT_CODE:-0} -eq 0 ]; then
    echo "✅ Completed successfully"
  elif [ ${EXIT_CODE:-0} -eq 124 ]; then
    echo "⏱️  Timeout (20 minutes) - moving to next loop"
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
    echo "🔧 [$BOT_NAME] Code improvements detected (new commit: $NEW_COMMIT)"

    # 自動プッシュ（他のボットと改善を共有）
    echo "📤 Pushing to remote..."

    # Pull-rebase してから push（競合回避）
    git pull --rebase origin $(git branch --show-current) 2>&1 | tee -a "$LOGFILE" || {
      echo "⚠️  Rebase failed, aborting" | tee -a "$LOGFILE"
      git rebase --abort 2>/dev/null || true
    }

    if git push 2>&1 | tee -a "$LOGFILE"; then
      echo "✅ Pushed successfully (improvements shared with other bots)"
    else
      echo "⚠️  Push failed (another bot may have pushed first, will retry next loop)"
    fi
  fi

  echo ""
  echo "⏳ Waiting 10 seconds before next loop..."
  sleep 10
done

echo ""
echo "🏁 [$BOT_NAME] Self-improvement loop stopped"
echo "📊 Completed $LOOP loops"
echo "📁 Logs saved in: $LOG_DIR/"
