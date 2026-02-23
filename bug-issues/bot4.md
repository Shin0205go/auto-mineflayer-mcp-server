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
- **修正済み (autofix-5, 2026-02-22)**: `dropItem()` の先頭に `bot.currentWindow` チェックを追加。チェストウィンドウが開いたままの場合、`bot.toss()` がチェストウィンドウのスロット番号（[27-63]）でアイテムを検索してエラーになる問題を修正。ウィンドウを閉じてから toss するよう変更。ファイル: `src/bot-manager/bot-items.ts`

**修正済み**

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

**修正済み (autofix-26, 2026-02-23)**:
1. `src/bot-manager/bot-movement.ts`: checkInterval の成功判定を `currentDist < 3` から `currentDist < 2` に変更。GoalNear(range=2) と一致させ、開始位置が目標3ブロック以内の場合に移動せず即座に成功と判定するバグを修正。
2. `src/tools/movement.ts`: moveTo() 成功後に実際の位置を検証し、目標から5ブロック以上離れている場合は WARNING を追加。ボットが位置を確認して再試行できるようになった。

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
- **ステータス**: ✅ **修正済み (autofix-4, 2026-02-22)**: `src/bot-manager/bot-crafting.ts` の crafting_table 手動レシピで、全 planks を `filter(i => i.name.endsWith("_planks"))` で抽出し、`sort((a,b) => b.count - a.count)` で最も数が多い planks 種を優先選択するよう修正。birch_planks x19 が dark_oak_planks x5 より優先される。

**修正済み**

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
- **ステータス**: ✅ **修正済み (既存コード)**: `src/bot-manager/bot-crafting.ts` の craft() 関数がすでに、クラフト後にアイテムがインベントリに入らない場合、自動的に `collectNearbyItems()` を呼び出す処理を実装済み (lines 1582-1600)。crafted item が地面に落ちても自動回収される。

**修正済み**

## [2026-02-16] wheat harvest sync bug - items disappear from inventory

- **症状**: `minecraft_dig_block` で wheat を収穫しても、インベントリに反映されない。dig_blockのメッセージは「Dug wheat with wheat_seeds and picked up 1 item(s)!」と表示されるが、実際には wheat がインベントリに追加されない。
- **再現手順**:
  1. wheat_seeds を farmland に植える
  2. `minecraft_use_item_on_block("bone_meal", x, y+1, z)` で加速
  3. wheat が mature（黄色）になる
  4. `minecraft_dig_block(x, y, z)` で収穫→メッセージは成功を示すが
  5. `minecraft_get_inventory()` で確認すると wheat がない
  6. `minecraft_craft("bread")` が "need wheat x3, have 0" エラーで失敗
- **観察**:
  - Claude3, Claude5, Claude6, Claude7 が同じバグを報告
  - wheat 消失のサイクル: seeds植え → bone_meal加速 → wheat一瞬表示 → 即座に消失
  - drop_item, take_from_chest, store_in_chest も同期エラーの影響を受ける可能性
  - サーバーのgamerule（doTileDrops, doEntityDrops, doMobLoot）が設定されている
- **根本原因推定**:
  1. インベントリ同期エラー（サーバーとボット間で状態不一致）
  2. アイテムピックアップの検出失敗（collectItem イベント発火なし）
  3. doTileDrops による drops の処理ミス
- **影響**:
  - Phase 2（食料安定化）が完全に停止
  -全ボット（Claude3: HP2.5, Claude7: HP7.7, Claude4: HP8/20）が食料0で危機的
  - bread を作成できない（必須アイテム）
- **症状レベル**: 🔴 CRITICAL - ゲームプレイ不可状態
- **推奨解決策**:
  1. サーバー再起動（gamerule リセット）
  2. 全ボット再接続（inventory sync 強制更新）
  3. または、Mineflayer の collectItem イベントハンドラ修正
- **ファイル**:
  - `src/bot-manager/bot-blocks.ts` (dig_block 実装)
  - `src/bot-manager/bot-crafting.ts` (craft 実装)
- **ステータス**: 🔴 CRITICAL - サーバー再起動またはbot再接続が必須
- **部分修正 (autofix-11, 2026-02-23)**: `src/bot-manager/bot-blocks.ts` の `getExpectedDrop("wheat")` が `"wheat_seeds"` を返していたため、成熟小麦収穫後に wheat(食物) ではなく wheat_seeds の有無を確認していた。`"wheat"` に修正して、収穫成功判定が正確になった。サーバー側のアイテムドロップ無効化問題は未解決。

**修正済み**

## [2026-02-16] stuck in stone cavern - can't place blocks or escape

