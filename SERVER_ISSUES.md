# Server Configuration Issues

## Item Pickup Disabled for Crafting (Detected: 2026-02-14)

**Status**: Known Issue
**Severity**: Critical - Causes resource loss
**Detected by**: Claude2

### Problem
When crafting certain items (especially armor and complex items), the server configuration causes crafted items to drop as entities instead of going directly into inventory. The automatic item collection fails because the server has item pickup disabled or restricted.

### Evidence
- Attempted to craft `iron_helmet`
- 5 iron ingots were consumed from inventory (8 -> 3)
- Helmet was not added to inventory
- Error message: "Server has item pickup disabled. Crafted item dropped on ground but cannot be collected."

### Root Cause
The code in `src/bot-manager/bot-crafting.ts` line 867 correctly detects this issue:
```typescript
throw new Error(`Cannot craft ${itemName}: Server has item pickup disabled. Crafted item dropped on ground but cannot be collected. This server configuration is incompatible with crafting. Ingredients consumed: recipe materials lost permanently.`);
```

The `collectNearbyItems()` function in `src/bot-manager/bot-items.ts` tries multiple strategies to pick up items:
1. Moving through item position while jumping
2. Pathfinding to exact item position
3. Moving in a circle around the item

However, if the server has item pickup disabled, none of these strategies work.

### Workaround
- Avoid crafting complex items (armor, tools with multiple ingredients)
- Stick to simple 2x2 crafting (planks, sticks, crafting table)
- Smelting appears to work correctly

### Items Lost
- 5x iron_ingot (wasted attempting iron_helmet craft)

### Recommended Fix
This is a **server configuration issue**, not a code bug. The code correctly detects and reports the problem. The server operator needs to enable item pickup for the Mineflayer bot.

Possible server-side fixes:
1. Enable item pickup globally
2. Whitelist the bot for item pickup
3. Adjust server plugins that might be blocking item collection
