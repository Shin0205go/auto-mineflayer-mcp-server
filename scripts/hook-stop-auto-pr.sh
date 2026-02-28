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

# --- claude/ ブランチはbot用mainマージフローをスキップ ---
# claude/ ブランチは独自のリモートブランチにpushするだけ
if echo "$BRANCH" | grep -q "^claude/"; then
  git add -A 2>/dev/null
  if ! git diff --cached --quiet 2>/dev/null; then
    npm run build --silent 2>/dev/null
    git commit -m "[Claude] Auto-commit on stop" 2>/dev/null
    echo "✅ Committed on $BRANCH"
  fi
  AHEAD=$(git rev-list --count "origin/$BRANCH".."$BRANCH" 2>/dev/null || echo "0")
  if [ "$AHEAD" -gt 0 ] 2>/dev/null; then
    git push origin "$BRANCH" 2>/dev/null && echo "✅ Pushed $BRANCH" || echo "⚠️ Push failed for $BRANCH"
  fi
  exit 0
fi

# scripts/は常にmainの内容を維持（botの編集対象外）
git checkout origin/main -- scripts/ 2>/dev/null

# --- Phase 1: 変更があればcommit ---
git add src/tools/ bug-issues/ .claude/skills/ 2>/dev/null
if ! git diff --cached --quiet 2>/dev/null; then
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

# origin/mainをbotブランチにマージ
if ! git merge origin/main --no-edit 2>/dev/null; then
  echo "⚠️ Conflict merging main into $BRANCH, auto-resolving..."

  # コンフリクトファイルを1つずつ解消
  git diff --name-only --diff-filter=U 2>/dev/null | while IFS= read -r f; do
    case "$f" in
      src/*)
        git checkout --ours -- "$f" 2>/dev/null && git add "$f" 2>/dev/null
        echo "  resolved (ours): $f"
        ;;
      *)
        git checkout --theirs -- "$f" 2>/dev/null && git add "$f" 2>/dev/null
        echo "  resolved (theirs): $f"
        ;;
    esac
  done

  # マーカーが残ってたらマージ中止
  REMAINING=$(git diff --name-only --diff-filter=U 2>/dev/null)
  if [ -n "$REMAINING" ]; then
    echo "$REMAINING" | while IFS= read -r f; do
      git checkout --theirs -- "$f" 2>/dev/null || git rm "$f" 2>/dev/null
      git add "$f" 2>/dev/null
    done
  fi

  if grep -rq "^<<<<<<< " src/ scripts/ .claude/ 2>/dev/null; then
    echo "❌ Conflict markers still present, aborting merge"
    git merge --abort 2>/dev/null
    # mainと同期してブランチを揃える
    git reset --hard origin/main 2>/dev/null
    git push origin "$BRANCH" --force 2>/dev/null || true
    exit 0
  fi

  git commit -m "[Claude${BOT}] Merge main + resolve conflicts" 2>/dev/null || true
fi

# ビルドチェック
if ! npm run build --silent 2>/dev/null; then
  echo "❌ Build failed, skipping push to main"
  # mainと同期してブランチを揃える
  git reset --hard origin/main 2>/dev/null
  git push origin "$BRANCH" --force 2>/dev/null || true
  exit 0
fi

# botブランチをremote mainに直接push
for ATTEMPT in 1 2 3; do
  if git push origin "$BRANCH":main 2>/dev/null; then
    echo "✅ Pushed $BRANCH to main"
    # botブランチをmainと同じ位置にリセット（ズレ防止）
    git fetch origin main 2>/dev/null
    git reset --hard origin/main 2>/dev/null
    git push origin "$BRANCH" --force 2>/dev/null || true
    exit 0
  fi
  echo "⚠️ Push to main failed (attempt $ATTEMPT/3), re-fetching..."
  git fetch origin main 2>/dev/null
  git merge origin/main --no-edit 2>/dev/null || {
    git diff --name-only --diff-filter=U 2>/dev/null | while IFS= read -r f; do
      git checkout --theirs -- "$f" 2>/dev/null && git add "$f" 2>/dev/null
    done
    git commit -m "[Claude${BOT}] Re-merge main" 2>/dev/null || true
  }
  sleep 3
done

echo "❌ Failed to push to main after 3 attempts"
# 失敗しても、mainと同期してブランチを揃える
git fetch origin main 2>/dev/null
git reset --hard origin/main 2>/dev/null
git push origin "$BRANCH" --force 2>/dev/null || true
