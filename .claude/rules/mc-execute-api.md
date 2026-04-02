---
paths:
  - "src/tools/mc-execute.ts"
---

# mc_execute API リファレンス

## 基礎

mc_execute はセキュアサンドボックス内で JavaScript を実行。直接使用可能なオブジェクト:

```js
// mineflayer Bot インスタンス
bot              // 全メソッド・プロパティ
bot.health       // HP (0-20)
bot.food         // 飢え (0-20)
bot.entity.position  // Vec3 座標

// Inventory
bot.inventory.items()    // アイテム配列 [{name, count, metadata}]
bot.heldItem             // 現在の手持ちアイテム
bot.equip(item, dest)    // 装備 (dest = 'head'|'chest'|'legs'|'feet'|'hand')
bot.consume()            // 食べる（非推奨: entity_statusタイムアウトあり → eat()を使う）
eat()                    // 注入済み: 安定した食事関数（healthイベント + 3500msフォールバック）

// Movement
bot.pathfinder.goto(goal)           // ナビゲーション
bot.pathfinder.setMovements(mvts)   // pathfinder 設定
Movements(bot)                       // インスタンス (注意: bot.world を渡すと blocksByName エラー → 必ず bot を渡す)
goals.GoalNear(x,y,z,range)        // 近接目標
goals.GoalBlock(x,y,z)              // ブロック目標

// Mining/Interaction
bot.findBlock({matching: blockId, maxDistance: 32})  // ブロック探索
bot.dig(block)           // ブロック採掘
bot.attack(entity)       // エンティティ攻撃
bot.chat(msg)            // チャット送信
bot.placeBlock(referenceBlock, faceVec)  // ブロック設置。faceVec=new Vec3(0,1,0)で上面に設置

// Container/Furnace (重要: openContainer() は furnace に使えない)
bot.openFurnace(furnaceBlock)     // かまどを開く (openContainer() は使わない)。activateBlock pre-activation 自動適用済み
bot.openContainer(chestBlock)     // チェスト/ディスペンサー等を開く (furnace 不可, windowOpenタイムアウトあり→openChest()推奨)
// furnace window: .putInput(itemType, null, count), .putFuel(itemType, null, count), .takeOutput(), .close()
// 例: const fw = await bot.openFurnace(fb); await fw.putFuel(...); await fw.putInput(...); fw.close();
// chest/barrel: openChest(block) を使う (activateBlock+windowOpen待機でタイムアウト回避)
// chest window: .containerItems() — 中身, .withdraw(itemId, null, count) — 取り出し, .deposit(itemId, null, count) — しまう, .close()

// Crafting
bot.craft(recipe, count, table)                 // クラフト実行 (低レベル。windowOpenタイムアウトに注意→craftWithTable()推奨)
recipesFor(itemIdOrName, metadata?, minResultCount?)  // 注入済み: bot.recipesFor()のラッパー。数値IDまたはアイテム名文字列（例: 'bread'）を受け取る。近くのクラフトテーブルを自動検出して3x3レシピも返す。第3引数はminResultCount(デフォルト1)=素材がN回分あるかのフィルタ
await craftWithTable(itemName, count?)          // 注入済み: 信頼性の高いクラフト。activateBlock+wait+craftを一括実行。windowOpenタイムアウト(40%失敗)を回避。slot[0]回収付き

// Info
bot.nearestEntity(filter)   // 最近のエンティティ
bot.time.timeOfDay          // ゲーム時間 (0-23999 tick)
bot.registry.blocksByName   // ブロック ID マップ
bot.registry.itemsByName    // アイテム ID マップ

// Utility (mc_execute に注入)
await wait(ms)              // 待機 (max 30s)
log(msg)                    // ログ出力
getMessages()               // チャット履歴配列
Vec3(x,y,z)                // ベクトル生成
await eat()                 // 注入済み: 安定した食事関数
await escapeWater()         // 注入済み: 水中脱出
await collectDrops(radius?) // 注入済み: bot.dig()/bot.attack()後のドロップ収集 (デフォルト8ブロック)
await pathfinderGoto(goal, timeoutMs?) // 注入済み: タイムアウト+位置ロック検知付きpathfinder.goto()。No path時canDig=trueでリトライ。経路計算中(15s猶予)は位置不変でもstuckとみなさない
await multiStagePathfind(x, z, stageDistance?, targetY?) // 注入済み: 長距離をウェイポイントに分割して移動。各ステージにも位置ロック検知あり。targetY指定時は最終ステージでGoalNear(x,y,z,3)を使いY軸移動も行う(ネザー等の高低差がある地形向け)。中間ステージ失敗はスキップして継続、最終ステージ失敗のみthrow
await safePlaceBlock(refBlock, faceVec) // 注入済み: blockUpdateタイムアウトを回避するブロック設置
await pillarUp(height?)     // 注入済み: 足元にブロックを積み上げて高さを稼ぐ (デフォルト4ブロック)。bot.pillarUp()は存在しないのでこれを使う
await descendSafely(targetY, maxDigAttempts?) // 注入済み: 足元を掘りながら安全に降下。崖・段差対応 (デフォルト maxDigAttempts=30)。{ reached, finalY } を返す
await fillHoles(radius?)    // 注入済み: 周囲の落下穴を埋める
await smeltItems(furnaceBlock, inputItemName, fuelItemName, count?) // 注入済み: かまど精錬ヘルパー
await enchantItem(itemName, enchantChoice?, tableBlock?) // 注入済み: エンチャントヘルパー。putTargetItem()/moveSlotItem()の"invalid operation"バグを回避。choice: 0=安い,1=中,2=高(デフォルト2)。{ enchanted, choice, level } を返す
await plantSeeds(farmlandBlock, seedItemName?) // 注入済み: 種植えヘルパー (rawパケット、blockUpdateタイムアウト回避)
await tillLand(dirtBlock)                     // 注入済み: 土/草ブロックをホエで耕してfarmlandに変換。blockUpdate待機でクライアント同期を保証。{ tilled, blockName, position } を返す
await applyBoneMeal(targetBlock)              // 注入済み: bone_mealを作物/苗木/草ブロックに使用。rawパケットで信頼性向上。{ applied, blockNameAfter } を返す
await openChest(chestBlock)                   // 注入済み: チェスト/樽を開く。activateBlock+windowOpen待機でタイムアウト回避。戻り値はbot.openContainer()と同じウィンドウオブジェクト
await enterPortal(timeoutMs?)                 // 注入済み: ネザー/エンドポータル通過ヘルパー。respawnイベント+500msポーリングで次元変更を検知。{ success, dimensionBefore, dimensionAfter } を返す。ポータルブロック内に立って前進キーを保持し続けること（約4秒のポータル遅延あり）
awareness()                 // 注入済み: 自己状態+空間スナップショット (行動前に必ず呼ぶ)
scan3D(radius?, heightRange?) // 注入済み: 3D空間スキャン
safetyState                 // 注入済み: AutoSafety状態 (read-only)
safetyState.nearbyOres      // [{name, pos: {x,y,z}}] — 最大1個/鉱石種 within 32 blocks (10秒ごと更新)
safetyState.nearbyWater     // [{x,y,z}] — 最寄りの水源 within 32 blocks
safetyState.nearbyChests    // [{x,y,z}] — 最寄りのチェスト within 32 blocks
safetyState.lastScanTime    // Date.now() — 最後のスキャン時刻 (ms)
safetyState.scan3DSnapshot  // scan3D() の最新スナップショット文字列 (10秒ごと更新)
safetyState.scan3DTime      // Date.now() — スナップショット取得時刻 (ms)
```

