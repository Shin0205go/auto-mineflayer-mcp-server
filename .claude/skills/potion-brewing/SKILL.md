---
name: potion-brewing
description: ポーション醸造。醸造台設置からレシピまで（mc_execute用）
---
## 醸造台作成
```js
await bot.combat("blaze"); // blaze_rod x1
await bot.craft("brewing_stand");
const s = await bot.status();
const x = Math.floor(s.position.x);
const y = Math.floor(s.position.y);
const z = Math.floor(s.position.z);
await bot.place("brewing_stand", x+1, y, z);
```

## 基本レシピ（水入り瓶→各ポーション）
- 水入り瓶 + nether_wart → awkward_potion（基本）
- awkward + magma_cream → fire_resistance（ネザー必須）
- awkward + spider_eye → poison
- awkward + sugar → swiftness
- awkward + golden_carrot → night_vision
- awkward + blaze_powder → strength

## 強化: awkward potion + glowstone → 強化版
## 延長: awkward potion + redstone → 延長版

## ネザー前必須
`fire_resistance_potion` を最低4本用意
