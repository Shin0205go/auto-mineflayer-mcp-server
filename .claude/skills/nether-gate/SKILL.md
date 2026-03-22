---
name: nether-gate
description: ネザーポータル建設。黒曜石10個+火打石（mc_execute用）
---
## 方法1: 溶岩+水（ダイヤピッケル不要）
```js
await bot.navigate("lava");
await bot.craft("bucket"); // 鉄3個
// 水バケツで溶岩源を固めてobsidian生成
// 4x5の枠を形成（角4つ不要、最小10個）
```

## 方法2: 直接採掘（ダイヤピッケル必要）
```js
await bot.gather("obsidian", 10);
```

## 起動
```js
await bot.craft("flint_and_steel"); // 鉄1+火打石1
// ポータル内側に使用 → 紫のポータル出現
```

## ネザー入る前に必須
- 鉄/ダイヤ装備、剣、弓+矢64本、食料64個、丸石64個
- 金装備1個（ピグリン対策）、fire_resistance_potion 推奨

## ブレイズロッド収集
```js
await bot.combat("blaze"); // ネザー要塞スポナー付近
// 最低6本必要（エンダーアイ12個分）
```
