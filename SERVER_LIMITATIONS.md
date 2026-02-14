# Server Limitations

## Auto-Pickup Disabled (CRITICAL)

**Status**: CONFIRMED (2026-02-14)

### Problem
The Minecraft server at `localhost:25565` has **automatic item pickup disabled**. This makes crafting effectively unusable.

### Evidence
1. Gamerules are correct:
   - `doTileDrops = true`
   - `doEntityDrops = true`
   - `doMobLoot = true`

2. Items DO drop as entities when crafted/mined
3. Items DO NOT auto-collect when bot walks within 1 block
4. `collectNearbyItems()` moves to items but they remain on ground

### Test Case
```
1. Craft iron_helmet using crafting table
2. Item successfully crafted (ingredients consumed)
3. Item drops as entity on ground
4. Bot approaches item (distance < 1 block)
5. Item remains on ground - NO auto-pickup triggered
6. Result: 5 iron_ingot lost permanently
```

### Impact
- ❌ Cannot craft new tools/armor/items
- ❌ Cannot collect drops from mining (blocks break but items lost)
- ✅ Can use existing inventory items
- ✅ Can move, fight, explore

### Workarounds
1. **Use existing inventory only** - no crafting
2. **Avoid breaking blocks** - items will be lost
3. **Combat is safe** - mob drops also lost but not critical
4. **Focus on exploration** - find structures with loot chests

### Code Changes Needed
- [ ] Add pre-craft check for auto-pickup capability
- [ ] Prevent crafting when auto-pickup is disabled
- [ ] Add warning when attempting to craft
- [ ] Update bot strategies to avoid crafting-dependent tasks

### Server Configuration Issue
This is likely caused by:
- Bukkit/Spigot/Paper plugin
- Custom server plugin
- gamerule or configuration we cannot access

**Recommendation**: This server is incompatible with bot crafting. Either:
1. Fix server auto-pickup settings, OR
2. Adapt bot strategies to never craft
