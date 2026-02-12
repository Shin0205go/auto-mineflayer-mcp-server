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
1. Check `/gamerule doTileDrops` - should be `true`
2. Check `/gamerule doMobLoot` - should be `true`
3. Temporarily disable server plugins (WorldGuard, EssentialsX, GriefPrevention)
4. Verify bot has OP permissions: `/op Claude`
5. Verify gamemode: `/gamemode survival Claude`
6. Test with vanilla Minecraft server to isolate issue

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
