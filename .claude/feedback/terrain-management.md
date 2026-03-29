# Feedback: Terrain Management

**Type:** Design Pattern
**Date:** 2026-03-20+
**Status:** Active (enforced)

## Rule

**掘った穴は埋め戻せ。整地しながら作業しないと pathfinder が通らなくなる。**

## Context

- Pathfinder relies on valid block geometry
- Unexplained holes break navigation
- Collapsed mines create unreachable areas
- Base周辺は特に整地必須

## Implementation

### Mining Pattern
```js
// During mining:
const minedBlocks = [];

// While gathering ore:
const block = bot.findBlock({matching: ore_id, maxDistance: 32});
await bot.dig(block);
minedBlocks.push(block.position);

// After done or when leaving:
for (const pos of minedBlocks) {
  const blockBelow = bot.blockAt(pos.offset(0, -1, 0));
  if (blockBelow && blockBelow.name !== 'air') {
    // Place dirt or cobblestone
    await bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
  }
}
log('Filled ' + minedBlocks.length + ' holes');
```

### Base Perimeter
```js
// Check area around base for holes
const baseRadius = 32;
const basePos = /* home position */;
const holes = [];

for (let x = -baseRadius; x <= baseRadius; x++) {
  for (let z = -baseRadius; z <= baseRadius; z++) {
    for (let y = 0; y < 120; y++) {
      const block = bot.blockAt(basePos.offset(x, y, z));
      if (block && block.name === 'air') {
        const below = bot.blockAt(basePos.offset(x, y-1, z));
        if (below && below.name !== 'air' && below.name !== 'water' && below.name !== 'lava') {
          holes.push(basePos.offset(x, y-1, z));
        }
      }
    }
  }
}

// Fill holes
for (const hole of holes) {
  await bot.placeBlock(bot.blockAt(hole), new Vec3(0, 1, 0));
}
```

## Monitoring

Code reviewer checks:
- [ ] Mining operations include backfill
- [ ] Base perimeter is clean (no holes)
- [ ] Pathfinder success rate > 90%
- [ ] No "cannot find path" errors

## Common Failures

### Failure 1: Cave Mining Without Backfill
```
Symptom: "pathfinder timeout, cannot find path to wood"
Cause: Mined cave blocked return path
Fix: Fill cave floors while mining
```

### Failure 2: Strip Mining Mess
```
Symptom: "bot stuck at (100, 60, 200), can't navigate"
Cause: Strip mining left 1-block gaps
Fix: Systematic grid mining with immediate backfill
```

### Failure 3: Base Degradation
```
Symptom: "bot wandering randomly instead of going to chest"
Cause: Holes near base confuse pathfinder
Fix: Maintain clean perimeter
```

## Links

- `.claude/rules/phase-guide.md` — Mining techniques
- `.claude/rules/survival-rules.md`