## よく使うパターン

### 状態確認
```js
log('HP:' + bot.health + ' Food:' + bot.food);
const pos = bot.entity.position;
log('Pos: (' + Math.floor(pos.x) + ',' + Math.floor(pos.y) + ',' + Math.floor(pos.z) + ')');

// インベントリ
const items = bot.inventory.items();
const wood = items.find(i => i.name === 'oak_log');
log('oak_log: ' + (wood?.count ?? 0));
```

### 移動
```js
// NG: new Movements(bot.world) → "Cannot read properties of undefined (reading 'blocksByName')"
// OK: new Movements(bot)  ← 必ず bot (mineflayer インスタンス) を渡す
const movements = new Movements(bot);
movements.canDig = false;  // 採掘移動無効
bot.pathfinder.setMovements(movements);
await bot.pathfinder.goto(new goals.GoalNear(100, 64, 200, 1));

// 推奨: タイムアウト + stuck 検知付きラッパーを使う
await pathfinderGoto(new goals.GoalNear(100, 64, 200, 1), 30000);
```

### ブロック採掘
```js
const block = bot.findBlock({matching: bot.registry.blocksByName['oak_log'].id, maxDistance: 32});
if (block) {
  await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1));
  await bot.dig(block);
}
```

### クラフト (重要: bot.craft()は直接呼ばない)
```js
// NG: bot.craft(recipe, 1, table) → windowOpenタイムアウト40%失敗
// OK: craftWithTable() ヘルパー (推奨) — activateBlock+wait+craftを一括実行

// 方法1: craftWithTable() ヘルパー (推奨)
// クラフトテーブルに近づいてから呼ぶ (6ブロック以内)
const result = await craftWithTable('bread', 1);
log('Crafted: ' + JSON.stringify(result));  // { crafted: 'bread', count: 1, tableUsed: true }

// 方法2: 低レベル (bot.craft + activateBlock + wait)
// craftWithTable() が使えない場合のみ使用
// recipesFor は数値IDでも文字列名でも受け取れる
const itemId = bot.registry.itemsByName['wooden_pickaxe'].id;
const recipes = recipesFor(itemId);        // 数値IDでも
const breads = recipesFor('bread');        // 文字列名でもOK ← エージェントによく使われる
const table = bot.findBlock({matching: bot.registry.blocksByName['crafting_table'].id, maxDistance: 4});
if (recipes[0] && table) {
  await bot.activateBlock(table);  // ← 先にウィンドウを開く
  await wait(300);
  await bot.craft(recipes[0], 1, table);
}
```

