## [2026-04-02] Bug: Complete Food Crisis + Recipe Registry Failure

### Summary
- **Hunger**: 6/20 (critical)
- **Food in inventory**: ZERO (wheat 1 + wheat_seeds 30 cannot be eaten)
- **Edible items**: NONE available
- **Crafting table**: Accessible (10,90,4) but bread recipe not found in registry
- **Wheat blocks**: Unavailable in current area (Y=90, farming area nearby but no mature wheat)
- **Status**: STUCK - cannot obtain food, cannot craft bread

### Root Causes
1. **Recipe Registry Issue**: `bot.recipesFor(breadId)` returns empty array despite crafting_table being present
2. **Food Generation**: No cooked meat in inventory despite prior sessions
3. **Farm Status**: Wheat seeds planted but not mature (no stage-7 blocks found)
4. **Pathfinder Regression**: Cannot navigate to distant food sources (>20 blocks)

### Current State
- **Position**: (8.58, 92, 7.59) - underground near crafting tables
- **Inventory**:
  - wheat x1 (inedible)
  - wheat_seeds x30 (inedible)
  - No cooked meat, bread, or consumables
- **Crafting table**: Found 5 tables (nearest: 10,90,4)
  - `bot.craft()` fails: bread recipe not in registry
- **Animals**: None found in vicinity (60-block scan)

### Last Attempted Actions
1. `bot.pathfinder.goto(crafting_table)` - TIMEOUT at 120s (Y-axis navigation issue)
2. `bot.recipesFor(breadId)` - Returns empty array
3. `bot.findBlocks(wheat)` - Returns 0 blocks near crafting table

### Impact
- **Player blocked**: Hunger=6 is survival-critical. Cannot progress.
- **System failure**: Food acquisition pipeline completely broken
- **Ripple effect**: All Phases (1-8) blocked until food restored

### Required Action
1. **Admin `/give` command**: `give Claude1 bread 10` to resume gameplay
2. OR **World reset** with proper seed initialization (farm + cooked food in chests)
3. OR **Recipe registry fix**: Verify crafting table connects to recipe system

### Technical Details
- Crafting table accessible
- Registry lookup successful for farmland, wheat blocks
- But `bot.recipesFor()` empty despite table presence
- Suggests recipe provider not initialized or disconnected from crafting_table state

### Session Context
- Previous bug reports: See ff4305e, 77580f3, eb8067f (same category)
- Pattern: Recurring food crisis suggests farm generation or recipe system issue
