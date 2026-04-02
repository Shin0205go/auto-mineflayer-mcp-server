## Bug: Phase 7 Pathfinder stuck at surface Y=75

### Status: REPORTED

### Date
2026-04-02 (Phase 7 - Stronghold Expedition)

### Description
Claude1 is stuck at coordinate (20.5, 75, -1.5) - ground level at overworld surface. Multiple pathfinder attempts to move fail with timeout (60s+).

### Cause
Terrain instability - bot is standing on unstable/floating surface with air gaps below. When pathfinder tries to navigate to (-100, -50) (130m away), it times out consistently.

### Last Actions Before Failure
1. Cast ender_eye at position (20.5, 75) with bot.consume()
   - ender_eye was consumed (count dropped 1→0)
   - Eye entity not found in visible range (fell/disappeared)
2. Attempted pathfinder.goto(GoalXZ(3, -8)) - 19m away
   - Expected: should succeed for short distance
   - Actual: timeout after 60000ms

### Coordinates
- Current: (20.5, 75, -1.5) - unstable surface
- Attempted target: (-100, 25, -50) - first stronghold search waypoint
- Y-level issue: Bot at Y=75 (overworld surface) but terrain is fragmented

### Error Message
```
Pathfinder timeout after 60000ms
Error: Error: Pathfinder timeout after 60000ms
```

### Reproduction Steps
1. Cast ender_eye to locate stronghold direction
2. Try `bot.pathfinder.goto(new goals.GoalXZ(3, -8))` from position (20.5, 75, -1.5)

### Expected Behavior
- Short distance (19m) pathfinding should complete in <5s
- Or pathfinder should find valid path with terrain bridging

### Actual Behavior
- Timeout after 60s
- No recovery - bot remains at original position

### Suspect Code
- `mc-execute.ts` sandbox pathfinder setup or terrain state
- Possible: terrain below Y=75 is inaccessible or blocked by liquids/hostile mobs
- Possible: movements config has canDig=false preventing terrain modification

### Severity
CRITICAL - Cannot proceed with stronghold exploration without pathfinder mobility

### Potential Fixes
1. Manually place cobblestone bridge under bot to stabilize surface
2. Try teleport/alternative movement instead of pathfinder
3. Increase pathfinder timeout limit (current: 60s)
4. Check if terrain is actually inaccessible vs pathfinder bug
5. Verify Movements config - may need canDig=true for exploration

### Additional Evidence (2026-04-02 Phase 7)
- Short distance pathfinder (5 blocks): SUCCESS - suggests pathfinding works for very short ranges
- Medium distance (10-20 blocks): TIMEOUT - timeouts occur even for seemingly feasible moves
- Multiple concurrent background processes: YES - suggests previous long-timeout commands are still executing (MC_TIMEOUT=120000)
- Impact: Cannot navigate to stronghold even with waypoint-based approach

### Investigation Needed
1. Are background processes from previous timeout-commands still consuming resources?
2. Is pathfinder.setMovements() config missing canDig or other critical flags?
3. Are there terrain-blocking scenarios (large water, lava, hostile mobs) preventing path completion?

### Next Steps
- Code reviewer:
  1. Check bot-manager pathfinder initialization - verify all Movements flags
  2. Implement path validation before timeout to detect blocking obstacles
  3. Consider adding pathfinder interrupt on timeout to prevent zombie processes
- Agent:
  1. Will attempt alternative movement method (manual block placement + jump sequence)
  2. If movement remains critical blocker, may need admin `/tp` command for Phase 7 completion
