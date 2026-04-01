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

### Status
Reported - awaiting manual intervention or code fix
- Immediate need: Food delivery via /give or terrain simplification
- Medium-term: Fix pathfinder performance in water-heavy biomes
- Long-term: Better spawn location selection or terrain preprocessing

### Next Steps for Code Reviewer
1. Check `src/bot-manager/pathfinder.ts` - water terrain handling
2. Consider: Should pathfinder.setMovements() include water avoidance toggle?
3. Consider: Emergency shelter + manual food until terrain is fixed
