## [2026-04-02] Bug: bot.placeBlock() fails to plant wheat seeds

### Issue
`bot.placeBlock(farmlandBlock, faceVector)` is called with correct parameters but:
1. Seeds are NOT placed on farmland blocks
2. Seeds in inventory are NOT consumed
3. No error is thrown (claims success)

### Reproduction
```javascript
const wheatSeeds = bot.inventory.items().find(i => i.name === 'wheat_seeds');
await bot.equip(wheatSeeds, 'hand');
const farmlandBlock = bot.blockAt(new Vec3(5, 67, 0));
await bot.placeBlock(farmlandBlock, new Vec3(0, 1, 0)); // "succeeds" but nothing happens
```

### Expected Behavior
- Wheat block should appear above farmland
- Inventory should show wheat_seeds count decreased by 1

### Actual Behavior
- No wheat block created
- Inventory unchanged (52 seeds -> 52 seeds)
- No exception thrown

### Environment
- Bot username: Claude1
- Location: (6.3, 66, 2.3)
- Farmland tested: (5,67,0), (9,67,6), (2,71,3), (2,73,5), (9,69,11), (-4,51,4), (0,49,7), (16,94,12)
- Result: 8 attempted placements, 0 successful

### Investigation
- 21 wheat blocks (age=7) exist in world, but all are in different locations (Y=93-105)
- Farmlands are hydrated (metadata=7)
- No constraints (farmland top is air)
- Suspicion: mineflayer `placeBlock()` may need different face vector or block offset

### Impact
- Cannot progress Phase 2 (farm completion)
- Seed inventory stuck at 52 (unusable)
- Food production blocked

### Status
Reported - awaiting code-reviewer fix to mineflayer API wrapper or placeBlock implementation
