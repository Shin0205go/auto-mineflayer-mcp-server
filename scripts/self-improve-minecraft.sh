#!/bin/bash
export PATH="$HOME/.nvm/versions/node/v20.19.0/bin:$HOME/.local/bin:$PATH"
#
# Minecraft 統合ランチャー
#   bot モード: プレイ専用ループ
#   dev モード: bug-issues/監視 → worktreeで自動修正 → mainにマージ
#
# Usage:
#   ./scripts/self-improve-minecraft.sh 1 sonnet
#   ./scripts/self-improve-minecraft.sh dev [model]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_PID=""
TIMEOUT_BOT=1800   # 30min
TIMEOUT_DEV=900    # 15min

kill_pid() {
  local pid=$1
  [ -z "$pid" ] && return
  kill -0 "$pid" 2>/dev/null || return
  pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null
  sleep 2
  pkill -9 -P "$pid" 2>/dev/null; kill -9 "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
}

# タイムアウト付きでコマンドをバックグラウンド実行し、完了を待つ
# Usage: run_with_timeout <timeout_sec> <command...>
# 戻り値: 0=正常終了, 124=タイムアウト, その他=コマンドの終了コード
run_with_timeout() {
  local timeout=$1; shift
  "$@" &
  CLAUDE_PID=$!
  local waited=0
  while [ $waited -lt $timeout ]; do
    kill -0 $CLAUDE_PID 2>/dev/null || { wait $CLAUDE_PID 2>/dev/null; CLAUDE_PID=""; return $?; }
    sleep 1; waited=$((waited + 1))
  done
  echo "Timeout (${timeout}s), stopping..."
  kill_pid $CLAUDE_PID; CLAUDE_PID=""
  return 124
}

cleanup() {
  echo ""; echo "Shutting down..."
  kill_pid "$CLAUDE_PID"
  # dev worktree cleanup
  git worktree list 2>/dev/null | grep 'autofix' | awk '{print $1}' | while read wt; do
    git worktree remove --force "$wt" 2>/dev/null
  done
  exit 0
}
trap cleanup SIGINT SIGTERM

