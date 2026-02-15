# Bot6 Bug Issues

このファイルはClaude6専用です。

## 2026-02-15: アイテム自動回収の問題

### 現象
- `minecraft_dig_block`で石炭鉱石を採掘後、「picked up 2 item(s)」と表示されるがインベントリに石炭が追加されない
- `minecraft_smelt`で木炭を製錬後、「charcoal may have dropped」と警告が出るがインベントリに追加されない
- `minecraft_collect_items`を実行しても「No items nearby」と表示される

### 再現手順
1. coal_oreを`minecraft_dig_block`で採掘
2. インベントリを確認 → 石炭なし
3. dark_oak_logを`minecraft_smelt`で製錬
4. インベントリを確認 → 木炭なし

### 影響
松明のクラフトに必要な石炭/木炭が入手できない

### 調査が必要なファイル
- `src/tools/building.ts` (dig_block)
- `src/tools/crafting.ts` (smelt)
- `src/bot-manager/index.ts` (アイテム収集ロジック)

## 2026-02-15: 水バケツバグ

### 現象
- `minecraft_use_item_on_block`でバケツを水源に使用
- 「Collected water with bucket → now holding bucket」と表示される
- しかしインベントリには`water_bucket`ではなく空の`bucket`のまま
- 複数のボット（Claude4, 5, 6, 7）が同じ問題を報告

### 再現手順
1. 空のバケツを所持
2. 水源ブロックに対して`minecraft_use_item_on_block(item_name="bucket", x, y, z)`を実行
3. 成功メッセージが出るがインベントリに`water_bucket`が追加されない

### 影響
黒曜石作成に必要な水バケツが作れない（Phase 5完了がブロックされる）

### 代替案
水源と溶岩源を直接隣接させて黒曜石を作る（Claude7提案）

### 調査が必要なファイル
- `src/tools/building.ts` (use_item_on_block)

### 追加調査 (2026-02-16)
- 同じバグが再発。バケツ装備後も水を汲めない
- エラーメッセージ: "⚠️ Used bucket on water but water_bucket not found in inventory. Holding: bucket"
- 位置: (-7, 38, 13) の水ブロック
- 複数回試行しても同じ結果

## 2026-02-16: 黒曜石→cobblestone化バグ

### 現象
- ダイヤピッケルで黒曜石を採掘すると cobblestone がドロップする
- 正しくは obsidian がドロップすべき
- 複数のボット（Claude6, Claude7）で同じ現象を確認

### 再現手順
1. diamond_pickaxe を装備
2. obsidian ブロックに対して `minecraft_dig_block(x, y, z, force=true)` を実行
3. "Dug obsidian with diamond_pickaxe. No items dropped" と表示される
4. インベントリを確認すると cobblestone が +2 追加されている
5. obsidian は追加されていない

### 証拠
- 採掘前: cobblestone なし
- 採掘後: cobblestone x2 追加
- 採掘メッセージ: "Dug obsidian with diamond_pickaxe. No items dropped (auto-collected or wrong tool)."

### 影響
- Phase 6 でネザーポータル作成に必要な黒曜石 10個が集められない
- ダイヤピッケルを持っているのに黒曜石が入手できない

### 調査が必要
- `src/bot-manager/bot-blocks.ts` の digBlock 関数
- Mineflayer の item drop イベント処理
- なぜ obsidian が cobblestone に変換されるのか

### 原因判明 (2026-02-16 by Claude1)
- バグではない！Minecraftの仕様
- flowing_lava（流れる溶岩）に水をかけると **cobblestone** になる
- lava（溶岩源ブロック）に水をかけると **obsidian** になる
- obsidian ブロックを採掘したつもりが、実際は flowing_lava が固まった cobblestone を採掘していた

### 解決策
- 溶岩「源」ブロックを見つけて水をかける
- または既に生成された obsidian ブロックを採掘する
- `minecraft_find_block("obsidian")` で既存の黒曜石を探す

## 2026-02-16: forceパラメータが機能しない

### 現象
- `minecraft_dig_block(force=true)`でも溶岩隣接ブロックが採掘できない
- 黒曜石採掘でPhase 5進行がブロックされる

### 原因
1. `src/tools/building.ts:205` - `args.force`を読み取らずに`digBlock()`を呼んでいる
2. `src/bot-manager/bot-blocks.ts:231` - `digBlock`関数が`force`パラメータを受け取っていない
3. `src/bot-manager/bot-blocks.ts:260-271` - 溶岩チェックが無条件で実行され、`force`フラグを無視

### 修正方針
1. `building.ts` - `args.force`を読み取り
2. `bot-manager/index.ts` - `digBlock`に`force`パラメータ追加
3. `bot-blocks.ts` - `digBlock`関数に`force: boolean = false`パラメータ追加、溶岩チェックを`if (!force)`で囲む

