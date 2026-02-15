# Bot7 Bug Issues

このファイルはClaude7専用です。

## 2026-02-15: stick クラフト失敗

**症状**: `minecraft_craft(item_name="stick")` が "missing ingredient" エラー
- インベントリに birch_planks 12個、dark_oak_planks 4個 あり
- エラーメッセージ: "Failed to craft stick from dark_oak_planks: Error: missing ingredient"

**原因**: `src/bot-manager/bot-crafting.ts:405-429`
- `bot.recipesAll(item.id, null, null)` が0レシピを返す（Minecraftバージョンの問題）
- fallbackとして `bot.recipesFor(item.id, null, 1, null)` を試すが、これも0レシピを返す
- パラメータが不適切で必要な材料（planks）を指定していない

**修正**: ✅完了 (bot7)
- `src/bot-manager/bot-crafting.ts:409-460` で手動レシピ実装
- stick: 2 planks → 4 sticks (vertical pattern in 2x2 grid)
- crafting_table: 4 planks → 1 crafting_table (2x2 grid)
- `recipesAll/recipesFor` が0を返す場合、手動でレシピオブジェクトを作成
- delta配列を追加して材料消費を明示
- ビルド成功

**注意**: MCPサーバー再起動が必要（reconnectでは反映されない）

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

**修正**: ✅コード修正完了 (bot7)
- `digBlock`関数の溶岩チェックを`if (!force)`で囲む (bot-blocks.ts:260-273)
- forceフラグが有効な場合は溶岩警告をスキップして採掘を続行
- MCPツール定義には既にforceパラメータがあったが、実装が欠けていた

**ビルド**: ✅成功

**注意**: MCPサーバー再起動が必要
- reconnectだけでは新ビルドは反映されない
- Claude Code CLIまたはMCPサーバー自体を再起動する必要がある
- 現状: コード修正済み・ビルド成功だが、サーバー再起動待ち

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

## 2026-02-16: crafting_table クラフトが "missing ingredient" エラー

**症状**: `minecraft_craft(item_name="crafting_table")` が失敗
- インベントリに birch_planks 9個、oak_planks 1個 あり（合計10個）
- 作業台クラフトには4個のplanksが必要（十分な材料あり）
- エラーメッセージ: "Failed to craft crafting_table from birch_planks: Error: missing ingredient"

**再現手順**:
1. birch_log 2個からbirch_planks 8個をクラフト（成功）
2. 既存のoak_planks 1個、birch_planks 1個と合わせて合計10個
3. `minecraft_craft(item_name="crafting_table", count=1)` → エラー

**原因推測**:
- simpleWoodenRecipes ハンドラーの問題？
- 異なる種類のplanks（birch + oak）を混ぜているため？
- Minecraftバージョンの互換性問題？

**対応**: 調査予定

## 2026-02-16: インベントリフルエラー - アイテムを捨てても空きスロットが増えない

**症状**: `minecraft_take_from_chest` が "Bot inventory is full" エラーを繰り返す
- `minecraft_drop_item` で複数アイテム（cobblestone x640, dirt x55, gravel x6等）を捨てても、インベントリ出力が変化しない
- 捨てたアイテムがまだインベントリに表示される
- チェストに食料があるのに取り出せず、HP 5.6/20, 空腹 2/20で危機的状況

**再現手順**:
1. インベントリがフル（36スロット使用中）
2. `minecraft_drop_item(item_name="cobblestone", count=64)` → "Dropped 64x cobblestone"
3. `minecraft_get_inventory()` → 同じcobblestone x64がまだ表示される
4. `minecraft_take_from_chest(item_name="cooked_porkchop")` → "Bot inventory is full"

**原因推測**:
- `bot.inventory.items()` または `bot.inventory.slots` のキャッシュ問題？
- ドロップ後のインベントリ更新待機が不足？
- 非同期処理の同期問題？

**対応**: ✅解決済み

**解決方法**: `minecraft_disconnect()` → `minecraft_connect()` でreconnect
- reconnect後、インベントリが正しく同期される
- `bot.inventory.items()` がサーバーと同期されていない状態が原因
- dropやtakeの操作後、クライアント側のキャッシュが更新されない場合がある
- reconnectすることでインベントリ状態がサーバーから再取得される

**教訓**: インベントリ操作で異常を感じたら、すぐにreconnectを試す

## 2026-02-16: minecraft_collect_items が連続失敗 - アイテムが拾えない

**症状**: `minecraft_collect_items()` が "No items collected after 2 attempts" を繰り返す
- Claude5が種x3をドロップしたが回収できない
- 距離1.1mの至近距離でプレイヤー確認済み
- 複数回試行しても同じ結果

**再現手順**:
1. Claude5が座標(-0.8, 95, 2.3)に種をドロップ
2. `minecraft_collect_items()` → "No items collected after 2 attempts"
3. 複数回試行しても同じ

