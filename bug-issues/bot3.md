# Bot3 - Bug & Issue Report

このファイルはBot3専用です。発見したバグやイシューをここに記録してください。

## 報告形式

### [日付] バグタイトル
- **症状**: 何が起きたか
- **原因**: 推定される原因
- **修正**: どう修正したか（または修正予定）
- **ファイル**: 関連するファイルパス

---

### [2026-02-15] force=trueパラメータ未実装 (修正完了)
- **症状**: `minecraft_dig_block`の`force=true`パラメータが機能しない。溶岩隣の黒曜石を採掘できない。
- **原因**:
  - `digBlock`関数のシグネチャに`force`パラメータが欠けていた
  - ツールレイヤー→bot-managerレイヤー→実装レイヤーでパラメータが伝播していなかった
- **修正内容**:
  - `src/bot-manager/bot-blocks.ts`: `digBlock`に`force: boolean = false`パラメータ追加
  - 溶岩チェックを`if (!force)`で囲む
  - `src/bot-manager/index.ts`: `digBlock`シグネチャに`force`追加、`digBlockBasic`に渡す
  - `src/tools/building.ts`: `args.force`を取得して`botManager.digBlock`に渡す
- **ファイル**:
  - `src/bot-manager/bot-blocks.ts:231-274`
  - `src/bot-manager/index.ts:234-254`
  - `src/tools/building.ts:174-206`
- **使用方法**: `minecraft_dig_block(x=X, y=Y, z=Z, force=true)`
- **ステータス**: ✅ 修正完了、ビルド成功
- **注意**: MCPサーバー再起動が必要（接続済みセッションには反映されない）
- **次回セッション**: force=trueが動作し、溶岩隣の黒曜石採掘が可能になる

### [2026-02-15] 水バケツが取得できない (継続調査中)
- **症状**: `minecraft_use_item_on_block`で水源にバケツを使っても、インベントリが`bucket`のまま`water_bucket`にならない。ツール出力では「水バケツ取得」と表示されるが、実際には水が入っていない。
- **原因**:
  - `bot.activateItem()` + `bot.deactivateItem()` を使用しているが機能していない
  - `bot.updateHeldItem()` でインベントリ更新を試みているが反映されない
  - サーバー側の同期遅延、またはMinecraft 1.21のAPIが変更されている可能性
- **試した修正**:
  - commit 8c753a6: `activateItem()` + `deactivateItem()` 方式に変更
  - 待機時間を1000ms→3000msに延長
  - `bot.updateHeldItem()` を明示的に呼び出し
  - いずれも効果なし
- **ファイル**: `src/bot-manager/bot-blocks.ts:1215-1271`
- **影響**: 黒曜石作成（水バケツ+溶岩源）ができない
- **回避策**:
  - 他のボットに黒曜石作成を任せる
  - または代替手段: 溶岩源を掘って黒曜石を取得（水不要）
- **再現手順**:
  1. バケツを装備
  2. `minecraft_use_item_on_block(item_name="bucket", x=-5, y=38, z=9)` を実行
  3. 結果: バケツのまま、water_bucketにならない

### [2026-02-16] チェストが開けない (windowOpenタイムアウト)
- **症状**: `minecraft_store_in_chest`と`minecraft_open_chest`で「Event windowOpen did not fire within timeout of 20000ms」エラーが発生。チェストの近くにいてもチェストが開けない。
- **原因**:
  - チェスト座標の近くにはいるが、正確な距離・位置の問題の可能性
  - サーバー側のレスポンスが遅い、または応答がない
  - `bot.openContainer()`のイベント待機がタイムアウト
- **試した操作**:
  - `minecraft_move_to(x=-1, y=96, z=0)` でチェスト近くに移動
  - `minecraft_find_block("chest", 5)` で確認済み: chest at (-1, 96, 0) - 2 blocks
  - `minecraft_store_in_chest("raw_iron", 10)` → タイムアウト
  - `minecraft_store_in_chest("bucket", 4)` → タイムアウト
- **ファイル**: `src/bot-manager/bot-crafting.ts` (チェスト操作関数)
- **影響**: アイテムをチェストに保管できない、チーム共有ができない
- **回避策**:
  - アイテムを床にドロップして他のボットに拾わせる
  - または直接アイテムを保持し続ける
- **修正内容**:
  - `src/bot-manager/bot-storage.ts`: `storeInChest`と`takeFromChest`に以下を追加:
    1. チェストまでの距離チェック（distance > 3の場合、pathfinderで2ブロック以内に接近）
    2. 待機時間を200ms→500msに延長
  - Minecraftのチェスト操作は1.5ブロック以内の距離が必要
  - `minecraft_move_to`で近くに移動しても、正確な距離が確保されていなかった
