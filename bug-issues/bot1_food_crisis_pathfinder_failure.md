## Bug: Food Crisis - Pathfinder Unable to Reach Chest (maxDropDown=4 Ineffective)

**Date:** 2026-04-02
**Status:** CRITICAL — Bot at death threshold (HP=3.5, Food=0)

### Scenario
- Bot Claude1 spawned at (57, 79, 1) with no food
- Chest with food located at (54, 65, 6) — **12 blocks lower**
- Previous fix: `maxDropDown=4` added to pathfinderGoto to handle vertical drops
- **Expected:** pathfinderGoto should descend and open chest
- **Actual:** Pathfinder timeouts on every descent attempt

### Actions Taken
1. Direct pathfinder call: `await pathfinderGoto(new goals.GoalNear(54, 65, 6, 3), 30000, { canDig: true, maxDropDown: 4 })`
   - Result: Bot stayed at starting position, no error thrown

2. Multi-stage descent with 5 waypoints (steps: 75, 70, 68, 66, 65):
   - Step 1 (goto 75): Bot moved to (57,80,1) — **went UP instead of down**
   - Steps 2-5: All timeout after 15s

3. Manual terrain scan:
   - Blocks below: stone from Y=75 down to Y=56
   - No clear cave or water passage
   - Terrain is solid, not impassable

### Root Cause Analysis
- **Pathfinder behavior:** Moving bot UP when target is DOWN
- **canDig=true:** Should allow digging, but not working
- **maxDropDown=4:** Either not implemented or not effective for 12-block drop
- **Timeout pattern:** Every longer descent fails after 15s

### Bot State at Report
```
HP: 3.5 (will die next hit from any mob/fall)
Food: 0 (starvation ticking)
Position: (59, 76, -3) [drifted from starting (57, 79, 1)]
Inventory: crafting_table, diamond_sword, sticks, coal, iron_ingots, diamonds (NO FOOD)
```

### Impact
- Bot unable to access stored food
- No dropped food items nearby
- No animals for hunting
- **Imminent death**

### Reproduction
```js
// Start bot with no food at (57, 79, 1)
// Try: await pathfinderGoto(new goals.GoalNear(54, 65, 6, 3), 30000, { canDig: true, maxDropDown: 4 });
// Expected: Bot descends to chest
// Actual: Pathfinder returns immediately OR times out on multi-stage attempts
```

### Questions for Code Reviewer
1. Is `maxDropDown=4` actually being passed to Movements config?
2. Does pathfinderGoto support descending (negative Y), or only ascending?
3. Why does bot move UP when target is DOWN?
4. Is the Movements object using correct defaults for vertical navigation?

### Previous Related
- bot1_autosafety_injection.md — daemon restart fixed safetyState injection
- Phase 1-2 timeout issues — pathfinder already known problematic

### Recommendation
- Either fix pathfinder to handle descents, or
- Provide an alternative navigation method (direct movement, ladder climbing, etc.)
- Or provide escape mechanism: auto-feed with stored food when HP critical
