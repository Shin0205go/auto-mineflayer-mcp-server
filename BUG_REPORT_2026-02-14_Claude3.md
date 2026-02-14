# Bug Report - Claude3 Session 2026-02-14

## Session Info
- **Bot**: Claude3
- **Date**: 2026-02-14
- **Duration**: ~5 minutes
- **Session 1 Status**: HP 19/20, Hunger 11/20
- **Session 2 Status**: HP 20/20, Hunger 10/20 (CRITICAL - near starvation)

## Bugs Found

### Bug #0: CRITICAL - Crafting Wastes Materials When Server Has Item Pickup Disabled

**Priority**: CRITICAL - Causes permanent loss of resources

**Error Message:**
```
Cannot craft iron_pickaxe: Server has item pickup disabled.
Crafted item dropped on ground but cannot be collected.
Ingredients consumed: recipe materials lost permanently.
```

**What Happened (Session 2):**
1. Bot had iron_pickaxe equipped at session start
2. Iron_pickaxe disappeared during mining (durability or server bug)
3. Bot attempted to craft new iron_pickaxe
4. Crafting consumed 3 iron_ingot + 2 stick
5. Crafted item dropped on ground
6. Server has item pickup disabled - item cannot be collected
7. Materials permanently lost

**Result:**
- Lost: 3 iron_ingot + 2 stick
- Gained: Nothing
- Inventory After: iron_ingot(2), stick(4), NO iron_pickaxe

**Root Cause:**
File: `src/bot-manager/bot-crafting.ts` Lines 256-271

The code has a check for `serverHasItemPickupDisabled` flag, BUT:
1. Flag has 60-second expiry (line 260-269) - allows retry after timeout
2. Check happens AFTER materials are consumed (bot.craft() already executed)
3. Error is thrown too late - materials already gone

```typescript
// CURRENT CODE (BROKEN):
if (managed.serverHasItemPickupDisabled === true && managed.serverHasItemPickupDisabledTimestamp) {
  const timeSinceSet = Date.now() - managed.serverHasItemPickupDisabledTimestamp;

  if (timeSinceSet < 60000) {
    throw new Error(`Cannot craft...`);  // Good - prevents crafting
  } else {
    // BAD: Clears flag after 60s, allows retry that wastes materials
    managed.serverHasItemPickupDisabled = false;
    managed.serverHasItemPickupDisabledTimestamp = undefined;
  }
}

// ... later ...
await bot.craft(recipe, 1, craftingTable);  // Materials consumed HERE
// ... much later ...
// Line 907-914: Detects item not in inventory and throws error
```

**Proposed Fix:**
Move the check to BEFORE `bot.craft()` is called, and don't auto-clear the flag:

```typescript
// At line 823, BEFORE the crafting loop:
if (managed.serverHasItemPickupDisabled === true) {
  throw new Error(
    `Cannot craft ${itemName}: Server has item pickup disabled. ` +
    `Crafted items will drop and be lost. Disconnect/reconnect to retry, ` +
    `or use creative mode.`
  );
}
```

**Impact**: HIGH - Wastes critical resources in survival mode

---

### Bug #1: Torch Crafting - Coal/Charcoal Substitution Not Working

**Error Message:**
```
Cannot craft torch: Failed to craft torch: Error: missing ingredient.
Recipe needs: charcoal(need 1), stick(need 1).
```

**Context:**
- Have 13 coal in inventory
- Have sticks in inventory
- Coal and charcoal should be interchangeable for torch crafting

**Root Cause:**
The code at `src/bot-manager/bot-crafting.ts:527-529` defines coal/charcoal as interchangeable:
```typescript
// Coal and charcoal are interchangeable for torch and other recipes
"coal": ["charcoal"],
"charcoal": ["coal"],
```

However, the recipe matching logic is not properly applying this substitution. The `bot.recipesAll()` from Mineflayer is likely returning a specific recipe that requires "charcoal", and the compatibility check isn't finding our "coal" as a valid substitute.

**Proposed Fix:**
Need to investigate why `findCompatibleItem("charcoal")` at line 579 isn't returning our coal. Possible issues:
1. Recipe uses specific item ID for charcoal that doesn't match coal's ID
2. The compatibility mapping needs to be applied earlier in the recipe filtering
3. Mineflayer's recipe system might need custom logic for coal/charcoal

---

### Bug #2: Crafting Table - Plank Type Specificity

**Error Message:**
```
Cannot craft crafting_table: Failed to craft crafting_table: Error: missing ingredient.
Recipe needs: pale_oak_planks(need 4).
```

**Context:**
- Have 26 birch_planks in inventory
- Any planks should work for crafting table
- Recipe is specifically asking for pale_oak_planks

**Root Cause:**
Similar to Bug #1, the crafting system has plank compatibility mappings at lines 505-514, but the recipe matching isn't applying them correctly. The `bot.recipesAll()` is returning a recipe that specifically requires `pale_oak_planks` and the compatibility check fails to substitute our `birch_planks`.

**Historical Context:**
Comment at line 336-338 indicates this was previously attempted to be fixed:
```typescript
// DISABLED: The general crafting path handles material substitution correctly.
// This special case causes "missing ingredient" errors with non-oak planks.
// Let ALL wooden recipes (stick, crafting_table, wooden_pickaxe, etc.) use the general path.
const simpleWoodenRecipes: string[] = []; // Previously: ["stick", "crafting_table"]
```

The "general path" was supposed to handle this, but it's still failing.

**Proposed Fix:**
1. Debug why `findCompatibleItem("pale_oak_planks")` doesn't return birch_planks
2. Consider re-enabling the special wooden recipe path but fixing it properly
3. Or ensure the general path's compatibility check works for plank substitutions

---

### Bug #3: Survival Routine - Inconsistent Animal Detection

**Observation:**
- `minecraft_survival_routine(priority: "auto")` initially reported finding sheep
- Then immediately said "No food sources found"
- `minecraft_validate_survival_environment()` confirmed animals exist within 150 blocks
- Multiple exploration attempts found no animals

**Context:**
Survival routine code at `src/tools/high-level-actions.ts:460-509`:
- Line 463: `botManager.findEntities(username, undefined, 128)` - searches 128 blocks
- Line 467: Checks if result includes food animal names ("cow", "pig", "chicken", "sheep")
- This SHOULD work if animals are present

**Possible Causes:**
1. Animals are between 128-150 blocks away (validation uses 150, routine uses 128)
2. Timing issue - animals spawned/despawned between checks
3. findEntities returns format that doesn't match the string.includes() check

**Status**: Less critical - may be environment-specific or timing-related

---

## Environment Notes

- Server: localhost:25565
- Y-coordinate: 101 (high altitude)
- Resource gathering disabled above Y:80 (safety feature working correctly)
- Time: Daytime (tick 5194)
- Passive mob spawning appears limited in this world

## Recommendations

1. **Priority: Fix crafting substitution bugs** - These prevent basic gameplay
2. Investigate Mineflayer's recipe system behavior with material substitutions
3. Consider adding debug logging to see what recipes are returned by `bot.recipesAll()`
4. Test with different Minecraft versions to see if recipe IDs changed

## Files to Investigate

- `src/bot-manager/bot-crafting.ts` - Lines 475-624 (recipe matching logic)
- `src/bot-manager/bot-crafting.ts` - Lines 492-555 (findCompatibleItem function)
- `src/tools/high-level-actions.ts` - Lines 460-509 (survival food routine)
