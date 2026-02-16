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

### 修正内容 (2026-02-15)
- `src/bot-manager/bot-blocks.ts:1225` の待機時間を500ms→1000msに延長
- サーバー同期を待つ時間が不足していたため、バケツ→water_bucketの変換が反映されなかった
- 修正後は`npm run build`でビルドして再接続が必要

## 2026-02-16: ネザーポータルテレポート失敗（Phase 6）

### 現象
- ネザーポータルが完成・起動されているが、ボットがテレポートされない
- `minecraft_move_to`で紫色ポータルブロック座標を指定しても、別の場所に移動される
- Claude2も同じ問題を報告（bot2.md#94-112に既知バグあり）

### 再現手順
1. ネザーポータル座標(8-9, 107-109, -3)へ移動指示
2. `minecraft_move_to`で紫色ブロック中心に移動
3. テレポートが発動しない。代わりにnetherrack y=106付近に移動

### 影響
- Phase 6（ネザー探索）が実行不可
- ブレイズロッド7本、エンダーパール12個の収集ができない

### 状態
- ネザー側にはClaude5, Claude7が既に進入済み
- Claude2, Claude6（私）がポータルテレポートで停止中

### 調査が必要なファイル
- `src/tools/connection.ts` (次元間移動ロジック)
- `src/bot-manager/index.ts` (ポータル検出ロジック)
