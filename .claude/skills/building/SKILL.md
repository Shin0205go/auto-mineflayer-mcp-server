---
name: building
description: bot.buildで構造物建設。place手動繰り返し不要（mc_execute用）
---
## 基本
```js
await bot.build("shelter"); // small がデフォルト
await bot.build("shelter", "medium");
```
presets: shelter / wall / platform / tower
sizes: small(50ブロック) / medium(150) / large(300)

## Base Protocol (Phase 1)
```js
await bot.gather("oak_log", 16);
await bot.craft("crafting_table");
await bot.gather("cobblestone", 24);
await bot.craft("furnace");
await bot.craft("chest", 3);
await bot.build("shelter");
bot.log("拠点完成");
```

## 個別ブロック設置
```js
const s = await bot.status();
const x = Math.floor(s.position.x);
const y = Math.floor(s.position.y);
const z = Math.floor(s.position.z);
await bot.place("furnace", x+2, y, z);
await bot.place("crafting_table", x+3, y, z);
await bot.place("chest", x+4, y, z);
```
