# CRITICAL BUG: Server Item Pickup Disabled - Bot Cannot Survive

**Date**: 2026-02-14
**Reporter**: Claude3
**Severity**: CRITICAL - Blocks all gameplay

## Problem

The Minecraft server at localhost:25565 has item pickup completely disabled. This makes survival gameplay impossible.

## Evidence

1. **Killed 2 sheep** - Items spawned but could not be collected
2. **Items visible in entity list**:
   ```
   {
     "name": "item",
     "type": "passive",
     "distance": "4.2",
     "position": {"x": "-65.7", "y": "111.0", "z": "-137.5"}
   }
   ```
3. **collect_items reported**: "No items collected after 2 attempts - items may have despawned or be inaccessible"
4. **Inventory unchanged** after killing animals and calling collect_items

## Impact

- ❌ Cannot obtain food → Starvation death (HP dropped from 20→4, hunger 2→0 in <2 minutes)
- ❌ Cannot collect mined resources
- ❌ Cannot collect crafted items (already documented in KNOWN_ISSUES.md)
- ❌ Survival gameplay completely impossible

## Health Timeline

- Start: HP 20/20, Hunger 2/20
- After 2 sheep kills: HP 20/20, Hunger 2/20 (no food collected)
- After ~2 minutes: HP 4/20, Hunger 0/20 (starvation damage)

## Root Cause

Server configuration issue documented in KNOWN_ISSUES.md since 2026-02-13:
- Item pickup completely disabled
- Tested `/gamerule doTileDrops true` → No effect
- Tested `/gamerule doMobLoot true` → No effect
- Items spawn correctly but auto-pickup doesn't work

## Code Issue

`collectNearbyItems()` function in `bot-items.ts` does NOT set the `serverHasItemPickupDisabled` flag when items exist but can't be collected. This flag is only set during crafting failures.

**Missing logic**: When items are detected by getNearbyEntities() but inventory doesn't change after collection attempts, the code should:
1. Set `managed.serverHasItemPickupDisabled = true`
2. Set `managed.serverHasItemPickupDisabledTimestamp = Date.now()`
3. Return clear error message to agent

## Recommended Fixes

### Short-term (Code Fix)
Add detection logic to `collectNearbyItems()`:
```typescript
// After collection attempts
if (items.length > 0 && actuallyCollected === 0) {
  managed.serverHasItemPickupDisabled = true;
  managed.serverHasItemPickupDisabledTimestamp = Date.now();
  return "CRITICAL: Server has item pickup disabled! Cannot collect items. Survival impossible.";
}
```

### Long-term (Server Fix)
Server admin needs to:
1. Disable conflicting plugins (WorldGuard, EssentialsX, etc.)
2. Test with vanilla Minecraft server
3. Check for entity pickup radius settings
4. Verify no protection plugins blocking item pickup

## Workaround

**NONE** - Survival is impossible on this server without fixing item pickup.

Agents should:
1. Detect this early using `minecraft_validate_survival_environment`
2. Exit immediately with clear error message
3. Not waste time attempting survival gameplay
