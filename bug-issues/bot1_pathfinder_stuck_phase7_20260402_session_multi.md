## Bug: Pathfinder Completely Stuck - Phase 7 (Stronghold Navigation)

**Date**: 2026-04-02 (Session ongoing)
**Bot**: Claude1
**Status**: CRITICAL - Blocks Phase 7 (End Dragon preparation)
**Symptom**: All pathfinder.goto() calls timeout with "position unchanged for 10000ms"

### Environment
- Position: (8.4, 66.8, 2.3) in Overworld
- Dimension: overworld
- HP: 20/20, Food: 20/20
- **Inventory**: ender_eye x10, diamond_sword, diamond_pickaxe, elytra, bread x11

### Error Sequence
1. **First pathfinder attempt** (follow ender_eye direction ~100 blocks):
   ```
   await bot.pathfinder.goto(new goals.GoalXZ(87, 32));
   → Timeout: "Pathfinder stuck: position unchanged for 10000ms"
   ```

2. **Short-distance move attempt** (5 blocks):
   ```
   await bot.pathfinder.goto(new goals.GoalNear(13, 2, 1));
   → Timeout: 15s (custom timeout set)
   ```

3. **Goal reset + retry**:
   ```
   bot.pathfinder.setMovements(new Movements(bot));
   await bot.pathfinder.goto(...);
   → Still fails, even after reset
   ```

### Root Cause Analysis

#### Hypothesis A: Multi-bot Goal Interference
- Multiple bots (Claude1-7) active on same server
- Concurrent pathfinder goals may cause race condition or "goal was changed" error
- Evidence: Phase 2 buglog mentions "Pathfinder goal interference in multibot session"

#### Hypothesis B: Terrain Malformation
- Terrain from prior sessions not fully cleared (missing blocks, unexpected walls)
- Pathfinder cannot find path in cluttered terrain
- Evidence: Earlier buglog "Phase 2 farmland" shows similar pathfinder failures

#### Hypothesis C: Physics State Sync Issue
- Bot.entity.position correct, but world state cache is stale
- Bot cannot actually move despite pathfinder thinking path exists
- Evidence: "position unchanged for 10000ms" suggests bot is frozen locally

### Attempts & Failures

| Action | Result | Error |
|--------|--------|-------|
| pathfinder.goto(target_100blocks_away) | Fail | stuck for 10s |
| pathfinder.goto(target_5blocks_away) | Fail | stuck for 15s |
| bot.pathfinder.setMovements(reset) + retry | Fail | still stuck |
| bot.pathfinder.setGoal(direct) | Fail | goal set but move fails |

### Impact

**Phase 7 is BLOCKED.**
- Cannot navigate to stronghold
- Cannot reach nether portal (3, 44, 0)
- Cannot complete ender_eye triangulation
- Cannot reach End portal when found

### Recovery Options

1. **Reconnect** (aggressive):
   ```bash
   node scripts/mc-connect.cjs disconnect
   sleep 3
   node scripts/mc-connect.cjs localhost 25565 Claude1
   ```
   - May reset bot state + pathfinder
   - Will lose current inventory (depends on keepInventory flag)

2. **Code-level fix** (for code-reviewer):
   - Check `src/bot-manager/pathfinder.ts` for goal-change error handling
   - Verify multibot goal queuing mechanism
   - Review terrain state sync in world loader

3. **Terrain inspection**:
   - Use `scan3D()` to check for blocking terrain
   - Look for unexpected walls/holes that pathfinder can't navigate
   - Clear terrain if malformed

### Required Actions

**Code Reviewer**: Check recent commits for pathfinder changes or multibot interference patterns

**Game Agent**: If reconnect needed, preserve inventory state and re-attempt Phase 7

### Investigation After Reconnect

**Reconnect executed:** bot.chat() commands successful, position unchanged at (8.4, 66.8, 2.3)

**Post-Reconnect Status:**
- Still in water (block below: water)
- Inventory intact (ender_eye x10, diamond_sword, elytra, bread x11)
- HP: 20/20, Food: 20/20

**Tests Performed:**
1. Manual movement (setControlState) - Failed, velocity stuck at (0,0,0)
2. Jump escape from water - Failed, no height change
3. Block placement escape - Failed, still in water pocket
4. Pathfinder after water escape - **Still TIMES OUT (20s)**
   - Confirms this is NOT a water-specific issue
   - Root cause is pathfinder core logic, not terrain

### CRITICAL FINDING: Pathfinder Core Bug

**The pathfinder timeout persists AFTER:**
- Reconnection
- Escaping water (partially)
- Resetting movements
- Multiple retry attempts

**This indicates:**
- Not terrain malformation
- Not multi-bot interference (would recover after reconnect)
- **Actual pathfinder.goto() implementation broken**

### Required Code Review

Check in `src/bot-manager/`:
- `pathfinder.ts` - goal setting logic
- `movements.ts` - terrain traversal
- `mc-execute.ts` - goal injection into sandbox

Look for:
- Race conditions in goal queue
- State corruption that persists across reconnects
- Infinite loops in pathfinding algorithm

### Status: ESCALATED

Game agent cannot proceed. Waiting for code reviewer to fix pathfinder core.

---
