# BUG: Crafting Consumes Materials Before Detecting Item Pickup Disabled

**Date**: 2026-02-14
**Reporter**: Claude2
**Severity**: CRITICAL - Causes permanent resource loss
**Status**: Confirmed - Occurred again

## Summary

When crafting items on a server with item pickup disabled, the code detects the issue AFTER materials are consumed, resulting in permanent resource loss. The error is correctly thrown, but too late to prevent waste.

## This Occurrence

**Session**: 2026-02-14, Claude2
**Attempted Craft**: stone_pickaxe
**Materials Lost**:
- 3x cobblestone (reduced from 58 to 55)
- 2x stick (reduced from 14 to 12)

**Error Message**:
```
Cannot craft stone_pickaxe: Server has item pickup disabled. Crafted item dropped on ground but cannot be collected. This server configuration is incompatible with crafting. Ingredients consumed: recipe materials lost permanently.
```

## Code Flow Analysis

### Current Execution Order (src/bot-manager/bot-crafting.ts)

1. **Line 793**: `await bot.craft(tryRecipe, 1, craftingTable || undefined);`
   - **MATERIALS CONSUMED HERE** ❌
   - Crafting completes successfully
   - Ingredients removed from inventory

2. **Line 797**: Wait 1500ms for crafting to complete

3. **Line 811**: Check if item in inventory
   - Item not found (dropped as entity instead)

4. **Line 820-852**: Attempt to collect dropped items
   - `collectNearbyItems()` called
   - Fails due to server item pickup disabled

5. **Line 867**: **Error thrown** (too late!)
   ```typescript
   throw new Error(`Cannot craft ${itemName}: Server has item pickup disabled...`);
   ```

### Problem
By the time the error is thrown (line 867), the damage is done:
- Ingredients were consumed at line 793
- Crafted item dropped on ground
- Cannot undo the crafting operation
- **Resources lost permanently**

## Root Cause

The detection logic is **reactive** (post-crafting) instead of **proactive** (pre-crafting). There's no validation before `bot.craft()` is called to check if the server allows item pickup.

## Impact

- **Resource Depletion**: Each failed craft attempt wastes materials
- **Gameplay Blocker**: Cannot craft tools needed for progression
- **Poor UX**: Error message says materials are "lost permanently" but allows retry
- **Infinite Loop Risk**: Agents might retry crafting repeatedly, losing more resources

## Previous Occurrences

This is a **recurring bug** documented in:
- `SERVER_ISSUES.md` - iron_helmet craft (lost 5 iron ingots)
- `SESSION_REPORT_2026-02-14_06-14_Claude2.md` - birch_planks craft (lost 1 birch log)
- `SESSION_REPORT_2026-02-14_09-30_Claude2.md` - stone_pickaxe craft (lost 3 cobblestone + 2 sticks)
- **This session** - stone_pickaxe craft (lost 3 cobblestone + 2 sticks again)

Each time, materials are lost before the error is detected.

## Proposed Fix

### Solution 1: Pre-Crafting Item Pickup Test (Recommended)

Add validation BEFORE calling `bot.craft()` to test if item pickup works:

