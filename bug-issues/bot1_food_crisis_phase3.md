# [2026-04-02] Bug: Food Zero Crisis - Mining Impossible

## Cause
- After daemon restart + queue clear, Claude1 spawned with food=18 (awareness showed 18/20)
- But actual inventory food count = 0 (no bread, meat, etc.)
- Mismatch between reported food stat (18) and actual items (0)
- ChestAt(9,96,4) failed to open: `windowOpen did not fire within timeout 20000ms`

## Coordinates
- Spawn: (26, 102, -3)
- Chest location: (9, 96, 4)
- Current: (9, 97, 5) — near chest

## Last Actions
1. `awareness()` → Reported food: 18/20, but actually 0 items
2. Moved to crafting_table location(27, 99, 4) → pathfinder stuck (position unchanged 10s)
3. Moved to chest(9, 96, 4) → reached location
4. Tried `bot.activateBlock(chest)` → got "チェスト開始" log but bot.container undefined
5. Tried `bot.openContainer(chestBlock)` → windowOpen timeout after 20s

## Error Messages
```
Error: Cannot read properties of undefined (reading 'items')
Error: Event windowOpen did not fire within timeout of 20000ms
```

## Impact
- Food = 0, cannot mine/explore
- Mining Phase 3 blocked
- Chest UI broken (windowOpen event stuck)
- No nearby mobs to hunt
- Agent is soft-locked

## Status
- Reported to team chat
- Admin intervention needed
- Possible causes:
  - Chest is bugged (double-locked or corrupted NBT)
  - windowOpen event handler not registered
  - Container sync issue after daemon restart
  - Food stat reporting bug (awareness says 18 but actually 0)

## Recommendation
- Check server-side chest state
- Verify food item existence in actual inventory
- Restart single bot or full server if needed
