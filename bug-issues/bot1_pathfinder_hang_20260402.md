## [2026-04-02] Bug: bot.pathfinder.goto() Hangs for 120+ Seconds

### Cause
- Pathfinder call to navigate from (23, 95, 2) to (27, 101, 5)
- Distance ~10 blocks, vertical climb needed
- Pathfinder promise never resolves after 120 seconds
- bot.dig() also hangs before this, possibly state corruption

### Coordinates
- Start: (23.3, 95, 2.3) — underground, stone blocks, head bumped
- Target: (27, 101, 5) — base location
- Distance: ~10 blocks, needs vertical climb

### Timeline
1. Multiple dig() calls on coal_ore all timed out (120s each)
2. Bot location drifted from (27, 101, 5) to (23.3, 95, 2.3)
3. Attempted pathfinder.goto() for base return
4. Pathfinder hangs at 120s timeout

### Last Actions
```javascript
await bot.pathfinder.goto(new goals.GoalXZ(27, 5));
// Never returns, times out
```

### Context
- bot.health: 20/20 (alive)
- bot.food: 19/20 (not starving)
- chunks loaded: undefined (SUSPICIOUS)
- Previous dig() calls all timed out (3x in same session)

### Root Analysis
- dig() hangs in loop (120s)
- pathfinder hangs after dig() loop (120s)
- Both are blocking operations that never resolve
- Possible causes:
  1. Chunk loading failure (chunks.size = undefined)
  2. Navigation graph corruption after dig() failures
  3. Timeout handling in mineflayer core (not catching promise rejection)
  4. Block state mismatch after dig() operations

### Recommendation
- Do NOT use dig() or pathfinder.goto() until root cause found
- Use alternative methods (e.g., manually place blocks, navigate with setControlState)
- Check chunk loading before pathfinding operations
- Consider full bot reconnect if hanging occurs

### Status
Reported — critical blocker on all movement and mining. Game is unplayable.
