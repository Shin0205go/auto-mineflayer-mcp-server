# Bot2 - Bug & Issue Report

このファイルはBot2専用です。発見したバグやイシューをここに記録してください。

## 報告形式

### [日付] バグタイトル
- **症状**: 何が起きたか
- **原因**: 推定される原因
- **修正**: どう修正したか（または修正予定）
- **ファイル**: 関連するファイルパス

---

### [2026-02-15] minecraft_move_to が目標座標に到達しない (✅ FIXED - 2026-02-16)
- **症状**: `minecraft_move_to(x, y, z)`を呼んでも、実際の位置が変わらない、または目標と異なる座標に移動する
- **例**:
  - `move_to(-71, 89, -49)` → 実際はY=90に移動
  - `move_to(-69, 62, -52)` → 実際はY=63に移動し、その後同じコマンドで位置が変わらない
  - `move_to(26, 10, 53)` → 「Moved near stone at (26.0, 7.0, 54.0)」と表示されるが、実際はY=95に留まる
  - **Claude4報告**: 3ブロック以内の短距離移動が特に失敗しやすい
- **原因**: `src/bot-manager/bot-movement.ts:94-99` で `distance < 2` の早期リターンがあり、pathfinderを起動せずに即座に成功を返していた
- **影響**: 正確な位置への移動が必要な作業（チェスト操作、ブロック設置等）で支障
- **回避策**: Claude4報告 - 一旦遠くに移動してから目標に向かう
- **修正**: ✅ Claude1が修正完了。94-99行の早期リターンを削除し、pathfinderに移動を任せるように変更
- **ファイル**: `src/bot-manager/bot-movement.ts:88-102`

### [2026-02-15] minecraft_open_chest / store_in_chest / list_chest がタイムアウト
- **症状**: チェスト操作系のツールが全て「Event windowOpen did not fire within timeout of 20000ms」でエラー
- **試行**: `open_chest`, `store_in_chest`, `list_chest`の全てで発生
- **原因**: チェストの近くにいても発生するため、`minecraft_move_to`の不具合でチェストから離れている可能性、またはチェスト操作自体のバグ
- **影響**: チームの共有チェストにアクセスできず、資源の預け入れ・取り出しができない
- **修正**: 未対応（要調査）
- **ファイル**: `src/tools/crafting.ts` または関連ファイル

### [2026-02-15] minecraft_use_item_on_block で水・溶岩バケツ取得失敗（✅解決）
- **症状**: `use_item_on_block(bucket, x, y, z)`で水源・溶岩源に対して使用しても、water_bucket/lava_bucketがインベントリに反映されない
- **試行**:
  - 水源(-84, 64, -42): ⚠️ water_bucket not found
  - 溶岩源(-91, 63, -32): ⚠️ lava_bucket not found
  - 溶岩源(-90, 63, -32): ⚠️ lava_bucket not found
  - 水源(-5, 38, 9): ⚠️ water_bucket not found (2回試行)
- **現在の実装**: `bot.activateBlock(block)`を使用、待機時間1000ms、インベントリ検証あり
- **影響**: 水バケツ・溶岩バケツが取得できず、黒曜石作成（水+溶岩）ができない
- **推定原因**:
  1. `activateBlock`が正しく動作していない
  2. 待機時間が不足（1000msでも足りない？）
  3. Mineflayerのバージョンや設定の問題
  4. ボットの位置が遠すぎる（3ブロック以内が必要？）
- **次のアクション**:
  1. ボットを水源/溶岩源の1ブロック隣に正確に移動
  2. `bot.equip(bucket)`で手に装備してから`activateBlock`
  3. イベントリスナー(`itemDrop`, `windowOpen`)で状態変化を監視
  4. 別のAPIメソッド（`bot.useOn`, `bot.activateItem`）を試す
- **ファイル**: `src/bot-manager/bot-blocks.ts`(Line 1215-1243)
- **✅ 修正完了 (2026-02-15)**:
  - gitマージコンフリクトマーカー(`<<<<<<< Updated upstream`等)が残っていたのが原因
  - マーカーを削除し、正しいコードに統合
  - `bot.activateItem()` + `bot.deactivateItem()` を使用（await不要）
  - ビルド成功、動作確認待ち

### [2026-02-16] minecraft_use_item_on_block で水バケツからの水配置が失敗 🚨未解決
- **症状**: `use_item_on_block(item_name="water_bucket", x, y, z)`を実行すると「Placed water at (x, y, z). Now holding water_bucket.」と表示されるが、実際には水が配置されず、water_bucketがインベントリに残る
- **試行**:
  - 修正1: activateItem() + deactivateItem() → 失敗
  - 修正2: placeBlock(referenceBlock, Vec3(0,1,0)) → 失敗
  - 修正3: activateItemで向いた方向に配置 → 失敗
  - 修正4: placeBlock(下のブロック, 上面) + fallback → 失敗
  - 全ての試行で`find_block("water", 5)`: No water found
- **影響**: 畑作りに必要な水源が作れない、無限水源が作れない、Phase 2食料確保が停滞
- **推定原因**:
  - Mineflayerのwater_bucket配置の正しいAPIが不明
  - equip/activateItem/placeBlockのいずれも機能していない
  - MCPサーバーとMineflayerボット間の通信に問題がある可能性
- **回避策**: 自然の水源を探して利用、またはClaude7が成功した方法を確認
- **次のアクション**: Claude7がどうやって水配置に成功したか調査・コード比較
- **ファイル**: `src/bot-manager/bot-blocks.ts:1230-1260`

