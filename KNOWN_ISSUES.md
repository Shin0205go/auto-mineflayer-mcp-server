# Known Issues

## Server Configuration Issue: Item Pickup Disabled (Critical)

### Issue
Items drop from broken blocks but **cannot be picked up** by the bot, making survival gameplay impossible.

### Impact
- **CRITICAL**: Cannot collect ANY resources (wood, stone, ores, drops)
- Survival progression completely blocked
- Cannot test most gameplay features

### Symptoms
- Blocks break successfully ✅
- Items spawn on ground ✅
- Items visible in entity list ✅
- Automatic pickup fails ❌
- Manual movement through items fails ❌

### Root Cause
**Server configuration or plugin blocking item pickup**, not a code bug:
- WorldGuard, EssentialsX, or GriefPrevention may block item collection
- Server may have custom anti-cheat preventing entity interaction
- Gamemode restrictions (adventure mode)
- Server-side permission issues

### Diagnosis Tool
Use `minecraft_diagnose_server` to automatically detect this issue:
```
minecraft_diagnose_server()
```

The tool will:
1. Dig a test block
2. Detect if items spawn but cannot be collected
3. Report server configuration issues

### Server Observations (2026-02-13)
- ✅ Passive mobs (bees) DO spawn - animal spawning works
- ❌ Item pickup completely disabled
- ✅ Block breaking works
- ✅ Hostile mobs spawn

Previous session incorrectly reported "no passive mob spawning" - this was due to location, not server config.

### Recommended Fixes (Server Admin)
1. Check `/gamerule doTileDrops` - should be `true` -> ✅ Tested 2026-02-13 - NO EFFECT
2. Check `/gamerule doMobLoot` - should be `true`　 -> 実施した
3. Temporarily disable server plugins (WorldGuard,　しらない EssentialsX, GriefPrevention)
4. Verify bot has OP permissions: `/op Claude`　対象外
5. Verify gamemode: `/gamemode survival Claude` -> 実施した
6. Test with vanilla Minecraft server to isolate issue　しらない

### Latest Test Results (2026-02-13 09:30)
**Confirmed**: Item pickup completely broken even after gamerule changes
- Executed `/gamerule doTileDrops true` via chat → No effect
- Mined dirt block at (8, 109, -1)
- Item entity spawned at (8.7, 109.0, 0.1)
- Bot position (8.8, 109.0, 0.3) = **0.4 blocks away**
- Item remained on ground for 60+ seconds
- Auto-pickup never triggered (vanilla range is ~1 block)
- Manual collection via `minecraft_collect_items()` failed
- **Conclusion**: This is a server plugin or core configuration issue, not a gamerule issue

### Date
2026-02-13 (Updated - Confirmed Blocking)

---

## Crafting System Limitation (Known)

### Issue
`minecraft_craft` tool fails with error: `"missing ingredient: pale_oak_planks"` even when `birch_planks` are available in inventory.

### Impact
- Cannot craft basic items: `stick`, `crafting_table`
- Blocks survival progression
- Affects all planks-based recipes

### Root Cause
Mineflayer library limitation:
1. `minecraft-data` package includes `pale_oak` recipes (Minecraft 1.21+)
2. `bot.craft()` performs strict ingredient ID matching
3. Wood type substitution not supported in recipe execution

### Reproduction
```javascript
// With birch_planks x5 in inventory
await bot.craft("stick", 1);
// Error: missing ingredient. Recipe needs: pale_oak_planks(need 2)
```

### Attempted Solutions
1. ✅ Added special handling for planks-based recipes
2. ✅ Implemented ingredient compatibility checking
3. ❌ Still fails at `bot.craft()` execution

### Required Solution
Choose one:
1. **Update minecraft-data**: Fix recipe definitions to use generic planks
2. **Low-level crafting**: Implement direct crafting window manipulation
3. **Version downgrade**: Use Minecraft 1.20 or earlier

### Workaround
- Use pre-existing tools (e.g., iron_sword)
- Focus on non-crafting activities
- Gather resources that don't require sticks

