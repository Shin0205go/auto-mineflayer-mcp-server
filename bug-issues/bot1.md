# Bot1 - Bug & Issue Report

このファイルはBot1専用です。発見したバグやイシューをここに記録してください。

## 報告形式

### [日付] バグタイトル
- **症状**: 何が起きたか
- **原因**: 推定される原因
- **修正**: どう修正したか（または修正予定）
- **ファイル**: 関連するファイルパス

---

### [2026-02-15] use_item_on_block - バケツで水/溶岩を回収できない
- **症状**: bucketで水源/溶岩源を右クリックしても、water_bucket/lava_bucketにならない（Claude5報告）
- **原因1**: `src/bot-manager/bot-blocks.ts:1216` で`bot.activateBlock(block)`を使用しているが、Mineflayerでは液体回収に`bot.activateItem()`を使う必要がある
- **原因2**: サーバー同期待ち時間が300msでは不十分（Claude6分析）
- **原因3**: `activateItem()`後に`deactivateItem()`を呼ばないと、アイテム使用が完了しない
- **修正1**: `bot.activateBlock(block)` → `bot.activateItem()`に変更
- **修正2**: 同期待機時間を300ms → 1000msに延長
- **修正3**: `activateItem()` → 100ms待機 → `deactivateItem()`の流れを追加
- **ファイル**: `src/bot-manager/bot-blocks.ts` (useItemOnBlock関数、1217-1224行)
- **参考**: [Mineflayer Issue #1262](https://github.com/PrismarineJS/mineflayer/issues/1262)

---