### 戦闘 + ドロップ収集
```js
const mob = bot.nearestEntity(e => e.type === 'mob');
if (mob) {
  const sword = bot.inventory.items().find(i => i.name.includes('sword'));
  if (sword) await bot.equip(sword, 'hand');
  await bot.attack(mob);
  // ドロップを収集 (bot.attack()後に必ず呼ぶ)
  const result = await collectDrops();  // ← sandboxに注入済み
  log(result);
}
```

### 食事
```js
// eat() を使う（bot.consume() はサーバーのentity_statusパケット遅延でタイムアウトするため非推奨）
const food = bot.inventory.items().find(i =>
  ['bread','cooked_beef','cooked_porkchop','cooked_chicken'].includes(i.name)
);
if (food && bot.food < 18) {
  await bot.equip(food, 'hand');
  await eat();  // ← sandboxに注入済み。healthイベントで完了検知、3500msフォールバック付き
}
// bot.consume() は使わない: "Promise timed out" エラーが頻発する
```

### かまど精錬 (重要: openContainer() は使わない)
```js
// NG: bot.openContainer(furnaceBlock) → "containerToOpen is neither a block nor an entity"
// OK: bot.openFurnace(furnaceBlock) または smeltItems() ヘルパー

// 方法1: smeltItems() ヘルパー (推奨)
const furnaceId = bot.registry.blocksByName['furnace'].id;
const furnaceBlock = bot.findBlock({ matching: furnaceId, maxDistance: 6 });
if (furnaceBlock) {
  await pathfinderGoto(new goals.GoalNear(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2), 15000);
  const result = await smeltItems(furnaceBlock, 'raw_iron', 'coal', 3);
  log('Smelted: ' + JSON.stringify(result));
}

// 方法2: bot.openFurnace() を直接使う
const fw = await bot.openFurnace(furnaceBlock);
await fw.putFuel(bot.registry.itemsByName['coal'].id, null, 1);
await fw.putInput(bot.registry.itemsByName['raw_iron'].id, null, 3);
// smeltを待つ (1アイテム = 約10秒)
await wait(35000);
await fw.takeOutput();
fw.close();
```

