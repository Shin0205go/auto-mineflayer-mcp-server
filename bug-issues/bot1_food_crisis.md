## [2026-04-01] Bug: Food Crisis - Hunger 16/20, No Food Available

### Cause
- Initial spawn location (6, 67, 10) surrounded by water blocks
- No animals found in 60-block radius despite multiple scans
- No naturally generated food in inventory
- Pathfinder continually timing out due to complex water terrain

### Context
- **Coordinates**: (6, 67, 10) → (8, 69, 11)
- **Hunger**: 16/20 (CRITICAL - below safe threshold of 5)
- **Food in inventory**: 0 items
- **Available resources**:
  - wheat_seeds x11 (but require farmland + time to grow)
  - crafting_table x1
  - No wood/stone tools yet
- **Actions attempted**:
  1. Scan nearby animals (30-60 block radius) - FAILED: none found
  2. Navigate to oak_log (-21, 71, 3) - TIMEOUT: pathfinder failed after 40s
  3. Plant wheat_seeds in farmland (9, 67, 6) - TIMEOUT: pathfinder hung for 120s+

### Error Messages
```
1. "Took to long to decide path to goal!" (pathfinder timeout)
2. "Execution timed out after 120000ms" (mc_execute timeout)
3. "Event blockUpdate:(4, 68, 3) did not fire within timeout of 5000ms" (block place)
```

### Root Cause
Spawn area is heavily water-logged with uneven terrain. Pathfinder cannot find efficient routes due to:
- Multiple water blocks blocking direct paths
- Complex Y-level changes requiring complex routing
- Possible desync from previous water incident

### Additional Failures
- **Attempt 3** (2026-04-01 12:XX): Navigate to chest at (7, 70, 41) distance=39
  - Timeout after 120s+ with no progress
  - Multiple pathfinder.goto() calls consistently timeout
  - Pattern: ANY use of pathfinder with distance >5 blocks results in hang

### Pattern Analysis
- pathfinder.goto() works for distances < 5 blocks
- pathfinder.goto() hangs indefinitely for distances >= 30 blocks
- Water terrain in spawn area prevents alternative routes
- Suggests: pathfinder algorithm issue, not just terrain complexity

### Status
**CRITICAL** - Pathfinder broken. Bot cannot move more than 5 blocks.
- Immediate need: Food delivery via /give OR admin terrain flatten
- Medium-term: Fix pathfinder hang in mc-execute (timeout mechanism ineffective)
- Long-term: Better spawn location selection or terrain preprocessing

### Next Steps for Code Reviewer
1. **URGENT**: Check `src/bot-manager/pathfinder.ts` - likely infinite loop or deadlock
2. Check `src/tools/mc-execute.ts` - timeout mechanism not killing pathfinder.goto()
3. Test: Can pathfinder handle Y-level changes properly?
4. Consider: Fallback movement (manual control states) when pathfinder > 10 blocks
