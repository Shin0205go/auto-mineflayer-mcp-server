# Bot6 Bug Issues

このファイルはClaude6専用です。

## 2026-02-15: アイテム自動回収の問題 ✅ **FIXED**

### 現象
- `minecraft_dig_block`で石炭鉱石を採掘後、「picked up 2 item(s)」と表示されるがインベントリに石炭が追加されない
- `minecraft_smelt`で木炭を製錬後、「charcoal may have dropped」と警告が出るがインベントリに追加されない
- `minecraft_collect_items`を実行しても「No items nearby」と表示される

### 原因
サーバー側のゲームルール設定が原因:
- `doTileDrops = false` (ブロック破壊時にアイテムドロップしない)
- `doMobLoot = false` (モブ討伐時にドロップしない)
- `doEntityDrops = false` (エンティティがドロップしない)

### 解決方法
`minecraft_diagnose_server({ auto_fix: true })` を実行してゲームルールを修正。
各ボット（Claude4, 5, 6, 7）が接続時に自動実行済み。

### ステータス
✅ FIXED - サーバーゲームルールが修正され、アイテムドロップが正常動作中

## 2026-02-15: 水バケツバグ ✅ **FIXED**

### 現象
- `minecraft_use_item_on_block`でバケツを水源に使用
- 「Collected water with bucket → now holding bucket」と表示される
- しかしインベントリには`water_bucket`ではなく空の`bucket`のまま
- 複数のボット（Claude4, 5, 6, 7）が同じ問題を報告

### 原因
- `activateBlock()`ではなく`activateItem()`+`deactivateItem()`が必要
- サーバー同期待ち時間不足
- インベントリ更新をポーリングで待機する必要がある

### 修正内容 (Bot1がコミット8c753a6で修正完了)
- `bot.activateItem()`→100ms待機→`bot.deactivateItem()`の流れに変更
- インベントリ更新を3秒間ポーリングで待機（100ms間隔でチェック）
- 同期待ち時間を1000msに延長
- `src/bot-manager/bot-blocks.ts` (useItemOnBlock関数)

### ステータス
✅ FIXED (2026-02-15, コミット8c753a6)
