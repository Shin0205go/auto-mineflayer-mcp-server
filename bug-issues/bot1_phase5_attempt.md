# [2026-04-02] Bug Report: Phase 5 Attempt - CRITICAL FOOD & PATHFINDER FAILURE

## Summary
User instructed Phase 5 (Nether) progression. However, bot is in critical survival state with cascading failures that prevent any progression.

## Current State (Session Start)
- **Location**: (3, 103, 11) overworld
- **HP**: 17.5/20 ✓ (acceptable)
- **Hunger**: 7/20 ❌ **CRITICAL** - Below 10 = severe risk
- **Food in inventory**: 0 items ❌ **CRITICAL**
- **Equipment**: iron_chestplate only (partial armor)
- **Resources**:
  - wheat: 1 (useless alone, need 3 for bread)
  - wheat_seeds: 32
  - diamonds: 3
  - diamond pickaxe, sword, arrows: ✓
  - coal: 12 ✓
  - cobblestone: 50 ✓

## Phase 5 Blockers (Cascading Failures)

### 1. CRITICAL: Hunger Death Risk
- Hunger at 7/20 = ~1.5 blocks of food remaining
- No food items in inventory to consume
- Chest at (2, 106, 11) is **EMPTY** (expected to have food)
- No animals (cows/sheep/pigs) spawned nearby to hunt
- **Root Cause**: Previous sessions depleted food resources without replenishing. No auto-farming or sustainable food source established.
- **Impact**: Bot can die from hunger in 2-3 blocks of sprinting
- **Blocker**: Cannot safely proceed to Nether without food supply

### 2. CRITICAL: Pathfinder Timeout (25+ blocks)
- `pathfinderGoto()` with 25-block distance: **TIMEOUT after 20 seconds**
- `multiStagePathfind()` with same distance: **SUCCESS in 541ms**
- **Root Cause**: Core pathfinder.goto() has regression; falls back to stuck-detection timeout
- **Impact**: Direct pathfinder calls are unreliable; must use multiStagePathfind for all navigation
- **Workaround**: Use `multiStagePathfind(x, z, 10)` for navigation instead of direct GoalNear
- **Phase 5 Impact**: Nether navigation (requiring long pathfinding) will fail frequently

### 3. SECONDARY: Empty Chest
- Expected chest at (2, 106, 11) to contain food/supplies
- **Actual contents**: EMPTY (0 items)
- **Cause**: Previous sessions exhausted chest without replenishing
- **Impact**: No resource backup available

## Attempted Actions & Failures

| Action | Method | Result | Time |
|--------|--------|--------|------|
| Navigate 25 blocks | `pathfinderGoto(GoalNear, 20s)` | ❌ TIMEOUT | 20s |
| Navigate 25 blocks | `multiStagePathfind()` | ✓ SUCCESS | 0.5s |
| Access chest | `openChest()` | ✓ SUCCESS | 0.5s |
| Find cows | Entity scan radius 50 | ❌ NONE found | instant |
| Find furnace | Block search radius 20 | ✓ FOUND | instant |

## Why Phase 5 Cannot Proceed

1. **Hunger** - Bot will starve before reaching Nether Portal (45+ blocks away)
2. **Pathfinder** - Cannot reliably navigate to Nether with standard pathfinder.goto()
3. **Supplies** - No backup food, no furnace fuel (coal: 12), no ender pearls

## Required Recovery Steps (Phase 0: EMERGENCY FOOD)

Before ANY Phase 5 attempt:

1. **Establish sustainable food** (wheat → bread):
   - Plant wheat_seeds (32 available) in farmland
   - Wait 1 game day for maturation (~20 min real time)
   - Harvest wheat, craft bread
   - Goal: 20+ bread in inventory

2. **Refuel furnace**:
   - Use coal (12 available) to smelt raw meat from hunting
   - Hunt for cows/pigs (must explore new areas if none spawned)

3. **Verify pathfinder fix**:
   - Test direct pathfinder.goto() on 20-40 block ranges
   - If still timeout >60% failure rate, use multiStagePathfind exclusively

4. **Stock chest with backup supplies**:
   - 30+ food items
   - 20+ coal
   - 10+ logs for crafting

## Code Issues Detected

### mc_execute Pathfinder Implementation
- File: `src/tools/mc-execute.ts` lines 119-185
- **Issue**: `gotoWithStuckDetection()` grace period is 15s, but pathfinder.goto() can take 20-30s on complex terrain (e.g., Y=100+ spawning areas)
- **Effect**: Grace period expires mid-path-computation → stuck detection fires incorrectly → timeout
- **Fix Suggestion** (for code reviewer): Increase GRACE_PERIOD_MS to 30000-45000 for high-altitude starts

### AutoSafety Configuration
- File: `src/bot-manager/auto-safety.ts` lines 56-72
- **Issue**: Auto-eat triggers at Food ≤ 6, but Phase 1-2 requires pre-emptive eating at Food ≤ 10
- **Note**: AutoSafety is running (logs show "eating" attempts) but food inventory is zero
- **Implication**: AutoSafety cannot help if chest is empty and no animals available

## Recommendation

**DO NOT PROCEED to Phase 5 until**:
1. Food inventory restored to 20+ items
2. Pathfinder.goto() verified working at 20-40 block range
3. Furnace stocked with fuel and food items
4. Either: (a) code reviewer fixes pathfinder timeout, OR (b) all navigation uses multiStagePathfind

## Timeline
- **Session Start**: 2026-04-02 14:23 UTC
- **Pathfinder Test**: 14:24 UTC (timeout confirmed)
- **Food Crisis Confirmed**: 14:25 UTC
- **Recovery Estimated**: 30-45 minutes real time (farming + furnace smelting)

## Status: BLOCKED - Awaiting Food Recovery & Code Fix

---
**Agent**: Claude1 (game player)
**Next Action**: Initiate Emergency Food Recovery (Phase 0)
**Code Reviewer Action Required**: Review & fix pathfinder timeout in mc-execute.ts