### 農業: farmland作成 → 種植え → bone_meal

#### farmland作成 (重要: activateBlock単体では同期されない)
```js
// NG: await bot.activateBlock(dirtBlock)  → hoeを持っていても次のfindBlocks()でdirtのままに見える
//     (activateBlockはblockUpdateを待たないのでクライアント状態が同期されない)
// OK: tillLand() ヘルパー — blockUpdate待機でクライアント同期を保証
const dirtId = bot.registry.blocksByName['dirt'].id;
const grassId = bot.registry.blocksByName['grass_block'].id;
const dirtBlocks = bot.findBlocks({ matching: [dirtId, grassId], maxDistance: 8, count: 10 });
for (const pos of dirtBlocks) {
  const block = bot.blockAt(pos);
  // 上が空気なら耕せる
  const above = bot.blockAt(pos.offset(0, 1, 0));
  if (above && above.name === 'air') {
    await pathfinderGoto(new goals.GoalNear(pos.x, pos.y, pos.z, 2), 10000);
    const result = await tillLand(block);
    log('Tilled: ' + result.blockName + ' at ' + JSON.stringify(result.position));
    // result.tilled === true のときだけfarmlandになっている
  }
}
```

#### 種植え (重要: bot.place(), bot.interact() は存在しない)
```js
// NG: bot.place(farmland, ...) → "bot.place is not a function"
// NG: bot.interact(farmland) → 存在しない
// OK: plantSeeds() ヘルパー (推奨)

// 方法1: plantSeeds() ヘルパー (推奨)
const farmlandId = bot.registry.blocksByName['farmland'].id;
const farmlands = bot.findBlocks({ matching: farmlandId, maxDistance: 10, count: 20 });
for (const pos of farmlands) {
  const block = bot.blockAt(pos);
  // 上が空気なら植えられる
  const above = bot.blockAt(pos.offset(0, 1, 0));
  if (above && above.name === 'air') {
    await pathfinderGoto(new goals.GoalNear(pos.x, pos.y, pos.z, 2), 10000);
    await plantSeeds(block, 'wheat_seeds');
  }
}

// 方法2: bot.placeBlock() を直接使う
const seedItem = bot.inventory.items().find(i => i.name === 'wheat_seeds');
await bot.equip(seedItem, 'hand');
await bot.placeBlock(farmlandBlock, new Vec3(0, 1, 0));
// ← farmlandBlock = bot.blockAt(pos) で取得したブロックオブジェクト
```

#### bone_meal使用 (重要: bot.activateBlock はサーバー版依存で不安定)
```js
// NG: await bot.activateBlock(cropBlock)  → bone_mealが消費されない場合がある
// OK: applyBoneMeal() ヘルパー — rawパケットで確実にbone_mealを使用

const wheatId = bot.registry.blocksByName['wheat'].id;
const wheatBlock = bot.findBlock({ matching: wheatId, maxDistance: 5 });
if (wheatBlock) {
  await pathfinderGoto(new goals.GoalNear(wheatBlock.position.x, wheatBlock.position.y, wheatBlock.position.z, 2), 10000);
  const result = await applyBoneMeal(wheatBlock);
  log('BoneMeal: applied=' + result.applied + ' block now: ' + result.blockNameAfter);
}
```

