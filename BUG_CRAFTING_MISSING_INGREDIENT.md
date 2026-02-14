# BUG: Crafting Fails with "Missing Ingredient" Despite Having Materials

**Date**: 2026-02-14
**Reporter**: Claude3
**Severity**: HIGH - Blocks crafting functionality

## Problem

Crafting stick failed with "missing ingredient" error despite having sufficient birch_planks in inventory.

## Evidence

### Attempt 1: Stick Crafting
```
Command: minecraft_craft("stick", count=4)
Inventory: birch_planks x10
Error: "Cannot craft stick: Failed to craft stick: Error: missing ingredient. Recipe needs: birch_planks(need 2)"
```

### Code Analysis

**Pre-validation (PASSES)**:
- Lines 589-616 in `bot-crafting.ts` correctly verify materials
- `findCompatibleItem("birch_planks")` returns 10 planks
- Recipe is marked as craftable

**Failure Point**:
- Line 864: `await bot.craft(recipe, 1, craftingTable || undefined)`
- Mineflayer's internal craft() throws "missing ingredient"

## Root Cause Analysis

The pre-check logic (our code) correctly identifies that we have the required materials. However, `bot.craft()` (mineflayer library) fails internally when trying to match inventory items to recipe requirements.

### Possible Causes

1. **Recipe ID Mismatch**: The recipe object may specify a specific plank type ID that doesn't match `birch_planks`
2. **Inventory Stack Issues**: Multiple stacks of the same item might not be recognized
3. **Mineflayer Version Incompatibility**: Recipe matching logic may have changed
4. **2x2 vs 3x3 Grid**: Stick should use 2x2 (player inventory) but may be trying 3x3

## Code Path

```
craftItem("stick", 4)
  → Line 503: recipes = bot.recipesAll(item.id, null, null)  // Get 2x2 recipes
  → Line 589-616: Pre-check passes (we have birch_planks)
  → Line 864: bot.craft(recipe, 1, undefined)  // FAILS HERE
  → Error: "missing ingredient"
```

## Workaround

None currently. Crafting is blocked.

## Next Steps

1. Log the recipe object before calling `bot.craft()` to inspect ingredient IDs
2. Test with oak_planks vs birch_planks to see if specific wood types matter
3. Check mineflayer version and recipe format changes
4. Consider manually constructing craft matrix instead of using bot.craft()

## Related Issues

- Server has item pickup disabled (separate issue)
- This crafting bug prevents creating basic tools from planks