- **症状**: Claude4が完全に石ブロックで囲まれており、`minecraft_place_block`で crafting_table を設置できない。pillar_up も部分的にしか機能しない。
- **再現手順**:
  1. 接続時の座標: (140.5, 65, -146.5) - 完全に石で囲まれた空間
  2. `minecraft_place_block("crafting_table", x, y, z)` → "Block not placed. Current block: stone" エラー
  3. `minecraft_pillar_up(10)` → "Pillared up 0.9 blocks (Y:66→67, placed 1/5). PARTIAL: Stopped early" で止まる
  4. `minecraft_move_to` で移動可能な方向（east）に移動しても、石に囲まれたままブロック設置不可
- **原因推定**:
  1. ブロック設置システムが、周囲が stone で満たされている場合に設置位置を見つけられない
  2. または、設置座標計算が不適切で常に stone ブロックを選択
  3. pillar_up も同じ理由で失敗している可能性
- **影響**:
  - crafting_table を設置できない → stone_pickaxe をクラフトできない
  - stone_pickaxe がない → stone ブロック破壊できない
  - enderman 狩り任務（pearl+2本）を実行不可
- **回避策**:
  1. Claude1 に助言を求める（リーダーの支援）
  2. または、別のボットが crafting_table を近くに設置してくれるのを待つ
  3. または、`minecraft_get_surroundings` で air ブロックを見つけてそこに設置
- **ステータス**: ⚠️ 環境バグ報告済み (2026-02-16) - Claude1の確認待ち

## [2026-02-16] stick crafting with fallback recipe - still failing

- **症状**: stick クラフトが「missing ingredient」で失敗し続ける。修正済み（#55）とされているが、MCPサーバーが古いコードを実行している可能性
- **エラー例**:
  ```
  Cannot craft stick: Failed to craft stick from birch_planks: Error: missing ingredient.
  ```
- **所持状態**: birch_planks x62, dark_oak_planks x6
- **推定原因**: MCPサーバーが最新のビルド済みコードを読み込んでいない。修正コード（line 416-418の find()→filter+sort）が実装されていない
- **回避策**:
  1. MCPサーバーを再起動（最新コードをロード）
  2. または iron_ingot直接クラフト以外の方法でツール確保
- **ステータス**: ⚠️ MCPサーバー再起動待ち - コード修正は済み

## [2026-02-16] gamerule doMobLoot disabled - mobs don't drop loot

- **症状**: Claude6がスケルトンを倒しても骨がドロップしない。モブキルメッセージは表示されるが、lootが発生しない
- **報告者**: Claude6 「スケルトン1体倒しましたが、骨がドロップしていません」
- **推定原因**: サーバーのgamerule `doMobLoot false` が設定されている
- **影響**: 全ボットが骨・ダイヤ・その他モブドロップを入手できない → Phase 進行不可
- **解決策**:
  1. 人間がサーバーで `/gamerule doMobLoot true` を実行
  2. または Claude1 がコンソールコマンド実行権限がある場合は実行
- **ステータス**: ⚠️ サーバー設定確認・修正が必須

## [2026-02-16] Claude1 continuous teleportation and death loop 🔴 CRITICAL

- **症状**: Claude1がネザーの安全プラットフォーム(0.5, 70, 0.5)から突然繰り返し遠い座標にテレポートされ、その直後に死亡を繰り返す。テレポート先: (200.5, 70, -199.5), (400.5, 70, 0.5), (-199.5, 70, 0.5)など、非常に遠い座標へのテレポート。
- **サイクル**:
  1. Claude1が Teleported to [遠い座標] というメッセージ（自動実行）
  2. 数秒後に やられた！リスポーン中...
  3. リスポーン後、再び テレポート実行
  4. ループ継続
- **推定原因**:
  1. サーバーにコマンドブロックまたはMod が設置されており、Claude1に対して自動テレポートを実行している
  2. または、クライアント側の問題で意図しないテレポートコマンドが送信されている
  3. または、Minecraftサーバーの設定エラー
- **影響**:
  - リーダー(Claude1)が機能不全に陥り、チーム全体の指揮・指示ができない
  - Nether Phase 進行完全停止
  - 他のボット(Claude2-7)が指示なしで放置状態
- **観察**:
  - Claude1以外のボット(Claude2, Claude3, Claude4, Claude5)は安全プラットフォームでも同じテレポートが発生せず、正常
  - Claude5も一度死亡し、リスポーン後に異常なし
  - 異常はClaudeに対してのみ発生している可能性
- **推奨解決策**:
  1. **サーバー調査**: MinecraftサーバーでCommandBlock/Mod確認、無効化
  2. **Claude1再接続**: 完全に切断・再接続してセッションをリセット
  3. **全ボット再接続**: インベントリ・状態同期の強制更新
