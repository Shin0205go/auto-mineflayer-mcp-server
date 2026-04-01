# [2026-04-01] Bug Report: Critical API Gaps Blocking Gameplay

## Executive Summary
Claude1 cannot progress past Phase 1. Multiple fundamental API methods are missing or non-functional, blocking core Minecraft actions:
- Planting wheat seeds
- Opening/interacting with furnaces
- Gravity/falling physics
- Container interactions

## Symptoms

### 1. No Seed Planting API
**Goal**: Plant 12 wheat_seeds on farmland hydrated by water
**Problem**: No method to plant seeds
**Attempted**:
- `bot.place()` → not a function
- `bot.interact()` → no target interaction
- Manual `bot.activate()` → not found

**Result**: Farmland exists at [8, 69, 11], water at [8, 79, 13], but cannot plant

### 2. No Furnace Container Interaction
**Goal**: Smelt raw_iron using coal in furnace
**Problem**: `bot.openContainer()` fails with "containerToOpen is neither a block nor an entity"
**Inventory State**:
- coal: 12
- iron_ingot: 2
- Need to smelt raw_iron to get 3rd ingot for bucket

**Error Log**:
```javascript
const furnace = bot.blockAt(new Vec3(4, 69, 12)); // furnace found
await bot.openContainer(furnace);
// Error: containerToOpen is neither a block nor an entity
```

### 3. Gravity Not Working
**Goal**: Fall from Y=78 to Y=69 (9 blocks)
**Attempted**:
```javascript
bot.setControlState('jump', false); // release jump
await wait(5000); // wait 5 seconds
// Result: Y still 78 (no movement)
```

**Result**: Player does not fall, even with jump released and no support

### 4. Pathfinder False Success Reports
**Symptom**: `bot.pathfinder.goto()` claims success but bot position unchanged
**Example**:
```javascript
await bot.pathfinder.goto(new goals.GoalBlock(4, 69, 12));
// Returns: success
// Actual position: [4, 78, 15] (still 9 blocks above furnace)
```

## Impact

### Gameplay Blockade
- **Food Production**: Cannot plant seeds → cannot farm → hunger will eventually kill bot
- **Iron Progression**: Cannot smelt ore → cannot make bucket → cannot water farm → no food
- **Crafting**: No furnace container access → cannot cook food items
- **Overall**: Impossible to progress past Phase 1

### Current Inventory Status
```
Health: 20/20
Hunger: 17/20 (declining)
Items:
  - wheat_seeds: 12 (cannot plant)
  - coal: 12 (cannot use in furnace)
  - iron_ingot: 2 (need 1 more)
  - diamond: 3
  - stone_hoe: 1 (cannot till with current API)
```

## Root Cause Analysis

### Missing Methods
- `bot.plantSeed(block, seedItem)` or equivalent
- `bot.openFurnace(blockOrEntity)` with proper signature
- `bot.openContainer(blockOrEntity)` accepting blocks
- `bot.tieWithHoe(block)` for farmland creation

### Physics Issues
- Gravity disabled or movement validator preventing vertical motion
- Bot position sync problem between internal state and world

## Reproduction Steps

1. Connect bot to Minecraft server with items above
2. Navigate to farmland at [8, 69, 11]
3. Attempt: `await bot.place(farmland, new Vec3(0,1,0))` with wheat_seeds equipped
4. Observe: "bot.place is not a function"
5. Attempt: `await bot.openContainer(furnace_block)`
6. Observe: "containerToOpen is neither a block nor an entity"
7. Attempt: `await wait(5000)` with jump off at Y=78
8. Observe: Bot remains at Y=78 despite gravity

## Logs
- Last known position: [4, 78, 15]
- Furnace block detected at [4, 69, 12] ✓
- Water block detected at [8, 79, 13] ✓
- Farmland block detected at [8, 69, 11] ✓
- But cannot interact with any of them

## Status
**BLOCKED**: Requires code-reviewer to:
1. Implement seed planting method
2. Fix `openContainer()` to accept block references
3. Investigate gravity/physics system
4. Fix pathfinder to stop reporting false success

## Files Involved
- `src/tools/mc-execute.ts` - sandbox API definitions
- `src/bot-manager/` - pathfinder/movement logic
- `src/tools/core-tools.ts` - container/interaction methods

## Severity
**CRITICAL** - Gameplay completely blocked. Food production impossible.
