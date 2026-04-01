## [2026-04-01] Bug: Pathfinder infinite timeout

- **Cause**: `bot.pathfinder.goto()` times out at 120s even for short distances (2.6m). Multiple attempts with different goal types (GoalNear, GoalXZ) all timeout.
- **Coordinates**: Current pos (6,78,7) → Target chest (7,80,9)
- **Last Actions**:
  1. awareness() showed healthy state
  2. crafting_table created successfully via inventory craft
  3. movement to chest attempted multiple times
  4. all pathfinder calls timeout after 120s
- **Error Message**:
  ```
  Execution timed out after 120000ms
  Distance to chest: 2.6m
  ```
- **Environment**:
  - Goal types tried: GoalNear, GoalXZ
  - canDig: true/false variants
  - Terrain: mixed stone/cobblestone/water around position
- **Impact**: Cannot reach chest for food. Hunger at 16/20, food at 0 → death risk
- **Status**: Reported

---
## Extended Bug Analysis

After deeper investigation:
- `bot.pathfinder.goto()` times out at 120s for ANY goal
- `bot.dig()` also times out (water block)
- `bot.placeBlock()` times out (blockUpdate event not received)
- Even simple movement via `setControlState()` produces wrong direction
- Shell escaping + JSCode issues compound the problem

This suggests **server-side synchronization issue** rather than pathfinder bug alone.

## Next Action Required

Bot needs either:
1. pathfinder.goto() fixed to handle nearby goals properly
2. Server-side block state sync issue resolved (blockUpdate, dig confirmation)
3. Manual movement API (direct input commands)
4. Alternative: respawn at spawn point or teleport command from admin