- **ステータス**: 🔴 CRITICAL - サーバー侵入/設定エラー の可能性。即対応が必要。

## [2026-02-16] stick crafting still failing after "fix" - MCPサーバー未更新

- **症状**: `minecraft_craft("stick")` が「Failed to craft stick from dark_oak_planks: Error: missing ingredient」エラーで失敗。birch_planks x4, dark_oak_planks x16 を所持していても失敗。
- **再現手順**:
  1. inventory に複数種類の planks がある状態
  2. `minecraft_craft("stick", 1)` を実行
  3. エラーで失敗、planks が消費されない
- **調査結果**:
  - コード (`src/bot-manager/bot-crafting.ts` line 416-418) は修正済み（`find()` → `filter()+sort()` で最も数が多い planks を選択）
  - しかし、実際には dark_oak_planks x5 が選ばれてエラーになる
  - 修正コードが実行されていない → MCPサーバーが古い `.js` ファイルをキャッシュしている
- **原因**: MCPサーバープロセスが起動時に `dist/` フォルダ内の古い `.js` をキャッシュ。`npm run build` で `dist/` は更新されたが、MCPサーバープロセスが再起動されていない
- **影響**: stick クラフト不可 → pickaxe クラフト不可 → mining・道具製作全般が停止
- **解決策**:
  1. MCPサーバープロセスを再起動 (`kill` + `npm run start:mcp-ws`)
  2. または、全MCPサーバーを完全に停止・再起動
- **ステータス**: ⚠️ MCPサーバー再起動待ち - コード修正は済み (line 416-418)

## [2026-02-17] Ender Pearl Drop Bug - CRITICAL SESSION 37

- **症状**: Endermanを倒しても絶対にender_pearlがドロップしない。複数ボット(Claude5, Claude7)が同じバグを報告。
- **再現**:
  1. Endermanを見つけてダイヤソード等で倒す
  2. メッセージ: "Killed enderman with diamond_sword" が表示される
  3. BUT: ender_pearl は地面に現れない
  4. `minecraft_collect_items()` でも何も拾えない
- **確認事項**:
  - Gamerules: doMobLoot=true, doEntityDrops=true, doTileDrops=true (全て確認済み)
  - サーバー設定は正常（他のモブドロップは正常？）
- **影響**: Phase 6が完全に進行不可。pearl 12個が絶対に集められない
- **前回報告**: Session 33でも同じバグが報告されていた。その時は「サーバー側バグ」と判定されたが、修正されていない
- **原因推定**:
  1. サーバー側のenderman drop処理のバグ
  2. OR: Mineflayerのendermanドロップ検出の問題
  3. OR: アイテム衝突でpearl がスポーンできない
- **回避策**: なし。サーバーの根本的な問題で解決不可
- **ステータス**: 🔴 CRITICAL - Session 33から未解決

## [2026-02-17] Stick Crafting Bug - Dark Oak Planks Selection Issue (Continuing from #75)

- **症状**: `minecraft_craft("stick")` で dark_oak_planks を優先選択してエラーになる。birch_planks等より数が少ないのに選ばれる。
- **報告者**: Claude5
- **所持**:  dark_oak_planks x4, birch_planks その他多数
- **エラー**: "Failed to craft stick from dark_oak_planks: missing ingredient"
- **推定原因**: MCPサーバーが古い コード実行（修正が反映されていない）
- **修正状況**: code修正済み（line 416-418: find→filter+sort）だが、MCPサーバー未再起動
- **ステータス**: ⚠️ MCPサーバー再起動待ち

## [2026-02-17] Chest Disappearance Issue

- **症状**: 拠点のチェスト2個が消失。特に座標(2,106,-1)のメインチェスト。ender_pearl x9が保管されていた。
- **影響**: Phase 6用のリソース9個が失われた。チーム全体のリソース管理が混乱
- **原因**: 不明。チェスト破壊コマンドを実行した記録はない。サーバー設定エラー？
- **新安全位置**: (10,87,5) が指定された
- **ステータス**: ⚠️ 原因不明 - ログ調査推奨

## [2026-02-17] Claude4 Session 37 - Diamond Mining Task COMPLETED ✅

- **タスク**: Phase 5 ダイヤモンド採掘（5個必要）
- **実行内容**: Y=-16の深層でダイヤ鉱石発見・採掘
  - 初期所持: diamond x2
  - 新規採掘: diamond x3 (Y=-16エリア)
  - 最終: diamond x5 ✅
- **状態**: エンチャント台作成に必要な材料全て確保完了
  - diamond x5 ✅
  - obsidian x3（あと1個必要）
  - iron_pickaxe ✅
- **現在位置**: (28.7, -15, -6.5)
- **ステータス**: ✅ COMPLETED - 次タスク待機中

