#!/bin/bash
#
# Stop hook: auto-commit → mainに直接push
# worktreeではcheckout mainできないため、refspec pushを使う
#

BRANCH=$(git branch --show-current 2>/dev/null)
BOT=$(echo "$BRANCH" | sed "s/bot//")

if [ -z "$BRANCH" ] || [ "$BRANCH" = "main" ]; then
  exit 0
fi

# --- Phase 1: 変更があればcommit ---
git add src/ bug-issues/ .claude/skills/ scripts/ 2>/dev/null
if git diff --cached --quiet 2>/dev/null; then
  : # nothing staged
else
  npm run build --silent 2>/dev/null
  git commit -m "[Claude${BOT}] Auto-commit on stop" 2>/dev/null
  echo "✅ Committed on $BRANCH"
fi

# --- Phase 2: origin/mainを取り込んでからmainにpush ---
git fetch origin main 2>/dev/null

AHEAD=$(git rev-list --count origin/main.."$BRANCH" 2>/dev/null || echo "0")
if [ "$AHEAD" -eq 0 ] 2>/dev/null; then
  exit 0
fi
echo "📊 $BRANCH is $AHEAD commits ahead of main"

# origin/mainをbotブランチにマージ（fast-forward pushできるようにする）
if ! git merge origin/main --no-edit 2>/dev/null; then
  echo "⚠️ Conflict merging main into $BRANCH, auto-resolving..."
  git checkout --theirs .claude/settings.json .mcp.json scripts/ 2>/dev/null
  CONFLICTED=$(git diff --name-only --diff-filter=U 2>/dev/null)
  if [ -n "$CONFLICTED" ]; then
    echo "$CONFLICTED" | while read f; do git checkout --ours "$f" 2>/dev/null; done
  fi
  git add -A 2>/dev/null
  git commit -m "[Claude${BOT}] Merge main + resolve conflicts" 2>/dev/null || true
fi

# ビルドチェック
if ! npm run build --silent 2>/dev/null; then
  echo "❌ Build failed, skipping push to main"
  git push origin "$BRANCH" 2>/dev/null || true
  exit 0
fi

# botブランチをremote mainに直接push（fast-forward）
for ATTEMPT in 1 2 3; do
  if git push origin "$BRANCH":main 2>/dev/null; then
    echo "✅ Pushed $BRANCH to main"
    # botブランチもpush
    git push origin "$BRANCH" 2>/dev/null || true
    exit 0
  fi
  echo "⚠️ Push to main failed (attempt $ATTEMPT/3), re-fetching..."
  git fetch origin main 2>/dev/null
  git merge origin/main --no-edit 2>/dev/null || {
    git add -A 2>/dev/null
    git commit -m "[Claude${BOT}] Re-merge main" 2>/dev/null || true
  }
  sleep 3
done

echo "❌ Failed to push to main after 3 attempts"
# botブランチだけでもpush
git push origin "$BRANCH" 2>/dev/null || true
