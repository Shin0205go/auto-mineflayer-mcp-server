# Next Session - Restart Notes

## Immediate Actions on Reconnect

1. **Reconnect Claude1**
   ```bash
   BOT_USERNAME=Claude1 node scripts/mc-execute.cjs 'log("Connected!")'
   ```

2. **Check Safe State**
   - Bot should be at: (62, 85, 32) underground
   - Expected: HP=20, Food=19
   - If different: May have respawned or been moved

3. **Return to Base**
   - From (62, 85, 32) to base (0, 95, 0) is ~90 blocks away
   - Use short pathfinder hops: 10-20 blocks at a time
   - Stop if pathfinder timeouts (avoid >30 block goals)

## Critical Bugs to Watch For

### 1. Crafting Window Timeout (40% failure rate)
**Workaround**: Always use this pattern:
```javascript
await bot.activateBlock(craftingTable);
await wait(300);
const recipes = bot.recipesFor(...);
await bot.craft(recipes[0], 1, craftingTable);
```

**Do NOT** try direct craft without activateBlock.

### 2. Pathfinder Timeout
**Rules**:
- Max distance: 30 blocks per goal
- Break long paths into 5-10 block chunks
- Always set timeout: {timeout: 10000}
- If fails 2x: Stop and try different route

### 3. Daemon Crash Risk
**Triggers** (avoid):
- Large loops with bot.findBlock() (max 3 searches per command)
- Long navigation chains without breaks
- Rapid container operations

## Phase Status

### Phase 1-2: BASE & FOOD ✓ COMPLETE
- crafting_table: ✓
- furnace: ✓
- chest: ✓
- food (wheat farm): ✓

### Phase 3-4: TOOLS & ARMOR ⏳ IN PROGRESS
- Need: Iron tools, iron/diamond armor
- Current: 2 iron_ingot (need 6-10 more for full iron armor)
- Plan: Mine iron ore at Y=20-40

### Phase 5-6: NETHER ⬜ TODO
- Need: Diamonds (have 3), blaze rods, ender pearls
- Current: No nether access yet

## Key Resources Inventory
- **Crafting Table**: (19, 85, 4)
- **Furnace**: (23, 101, 4)
- **Chest**: (9, 96, 4)
- **Wheat Farm**: (~34, 101, 8) - 17+ mature plants
- **Current Pos**: (62, 85, 32) - underground shelter

## Learnings for Future Sessions

1. **Crafting is unreliable** - Always try 2-3 times, use activateBlock() first
2. **Pathfinder likes short hops** - Break paths into 10-20 block segments
3. **Food management critical** - Keep 5+ food in inventory always
4. **Night safety** - Go underground or build shelter by dusk (time > 12000)
5. **Inventory management** - Start returning to base at 25+ items (full at 36)

## If Daemon Still Down

This is expected if multiple test sessions ran. Ask the user to:
```bash
npm run daemon &
```

Claude1 will be safe waiting underground. Do NOT do this yourself per safety rules.
