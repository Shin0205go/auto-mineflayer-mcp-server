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

---

## UPDATE: Diagnosed as Systemic Pathfinder Failure

**New evidence from multiple attempts:**

1. **Reconnection temporarily helped** (reached farm 9 blocks)
   - After ~5 successful navigations, pathfinder broke again
   - Suggests state corruption or cumulative issue

2. **Distance-dependent failure pattern:**
   ```
   <3 blocks:  100% success
   3-10 blocks: 50% success  
   >15 blocks: 0% success (consistent timeout)
   ```

3. **Affected operations:**
   - Cannot reach furnace (23 blocks)
   - Cannot reach crafting table (16 blocks)
   - Cannot reach water (26 blocks after relocation)
   - Cannot reach coal mining area (25+ blocks)

4. **Root cause likely in:**
   - Pathfinder collision detection
   - Movement validator state accumulation
   - Terrain analysis caching (becoming stale)
   - Goal computation timeout

**Impact severity: CRITICAL**
- Game is unplayable for any task requiring travel >10 blocks
- Cannot progress toward dragon without stable pathfinding
- Resource gathering, crafting, building all blocked

**Current workaround:**
- Disconnecting/reconnecting gives temporary 5-10 successful navigations
- Not a viable long-term solution

**Needed fix:**
- Investigate pathfinder state management in `src/bot-manager/pathfinder.ts` or equivalent
- Check for memory leaks or state corruption in movement validation
- Consider resetting pathfinder state between goals
