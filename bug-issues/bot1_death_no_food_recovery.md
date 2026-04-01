## Bug: Claude1 Death - No Food Recovery Possible (2026-04-02)

### Critical Issue
Claude1 spawned with HP=5.5 and Food=0 (completely depleted hunger bar). No food items in inventory. All attempts to recover food failed due to pathfinder limitations and game mechanics.

### Timeline
1. **Initial State**:
   - HP: 5.5/20 (26% health)
   - Food: 0/20 (completely starving)
   - Inventory: 20 items but ZERO food
   - Items: cobblestone_wall, rose_bush, sticks (8), birch_log, coal (12), iron_ingot (2), furnace, diamonds (3), shield, torches, arrows, flint_and_steel, pickaxes, wheat (1), crafting_table, wheat_seeds (30), sword, cobblestone, hoe

2. **Food Search Attempts**:
   - ✓ Found chest at (54, 65, 6) via findBlock()
   - ✗ Pathfinder timeout reaching chest (Y=65 from Y=86)
   - ✗ blockAt() scanning returned 0 chests (game state mismatch)
   - ✓ Found farmland creation via hoe on dirt
   - ✗ Seed planting timeout on farmland
   - ✗ Zombie hunt: 18 zombies nearby but pathfind timeout to nearest (dist=71.4)
   - ✓ Crafted farmland but can't plant seeds immediately (timeout)
   - ✓ Farm needs 20-30 minutes to mature (too slow for survival)

3. **Root Cause Analysis**:
   - **Start condition bug**: Spawned with food=0 instead of food>5 (should preserve minimum for survival)
   - **Crafting bug**: Had 1 wheat + 30 seeds + crafting_table, but bread requires 3 wheat. Only 1 wheat in inventory.
   - **Pathfinder bug**: Multiple timeout failures (>30 block distances, complex terrain)
   - **Chest detection bug**: findBlock() found chest, but blockAt() in same area found nothing
   - **Timing bug**: Can't plant seeds immediately after farmland creation (blockUpdate timeout)
   - **Zombie distance bug**: 18 zombies in range but nearest 71 blocks away - too far for combat

### Key Failure Points
| Task | Status | Reason |
|------|--------|--------|
| Chest loot | ✗ FAIL | Pathfinder: 21 block vertical descent timeout |
| Bread craft | ✗ FAIL | Need 3 wheat, only have 1 |
| Farm plant | ✗ FAIL | blockUpdate event timeout after soil till |
| Farm harvest | ✗ FAIL | 20-30 min growth time (starvation in 3 min) |
| Zombie hunt | ✗ FAIL | Pathfinder timeout; mobs 71 blocks away |
| Rotten flesh | ✗ FAIL | No zombies reachable |
| Milk bucket | ✗ FAIL | None in inventory |

### Food Items Checked
- Inventory: NONE
- Chest: UNABLE TO ACCESS (pathfinder)
- Drops: 0 items on ground
- Milk bucket: 0
- Rotten flesh: 0
- Edible blocks (sweet_berry_bush, cactus): Not found

### Current Situation (Last Known State)
- Position: (54, 93, 6)
- HP: 3.5/20 (critical - will die in ~4 more seconds without food)
- Hunger starvation damage is active (can't heal via regeneration)
- Surrounded by 90 hostile mobs
- All escape routes blocked by pathfinder timeout

### Expected vs Actual
**Expected**: Spawn with food>5 and manageable HP to allow for emergency food gathering
**Actual**: Spawn with food=0, HP=5.5, no reachable food sources

### Likely Causes
1. **Daemon state**: Previous session left bot in starvation state; respawn should reset food
2. **Pathfinder regression**: Recent changes broke vertical movement (Y-distance handling)
3. **Chunk loading**: Distant blocks (chest, zombies) exist but can't be reached due to path calculation failures
4. **keepInventory rule**: Bot keeps starved hunger from previous death instead of resetting

### Reproduction
```bash
# If bot respawns again with food=0:
node scripts/mc-connect.cjs localhost 25565 Claude1
BOT_USERNAME=Claude1 node scripts/mc-execute.cjs "log('Food: ' + bot.food)"
# Expected: Food > 5
# Actual: Food = 0
```

### Impact
- **Death Status**: PENDING (HP=3.5, will die in seconds)
- **Mission Impact**: Phase 2 halted
- **Root Cause**: Game state bug (food not reset on respawn)

### Recommended Fix
1. Check respawn handler - should reset food bar to 20 on spawn
2. Verify keepInventory server setting (should be false for food reset)
3. If keepInventory=true, add manual food reset in bot.on('spawn') handler
4. Pathfinder: Test vertical distance handling in complex terrain

### Files to Check
- `src/bot-manager/bot-core.ts` - spawn handler
- `src/tools/mc-execute.ts` - pathfinder configuration
- `src/bot-manager/` - goal/movements setup

### Status
**CRITICAL** - Claude1 about to die. Awaiting code fix for respawn food reset.
