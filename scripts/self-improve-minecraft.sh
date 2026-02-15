#!/bin/bash
#
# Minecraft自己改善ループ（並行稼働対応）
# Claude Codeが自分でプレイ → 失敗分析 → コード修正 → 再プレイ
#
# 使い方: ./scripts/self-improve-minecraft.sh [bot-id] [model]
# 例:
#   Terminal 1: ./scripts/self-improve-minecraft.sh 1 opus
#   Terminal 2: ./scripts/self-improve-minecraft.sh 2 opus

# エラーでスクリプトが死なないようにする（set -eを使わない）

# ボットID（引数で指定、デフォルト: 1）
BOT_ID=${1:-1}
BOT_NAME="Claude${BOT_ID}"
# モデル（引数2で指定、デフォルト: sonnet）
MODEL=${2:-sonnet}

# ログディレクトリ（ボットごとに分離）
LOG_DIR="agent_logs/bot${BOT_ID}"
mkdir -p "$LOG_DIR"

# ループカウンター
LOOP=0

# Claude子プロセスPID（クリーンアップ用）
CLAUDE_PID=""

# クリーンアップ関数
cleanup() {
  echo ""
  echo "🛑 [$BOT_NAME] Shutting down..."
  if [ ! -z "$CLAUDE_PID" ] && kill -0 $CLAUDE_PID 2>/dev/null; then
    pkill -P $CLAUDE_PID 2>/dev/null || true
    kill $CLAUDE_PID 2>/dev/null || true
    wait $CLAUDE_PID 2>/dev/null || true
  fi
  echo "🏁 [$BOT_NAME] Self-improvement loop stopped"
  echo "📊 Completed $LOOP loops"
  echo "📁 Logs saved in: $LOG_DIR/"
  exit 0
}

# Ctrl+C / SIGTERM でクリーンアップ
trap cleanup SIGINT SIGTERM

echo "🎮 Starting Minecraft Self-Improvement Loop"
echo "   Bot: $BOT_NAME (ID: $BOT_ID)"
echo "   Model: $MODEL"
echo "   Log directory: $LOG_DIR"
echo "   Running infinitely (Ctrl+C to stop)"
echo ""

# 起動タイミングをずらす（競合回避）
STARTUP_DELAY=$((BOT_ID * 10))
if [ $STARTUP_DELAY -gt 0 ]; then
  echo "⏳ Waiting ${STARTUP_DELAY}s to avoid connection conflicts..."
  sleep $STARTUP_DELAY
fi

while true; do
  LOOP=$((LOOP + 1))
  COMMIT=$(git rev-parse --short=6 HEAD 2>/dev/null || echo "unknown")
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  LOGFILE="$LOG_DIR/loop_${LOOP}_${COMMIT}_${TIMESTAMP}.log"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔄 $BOT_NAME - Loop #$LOOP (commit: $COMMIT)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # mainから最新の改善を取り込む
  echo "📥 Merging latest improvements from main..."
  git stash push -m "[$BOT_NAME] Auto-stash before loop $LOOP" 2>/dev/null || true

  if git merge main --no-edit 2>&1 | tee -a "$LOGFILE"; then
    NEW_COMMIT=$(git rev-parse --short=6 HEAD 2>/dev/null || echo "unknown")
    if [ "$NEW_COMMIT" != "$COMMIT" ]; then
      echo "✅ Got new improvements from main ($COMMIT → $NEW_COMMIT), rebuilding..."
      npm run build > /dev/null 2>&1 && echo "✅ Rebuild complete"
      COMMIT=$NEW_COMMIT
    else
      echo "✅ Already up to date with main"
    fi
  else
    echo "⚠️  Merge failed, aborting" | tee -a "$LOGFILE"
    git merge --abort 2>/dev/null || true
  fi

  git stash pop 2>/dev/null || true
  echo ""

  # プロンプトファイル作成（前回のログを含む）
  cat > /tmp/minecraft_prompt_bot${BOT_ID}.md << PROMPT
