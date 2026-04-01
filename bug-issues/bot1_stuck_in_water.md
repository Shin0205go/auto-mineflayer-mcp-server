## [2026-04-01] Bug: Claude1 stuck in water, unable to navigate

### Cause
Bot respawned at water level y=80 after attempting to reach furnace at (4, 69, 12).
- Pathfinder reports "No path to the goal!" for both GoalBlock and GoalXZ
- onGround reports true while floating at water surface (y=80)
- Bot does not sink or respond to jump/gravity
- Respawn via /kill @s worked but bot remains at same position
- Cannot navigate to furnace ~3.5 blocks away due to water barrier

### Coordinates
- Current position: (2.4, 80, 14.65)
- Target (furnace): (4, 69, 12)
- Surrounding terrain: completely water-logged, no solid blocks nearby

### Last Actions
1. Attempted to craft bucket (need 3 iron ingots, have 2)
2. Tried pathfinding to furnace: FAILED with "No path to the goal!"
3. Attempted manual/forced diving: bot stuck at y=80
4. Respawned with /kill @s: position unchanged

### Error Messages
- "No path to the goal!" (pathfinder failure)
- Bot.entity.onGround = true while at y=80 (water surface)

### Status
Reported - bot is unrecoverable. Farmland area and furnace are unreachable.
Game world may have structural issues (flooded spawn area, pathfinding map corruption, or terrain generation bug).

### Impact
- Cannot smelt raw_iron for bucket
- Cannot access furnace or farmland
- Cannot plant/harvest wheat seeds
- Food production halted

Recommend: World restart or terrain rebuild around spawn
