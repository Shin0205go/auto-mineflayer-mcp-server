#!/bin/bash
#
# Minecraft AI自己改善ループ
# Game Agentがプレイ → 失敗 → Dev Agentが改善 → 再プレイ
#

set -e

# 色付きログ
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"
}

log_error() {
  echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1"
}

# ディレクトリ作成
mkdir -p agent_logs
mkdir -p learning/sessions

# 現在のコミット
COMMIT=$(git rev-parse --short=6 HEAD)
SESSION_ID="session_${COMMIT}_$(date +%s)"
SESSION_DIR="learning/sessions/$SESSION_ID"
mkdir -p "$SESSION_DIR"

log_info "Starting Minecraft AI Self-Improvement Loop"
log_info "Session ID: $SESSION_ID"
log_info "Git Commit: $COMMIT"

# MCP WSサーバー起動チェック
if ! curl -s http://localhost:8765 > /dev/null 2>&1; then
  log_info "Starting MCP WebSocket Server..."
  npm run start:mcp-ws > "$SESSION_DIR/mcp-ws.log" 2>&1 &
  MCP_PID=$!
  sleep 3
  log_info "MCP WebSocket Server started (PID: $MCP_PID)"
else
  log_info "MCP WebSocket Server already running"
fi

# 改善ループカウンター
LOOP_COUNT=0
MAX_LOOPS=100  # 最大100回のループ

while [ $LOOP_COUNT -lt $MAX_LOOPS ]; do
  LOOP_COUNT=$((LOOP_COUNT + 1))
  log_info "=== Loop #$LOOP_COUNT ==="

  LOOP_LOG="$SESSION_DIR/loop_${LOOP_COUNT}.log"

  # Game Agent実行（WebSocket版）
  log_info "Starting Game Agent (playing Minecraft)..."
  timeout 300 npm run start:game-agent > "$LOOP_LOG" 2>&1 || EXIT_CODE=$?

  if [ ${EXIT_CODE:-0} -eq 0 ]; then
    log_info "Game Agent completed successfully"
  elif [ $EXIT_CODE -eq 124 ]; then
    log_warn "Game Agent timeout (5 minutes) - analyzing session..."
  else
    log_error "Game Agent failed with exit code $EXIT_CODE"
  fi

  # ログ分析
  ERROR_COUNT=$(grep -c "Error\|Failed\|Exception" "$LOOP_LOG" || true)

  if [ $ERROR_COUNT -gt 0 ]; then
    log_warn "Found $ERROR_COUNT errors in logs"

    # Dev Agent起動（自動改善）
    log_info "Starting Dev Agent (analyzing and improving)..."
    DEV_LOG="$SESSION_DIR/dev_loop_${LOOP_COUNT}.log"

    timeout 180 npm run start:dev-agent > "$DEV_LOG" 2>&1 || true

    # 改善があったかチェック
    if git diff --quiet; then
      log_info "No code changes from Dev Agent"
    else
      log_info "Dev Agent made improvements, committing..."

      # 自動コミット
      git add -A
      git commit -m "Auto-improvement: Loop #$LOOP_COUNT - Fixed $ERROR_COUNT errors

Session: $SESSION_ID
Game Agent Log: $LOOP_LOG
Dev Agent Log: $DEV_LOG

Co-Authored-By: Dev Agent <dev-agent@minecraftai>" || true

      # ビルド
      log_info "Rebuilding after improvements..."
      npm run build

      # 新しいコミットハッシュ
      COMMIT=$(git rev-parse --short=6 HEAD)
      log_info "New commit: $COMMIT"
    fi
  else
    log_info "No errors detected, continuing..."
  fi

  # 次のループまで待機
  sleep 5
done

log_info "Completed $MAX_LOOPS loops"
log_info "Session saved to: $SESSION_DIR"

# MCP WSサーバー停止
if [ ! -z "$MCP_PID" ]; then
  log_info "Stopping MCP WebSocket Server..."
  kill $MCP_PID 2>/dev/null || true
fi

log_info "Auto-improvement loop finished"
