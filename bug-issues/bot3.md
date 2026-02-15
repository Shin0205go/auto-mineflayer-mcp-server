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