### チェストアクセス (重要: bot.openContainer() は windowOpen タイムアウトあり)
```js
// NG: const chest = await bot.openContainer(chestBlock) → 20s windowOpen タイムアウト40%失敗
// OK: openChest() ヘルパー (推奨) — activateBlock+wait+openContainer を一括実行

const chestId = bot.registry.blocksByName['chest'].id;
const chestBlock = bot.findBlock({ matching: chestId, maxDistance: 5 });
if (chestBlock) {
  await pathfinderGoto(new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2), 15000);
  const chest = await openChest(chestBlock);
  // 中身を確認
  const items = chest.containerItems();
  log('Chest contents: ' + JSON.stringify(items.map(i => ({ name: i.name, count: i.count }))));
  // アイテムを取り出す
  const bread = items.find(i => i.name === 'bread');
  if (bread) await chest.withdraw(bread.type, null, bread.count);
  await chest.close();
}
```

### エンチャント (重要: putTargetItem/moveSlotItem は "invalid operation" で失敗する)
```js
// NG: table.putTargetItem(item)      → "invalid operation" (botのインベントリスロット番号がウィンドウ範囲外)
// NG: bot.moveSlotItem(42, 0)        → "invalid operation" (同上)
// OK: enchantItem() ヘルパー (推奨) — windowスロットを直接検索してrawパケットで移動

// エンチャントテーブルに近づいてから呼ぶ (6ブロック以内)
const etId = bot.registry.blocksByName['enchanting_table'].id;
const etBlock = bot.findBlock({ matching: etId, maxDistance: 6 });
if (etBlock) {
  await pathfinderGoto(new goals.GoalNear(etBlock.position.x, etBlock.position.y, etBlock.position.z, 2), 15000);
  // XP level >= 3 とラピスラズリが必要
  const result = await enchantItem('diamond_pickaxe', 2); // 2=最も高いオプション
  log('Enchanted: ' + JSON.stringify(result)); // { enchanted: 'diamond_pickaxe', choice: 2, level: 30 }
}
```

### ネザーポータル通過 (重要: 単に歩き込むだけでは転送されない場合あり)
```js
// NG: bot.activateBlock(portalBlock) でポータルを再点火しようとする
//   → 既にアクティブな nether_portal ブロックに activateBlock は不要
// NG: await wait(2000) で2秒待つだけ
//   → ポータル通過には約4秒の「ポータル遅延」が必要
// OK: enterPortal() ヘルパー — ポータルブロック内でフォワード保持 + respawn/ポーリング検知

// ポータルブロック位置に移動
const portalId = bot.registry.blocksByName['nether_portal'].id;
const portalBlock = bot.findBlock({ matching: portalId, maxDistance: 10 });
if (portalBlock) {
  await pathfinderGoto(new goals.GoalBlock(portalBlock.position.x, portalBlock.position.y, portalBlock.position.z), 20000);
  const result = await enterPortal(30000);
  log('Portal result: ' + JSON.stringify(result));
  if (result.success) {
    log('Now in: ' + result.dimensionAfter);
  } else {
    log('Portal failed — check: 1) portal is active (nether_portal block), 2) bot is inside portal, 3) server allows portals');
  }
}
```

### pathfinder で到達確認 (false success 対策)
```js
// GoalY(y) はY座標のみ確認 → 水平距離は無視される → false success の原因
// 正確な近接には GoalNear または GoalBlock を使う
// NG: await bot.pathfinder.goto(new goals.GoalY(92))  // y=92に到達すればOKだがXZは不問
// OK: await pathfinderGoto(new goals.GoalNear(x, y, z, 2), 20000)

// 到達後に位置確認する
const pos = bot.entity.position;
const targetPos = furnaceBlock.position;
const reached = Math.abs(pos.x - targetPos.x) < 3 && Math.abs(pos.z - targetPos.z) < 3;
log('Reached: ' + reached + ' pos: ' + JSON.stringify({x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z)}));
```

## 制約

- `require()` 禁止 (セキュリティ)
- Async/await 対応
- デフォルト timeout: 120秒（最大 600秒）
- `wait()` は1回30秒まで
- ログ出力は最大200行
- mineflayer 公式 API のみ有効

詳細: https://github.com/PrismarineJS/mineflayer
