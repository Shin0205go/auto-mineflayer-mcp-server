---
name: survival
description: 食料確保・HP回復・夜間対処の手順（mc_execute用）
---
## Day 1（mc_execute コード）
```js
const s = await bot.status();
bot.log(`HP:${s.hp} Hunger:${s.hunger}`);

// 木材→作業台→ピッケル→剣
await bot.gather("oak_log", 10);
await bot.craft("crafting_table");
await bot.craft("wooden_pickaxe");
await bot.craft("wooden_sword");

// 食料確保
await bot.combat("cow"); // pig/chicken/sheep でも可
await bot.eat();

// 石ツール
await bot.gather("cobblestone", 20);
await bot.craft("stone_pickaxe");
await bot.craft("stone_sword");

// シェルター
await bot.build("shelter");
bot.log("Day 1 完了");
```

## 食料ない時
```js
// 1. チェスト確認
const chest = await bot.store("list");
bot.log(chest);
// 2. 動物を狩る
await bot.combat("cow");
// 3. 最終手段: 腐肉
await bot.combat("zombie");
```

## 夜間
```js
const s = await bot.status();
if (s.time > 12500) {
  const inv = await bot.inventory();
  if (inv.find(i => i.name.includes('bed'))) {
    await bot.navigate("white_bed");
  } else {
    await bot.build("shelter");
  }
}
```
