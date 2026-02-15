#!/bin/bash
#
# Stop hook: auto-commit → mainマージ → push → PR作成 → 自動マージ
# .claude/settings.json の Stop hook から呼ばれる
#

# ブランチ名・ボット番号
BRANCH=$(git branch --show-current 2>/dev/null)
BOT=$(echo "$BRANCH" | sed "s/bot//")

if [ -z "$BRANCH" ] || [ "$BRANCH" = "main" ]; then
  exit 0
fi

# --- Phase 1: 未コミットの変更があればcommit ---
CHANGED=$(git diff --name-only -- src/ bug-issues/ .claude/skills/ 2>/dev/null)
if [ -n "$CHANGED" ]; then
  npm run build --silent 2>/dev/null
  git add src/ bug-issues/ .claude/skills/ 2>/dev/null
  git commit -m "[Claude${BOT}] Auto-commit on stop" 2>/dev/null
  echo "✅ Committed changes"
fi

# --- Phase 2: mainを取り込んでコンフリクト解消 ---
git fetch origin main 2>/dev/null
if ! git merge origin/main --no-edit 2>/dev/null; then
  echo "⚠️ Merge conflict with main, auto-resolving..."
  # src/は自分の変更を優先（ours）、設定ファイル等はmainを優先（theirs）
  git checkout --theirs .claude/settings.json 2>/dev/null
  git checkout --theirs .mcp.json 2>/dev/null
  git checkout --theirs scripts/ 2>/dev/null
  # src/のコンフリクトはoursで解決
  CONFLICTED=$(git diff --name-only --diff-filter=U 2>/dev/null)
  if [ -n "$CONFLICTED" ]; then
    echo "$CONFLICTED" | while read f; do
      git checkout --ours "$f" 2>/dev/null
    done
  fi
  git add -A 2>/dev/null
  git commit -m "[Claude${BOT}] Auto-resolve merge conflicts" 2>/dev/null || true
  echo "✅ Merge conflicts resolved"
fi

# --- Phase 3: branchがmainより先にいたらpush → PR → マージ ---
AHEAD=$(git rev-list --count origin/main.."$BRANCH" 2>/dev/null || echo "0")
if [ "$AHEAD" -eq 0 ] 2>/dev/null; then
  exit 0
fi

echo "📊 $BRANCH is $AHEAD commits ahead of main"
git push origin "$BRANCH" 2>/dev/null || { echo "⚠️ Push failed"; exit 0; }

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
