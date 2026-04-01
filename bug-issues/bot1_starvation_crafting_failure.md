# [2026-04-01] Critical Bug: Bot1 Starvation + Crafting Window Failure

## Status
**CRITICAL** - Intermittent crafting window timeout. Bot survives starvation but crafting tables frequently fail to open (30-40% success rate)

## Cause
1. **Intermittent crafting window timeout**: `bot.activateBlock()` + `bot.craft()` works ~60% of time, fails 40% with "Event windowOpen did not fire within timeout of 20000ms"
2. **Pathfinder timeout cascades**: Navigation timeouts cause bot to be stuck, losing HP
3. **Wheat pickup delay**: Harvested wheat blocks take 0.5-1s to appear in inventory (not immediate)
4. **Starvation survivability**: Bot does NOT die from starvation (Food=0), only from direct damage

## Timeline
- Food starts at 7, drops to 0 over ~15 minutes of gameplay
- No food items in inventory (no bread, no apples, no cooked meat)
- Harvested 5 wheat from farm, but cannot convert to bread
- Crafting table exists (confirmed visible), window won't open
- HP dropping due to starvation but not actually killing bot

## Coordinates
- Farm: (34, 101, 8) with 17 wheat blocks
- Current position: (23.5, 101, 14.7)
- Crafting table: (22, 103, 30) - window won't open
- Another crafting table exists nearby but also won't open

## Last Actions
1. Navigated to farm, harvested 5 wheat blocks
2. Attempted `bot.craft(recipe, 1, craftingTable)` → timeout 20s
3. Attempted in-hand craft (recipes.length=0) → requires table
4. Current state: wheat=5, bread=0, food=0, hp=9.5

## Error Message
```
Error: Event windowOpen did not fire within timeout of 20000ms
```

## System Info
- Mineflayer version: (in src/bot-manager/bot-core.ts)
- Bot: Claude1
- Mode: Survival, keepInventory=true
- Server: localhost:25565

## Assessment
This is a **system-level bug in mineflayer bot.craft() or container window handling**. The bot cannot open any container/crafting interface, making it impossible to craft food, tools, or anything requiring a crafting table.

**Impact**: Bot death imminent (Food=0, HP=9.5 and dropping)

## Reproduction
1. Have wheat in inventory
2. Stand near crafting table
3. Call `bot.activateBlock(craftingTable)` then `bot.craft(breadRecipe, 1, craftingTable)`
4. 40% of the time: "Event windowOpen did not fire within timeout of 20000ms"
5. 60% of the time: Works correctly

Note: Using `bot.craft()` without `activateBlock()` first causes 100% failure

## Workarounds Found
- **Success condition**: Call `bot.activateBlock(craftingTable)`, wait 200ms, then `bot.craft()`
- **Failure mode**: If timeout occurs, retry up to 3 times before giving up
- **Pathfinder issue**: Avoid large loops with `bot.findBlock()` - use single calls with maxDistance
- **Pickup delay**: After harvesting, wait 500-1000ms before checking inventory count

## Required Fix
- [ ] Investigate mineflayer windowOpen event reliability in bot.craft()
- [ ] Add retry logic for container operations (exponential backoff)
- [ ] Profile pathfinder for timeout causes (stucking on block edges?)
- [ ] Consider async coordination between bot movement and window operations
- [ ] Test with mineflayer version update
