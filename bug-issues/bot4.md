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

## [2026-02-16] stick crafting failure with all plank types

- **症状**: `minecraft_craft("stick")` が "missing ingredient" エラーで失敗。birch_planks, dark_oak_planks どちらでも同じ。
- **エラーメッセージ**:
  ```
  Failed to craft stick from birch_planks/dark_oak_planks: Error: missing ingredient
  ```
- **再現手順**:
  1. birch_log または dark_oak_log を採掘 → planks をクラフト
  2. `minecraft_craft("stick", 2)` → 失敗
- **追加再現ケース (Claude4)**:
  1. birch_log x14 所持、birch_planks x25 所持
  2. birch_log → birch_planks x4 クラフト成功（合計41個に）
  3. `minecraft_craft("stick", 4)` → "Failed to craft stick from dark_oak_planks: Error: missing ingredient"
  4. インベントリにはbirch_planks x41, dark_oak_planks x2 があるが、stickを作れない
- **根本原因**: `bot.recipesAll(item.id, null, null)` が空配列を返す。Mineflayerまたはminecraft-dataのバージョン互換性問題。
- **試した修正**:
  1. (2026-02-16 18:xx) `bot.recipesFor()` をフォールバックとして追加 (line 409-429) - 効果なし
  2. dark_oak_planks で試す - 同じエラー
  3. birch_log から新規planksをクラフトしてから試す - 同じエラー
- **影響**:
  - diamond_pickaxe を作成できず、黒曜石採掘タスクを実行できない
  - 鍬（hoe）を作成できず、畑を作れない（farmland作成不可）
  - 種を植えられないため、食料確保ができない
- **次のステップ**:
  1. MCPサーバーを再起動して修正コードを適用
  2. それでも失敗する場合、手動でレシピオブジェクトを作成
  3. または、チームメンバーにダイヤツール作成を委譲
- **ステータス**: ⚠️ 修正試行中 - MCPサーバー再起動待ち

## [2026-02-16] minecraft_move_to not updating position (✅ FIXED)

- **症状**: `minecraft_move_to(x, y, z)` が "Moved near chest at ..." と成功メッセージを返すが、`minecraft_get_position()` で確認すると実際の位置が変わっていない。元の位置(-11.52, 94.88, 32.5)に留まったまま。
- **再現手順**:
  1. `minecraft_move_to(-10, 94, 33)` → "Moved near chest at (-10.0, 95.0, 33.0)" と返る
  2. `minecraft_get_position()` → 位置が(-11.52, 94.88, 32.5)のまま変わらない
  3. 複数回試しても同じ結果
- **影響**:
  - チェストからアイテムを取得できない（`minecraft_take_from_chest` は最も近いチェストを選ぶため、目標のチェストに近づけない）
  - 移動が必要な全てのタスクが実行不可
- **関連**: bot-storage.ts の `takeFromChest` は `bot.findBlock` で最も近いチェストを自動選択するため、`openChest` で開いたチェストと異なるチェストが選ばれる問題もある
- **原因特定**: `moveToBasic` の距離チェック（line 94-99）が、現在地から目標まで2ブロック未満の場合に即座に成功と判定していた。このため、既に目標の近くにいる場合、実際には移動せずに成功メッセージだけを返していた。
- **詳細**:
  - moveToBasic の開始時に `distance < 2` をチェック
  - 条件に合致すると pathfinder を起動せずに即座にリターン
  - 目標が2ブロック以上離れていれば正常に移動する
  - 2ブロック以内の短距離移動は「既に到着済み」と判定されて移動しない
- **回避策**: 一旦3ブロック以上離れた位置に移動してから、目標位置に移動する（2段階移動）
- **修正**: ✅ Claude1が修正完了 (2026-02-16)。94-99行の早期リターンを削除し、GoalNear(range=2)が距離チェックを行うようにpathfinderに任せる形に変更
  2. 移動開始時の距離を記録し、実際に移動したかチェック
  3. 最初のチェックで既に近い場合は「Already near target」メッセージを返す
- **ステータス**: ⚠️ 原因特定済み・回避策あり - 恒久的修正は要検討（他機能への影響調査必要）

## [2026-02-16] No tool to till soil / create farmland

- **症状**: 小麦農場を作るために種を植えたいが、grass_blockを耕してfarmlandにするツールがない。クワもクラフトできない（stickバグ）。
- **現状**:
  - `minecraft_place_block("wheat_seeds", x, y, z)` は grass_block の上に置けない（farmland が必要）
  - クワをクラフトできない（stick クラフトバグのため）
  - 素手で右クリックして耕す機能がMCPツールに存在しない
- **必要な機能**: `minecraft_till_soil(x, y, z)` - grass_block/dirt を farmland に変換するツール
- **実装案**:
  ```typescript
  async tillSoil(x: number, y: number, z: number): Promise<string> {
    const block = bot.blockAt(new Vec3(x, y, z));
    if (!block || (block.name !== 'grass_block' && block.name !== 'dirt')) {
      return `Cannot till: block at (${x},${y},${z}) is ${block?.name || 'air'}`;
    }
    // Use any item to right-click the block (or equip a hoe if available)
    await bot.activateBlock(block);
    await new Promise(r => setTimeout(r, 300));
    const newBlock = bot.blockAt(new Vec3(x, y, z));
    if (newBlock?.name === 'farmland') {
      return `Tilled soil at (${x},${y},${z})`;
    }
    return `Failed to till at (${x},${y},${z})`;
  }
  ```
- **ファイル**: 新規ツール `src/tools/farming.ts` または `src/bot-manager/bot-farming.ts`
- **ステータス**: ⚠️ 未実装 - 次セッションで追加必要

## [2026-02-16] Inventory full error despite dropping items

- **症状**: `minecraft_take_from_chest` が "Bot inventory is full" エラーを返すが、複数のアイテム（cobblestone x320, dirt x192, gold_ingot x27等）を捨てても、インベントリが満杯と判定され続ける。
- **再現手順**:
  1. 大量のアイテムを drop_item で捨てる（合計500個以上）
  2. `minecraft_take_from_chest("wooden_hoe")` → "inventory is full" エラー
  3. `minecraft_get_inventory()` → 36スロット全て埋まっている（コブルストーン x64 が10個以上など）
  4. さらに drop_item を繰り返しても、インベントリが満杯のまま
- **観察**:
  - `minecraft_drop_item("cobblestone", 64)` → 成功メッセージが返るが、インベントリからは消えない
  - `minecraft_drop_item("cobblestone")` → "Can't find cobblestone in slots [27 - 63]" エラー（実際にはスロット0-26にある）
  - `minecraft_store_in_chest("cobblestone")` → "Can't find cobblestone in slots [27 - 63]" エラー
- **原因推定**:
  1. スロット番号の認識バグ（スロット27-63を検索しているが、アイテムはスロット0-26にある）
  2. インベントリ同期の問題（サーバーとクライアントで状態が一致していない）
  3. drop/store操作後のインベントリ更新が遅延している
- **影響**: インベントリが満杯と判定され、チェストからアイテムを取得できない。畑作成に必要なクワを取得できず、タスク実行不可。
- **回避策**: 他のボット（Claude7）にクワ作成を依頼し、直接受け渡しする
- **ステータス**: ⚠️ 未修正 - インベントリ管理システムの調査が必要

