# Bot2 - Bug & Issue Report

このファイルはBot2専用です。発見したバグやイシューをここに記録してください。

## 報告形式

### [日付] バグタイトル
- **症状**: 何が起きたか
- **原因**: 推定される原因
- **修正**: どう修正したか（または修正予定）
- **ファイル**: 関連するファイルパス

---

### [2026-02-15] minecraft_move_to が目標座標に到達しない
- **症状**: `minecraft_move_to(x, y, z)`を呼んでも、実際の位置が変わらない、または目標と異なる座標に移動する
- **例**: `move_to(-71, 89, -49)` → 実際はY=90に移動。`move_to(-69, 62, -52)` → 実際はY=63に移動し、その後同じコマンドで位置が変わらない
- **原因**: `src/tools/movement.ts`の`minecraft_move_to`実装に問題がある可能性
- **影響**: 正確な位置への移動が必要な作業（チェスト操作、ブロック設置等）で支障
- **修正**: 未対応（要調査）
- **ファイル**: `src/tools/movement.ts`

### [2026-02-15] minecraft_open_chest / store_in_chest / list_chest がタイムアウト
- **症状**: チェスト操作系のツールが全て「Event windowOpen did not fire within timeout of 20000ms」でエラー
- **試行**: `open_chest`, `store_in_chest`, `list_chest`の全てで発生
- **原因**: チェストの近くにいても発生するため、`minecraft_move_to`の不具合でチェストから離れている可能性、またはチェスト操作自体のバグ
- **影響**: チームの共有チェストにアクセスできず、資源の預け入れ・取り出しができない
- **修正**: 未対応（要調査）
- **ファイル**: `src/tools/crafting.ts` または関連ファイル

### [2026-02-15] minecraft_use_item_on_block で水バケツ取得失敗 ✅ 修正済み
- **症状**: `use_item_on_block(bucket, x, y, z)`で水源に対して使用。出力では「Collected water with bucket」と成功表示されるが、インベントリには反映されず空のバケツのまま
- **試行**: 水源(-69, 62, -52)に対してバケツ使用。複数回試行してもwater_bucketにならない
- **原因**: `src/bot-manager/bot-blocks.ts`の`useItemOnBlock`関数で`bot.activateItem()`を使用していたが、水源ブロックに対しては`bot.activateBlock(block)`を使う必要があった
- **影響**: 水バケツが取得できず、黒曜石作成（水+溶岩）ができない
- **修正**:
  1. `bot.activateItem()`→`bot.activateBlock(block)`に変更
  2. 待機時間を300ms→500msに延長
  3. `bot.inventory.items()`で実際にwater_bucket/lava_bucketがインベントリにあるか検証
  4. 成功時は✅、失敗時は⚠️で明示的にフィードバック
- **ファイル**: `src/bot-manager/bot-blocks.ts`(Line 1210-1235)

