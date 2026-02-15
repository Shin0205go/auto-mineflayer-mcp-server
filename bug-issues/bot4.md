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

## [2026-02-16] stick crafting failure with all plank types ✅ **FIXED**

- **症状**: `minecraft_craft("stick")` が "missing ingredient" エラーで失敗。birch_planks x19, dark_oak_planks x5 を所持しているのに、dark_oak_planks (5個) を選択してエラーになる。
- **エラーメッセージ**:
  ```
  Failed to craft stick from dark_oak_planks: Error: missing ingredient
  ```
- **根本原因**:
  1. `bot.recipesAll(item.id, null, null)` が空配列を返す（Mineflayerバージョン互換性問題）
  2. Manual recipe fallback (line 415-442) が実装されていたが、`inventoryItems.find()` が最初に見つかった板材（dark_oak_planks x5）を選択
  3. stick作成には2枚必要だが、優先度ロジックがないため数の少ない板材を選んでしまう
- **修正内容** (2026-02-16):
  1. Line 416-418: `find()` → `filter() + sort()` に変更し、最も数の多い板材を選択
  2. Line 448-450: crafting_table も同様に修正
  3. これにより birch_planks x19 が優先的に選ばれる
- **ファイル**: `src/bot-manager/bot-crafting.ts:416-418, 448-450`
- **ステータス**: ✅ 修正完了・ビルド成功 - MCPサーバー再起動待ち

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

## [2026-02-16] No tool to till soil / create farmland ✅ **FIXED**

- **症状**: 小麦農場を作るために種を植えたいが、grass_blockを耕してfarmlandにするツールがない。クワもクラフトできない（stickバグ）。
- **現状**:
  - `minecraft_place_block("wheat_seeds", x, y, z)` は grass_block の上に置けない（farmland が必要）
  - クワをクラフトできない（stick クラフトバグのため）
  - 素手で右クリックして耕す機能がMCPツールに存在しなかった
- **実装内容**:
  1. `src/bot-manager/bot-blocks.ts` に `tillSoil` 関数を追加（line 1271-1337）
  2. `src/tools/building.ts` に `minecraft_till_soil` ツールを追加
  3. `src/bot-manager/index.ts` に `tillSoil` メソッドを追加
- **機能**:
  - grass_block または dirt を farmland に変換
  - クワがあれば自動装備、なければ素手で耕す
  - 移動が必要な場合は自動で近づく
- **ファイル**:
  - `src/bot-manager/bot-blocks.ts:1271-1337`
  - `src/tools/building.ts`
  - `src/bot-manager/index.ts`
- **ステータス**: ✅ 実装完了・ビルド成功 (2026-02-16)

## [2026-02-16] minecraft_fish tool not available in MCP server

- **症状**: `minecraft_fish` ツールが "No such tool available" エラーで呼び出せない。空腹3/20で食料が必要だが釣りができない。
- **調査結果**:
  - `src/tools/combat.ts` に `minecraft_fish` ツール定義が存在（line 113-126）
  - `handleCombatTool` にケース実装済み（line 182-184）
  - `src/bot-manager/bot-survival.ts` に `fish()` 関数実装済み（line 517〜）
  - `src/bot-manager/index.ts` でエクスポート済み（line 77, 457-460）
- **原因**: MCPサーバーが古いバージョンのコードを使っているため、新規追加ツールが認識されない
- **解決策**: MCPサーバーを再起動して最新のビルド済みコードを読み込む
- **回避策**: 夜にクモを倒して糸を入手→釣り竿を作成（ただしstickバグがあるため難しい）
- **ファイル**:
  - `src/tools/combat.ts:113-126, 182-184`
  - `src/bot-manager/bot-survival.ts:517〜`
  - `src/bot-manager/index.ts:77, 457-460`
- **ステータス**: ⚠️ コード実装済み - MCPサーバー再起動待ち

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

## [2026-02-16] minecraft_move_to pathfinding stuck at position

