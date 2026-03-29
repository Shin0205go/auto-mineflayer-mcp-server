# bot API Reference for mc_execute

mc_execute でコードを書く時に使える `bot` オブジェクトのAPIリファレンス。
`bot` は生の mineflayer Bot インスタンス。

**⚠️ `require()` は使えない。`goals`, `Movements`, `Vec3`, `log`, `wait`, `getMessages` はすでにスコープに注入されている。自分でimport/requireするな。**

## Status & Info

```js
// HP・空腹・位置をそのまま読む
bot.health          // 0-20
bot.food            // 0-20
bot.entity.position // Vec3 { x, y, z }

// インベントリ
const inv = bot.inventory.items(); // Item[] → {name, count, ...}
const wood = inv.find(i => i.name === 'oak_log');
log('wood: ' + (wood?.count ?? 0));

// チャット履歴
const msgs = getMessages(); // 配列

// 周辺エンティティ
const mobs = Object.values(bot.entities).filter(e => e.type === 'mob');
const nearest = bot.nearestEntity(e => e.type === 'mob');
```

## Movement (pathfinder)

```js
// pathfinder で移動
const movements = new Movements(bot);
movements.canDig = false;
movements.maxDropDown = 2;
bot.pathfinder.setMovements(movements);
await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1));

// ブロックの近くへ移動
const block = bot.findBlock({ matching: bot.registry.blocksByName['oak_log'].id, maxDistance: 32 });
if (block) await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1));
```

## Mining & Digging

```js
// ブロックを探して掘る
const block = bot.findBlock({
  matching: bot.registry.blocksByName['oak_log'].id,
  maxDistance: 32
});
if (block) {
  await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1));
  await bot.dig(block);
}
```

## Crafting

```js
// crafting_tableなしでクラフト（手持ち3x3）
const recipes = bot.recipesFor(bot.registry.itemsByName['crafting_table'].id, null, 1, null);
if (recipes[0]) await bot.craft(recipes[0], 1, null);

// crafting_tableを使ってクラフト
const table = bot.findBlock({ matching: bot.registry.blocksByName['crafting_table'].id, maxDistance: 4 });
const recipes2 = bot.recipesFor(bot.registry.itemsByName['stone_pickaxe'].id, null, 1, table);
if (recipes2[0]) await bot.craft(recipes2[0], 1, table);
```

## Combat

```js
// 攻撃
const sword = bot.inventory.items().find(i => i.name.includes('sword'));
if (sword) await bot.equip(sword, 'hand');
const mob = bot.nearestEntity(e => e.name === 'zombie');
if (mob) await bot.attack(mob);

// 逃走（手動pillar）
await bot.setControlState('jump', true);
// または pathfinder で遠くへ移動
```

## Blocks

```js
// ブロック設置
const cobble = bot.inventory.items().find(i => i.name === 'cobblestone');
if (cobble) {
  await bot.equip(cobble, 'hand');
  const refBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0));
  await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
}

// ブロック情報
const blockAt = bot.blockAt(new Vec3(x, y, z));
log(blockAt?.name);
```

## Utilities

```js
// 待機
await wait(3000);  // 3秒 (最大30秒)

// ログ出力
log('message');

// チャット送信
bot.chat('hello');

// アイテムを食べる
const food = bot.inventory.items().find(i => ['bread','cooked_beef','cooked_porkchop'].includes(i.name));
if (food && bot.food < 18) {
  await bot.equip(food, 'hand');
  await bot.consume();
}
```
