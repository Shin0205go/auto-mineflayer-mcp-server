# Bug: World State Synchronization Failure

## Priority
**CRITICAL** - Blocks entire gameplay progression for Phase 1-2

## Summary
Bot's local world state (block cache) is completely desynchronized from server. Despite successful FindBlock API calls indicating blocks exist at specific coordinates, DirectBlockAt queries return null, and pathfinder/container APIs cannot interact with those blocks.

## Symptoms
1. **FindBlock vs BlockAt Mismatch**
   - FindBlock reports: Furnace at (7,100,-3)
   - BlockAt direct scan of same area: No furnace found
   - Result: Cannot interact with confirmed blocks

2. **Pathfinder False Success**
   ```js
   await bot.pathfinder.goto(new goals.GoalBlock(7,100,-3));
   // Returns: "At furnace!"
   // Actual: Bot stayed at (6,99,3), 6m away
   ```
   - Goal calculation appears to succeed
   - Movement never executes
   - No error thrown

3. **Block Placement Timeout**
   ```js
   await bot.placeBlock(referenceBlock, offsetVec);
   // Timeout: blockUpdate event never fires
   // Server never confirms placement
   ```
   - Happens on every attempted placement
   - Blocks all terrain modification
   - Prevents emergency shelter building

4. **Container Open Failure**
   ```js
   const furnaceBlock = bot.blockAt(furnacePos);  // Returns null or wrong type
   await bot.openContainer(furnaceBlock);
   // Error: containerToOpen is neither a block nor an entity
   ```

## Root Cause Analysis

**Hypothesis 1: Block Cache Synchronization**
- Local cache in `bot.world` or `ChunksData` is stale
- FindBlock uses index, BlockAt uses cache
- Chunks not reloading on relevant events

**Hypothesis 2: Coordinate Transform Bug**
- World coordinates mismatch between:
  - Server world coordinates
  - Local bot.entity.position
  - Goal coordinates passed to pathfinder
  - Block position references
- Possible offset or transformation error

**Hypothesis 3: Event Queue Deadlock**
- Block update events queued but not processed
- Pathfinder goal resolution blocks on world state read
- Movement command queue stalled waiting for state

## Data for Debugging

**Position & Distance Data**
- Bot at: (6, 99, 3)
- Furnace reported: (7, 100, -3), distance 6m
- BlockAt scan radius: 10m (covered furnace)
- BlockAt result: NULL
- FindBlock result: Found furnace at (7,100,-3)

**API Call Sequence**
1. `bot.findBlock({matching: (b) => b && b.name === 'furnace', maxDistance: 50})`
   - Result: {position: {x:7, y:100, z:-3}}
2. `bot.blockAt(new Vec3(7, 100, -3))`
   - Result: null
3. `bot.placeBlock(bot.blockAt(...), new Vec3(...))`
   - Result: Timeout after 5000ms

**Chunk Load Status Unknown**
- No visibility into which chunks are loaded
- No access to bot.world internal state in sandbox
- Cannot debug cache consistency from agent code

## Impact
- **Phase 1-2 blocked**: Cannot reach furnace/farm/crafting areas
- **No building possible**: Block placement always times out
- **No container access**: Cannot open chests/furnaces/crafting tables
- **Fallback navigation impossible**: Pathfinder reports success without moving

## Reproduction Steps
```js
// 1. Verify block exists via findBlock
const furnace = bot.findBlock({matching: (b) => b && b.name === 'furnace', maxDistance: 50});
log(furnace.position); // {x:7, y:100, z:-3}

// 2. Try to access same block via blockAt
const blockDirect = bot.blockAt(new Vec3(7, 100, -3));
log(blockDirect); // null

// 3. Try to pathfind to block
await bot.pathfinder.goto(new goals.GoalBlock(7, 100, -3));
log(bot.entity.position); // Still at (6,99,3)

// 4. Try to place block (any placement)
await bot.placeBlock(referenceBlock, offsetVec);
// Timeout: blockUpdate did not fire
```

## Expected Next Steps for Code Review
1. Check bot.world chunk loader for synchronization issues
2. Verify goal coordinate transformation in pathfinder
3. Check event queue (blockUpdate, etc) for deadlocks
4. Add debug logging for coordinate transforms
5. Verify chunk reload on relevant events (movement, world data)
6. Consider full world state rebuild on connection
