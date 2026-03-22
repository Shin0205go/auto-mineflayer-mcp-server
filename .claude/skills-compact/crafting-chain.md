---
name: crafting-chain
description: bot.craftで依存関係自動解決。autoGather=trueで素材自動収集（mc_execute用）
---
## 基本
```js
await bot.craft("wooden_pickaxe", 1, true); // autoGather=true
```

## Stone Upgrade (Phase 3)
```js
await bot.gather("cobblestone", 20);
await bot.craft("stone_pickaxe");
await bot.craft("stone_axe");
await bot.craft("stone_sword");
bot.log("石ツール完成");
```

## Iron Upgrade (Phase 4)
```js
await bot.gather("iron_ore", 12);
await bot.craft("furnace"); // なければ作成
await bot.smelt("raw_iron", 12);
await bot.craft("iron_pickaxe");
await bot.craft("iron_sword");
bot.log("鉄装備完成");
```

## Diamond Upgrade (Phase 5)
```js
await bot.gather("diamond_ore", 5); // Y=-59
await bot.craft("diamond_pickaxe");
await bot.craft("diamond_sword");
bot.log("ダイヤ装備完成");
```

## 失敗時
```js
// missing items エラー → 素材収集して再実行
const result = await bot.craft("iron_pickaxe");
bot.log(result); // エラーなら足りない素材が表示される
```
