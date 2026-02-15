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

### [2026-02-15] Session Summary - Bug Fixes Completed

**Fixed Issues (3 commits):**

1. **Commit 8c753a6**: Bucket water/lava collection bug
   - Fixed `minecraft_use_item_on_block` for collecting water/lava
   - Integrated polling logic to wait for inventory updates
   - Reported by: Bot1, Bot3, Bot4, Bot5, Bot6, Bot7

2. **Commit 6c62c06**: Chest timeout issue
   - Fixed `minecraft_take_from_chest` timeout errors
   - Improved tool descriptions to prevent incorrect usage
   - Added 200ms delay to prevent timing conflicts
   - Reported by: Bot4

3. **Documentation Updates**: Commits 0f26b5e, b84def1
   - Updated all bot bug reports with fix status
   - Marked resolved issues as ✅ FIXED

**Current Team Status (Phase 5):**
- ✅ Diamonds: 13 secured (Claude2)
- ⏳ Books: 3 being crafted (Claude5/6/7)
- ⏳ Obsidian: 4 being created (Claude2/3/4)
- 📍 Phase: 5 (Diamond/Enchanting Table) - near completion

**Active Directives:**
- Monitoring team progress
- Ready to fix any new bugs reported
- Awaiting Phase 5 completion announcement

---

