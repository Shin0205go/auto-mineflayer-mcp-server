#!/bin/bash
# mc_execute 実行直後の output を summarize
# Token削減: 長い出力を最後の3行に圧縮して、output token コストを削減

INPUT=$(cat)

# output text 抽出
OUTPUT=$(echo "$INPUT" | jq -r '.content[0].text // ""')

# 元のライン数を計算
ORIG_LINES=$(echo "$OUTPUT" | wc -l)

# 最後の3行のみ抽出（長い output の場合）
# 3行未満の場合は全文保持
if [ "$ORIG_LINES" -gt 3 ]; then
  SUMMARY=$(echo "$OUTPUT" | tail -3)
  NEW_LINES=3
else
  SUMMARY="$OUTPUT"
  NEW_LINES="$ORIG_LINES"
fi

# JSON に summary を代入
RESULT=$(echo "$INPUT" | jq ".content[0].text = $(echo "$SUMMARY" | jq -Rs '.')")

echo "$RESULT"

# stderr に統計情報出力（visible for debug）
echo "[SUMMARIZE] Lines: $ORIG_LINES → $NEW_LINES ($(( (ORIG_LINES - NEW_LINES) * 100 / (ORIG_LINES + 1) ))% reduction)" >&2
