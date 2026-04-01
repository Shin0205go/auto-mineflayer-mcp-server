## [2026-04-02] Bug: bot.dig() Hangs for 120+ Seconds

### Cause
- While descending Y=99 → Y=30 using bot.dig(block) in loop
- Each dig() call times out after ~6 seconds with no progress
- After 20 attempts, total timeout exceeds 120 seconds
- bot.dig() promise never resolves

### Coordinates
- Location: (37.5, 99, 12.5)
- Attempting to dig downward from Y=99 to Y=30

### Timeline
1. T=00:00 Pathfinder move to (37, ?, 12) succeeded → Y=99
2. T=00:15 Scan for ores found 85 blocks (coal_ore, iron_ore)
3. T=00:20 Mined 1 coal_ore successfully
4. T=00:30 Started dig loop: 20 blocks, each dig() called
5. T=02:10 Total 120+ seconds elapsed, no dig() completed after first iteration

### Last Actions
```javascript
while (currentY > targetY && dug < 20) {
  const below = bot.blockAt(new Vec3(x, currentY - 1, z));
  if (below && below.name !== 'air' && below.name !== 'water') {
    try {
      await bot.dig(below);  // ← HANGS HERE
      dug++;
      await wait(200);
    } catch(e) {
      log('Dig at y=' + (currentY - 1) + ' failed: ' + e.message);
      break;
    }
  }
  currentY--;
}
```

### Error Message
```
Error: Execution timed out after 120000ms
```

### Root Analysis
- bot.dig() was used multiple times before: succeeded once, now hangs
- May be related to block state, water proximity, or bot position
- Alternative: use bot.activateBlock() + findBlock() for mining operations
- Recommendation: avoid loop-based dig() calls; use scan-then-single-dig pattern

### Status
Reported — switch to alternative mining approach (scan + direct dig vs loop dig)