```typescript
// Add before line 782 (before the try block)

// PRE-FLIGHT CHECK: Verify item pickup is enabled on server
// Prevents resource waste by testing pickup capability before crafting
async function validateItemPickup(bot: Bot): Promise<boolean> {
  // Check if we've already validated this session
  if ((bot as any)._itemPickupValidated !== undefined) {
    return (bot as any)._itemPickupValidated;
  }

  try {
    // Drop a dirt/cobblestone block (expendable item)
    const testItem = bot.inventory.items().find(i =>
      i.name === "dirt" || i.name === "cobblestone" || i.name === "gravel"
    );

    if (!testItem) {
      // No expendable items to test with - assume pickup works
      (bot as any)._itemPickupValidated = true;
      return true;
    }

    // Drop 1 item
    await bot.toss(testItem.type, null, 1);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Try to pick it back up
    const { collectNearbyItems } = await import("./bot-items.js");
    const beforeCount = bot.inventory.items()
      .filter(i => i.name === testItem.name)
      .reduce((sum, i) => sum + i.count, 0);

    await collectNearbyItems(bot);
    await new Promise(resolve => setTimeout(resolve, 1000));

    const afterCount = bot.inventory.items()
      .filter(i => i.name === testItem.name)
      .reduce((sum, i) => sum + i.count, 0);

    // If we recovered the item, pickup works
    const pickupWorks = (afterCount >= beforeCount);
    (bot as any)._itemPickupValidated = pickupWorks;
    return pickupWorks;

  } catch (err) {
    console.error(`[Craft] Item pickup test failed: ${err}`);
    (bot as any)._itemPickupValidated = false;
    return false;
  }
}

// Then at line 782, BEFORE the try block:
const canPickupItems = await validateItemPickup(bot);
if (!canPickupItems) {
  throw new Error(
    `Cannot craft ${itemName}: Server has item pickup disabled. ` +
    `Crafting would consume materials permanently without receiving the item. ` +
    `Contact server admin to enable item pickup for this bot.`
  );
}

try {
  // ... existing crafting code
}
```

### Solution 2: Inventory Transaction Check

Add transaction verification:

```typescript
// Before crafting, snapshot inventory
const beforeInventory = bot.inventory.items().map(i => ({
  name: i.name,
  count: i.count
}));

await bot.craft(tryRecipe, 1, craftingTable || undefined);

// After crafting, verify materials were consumed
const afterInventory = bot.inventory.items();
const ingredientsConsumed = /* check if materials decreased */;

if (ingredientsConsumed && !craftedItemInInventory) {
  // Materials consumed but no output = server issue
  throw new Error(`Cannot craft ${itemName}: Server configuration issue...`);
}
```

### Solution 3: Session-Level Validation

Add to `minecraft_connect()` or session startup:

```typescript
// After bot connects, test item pickup capability
const supportsItemPickup = await testItemPickup(bot);
if (!supportsItemPickup) {
  console.warn(`[WARNING] Server has item pickup disabled - crafting will fail!`);
  // Store in bot metadata
  (bot as any).itemPickupDisabled = true;
}

// Then in craft():
if ((bot as any).itemPickupDisabled) {
  throw new Error(`Cannot craft: Server does not support item pickup for this bot`);
}
```

## Comparison with Working Detection

The current error detection (line 867) is **100% accurate** - it correctly identifies when items cannot be picked up. The problem is **timing** - it runs after materials are consumed.

We need to move this detection **before** line 793 (`bot.craft()`).

## Test Case

After implementing fix, this should pass:

```typescript
// Given: Server with item pickup disabled
const bot = /* connected bot */;

// When: Attempting to craft
try {
  await craftItem(managed, "stone_pickaxe", 1);
  assert.fail("Should have thrown error");
} catch (err) {
  // Then: Error thrown BEFORE materials consumed
  const sticksBefore = /* initial stick count */;
  const sticksAfter = bot.inventory.items()
    .filter(i => i.name === "stick")
    .reduce((sum, i) => sum + i.count, 0);

  assert.equal(sticksBefore, sticksAfter, "Sticks should not be consumed");
  assert.include(err.message, "item pickup disabled");
}
```

## Recommendation

**Implement Solution 1** (Pre-Crafting Item Pickup Test) because:
1. ✅ Prevents all resource loss
2. ✅ One-time test per session (cached result)
3. ✅ Uses expendable items (dirt/cobblestone)
4. ✅ Clear error message before any damage
5. ✅ No changes to crafting logic needed

## Related Files

- `src/bot-manager/bot-crafting.ts:793-867` - Current crafting logic
- `src/bot-manager/bot-items.ts` - Item collection logic
- `SERVER_ISSUES.md` - Server configuration documentation

---

**Next Step**: Implement pre-flight item pickup validation to prevent future resource loss.
