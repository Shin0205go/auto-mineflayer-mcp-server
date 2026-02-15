# Bot4 - Bug & Issue Report

このファイルはBot4専用です。発見したバグやイシューをここに記録してください。

## 報告形式

### [日付] バグタイトル
- **症状**: 何が起きたか
- **原因**: 推定される原因
- **修正**: どう修正したか（または修正予定）
- **ファイル**: 関連するファイルパス

---

## [2026-02-15] buildSystemPromptFromConfig missing export

- **症状**: エージェント起動時に`Export named 'buildSystemPromptFromConfig' not found in module`エラー
- **原因**: `claude-agent.ts`がインポートしようとしたが`claude-client.ts`にエクスポートされていなかった
- **修正**:
  1. `buildSystemPromptFromConfig`関数を`claude-client.ts`に追加・エクスポート
  2. `updateSystemPrompt`メソッドを`ClaudeClient`に追加
  3. `callMCPTool`メソッドを`ClaudeClient`に追加
  4. `AgentResult`に`toolCalls`フィールド追加
- **ファイル**: `src/agent/claude-client.ts`
- **ステータス**: ✅ 修正完了

## [2026-02-15] minecraft_use_item_on_block water bucket bug

- **症状**: `minecraft_use_item_on_block`で水源から水を汲んでも、インベントリに`water_bucket`ではなく空の`bucket`のまま残る。メッセージは「Collected water with bucket → now holding bucket. Block at (-69, 62, -52) cleared.」と表示されるが、実際には水が入っていない
- **原因**: `bot.activateBlock(block)`の後、待機時間が300msと短く、インベントリ更新が間に合わなかった。また、`bot.heldItem`ではなくインベントリ全体から`water_bucket`を探す必要があった
- **影響**: 黒曜石作成にwater_bucketが必要だが、バケツで水を汲めないため作業不可
- **修正内容**:
  1. 待機時間を300ms→500msに延長
  2. インベントリ全体から`water_bucket`または`lava_bucket`を検索して確認
  3. バケツが正しく変換されていない場合、明示的にバグメッセージを返す
- **ファイル**: `src/bot-manager/bot-blocks.ts:1210-1236`
- **ステータス**: ✅ 修正完了・ビルド成功

## [2026-02-15] minecraft_take_from_chest timeout error ✅ **FIXED**

- **症状**: `minecraft_take_from_chest`で「Event windowOpen did not fire within timeout of 20000ms」エラーが発生。`minecraft_open_chest`は成功してチェスト内容を表示できるが、その直後の`minecraft_take_from_chest`がタイムアウトする
- **再現手順**:
  1. `minecraft_open_chest(x, y, z)` → 成功（チェスト内容表示）
  2. `minecraft_take_from_chest(item_name, count)` → タイムアウトエラー
- **原因**: `minecraft_open_chest`がチェストを閉じた直後に`minecraft_take_from_chest`が再度開こうとすると、タイミング問題で失敗する。また、エージェントが誤って両方を連続呼び出ししていた（不要）。
- **修正内容**:
  1. ツールの説明文を改善 - `minecraft_take_from_chest`と`minecraft_store_in_chest`は自動でチェストを開くことを明記
  2. `minecraft_open_chest`の説明に「取得/保存には使わず、閲覧のみ」と明記
  3. `takeFromChest`と`storeInChest`に200msの待機時間を追加（タイミング問題回避）
- **ファイル**:
  - `src/tools/storage.ts` (ツール説明)
  - `src/bot-manager/bot-storage.ts` (実装)
- **ステータス**: ✅ 修正完了 (2026-02-15)

## [2026-02-16] stick crafting failure with birch_planks

- **症状**: `minecraft_craft("stick")` が "no compatible recipe" エラーで失敗。`birch_planks` x4 所持時。
- **エラーメッセージ**:
  ```
  Failed to craft stick from birch_planks: Error: missing ingredient
  Cannot craft stick: No compatible recipe found. Have 4 planks and 0 sticks.
  ```
- **再現手順**:
  1. birch_log を採掘 → birch_planks x4 をクラフト
  2. `minecraft_craft("stick", 1)` → 失敗
  3. `minecraft_craft_chain("diamond_pickaxe")` → stick不足で失敗
- **原因推定**: `src/bot-manager/bot-crafting.ts` 356-460行の special handling で、`allRecipes.find()` (line 428) が birch_planks → stick のレシピを見つけられない。Minecraft version compatibility issue の可能性。
- **影響**: diamond_pickaxe を作成できず、黒曜石採掘タスクを実行できない。
- **回避策**:
  1. oak_log など別の木材タイプを試す
  2. チームメンバーに黒曜石採掘を委譲（Claude6 が実施）
- **調査必要**:
  - mcData に現在の Minecraft version 用のレシピがあるか確認
  - line 428 の `compatibleRecipe` 検索ロジックをデバッグ
  - birch_planks 使用時に `needsPlanks` フラグが正しく立つか確認
- **ステータス**: ❌ OPEN - 要調査。Claude6 が黒曜石採掘を代行中。

