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
bot.consume()            // 食べる

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
bot.recipesFor(itemId, metadata, count, table)  // レシピ取得
bot.craft(recipe, count, table)                 // クラフト実行

// Info
bot.nearestEntity(filter)   // 最近のエンティティ
bot.time.timeOfDay          // ゲーム時間 (0-23999 tick)
bot.registry.blocksByName   // ブロック ID マップ
bot.registry.itemsByName    // アイテム ID マップ

// Utility (mc_execute に注入)
await wait(ms)      // 待機 (max 30s)
log(msg)            // ログ出力
getMessages()       // チャット履歴配列
Vec3(x,y,z)        // ベクトル生成
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
const table = bot.findBlock({matching: bot.registry.blocksByName['crafting_table'].id, maxDistance: 4});
const recipes = bot.recipesFor(bot.registry.itemsByName['wooden_pickaxe'].id, null, 1, table);
if (recipes[0]) await bot.craft(recipes[0], 1, table);
```

### 戦闘
```js
const mob = bot.nearestEntity(e => e.type === 'mob');
if (mob) {
  const sword = bot.inventory.items().find(i => i.name.includes('sword'));
  if (sword) await bot.equip(sword, 'hand');
  await bot.attack(mob);
}
```

### 食事
```js
const food = bot.inventory.items().find(i =>
  ['bread','cooked_beef','cooked_porkchop','cooked_chicken'].includes(i.name)
);
if (food && bot.food < 18) {
  await bot.equip(food, 'hand');
  await bot.consume();
}
```

## 制約

- `require()` 禁止 (セキュリティ)
- Async/await 対応
- Max timeout: 30秒
- mineflayer 公式 API のみ有効

詳細: https://github.com/PrismarineJS/mineflayer
