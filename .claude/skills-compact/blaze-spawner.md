---
name: blaze-spawner
description: ブレイズスポナー部屋の見つけ方・ブレイズロッド入手戦略（mc_execute用）
---
## Blaze Spawner Room（ブレイズスポナー部屋）

### 構造の特徴
- **部屋サイズ**: 約7x7x4のNether Bricks製小部屋
- **Nether Brick Fence（金属格子）**: 部屋の中心近くにスポナーがある
- **部屋へのアクセス**: 要塞のメイン通路・橋から側室として続く
- **スポナー数**: 要塞1つに通常2個（まれに3個以上）
- **Y座標**: 要塞本体と同じ高さ（通常Y=40-80）

### 見つけ方の手順（確実な方法）
```js
// 1. 要塞内部に入る
await bot.navigate("nether_bricks");
// 2. nether_brick_fence を探す（スポナー部屋の壁にのみ使われる）
await bot.navigate("nether_brick_fence");
// 3. スポナーを直接探す
await bot.navigate("mob_spawner");
// 4. または bot.status() の threats で "blaze" を確認
const s = await bot.status();
bot.log("Threats: " + JSON.stringify(s.threats));
```

### ブレイズ戦闘戦略（装備あり）
```js
// 推奨HP: 20（フル）+ 食料 + 鉄防具以上
await bot.combat("blaze"); // flee_at_hp=8がデフォルト
// 1回の戦闘で2-3本のブレイズロッドを目標
```
- ブレイズは距離があると火の玉、近接だと殴り攻撃
- **最適戦法**: 石/ネザーレンガで火の玉をブロックしながら近づいて近接攻撃

### ブレイズ戦闘（装備なし・食料なし時のリスク管理）
- フル装備がない場合は戦闘しない
- 最低限: 食料16個 + 鉄チェストプレートまたはヘルメット

### 必要アイテム確認
- 食料 x16以上（HP回復用）
- **金防具フルセット推奨**（gold_ingot x24）
  - ネザーでgold armorを着るとピグリンに攻撃されない
  - equipArmor()は自動的にネザーでgold priorityに切り替える（コード実装済み）
```js
await bot.craft("gold_helmet");
await bot.craft("gold_chestplate");
await bot.craft("gold_leggings");
await bot.craft("gold_boots");
```
- 鉄の剣以上、丸石128（安全な足場・壁用）、弓 + 矢（あれば）

### スポナー部屋での立ち回り
1. 入口に丸石で壁を作り逃げ場を確保
2. ブレイズが1-2体の時に攻撃
3. スポナーを破壊しない（農場として使えるため）
4. HP < 10 になったら即退避して食料で回復
