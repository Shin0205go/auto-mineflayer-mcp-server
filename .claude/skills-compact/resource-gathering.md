---
name: resource-gathering
description: bot.gatherで自動探索・採掘・回収（mc_execute用）
---
## 基本
```js
await bot.gather("oak_log", 10);  // find→move→mine→collect 自動
```

## よく使うパターン
```js
await bot.gather("oak_log", 10);       // 木材
await bot.gather("cobblestone", 32);   // 石
await bot.gather("iron_ore", 12);      // 鉄鉱石（石ピッケル必須）
await bot.gather("coal_ore", 8);       // 石炭
await bot.gather("diamond_ore", 5);    // ダイヤ（鉄ピッケル必須、Y=-59付近）
```

## 見つからない時
```js
// 別エリアに移動してから再実行
const s = await bot.status();
await bot.moveTo(s.position.x + 100, 64, s.position.z);
await bot.gather("iron_ore", 12);
```
