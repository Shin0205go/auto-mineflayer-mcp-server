---
name: bed-crafting
description: ベッド作成。夜スキップ・リスポーン地点設定（mc_execute用）
---
## 必要素材
- wool x3（羊3匹分）、oak_planks x3（原木1個で可）

## 手順
```js
// 羊を探して狩る（wool x3）
await bot.navigate("sheep");
await bot.combat("sheep");
await bot.combat("sheep");
await bot.combat("sheep");

// 原木を確保してベッドをクラフト
await bot.gather("oak_log", 1);
await bot.craft("white_bed");

// ベッドを設置
const s = await bot.status();
const x = Math.floor(s.position.x);
const y = Math.floor(s.position.y);
const z = Math.floor(s.position.z);
await bot.place("white_bed", x+1, y, z);
bot.log("ベッド設置完了");
```

## 羊が見つからない
plains / forest バイオームへ移動して探す:
```js
await bot.moveTo(s.position.x + 100, 64, s.position.z);
await bot.navigate("sheep");
```
