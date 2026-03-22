---
name: iron-mining
description: 鉄鉱石採掘→精錬→鉄インゴット（mc_execute用）
---
## 前提
- 石ピッケル以上必須（木では掘れない）
- かまど + 燃料(coal/oak_log)

## 手順
```js
const s = await bot.status();
bot.log(`ツール: ${JSON.stringify(s.inventory)}`);

// 鉄鉱石採掘（Y=16付近が最多）
await bot.gather("iron_ore", 16);

// 精錬
await bot.smelt("raw_iron", 16);

// 鉄ツール作成
await bot.craft("iron_pickaxe");
await bot.craft("iron_sword");
bot.log("鉄装備完成");
```

## 必要数の目安
- 鉄ピッケル: 3個、鉄の剣: 2個、バケツ: 3個 → 最低8個
- フル装備追加: +24個 → 計32個

## 鉄装備レシピ（インゴット数）
- iron_pickaxe: 3、iron_sword: 2、iron_axe: 3
- iron_helmet: 5、iron_chestplate: 8、iron_leggings: 7、iron_boots: 4
