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

// Crafting
bot.craft(recipe, count, table)                 // クラフト実行
recipesFor(itemId, metadata?, count?)           // 注入済み: bot.recipesFor()のラッパー。近くのクラフトテーブルを自動検出して3x3レシピも返す

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
await pathfinderGoto(goal, timeoutMs?) // 注入済み: タイムアウト付きpathfinder.goto() + No path時にcanDig=trueでリトライ
await multiStagePathfind(x, z, stageDistance?) // 注入済み: 長距離をウェイポイントに分割して移動
await safePlaceBlock(refBlock, faceVec) // 注入済み: blockUpdateタイムアウトを回避するブロック設置
await fillHoles(radius?)    // 注入済み: 周囲の落下穴を埋める
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

### クラフト
```js
// recipesFor() 注入済みラッパーを使う (近くのテーブルを自動検出、3x3レシピも返す)
const itemId = bot.registry.itemsByName['wooden_pickaxe'].id;
const recipes = recipesFor(itemId);  // ← sandboxに注入済み。bot.recipesFor()より確実
const table = bot.findBlock({matching: bot.registry.blocksByName['crafting_table'].id, maxDistance: 4});
if (recipes[0]) await bot.craft(recipes[0], 1, table);
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

## 制約

- `require()` 禁止 (セキュリティ)
- Async/await 対応
- デフォルト timeout: 120秒（最大 600秒）
- `wait()` は1回30秒まで
- ログ出力は最大200行
- mineflayer 公式 API のみ有効

詳細: https://github.com/PrismarineJS/mineflayer