### 修正完了 (2026-02-16)
✅ `src/bot-manager/bot-blocks.ts:231` - `force: boolean = false`パラメータ追加
✅ `src/bot-manager/bot-blocks.ts:260` - 溶岩チェックを`if (!force)`で囲む
✅ `src/bot-manager/index.ts:234` - `digBlock`メソッドに`force`パラメータ追加
✅ `src/tools/building.ts:178` - `args.force`を読み取って`botManager.digBlock()`に渡す
✅ ビルド成功

**注意**: MCPサーバー再起動が必要（全ボット再接続）

### 実装確認 (2026-02-16)
❌ `git checkout HEAD --` で重複修正を元に戻したが、コミット46bf72c以前の状態に戻ってしまった
✅ `git checkout 46bf72c -- <files>` で正しい実装を復元
✅ `npm run build` で再ビルド成功
✅ MCPサーバー再起動（pkill + nohup node dist/mcp-ws-server.js）

**学習**: `git checkout HEAD --` は現在のHEADの状態に戻す。特定のコミットに戻すには `git checkout <commit> --` を使う

### 再修正 (2026-02-16)
❌ 前回の修正が不完全だった。`bot-blocks.ts:260-270`の溶岩チェックが`force`フラグを無視していた
✅ `if (!force)` で溶岩チェックを囲んで修正
✅ `npm run build` 成功
⏳ MCPサーバー再起動が必要

## 2026-02-16: アイテム自動拾得が完全に機能しない

### 現象
- ブロック採掘後、アイテムエンティティは生成されるが、プレイヤーが拾得できない
- `minecraft_dig_block(auto_collect=true)` でも拾得失敗
- `minecraft_collect_items()` を実行しても "No items collected" と表示
- アイテムに手動で近づいても（0.5ブロック以内）自動拾得されない
- 他のボット（Claude5）は正常に拾得できる報告あり → 個体差がある？

### 再現手順
1. diamond_pickaxe で obsidian を採掘 (`minecraft_dig_block(x=-8, y=37, z=8, force=true)`)
2. "No items dropped (auto-collected or wrong tool)" と表示
3. `minecraft_collect_items()` → "No items collected after 3 attempts"
4. `minecraft_get_nearby_entities(range=10)` → item エンティティ3個確認（距離0.5, 1.3, 6.7ブロック）
5. アイテムの位置に移動しても拾得されない

### 証拠
- エンティティリスト: `{"name":"item","type":"passive","distance":"0.5","position":{"x":"-2.1","y":"37.4","z":"12.9"}}`
- 採掘したブロック: obsidian (ダイヤピッケル使用)
- インベントリ: obsidian なし

### 影響
- Phase 6 のネザーゲート建設に必要な黒曜石10個が入手できない
- 全ての採掘・狩猟・農業で報酬が得られない

### 他ボットの状況
- Claude5: アイテム拾得成功（dirt x3 を auto_collect=true で拾得）
- Claude7: アイテム拾得失敗（Claude6 と同じ症状）
- Claude3, Claude2: 不明

### 調査が必要
- なぜ一部のボット（Claude5）は成功し、他のボット（Claude6, Claude7）は失敗するのか？
- サーバー設定の問題？ Mineflayer の問題？ MCP サーバーの問題？
- gamerule doTileDrops/doMobLoot/doEntityDrops は全て true に設定済み

## 2026-02-16: クラフトシステム全体が機能しない

### 現象
- 全ての高度なクラフトレシピ（作業台必要）が "missing ingredient" エラーで失敗
- 簡易レシピ（2x2）も失敗する（crafting_table, wooden_hoe等）
- 必要な素材を十分に持っているのにクラフトできない
- 複数のボット（Claude4, Claude6）で同じ問題を確認

### 再現手順
1. oak_planks x4 を所持
2. `minecraft_craft("crafting_table")` を実行
3. "Failed to craft crafting_table from oak_planks: Error: missing ingredient" と表示
4. インベントリには oak_planks x4 があるのに失敗

### 具体例
#### crafting_table
- 所持: oak_planks x4
- レシピ: oak_planks x4 (2x2)
- 結果: "missing ingredient"

#### stone_hoe
- 所持: cobblestone x62+, stick x4
- レシピ: cobblestone x2 + stick x2 (作業台必要)
- 結果: "Failed to craft stone_hoe: Error: missing ingredient. Recipe needs: cobblestone(need 2), stick(need 2)"
- 作業台: (-8, 93, 20) で実行

#### wooden_hoe
- 所持: oak_planks x4, stick x6
- レシピ: oak_planks x2 + stick x2 (2x2)
- 結果: "No recipe found for wooden_hoe"

