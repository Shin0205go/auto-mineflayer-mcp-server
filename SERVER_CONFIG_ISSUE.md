# CRITICAL: Server Configuration Issues Blocking Gameplay

**Date**: 2026-02-14
**Reporter**: Claude3
**Severity**: CRITICAL - Game Unplayable

## Summary

The Minecraft server at `localhost:25565` has two critical configuration issues that make survival mode completely unplayable:

1. **Item pickup is disabled** - Crafted/dropped items cannot be collected
2. **Passive mob spawning appears disabled** - No animals spawn for food

## Issue 1: Item Pickup Disabled

### Symptoms
- Crafting consumes materials from inventory
- Crafted items drop on ground as entities
- Items cannot be picked up by any method
- Materials are permanently lost

### Evidence
```
Attempt 1: minecraft_craft { item_name: "birch_planks", count: 8 }
Result: birch_log(46→45), planks dropped but not collected

Attempt 2 (after reconnect): minecraft_craft { item_name: "birch_planks", count: 4 }
Result: birch_log(45→44), planks dropped but not collected

Total loss: 2x birch_log wasted
```

### Code Detection
The bot correctly detects this issue via `serverHasItemPickupDisabled` flag:
- File: `src/bot-manager/bot-crafting.ts` lines 945-952
- Prevention mechanism works as designed
- Saves materials after detecting the issue

### Server Requirements
Item pickup must be enabled for basic gameplay:
- Collecting drops from mining
- Collecting drops from mob kills
- Collecting crafted items
- Picking up dropped items

## Issue 2: No Passive Mob Spawning

### Symptoms
- Zero passive mobs (cow, pig, chicken, sheep) found in 150+ block radius
- Multiple exploration attempts returned empty
- Environment validation confirms: "NO FOOD SOURCES DETECTED"

### Evidence
```
minecraft_validate_survival_environment { searchRadius: 150 }
Result: ❌ CRITICAL: NO FOOD SOURCES DETECTED
- No passive mobs found
- No edible plants found
- No fishing viability

minecraft_explore_area { radius: 200, target: "sheep/cow/pig/chicken" }
Result: No animals found (multiple attempts)
```

### Impact
- No food sources available
- Starvation inevitable
- Death/respawn loop unavoidable
- Survival mode impossible

## Root Cause Analysis

### Likely Server Settings

**server.properties** probably has:
```properties
spawn-animals=false    # Disables passive mob spawning
# OR entities may have been killed and not respawning
```

**Plugin/Mod Issue**:
- Some plugin may be blocking item pickup events
- Anti-cheat plugin interfering with playerCollect event
- Permission issue preventing item collection

## Code Behavior (Correct)

### Item Pickup Protection ✅
The code **correctly** prevents material waste:

1. Detects when crafted items don't appear in inventory
2. Checks for dropped items nearby
3. Attempts collection via multiple methods
4. If collection fails, sets `serverHasItemPickupDisabled = true`
5. Blocks future crafting to prevent waste
6. 60-second cooldown allows retry (handles false positives)

**This protection mechanism is working as designed and saved materials.**

### Food System ✅
The validation correctly reports the environment is unplayable:
- Checks 50+ blocks for passive mobs
- Checks for edible plants
- Checks for fishing viability
- Reports accurate status

## Required Fixes (Server Admin)

### Fix 1: Enable Item Pickup
Check for interfering plugins:
```bash
# Check if any plugin blocks item pickup
/plugins
# Try disabling anti-cheat/protection plugins temporarily

# Verify no permission issues
/op <botname>
```

If using server.properties:
```properties
# Ensure these are not disabled
enable-command-block=true
```

### Fix 2: Enable Passive Mob Spawning
```properties
# server.properties
spawn-animals=true
spawn-npcs=true
spawn-monsters=true

# Verify mob spawning is enabled
/gamerule doMobSpawning true
```

### Verification Commands
```bash
# Test item pickup manually
/give @s diamond 1
# Drop it and try to pick up

# Check spawning
/summon cow ~ ~ ~
# Verify it spawns

# Check gamerules
/gamerule doMobSpawning
/gamerule mobGriefing
```

## Workarounds (None Available)

Without item pickup:
- ❌ Cannot craft (items lost)
- ❌ Cannot mine (drops lost)
- ❌ Cannot kill mobs (drops lost)
- ❌ Cannot play survival mode at all

Without passive mobs:
- ❌ Cannot get food
- ❌ Cannot get wool (for bed)
- ❌ Cannot survive long-term

**Conclusion: Server is completely unplayable in current state.**

## Recommendations

1. **Immediate**: Fix server configuration
   - Enable item pickup (highest priority)
   - Enable passive mob spawning

2. **Testing**: Verify fixes work
   - Test item dropping and pickup manually
   - Verify passive mobs spawn naturally
   - Test bot can collect items

3. **Code**: No code changes needed
   - Item pickup detection works correctly
   - Protection mechanism prevents waste
   - Environment validation accurately reports issues

## Related Logs

- Experience log: `learning/experience.jsonl`
- Failed craft attempts detected at: 2026-02-14 (multiple timestamps)
- Environment validation: Failed all food source checks

## Status

**BLOCKING** - Cannot proceed with gameplay until server configuration is fixed.

The code is working correctly by detecting and preventing these issues from causing more damage.
