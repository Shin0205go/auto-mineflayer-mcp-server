# [2026-04-01] Critical Bug: Bot1 Starvation + Crafting Window Failure

## Status
**CRITICAL** - Bot is starving with Food=0, HP=9.5, unable to craft bread despite having wheat

## Cause
1. **Food pickup failure**: Harvested wheat drops not immediately collected by bot
2. **Crafting window timeout**: `bot.craft()` fails with "Event windowOpen did not fire within timeout of 20000ms" even with crafting table in range
3. **Starvation**: Bot reaches Food=0 without dying (should be dead at negative food)

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
2. Navigate to crafting table
3. Call `bot.craft(breadRecipe, 1, craftingTable)`
4. Window times out after 20s, craft fails

## Required Fix
- [ ] Debug mineflayer container window opening
- [ ] Check if crafting table is in valid range/visible to bot
- [ ] Verify bot.openContainer() or bot.activateBlock() is working
- [ ] Consider fallback: if window fails, report error and suggest relogging bot
