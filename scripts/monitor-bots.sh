#!/bin/bash
#
# ボットモニター - 各ボットの状況をリアルタイム表示
# Usage: ./scripts/monitor-bots.sh [interval]
#   interval: 更新間隔（秒、デフォルト: 10）

INTERVAL=${1:-10}
BOT_COUNT=7

while true; do
  clear
  echo "🎮 Minecraft Bot Monitor  $(date '+%H:%M:%S')"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  for i in $(seq 1 $BOT_COUNT); do
    DIR="/Users/shingo/Develop/auto-mineflayer-bot${i}"
    LOG=$(ls -t ${DIR}/agent_logs/bot${i}/loop_*.log 2>/dev/null | head -1)

    if [ -z "$LOG" ]; then
      echo "Bot$i: ⚫ no log"
      continue
    fi

    # Parse with python
    python3 -c "
import json, sys, os

log_file = '$LOG'
lines = []
with open(log_file, 'r') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            lines.append(json.loads(line))
        except:
            pass

tools = 0
errors = 0
last_tool = ''
last_text = ''
last_result = ''

for d in lines:
    t = d.get('type','')
    msg = d.get('message',{})
    content = msg.get('content',[])

    if t == 'assistant':
        for c in content:
            if c.get('type') == 'tool_use':
                name = c['name'].replace('mcp__mineflayer__','')
                tools += 1
                last_tool = name
            elif c.get('type') == 'text':
                txt = c['text'].strip()
                if txt:
                    last_text = txt

    elif t == 'user':
        for c in content:
            if isinstance(c, dict):
                if c.get('is_error'):
                    errors += 1
                ct = c.get('content','')
                if isinstance(ct, list) and ct:
                    ct = ct[0].get('text','') if isinstance(ct[0], dict) else str(ct[0])
                if isinstance(ct, str) and ct:
                    last_result = ct

# Truncate
last_text = last_text[:80] if last_text else ''
last_tool = last_tool[:30] if last_tool else '?'
last_result = last_result[:60] if last_result else ''

# Status icon
if errors > 20:
    icon = '🔴'
elif errors > 5:
    icon = '🟡'
else:
    icon = '🟢'

print(f'Bot$i: {icon} tools={tools} err={errors} | {last_tool}')
if last_text:
    print(f'      💬 {last_text}')
if last_result and not last_result.startswith('{') and not last_result.startswith('['):
    print(f'      📎 {last_result[:80]}')
" 2>/dev/null || echo "Bot$i: ⚫ parse error"

    echo ""
  done

  # Git status summary
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -n "📦 Uncommitted src changes: "
  CHANGED=""
  for i in $(seq 1 $BOT_COUNT); do
    DIR="/Users/shingo/Develop/auto-mineflayer-bot${i}"
    HAS=$(git -C "$DIR" diff --name-only src/ 2>/dev/null | wc -l | tr -d ' ')
    if [ "$HAS" -gt 0 ]; then
      CHANGED="$CHANGED Bot$i($HAS)"
    fi
  done
  echo "${CHANGED:-none}"

  echo -n "🔀 Open PRs: "
  gh pr list --state open --json number,title -q '.[] | "#\(.number) \(.title)"' 2>/dev/null | head -3 || echo "none"

  echo ""
  echo "Next refresh in ${INTERVAL}s... (Ctrl+C to stop)"
  sleep $INTERVAL
done
