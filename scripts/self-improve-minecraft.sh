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
    echo "⚠️  Merge conflict detected - Claude will resolve during this loop" | tee -a "$LOGFILE"
    # コンフリクトを残したまま進む（Claudeが解決する）
  fi

  git stash pop 2>/dev/null || true

  # 毎ループビルド（src/の修正をdist/に反映）
  echo "🔨 Building..."
  npm run build > /dev/null 2>&1 && echo "✅ Build OK" || echo "⚠️ Build failed"
  echo ""

  # プロンプトファイル作成（前回のログを含む）
  if [ "$BOT_ID" -eq 1 ]; then
    cat > /tmp/minecraft_prompt_bot${BOT_ID}.md << 'PROMPT'
# Claude1 — リーダー（指示＆バグ修正専任）

CLAUDE.mdにフェーズ定義・チャットプロトコル・行動原則が書いてある。必ず従え。

## 役割

お前の仕事は2つだけ:
1. **チームへのタスク指示** — 状況を把握し、各メンバーに具体的な作業を割り振る
2. **バグ修正** — メンバーが報告したエラーや、ログで見つけた不具合を `src/` で直す

**自分でMinecraftの作業（採掘、建築、クラフト等）はするな。** 指示とコード修正に集中しろ。

## 手順（この順番を厳守）

1. `git status` でコンフリクト確認 → あれば解決
2. `minecraft_connect(username="Claude1")` で接続
3. `minecraft_get_chat_messages()` で直近のチャットを読む
4. `minecraft_get_surroundings()` と `minecraft_get_status()` でチームの進捗・周囲の状況を把握
5. **現在の状況に応じてフェーズを判定**し、適切な指示を出す（CLAUDE.mdのフェーズ表を参照）
   - 前のチャットでメンバーが報告してる内容を踏まえろ
   - 既に達成済みのタスクを再度指示するな
   - メンバーの報告に応答しろ（「[了解] よくやった」等）
   - 次にやるべきことを具体的に指示しろ（座標込み）
6. 全員に指示を出したら、**チャットを監視しながらバグ修正に取り掛かる**
7. 2アクションごとにチャット確認、メンバーの報告に応じて追加指示

## バグ修正の進め方

- メンバーからのエラー報告、前回ログのエラーを確認
- `bug-issues/bot1.md` に問題を記録
- `src/` のコードを読んで修正
- 修正したら `npm run build` でビルド確認
- **必ずコミット＆プッシュしろ**: `git add src/ bug-issues/ && git commit -m "[Claude1] 修正内容" && git push origin bot1`

**重要**: 毎回同じ指示を出すな。チャット履歴を見て状況に合った判断をしろ。

編集可能: `src/`, `.claude/skills/`, `bug-issues/bot1.md` のみ。
PROMPT
  else
    cat > /tmp/minecraft_prompt_bot${BOT_ID}.md << PROMPT
# $BOT_NAME — フォロワー

CLAUDE.mdにフェーズ定義・チャットプロトコル・行動原則が書いてある。必ず従え。

## 手順

1. \`git status\` でコンフリクト確認 → あれば解決
2. \`minecraft_connect(username="$BOT_NAME")\` で接続
3. \`minecraft_get_chat_messages()\` でリーダー(Claude1)の指示を確認
4. 指示があれば \`minecraft_chat("[了解] @Claude1 ...")\` と返答して実行開始
5. 指示がなければ現在フェーズの目標に沿って自律行動
6. **2アクションごとにチャットを確認**（頻繁に `minecraft_get_chat_messages()` を呼べ）

バグを見つけたら \`bug-issues/bot${BOT_ID}.md\` に記録して \`src/\` を修正。
**修正したら必ずコミット＆プッシュ**: \`git add src/ bug-issues/ && git commit -m "[$BOT_NAME] 修正内容" && git push origin bot${BOT_ID}\`
編集可能: \`src/\`, \`.claude/skills/\`, \`bug-issues/bot${BOT_ID}.md\` のみ。
PROMPT
  fi

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

  # Run Claude with timeout (10 minutes)
  # 環境変数でMCPサーバーに設定を渡す
  export BOT_USERNAME="$BOT_NAME"
  export ENABLE_VIEWER="${ENABLE_VIEWER:-false}"
  cat /tmp/minecraft_prompt_bot${BOT_ID}.md | claude --dangerously-skip-permissions \
    --print \
    --verbose \
    --output-format stream-json \
    --model $MODEL > "$LOGFILE" 2>&1 &
  CLAUDE_PID=$!

  # Wait up to 600 seconds (10 minutes)
  EXIT_CODE=0
  WAITED=0
  while [ $WAITED -lt 600 ]; do
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
    echo "⏱️  Timeout reached (10 minutes), stopping..." | tee -a "$LOGFILE"
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
    echo "⏱️  Timeout (10 minutes) - moving to next loop"
  else
    echo "❌ Exited with code ${EXIT_CODE:-0}"
  fi

  # 未コミットの変更を自動コミット（botがコミットし忘れた場合のセーフティネット）
  CHANGED_FILES=$(git diff --name-only -- src/ bug-issues/ .claude/skills/ 2>/dev/null | head -20)
  if [ ! -z "$CHANGED_FILES" ]; then
    echo "📝 [$BOT_NAME] Auto-committing uncommitted changes..."
    git add src/ bug-issues/ .claude/skills/ 2>/dev/null || true
    git commit -m "[$BOT_NAME] Auto-commit: changes from loop #$LOOP" 2>/dev/null && echo "✅ Auto-committed" || true
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
