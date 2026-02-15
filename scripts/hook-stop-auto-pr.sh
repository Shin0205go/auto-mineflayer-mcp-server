#!/bin/bash
#
# Stop hook: auto-commit → mainにマージ → push
# .claude/settings.json の Stop hook から呼ばれる
#

# ブランチ名・ボット番号
BRANCH=$(git branch --show-current 2>/dev/null)
BOT=$(echo "$BRANCH" | sed "s/bot//")

if [ -z "$BRANCH" ] || [ "$BRANCH" = "main" ]; then
  exit 0
fi

# --- Phase 1: 全変更をコミット（src/以外も含む） ---
CHANGED=$(git status --porcelain -- src/ bug-issues/ .claude/skills/ scripts/ 2>/dev/null)
if [ -n "$CHANGED" ]; then
  npm run build --silent 2>/dev/null
  git add src/ bug-issues/ .claude/skills/ scripts/ 2>/dev/null
  git commit -m "[Claude${BOT}] Auto-commit on stop" 2>/dev/null
  echo "✅ Committed changes on $BRANCH"
fi

# --- Phase 2: branchに新しいコミットがあるかチェック ---
git fetch origin main 2>/dev/null
AHEAD=$(git rev-list --count origin/main.."$BRANCH" 2>/dev/null || echo "0")
if [ "$AHEAD" -eq 0 ] 2>/dev/null; then
  exit 0
fi

echo "📊 $BRANCH is $AHEAD commits ahead of main"

# --- Phase 3: mainにチェックアウトしてマージ ---
# 未追跡ファイル等をstash
git stash push -m "hook-temp" --include-untracked 2>/dev/null

git checkout main 2>/dev/null || { echo "⚠️ Cannot checkout main"; git stash pop 2>/dev/null; git checkout "$BRANCH" 2>/dev/null; exit 0; }
git pull origin main --no-edit 2>/dev/null || true

# botブランチをmainにマージ
if git merge "$BRANCH" --no-edit 2>/dev/null; then
  echo "✅ Merged $BRANCH into main"

  # ビルドチェック
  if npm run build --silent 2>/dev/null; then
    # mainをpush（失敗したらpull→retry）
    if git push origin main 2>/dev/null; then
      echo "✅ Pushed main to origin"
    else
      git pull origin main --no-edit 2>/dev/null
      git push origin main 2>/dev/null && echo "✅ Pushed main (retry)" || echo "⚠️ Push main failed"
    fi
  else
    echo "❌ Build failed, reverting merge"
    git reset --hard HEAD~1 2>/dev/null
  fi
else
  echo "⚠️ Merge conflict, aborting"
  git merge --abort 2>/dev/null
fi

# botブランチに戻ってmainを取り込む
git checkout "$BRANCH" 2>/dev/null
git stash pop 2>/dev/null || true
git merge main --no-edit 2>/dev/null || {
  git checkout --theirs .claude/settings.json .mcp.json scripts/ 2>/dev/null
  CONFLICTED=$(git diff --name-only --diff-filter=U 2>/dev/null)
  if [ -n "$CONFLICTED" ]; then
    echo "$CONFLICTED" | while read f; do git checkout --ours "$f" 2>/dev/null; done
  fi
  git add -A 2>/dev/null
  git commit -m "[Claude${BOT}] Sync with main" 2>/dev/null
}
git push origin "$BRANCH" 2>/dev/null || true
