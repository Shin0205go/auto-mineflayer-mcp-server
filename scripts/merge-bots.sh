#!/bin/bash
# 各ボットの改善をmainブランチにマージ

BASE_BRANCH=${1:-main}
BOT_COUNT=${2:-3}

echo "🔀 Merging bot improvements to $BASE_BRANCH..."

# mainブランチに切り替え
git checkout "$BASE_BRANCH"

# 最新を取得
git pull origin "$BASE_BRANCH"

# 各ボットブランチをマージ
for i in $(seq 1 $BOT_COUNT); do
  BOT_BRANCH="bot${i}"

  echo ""
  echo "Bot${i}: Merging $BOT_BRANCH..."

  if git merge --no-ff "$BOT_BRANCH" -m "Merge improvements from $BOT_BRANCH"; then
    echo "✅ Successfully merged $BOT_BRANCH"
  else
    echo "⚠️  Merge conflict detected"
    echo "   Resolve conflicts and run: git merge --continue"
    exit 1
  fi
done

# mainをプッシュ
echo ""
echo "📤 Pushing merged changes to origin/$BASE_BRANCH..."
git push origin "$BASE_BRANCH"

echo ""
echo "✅ All bot improvements merged to $BASE_BRANCH!"
