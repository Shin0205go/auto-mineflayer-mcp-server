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

