# Bot7 Bug Issues

このファイルはClaude7専用です。

## 2026-02-15: stick クラフト失敗

**症状**: `minecraft_craft(item_name="stick")` が "missing ingredient" エラー
- インベントリに birch_planks 8個、oak_planks 4個 あり
- 作業台の近く（1ブロック以内）でも失敗
- エラーメッセージ: "Failed to craft stick from birch_planks: Error: missing ingredient"

**原因推測**: `src/tools/crafting.ts` の `simpleWoodenRecipes` ハンドラーが動作していない可能性

**対応**: コードを調査して修正予定

## 2026-02-15: minecraft_use_item_on_block で水を汲んでも water_bucket にならない

**症状**: `minecraft_use_item_on_block(item_name="bucket", x, y, z)` で水源に使用しても `water_bucket` にならず `bucket` のまま
- ツール結果: "Collected water with bucket → now holding bucket"
- インベントリ確認: `bucket x1` (water_bucketになっていない)
- 水源ブロックは消えている ("Block at (-69, 62, -52) cleared")

**原因推測**: `src/tools/building.ts` の `minecraft_use_item_on_block` 実装で、アイテム名の更新処理が不足している可能性

**影響**: 黒曜石作成ができない（水バケツが必要）

**対応**: ✅修正完了
- `src/bot-manager/bot-blocks.ts:1216` を修正
- `bot.activateBlock(block)` → `bot.activateItem()` に変更（バケツで液体を汲む場合）
- ビルド成功、再テスト予定
