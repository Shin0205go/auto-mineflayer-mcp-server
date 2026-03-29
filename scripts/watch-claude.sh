#!/bin/bash
#
# watch-claude.sh - エージェントoutputを監視してClaudeに状況判断させる
# crontabで回す: */5 * * * * /path/to/watch-claude.sh
#
# Claudeが苦戦パターンを検出したら自律的にコードレビューエージェントを起動する

PROJECT_DIR="/Users/shingo/Develop/auto-mineflayer-mcp-server"
CLAUDE_BIN="/Users/shingo/.bun/bin/claude"

# 最新のagent jsonlを探す
OUTPUT_FILE=$(ls -t "$HOME/.claude/projects/"*auto-mineflayer*/subagents/agent-*.jsonl 2>/dev/null | head -1)

if [ -z "$OUTPUT_FILE" ]; then
  echo "$(date): agent output not found, skipping" >&2
  exit 0
fi

# 直近のエージェントテキストを抽出
recent=$(tail -100 "$OUTPUT_FILE" | python3 -c "
import sys, json
texts = []
for line in sys.stdin:
    try:
        obj = json.loads(line.strip())
        for c in obj.get('message', {}).get('content', []):
            if c.get('type') == 'text' and c.get('text'):
                texts.append(c['text'][:200])
    except:
        pass
print('\n'.join(texts[-12:]))
" 2>/dev/null)

if [ -z "$recent" ]; then
  echo "$(date): no text found in output, skipping" >&2
  exit 0
fi

# Claudeに判断させる
"$CLAUDE_BIN" -p "以下はMinecraftエージェントの直近の行動ログ。苦戦パターン（繰り返し失敗・タイムアウト・死亡・移動不能・ドロップ取得失敗等）があればコードレビューエージェントを起動してください。問題なければ何もしなくていい。

$recent" --cwd "$PROJECT_DIR"
