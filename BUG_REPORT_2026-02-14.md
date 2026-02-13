# Bug Report - 2026-02-14
**Reporter:** Claude3
**Session:** Self-improvement loop session

## Bug #1: Server Mob Spawning Disabled - No Food Sources

**Severity:** CRITICAL - Survival gameplay impossible
**Status:** Server Configuration Issue

### Description
No passive mobs spawn within 100+ blocks, making food collection impossible. Validated with `minecraft_validate_survival_environment` tool.

### Evidence
- `minecraft_get_nearby_entities(range=64, type=passive)` returns no entities
- `minecraft_validate_survival_environment(searchRadius=100)` confirms:
  - No passive mobs found
  - No edible plants found
  - No fishing viability
- Multiple agents (Claude1, Claude2, Claude3) all report same issue
- Chat log from Claude2: "CRITICAL: No food sources in 100 block radius. Server may have mob spawning disabled."

### Impact
- Hunger gradually depletes (20→17→15→...)
- Eventually starves to death
- Cannot sustain long-term survival gameplay
- Makes resource gathering risky (hunger depletion)

### Root Cause
Server configuration likely has mob spawning disabled or broken:
- `spawn-animals=false` in server.properties
- Or mob spawning broken in server version

### Recommendation
Server admin needs to:
1. Enable mob spawning in server.properties (`spawn-animals=true`)
2. Restart server
3. Or provide alternative food source (creative mode access, /give commands)

---

## Bug #2: Crafting Item Pickup Failure - Resource Waste

**Severity:** HIGH - Permanent resource loss
**Status:** Code Bug + Server Configuration Issue
**File:** `src/bot-manager/bot-crafting.ts:773`

### Description
When crafting items that require crafting tables (e.g., iron_leggings), the crafted item drops on the ground but cannot be picked up, permanently wasting the ingredients.

### Reproduction Steps
1. Have 13 iron ingots in inventory
2. Use crafting table to craft iron_leggings
3. Observe: Item crafted successfully (ingredients consumed)
4. Observe: Item drops as entity but cannot be collected
5. Result: Lost 7 iron ingots permanently (13 → 6)

### Evidence
- Error message: "Server has item pickup disabled. Crafted item dropped on ground but cannot be collected. This server configuration is incompatible with crafting. Ingredients consumed: recipe materials lost permanently."
- Code location: `bot-crafting.ts:847`
- Successfully crafted iron_boots (no issue) but failed on iron_leggings
- `minecraft_collect_items()` returns: "No items collected after 1 attempts"

### Technical Analysis

**Problem Flow:**
1. Line 773: `await bot.craft(tryRecipe, 1, craftingTable || undefined);` - **Ingredients consumed here**
2. Line 782: Close crafting table window - **Item drops as entity**
3. Line 791-792: Check inventory - **Item not found**
4. Line 802-821: Search for dropped items - **Items detected**
5. Line 829: `collectNearbyItems()` - **Collection fails (server issue)**
6. Line 838: Verify collection - **Item still missing**
7. Line 847: **Error thrown AFTER resources already lost**

**Root Cause:**
The bot.craft() operation is not atomic - it consumes ingredients immediately but delivery of the crafted item can fail. The code detects this failure and throws an error, but it's too late - resources are already lost.

**Why iron_boots worked but iron_leggings failed:**
- iron_boots: Crafted successfully and picked up from inventory
- iron_leggings: Crafted but dropped and cannot be collected (possibly due to window closing behavior)

### Proposed Fix

Add pre-flight check before crafting expensive items:

```typescript
// Before line 773 in bot-crafting.ts
// Add this safety check for expensive recipes using crafting tables:

if (craftingTable && isExpensiveRecipe(itemName)) {
  // Test if item pickup works by dropping a cheap item
  const testResult = await testItemPickup(bot);
  if (!testResult) {
    throw new Error(`Cannot craft ${itemName}: Server has item pickup disabled. Aborting to prevent resource waste.`);
  }
}

function isExpensiveRecipe(itemName: string): boolean {
  const expensive = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots',
                     'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots',
                     'iron_pickaxe', 'iron_axe', 'iron_sword', 'diamond_pickaxe', /* etc */];
  return expensive.includes(itemName);
}

async function testItemPickup(bot): Promise<boolean> {
  // Drop a cheap item (dirt/cobblestone) and try to pick it up
  // If pickup fails, return false
  // This validates that item pickup works before wasting expensive materials
}
```

### Workaround
Until fixed, avoid crafting these items:
- iron_leggings, iron_helmet (use crafting table)
- Any expensive items requiring crafting table

Safe to craft:
- iron_boots (worked successfully in testing)
- Simple 2x2 recipes (planks, sticks, torches)

### Server Configuration Issue
The underlying cause is also a server configuration problem - item pickup should work. Server admin should verify:
- `doEntityDrops=true`
- `doTileDrops=true`
- Entity pickup is not blocked by plugins

---

## Session Statistics
- **Duration:** ~5 minutes gameplay
- **Resources Gathered:** 12 raw iron, 26 coal, 6 birch logs
- **Resources Processed:** 12 iron ore → 12 iron ingots (combined with existing)
- **Resources Lost:** 7 iron ingots (crafting bug)
- **Net Iron:** 16 → 6 ingots (due to bug)
- **Hunger Status:** 20 → 15/20 (no food available)
- **Equipment:** Iron chestplate, iron boots, iron pickaxe, iron sword, iron axe

## Recommendations
1. **Immediate:** Fix crafting pre-flight check to prevent resource waste
2. **Server:** Enable mob spawning for food sources
3. **Code:** Add testItemPickup() function before expensive crafts
4. **Documentation:** Add warning about server requirements in README
