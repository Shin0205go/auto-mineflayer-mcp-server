# Bot3 - Bug & Issue Report

このファイルはBot3専用です。発見したバグやイシューをここに記録してください。

## 報告形式

### [日付] バグタイトル
- **症状**: 何が起きたか
- **原因**: 推定される原因
- **修正**: どう修正したか（または修正予定）
- **ファイル**: 関連するファイルパス

---

### [2026-02-15] 水バケツが取得できない ✅ **FIXED**
- **症状**: `minecraft_use_item_on_block`で水源にバケツを使っても、インベントリが`bucket`のまま`water_bucket`にならない。ツール出力では「Collected water with bucket」と表示されるが、実際には水が入っていない。
- **原因**: `activateBlock()`ではなく`activateItem()`+`deactivateItem()`を使う必要がある。サーバー同期待ち時間不足。
- **修正**: Bot1がコミット8c753a6で修正完了。`src/bot-manager/bot-blocks.ts`のuseItemOnBlock関数を修正。
- **ファイル**: `src/bot-manager/bot-blocks.ts` (useItemOnBlock関数)
- **修正内容**:
  - `bot.activateItem()`→100ms待機→`bot.deactivateItem()`の流れに変更
  - インベントリ更新を3秒間ポーリングで待機
  - 同期待ち時間を1000msに延長
- **ステータス**: ✅ FIXED (2026-02-15, コミット8c753a6)

