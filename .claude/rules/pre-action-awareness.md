---
paths:
  - "src/tools/mc-execute.ts"
  - "src/bot-manager/bot-info.ts"
---

# Pre-Action Awareness — 観察 → 理解 → 行動

Claude Code が Glob → Read → Edit するように、ボットも **観察 → 理解 → 行動** の順序を守る。

## 原則

**行動前に必ず `awareness()` を呼べ。**

```js
// ❌ 悪い例: いきなり行動
await bot.pathfinder.goto(new goals.GoalXZ(100, 200));

// ✅ 良い例: 観察 → 判断 → 行動
const state = awareness();
log(state);
// stateを見てからHP, 食料, 脅威, 足元を判断
// 安全なら行動開始
```

## 注入済みヘルパー (mc_execute 内で使用可能)

### `awareness()`

自己状態 + 空間スナップショットを1回で返す。

**返す情報:**
- 🚨 警告 (HP危険、空腹、酸素不足)
- 生存ステータス (HP, 空腹度, 食料数, 松明, 足場ブロック)
- 装備 (防具, 手持ち)
- 現在地 (座標, バイオーム, 時刻, 地形タイプ, 光レベル)
- 移動可能方向 (歩ける方向 / 壁 / 足元 / 頭上)
- ⚠️ 危険 (落下, 溶岩, 敵モブ)
- 動物・村人 (周囲20ブロック)
- 近くの資源 (鉱石, 木, 設備, 座標付き)

**使い方:**
```js
const state = awareness();
log(state);

// 判断してから行動
if (state.includes("HP危険")) {
  // 食べるか逃げる
} else if (state.includes("敵:")) {
  // 戦うか避ける
} else {
  // 目標に向けて行動
}
```

### `scanTerrain(radius?)`

地形高さマップ。整地・建築前の地形分析用。

**返す情報:**
- 2Dグリッドの高さマップ (各X,Zの最上面ブロックY)
- 平均Y, 最低Y, 最高Y, 高低差
- 整地に必要な掘る/埋めるブロック数

**使い方:**
```js
// 整地前に地形を把握
const terrain = scanTerrain(8);  // 半径8ブロック
log(terrain);

// 出力例:
// ## 地形スキャン (17x17, 中心: 100,64,200)
// 平均Y: 64, 最低: 62, 最高: 67, 高低差: 5
// 高さマップ (数字 = Y - 64, . = 平坦, + = 高い, - = 低い):
//     -8  -4   0   4   8
//  -8  . .  1 . .  2 . .  . . .  . . .  . . .
//  -4  . .  . . .  . . 1  . . .  . . .  . . .
//   0  . .  . . .  . . .  . 1 .  . . .  . . .
// 整地 (Y=64に平坦化): 掘る12ブロック, 埋める8ブロック
```

## いつ呼ぶか

| シーン | 呼ぶもの | 理由 |
|--------|---------|------|
| 移動前 | `awareness()` | 足元空洞・敵・溶岩チェック |
| 採掘前 | `awareness()` | HP/食料/装備確認 |
| 戦闘前 | `awareness()` | HP/装備/逃走経路確認 |
| 整地前 | `scanTerrain(radius)` | 差分計算してから掘る/埋める |
| 建築前 | `scanTerrain(radius)` | 基礎の平坦度確認 |
| 迷ったとき | `awareness()` | 現状把握からやり直す |

## アンチパターン

```js
// ❌ awareness()の結果を無視する
awareness(); // 呼ぶだけで読まない
await bot.pathfinder.goto(...);

// ❌ 大量スキャンでラグ
scanTerrain(64); // 重すぎる。最大16で十分

// ✅ 結果をlogして判断材料にする
const state = awareness();
log(state);
// HPが十分 → 行動
// HPが低い → 食べてから行動
```