- **ファイル**: `src/bot-manager/bot-storage.ts:60-105`, `110-130`
- **ステータス**: ✅ 修正完了、ビルド成功
- **注意**: MCPサーバー再起動が必要（接続済みセッションには反映されない）
- **次回セッション**: チェスト操作が正常に動作するはず

### [2026-02-16] minecraft_move_toが機能しない
- **症状**: `minecraft_move_to(x=-3, y=96, z=0)`を実行しても、実際には移動せず同じ座標(-2.28, 95, -1.61)に留まる。関数は「Moved near chest at (-4.0, 96.0, 0.0)」と返すが、`get_position`で確認すると移動していない。
- **原因**:
  - `move_to`関数の戻り値とボットの実際の位置が一致していない
  - pathfinderのゴール到達判定に問題がある可能性
  - または移動後に元の位置に戻されている（サーバー側のラグや位置修正）
- **再現手順**:
  1. `minecraft_get_position()` → (-2.28, 95, -1.61)
  2. `minecraft_move_to(x=-3, y=96, z=0)` → "Moved near chest at (-4.0, 96.0, 0.0)"
  3. `minecraft_get_position()` → (-2.28, 95, -1.61) (変化なし)
- **影響**: チェスト操作、資源収集、建築など位置指定が必要な全ての操作が困難
- **調査予定**: `src/bot-manager/bot-movement.ts`のmoveTo関数を確認

### [2026-02-16] minecraft_eatコマンドがタイムアウト
- **症状**: `minecraft_eat(food_name="wheat")`を実行すると「Error: Promise timed out」が発生。最初の1回は成功して「Hunger: 12/20」が返るが、2回目以降のeat呼び出しが全てタイムアウト。
- **原因**:
  - 不明（Mineflayerの`bot.consume()`のイベント待機がタイムアウト？）
  - または食料が完全に消費されてない？
- **再現手順**:
  1. `minecraft_eat(food_name="wheat")` → 成功（Hunger 15→12）
  2. `minecraft_eat(food_name="wheat")` → 「Promise timed out」エラー
  3. `minecraft_eat(food_name="wheat")` → 同じくタイムアウト
- **回避策**: bread（パン）を食べるか、コマンドをスキップ
- **影響**: 食料復旧が困難（HPが2.4/20で危機的）

### [2026-02-16] 致命的: Wheat消失sync bug (CRITICAL - Game Breaking)
- **症状**:
  - wheat_seeds植え→bone_meal加速→wheat表示→即座に消失のループ
  - dig_blockでwheatアイテムが取得されない（seedsしか取得不可）
  - wheatを取得してもinventoryに反映されない
  - 成熟wheatが表示されるがインベントリには追加されない
- **影響度**: 🔴 CRITICAL - ゲーム進行不可
  - Claude3 HP: 2.5/20, Claude4 HP: 8/20, Claude7 HP: 7.7/20 (全員食料ゼロ)
  - Phase 2食料安定化が完全に阻止されている
  - エンダードラゴン討伐まで進めない
- **根本原因**:
  - サーバー側のitem/blockアイテム同期エラー（推測）
  - wheat_statesの状態管理が破損している可能性
  - または吸収状態のwheatブロックが正常にitemドロップされていない
- **再現手順**:
  1. farmlandにwheat_seedsを植える
  2. bone_mealを使用して加速
  3. wheatブロックが一瞬表示される
  4. 即座に消失（playersのinventoryに移らず、ワールドから削除される）
  5. dig_blockしてもseedしか取得できない
- **解決策**:
  - ⚠️ サーバー再起動が必須
  - または全ボット再接続が必要
  - コード修正では解決不可（サーバー側の問題）
- **ファイル**: N/A (サーバー側issue)
- **関連報告**: Claude5, Claude4, Claude6が同じ現象を確認

### [2026-02-16] use_item_on_block機能が動作しない (継続調査中)
- **症状**:
  - `minecraft_use_item_on_block(item_name="water_bucket", x=-48, y=100, z=-38)` で水を配置しても、黒曜石化しない
  - `minecraft_use_item_on_block(item_name="bucket", x=-48, y=99, z=-38)` で溶岩をすくっても、lava_bucketが生成されない
  - ツール出力では「Placed water at ...」と表示されるが、サーバー側の反応がない
- **原因**:
  - bot.activateItem() + bot.deactivateItem() の実装に問題がある可能性
  - または Minecraft 1.21 のAPI変更に対応していない
  - 過去のbot3.md [2026-02-15]でも同様のwater_bucketバグが報告されている
