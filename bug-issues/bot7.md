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

**原因**: `bot.activateItem()`は同期的に実行されるが、Mineflayerのインベントリ API（`bot.heldItem`）はサーバーからのパケット受信後に更新される。固定の待機時間（500ms、1500ms）では不十分。

**対応**: ✅修正完了 (bot7による追加修正)
- `src/bot-manager/bot-blocks.ts:1220` でインベントリポーリングを実装
- 100ms間隔で`bot.heldItem`をチェック、`water_bucket`または`lava_bucket`に変わるまで待機（最大3秒）
- `activateBlock` → `activateItem` への変更も含む
- **重要な追加修正**: `bot.activateItem()` の直後に `bot.deactivateItem()` を呼ぶ必要があった（Claude1の報告通り）
- ビルド成功、テスト待ち

**重要**: MCPサーバー（Claude Code CLI経由）を再起動しないと新しいビルドが反映されません。

## 2026-02-15: 水バケツで溶岩に使うと溶岩を汲んでしまう

**症状**: 水バケツを持った状態で `minecraft_use_item_on_block` を溶岩源に使うと、水を設置せず溶岩を汲んでしまう
- 期待: 水バケツ → 溶岩源 → 黒曜石生成
- 実際: 水バケツ → 溶岩源 → 溶岩バケツ（溶岩を汲む）

**原因**: `minecraft_use_item_on_block` は常に `bot.activateItem()` を呼ぶため、液体ブロックに対しては「汲む」動作になる

**根本原因**: `bot.activateItem()`は非同期ではないが、`await bot.activateItem()`としている。また、バケツで液体を汲んだ後、実際にはゲーム内でwater_bucketになっているが、インベントリAPIが即座に更新されないため、`bucket`のまま表示される

**解決策**:
- 水バケツを持っている場合は、溶岩源の**隣のブロック**に水を設置する
- または `place_block` 的な動作で水を設置する必要がある
- より長い待機時間（1秒以上）を設けてインベントリ更新を待つ

**回避策**: 溶岩源の上や隣の空気ブロックに対して水バケツを使う（設置する）

**対応**: Claude1が調査中

## 2026-02-16: 溶岩隣接ブロックが採掘できない（force flag未実装）

**症状**: 黒曜石の下に溶岩がある場合、`force=true`を指定しても採掘エラー
- エラー: "🚨 警告: このブロックの隣に溶岩があります！"
- `minecraft_dig_block(x, y, z, force=true)` でも同じエラー

**原因**: `digBlock`関数がforceパラメータを受け取っていたが実際には使用していなかった
- `src/bot-manager/bot-blocks.ts:231` - forceパラメータを追加
- `src/bot-manager/index.ts:234` - forceパラメータを追加
- `src/tools/building.ts:178` - forceパラメータを渡すように修正

**修正**: ✅完了 (bot7)
- `digBlock`関数の溶岩チェックを`if (!force)`で囲む
- forceフラグが有効な場合は溶岩警告をスキップして採掘を続行
- MCPツール定義には既にforceパラメータがあったが、実装が欠けていた

**ビルド**: ✅成功

## 2026-02-16: 黒曜石採掘で間違ったアイテムがドロップ

**症状**: `minecraft_dig_block`で黒曜石を採掘すると、cobblestoneがドロップされる
- ツール結果: "Dug obsidian with diamond_pickaxe and picked up 2 item(s)!"
- 期待: obsidian x2がインベントリに追加
- 実際: cobblestone x2がインベントリに追加（45→47に増加）
- 座標: (-6, 37, 10)

**原因推測**:
- gamerule doTileDropsの問題ではない（他のプレイヤーは正常に採掘できている）
- アイテム収集ロジックのバグ？（最も近いアイテムを拾うが、別のアイテムを拾っている）
- または黒曜石が実際にはcobblestoneに変わっている？

**再現手順**:
1. `minecraft_dig_block(x=-6, y=37, z=10, force=true)`
2. "picked up 2 item(s)!" と表示
3. インベントリ確認 → obsidianなし、cobblestone +2

**対応**: 調査予定
