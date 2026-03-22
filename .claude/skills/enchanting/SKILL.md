---
name: enchanting
description: エンチャントテーブル設置と最適エンチャント（mc_execute用）
---
## 必要素材
- obsidian x4、diamond x2、book x1
- 本棚15個でLv30エンチャント可能（book x45、leather x15）

## 手順
```js
await bot.craft("enchanting_table");
const s = await bot.status();
const x = Math.floor(s.position.x);
const y = Math.floor(s.position.y);
const z = Math.floor(s.position.z);
await bot.place("enchanting_table", x+2, y, z);
// 本棚を周囲に設置（1ブロック離して）
bot.log("エンチャントテーブル設置完了");
```

## 優先エンチャント
- ピッケル: Efficiency V, Fortune III, Unbreaking III
- 剣: Sharpness V, Unbreaking III, Looting III
- 防具: Protection IV, Unbreaking III

## 経験値稼ぎ
```js
// モブ戦闘で経験値を稼ぐ
await bot.combat("zombie");
// ネザー要塞のブレイズ（高経験値）
```
