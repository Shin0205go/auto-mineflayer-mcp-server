# CLAUDE.md - Mineflayer Bot

Claude AI が Minecraft を自律プレイ。マルチボット協調、Phase 制。

## 必須 CLI

```bash
# ボット接続
node scripts/mc-connect.cjs localhost 25565 Claude1

# コード実行（主操作）
BOT_USERNAME=Claude1 node scripts/mc-execute.cjs "log(bot.health + ' ' + bot.food)"

# チャット送信
node scripts/admin-chat.cjs "[指示] メッセージ"
```

## mc_execute API

**`bot` は mineflayer Bot。公式API を直接使う:**
`bot.chat()`, `bot.dig()`, `bot.attack()`, `bot.craft()`, `bot.pathfinder.goto()`, `bot.findBlock()`, `bot.nearestEntity()`, `bot.inventory.items()` など。

**注:** mc_execute 内では `require()` 不可。以下は注入済み:

```js
// Bot (mineflayer インスタンス)
bot, bot.health, bot.food, bot.entity.position, bot.inventory.items()

// Pathfinder
Movements, goals, Vec3

// Util
await wait(ms), log(msg), getMessages()
```

詳細: `.claude/rules/mc-execute-api.md`, mineflayer docs: https://github.com/PrismarineJS/mineflayer

## マルチボット・フェーズ制

**目標:** エンダードラゴン討伐
**リーダー:** Claude1 (指示)
**フォロワー:** Claude2〜7 (従属)

| Phase | 目標 | 完了条件 |
|-------|------|----------|
| 1-2 | 拠点・食料 | 作業台・かまど・チェスト・食料 |
| 3-4 | 石・鉄装備 | 全員が石以上の道具 |
| 5-6 | ダイヤ・ネザー | エンチャント・ブレイズロッド |
| 7-8 | エンド | ドラゴン撃破 |

リーダー: `[フェーズ] Phase N 開始`
完了時: `[報告] Phase N 完了`

## 核心ルール

- **毎アクションごとにチャット報告** (`bot.chat()` or `admin-chat.cjs`)
- **死亡 = バグ** → `bug-issues/botN.md` に記録
- **食料で HP回復** (リスポーン禁止)
- **穴埋め** (pathfinder 通路確保)
- **ゲーム仕様で詰まったら WebSearch 調査後行動**

## 詳細ドキュメント

詳しい内容は `.claude/rules/` を参照:
- `survival-rules.md` — HP/食料/夜間対策
- `death-prevention.md` — 死亡防止チェックリスト
- `phase-guide.md` — 各フェーズの詳細
- `skills-guide.md` — 21 スキル (オンデマンド Read)

## コード修正ポリシー

ゲームエージェント → バグ報告のみ (`bug-issues/botN.md`)
コードレビューアー → bug-issues/* を読んで src/ 修正

---
実装情報: `.claude/meta.md` / フィードバック: `.claude/feedback/`
