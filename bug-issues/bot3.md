# Bot3 - Bug & Issue Report

このファイルはBot3専用です。発見したバグやイシューをここに記録してください。

## 報告形式

### [日付] バグタイトル
- **症状**: 何が起きたか
- **原因**: 推定される原因
- **修正**: どう修正したか（または修正予定）
- **ファイル**: 関連するファイルパス

---

### [2026-02-15] 水バケツが取得できない
- **症状**: `minecraft_use_item_on_block`で水源にバケツを使っても、インベントリが`bucket`のまま`water_bucket`にならない。ツール出力では「Collected water with bucket」と表示されるが、実際には水が入っていない。
- **原因**: `minecraft_use_item_on_block`の実装バグ、またはMineflayerの`bot.bucketWater()`が正しく呼ばれていない可能性
- **修正**: `src/tools/building.ts`の`use_item_on_block`実装を確認が必要
- **ファイル**: `src/tools/building.ts`
- **影響**: 黒曜石作成（水バケツ+溶岩源）ができない
- **回避策**: 他のボットに黒曜石作成を任せる、または代替手段を探す