### 影響
- Phase 2 の農場建設が完全にブロックされる
- クワがないと farmland を作れず、種を植えられない
- 食料生産ができず、全員が飢餓状態に陥る

### リーダーの指示
- 「素手で耕せ」と指示されたが、Minecraft仕様上クワは必須
- 代替案: 次セッションでツール追加（MCP側の実装）

### 調査が必要なファイル
- `src/tools/crafting.ts` (craft関数)
- `src/bot-manager/bot-crafting.ts` (クラフト実装)
- Mineflayer の crafting API
- レシピデータの読み込みロジック

## 2026-02-16: アイテムドロップ/ピックアップの問題

### 現象
- プレイヤー間でアイテムをドロップしても、他のプレイヤーが拾えない
- Claude1が「rotten_flesh x1をドロップした」と報告
- Claude6が`minecraft_collect_items()`を実行しても "No items collected"
- 代わりに無関係なアイテム（andesite x1）を拾ってしまう
- `doEntityDrops`は`true`に設定済み

### 再現手順
1. Claude1がrotten_fleshをドロップ
2. Claude6が同じ位置(-4, 96, 0)付近にいる
3. `minecraft_collect_items()`を実行
4. rotten_fleshは拾えず、andesite x1を拾う
5. 再度`minecraft_collect_items()`→ "No items nearby"

### 影響
- プレイヤー間のアイテム受け渡しができない
- チーム協力でのリソース共有が不可能
- 空腹0/20のメンバーが食料を受け取れず餓死の危険

### 同時発生した問題
- wheatを直接食べようとすると空腹が0/20になる（wheatは食べられない仕様？）
- チェストへのアイテム格納/取り出しは正常に動作

### 調査が必要
- `minecraft_collect_items()`のアイテム検出ロジック
- アイテムエンティティのフィルタリング
- なぜ意図しないアイテムを拾うのか

## 2026-02-16: Mobドロップが機能しない

### 現象
- `minecraft_attack()`でspiderを討伐しても何もドロップしない
- `doMobLoot=true`に設定済みでも効果なし
- アイテムエンティティが生成されていない（`minecraft_collect_items()` → "No items nearby"）
- 複数のボット（Claude1, Claude2, Claude3, Claude4）が`doMobLoot=true`を設定したが効果なし

### 再現手順
1. spider を発見（(-21.3, 97.1, -20.9)）
2. `minecraft_attack(entity_name="spider")` を実行
3. "Killed spider after 16 attacks" と表示
4. `minecraft_collect_items()` を実行 → "No items nearby"
5. インベントリ確認 → string なし

### 影響
- **致命的**: fishing_rod の作成に必要な string x2 が入手できない
- fishing_rod なしでは釣りができず、食料危機が解決できない
- Phase 2（食料安定化）が完全にブロックされる
- 弓の作成にも string が必要（Phase 6以降）

### 代替案
- 村を探索してfishing_rodを入手
- 廃坑(mineshaft)を探索してstringを入手
- サーバー設定の問題か確認（`/gamerule doMobLoot` コマンド）

### 調査が必要なファイル
- `src/tools/combat.ts` (attack関数)
- `src/bot-manager/bot-combat.ts` (戦闘処理)
- Mineflayerのmob death/loot イベント処理
- Minecraftサーバー設定（gamerule）

## 2026-02-16: サーバー設定によるアイテムピックアップ完全無効化（致命的）

### 現象
- クラフト実行時に「Server has item pickup disabled. Crafted item dropped on ground but cannot be collected」エラー
- クラフトした アイテムが地面にドロップするが拾得できない
- 材料（dark_oak_log x1）が消失し、完成品も入手不可
- **ゲーム進行が完全に不可能**

### 再現手順
1. `minecraft_craft("dark_oak_planks", count=2)` を実行
2. "Server has item pickup disabled" エラー
3. dark_oak_log x1 消失、dark_oak_planks x0（拾得不可）

### 影響
- **致命的**: 全てのクラフトが不可能
- 道具作成、食料生産、建築、全フェーズが完全にブロック
- プレイ継続不可能

### 原因
- Minecraftサーバー設定で item pickup が無効化されている
- Mineflayer の crafting API はアイテムが地面にドロップする前提
- 拾得できないため、クラフト結果が永久に失われる

### 解決策
- サーバー管理者に連絡してitem pickupを有効化
- または、アイテムを直接インベントリに追加する別の方法を実装
- または、ゲームモードをクリエイティブに変更

### 関連バグ
- Mobドロップ無効（同じitem pickup設定の影響）
- ブロック採掘後のドロップ拾得失敗（同根）
- プレイヤー間アイテム受け渡し失敗（同根）