# =============================================================================
# dev モード
# =============================================================================
if [ "$1" = "dev" ]; then
  MODEL=${2:-sonnet}
  DEV_LOG_DIR="agent_logs/dev"; mkdir -p "$DEV_LOG_DIR"
  SNAPSHOT_FILE="$DEV_LOG_DIR/bug_snapshot.md5"; touch "$SNAPSHOT_FILE"
  DEV_LOOP=0

  echo "Auto-fix dev loop | Model: $MODEL | Watching: bug-issues/"

  while true; do
    CURRENT_HASH=$(cat bug-issues/*.md 2>/dev/null | md5 2>/dev/null || md5sum 2>/dev/null | cut -d' ' -f1)
    [ "$CURRENT_HASH" = "$(cat "$SNAPSHOT_FILE" 2>/dev/null)" ] && { sleep 30; continue; }

    DEV_LOOP=$((DEV_LOOP + 1))
    LOGFILE="$DEV_LOG_DIR/fix_${DEV_LOOP}_$(date +%Y%m%d_%H%M%S).log"
    echo "━━━ [Dev] Fix #$DEV_LOOP ━━━"

    # mainを最新に
    git fetch origin main 2>/dev/null
    git merge origin/main --no-edit 2>/dev/null || true

    # worktreeで修正
    FIX_BRANCH="autofix-${DEV_LOOP}"
    WT=".claude/worktrees/$FIX_BRANCH"
    git worktree add "$WT" -b "$FIX_BRANCH" HEAD 2>/dev/null

    run_with_timeout $TIMEOUT_DEV bash -c "
      cd '$WT' && unset CLAUDECODE
      cat <<'PROMPT' | claude --dangerously-skip-permissions --print --verbose --model $MODEL 2>&1 | tee '$LOGFILE'
# 自動バグ修正タスク
bug-issues/ のバグを修正しろ。
1. bug-issues/ を読み未修正バグを特定
2. src/tools/ のコードを調査・修正
3. npm run build で確認
4. 修正済みバグに「**修正済み**」追記
5. git add & git commit
編集は src/tools/ と bug-issues/ のみ。
PROMPT
    "

    # worktreeの変更をmainにマージ
    if [ -d "$WT" ]; then
      # 未コミット変更があればcommit
      (cd "$WT" && git diff --quiet src/ bug-issues/ 2>/dev/null || {
        git add src/tools/ bug-issues/ && git commit -m "[AutoFix] Fix #${DEV_LOOP}"
      }) 2>/dev/null

      AHEAD=$(cd "$WT" && git rev-list --count main.."$FIX_BRANCH" 2>/dev/null || echo 0)
      if [ "$AHEAD" -gt 0 ]; then
        if (cd "$WT" && npm run build --silent 2>/dev/null); then
          if git merge "$FIX_BRANCH" --no-edit 2>/dev/null; then
            npm run build --silent 2>/dev/null && git push origin main 2>/dev/null && echo "Pushed" || {
              echo "Build/push failed after merge, reverting"
              git reset --hard HEAD~1 2>/dev/null
            }
          else
            echo "Merge conflict, aborting"
            git merge --abort 2>/dev/null
          fi
        else
          echo "Build failed in worktree, skipping"
        fi
      fi
      git worktree remove --force "$WT" 2>/dev/null
      git branch -D "$FIX_BRANCH" 2>/dev/null
    fi

    echo "$CURRENT_HASH" > "$SNAPSHOT_FILE"
    echo "Next check in 60s..."; sleep 60
  done
fi

# =============================================================================
# bot モード
# =============================================================================
BOT_ID=${1:-1}
BOT_NAME="Claude${BOT_ID}"
MODEL=${2:-sonnet}
LOG_DIR="agent_logs/bot${BOT_ID}"; mkdir -p "$LOG_DIR"
STATE_FILE="$LOG_DIR/progress_state.txt"
[ -f "$STATE_FILE" ] || echo "0|0|" > "$STATE_FILE"
LOOP=0

export BOT_USERNAME="$BOT_NAME"
export ENABLE_VIEWER="${ENABLE_VIEWER:-false}"

echo "$BOT_NAME | Model: $MODEL | Logs: $LOG_DIR"
sleep $((BOT_ID * 10))  # 起動ずらし

while true; do
  LOOP=$((LOOP + 1))
  LOGFILE="$LOG_DIR/loop_${LOOP}_$(date +%Y%m%d_%H%M%S).log"
  echo "━━━ $BOT_NAME #$LOOP ━━━"

  # 最新コード取り込み
  git pull origin main --rebase 2>/dev/null || git pull origin main 2>/dev/null || true
  npm run build > /dev/null 2>&1 || true

  # プロンプト作成
  PROMPT_FILE="/tmp/minecraft_prompt_bot${BOT_ID}.md"
  if [ "$BOT_ID" -eq 1 ]; then
    cat > "$PROMPT_FILE" << 'PROMPT'
# Claude1 — リーダー（指示専任）
CLAUDE.mdに従え。
1. `minecraft_connect(username="Claude1")` で接続
2. `minecraft_get_chat_messages()` でチャット確認
3. `minecraft_get_surroundings()` と `minecraft_get_status()` で状況把握
4. フェーズ判定→メンバーに指示
5. 2アクションごとにチャット確認
PROMPT
  else
    cat > "$PROMPT_FILE" << PROMPT
# $BOT_NAME — フォロワー
CLAUDE.mdに従え。
1. \`minecraft_connect(username="$BOT_NAME")\` で接続
2. \`minecraft_get_chat_messages()\` でリーダーの指示確認
3. 指示があれば実行。なければフェーズ目標に沿って自律行動
4. 2アクションごとにチャット確認
PROMPT
  fi

  # 停滞警告
  PREV_PHASE=$(cut -d'|' -f1 "$STATE_FILE" 2>/dev/null || echo 0)
  STALE_COUNT=$(cut -d'|' -f2 "$STATE_FILE" 2>/dev/null || echo 0)
  if [ "$STALE_COUNT" -ge 5 ] 2>/dev/null; then
    echo -e "\n## CRITICAL: ${STALE_COUNT}セッション停滞中(Phase${PREV_PHASE})\n戦略を完全に変えろ。" >> "$PROMPT_FILE"
  elif [ "$STALE_COUNT" -ge 3 ] 2>/dev/null; then
    echo -e "\n## WARNING: ${STALE_COUNT}セッション停滞中\nアプローチを見直せ。" >> "$PROMPT_FILE"
  fi

  # 前回ログ末尾を付与
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ -f "$PREV_LOG" ] 2>/dev/null; then
    echo -e "\n## 前回ログ\n\`\`\`" >> "$PROMPT_FILE"
    tail -80 "$PREV_LOG" >> "$PROMPT_FILE" 2>/dev/null
    echo '```' >> "$PROMPT_FILE"
  fi

  # Claude実行
  run_with_timeout $TIMEOUT_BOT bash -c "
    cat '$PROMPT_FILE' | claude --dangerously-skip-permissions \
      --print --verbose --model $MODEL --mcp-config .mcp.json 2>&1 | tee '$LOGFILE'
  "
  EXIT_CODE=$?

  # 結果表示
  [ $EXIT_CODE -eq 0 ] && echo "Done" || echo "Exit: $EXIT_CODE"

  # 停滞検知
  CURRENT_PHASE=$(grep -oiE "phase.?[0-9]+" "$LOGFILE" 2>/dev/null | tail -1 | grep -oE "[0-9]+" || echo 0)
  if [ "$CURRENT_PHASE" = "$PREV_PHASE" ]; then
    STALE_COUNT=$((STALE_COUNT + 1))
  else
    STALE_COUNT=0
  fi
  echo "${CURRENT_PHASE}|${STALE_COUNT}|" > "$STATE_FILE"

  sleep 30
done
