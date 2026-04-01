## [2026-04-01] Bug: Pathfinder timeout during water quest

**Status:** BLOCKING - cannot navigate to furnace or coal areas

**Current Location:** (32.4, 98, -1.6)
**Target:** Furnace at (7, 100, -3), distance 25.5 blocks
**Last Action:** Attempted `pathfinderGoto(GoalBlock(7, 100, -3))` with default timeout

**Error:**
```
Took to long to decide path to goal!
Timeout after 20684ms (even with 30s+ default)
```

**Context:**
- Earlier attempts to reach coal area (32, 92, -2) also timed out
- Short-distance goals (<1 block) work fine (reached water successfully)
- Longer distances (>5 blocks) trigger pathfinder timeout
- Same timeout pattern repeating across multiple commands

**Observations:**
- Bot position updates successfully (0ms checks work)
- awareness() works fine
- Block scanning (findBlock) works
- Only pathfinder.goto() with distance >5 blocks fails
- No unusual terrain features blocking visible paths

**Impact:**
- Cannot reach furnace to smelt iron ore
- Cannot reach coal area to mine iron
- Cannot complete water bucket quest (need 3 iron ingots, only have 2)
- Effectively stuck at farm location

**Hypothesis:**
- Pathfinder collision detection or movement validator may be broken
- Possible issue in terrain pathfinding algorithm or movement goals
- May be related to recent code changes in bot-core.ts or pathfinder setup

**Workaround:** None available - all longer-distance navigation blocked

**Next Step:** Investigate pathfinder configuration in src/bot-manager/