**原因推測**:
- アイテムがすぐにdespawnしている？（gameruleの問題？）
- `minecraft_collect_items` の実装問題（近くのアイテムを検出できない）
- サーバーとクライアントの同期問題
- インベントリフル問題の別バリエーション？

**対応**: 調査予定、必要ならreconnectを試す

## 2026-02-16: egg (投擲アイテム) を投げるツールがない

**症状**: eggを投げて鶏を孵化させる機能がない
- `minecraft_use_item_on_block` はブロックに対してアイテムを使用する
- eggは空中に向かって投げる必要がある（projectile）
- 現在のツールセットには投擲（throw/shoot）用のツールがない

**必要な機能**:
- `bot.activateItem()` を空中に向かって使用
- または `bot.toss()` / `bot.activateItem()` for throwing projectiles
- snowball, ender_pearl なども同様に投げられない

**対応**: ✅実装完了 (bot7)
- `src/tools/building.ts` に `minecraft_throw_item` ツール追加
- `src/bot-manager/bot-blocks.ts` に `throwItem` 関数追加
- `src/bot-manager/index.ts` に `throwItem` メソッド追加
- ビルド成功
- **注意**: MCPサーバー再起動が必要（reconnectでは反映されない）


## 2026-02-16 セッション: Claude7の成果

### 主要成果
1. **leather x7発見**: チェスト(-37,97,7)でleather x7を発見・回収。Phase 5エンチャント台用の本作成に必須
2. **stickクラフトバグ修正実装**: 手動レシピ実装済み、ビルド成功。サーバー再起動で反映予定
3. **探索実施**: 半径100m+でサトウキビ・動物・水源を探索（未発見）
4. **mobドロップテスト**: skeleton_horse討伐でドロップ0個確認

### 課題
- stickクラフトバグが未解決（サーバー未再起動）のため鉄ピッケル作成不可
- サトウキビ・羊が見つからず（Phase 5の本作成に紙が必要）
- 動物がほとんど存在しない環境（skeleton_horse・batのみ）

### 次セッション優先事項
- サーバー再起動でstickクラフト修正を検証
- サトウキビ探索継続（本作成に必須）
- 羊毛3個収集（ベッド作成用）

## 2026-02-16 セッション2: stickクラフトバグ再発

**症状**: `minecraft_craft(item_name="stick")` が再度失敗
- インベントリに birch_planks x4, dark_oak_planks x4 あり
- エラー: "Failed to craft stick from birch_planks: Error: missing ingredient"
- 前回修正（手動レシピ実装）が反映されていない

**原因**: MCPサーバーが再起動されていない
- 前回のビルドは成功したがサーバーが古いバージョンを実行中
- reconnectだけでは新コードは反映されない

**対応**: サーバー再起動待ち、代わりにClaude4からiron_pickaxe配布を依頼

**更新**: Claude4が追加修正実施（inventoryItems.find→sort使用で最多の板材選択）
- MCP再起動で適用予定

## 2026-02-16 セッション3: 重要アイテム発見

**成果**: チェスト(-6,101,-14)で以下を発見・回収
- **book x2**: Phase 5エンチャント台作成に必須！サトウキビ探索が不要に
- **white_wool x3**: ベッド作成に使用可能
- book x1を拠点(-3,96,0)にドロップ済（Claude1がエンチャント台作成予定）

**minecraft_store_in_chest バグ**: "No chest within 4 blocks" エラー
- チェストは存在し、minecraft_open_chestで開ける（座標-3,96,0）
- しかしminecraft_store_in_chestは「No chest within 4 blocks」と返す
- 回避策: minecraft_drop_itemを使用してチェスト付近にアイテムをドロップ
- **更新**: 2回目の試行で成功。チェストに非常に近い位置（1ブロック以内）から実行する必要がある可能性

**Phase 4達成**: Claude2からstick x2受取→iron_pickaxe作成成功
- iron_pickaxe + iron_sword 所持完了
- Phase 4完全達成！

## 2026-02-16 セッション7: チーム畑作成と終了準備

**状況**:
- 接続時: HP 10/20, 空腹 0/20（危機的）
- 位置: (-32,65,-93) → 拠点(0,95,0)付近へ移動
- 所持品: water_bucket, iron_hoe, wheat_seeds, iron_sword, iron_pickaxe, iron_leggings/boots, 鉄インゴットx6, 丸石大量

**対応**:
- リーダー（Claude1）から「HP10維持なら餓死しない」「畑作成中(0,111,8)」との指示
- 拠点チェスト(2,106,-1)で鉄インゴットx6を格納
- Claude3が畑の水源を完成 (-2,108,11)

**次セッション優先事項**:
- Phase 5継続: エンチャント台作成（素材揃い済み: ダイヤ8+黒曜石4+本2）
- 高レベル畑作成ツール実装
- 食料安定化
