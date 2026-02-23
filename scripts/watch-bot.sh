#!/bin/bash
#
# ボットのログをリアルタイムで整形表示
#
# Usage:
#   ./scripts/watch-bot.sh 1        # bot1を監視
#   ./scripts/watch-bot.sh 2        # bot2を監視
#   ./scripts/watch-bot.sh 1 2 3    # 全部まとめて監視

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 色定義
C_THINK="\033[36m"    # シアン
C_TOOL="\033[33m"     # 黄
C_RESULT="\033[32m"   # 緑
C_TEXT="\033[37m"     # 白
C_ERR="\033[31m"      # 赤
C_DIM="\033[2m"       # 薄い
C_BOLD="\033[1m"      # 太字
C_RESET="\033[0m"

format_line() {
  local bot_id=$1
  local line=$2
  local prefix="${C_BOLD}[Bot${bot_id}]${C_RESET}"

  # JSON行でなければそのまま出力
  echo "$line" | jq -e . >/dev/null 2>&1 || { echo -e "${prefix} ${C_DIM}${line}${C_RESET}"; return; }

  local type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)

  case "$type" in
    assistant)
      # thinking と text と tool_use を抽出
      echo "$line" | jq -r '
        .message.content[]? |
        if .type == "thinking" then
          "THINKING:" + (.thinking // "" | .[0:300])
        elif .type == "text" then
          "TEXT:" + (.text // "")
        elif .type == "tool_use" then
          "TOOL:" + .name + "(" + ((.input // {}) | to_entries | map(.key + "=" + (.value | tostring | .[0:50])) | join(", ")) + ")"
        else empty
        end
      ' 2>/dev/null | while IFS= read -r content; do
        case "$content" in
          THINKING:*)
            echo -e "${prefix} ${C_THINK}💭 ${content#THINKING:}${C_RESET}"
            ;;
          TEXT:*)
            echo -e "${prefix} ${C_TEXT}💬 ${content#TEXT:}${C_RESET}"
            ;;
          TOOL:*)
            echo -e "${prefix} ${C_TOOL}🔧 ${content#TOOL:}${C_RESET}"
            ;;
        esac
      done
      ;;
    result)
      local result=$(echo "$line" | jq -r '
        if .subtype == "tool_result" then
          .tool_name + " → " + ((.content // "ok") | tostring | .[0:200])
        else
          (.content // .result // "done") | tostring | .[0:200]
        end
      ' 2>/dev/null)
      echo -e "${prefix} ${C_RESULT}✅ ${result}${C_RESET}"
      ;;
    error)
      local err=$(echo "$line" | jq -r '.error // .message // "unknown error"' 2>/dev/null)
      echo -e "${prefix} ${C_ERR}❌ ${err}${C_RESET}"
      ;;
    *)
      # その他のイベントは薄く表示
      local summary=$(echo "$line" | jq -c '.' 2>/dev/null | head -c 150)
      echo -e "${prefix} ${C_DIM}${summary}${C_RESET}"
      ;;
  esac
}

if [ $# -eq 0 ]; then
  echo "Usage: $0 <bot_id> [bot_id2] [bot_id3]"
  echo "Example: $0 1 2 3"
  exit 1
fi

# 各ボットの最新ログファイルをtail -f
PIDS=()
for BOT_ID in "$@"; do
  LOG_DIR="$PROJECT_DIR/agent_logs/bot${BOT_ID}"
  (
    while true; do
      # 最新のログファイルを見つける
      LATEST=$(ls -t "$LOG_DIR"/loop_*.log 2>/dev/null | head -1)
      if [ -z "$LATEST" ]; then
        sleep 2
        continue
      fi
      # tail -fで追従、新しいファイルができたらリスタート
      tail -f "$LATEST" 2>/dev/null | while IFS= read -r line; do
        [ -z "$line" ] && continue
        format_line "$BOT_ID" "$line"
      done
      sleep 1
    done
  ) &
  PIDS+=($!)
done

echo -e "${C_BOLD}Watching Bot(s): $@ | Ctrl+C to stop${C_RESET}"
echo ""

cleanup() {
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null
    pkill -P "$pid" 2>/dev/null
  done
  exit 0
}
trap cleanup SIGINT SIGTERM

wait
