---
name: auto-farm
description: 食料の農場運用（mc_execute用）
---
## 小麦農場
```js
// bot.farm() が全自動: 水源探し→耕作→種植え→収穫
await bot.farm();

// 小麦があればパン作成
const inv = await bot.inventory();
const wheat = inv.find(i => i.name === 'wheat');
if (wheat && wheat.count >= 3) {
  await bot.craft('bread');
  bot.log('パン作成完了');
}
```

## 骨粉で即時成長
```js
// 骨→骨粉
await bot.craft("bone_meal", 3);
// bot.farm() 内で自動的に骨粉が使われる
await bot.farm();
```

## チェストに食料を貯蔵 (Phase 2 目標: 20個以上)
```js
const inv = await bot.inventory();
const bread = inv.find(i => i.name === 'bread');
if (bread && bread.count >= 5) {
  await bot.store("store", "bread", bread.count - 2); // 2個は持っておく
  bot.log(`パン${bread.count - 2}個をチェストに格納`);
}
```

## 成長時間目安
- 小麦/ニンジン/ジャガイモ: 20-30分
- サトウキビ: 16分/段
- 骨粉で即時成長可能
