#!/bin/bash
export PATH="$HOME/.nvm/versions/node/v20.19.0/bin:$HOME/.local/bin:$PATH"
#
# Minecraft 統合ランチャー
#   bot モード: プレイ専用ループ
#   dev モード: bug-issues/監視 → worktreeで自動修正 → mainにマージ
#
# Usage:
#   ./scripts/self-improve-minecraft.sh 1 claude [model]   # Claude (default model: sonnet)
#   ./scripts/self-improve-minecraft.sh 1 gemini [model]   # Gemini (default model: gemini-2.5-flash)
#   ./scripts/self-improve-minecraft.sh dev claude [model]
#   ./scripts/self-improve-minecraft.sh dev gemini [model]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_PID=""
TIMEOUT_BOT=1800   # 30min
TIMEOUT_DEV=900    # 15min

# =============================================================================
# Agent判定: 第2引数が claude/gemini ならagent、それ以外は後方互換でclaude+model
# =============================================================================
if [ "$1" = "dev" ]; then
  MODE="dev"
  if [ "$2" = "claude" ] || [ "$2" = "gemini" ]; then
    AGENT="$2"; MODEL="${3}"
  else
    AGENT="claude"; MODEL="${2}"
  fi
else
  MODE="bot"
  if [ "$2" = "claude" ] || [ "$2" = "gemini" ]; then
    AGENT="$2"; MODEL="${3}"
  else
    AGENT="claude"; MODEL="${2}"
  fi
fi

# デフォルトmodel
if [ -z "$MODEL" ]; then
  case "$AGENT" in
    claude) MODEL="sonnet" ;;
    gemini) MODEL="gemini-2.5-flash" ;;
  esac
fi

# Agent別のコマンド構築関数
# Usage: run_agent <prompt_file> <log_file> [extra_args...]
run_agent() {
  local prompt_file="$1" log_file="$2"
  case "$AGENT" in
    claude)
      cat "$prompt_file" | claude --dangerously-skip-permissions \
        --print --verbose --model "$MODEL" "$@" 2>&1 | tee "$log_file"
      ;;
    gemini)
      cat "$prompt_file" | gemini --yolo \
        --prompt "" --model "$MODEL" -o text "$@" 2>&1 | tee "$log_file"
      ;;
  esac
}

# bot mode: MCP付きで実行
run_agent_bot() {
  local prompt_file="$1" log_file="$2"
  case "$AGENT" in
    claude)
      cat "$prompt_file" | claude --dangerously-skip-permissions \
        --print --verbose --model "$MODEL" --mcp-config .mcp.json 2>&1 | tee "$log_file"
      ;;
    gemini)
      cat "$prompt_file" | gemini --yolo \
        --prompt "" --model "$MODEL" -o text 2>&1 | tee "$log_file"
      ;;
  esac
}

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
  AGENT_PID=$!
  local waited=0
  while [ $waited -lt $timeout ]; do
    kill -0 $AGENT_PID 2>/dev/null || { wait $AGENT_PID 2>/dev/null; AGENT_PID=""; return $?; }
    sleep 1; waited=$((waited + 1))
  done
  echo "Timeout (${timeout}s), stopping..."
  kill_pid $AGENT_PID; AGENT_PID=""
  return 124
}

cleanup() {
  echo ""; echo "Shutting down..."
  kill_pid "$AGENT_PID"
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
if [ "$MODE" = "dev" ]; then
  DEV_LOG_DIR="agent_logs/dev"; mkdir -p "$DEV_LOG_DIR"
  SNAPSHOT_FILE="$DEV_LOG_DIR/bug_snapshot.md5"; touch "$SNAPSHOT_FILE"
  DEV_LOOP=0

  echo "Auto-fix dev loop | Agent: $AGENT | Model: $MODEL | Watching: bug-issues/"

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

    DEV_PROMPT_FILE="/tmp/dev_prompt_${DEV_LOOP}.md"
    cat > "$DEV_PROMPT_FILE" << 'PROMPT'
# 自動バグ修正タスク
bug-issues/ のバグを修正しろ。
1. bug-issues/ を読み未修正バグを特定
2. src/tools/ のコードを調査・修正
3. npm run build で確認
4. 修正済みバグに「**修正済み**」追記
5. git add & git commit
編集は src/tools/ と bug-issues/ のみ。
PROMPT

    if [ "$AGENT" = "gemini" ]; then
      run_with_timeout $TIMEOUT_DEV bash -c "cd '$WT' && unset CLAUDECODE && cat '$DEV_PROMPT_FILE' | gemini --yolo -p '' --model $MODEL -o text 2>&1 | tee '$LOGFILE'"
    else
      run_with_timeout $TIMEOUT_DEV bash -c "cd '$WT' && unset CLAUDECODE && cat '$DEV_PROMPT_FILE' | claude --dangerously-skip-permissions --print --verbose --model $MODEL 2>&1 | tee '$LOGFILE'"
    fi

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
BOT_NAME="$(echo "$AGENT" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')${BOT_ID}"  # Claude1, Gemini1, etc.
LOG_DIR="agent_logs/bot${BOT_ID}"; mkdir -p "$LOG_DIR"
STATE_FILE="$LOG_DIR/progress_state.txt"
[ -f "$STATE_FILE" ] || echo "0|0|" > "$STATE_FILE"
LOOP=0

export BOT_USERNAME="$BOT_NAME"
export ENABLE_VIEWER="${ENABLE_VIEWER:-false}"

# Gemini: .gemini/settings.json のBOT_USERNAMEを動的に書き換え
if [ "$AGENT" = "gemini" ]; then
  GEMINI_SETTINGS=".gemini/settings.json"
  if [ -f "$GEMINI_SETTINGS" ]; then
    sed -i '' "s/\"BOT_USERNAME\": \".*\"/\"BOT_USERNAME\": \"$BOT_NAME\"/" "$GEMINI_SETTINGS"
  fi
fi

echo "$BOT_NAME | Agent: $AGENT | Model: $MODEL | Logs: $LOG_DIR"
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
    cat > "$PROMPT_FILE" << PROMPT
# ${BOT_NAME} — リーダー（指示専任）
CLAUDE.mdに従え。
1. \`minecraft_connect(username="${BOT_NAME}")\` で接続
2. \`minecraft_get_chat_messages()\` でチャット確認
3. \`minecraft_get_surroundings()\` と \`minecraft_get_status()\` で状況把握
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

  # 前回ログ末尾を付与（ファイルパスっぽい行は除去 — Gemini CLIがファイル引数と誤認するため）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ -f "$PREV_LOG" ] 2>/dev/null; then
    echo -e "\n## 前回ログ\n\`\`\`" >> "$PROMPT_FILE"
    tail -80 "$PREV_LOG" 2>/dev/null | grep -v '^\s*at ' | grep -v 'node_modules/' | grep -v 'Git-ignored:' | grep -v 'Ignored [0-9]* files' >> "$PROMPT_FILE" 2>/dev/null
    echo '```' >> "$PROMPT_FILE"
  fi

  # Agent実行
  if [ "$AGENT" = "gemini" ]; then
    run_with_timeout $TIMEOUT_BOT bash -c "cat '$PROMPT_FILE' | gemini --yolo -p '' --model $MODEL -o text 2>&1 | tee '$LOGFILE'"
  else
    run_with_timeout $TIMEOUT_BOT bash -c "cat '$PROMPT_FILE' | claude --dangerously-skip-permissions --print --verbose --model $MODEL --mcp-config .mcp.json 2>&1 | tee '$LOGFILE'"
  fi
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
