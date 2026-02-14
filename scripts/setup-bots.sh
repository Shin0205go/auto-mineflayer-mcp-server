#!/bin/bash
# 並行ボット用worktreeセットアップ（ブランチ分離版）

BOT_COUNT=${1:-3}
BASE_BRANCH=${2:-main}

echo "🤖 Setting up $BOT_COUNT parallel bots from $BASE_BRANCH..."

for i in $(seq 1 $BOT_COUNT); do
  DIR="../auto-mineflayer-bot${i}"
  BOT_BRANCH="bot${i}"

  if [ -d "$DIR" ]; then
    echo "Bot${i}: Already exists"
    continue
  fi

  echo "Bot${i}: Creating branch $BOT_BRANCH from $BASE_BRANCH..."

  # ブランチが既に存在する場合は削除して再作成
  git branch -D "$BOT_BRANCH" 2>/dev/null || true

  # 新しいブランチを作成してworktreeに追加
  git worktree add "$DIR" -b "$BOT_BRANCH" "$BASE_BRANCH"

  cd "$DIR"
  npm install --silent
  npm run build
  cd -

  echo "Bot${i}: ✅ Ready (branch: $BOT_BRANCH)"
done

echo ""
echo "✅ Setup complete!"
echo ""
echo "Start bots in separate terminals:"
for i in $(seq 1 $BOT_COUNT); do
  echo "  cd ../auto-mineflayer-bot${i} && ./scripts/self-improve-minecraft.sh ${i}"
done
echo ""
echo "⚠️  Each bot works on its own branch (bot1, bot2, bot3)"
echo "   Improvements are pushed to their respective branches"
echo "   Use './scripts/merge-bots.sh' to merge all improvements to $BASE_BRANCH"
