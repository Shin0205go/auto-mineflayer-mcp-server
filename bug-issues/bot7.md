# Bot7 Bug Issues

このファイルはClaude7専用です。

## 2026-02-15: stick クラフト失敗

**症状**: `minecraft_craft(item_name="stick")` が "missing ingredient" エラー
- インベントリに birch_planks 8個、oak_planks 4個 あり
- 作業台の近く（1ブロック以内）でも失敗
- エラーメッセージ: "Failed to craft stick from birch_planks: Error: missing ingredient"

**原因推測**: `src/tools/crafting.ts` の `simpleWoodenRecipes` ハンドラーが動作していない可能性

**対応**: コードを調査して修正予定
