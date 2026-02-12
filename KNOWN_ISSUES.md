# Known Issues

## Crafting System Limitation (Critical)

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
