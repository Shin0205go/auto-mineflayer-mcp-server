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
