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

**修正済み (2026-02-22, autofix-2)**:
1. `dig_block`: `nearestEntity` 検出ロジックを拡張。`entity.name === 'item'` のみから `displayName === 'Item'`、`displayName === 'Dropped Item'`、`type === 'object'` を含む包括的な検出に変更。ファイル: `src/bot-manager/bot-blocks.ts`
2. `smelt`: アイテムが転送されなかった場合に `collectNearbyItems()` を自動呼び出し。回収後に再チェックして成功/失敗を報告。ファイル: `src/bot-manager/bot-crafting.ts`

**修正済み**

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

### 部分修正 (autofix-11, 2026-02-23)
- `src/bot-manager/bot-movement.ts` の `enterPortal()` 関数で、5回のウォーク試行後に `bot.clearControlStates()` と `bot.pathfinder.setGoal(null)` を追加。ボットが動き続けてポータルブロックから出てしまう問題を軽減。ポータル内で静止することでテレポートが発動しやすくなる。
- サーバー側でネザーが無効化（`allow-nether=false`）されている場合は引き続きタイムアウトする。

**修正済み**

## 2026-03-28: HP枯渇による死亡 (Session 150)

### 現象
- セッション開始時にHP=3.3、Hunger=0の極度に危険な状態
- 食料がインベントリに全くない状態
- 周辺に多数の敵（zombie x2, skeleton x4, witch x1, creeper x5）
- flee/pillarUpを試みたがHPが1.3まで低下し死亡

### 座標
- 死亡時: x=-2, y=87, z=1 付近
- リスポーン: x=-2, y=87, z=1 (keepInventory=true)

### 直前の行動
1. 接続直後にHP=3.3, Hunger=0を検出
2. bot.flee()で逃走試み
3. bot.pillarUp()で安全確保試み
4. moveTo(x, 70, z)で降りようとした
5. HP=1.3に低下し死亡と思われる

### エラーメッセージ
- 明示的なエラーなし - HP枯渇によるサバイバル死亡

### 根本原因（推測）
- hunger=0の状態では自然HP回復なし
- bot.eat()を呼んでも食料アイテムがインベントリにない場合は機能しない
- combat()で食料確保しようとしたが実行前に死亡

### 対策提案
- bot.status()でhunger=0かつfood=[]の場合、combatで動物を狩る前にflee/shelter優先
- 飢餓状態で敵が多い場合の安全確保フローの改善が必要

### Status: Reported

## 2026-03-28: デーモン停止 + サーバー満員 (Session 150)

### 現象
- mc-execute.cjs実行中にデーモンが予告なく停止（Exit code 1: Daemon not running）
- 再起動後、`bot.status is not a function` / `bot.log is not a function` エラー
- mc-connect.cjs が `multiplayer.disconnect.server_full` でキック

### 状況
- セッション中のgather()実行後にデーモンが落ちた
- npm run daemonでバックグラウンド再起動後もbot.*APIが初期化されない
- 他の複数ボットがすでに接続しているためMax Player数に達している

### Status: Reported

## 2026-03-28: 繰り返し死亡 - 地形スタック + 食料なし (Session 150 続き)

### 現象
- 同一セッション内で4回以上死亡
- pillarUp()中にダメージを受けて死亡
- bot.flee()を呼んでも同じ場所に留まる（地形スタック）
- 昼間（phase=day）でもundead mob（skeleton, zombie）が焼けない
- bot.farm()後に小麦が増えない（wheat x2 → x1 に減少）
- combat(animal)でドロップアイテムがインベントリに入らない

### 座標（主な死亡地点）
- x=-2, y=94, z=-6 付近（繰り返し）
- x=2, y=85, z=48 付近

### 直前の行動パターン（各死亡）
1. 接続時 HP=3.3 → flee/pillarUp試み → HP=1.3 で死亡
2. Y=50付近移動中 → HP=10 → pillarUp呼び出し → 即死 (HP=20にリスポーン)
3. シェルター建築中 → HP=12 → さらに下降 → pillarUp → 死亡
4. 農場作業(bot.farm()) → 夜になりHP=2.5 → pillarUp → 死亡

### 問題のパターン
- bot.flee()が動かない（逃走後も同じ座標）
- pillarUp()中に攻撃される
- 昼間でもundead mobが存在する（日光が届かない高所か？）
- combat()でドロップ回収できない（既知バグ）
- 食料確保ができないため回復手段なし

### 関連バグ
- bot.flee()が正常に機能しない
- bot.combat()のドロップ回収バグ（他のbotでも報告済み）
- pillarUp()での安全確保が機能しない

### Status: Reported