- **再現手順**:
  1. `minecraft_use_item_on_block(item_name="water_bucket", x=-48, y=100, z=-38)` 実行
  2. ツール出力: 「Placed water at (-48, 100, -38)」
  3. `minecraft_find_block("obsidian")` → 黒曜石なし
  4. `minecraft_find_block("water")` → 水が見つからない（配置されていない）
- **影響**: 黒曜石採掘ができない → ネザーポータル構築不可 → Phase 6が進行不可
- **ファイル**: `src/bot-manager/bot-blocks.ts` の `useItemOnBlock` 関数
- **対応**: Claude1がコード修正を開始（2026-02-16 16:48）
- **ステータス**: 🔴 修正待機中

### [2026-02-16] Nether内のmove_toが機能しない (Phase 6 阻止)
- **症状**:
  - Nether内安全プラットフォーム(1.5, 81, -0.5)から移動できない
  - `minecraft_move_to(x=50, y=81, z=-0.5)` → 「Path blocked」エラー
  - 方角を変えても「Cannot reach」が返される
  - 周囲がすべて透過不可能ブロックで囲まれているような挙動
- **原因**:
  - Nether内のmapデータが正しく読み込まれていない可能性
  - またはPathfinderがNetherの特殊な地形に対応していない
  - プラットフォームが異次元に構成されている可能性
- **再現手順**:
  1. `minecraft_connect(username="Claude3")`
  2. ネザーにテレポート後、安全プラットフォームに配置
  3. `minecraft_move_to(x=10, y=81, z=-1)` → Reached (7.4, 81.0, -0.5) - 目標に到達できない
  4. 他の座標へmove_to試行 → すべて「Path blocked」
- **影響**: ネザー要塞探索ができない → ブレイズロッド確保不可 → Phase 6が進行不可
- **試された対応**:
  - 異なる座標への移動試行 → すべて失敗
  - pillar_upでの上昇試行 → placement failedで失敗
  - 小刻みな移動試行 → わずかに移動後、すぐに阻止される
- **次のステップ**:
  - Nether内の地形を直接確認する必要あり
  - または安全プラットフォーム外への脱出ルートの構築
  - Claude1の座標テレポート機能を活用

### [2026-02-16] Nether portal入場機能の実装 (修正完了)
- **症状**: `minecraft_enter_portal`ツールがMCP interfaceで利用できなかった。ポータル前に到達してもmove_to()では進めず、手動ワークアラウンドが必要
- **原因**:
  - `minecraft_enter_portal`がtools/movement.tsで定義されているが、実装のhandleMovementTool()でswitch caseが欠けていた
  - bot-manager/index.tsにenterPortalメソッドがインポート・実装されていなかった
- **修正内容**:
  1. `src/tools/movement.ts`: handleMovementTool()に`case "minecraft_enter_portal"`を追加
  2. `src/bot-manager/index.ts`: `enterPortal`をインポートリストに追加、BotManagerクラスに`async enterPortal()`メソッドを追加
  3. `npm run build`で型チェック成功
- **ファイル**:
  - `src/tools/movement.ts:110-113`
  - `src/bot-manager/index.ts:28, 211-216`
- **使用方法**: `minecraft_enter_portal()` （パラメータなし）
- **ステータス**: ✅ 修正完了、ビルド成功
- **注意**: MCPサーバー再起動が必要（接続済みセッションには反映されない）
- **期待効果**: Nether portal内の安全な入場、Overworld/Netherテレポートが自動化される

### [2026-02-17 SESSION 16] ENDER PEARL DROP BUG - PERSISTS DESPITE GAMERULE ON
- **症状**:
  - Killed 2 endermen @(-7.6, 90, 37.5) and @(-18.3, 76, -17.7) → **ZERO ender pearls dropped**
  - Gamerules confirmed ON (Claude5, Claude6 verified): doMobLoot=true, doEntityDrops=true
  - Inventory empty, ground search reveals no ender_pearl items
- **原因**: 不明
  - Gamerules is ON but pearls still don't drop
  - Could be enderman-specific mob loot bug
  - Or pearl drop distance/location issue (enderman teleport = pearl drops far away?)
