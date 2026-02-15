#!/bin/bash
#
# Stop hook: auto-commit → push → PR作成 → 自動マージ
# .claude/settings.json の Stop hook から呼ばれる
#

CHANGED=$(git diff --name-only -- src/ bug-issues/ .claude/skills/ 2>/dev/null)
if [ -z "$CHANGED" ]; then
  exit 0
fi

# ビルド
npm run build --silent 2>/dev/null

# ブランチ名・ボット番号
BRANCH=$(git branch --show-current 2>/dev/null)
BOT=$(echo "$BRANCH" | sed "s/bot//")

if [ -z "$BRANCH" ] || [ "$BRANCH" = "main" ]; then
  exit 0
fi

# コミット＆プッシュ
git add src/ bug-issues/ .claude/skills/ 2>/dev/null
git commit -m "[Claude${BOT}] Auto-commit on stop" 2>/dev/null || exit 0
git push origin "$BRANCH" 2>/dev/null || exit 0

echo "✅ Committed and pushed to $BRANCH"

# PR作成（既存PRがなければ）
EXISTING_PR=$(gh pr list --head "$BRANCH" --base main --state open --json number -q '.[0].number' 2>/dev/null || echo "")
if [ -z "$EXISTING_PR" ]; then
  PR_OUTPUT=$(gh pr create --base main --head "$BRANCH" \
    --title "[Claude${BOT}] Auto-fix" \
    --body "Auto-improvement by Claude${BOT}" 2>&1) || true
  if echo "$PR_OUTPUT" | grep -q "github.com"; then
    echo "✅ PR created: $PR_OUTPUT"
  else
    echo "⚠️ PR creation failed: $PR_OUTPUT"
    exit 0
  fi
  # GitHub側のmergeability checkを待つ
  sleep 8
fi

# マージ（リトライ3回）
PR_NUM=$(gh pr list --head "$BRANCH" --base main --state open --json number -q '.[0].number' 2>/dev/null || echo "")
if [ -z "$PR_NUM" ]; then
  exit 0
fi

for ATTEMPT in 1 2 3; do
  MERGE_OUTPUT=$(gh pr merge "$PR_NUM" --merge --delete-branch=false 2>&1)
  if [ $? -eq 0 ]; then
    echo "✅ PR #$PR_NUM merged to main"
    exit 0
  fi
  echo "⚠️ Merge attempt $ATTEMPT/3 failed: $MERGE_OUTPUT"
  if [ $ATTEMPT -lt 3 ]; then
    sleep 5
  fi
done

echo "❌ PR #$PR_NUM merge failed after 3 attempts"
