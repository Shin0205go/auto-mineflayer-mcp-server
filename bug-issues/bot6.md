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
