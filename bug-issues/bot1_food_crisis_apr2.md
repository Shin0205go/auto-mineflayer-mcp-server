## [2026-04-02] Bug: Pathfinder Hang + Food Crisis (HP=5.5, Food=0)

- **Cause**: Daemon reconnection left Claude1 in critical state: HP=5.5/20, Food=0/20. Attempted to pathfind to furnace 20 blocks away, bot hung for full 120 seconds.
- **Coordinates**: Pos (22,95,-3), tried to reach furnace at (20,88,1)
- **Last Actions**:
  1. Connected Claude1 to server
  2. Checked inventory: 1 wheat, 2 iron ingots, 3 diamonds, crafting_table, etc.
  3. Attempted bot.consume() on wheat → timeout
  4. Attempted bot.craft() → recipes undefined
  5. Attempted to place crafting_table → blockUpdate timeout
  6. Attempted pathfinder.goto to furnace → full 120s hang
- **Error Message**: Execution timed out after 120000ms (pathfinder)
- **Status**: Reported - pathfinder blocked, consume() broken, food chain blocked
- **Impact**: Claude1 unable to eat despite having wheat. Need alternative food source or quick heal.

## Root Issues
1. **wheat != eatable**: Minecraft wheat must be crafted to bread first
2. **consume() timeout**: 2.5s timeout suggests API change or state issue
3. **crafting without crafting_table**: Need active crafting_table block nearby
4. **pathfinder unreliability**: 20-block distance causes hang (memory: max 20 blocks safe)
5. **block placement timeout**: placeBlock() events not firing
