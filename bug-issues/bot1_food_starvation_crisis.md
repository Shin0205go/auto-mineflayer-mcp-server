## Bug: Food Starvation Crisis - Claude1 HP=9.5, Food=0

### Status: CRITICAL - Active

### Timestamp
2026-04-02 (session start recovery)

### Symptom
Claude1 booot is in critical starvation state:
- **HP: 9.5** (danger threshold < 10)
- **Food: 0** (complete starvation)
- **Food items in inventory: 0** (wheat disappeared from prior session)
- **Risk: Imminent death from hunger or mob damage**

### Reproduction Steps
1. Session reconnected with `node scripts/mc-connect.cjs localhost 25565 Claude1`
2. `BOT_USERNAME=Claude1 node scripts/mc-execute.cjs` checks revealed:
   - bot.food === 0
   - bot.inventory.items() filter for food items returned 0 results
   - Inventory shows: wheat_seeds 30, no cooked items, no bread, no apples

### Investigation Results
#### Checked sources:
1. ✗ **Furnace smelting**: furnaceBlock found (x=23, y=101, z=4), but smeltItems('wheat', 'coal', 1) output 0 items
   - wheat may not be smeltable or was already consumed
2. ✗ **Chests**: 14 chests found in world, but:
   - x=8, y=92, z=5 → openChest timeout (windowOpen event did not fire within 20s)
   - x=2, y=106, z=11 → opened but empty (0 items)
   - Chests at x=15,y=78,z=4 and x=12,y=79,z=3 → pathfinder timeout
3. ✗ **Wheat blocks**: 0 found within 32 blocks
4. ✗ **Animals**: 0 found (no cows, pigs, chickens, sheep, rabbits)
5. ✗ **Wool blocks**: 6 found, but collectDrops() after bot.dig() failed to add inventory (logged "[collectDrops] Approached 1 drops, inventory +0 items")

### Root Cause Hypothesis
- Session saved bot in a depleted biome/location
- Food items consumed or lost in prior phase transitions
- Either bot.inventory or world has inconsistent state
- collectDrops() may have a bug with non-standard drop pickup

### Environment
- Minecraft server: localhost:25565
- Bot: Claude1
- Mineflayer version: (check package.json)
- MC version: (unknown, assuming latest)

### Impact
- **Severity: CRITICAL** — bot will die within minutes if not fed
- **Blocked**: All normal gameplay (must survive first)
- **Workaround**: Admin `/give Claude1 bread 10` or similar

### Requested Actions for Code Reviewer
1. Investigate openChest() / openContainer() windowOpen timeout (40% failure rate per MEMORY.md)
2. Verify collectDrops() works with wool blocks (currently failing)
3. Check smeltItems() accepts 'wheat' as valid input
4. Consider auto-respawn mechanism or emergency food stash for new sessions

### Commands to Reproduce
```bash
node scripts/mc-connect.cjs localhost 25565 Claude1
BOT_USERNAME=Claude1 node scripts/mc-execute.cjs "log('HP=' + bot.health + ' Food=' + bot.food)"
# Output: HP=9.514999389648438 Food=0
```
