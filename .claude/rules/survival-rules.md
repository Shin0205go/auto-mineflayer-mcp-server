---
paths:
  - "src/tools/mc-execute.ts"
---

# Survival Rules - 生き残り戦略

自動実行する最優先の安全チェック。破ると即死亡 = バグ扱い。

## HP 管理（最優先）

### ルール
- **HP < 10 で戦闘禁止** → 逃げろ、隠れろ
- 敵が近くにいて HP < 5 → pillor up して上から見守る
- HP = 0 → 死亡（全てバグ）

### 実装パターン
```js
// 戦闘前チェック
if (bot.health < 10) {
  log('HP low (' + bot.health + '), fleeing...');
  // pathfinder で遠距離に移動、または pillor up
  return;
}

// 敵接近時の判定
const danger = bot.nearestEntity(e => e.type === 'mob');
if (danger && danger.position.distanceTo(bot.entity.position) < 8 && bot.health < 12) {
  log('Danger + low HP, pillar up');
  // pillar up 実装 (参考: .claude/skills/survival/SKILL.md)
  return;
}
```

## 食料管理（常時）

### ルール
- **Food < 5 → 遠征禁止** (飢餓になる前)
- Food < 12 → 周辺で食料探索・狩り
- Food ≥ 16 → 安全
- 食料なし → リスポーン禁止、代わりに牛/豚を探して狩る

### 実装パターン
```js
// 遠征前チェック
if (bot.food < 5) {
  log('Food critical (' + bot.food + '), gathering food');
  // 周辺で牛/豚を探す、または種で畑確保
  return;
}

// Auto-eat
if (bot.food < 12 && bot.health > 10) {
  const food = bot.inventory.items().find(i =>
    ['bread','cooked_beef','cooked_chicken'].includes(i.name)
  );
  if (food) {
    await bot.equip(food, 'hand');
    await bot.consume();
    log('Ate ' + food.name);
  }
}
```

## 夜間対策（Phase 1-3）

### ルール
- **夜間 (tick 13000-23000) → 防具なしで長距離移動禁止**
- Shelter に隠れるか、pillar up して天明を待つ
- 昼間 (6000-12000) → 安全に遠征可能
- 日没 (12000-13000) → Shelter 帰還開始

### ゲーム時間の確認
```js
const tick = bot.time.timeOfDay;  // 0-23999
if (tick >= 13000 && tick < 23000) {
  // 夜間
  const hasArmor = bot.inventory.slots[5] || bot.inventory.slots[6];
  if (!hasArmor) {
    log('Night + no armor, sheltering');
    // Shelter に移動、または pillar up
    return;
  }
}
```

## 飢餓スパイラル防止

### 危険パターン
1. Food が徐々に減少
2. Agent が低 Food で遠征 → さらに減少
3. Pillor up ループで飢餓状態に → 死亡

### 対策
```js
// フェーズごとに最低食料ストック設定
const MIN_FOOD_STOCK = 20;  // Phase 1-2: チェストに常に 20個以上
const targetFood = bot.inventory.items().filter(i =>
  ['bread','cooked_beef','cooked_porkchop','cooked_chicken'].includes(i.name)
).reduce((s, i) => s + i.count, 0);

if (targetFood < MIN_FOOD_STOCK) {
  log('Food stock low (' + targetFood + '), farming...');
  // 食料生産タスク優先実行
  return;
}
```

## 夜間 Pillor Up 実装

```js
async function pillarUp(height = 5) {
  const block = bot.registry.blocksByName['dirt'];
  for (let i = 0; i < height; i++) {
    const placed = await bot.placeBlock(
      bot.blockAt(bot.entity.position.offset(0, 1, 0)),
      new Vec3(0, 1, 0)
    );
    if (!placed) break;
    await wait(200);
  }
  log('Pillar up ' + height + ' blocks');
}
```

## チェックリスト（毎アクション）

実行前に確認:

```
□ bot.health >= 5 ? (< 5 = 死亡リスク)
□ bot.food >= 3 ? (< 3 = 飢餓リスク)
□ 夜間 (13000-23000) で防具なし移動していないか？
□ 飢餓状態の遠征計画していないか？
□ リスポーンで HP 回復する計画していないか？

全て ✓ なら安全に行動可能
```

---
詳細: `.claude/rules/death-prevention.md` — 死亡防止チェックリスト
