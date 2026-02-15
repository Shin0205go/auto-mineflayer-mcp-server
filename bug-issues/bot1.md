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

### [2026-02-16] Session Start - Phase 5 Final Push

**Current Team Status:**
- ✅ Diamonds: 10 secured (in chest at -10,94,33)
- ✅ Books: 4 crafted (Claude4:2 + Claude7:1 + Claude6:1)
- ⏳ Obsidian: 4 needed (Claude2 mining at -8,37,14 + Claude7 support)
- 📍 Phase: 5 (Diamond/Enchanting Table) - obsidian only

**Team Actions:**
- Claude2: Moving to obsidian site (-8,37,14), ETA 3 minutes
- Claude7: Heading to support Claude2 with diamond pickaxe
- Claude4/5: Book crafting completed
- Claude3: Awaiting food gathering task
- Others: Standby for Phase 2 food preparation

**Issued Directives:**
- @Claude2: Proceed to (-8,37,14), use force=true for lava-adjacent obsidian
- @Claude7: Support obsidian mining at (-8,37,14)
- @Claude3-6: Start food gathering for Phase 2 (parallel task)

**Monitoring:**
- No new bugs reported
- All critical bugs fixed (water bucket, chest timeout, force parameter)
- Team coordination excellent
- Phase 5 completion imminent (waiting for 4 obsidian blocks)

---

### [2026-02-16] force=true parameter not working (MCP server restart required)

**Problem**: Claude7 reports force=true parameter not working during obsidian mining
- **Symptom**: Lava warning persists even when using force=true parameter
- **Cause**: Code was fixed in commit 46bf72c but MCP server has not been restarted
- **Status**: ⏳ MCP server restart required to load fixed code
- **Workaround**: Using water bucket to solidify lava (Claude6 delivering to Claude7)
- **Next Action**: Restart MCP server after Phase 5 completion

---

### [2026-02-15] minecraft_dig_block force parameter implementation

**Problem**: `force` parameter was defined in tool schema but not implemented in code
- Schema had `force: boolean` parameter in `minecraft_dig_block` tool
- Description: "Force dig even if lava is adjacent (default: false). Use when mining obsidian or other blocks that naturally generate next to lava."
- However, the parameter was never extracted from args or passed to digBlock function
- Lava safety check was always active, preventing obsidian mining near lava

**Solution**: Implemented force parameter chain
1. `src/tools/building.ts:179` - Extract force parameter from args
2. `src/tools/building.ts:206` - Pass force to botManager.digBlock()
3. `src/bot-manager/index.ts:234` - Add force parameter to method signature
4. `src/bot-manager/index.ts:254` - Pass force to digBlockBasic()
5. `src/bot-manager/bot-blocks.ts:241` - Add force parameter to function
6. `src/bot-manager/bot-blocks.ts:260-274` - Wrap lava check in `if (!force)` condition
7. Updated error message to mention "force=trueで強制採掘可能"

**Impact**:
- Obsidian mining near lava now possible with `force=true`
- Claude2 and Claude3 can now mine obsidian for Phase 5
- Build successful, ready for testing

**Files Modified**:
- `src/tools/building.ts`
- `src/bot-manager/index.ts`
- `src/bot-manager/bot-blocks.ts`

**Status**: ✅ Committed (46bf72c)

**Note**: MCP server restart required for changes to take effect

---

