# terrain-management スキル

採掘後の穴埋めと平地化。pathfinderが通れなくなるのを防ぐ。

---

## 1. 穴埋め（採掘後）

採掘した穴や通路の跡をcobblestone/dirtで埋め戻す。

```javascript
// BOT_USERNAME=Claude1 node scripts/mc-execute.cjs "<code>"

// 足元半径2ブロックのair穴を埋める
const pos = bot.entity.position.floored();
const filler = bot.inventory.items().find(i =>
  ['cobblestone', 'dirt', 'gravel', 'stone'].includes(i.name)
);
if (!filler) { log('埋め戻し素材なし'); return 'no filler'; }

await bot.equip(filler, 'hand');
let filled = 0;
for (let dx = -2; dx <= 2; dx++) {
  for (let dz = -2; dz <= 2; dz++) {
    for (let dy = -1; dy >= -4; dy--) {
      const target = pos.offset(dx, dy, dz);
      const block = bot.blockAt(target);
      if (!block || block.name !== 'air') break; // 空気でなければ下は不要
      const below = bot.blockAt(target.offset(0, -1, 0));
      if (below && below.name !== 'air') {
        try {
          await bot.placeBlock(below, new Vec3(0, 1, 0));
          filled++;
        } catch (e) { /* 届かない or 邪魔 */ }
      }
    }
  }
}
log(`穴埋め完了: ${filled}ブロック`);
return `filled ${filled}`;
```

**ポイント:**
- 優先順位: cobblestone > dirt > gravel > stone
- 素材が0になったら中断（bot.inventory.items()で再チェック）
- 採掘ループの末尾に毎回挟む

---

## 2. 平地化（範囲指定）

指定Yレベルより高いブロックを削り、低い箇所をdirtで埋める。

```javascript
// 拠点周辺 radius=8, targetY=現在のY を平地化

const centerX = Math.floor(bot.entity.position.x);
const centerZ = Math.floor(bot.entity.position.z);
const targetY = Math.floor(bot.entity.position.y); // 平地にするY
const radius = 8;

const movements = new Movements(bot);
movements.canDig = true;
bot.pathfinder.setMovements(movements);

// Step 1: targetYより上を削る
let dug = 0;
for (let dx = -radius; dx <= radius; dx++) {
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dy = 1; dy <= 5; dy++) {
      const block = bot.blockAt(new Vec3(centerX + dx, targetY + dy, centerZ + dz));
      if (!block || block.name === 'air' || block.name === 'cave_air') continue;
      // 木・葉・土・石のみ掘る（鉱石は掘らない）
      const diggable = ['dirt','grass_block','stone','cobblestone','gravel','sand',
        'oak_log','birch_log','spruce_log','oak_leaves','birch_leaves','spruce_leaves'];
      if (!diggable.includes(block.name)) continue;
      try {
        await bot.pathfinder.goto(new goals.GoalNear(centerX + dx, targetY + dy, centerZ + dz, 3));
        await bot.dig(block);
        dug++;
      } catch (e) { /* 届かない */ }
    }
  }
}

// Step 2: targetYより下のair穴をdirtで埋める
const dirt = bot.inventory.items().find(i => i.name === 'dirt');
let filled2 = 0;
if (dirt) {
  await bot.equip(dirt, 'hand');
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const block = bot.blockAt(new Vec3(centerX + dx, targetY, centerZ + dz));
      if (block && block.name === 'air') {
        const below = bot.blockAt(new Vec3(centerX + dx, targetY - 1, centerZ + dz));
        if (below && below.name !== 'air') {
          try {
            await bot.placeBlock(below, new Vec3(0, 1, 0));
            filled2++;
          } catch (e) {}
        }
      }
    }
  }
}

log(`平地化完了: 掘削${dug}ブロック, 埋め${filled2}ブロック`);
return `leveled: dug=${dug} filled=${filled2}`;
```

---

## 3. 採掘ループへの組み込みパターン

```javascript
// 採掘後に必ず穴埋めを挟む
async function digAndFill(block) {
  await bot.dig(block);
  // 足元チェック
  const underFeet = bot.blockAt(bot.entity.position.offset(0, -1, 0));
  if (underFeet && underFeet.name === 'air') {
    const filler = bot.inventory.items().find(i =>
      ['cobblestone','dirt'].includes(i.name)
    );
    if (filler) {
      await bot.equip(filler, 'hand');
      const twoBelow = bot.blockAt(bot.entity.position.offset(0, -2, 0));
      if (twoBelow && twoBelow.name !== 'air') {
        await bot.placeBlock(twoBelow, new Vec3(0, 1, 0));
      }
    }
  }
}
```

---

## 注意事項

- **鉱石は平地化でも掘らない** — 平地化対象に `iron_ore`, `coal_ore` 等を含めると資源ロスになる
- **大きなradiusは時間がかかる** — radius=8 で最大 16×16×5 = 1280ブロック。`MC_TIMEOUT=300000` を使う
- **素材不足に注意** — 埋め戻し用dirtはコンポスターや整地で大量確保できる
- **pathfinderと干渉しない** — 穴埋め後は `movements.canDig = false` に戻す