# Minecraft - $BOT_NAME

あなたは **$BOT_NAME** です。今すぐMinecraftをプレイしてください。

## 最初のアクション（必須）

1. \`minecraft_get_chat_messages()\` - 他のbotからのメッセージ確認
2. \`minecraft_get_status()\` - 現在の状態確認
3. \`minecraft_get_position()\` - 現在地確認
4. \`minecraft_get_surroundings()\` - 周囲確認

## チャット連携（重要）

他のbot（Claude1〜Claude5）と同じワールドにいます。**チャットで情報を共有してください。**

### 送信すべき情報（minecraft_chat）
- 食料・動物を見つけた → \`「食料: 牛を発見 (x=50, z=-30)」\`
- 有用な資源 → \`「資源: 鉄鉱石 (x=10, y=40, z=-20)」\`
- チェストに物を入れた → \`「チェスト(x=5, z=4)に食料入れた」\`
- 危険な場所 → \`「警告: クリーパー多数 (x=-30, z=50)」\`

### 受信したら（minecraft_get_chat_messages）
- 他のbotが共有した座標を活用する
- 食料情報は最優先で確認
- **5〜10アクションごとにチャットを確認すること**

## ゲームプレイ

- 食料確保を最優先
- 木を探して採掘
- ツールを作成
- 敵から逃げる
- 発見した情報はチャットで共有

## コード改善（重要）

プレイ中にツールの不具合や改善点を見つけたら、**自分でコードを修正してください。**

### やること
1. 問題を発見したら \`bug-issues/bot${BOT_ID}.md\` に記録
2. 原因を調査（\`src/\` 以下のコードを読む）
3. 修正できるなら \`src/\` のコードを直接修正
4. 修正後は \`npm run build\` でビルド確認
5. 動作確認してからgit commit

### よくある改善ポイント
- ツールのエラーメッセージがわかりにくい → メッセージ改善
- 特定の操作が失敗しやすい → エラーハンドリング追加
- 移動・採掘の効率が悪い → ロジック改善
- 足りない機能がある → 新しいツールや機能を追加

### 注意
- \`src/\` と \`.claude/skills/\` と \`bug-issues/bot${BOT_ID}.md\` のみ編集可能
- 他のbotのbug-issuesファイルは編集しないこと
- ビルドが通らない修正はコミットしないこと

**まずゲームをプレイし、問題を見つけたらコードを改善！今すぐ minecraft_get_chat_messages() を実行！**

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
  # 環境変数でMCPサーバーに設定を渡す
  export BOT_USERNAME="$BOT_NAME"
  export ENABLE_VIEWER="${ENABLE_VIEWER:-false}"
  cat /tmp/minecraft_prompt_bot${BOT_ID}.md | claude --dangerously-skip-permissions \
    --print \
    --verbose \
    --output-format stream-json \
    --model $MODEL > "$LOGFILE" 2>&1 &
  CLAUDE_PID=$!

  # Wait up to 1200 seconds (20 minutes)
  EXIT_CODE=0
  WAITED=0
  while [ $WAITED -lt 1200 ]; do
    if ! kill -0 $CLAUDE_PID 2>/dev/null; then
      wait $CLAUDE_PID 2>/dev/null
      EXIT_CODE=$?
      break
    fi
    sleep 1
    WAITED=$((WAITED + 1))
  done

  # Kill if still running (プロセスグループごと)
  if kill -0 $CLAUDE_PID 2>/dev/null; then
    echo "" | tee -a "$LOGFILE"
    echo "⏱️  Timeout reached (20 minutes), stopping..." | tee -a "$LOGFILE"
    pkill -P $CLAUDE_PID 2>/dev/null || true
    kill $CLAUDE_PID 2>/dev/null || true
    sleep 2
    # まだ残ってたら強制kill
    pkill -9 -P $CLAUDE_PID 2>/dev/null || true
    kill -9 $CLAUDE_PID 2>/dev/null || true
    wait $CLAUDE_PID 2>/dev/null || true
    EXIT_CODE=124
  fi
  CLAUDE_PID=""

  echo ""
  if [ ${EXIT_CODE:-0} -eq 0 ]; then
    echo "✅ Completed successfully"
  elif [ ${EXIT_CODE:-0} -eq 124 ]; then
    echo "⏱️  Timeout (20 minutes) - moving to next loop"
  else
    echo "❌ Exited with code ${EXIT_CODE:-0}"
  fi

  # エラー数カウント
  ERROR_COUNT=$(grep -c "Error\|Failed\|Exception" "$LOGFILE" 2>/dev/null || echo "0")
  TOOL_COUNT=$(grep -c "mcp__mineflayer" "$LOGFILE" 2>/dev/null || echo "0")

  echo "📊 Stats:"
  echo "   - Tools used: $TOOL_COUNT"
  echo "   - Errors: $ERROR_COUNT"
  echo "   - Log: $LOGFILE"

  # Git変更チェック（新しいコミットがあるか）
  NEW_COMMIT=$(git rev-parse --short=6 HEAD 2>/dev/null || echo "unknown")
  if [ "$NEW_COMMIT" != "$COMMIT" ]; then
    echo "🔧 [$BOT_NAME] Code improvements detected (new commit: $NEW_COMMIT)"

    # PR作成 → ビルドチェック → 自動マージ
    BRANCH=$(git branch --show-current 2>/dev/null || echo "")
    if [ -z "$BRANCH" ]; then
      echo "⚠️  Not on a branch, skipping PR"
    else
      echo "📤 Pushing $BRANCH to remote..."

      if git push origin "$BRANCH" 2>&1 | tee -a "$LOGFILE"; then
        echo "✅ Pushed $BRANCH"

        # ビルドチェック
        echo "🔨 Running build check..."
        if npm run build > /dev/null 2>&1; then
          echo "✅ Build passed"

          # PR作成（既存PRがなければ）
          EXISTING_PR=$(gh pr list --head "$BRANCH" --base main --state open --json number -q '.[0].number' 2>/dev/null || echo "")
          if [ -z "$EXISTING_PR" ]; then
            PR_TITLE="[$BOT_NAME] Auto-fix loop #$LOOP ($NEW_COMMIT)"
            PR_URL=$(gh pr create --base main --head "$BRANCH" \
              --title "$PR_TITLE" \
              --body "$(cat <<EOF
## Auto-improvement by $BOT_NAME

- Loop: #$LOOP
- Commit: $NEW_COMMIT
- Model: $MODEL

Build check: passed

Generated by self-improve-minecraft.sh
EOF
)" 2>&1) || true

            if echo "$PR_URL" | grep -q "github.com"; then
              echo "✅ PR created: $PR_URL"

              # PR番号を取得してマージ
              PR_NUM=$(gh pr list --head "$BRANCH" --base main --state open --json number -q '.[0].number' 2>/dev/null || echo "")
              if [ ! -z "$PR_NUM" ]; then
                if gh pr merge "$PR_NUM" --merge --delete-branch=false 2>&1 | tee -a "$LOGFILE"; then
                  echo "✅ PR #$PR_NUM merged to main"
                else
                  echo "⚠️  PR merge failed (may need manual review)"
                fi
              fi
            else
              echo "⚠️  PR creation failed: $PR_URL"
            fi
          else
            echo "📋 PR #$EXISTING_PR already exists, merging..."
            if gh pr merge "$EXISTING_PR" --merge --delete-branch=false 2>&1 | tee -a "$LOGFILE"; then
              echo "✅ PR #$EXISTING_PR merged to main"
            else
              echo "⚠️  PR merge failed (may need manual review)"
            fi
          fi
        else
          echo "❌ Build failed, skipping PR (will fix in next loop)"
        fi
      else
        echo "⚠️  Push failed (will retry next loop)"
      fi
    fi
  fi

  echo ""
  echo "⏳ Waiting 30 seconds before next loop..."
  sleep 30
done
