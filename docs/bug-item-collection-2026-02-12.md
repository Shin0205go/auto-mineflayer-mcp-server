# Item Collection Bug Report - 2026-02-12

## Summary

Critical bug discovered: Dropped items are not being collected even when bot is within auto-pickup range (< 1 block).

## Reproduction Steps

1. Connected to Minecraft server (localhost:60038)
2. Dug 2 birch_log blocks at positions (0,121,-8) and (0,120,-8)
3. Items dropped and showed as entities via `minecraft_get_nearby_entities`
4. Called `minecraft_collect_items` - returned "No items collected"
5. Moved directly to item position (0.4, 120, -7.1) - items still not collected
6. Items remained visible as "item" entities at 0.4-0.6 blocks distance

## Evidence

### Item Entity Detection
```json
[
  {
    "name": "item",
    "type": "passive",
    "distance": "0.4",
    "position": {"x": "0.4", "y": "120.0", "z": "-7.1"}
  },
  {
    "name": "item",
    "type": "passive",
    "distance": "0.6",
    "position": {"x": "0.4", "y": "120.0", "z": "-7.9"}
  }
]
```

### Bot Position
```
(-1.0, 121.0, -9.0) → moved to → (0.7, 120.0, -7.3)
Distance to nearest item: 0.4 blocks (well within auto-pickup range)
```

### Collection Attempts
- `minecraft_collect_items()`: Failed - "No items collected after 2 attempts"
- Direct movement to item position: Failed - items still not picked up
- Inventory check: No birch_log added

## Root Cause Analysis

Looking at `src/bot-manager/bot-items.ts` (`collectNearbyItems` function):

1. **Entity Detection**: Items are correctly detected (confirmed by get_nearby_entities)
2. **Pathfinding**: Bot successfully moved to item position
3. **Auto-pickup**: Minecraft auto-pickup range is ~1 block, bot is at 0.4 blocks

Possible causes:
1. Server configuration issue (`/gamerule doTileDrops`?)
2. Mineflayer auto-pickup not triggering
3. Item entity metadata not matching expected format
4. Race condition - items spawning after collection attempt

## Code Investigation

### Current Implementation (bot-items.ts:19-99)

```typescript
export async function collectNearbyItems(bot: Bot): Promise<string> {
  // ... detection logic ...

  const findItems = () => {
    return allEntities.filter((entity) => {
      // Item detection checks
      const isItem = entity.id !== bot.entity.id && (
        entity.name === "item" ||
        entity.type === "other" ||
        entity.displayName === "Item" ||
        (entity.entityType !== undefined && entity.entityType === 2)
      );
      return isItem;
    });
  };

  // ... movement logic ...
}
```

**Issue**: The function correctly detects items but doesn't manually trigger pickup - relies on Minecraft auto-pickup which isn't working.

## Proposed Fix

Add explicit item pickup mechanism instead of relying solely on auto-pickup:

```typescript
// After moving close to item, explicitly try to collect it
if (distance < 1.5) {
  // Wait for auto-pickup
  await delay(500);

  // Check if item entity still exists
  const itemStillExists = bot.entities[item.id];
  if (itemStillExists) {
    // Auto-pickup failed - try manual approach
    // Option 1: Use bot.nearestEntity to re-acquire
    // Option 2: Check server settings
    // Option 3: Increase wait time (server lag?)
  }
}
```

## Workaround

For now, avoid relying on item collection. Use creative mode commands or existing inventory items.

## Priority

**CRITICAL** - This breaks core gameplay loop (mining → collection → crafting)

## Next Steps

1. Check Minecraft server `/gamerule doTileDrops` setting
2. Test with different item types (not just wood)
3. Add debug logging to track item entity lifecycle
4. Consider implementing manual pickup mechanism
5. Test on different Minecraft server versions

## Session Context

- Server: localhost:60038
- Bot: Claude (agentType: "game")
- Minecraft Version: Auto-detected
- Bot Position: High birch tree location (-0.5, 123, -7.5)
- Full health/hunger: 20/20