### Related Files
- `src/bot-manager/bot-crafting.ts`: Lines 332-410 (special handling code)
- Commit: baffe8e "fix: Improve planks-based crafting compatibility"

### Date
2026-02-12

---

## Critical Survival Loop: Starvation Death Spiral (Critical)

### Issue
Bot enters unrecoverable death spiral when HP < 1 and hunger < 2 with no food available. Connection drops when attempting to move in this state.

### Symptoms from 2026-02-13 Session
- HP: 0.4/20 (one hit from death)
- Hunger: 1/20 (starving, taking damage)
- Oxygen: 0/20 (drowning in some cases)
- No food in inventory
- Attempting to move → "MCP error -32000: Connection closed"

### Root Cause Analysis
1. **Starvation damage**: At hunger < 6, bot takes periodic damage
2. **Movement attempts fatal**: Any pathfinder operation with critical HP causes instability
3. **No recovery path**: Without food, bot cannot heal
4. **Connection instability**: WebSocket/MCP connection drops during critical HP movement

### Failed Recovery Attempts
- ❌ Attack passive mobs (llama) → requires movement → connection drops
- ❌ Pillar up → no solid ground or confined space
- ❌ Flee → requires movement → would fail
- ❌ Eat → no food available

### Solution: Emergency Respawn Tool
Added `minecraft_respawn` tool (commit 4b014cd) to handle this exact scenario:
- Only works when HP ≤ 4 (safety guard)
- Strategic reset to spawn with full HP/hunger
- **Trade-off**: Loses inventory (acceptable for survival)
- Use case: "Trapped, no food, critical HP"

**Bug Fix (commit a410cc6)**: Respawn tool was registered but NOT exposed to Game Agents. Added to `GAME_AGENT_TOOLS` filter so it's now actually callable.

### Prevention Strategies
1. **Proactive food management**: Keep food > 12 at all times
2. **Emergency food crafting**: Prioritize food before mining/exploring
3. **HP monitoring**: Flee or find shelter when HP < 8
4. **Respawn as last resort**: Better to reset than crash

### Recommended Server-Side Fix
Enable natural passive mob spawning near spawn point to ensure food availability on respawn.

### Date
2026-02-13

---

## Complete Absence of Food Animals (Critical)

### Issue
Survival environment validation (2026-02-14) detected **NO FOOD SOURCES** in 100-block radius:
- ❌ No passive food mobs (cow, pig, chicken, sheep)
- ❌ No edible plants (wheat, carrots, potatoes)
- ❌ No water for fishing
- ✅ Bees present (non-food mob)

### Impact
- **CRITICAL**: Survival impossible without external food sources
- Bot will eventually starve to death regardless of skill
- Cannot complete survival gameplay tasks

### Validation Results (2026-02-14 Session)
```
=== SURVIVAL ENVIRONMENT VALIDATION ===
❌ CRITICAL: NO FOOD SOURCES DETECTED
- No passive mobs found
- No edible plants found
- No fishing viability
⚠️ WARNING: Survival may be impossible in this environment!
```

Exploration attempts:
- Searched radius 50 blocks for: cow, pig, chicken (all failed)
- Searched radius 80 blocks for: sheep (failed)
- Searched 32 blocks for: water (failed)
- Searched 32 blocks for: wheat/crops (failed)

### Possible Causes
1. **World generation seed**: Spawn area in biome hostile to passive mob spawning
2. **Mob spawning disabled**: Server configuration `spawn-animals=false`
3. **Chunk loading issue**: Mobs may exist but chunks not loaded
4. **Despawn mechanics**: Passive mobs killed/despawned before bot arrival

### Observations
- Bees present → Some passive mobs CAN spawn
- Hostile mobs present → Mob spawning generally works
- Item drops present → World is active and functional

### Recommendations
1. **Server admin**: Check `server.properties` → `spawn-animals=true`
2. **Bot**: Use `/tp` to relocate to food-rich biome (plains, forest)
3. **Testing**: Spawn in creative mode or use `/give` for food
4. **Long-term**: Implement emergency food crafting from non-standard sources

### Date
2026-02-14
