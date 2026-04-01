## [2026-04-01] Bug: Pathfinder timeout on vertical navigation

- **Cause**: pathfinder.goto() hangs indefinitely on complex vertical paths (Y transitions >5 blocks with stone walls)
- **Coordinates**: Multiple locations (2,108,15 and 7,93,-3 and others)
- **Last Actions**: Attempting to navigate to furnace locations to smelt iron ore
- **Error Message**: `Execution timed out after 120000ms` on `bot.pathfinder.goto()`
- **Symptoms**: 
  - First attempt: pathfind to (2, 108, 15) furnace fails with "No path to the goal" but should work with canDig=true
  - Manual digging doesn't help - pathfinder still fails
  - Attempting to navigate to closer furnace (7, 93, -3.7) causes full timeout
  - Block placement timeout on Y=100: "blockUpdate:(2, 100, 15) did not fire within timeout of 5000ms"
- **Status**: Reported - blocking Phase 2 progression (need to smelt iron ore for bucket)

