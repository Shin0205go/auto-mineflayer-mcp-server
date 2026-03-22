---
name: diamond-mining
description: ダイヤ採掘。Y=-59、鉄ピッケル必須（mc_execute用）
---
## 前提
- 鉄ピッケル以上（木・石では採掘不可）
- 水バケツ（溶岩対策）、松明、食料

## 手順
```js
const s = await bot.status();
// 最適高度へ移動
await bot.moveTo(s.position.x, -59, s.position.z);
// ダイヤ採掘
await bot.gather("diamond_ore", 5);
await bot.chat("[資源] ダイヤ発見!");
bot.log("ダイヤ採掘完了");
```

## 採掘量の目安
- ダイヤピッケル: 3、ダイヤ剣: 2、フルアーマー: 24、エンチャント台: 2
- 基本セット合計: **31個**

## 注意
- Y=-54以下は溶岩湖多い → 水バケツ必携
- Fortune III ピッケルがあれば効率2.2倍
