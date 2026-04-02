## [2026-04-02] Bug: Pathfinder Goal Change Error during farmland seeding

**Status**: Reported

**Cause**:
- pathfinderGoto() repeatedly fails with "The goal was changed before it could be completed!" during farmland navigation in Phase 2
- Issue occurs in loop trying to plant wheat_seeds on multiple farmland blocks
- AutoSafety may be triggering goal cancellation due to safety checks

**Environment**:
- Phase 1-2 active, HP=16.8, Food=17
- Crafting Table at (-2,104,2), Furnace at (2,108,15)
- 20 farmland blocks found, 6 with open space above
- wheat_seeds: 10 remaining (started with 64)

**Coordinates**:
- Farmland targets: (4,92,10), (14,93,9), (16,94,12), (15,104,11), (11,102,17), (15,104,12)
- Current position: (5,90,6)

**Last Actions**:
1. Tilled 3 dirt blocks → farmland (SUCCESS)
2. Attempted to plant seeds on 6+ farmland blocks (ALL FAILED with goal change error)
3. Tried pathfinderGoto with GoalNear, GoalBlock, multiStagePathfind
4. All pathfinder calls cancelled mid-execution

**Error Message**:
```
The goal was changed before it could be completed!
plantSeeds: too far from farmland (7.5 blocks). Navigate closer first.
```

**Impact**:
- Cannot plant seeds on farmland
- Phase 2 (farm building) blocked
- wheat_seeds inventory accumulating (should be deployed)

**Hypothesis**:
- AutoSafety loop is calling `setGoal()` during execution, interrupting bot.pathfinder.goto()
- Possible: safetyState.updateGoal() or pathfinder reset triggered by threat detection
- Workaround needed: Use navigation-free planting (pre-position near farmland, then plant locally)

**Next Steps**:
- Code reviewer: Check src/bot-manager/auto-safety.ts for goal interference
- Agent: Switch to hunting for food (no pathfinding), defer farm planting
