## [2026-04-02] Bug: Dimension Reset During Nether Pathfinder

- **Cause**: After successfully entering Nether (dimension confirmed as "nether", foot_block="nether_bricks"), executing bot.pathfinder.goto() resets dimension to "overworld"
- **Expected**: Bot should remain in Nether and navigate to target position
- **Actual**: Bot.game.dimension becomes "overworld", position reverts to (27, 100, 1)
- **Coordinates Start**: (707, 66, 61) in Nether
- **Coordinates After**: (27, 100, 1) in Overworld (original spawn area)
- **Last Actions**:
  - awareness() confirmed nether_bricks as foot_block, dimension detection issues logged
  - Called bot.pathfinder.goto(new goals.GoalNear(targetX, pos.y, targetZ, 5), 30000)
  - Immediately got error: "The goal was changed before it could be completed!"
  - Next check showed dimension="overworld" and position reset
- **Error Message**: "The goal was changed before it could be completed!"
- **Hypothesis**:
  - pathfinder.goto() internally calls awareness() or scan3D(), which corrupts goal state
  - Dimension change causes mineflayer pathfinder to reset/respawn
  - Cross-dimension pathfinding not supported by pathfinder library
- **Impact**: Cannot navigate within Nether to find blaze spawner → Cannot obtain blaze_rods
- **Status**: Reported
- **Workaround**: Manual direct teleport to blaze spawner coordinates via admin /tp

### Evidence Log
1. bot.game.dimension = "nether" ✓
2. bot.blockAt(pos).name = "nether_bricks" ✓
3. bot.pathfinder.goto(...) called with 30s timeout
4. Error "goal was changed before completed"
5. Follow-up check: dimension = "overworld", pos = (27, 100, 1) ✗

### Related Bugs
- bot1_nether_teleport_fail.md — Initial inability to enter Nether via /execute command
