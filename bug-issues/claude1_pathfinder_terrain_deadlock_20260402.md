## Bug Report: Claude1 Pathfinder Terrain Deadlock - 2026-04-02

### Summary
During Phase 2 farmland expansion, Claude1 became stuck in terrain at coordinates (1, 67, 0) and cannot navigate away. Both `pathfinderGoto()` and `multiStagePathfind()` timeout consistently.

### Incident Details

**Time**: 2026-04-02 (session 2)
**Location**: (1, 67, 0) - appears to be rough underground terrain
**Phase**: Phase 2 (farmland expansion)
**Activity**: Planting wheat seeds on scattered farmland blocks (Y range: 49-104)

### What Happened

1. Claude1 successfully navigated to multiple farmland locations at varying elevations (Y=92, Y=100, Y=101, Y=102, Y=96, Y=104, Y=69)
2. Planted wheat seeds on 22+ farmland blocks across spread-out coordinates
3. After final planting operation at (1, 67, 0), bot became unable to navigate away
4. Attempted returns to base (4, 92, 6):
   - `pathfinderGoto(GoalNear(4, 92, 6, 3))`: TIMEOUT after 30s
   - `multiStagePathfind(4, 6, 10, 92)`: TIMEOUT after 20s
5. Position hasn't changed for consecutive pathfinder calls

### Root Cause Analysis

**Suspected**: Terrain complexity/caves in the area (Y=67 is deep underground)
- findBlocks searches revealed farmland scattered at Y=49, Y=67, Y=69 (mining pit area)
- Area may contain caves, void spaces, or impassable terrain
- Pathfinder unable to compute route from enclosure

**Evidence**:
- Bot CAN navigate short distances to individual farmland blocks within ~8 blocks
- Bot CANNOT navigate longer distances or exit the area
- Position locked at (1, 67, 0) despite multiple pathfind attempts
- Y-level at 67 is known for cave systems

### Impact

**Severity**: MODERATE
- **Gameplay blocked**: Claude1 immobilized but alive (HP 20/20, Food 11/20)
- **Progress saved**: Farm expansion 68% complete (22 wheat / 32 farmland)
- **Inventory**: 52 wheat_seeds, 24 bread, full diamond equipment
- **Requires**: Manual recovery or code fix for pathfinder edge case

### Workarounds Attempted

1. ✓ `pillarUp(6)` — Successfully moved Y from 60 to 61, but still stuck
2. ✗ `pathfinderGoto(GoalNear(...))` — Timeout
3. ✗ `multiStagePathfind()` — Timeout
4. ✗ `descendSafely(50)` — Not yet confirmed (background task in progress)

### Related Code/Files

- `src/tools/mc-execute.ts`: pathfinderGoto() implementation (lines 138-250+)
- `src/bot-manager/pathfinder.ts`: Movements configuration
- `.claude/rules/mc-execute-api.md`: pathfinder stuck detection (grace period logic)

### Environment

- **Daemon**: Running (mc_execute responsive)
- **Bot**: Connected and responsive to commands
- **Terrain**: Scattered farmland across multiple Y levels suggests farm locations are in/near mining area
- **Map**: Base at (4, 92, 6), farmland cluster extends to coordinates like (38, 95, 0), (2, 71, 3), (9, 67, 6)

### Reproduction Steps

1. Create scattered farmland blocks at multiple Y levels (Y=49, 67, 69, 92, 94, 96, 100, 101, 102, 104)
2. Use plantSeeds helper to navigate to each block location
3. After reaching block at (1, 67, 0):
   ```
   await pathfinderGoto(new goals.GoalNear(4, 92, 6, 3), 30000);
   // → times out
   ```

### Questions for Code Reviewer

1. Is `pathfinderGoto()` grace period (10-15 seconds) sufficient for deep caves?
2. Should stuck detection threshold account for Y-level depth?
3. Are there known limitations with Movements configuration for underground terrain?
4. Should canDig be set to true by default for deep terrain escape?

### Next Steps

1. **Short term**: Manual `descendSafely()` or pillar navigation to higher ground
2. **Debug**: Check Movements configuration for underground pathfinding
3. **Fix**: Improve stuck detection or retry logic for complex terrain
4. **Verify**: Test pathfinder with scattered target locations at mixed Y levels

---

**Status**: IN PROGRESS - Awaiting code review and pathfinder fix
**Severity**: MODERATE (gameplay blocked, survival not threatened)
**Reporter**: Claude1 Agent
**Next Action**: Code reviewer investigate pathfinder timeout patterns
