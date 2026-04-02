## [2026-04-02] Bug: Claude1 Critical - Pathfinder Timeout + Food Access Blocked

**Status**: CRITICAL - Gameplay blocked, HP declining

### Incident Summary
Claude1 is stuck at (8.2, 96, 3.6) with **0 food**, **14.5 HP**, and **hunger 17/20**. Both pathfinder navigation and food access are broken.

### Symptoms

#### 1. Pathfinder Timeout (repeated failure)
- `pathfinderGoto()` fails with 15s timeout even for short distances
- Example: Cannot reach chest at (9, 96, 4) ~2.4m away
- Affects all navigation attempts, entire area unreachable

#### 2. Food System Crash
- Started session with 1 bread, ate it successfully (hunger: 15→20)
- Food item disappeared from inventory after eating
- Current inventory shows 0 food items despite eating
- `bot.inventory.items()` shows: blaze_powder, 5x torch, 102x cobblestone, diamond_pickaxe, shield, iron_chestplate, iron_leggings
- Cannot access stored food in chest (pathfinder blocked)

#### 3. Block Detection Inconsistency
- `bot.findBlocks('air')` returns 0 blocks within 10m
- `bot.findBlocks('chest')` returns 0 chests within 20m
- BUT `awareness()` and `scan3D()` show blocks clearly
- Raw `bot.blockAt()` works correctly (detects air, andesite, etc.)
- Suggests findBlocks() uses corrupted cache while blockAt() uses live API

#### 4. Position Desynchronization
- Attempted `bot.entity.position.set(9, 96, 4)` (teleport)
- Position changed on that call but reverted to (8.2, 96, 3.6) on next check
- Indicates server-client sync issue with manual coordinate manipulation

### Terrain Context
scan3D() analysis:
- 36 caves/cavities detected
- 166 fall-risk holes
- Average Y: 98, elevation range: 8 blocks
- Terrain is extremely fragmented

### Root Cause Analysis

**Most Likely**: Pathfinder mesh/cache corruption
- Complex terrain (caves, holes) may have poisoned the pathfinder's navigation graph
- findBlocks() may rely on same corrupted mesh
- scan3D() appears to rebuild mesh on-the-fly, hence works

**Secondary**: Inventory window/food state desync
- Food consumed but not cleared from item buffer
- Or food moved to different inventory slot not indexed by `items()`

### Current Game State
- **Coordinates**: (8.2, 96, 3.6)
- **HP**: 14.5/20 (declining)
- **Hunger**: 17/20 (critical threshold ~6)
- **Food**: 0 items (ZERO)
- **Render**: No animals visible, no entities
- **Escape routes**: Pathfinder blocked, no manual navigation available

### Actions Attempted (All Failed)
1. ✗ Hunt animals → No animals in render
2. ✗ Pathfinder to chest → 15s timeout × 5 attempts
3. ✗ Manual walking → No movement, terrain blocks
4. ✗ Position teleport → Reverted to original
5. ✗ findBlocks() → Returns empty

### Impact Assessment
- **Playability**: BLOCKED - Cannot move, cannot get food
- **Time to critical**: ~5-10 minutes before HP<5 (death risk)
- **Previous progress**: Lost - cannot continue Phase 1-2
- **Data loss**: Stored food in chest (9, 96, 4) inaccessible

### Required Fix
1. **Pathfinder mesh rebuild** - Force regeneration of navigation graph
2. **findBlocks() cache invalidation** - Rebuild block index from live world data
3. **Inventory state verification** - Confirm food item state after consumption
4. **Block detection sync** - Align findBlocks() with blockAt() API

### Recommendation
- Rollback to last known good state or restart with fixed pathfinder
- Disable pathfinder cache until mesh generation is verified
- Add diagnostic logging for findBlocks() vs blockAt() discrepancies
