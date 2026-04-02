---
name: Phase 2 Game State
description: Farm location, infrastructure, and food production system
type: project
---

## Farm & Infrastructure Location

### Water Source & Farm Area
- Coordinates: (26, 101, 3)
- Water block: (26, 100, 3)
- Farmland radius: 6 blocks in all directions
- Current crops: Wheat (various maturity stages)

### Key Infrastructure
- **Bed**: (26, 101, 3) — for night skip and respawn point
- **Furnace**: (7, 100, -3) — distance 7.1 blocks from farm for ore smelting
- **Crafting Table**: x2 in inventory, can be placed locally if needed

### Food System
- **Harvest Status**: Wheat harvested 5 times, growing on farm
- **Conversion**: Raw wheat → bread via furnace (need furnace access)
- **Food Safety**: Keep 5+ food items at all times (currently 0 items, but hunger at 14/20)
- **Emergency**: Use bed to recover hunger when at 6+

## Current Inventory (Phase 2 End)
- crafting_table: 2
- coal: 12 (furnace fuel)
- wheat_seeds: 24 (for replanting)
- bone_meal: 12 (crop acceleration)
- stone_hoe: 1 (harvesting)
- diamond_pickaxe: 1 (mining Y<16)
- diamond_sword: 1 (combat)
- iron_ingot: 2 (for buckets if needed)
- Various building blocks (dirt, cobblestone, etc.)

## Phase 3 Strategy
- **Goal**: Mine iron ore (target 8+ ingots)
- **Y-Level**: Target Y=16-30 (iron peak density)
- **Method**:
  1. Cave exploration (already found 9685 air pockets)
  2. Vertical shaft mining (3x3 pattern)
  3. Furnace smelting at (7, 100, -3)
- **Output**: iron_ingot x8+ for tools/armor

## Known Issues
- Pathfinder struggles with Y jumps >30 blocks
- Solution: Use bed to return home, then restart descent
- Food consumption during mining: ~1-2 hunger per 10 minutes mining
