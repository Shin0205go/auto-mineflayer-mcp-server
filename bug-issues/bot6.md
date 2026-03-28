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

## 2026-03-28: サーバー満員で接続不可 (Session 151)


### 現象
- `node scripts/mc-connect.cjs localhost 25565 Claude6` 実行時に `Kicked: multiplayer.disconnect.server_full`
- Claude5, Claude7 など複数のボット名を試みても全て同様のエラー
- デーモン (port 3099) は起動していると思われるが、Minecraftサーバーの接続スロットが全て使用中

### 試みたユーザー名
- Claude6 → server_full
- Claude7 → server_full
- Claude5 → server_full

### 影響
- ゲームプレイ一切不可。フェーズ目標の進行が停止

### 対策提案
- サーバー側の最大プレイヤー数設定確認（server.properties: max-players）
- 既存ボット接続を切断してスロットを空ける

### Status: Reported

## 2026-03-28: デーモンが接続リクエストでクラッシュ (Session 152 - CRITICAL)

### 現象
- `npm run daemon` でデーモン起動成功（PID表示される）
- 直後に `mc-connect.cjs localhost 25565 Claude6` を実行
- デーモンが "socket hang up" で落ちる（ログに接続処理が出ない）
- 繰り返し再起動しても同じパターン
- 他ボット名（Claude3など）はデーモン起動直後から既存接続として認識されているが、Claude6は新規接続リクエスト時にデーモンをクラッシュさせる

### 再現手順
1. npm run daemon → 起動成功
2. mc-connect.cjs localhost 25565 Claude6 → "socket hang up" / Exit code 1
3. デーモンログ確認 → Claude6接続処理ログなし
4. デーモンが応答しなくなる

### エラーメッセージ
- `Daemon not running. Start with: npm run daemon`
- `socket hang up`

### 影響
- Claude6が一切ゲームプレイ不可

### 調査が必要なファイル
- `src/daemon.ts` — /api/connect エンドポイント処理
- `src/viewer-server.ts` — HTTP サーバー処理

### Status: Reported

## 2026-03-28: インベントリが別botと混在 (Session 153)

### 現象
- mc_execute実行ごとにインベントリ内容が全く異なるbotのものに変わる
- セッション開始時: wheat_seeds 99個, stone_pickaxe 4本, iron_sword 1本
- 後続: netherrack 15個, diamond_sword 1本, iron_sword 3本, cobblestone 202個
- さらに後続: wheat_seeds 99個に戻る
- 一貫性がなく「自分のインベントリ」が不明瞭

### 影響
- どのアイテムが利用可能か判断できない
- クラフト計画が立てられない

### 調査が必要なファイル
- `src/tools/mc-execute.ts` — botインスタンス解決ロジック（接続のたびに別botを参照している？）
- `src/daemon.ts` — 複数bot接続管理

### Status: Reported

## 2026-03-28: デーモン頻繁クラッシュ + pathfinder外部割り込み (Session 153 - CRITICAL)

### 現象
- mc-execute.cjsを数回実行するだけでデーモンがクラッシュ (Exit code 1: Daemon not running)
- 同一セッション内で4回以上クラッシュ、毎回npm run daemon + mc-connect.cjsで再接続が必要
- pathfinder.isMoving()が true のまま止まらない（stop()/setGoal(null)しても）
- bot.pathfinder.goto() が全て "The goal was changed before it could be completed!" で失敗
- background commandが残留してpathfinderのgoalを外部から変更している可能性

### 再現手順
1. mc-connect.cjs で接続
2. pathfinder.goto() を実行
3. "The goal was changed" エラーで失敗
4. 数回繰り返すとデーモンがクラッシュ (Exit code 1)
5. isMoving: true が stop() 後も解除されない

### 座標
x=14, y=78, z=2 付近で繰り返し発生

### 影響
- 移動が全くできない (pathfinderが外部から制御される)
- デーモンが頻繁にクラッシュして作業継続不可

### 調査が必要なファイル
- `src/daemon.ts` — クラッシュの原因
- `src/tools/mc-execute.ts` — pathfinder ゴール管理、background実行の残留

### Status: Reported

## 2026-03-28: goals未注入 + bot.* 高レベルAPI全てundefined (Session 153 - CRITICAL)

### 現象
- mc_execute内で `goals` オブジェクトが `undefined` → `new goals.GoalNear(...)` でエラー
- SKILL.mdには `goals` はスコープに注入済みと記載されているが実際はundefined
- `bot.moveTo`, `bot.navigate`, `bot.flee`, `bot.pillarUp`, `bot.gather`, `bot.smelt`, `bot.eat`, `bot.combat`, `bot.equipArmor`, `bot.place`, `bot.build`, `bot.farm`, `bot.store`, `bot.drop`, `bot.status` が全てundefined
- `bot.craft` と `bot.inventory` のみ動作

### 確認コード
```js
log('goals type: ' + typeof goals);  // → "undefined"
log('moveTo: ' + typeof bot.moveTo); // → "undefined"
log('craft: ' + typeof bot.craft);   // → "function" (これだけ動く)
```

### 座標
x=5, y=77, z=8 付近

### 直前の行動
1. 接続 (Claude6) → 成功
2. bot.health / bot.food / bot.inventory.items() → 正常動作
3. goals.GoalNear → TypeError: Cannot read properties of undefined
4. bot.moveTo → TypeError: bot.moveTo is not a function
5. 全高レベルAPI確認 → bot.craft以外全てundefined

### 影響
- 移動・採掘・食事・戦闘・農場作業が全て不可
- ゲームプレイが極めて制限される

### 調査が必要なファイル
- `src/tools/mc-execute.ts` — bot API オブジェクト構築、goals/Movements注入ロジック

### Status: Reported

## 2026-03-28: bot.log / bot.status is not a function (Session 152)

### 現象
- mc-connect.cjs が "Connected to localhost:25565 as Claude6" と成功を報告
- しかしmc-execute.cjs で `bot.log('test')` → `TypeError: bot.log is not a function`
- `bot.status()` も同様に `TypeError: bot.status is not a function`
- デーモンログにClaude6接続のエントリが一切出ない（Claude3の接続は見える）
- デーモンを複数回再起動しても同じ現象が続く

### 座標
- 不明（bot.status()が使えないため確認不可）

### 直前の行動
1. npm run daemon でデーモン起動（PID 89734）
2. mc-connect.cjs localhost 25565 Claude6 → "Connected" と表示
3. mc-execute.cjs "bot.log('test')" → TypeError: bot.log is not a function
4. デーモンログを確認 → Claude6接続ログなし（Claude3のみ）

### エラーメッセージ
- `TypeError: bot.log is not a function`
- `TypeError: bot.status is not a function`

### 根本原因（推測）
- mc-connect.cjs がHTTPリクエストを送るが、デーモン側でClaude6のbotインスタンスが作られていない
- または接続に成功したように見えるが、bot APIオブジェクトが正しく初期化されていない
- mc-execute.cjsがどのbotインスタンスを参照するかの解決ロジックに問題がある可能性

### 調査が必要なファイル
- `src/daemon.ts` — 接続処理とbotインスタンス管理
- `scripts/mc-connect.cjs` — 接続リクエスト送信ロジック
- `scripts/mc-execute.cjs` — botインスタンス解決ロジック

### Status: Reported
