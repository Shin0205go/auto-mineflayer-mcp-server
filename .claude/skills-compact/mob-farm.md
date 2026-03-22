---
name: mob-farm
description: モブトラップ建設。経験値とドロップ自動収集（mc_execute用）
---
## 基本構造（高さ24以上の塔）
1. Y=高所に暗い部屋（スポーン室）を建設
2. 底に落とし穴（水流で誘導）
3. 地上付近に集積室
```js
await bot.gather("cobblestone", 200);
await bot.craft("hopper", 4);
await bot.build("box", "cobblestone", "medium"); // スポーン室
bot.log("モブトラップ建設完了");
```

## 必要素材
- cobblestone 200+、water_bucket x数個、hopper x数個、chest x数個

## 効率的な場所
- 海上（周囲にスポーン余地なし）
- 高所（地上モブと競合しない）

## 稼げるドロップ
- zombie: rotten_flesh, iron_ingot, carrot, potato
- skeleton: bone, arrow
- creeper: gunpowder
