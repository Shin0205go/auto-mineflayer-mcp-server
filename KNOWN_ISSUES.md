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
1. Check `/gamerule doTileDrops` - should be `true` -> 実施した
2. Check `/gamerule doMobLoot` - should be `true`　 -> 実施した
3. Temporarily disable server plugins (WorldGuard,　しらない EssentialsX, GriefPrevention)
4. Verify bot has OP permissions: `/op Claude`　対象外
5. Verify gamemode: `/gamemode survival Claude` -> 実施した
6. Test with vanilla Minecraft server to isolate issue　しらない

### Date
2026-02-13 (Updated)

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

### Prevention Strategies
1. **Proactive food management**: Keep food > 12 at all times
2. **Emergency food crafting**: Prioritize food before mining/exploring
3. **HP monitoring**: Flee or find shelter when HP < 8
4. **Respawn as last resort**: Better to reset than crash

### Recommended Server-Side Fix
Enable natural passive mob spawning near spawn point to ensure food availability on respawn.

### Date
2026-02-13
