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

1. `minecraft_connect(username="Claude1")` で接続
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
- 修正したら動作確認（ビルドとコミットはhookが自動でやる）

**重要**: 毎回同じ指示を出すな。チャット履歴を見て状況に合った判断をしろ。

編集可能: `src/`, `.claude/skills/`, `bug-issues/bot1.md` のみ。
PROMPT
  else
    cat > /tmp/minecraft_prompt_bot${BOT_ID}.md << PROMPT
# $BOT_NAME — フォロワー

CLAUDE.mdにフェーズ定義・チャットプロトコル・行動原則が書いてある。必ず従え。

## 手順

1. \`minecraft_connect(username="$BOT_NAME")\` で接続
3. \`minecraft_get_chat_messages()\` でリーダー(Claude1)の指示を確認
4. 指示があれば \`minecraft_chat("[了解] @Claude1 ...")\` と返答して実行開始
5. 指示がなければ現在フェーズの目標に沿って自律行動
6. **2アクションごとにチャットを確認**（頻繁に `minecraft_get_chat_messages()` を呼べ）

バグを見つけたら \`bug-issues/bot${BOT_ID}.md\` に記録して \`src/\` を修正。
修正したら動作確認（ビルドとコミットはhookが自動でやる）
編集可能: \`src/\`, \`.claude/skills/\`, \`bug-issues/bot${BOT_ID}.md\` のみ。
PROMPT
  fi

<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< HEAD
=======
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< HEAD
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
>>>>>>> origin/main
=======
>>>>>>> origin/main
  # 前回のログがあれば追加（末尾80行）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
    EXTRACTED=$(tail -80 "$PREV_LOG" 2>/dev/null)
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
<<<<<<< HEAD
=======
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
>>>>>>> origin/main
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
=======
  # 前回のログがあれば追加（stream-jsonからテキスト部分のみ抽出）
  PREV_LOG=$(ls -t $LOG_DIR/loop_*.log 2>/dev/null | head -1)
  if [ ! -z "$PREV_LOG" ] && [ -f "$PREV_LOG" ]; then
>>>>>>> Stashed changes
    EXTRACTED=$(python3 -c "
import json, sys
for line in open(sys.argv[1]):
    try:
        d = json.loads(line.strip())
        if d.get('type') == 'assistant':
            for c in d.get('message',{}).get('content',[]):
                if c.get('type') == 'text':
                    print(c['text'])
                elif c.get('type') == 'tool_use':
                    print(f'[TOOL] {c.get("name","")}({json.dumps(c.get("input",{}),ensure_ascii=False)[:100]})')
        elif d.get('type') == 'user':
            for c in d.get('message',{}).get('content',[]):
                ct = c.get('content','')
                if isinstance(ct, str) and len(ct) < 200:
                    print(f'[RESULT] {ct}')
                elif isinstance(ct, list):
                    for item in ct:
                        if isinstance(item, dict) and 'text' in item:
                            print(f'[RESULT] {item["text"][:200]}')
    except: pass
" "$PREV_LOG" 2>/dev/null | tail -80)
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< HEAD
=======
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> origin/main
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
    if [ -n "$EXTRACTED" ]; then
      echo "" >> /tmp/minecraft_prompt_bot${BOT_ID}.md
      echo "## 前回のログ（参考）" >> /tmp/minecraft_prompt_bot${BOT_ID}.md
      echo "" >> /tmp/minecraft_prompt_bot${BOT_ID}.md
      echo '```' >> /tmp/minecraft_prompt_bot${BOT_ID}.md
      echo "$EXTRACTED" >> /tmp/minecraft_prompt_bot${BOT_ID}.md
      echo '```' >> /tmp/minecraft_prompt_bot${BOT_ID}.md
    fi
  fi

  # Claude Code実行
  echo "▶️  Starting Claude Code ($BOT_NAME)..."
  echo "   Log: $LOGFILE"

  # Run Claude with timeout (30 minutes)
  # 環境変数でMCPサーバーに設定を渡す
  export BOT_USERNAME="$BOT_NAME"
  export ENABLE_VIEWER="${ENABLE_VIEWER:-false}"
  cat /tmp/minecraft_prompt_bot${BOT_ID}.md | claude --dangerously-skip-permissions \
    --print \
    --model $MODEL > "$LOGFILE" 2>&1 &
  CLAUDE_PID=$!

  # Wait up to 1800 seconds (30 minutes)
  EXIT_CODE=0
  WAITED=0
  while [ $WAITED -lt 1800 ]; do
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
    echo "⏱️  Timeout reached (15 minutes), stopping..." | tee -a "$LOGFILE"
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
    echo "⏱️  Timeout (15 minutes) - moving to next loop"
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

  # PR作成・マージはStop hookが自動で行う（scripts/hook-stop-auto-pr.sh）

  echo ""
  echo "⏳ Waiting 30 seconds before next loop..."
  sleep 30
done
