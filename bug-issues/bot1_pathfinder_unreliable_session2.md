# [2026-04-01] Bug: Pathfinder Unreliable + Teleportation Issue

## Summary
Claude1 cannot navigate to reachable locations. Furnace at [7, 93, -4] marked as unreachable. Farm at [4, 92, 10] unreachable. Pathfinder claims goals reached but bot position unchanged. Movement takes 100+ seconds for simple navigation.

## Detailed Symptoms

1. **Furnace Unreachable**
   - Furnace location: [7, 93, -4]
   - Bot position: [6, 85, 4]
   - Tried: GoalBlock, GoalXZ, GoalY, adjacent positions
   - Result: All returned "No path to the goal!"

2. **Farm Unreachable**
   - Farm location: [4, 92, 10]
   - Bot position: [6, 85, 4]
   - Distance: 9 blocks
   - Result: "No path to the goal!"
   - NOTE: When tried `GoalY(92)`, pathfinder reported success but bot stayed at Y=85

3. **Pathfinder Timeout**
   - Simple navigation to [6, 85, 6] (2 blocks away) took 10,000ms
   - Message: "Took too long to decide path to goal!"
   - Result: Bot was moved to [4, 85, 7] instead

4. **Slow Mining**
   - Deep mine with 50-block depth loop took 24,741ms
   - No ores found despite correct Y-levels

## Code Example Triggering Bug
```javascript
// Furnace navigation - fails
await bot.pathfinder.goto(new goals.GoalBlock(7, 93, -4));
// Error: No path to the goal!

// Water navigation - times out
await bot.pathfinder.goto(new goals.GoalBlock(6, 85, 6));
// Times out, teleports to [4, 85, 7]
```

## Environment
- Server: localhost 25565
- Bot: Claude1
- Minecraft Version: Not specified
- Plugin: mineflayer with pathfinder

## Impact
- Cannot reach furnace to smelt iron
- Cannot reach farm to plant/harvest crops
- Basic resource gathering blocked
- Food production impossible

## Possible Causes
- Terrain corruption/unreachable chunks
- Pathfinder movement validator issue
- Bot position sync problem (reports success but doesn't move)
- Water/lava blocking paths not detected

## Logs
- Deep mine attempt: 24,741ms, no ore found
- Furnace navigation: Error: No path to the goal!
- Water navigation: 10,000ms timeout
- Final position: [4, 85, 7], still at Y=85

## Status
Reported - requires code-reviewer investigation of pathfinder movement validation logic
