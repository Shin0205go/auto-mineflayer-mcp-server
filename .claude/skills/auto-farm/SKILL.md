---
name: auto-farm
phase: 2
priority: high
duration: 1-2 hours
dependencies:
  - survival
  - resource-gathering
description: 食料農場の建設・運用（小麦・ニンジン・ジャガイモ）
---

## 目標

Phase 2: チェストに食料 20個以上を確保。飢餓スパイラルを防ぐ。

## 前提条件

- 鍬 (hoe) がインベントリにある: `stone_hoe` 以上
- 種 (`wheat_seeds`) または `carrot` / `potato` がある
- 水源近くに土 (dirt) または 草 (grass_block) がある

## ステップ

### 1. 農地の確保

水から4ブロック以内の土/草ブロックを鍬で耕す。

```js
// 鍬で土を耕す = bot.dig() で farmland に変換される
// または bot.activateBlock(dirtBlock) while holding hoe
const hoe = bot.inventory.items().find(i => i.name.includes('hoe'));
if (hoe) {
  await bot.equip(hoe, 'hand');
  const dirtBlock = bot.findBlock({
    matching: [
      bot.registry.blocksByName['dirt'].id,
      bot.registry.blocksByName['grass_block'].id
    ],
    maxDistance: 5
  });
  if (dirtBlock) {
    await bot.activateBlock(dirtBlock);  // 右クリックで farmland に変換
  }
}
```

### 2. 種植え (重要: 正しいAPIを使うこと)

**NG (存在しないAPI):**
- `bot.place()` → not a function
- `bot.interact()` → 存在しない
- `bot.activate()` → 存在しない

**OK (正しいAPI):**
```js
// plantSeeds() ヘルパー (推奨 — sandbox に注入済み)
const farmlandId = bot.registry.blocksByName['farmland'].id;
const farmlands = bot.findBlocks({ matching: farmlandId, maxDistance: 8, count: 20 });

for (const pos of farmlands) {
  const farmlandBlock = bot.blockAt(pos);
  const above = bot.blockAt(pos.offset(0, 1, 0));
  if (!farmlandBlock || !above || above.name !== 'air') continue;

  // 農地に近づく
  await pathfinderGoto(new goals.GoalNear(pos.x, pos.y, pos.z, 2), 10000);

  // 種を植える
  try {
    await plantSeeds(farmlandBlock, 'wheat_seeds');
    log('Planted at ' + JSON.stringify(pos));
  } catch (e) {
    log('Plant failed: ' + e.message);
  }
}

// または直接 bot.placeBlock() を使う
const seedItem = bot.inventory.items().find(i => i.name === 'wheat_seeds');
if (seedItem) {
  await bot.equip(seedItem, 'hand');
  await bot.placeBlock(farmlandBlock, new Vec3(0, 1, 0));
  // Vec3(0,1,0) = 上面に設置 = farmland の上に種を置く
}
```

### 3. 収穫

完熟した小麦 (成長段階7 = metadata 7) を収穫。

```js
const wheatId = bot.registry.blocksByName['wheat'].id;
const wheatBlocks = bot.findBlocks({ matching: wheatId, maxDistance: 10, count: 20 });

for (const pos of wheatBlocks) {
  const block = bot.blockAt(pos);
  if (!block) continue;

  // metadata === 7 が完熟 (0-7の8段階)
  if (block.metadata < 7) {
    log('Not ripe yet at ' + JSON.stringify(pos) + ' (stage ' + block.metadata + ')');
    continue;
  }

  await pathfinderGoto(new goals.GoalNear(pos.x, pos.y, pos.z, 2), 10000);
  await bot.dig(block);
  await collectDrops();
}
```

### 4. かまどで食料調理 (smeltItems ヘルパー推奨)

**重要: `bot.openContainer()` は furnace で使えない。必ず `bot.openFurnace()` または `smeltItems()` を使う。**

```js
// NG: await bot.openContainer(furnaceBlock)
// → Error: "containerToOpen is neither a block nor an entity"
// furnace は chest.js の openContainer() がサポートする windowType に含まれていないため

// OK: smeltItems() ヘルパー
const furnaceId = bot.registry.blocksByName['furnace'].id;
const furnaceBlock = bot.findBlock({ matching: furnaceId, maxDistance: 6 });
if (!furnaceBlock) {
  log('No furnace nearby — place one first');
} else {
  // furnace の近くに移動
  await pathfinderGoto(
    new goals.GoalNear(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2),
    15000
  );

  // 位置確認 (pathfinder false success 対策)
  const pos = bot.entity.position;
  const dist = pos.distanceTo(furnaceBlock.position);
  log('Distance to furnace: ' + dist.toFixed(1));
  if (dist > 5) throw new Error('Failed to reach furnace');

  // 精錬
  const result = await smeltItems(furnaceBlock, 'raw_iron', 'coal', 3);
  log('Result: ' + JSON.stringify(result));
}

// OK: bot.openFurnace() を直接使う場合
const fw = await bot.openFurnace(furnaceBlock);
try {
  const coalId = bot.registry.itemsByName['coal'].id;
  const rawIronId = bot.registry.itemsByName['raw_iron'].id;
  await fw.putFuel(coalId, null, 4);
  await fw.putInput(rawIronId, null, 3);
  await wait(35000);  // 3アイテム × ~10秒
  const out = fw.outputItem();
  if (out) await fw.takeOutput();
  log('Got: ' + (out?.count ?? 0) + ' iron_ingot');
} finally {
  fw.close();
}
```

## Pathfinder False Success 対策

`GoalNear(x,y,z,range)` で range が大きすぎると、目標から離れた位置で「成功」と判定される。特にY方向の距離を無視してしまうケースがある。

```js
// 移動後に必ず位置確認する
await pathfinderGoto(new goals.GoalNear(tx, ty, tz, 2), 20000);
const pos = bot.entity.position;
const dist = pos.distanceTo(new Vec3(tx, ty, tz));
log('Actual distance: ' + dist.toFixed(1));
if (dist > 4) {
  log('WARNING: pathfinder false success — still ' + dist.toFixed(1) + ' blocks away');
  // GoalBlock で再試行
  try {
    await pathfinderGoto(new goals.GoalBlock(tx, ty, tz), 20000);
  } catch (e) {
    log('GoalBlock also failed: ' + e.message);
  }
}
```

## 骨粉で即時成長

```js
const boneId = bot.registry.itemsByName['bone_meal'].id;
const boneMeal = bot.inventory.items().find(i => i.name === 'bone_meal');
if (boneMeal) {
  await bot.equip(boneMeal, 'hand');
  // 農作物ブロックを右クリック
  await bot.activateBlock(cropBlock);
}
```

## 成長時間目安

- 小麦/ニンジン/ジャガイモ: 20-30分 (ランダム性あり)
- サトウキビ: 16分/段
- 骨粉で即時成長可能

## Phase 2 目標

- [ ] 農地 10ブロック以上確保
- [ ] 全農地に種を植える
- [ ] 収穫 → チェストに食料 20個以上
- [ ] 鉄3個確保 (バケツ用) → かまどで raw_iron 精錬
