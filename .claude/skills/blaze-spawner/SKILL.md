---
name: blaze-spawner
description: ブレイズスポナー部屋の見つけ方・ブレイズロッド入手戦略（mc_execute用）
---
## Blaze Spawner Room

### 構造の特徴
- **部屋サイズ**: 約7x7x4のNether Bricks製小部屋
- **Nether Brick Fence（金属格子）**: 部屋の中心近くにスポナーがある
- **スポナー数**: 要塞1つに通常2個
- **Y座標**: 通常Y=40-80

### 見つけ方
```js
await bot.navigate("nether_bricks");
await bot.navigate("nether_brick_fence");
await bot.navigate("mob_spawner");
const s = await bot.status();
bot.log("Threats: " + JSON.stringify(s.threats));
```

### ブレイズ戦闘
```js
await bot.combat("blaze");
```
- 近接距離に近づいて攻撃が最適
- 石/ネザーレンガで火の玉をブロックしながら近づく

### 必要アイテム
- 食料 x16以上
- **金防具推奨**（ピグリン対策）
- 鉄の剣以上、丸石128（足場・壁用）

### 立ち回り
1. 入口に丸石で壁を作り逃げ場を確保
2. ブレイズが1-2体の時に攻撃
3. スポナーを破壊しない（農場として使える）
