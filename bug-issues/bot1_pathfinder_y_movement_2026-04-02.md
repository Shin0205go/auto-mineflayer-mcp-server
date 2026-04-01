# Bug Report: Pathfinder Vertical Movement Failure

**Date**: 2026-04-02
**Bot**: Claude1
**Session**: Phase 3 Iron Mining

## Summary
`bot.pathfinder.goto()` fails to handle vertical movement. Y-coordinate remains unchanged despite reaching pathfinder goals or shows unintended upward migration.

## Observations

### 1. Vertical Movement Failure
- **Target**: Y=62 (10 blocks below current)
- **Action**: `await bot.pathfinder.goto(new goals.GoalNear(px, 62, pz, 3))`
- **Result**: Reports "successfully moved" but Y=86 → Y=86 (no change)
- **Repeats**: Multiple attempts with GoalBlock, GoalNear, GoalXZ all show same behavior

### 2. Unintended Upward Migration
- **Action**: `await bot.pathfinder.goto(new goals.GoalBlock(21, 101, 73))` (horizontal move)
- **Error**: "No path to the goal!"
- **Result**: Y=101 → Y=110 (upward, opposite direction)
- **Observation**: Pathfinder appears to calculate upward routes when horizontal path is blocked

### 3. Block Detection Works Correctly
- `bot.blockAt()` accurately reads block types at all Y-levels
- Digging loop successfully acquired 9 stone blocks without errors
- iron_ore detection via `bot.findBlock()` is accurate
- **Conclusion**: Block-level API is functional; pathfinder-level is the issue

## Environment
- Minecraft version: latest
- Mineflayer: current
- Server: localhost 25565
- World: survival (keepInventory unknown)

## Impact
- Cannot descend to Y=40-60 range for iron mining
- Cannot navigate to findBlock() discovered resources
- Phase 3 (iron equipment) is blocked

## Workaround Attempted
1. Cobblestone staircase placement (5/6 blocks placed) → pathfinder ignored new blocks
2. Horizontal movement with pillar → upward drift
3. Direct dig loop → limited by loop timeout (max 10-15 per execution)

## Hypothesis
- Pathfinder may not refresh block cache after new placements
- Pathfinder Y-goal handling may have priority inversion (prefers upward to navigate around obstacles)
- Bot.entity.position Y-value may be desynchronized from actual state

## Needed Fix
- Investigate `bot.pathfinder.goto()` goal calculation for Y-axis
- Consider alternative movement method (bot.navigate(), raw velocity commands)
- Test pathfinder with pre-existing terrain (not newly placed blocks)

## Status
Reported. Awaiting code-reviewer fix.
