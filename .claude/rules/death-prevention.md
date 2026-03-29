---
paths:
  - "src/tools/mc-execute.ts"
  - "bug-issues/"
---

# Death Prevention Checklist

死亡 = 全てバグ扱い。以下のチェックリストを毎アクション確認。

## Pre-Action Validation

実行する前に:

### 1. HP Safety (絶対条件)
```
□ bot.health > 0  ?  (当たり前)
□ bot.health > 5  ?  (< 5 = 危険)
□ bot.health > 10 ?  (< 10 = 戦闘禁止)
```

**失敗:** HP が 5 以下 → 即座に食料を食べるか、敵から逃げる

### 2. Food Safety (絶対条件)
```
□ bot.food >= 1   ?  (飢餓状態)
□ bot.food >= 5   ?  (遠征禁止)
□ bot.food >= 12  ?  (安全 - 自動回復可能)
```

**失敗:** Food が 5 以下 → 周辺で食料探索・狩り

### 3. Night Safety (Armor がない場合)
```
時刻 = bot.time.timeOfDay

□ 6000-12000 (昼間)       ?  安全 - 遠征可能
□ 12000-13000 (日没)      ?  要注意 - Shelter へ
□ 13000-23000 (夜間-明け方)  ?  防具なし移動禁止
□ 23000-6000 (深夜-明け方)   ?  Shelter または pillar up

防具がない場合の判定:
const hasArmor = !!(
  bot.inventory.slots[5] ||  // helmet
  bot.inventory.slots[6] ||  // chestplate
  bot.inventory.slots[7] ||  // leggings
  bot.inventory.slots[8]     // boots
);
```

**失敗:** 夜間で防具なし + 長距離移動 → Shelter に帰還または pillar up

### 4. Threat Assessment (戦闘判定)
```
const threats = bot.entities
  .filter(e => e.type === 'mob' && e.position.distanceTo(bot.entity.position) < 16);

□ 敵なし？  → 安全
□ 敵あり + bot.health > 12 + armor ? → 戦闘可能 (かつ sword 所持)
□ 敵あり + bot.health < 12 ? → 逃げろ
```

**失敗:** HP が低いのに敵に接近 → pathfinder で距離を取る

### 5. Resource Check (遠征前)
```
□ 移動距離が長い（> 64 blocks) ?
  → 食料ストック確認
  → 懐中電灯/松明所持？
```

## Common Death Patterns

### Pattern 1: 敵接近 + 低 HP
```
症状: "Skeleton shot me, HP = 3, trying to attack back"
原因: 低 HP で戦闘していた
対策:
  if (bot.health < 10) { /* flee instead of attack */ }
```

### Pattern 2: 夜間に外出
```
症状: "Night, no armor, Creeper explosion, dead"
原因: 夜間で防具なし移動
対策:
  const isNight = bot.time.timeOfDay >= 13000 && bot.time.timeOfDay < 23000;
  if (isNight && !hasArmor) { /* shelter or pillar */ }
```

### Pattern 3: 飢餓による自動ダメージ
```
症状: "Food = 0, got hungry damage, dead"
原因: 遠征中に食料が尽きた
対策:
  if (bot.food < 5) { /* return to base before hunger hits */ }
```

### Pattern 4: 溺死
```
症状: "Fell into water, can't climb out, drowned"
原因: 水に落ちた、または pathfinder がセンサーを誤認識
対策:
  // 水での動き:
  const inWater = bot.isInWater;
  if (inWater) {
    await bot.setControlState('jump', true);
    await bot.setControlState('forward', true);
    await wait(100);
  }
```

### Pattern 5: Fall Damage
```
症状: "High ground (Y=100), fell 50 blocks, dead"
原因: 高地での pathfinder ミス
対策:
  // 建設物の近くは slow 移動
  if (bot.entity.position.y > 80) {
    movements.canDig = false;
    movements.allowSprinting = false;
  }
```

## Death Report Template

死亡が発生したら `bug-issues/botN.md` に:

```markdown
# Death Report - [Bot Name] [Date]

## Summary
Bot が死亡。[1行で原因]

## When
Time: [ゲーム時刻 tick]
Phase: [Phase N]

## Where
Position: (X, Y, Z)
Biome: [バイオーム]
Environment: [屋内/屋外/水中 など]

## Why (Death Cause)
- HP at death: [値]
- Food at death: [値]
- Last action: [最後に実行した操作]
- Nearby threats: [敵/環境 hazard]

## Pre-action State
- bot.health: [値]
- bot.food: [値]
- bot.inventory: [装備/食料]
- Equipment: [armor slots]

## What Should Have Happened
[死亡を防ぐために何をすべきだったか]

## Fix
[コード修正案 or ロジック改善案]
```

例:
```markdown
# Death Report - Claude1 2026-03-29

## Summary
スケルトン射撃で HP = 2 → 死亡。HP チェック失敗。

## When
Time: 14500 tick (夜間)
Phase: Phase 1

## Where
Position: (102, 64, 215)

## Why
- HP at death: 2
- Food at death: 8
- Last action: Zombie に攻撃
- Nearby: Skeleton (15 blocks) → 射撃受けた

## Pre-action State
- bot.health: 8 (危険水準)
- bot.food: 8
- bot.inventory: 石斧、食料x5
- Equipment: なし

## What Should Have Happened
HP < 10 で戦闘禁止。Skeleton 検出時点で逃げるべき。

## Fix
```js
// 戦闘開始前にチェック
if (bot.health < 10) return;  // 逃げる
const threats = bot.nearestEntity(e => e.type === 'mob');
if (threats && threats.position.distanceTo(bot.entity.position) < 20) {
  // 敵が近い → 戦闘回避
  return;
}
```
```

## Reference

- `.claude/rules/survival-rules.md` — 詳細ルール
- `.claude/skills/survival/SKILL.md` — Survival スキル詳細
- `bug-issues/` — 過去の死亡事例