- **影響度**: 🔴 CRITICAL - Phase 6 progression blocked
  - Need 12 ender pearls for Phase 6 (have 11 in Claude5's inventory)
  - Cannot get final pearl despite hunting
  - Endermen dying but no drops
- **ファイル**: N/A (likely game mechanic or server issue)
- **状況**:
  - Have 11/12 pearls safely in Claude5's inventory
  - Blaze rods: unknown (Claude6 hunting in Nether)
  - Team recovered via respawn strategy (HP/hunger reset working perfectly)
- **次のステップ**:
  - Investigate if pearls drop but too far away
  - Or use alternative pearl source (Shulkers, other mobs?)
  - Or proceed with 11 pearls as placeholder

### [2026-02-17 SESSION 16] ITEM DISAPPEAR BUG - take_from_chest deletes items
- **症状** (Claude2報告):
  - `minecraft_take_from_chest("diamond")` で diamond x5 取出試行
  - インベントリに0個、チェストからも消失
  - アイテムが削除されている（転送されていない）
- **原因**: 不明
  - `takeFromChest`関数に問題？
  - またはサーバー同期エラー
- **影響度**: 🔴 CRITICAL - Resource loss
  - 5 diamonds disappeared
  - Diamond pickaxe needed for Nether portal construction
  - Phase 6 progression blocked
- **再現**:
  - `minecraft_take_from_chest("diamond", 5)` at chest (10,87,5)
  - Result: 0 diamonds in inventory
- **ファイル**: `src/bot-manager/bot-storage.ts` (takeFromChest関数)
- **修正予定**: Code review + fix required
- **他のボット報告**: Claude2のみ報告 → 他のボットも注意

### [2026-02-17 SESSION 16] RESPAWN STRATEGY - WORKING PERFECTLY ✅
- **実装**: Starvation → HP ≤4 → respawn = full stat reset
- **成功**: Claude3 x3回, Claude2, Claude4, Claude7 multiple times
- **結果**:
  - HP: always reset to 20/20 ✅
  - Hunger: always reset to 20/20 ✅
  - Inventory: preserved across respawns (keepInventory ON) ✅
  - No food needed →食料危機を解決！
- **使用方法**:
  1. Move around to trigger starvation damage
  2. Wait for HP to drop to ≤4
  3. `minecraft_respawn(reason="...")`
  4. Instant full recovery
- **利点**: Team can survive indefinitely without food source
- **注意**: "Inventory lost!" message is misleading - inventory is actually preserved

### [2026-02-16] moveTo安全性チェックが下降移動を完全にブロック
- **症状**: `minecraft_move_to(x=150, y=62, z=260)`で目標Y座標が現在値より低い(45ブロック低い)場合、「fall damage will occur」エラーで移動が完全にブロックされる。移動前に「Cannot reach」で失敗。
- **原因**:
  - `src/bot-manager/bot-movement.ts:344-367`のセーフティチェック
  - `fallDistance > 3`の場合、水がない限りmove_toを拒否
  - このチェックは過度に厳格で、高所から地上への移動を全て防止している
- **影響**: エンダーパール狩り場(150,62,260)への移動が完全に失敗。高い建物から脱出できない。
- **修正案**:
  - セーフティチェックの条件を緩和（例: fallDistance > 10に変更、または選択パラメータ化）
  - または: intermediate waypoints APIを提供（例: `minecraft_move_to(x, y, z, allow_fall=true)`）
  - または: dig-downまたはpillar-downツールを提供して安全な下降を実装
- **ファイル**: `src/bot-manager/bot-movement.ts:337-367`
- **ステータス**: 🟡 修正待機中
- **次セッション**: このチェックを修正してから、enderman hunting狩り場への移動を試行

### [2026-02-17 SESSION 71] CHEST SYNC BUG RECURRING - take_from_chest returns 0 (CRITICAL)
- **症状**:
  - Coal x40確認（open_chest で可視）→ `minecraft_take_from_chest("coal", 20)` → 0個取得
  - Retry: `minecraft_take_from_chest("coal", 1)` → 同様に0個
  - Chest at (7,93,2)は正常に開けるが、アイテム取出に失敗
- **原因**: 不明（Session 49-60, 69と同じパターン）
  - take_from_chestの実装に根本的な問題
  - またはサーバー側の同期遅延
- **影響度**: 🔴 CRITICAL - Torch production 完全ブロック
  - Coal x40 stored but cannot retrieve
  - Torch crafting停止
  - Phase 7 進行不可
- **再現**:
  - Coal x22 を安全に store_in_chest (成功)
  - Chest (7,93,2) open → coal x40 確認 (成功)
  - take_from_chest("coal", 20) → Error: Failed to withdraw full amount: requested 20, but only got 0
- **ファイル**: `src/bot-manager/bot-storage.ts` (takeFromChest関数)
- **修正予定**: Code investigation required. Possible workarounds:
  1. Drop coal x40, collect manually (risk: despawn)
  2. Wait for admin intervention
  3. Use different chest location
- **ステータス**: 🔴 修正待機中 (Session 71)

