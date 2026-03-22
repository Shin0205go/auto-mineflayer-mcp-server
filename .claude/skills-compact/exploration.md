---
name: exploration
description: bot.navigateで広範囲探索。バイオーム・村・資源発見（mc_execute用）
---
## 基本パターン
```js
// ブロック探索
await bot.navigate("iron_ore");
await bot.navigate({target_block: "diamond_ore", max_distance: 64});

// エンティティ探索
await bot.navigate("villager");
await bot.navigate("cow");

// 座標移動
await bot.moveTo(250, 64, -200);
```

## 探索後の周囲確認
```js
const s = await bot.status();
bot.log(`Biome: ${s.biome}`);
bot.log(`Resources: ${JSON.stringify(s.nearbyResources)}`);
bot.log(`Entities: ${JSON.stringify(s.nearbyEntities)}`);
```

## 重要な発見はチャット共有
```js
await bot.chat("[資源] diamond_ore発見: x=123, y=-59, z=456");
```

## 見つからない時
```js
// 別エリアに移動してから再探索
const s = await bot.status();
await bot.moveTo(s.position.x + 150, 64, s.position.z + 150);
await bot.navigate("villager");
```
