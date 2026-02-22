#!/bin/bash
# PreToolUse hook: BOT_READONLY=1 のとき、bug-issues/ 以外への書き込みをブロック
# 開発時（BOT_READONLY未設定）は何もブロックしない
# Exit 0 = allow, Exit 2 = block

# Bot mode でなければ全て許可
if [ "$BOT_READONLY" != "1" ]; then
  exit 0
fi

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

# Edit/Write 以外は許可
case "$TOOL_NAME" in
  Edit|Write|NotebookEdit) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# bug-issues/ のみ許可
if echo "$FILE_PATH" | grep -qE '(^|/)bug-issues/'; then
  exit 0
fi

echo "BLOCKED: Bot is in play-only mode. File edits are restricted to bug-issues/ only."
echo "Cannot edit: $FILE_PATH"
echo "Report bugs in bug-issues/bot{N}.md instead."
exit 2
