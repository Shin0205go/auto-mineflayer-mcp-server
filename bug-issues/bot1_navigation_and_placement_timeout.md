## [2026-04-01] Bug: blockUpdate Timeout + pathfinder Navigation Blocked

### Status
Claude1 is stuck at location (8.5, 93, 3.5) - appears to be on a floating platform or cliff edge

### Issue Description
1. **blockUpdate Timeout**: Attempting to placeBlock (both chest and cobblestone) times out after 5000ms
   - Error: "Event blockUpdate:(8, 93, 3) did not fire within timeout"
   - Affects: bed placement, chest placement, cobblestone placement

2. **pathfinder Navigation Blocked**:
   - Target: chest location (9, 96, 4)
   - Error: "No path to the goal!"
   - Indicates current position is isolated or disconnected from rest of map

3. **Terrain State Inconsistency**:
   - awareness() reports: foot="granite", all adjacent blocks="air"
   - blockAt() reports: foot block = "air", head block = "air"
   - Creates situation where bot is "floating" even though awareness says there's granite below

### Current Status
- Position: (8.5, 93, 3.5)
- Health: 20/20
- Hunger: 20/20 (no food items)
- Time: Night (tick 13033)
- Enemies: 4 mobs nearby (creepers, zombies)
- Inventory: Has white_bed, cobblestone x176, but cannot place either

### Last Actions
1. Called awareness() - showed enemies nearby
2. Attempted to move to nearest chest (9, 96, 4) - pathfinder failed
3. Attempted to place white_bed - blockUpdate timeout
4. Attempted to place cobblestone - blockUpdate timeout
5. Attempted pathfinder to chest again - "No path"

### Hypothesis
- Bot may be on a chunk boundary or unloaded chunk
- World state may not be synced properly with server
- blockAt() may be reading stale world data
- Place operations may not be generating proper events

### Recommended Fix
- Verify chunk loading and world state sync in bot initialization
- Check blockUpdate event handling in mc-execute sandbox
- Consider adding chunk pre-loading for base area
- Add fallback navigation for unconnected areas (e.g., spiral search)

### Multiple Placement Attempts Failed
- Attempt 1: placeBlock(chest) at (8, 93, 5) — timeout
- Attempt 2: placeBlock(cobblestone) at (8, 93, 3) — timeout
- Attempt 3: placeBlock(white_bed) at (10, 90, 5) — timeout (CRITICAL: needed for survival at night)

### Pattern
**Every placeBlock() attempt times out with "Event blockUpdate did not fire within timeout of 5000ms"**
- Suggests server is not sending blockUpdate events back to bot
- Or bot is not listening/processing these events
- Affects all block placement (beds, chests, cobblestone)

### Severity
**CRITICAL** - System breakdown affecting all core gameplay functions

### Additional Issues Discovered
1. **Hunger Crisis**: Hunger decreasing (17/20 → 17/20) despite food=0. Expected starvation damage to HP.
2. **bot.entities Mismatch**: awareness() shows enemies, but Object.values(bot.entities) returns empty mob list. Suggests event propagation failure.
3. **pathfinder False Success**: bot.pathfinder.goto() returns "success" but position doesn't actually change (still at Y=81 after multiple failed moves).
4. **bot.recipesFor() Returns Empty**: All recipe queries return 0 results, preventing crafting of basic items (stick, planks, bread).
5. **Circular Failure Loop**:
   - Try to escape → pathfinder says success but position unchanged
   - Try to find food → awareness shows resources but unreachable
   - Try to craft → recipesFor returns empty
   - Try to place blocks → blockUpdate timeout
   - Result: Bot unable to execute ANY action successfully

### Hypothesis: Severe Communication Breakdown
- blockUpdate, entity updates, recipe sync all failing
- Suggests: chunk loading error, event listener crash, world state desync, or protocol mismatch
- May require server restart or player respawn

### Related Files
- src/tools/mc-execute.ts (sandbox environment, event listeners)
- src/bot-manager/bot-core.ts (bot initialization)
- .claude/rules/mc-execute-api.md (API definitions)
- src/bot-manager/auto-safety.ts (AutoSafety bed feature)
