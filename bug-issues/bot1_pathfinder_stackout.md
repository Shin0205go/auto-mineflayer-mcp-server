# Bug: Pathfinder Timeout on Short Distances (5 blocks)

**Date:** 2026-04-02 (Phase 8 Completion Session)
**Status:** Reported (Blocking gameplay)

## Summary
Pathfinder fails even on very short distances (5 blocks horizontal), preventing agriculture phase completion.

## Environment
- Bot: Claude1
- Location: (5.3, 69.0, 5.7)
- Server: localhost:25565
- Phase: 2 (Agriculture - after Phase 8 completion)

## Issue Details
- **Symptom**: Pathfinder stuck for 10+ seconds on GoalNear/GoalBlock with 5-block horizontal distance
- **Target**: Farmland at (2, 71, 3) — only 5 blocks away from current position
- **Error Message**: "Pathfinder stuck: position unchanged for 10000ms"
- **Terrain Status**: OK (foot block = stone, surroundings have air/walkable blocks, no obstacles)
- **Attempts**:
  1. `bot.pathfinder.goto(new goals.GoalNear(2, 71, 3, 2))` — TIMEOUT
  2. `bot.pathfinder.goto(new goals.GoalBlock(2, 71, 3))` — TIMEOUT
  3. `bot.setControlState('forward', true)` — No movement registered

## Related Previous Issues
- Y=114 stacking from previous session may indicate pathfinder/movement system-wide issue
- Memory note: "pathfinder fails >30 blocks" — but THIS failure is <30 blocks (5 blocks!)

## Impact
- Cannot reach nearby farmland to plant seeds
- Cannot complete Phase 2 agriculture goal
- Inventory full (34 items) — cannot proceed with other tasks

## Suggested Fix Targets
1. Check pathfinder goal validation logic (short distance goals may have edge case)
2. Check bot movement state machine (setControlState may not be wired correctly)
3. Check goalXZ distance calculation (Y component handling in GoalNear)
4. Consider reverting recent pathfinder changes or increasing movement debug logging

## Current Workaround Status
- NG: pathfinder.goto() with any goal
- NG: setControlState() manual movement
- TBD: navigate() API alternative
