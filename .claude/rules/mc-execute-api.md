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
eat()                    // 注入済み: 安定した食事関数（food_level_changeイベント + 2800msフォールバック）

// Movement
bot.pathfinder.goto(goal)           // ナビゲーション
bot.pathfinder.setMovements(mvts)   // pathfinder 設定
Movements(bot)                       // インスタンス
goals.GoalNear(x,y,z,range)        // 近接目標
goals.GoalBlock(x,y,z)              // ブロック目標

// Mining/Interaction
bot.findBlock({matching: blockId, maxDistance: 32})  // ブロック探索
bot.dig(block)           // ブロック採掘
bot.attack(entity)       // エンティティ攻撃
bot.chat(msg)            // チャット送信
bot.placeBlock(referenceBlock, faceVec)  // ブロック設置。faceVec=new Vec3(0,1,0)で上面に設置

// Container/Furnace (重要: openContainer() は furnace に使えない)
bot.openFurnace(furnaceBlock)     // かまどを開く (openContainer() は使わない)
bot.openContainer(chestBlock)     // チェスト/ディスペンサー等を開く (furnace 不可)
// furnace window: .putInput(itemType, null, count), .putFuel(itemType, null, count), .takeOutput(), .close()
// 例: const fw = await bot.openFurnace(fb); await fw.putFuel(...); await fw.putInput(...); fw.close();

// Crafting
bot.craft(recipe, count, table)                 // クラフト実行 (低レベル。windowOpenタイムアウトに注意→craftWithTable()推奨)
recipesFor(itemId, metadata?, count?)           // 注入済み: bot.recipesFor()のラッパー。近くのクラフトテーブルを自動検出して3x3レシピも返す
await craftWithTable(itemName, count?)          // 注入済み: 信頼性の高いクラフト。activateBlock+wait+craftを一括実行。windowOpenタイムアウト(40%失敗)を回避

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
await multiStagePathfind(x, z, stageDistance?) // 注入済み: 長距離をウェイポイントに分割して移動。各ステージにも位置ロック検知あり
await safePlaceBlock(refBlock, faceVec) // 注入済み: blockUpdateタイムアウトを回避するブロック設置
await pillarUp(height?)     // 注入済み: 足元にブロックを積み上げて高さを稼ぐ (デフォルト4ブロック)。bot.pillarUp()は存在しないのでこれを使う
await fillHoles(radius?)    // 注入済み: 周囲の落下穴を埋める
await smeltItems(furnaceBlock, inputItemName, fuelItemName, count?) // 注入済み: かまど精錬ヘルパー
await plantSeeds(farmlandBlock, seedItemName?) // 注入済み: 種植えヘルパー (rawパケット、blockUpdateタイムアウト回避)
awareness()                 // 注入済み: 自己状態+空間スナップショット (行動前に必ず呼ぶ)
scan3D(radius?, heightRange?) // 注入済み: 3D空間スキャン
safetyState                 // 注入済み: AutoSafety状態 (read-only)
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
const movements = new Movements(bot);
movements.canDig = false;  // 採掘移動無効
bot.pathfinder.setMovements(movements);
await bot.pathfinder.goto(new goals.GoalNear(100, 64, 200, 1));
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
// クラフトテーブルに近づいてから呼ぶ (4ブロック以内)
const result = await craftWithTable('bread', 1);
log('Crafted: ' + JSON.stringify(result));  // { crafted: 'bread', count: 1, tableUsed: true }

// 方法2: 低レベル (bot.craft + activateBlock + wait)
// craftWithTable() が使えない場合のみ使用
const itemId = bot.registry.itemsByName['wooden_pickaxe'].id;
const recipes = recipesFor(itemId);  // ← 注入済みラッパー
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
  await eat();  // ← sandboxに注入済み。food_level_changeイベントで完了検知、2800msフォールバック付き
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

### 種植え (重要: bot.place(), bot.interact() は存在しない)
```js
// NG: bot.place(farmland, ...) → "bot.place is not a function"
// NG: bot.interact(farmland) → 存在しない
// OK: bot.equip(seeds, 'hand') + bot.placeBlock(farmland, new Vec3(0,1,0))
//   または plantSeeds() ヘルパー

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