- **症状**: `minecraft_move_to(4, 96, 6)` を繰り返し呼び出しても、位置(3.7, 95, 3.7)から全く動かない。"Moved near wheat at (3.0, 96.0, 6.0)" などの成功メッセージは返るが、`minecraft_get_position()` で確認すると実際の位置が変わっていない。
- **再現手順**:
  1. 現在位置(3.7, 95, 3.7)
  2. `minecraft_move_to(4, 96, 6)` → "Moved near wheat" と返る
  3. `minecraft_get_position()` → (3.7, 95, 3.7) のまま
  4. `minecraft_move_to(5, 95, 3)` → "Reached destination" と返る
  5. `minecraft_get_position()` → (3.7, 95, 3.7) のまま
  6. 何度試しても同じ結果
- **環境**:
  - 周囲の状況: 歩ける方向は east のみ、他は no ground または障害物
  - 足元: cobblestone（自分で設置）
  - 目標: 小麦ブロック (4, 96, 6)、距離3.3ブロック
- **影響**: 小麦の成長確認・収穫ができない。移動が必要な全てのタスクが実行不可。
- **回避策**:
  1. `minecraft_place_block` で足場を作成して経路を確保
  2. `minecraft_find_block` で遠隔確認（近づけないが存在は確認できる）
- **関連**: 同じ移動システムの問題が [2026-02-16] minecraft_move_to not updating position でも報告されており、Claude1が修正済み。しかし、この問題は別の原因（pathfinding の経路探索失敗）と思われる。
- **ステータス**: ⚠️ 未修正 - pathfinding システムの調査が必要

## [2026-02-16] crafting_table recipe fails with wrong plank type

- **症状**: `minecraft_craft("crafting_table")` が "missing ingredient" エラーで失敗。birch_planks x19 を所持しているのに、dark_oak_planks を使おうとしてエラーになる。
- **エラーメッセージ**:
  ```
  Failed to craft crafting_table from dark_oak_planks: Error: missing ingredient
  ```
- **再現手順**:
  1. birch_planks x19, dark_oak_planks x5 をインベントリに持つ
  2. `minecraft_craft("crafting_table")` → エラー "Failed to craft crafting_table from dark_oak_planks"
  3. birch_planks が19個あるのに使われない
- **根本原因**: クラフトシステムが優先的に dark_oak_planks を選択しようとするが、数が足りない（5個 < 必要4個）。birch_planks が19個あるのにフォールバックしない。
- **関連**: stick クラフトバグと同じ根本原因の可能性。recipesAll または材料選択ロジックの問題。
- **影響**:
  - 作業台を破壊してしまった後、再設置できない
  - チームの作業台が不足し、クラフトタスク全般に支障
- **回避策**:
  - dark_oak_planks を捨てて、birch_planks のみにする
  - または手動で板材を統一してから再試行
- **ステータス**: ⚠️ 未修正 - クラフトレシピ選択ロジックの調査が必要

## [2026-02-16] bone_meal crafting fails with item pickup disabled error

- **症状**: `minecraft_craft("bone_meal", 2)` がエラーで失敗し、材料（bone x1）が消失した。bone_meal はクラフトされたがインベントリに入らなかった。
- **エラーメッセージ**:
  ```
  Cannot craft bone_meal: Failed to craft bone_meal: Cannot craft bone_meal: Server has item pickup disabled. Crafted item dropped on ground but cannot be collected. This server configuration is incompatible with crafting. Ingredients consumed: recipe materials lost permanently.
  ```
- **再現手順**:
  1. bone x2 を所持している状態
  2. `minecraft_craft("bone_meal", 2)` を実行
  3. エラーメッセージが返り、bone が1個消費される
  4. bone_meal はインベントリに現れず、地面にドロップした
  5. `minecraft_collect_items()` で回収できた
- **根本原因**: サーバーのgameruleで `doTileDrops` が一時的に無効化されている可能性。または、クラフト直後のアイテムドロップを拾う処理が不十分。
- **影響**: bone_meal など1段階クラフトアイテムが作成できない。材料が無駄に消費される。
- **回避策**: クラフト後に必ず `minecraft_collect_items()` を呼び出す
- **修正案**:
  1. `bot-crafting.ts` の `craft()` 関数末尾に自動で `collectItems()` を追加
  2. または、クラフト失敗時にドロップしたアイテムを自動回収する処理を追加
- **ファイル**: `src/bot-manager/bot-crafting.ts`
- **ステータス**: ⚠️ 未修正 - 回避策（collect_items）で対応可能

