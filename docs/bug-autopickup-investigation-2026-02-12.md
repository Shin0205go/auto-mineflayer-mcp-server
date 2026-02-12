# Bug Investigation: Item Auto-Pickup Not Working

**Date**: 2026-02-12
**Status**: 🔴 CRITICAL - Blocks core gameplay loop
**Investigator**: Claude (Dev Agent)

## Summary

Item entities are not being automatically collected by the Mineflayer bot, despite being within pickup range (< 1 block). This completely breaks the mining → collecting → crafting gameplay loop.

## Evidence

### Test Results

1. **Item Entities Detected**: ✅
   - Items are correctly detected as entities
   - Distance measurements show items at 0.3-0.6 blocks (well within auto-pickup range of ~1 block)
   - Items persist for extended periods (5+ minutes observed)

2. **Auto-Pickup**: ❌
   - Items at 0.3-0.6 blocks NOT collected automatically
   - Manual collection attempts (moving through item position) also fail
   - No change in inventory after multiple collection attempts

3. **Item Drop Behavior**:
   - Blocks successfully break when dug
   - Item entities spawn correctly at block location
   - Wrong tool usage (shears/pickaxe on logs) still spawns item entities
   - Items visible via `get_nearby_entities` with precise coordinates

### Example Session Data

```
Position: (-7.5, 121.0, 7.5)
Items detected:
- item at (0.3 blocks) position (-7.5, 118.0, 7.1)
- item at (0.6 blocks) position (-7.9, 118.0, 7.9)

After minecraft_collect_items:
- Result: "No items collected after 2 attempts"
- Items still present: YES
- Inventory change: NONE (no birch_log added)
```

## Investigation Steps Taken

### 1. Code Analysis
- Reviewed `bot-manager/bot-items.ts::collectNearbyItems()`
- Function relies entirely on Minecraft's server-side auto-pickup
- No manual pickup API available in Mineflayer v4.20.1
- Item detection logic correctly identifies item entities

### 2. Attempted Fix
**File**: `src/bot-manager/bot-items.ts`
**Changes**:
- Enhanced item approach logic with multiple strategies:
  1. Direct forward movement toward item
  2. Pathfinder GoalBlock to move exactly to item position
  3. Small circular movement pattern around item
- Added extensive debug logging
- Increased wait times for collision detection

**Result**: ❌ Fix did not resolve the issue

### 3. Debug Logging Mystery
- Added `console.error` debug statements throughout collection function
- Logs do NOT appear in server output despite:
  - Code successfully compiling
  - Compiled .js files containing debug statements
  - Server restart confirmed (new PID)
  - Function returning expected error messages

**Possible explanations**:
- stderr redirection issue (unlikely - other logs appear)
- Function exiting before debug statements (contradicted by return message)
- Unknown caching or module loading issue

## Root Cause Hypotheses

### Hypothesis 1: Server Configuration ⭐ MOST LIKELY
The Minecraft server may have:
- `doTileDrops` set to false
- Custom plugin blocking item pickup
- Modified pickup radius (set to 0)
- Player-specific pickup restrictions

**Evidence**:
- Items spawn correctly (rules out doTileDrops entirely)
- Items never despawn or get collected
- Behavior consistent across reconnects

### Hypothesis 2: Mineflayer Bot Permissions
The bot might lack:
- Proper gamemode (stuck in spectator?)
- Entity collision enabled
- Pickup capability flag

**Counter-evidence**:
- Bot can interact with blocks (dig, place)
- Bot has survival inventory
- Movement works normally

### Hypothesis 3: Item Entity Format Mismatch
The item entities might be:
- Custom fake entities
- Different entity type than expected
- Using non-standard metadata format

**Counter-evidence**:
- Entities detected as `name: "item", type: "passive"`
- Standard entity.position available
- Spawned from normal block breaking

## Recommended Next Steps

###  1. Server-Side Investigation (PRIORITY)
```bash
# Test these Minecraft commands:
/gamerule doTileDrops            # Verify drops enabled
/gamemode survival @a            # Ensure survival mode
/gamerule maxEntityCramming      # Check entity limits
```

### 2. Alternative Approaches

**A. Install mineflayer-collectblock plugin**
```bash
npm install mineflayer-collectblock
```
- Provides manual `bot.collectBlock.collect(block)` API
- May bypass auto-pickup issues

**B. Test with vanilla Minecraft server**
- Spin up local vanilla server
- Test if auto-pickup works there
- Isolates server vs. client issue

**C. Implement custom pickup via bot.attack()**
- Some servers require attacking item entities to collect
- Test: `bot.attack(itemEntity)`

### 3. Code Improvements (Regardless of Root Cause)

**Add comprehensive error handling**:
```typescript
// Check bot state before collection
if (!bot.entity || !bot.inventory) {
  throw new Error("Bot not properly initialized");
}

// Log entity metadata for debugging
for (const entity of Object.values(bot.entities)) {
  if (entity.name === "item") {
    console.error(`Item entity: ${JSON.stringify({
      id: entity.id,
      position: entity.position,
      metadata: entity.metadata,
      objectType: entity.objectType,
      velocity: entity.velocity
    })}`);
  }
}
```

## Impact

**Severity**: 🔴 CRITICAL

**Blocks**:
- ✗ Resource gathering (can't collect mined blocks)
- ✗ Crafting (can't get materials)
- ✗ Food collection (can't pick up drops from animals)
- ✗ All survival gameplay loops

**Workarounds**: NONE currently available

## Files Modified

- `src/bot-manager/bot-items.ts` - Enhanced collection logic (not yet effective)
- Build successful, server restarted, issue persists

## Timeline

- 9:00 AM - Connected to server, confirmed items not collecting
- 9:01 AM - Implemented multi-strategy collection approach
- 9:02 AM - Build + restart, issue persists
- 9:03 AM - Added debug logging, logs not appearing
- 9:05 AM - Created this investigation report

## Conclusion

The auto-pickup mechanism is fundamentally broken, likely due to **server-side configuration**. The attempted client-side fix (enhanced movement patterns) does not resolve the issue because the underlying problem appears to be that the server is not triggering item collection events when the bot collides with item entities.

**Immediate action required**: Investigate server configuration before proceeding with further gameplay development.
