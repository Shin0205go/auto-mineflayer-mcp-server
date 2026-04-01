# Bug Report: Bread Crafting Recipe Not Available

## Summary
Claude1 (Player) cannot craft bread despite having wheat x3, causing critical food shortage (HP=10, Food=0).

## Details
- **Cause**: `bread` recipe is not registered in mineflayer's `bot.recipesFor()` database
  - `bot.recipesFor(breadItem.id)` returns empty array `[]`
  - Manual GUI-based crafting via `window.click()` also fails to generate bread output

- **Coordinates**: (26, 101, 3) — near spawned farm
- **Inventory State**: wheat x3, wheat_seeds x24, other items (no consumable food)
- **Game Mechanics**:
  - wheat (raw) is not directly consumable
  - bread is the ONLY food source crafted from wheat
  - Crafting recipe: wheat x3 → bread x1 (3-slot horizontal line)

- **Last Actions**:
  1. Harvested 6 mature wheat blocks (metadata=7) → wheat x3 total
  2. Attempted bot.craft(recipe) → 0 recipes found
  3. Attempted crafting table GUI activation and window.click() → no output slot change
  4. Searched 10+ chests → no pre-existing bread
  5. Attempted animal hunting → pathfinder timeout (pig 158.6m away)

- **Error Messages**:
  - `bot.recipesFor(breadItemId)` returns `[]` (empty)
  - `window.click()` did not trigger recipe on output slot
  - No crafting table GUI found after first activation (table may have despawned or been consumed)

- **Status**: CRITICAL — Player at imminent death risk
  - HP: 10/20 (1 hit from creeper/zombie)
  - Food: 0/20 (cannot sprint, starve damage at night)
  - Food crisis: wheat only, cannot convert to bread

## Root Cause Analysis
The issue is likely in the mineflayer recipe registry:
- Either `recipes.json` is missing bread recipe definition
- Or the bread item ID lookup (`bot.registry.itemsByName['bread']`) fails silently
- Or the crafting table block activation doesn't properly sync recipe data

## Impact
- Player cannot self-recover from food shortage
- Requires admin intervention: `/give Claude1 bread 3`
- Without food, immediate death likely (enderman @23m, 2 enderman @25m)

## Workarounds Attempted
1. ✗ bot.craft() with recipe
2. ✗ crafting table GUI click sequence
3. ✗ chest looting (all empty)
4. ✗ animal hunting (pathfinder distance limit)
5. ✓ Reported to admin, awaiting response

## Suggested Fix
1. **Server**: Verify `recipes.json` includes bread recipe
2. **Mineflayer**: Confirm `bot.registry.itemsByName` lookup works for all vanilla items
3. **Fallback**: Admin command `/give @p bread 3` or preload player inventory with bread

## Related Code
- `mc-execute.cjs` → lines with `bot.craft()`, `bot.recipesFor()`
- `bot-api/SKILL.md` → no mention of bread crafting workarounds
- `crafting-chain/SKILL.md` → missing bread recipe handling

---
**Reported**: 2026-04-02 23:XX UTC
**Bot**: Claude1
**Status**: Awaiting admin response or code fix
