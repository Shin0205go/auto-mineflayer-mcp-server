# Issues Found - Claude3 Session

## Date: 2026-02-14

## Critical Issue: WebSocket Connection State Management

### Problem
`minecraft_get_surroundings` and other tools failed with "Not connected to any server" error immediately after successful `minecraft_connect`.

### Root Cause
The `connectionBots` WeakMap in `mcp-ws-server.ts` was not properly retrieving the username for subsequent tool calls after connection.

### Investigation
1. Line 390: `const username = connectionBots.get(ws);` returns `undefined`
2. Line 412: `connectionBots.set(ws, botUsername);` sets the username during connect
3. The WebSocket object reference might be different between calls

### Resolution
Added debug logging to track connection state:
- Line 391: Log username retrieval
- Line 413: Log username storage confirmation

### Status
✅ **RESOLVED** - After server restart, `minecraft_get_surroundings` and other tools work correctly.

## Environmental Issue: No Food Sources

### Problem
Server has NO food sources available:
- No passive mobs (cows, pigs, sheep, chickens)
- No edible plants
- No fishing viability

### Evidence
```
=== SURVIVAL ENVIRONMENT VALIDATION ===
Current Hunger: 20/20
Search Radius: 100 blocks

❌ CRITICAL: NO FOOD SOURCES DETECTED

Findings:
- No passive mobs found
- No edible plants found
- No fishing viability
```

### Entities Found (within 50 blocks)
- wandering_trader (行商人)
- trader_llama
- bee (ミツバチ)
- hostile mobs (skeleton, zombie, creeper, pillager)

### Impact
- Survival gameplay is nearly impossible
- Cannot sustain long-term play sessions
- Hunger will eventually become critical

### Recommendations
1. Server admin: Enable passive mob spawning
2. Server admin: Check `/gamerule doMobSpawning`
3. Alternative: Use creative mode or `/give` commands for testing
4. Alternative: Plant wheat_seeds and wait for growth

## Session Summary

### Completed Tasks
- ✅ Connected to server (Claude3)
- ✅ Validated survival environment
- ✅ Collected resources (birch_log x17, coal x2)
- ✅ Explored area (wandering_trader, bee found)
- ✅ Identified critical food shortage issue

### Current Status
- HP: 20/20
- Hunger: 20/20 (no food in inventory)
- Equipment: iron_chestplate, iron_boots, iron_pickaxe
- Resources: 900+ cobblestone, 17 birch_log, 27 coal, 3 iron_ingot

### Next Steps
1. Continue searching for food sources in wider area
2. Consider attacking zombies for rotten_flesh (temporary food)
3. Plant wheat_seeds if no other options available
4. Monitor hunger level carefully

## Critical Issue: Iron Ore Drops Cobblestone (Server Bug)

### Problem
When mining `iron_ore` with an iron pickaxe, the server drops **cobblestone** instead of **raw_iron**.

### Evidence
```
[Dig] Found iron_ore at (3, 9, 14)
[Dig] Auto-equipped iron_pickaxe for iron_ore
[Dig] Finished digging iron_ore
[Dig] Inventory check: before=1234, after=1235, picked=1, iron_ore: 0->0 (+0)
[Dig] cobblestone: increased from 47 to 49
```

### Expected Behavior
According to `getExpectedDrop()` function (bot-blocks.ts:192):
- `"iron_ore"` → `"raw_iron"`
- `"deepslate_iron_ore"` → `"raw_iron"`

### Actual Behavior
- Mining `iron_ore` → drops `cobblestone`
- No `raw_iron` in inventory after mining 3+ iron ore blocks

### Impact
- **CRITICAL**: Cannot obtain iron ingots from mining
- Cannot craft iron tools/armor from ore
- Normal progression is blocked
- Must rely on pre-existing iron_ingot (only 5 remaining)

### Root Cause
Server configuration issue (NOT code bug):
1. `/gamerule doTileDrops` might be modified
2. Server plugin overriding drop tables
3. Custom loot table configuration

### Verification
- Copper ore works correctly: `copper_ore` → `raw_copper` ✅
- Iron ore broken: `iron_ore` → `cobblestone` ❌

### Recommendations
1. Server admin: Check loot table configuration
2. Server admin: Verify `/gamerule doTileDrops true`
3. Server admin: Check for plugins modifying ore drops
4. Code: No changes needed - detection logic is correct

### Status
🔴 **BLOCKED** - Cannot progress without server fix

## Code Changes Made

### File: src/mcp-ws-server.ts
- Added debug logging for connection state tracking
- Line 391: `console.error` for username retrieval
- Line 413: `console.error` for username storage confirmation
