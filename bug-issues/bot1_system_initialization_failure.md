## [2026-04-02] Bug: System Initialization Failure (bot.world, windowOpen events)

### Symptom
1. **Movements initialization fails**: `Cannot read properties of undefined (reading 'blocksByName')`
   - Suggests `bot.world` or `bot.registry` is undefined/corrupted

2. **Container events fail**: `windowOpen did not fire within timeout (20000ms)`
   - bot.openContainer() and bot.activateBlock() do not trigger the event
   - Chests are visible and clickable, but not opening

3. **Pathfinder decision timeout**: `Took too long to decide path to goal!`
   - Related to Movements not being initialized correctly
   - Even short-distance moves (15m) fail to compute path

### Location
- Current pos: (11, 99, 6)
- Target: Chest at (9, 96, 4)
- Farmland at (11, 101, 11)

### Context
- Bot hunger: 9/20 (critical state, AutoSafety can't help without food)
- Inventory: wheat_seeds x32, wheat x1, coal x12, others
- Just after daemon restart (code update: navigateTo race condition fix)

### Root Cause Hypothesis
The navigateTo race condition fix may have introduced a new issue:
- bot.world or bot.registry initialization is incomplete/broken
- This breaks Movements(bot) construction → pathfinder
- This also prevents container events from registering properly

### Actions Attempted
1. `bot.pathfinder.goto()` with Movements(bot.world) → blocked by blocksByName undefined
2. `bot.pathfinder.goto()` with Movements(bot) → path decision timeout
3. `bot.openContainer(chestBlock)` → windowOpen timeout
4. `bot.activateBlock(chestBlock)` → windowOpen timeout (no event fired)
5. Short-distance multiStagePathfind(9, 4) → timeout

### Required Fix
- Verify bot initialization in bot-manager
- Check if bot.world and bot.registry are properly set before mc_execute
- Test Movements construction with actual bot instance
- Verify container/chest event listeners are attached

### Status
Blocked: Cannot progress without container access or pathfinder fix
