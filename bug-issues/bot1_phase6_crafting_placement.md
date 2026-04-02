# [2026-04-02] Bug: Phase 6 Crafting & Block Placement APIs Failing

## Summary
Claude1 hit two critical blockers while attempting Phase 6 progression:
1. `bot.craft()` API: Recipe undefined, cannot craft iron armor
2. `bot.placeBlock()` API: blockUpdate event timeout, cannot place obsidian for Nether portal

## Details

### Bug 1: bot.craft() Recipe Binding Issue
- **Cause**: Crafting table activated successfully, but `bot.recipes` is undefined in mc_execute sandbox
- **Location**: Crafting table at (0, 73, 7)
- **Error**: `TypeError: Cannot read properties of undefined (reading 'find')`
- **Impact**: Cannot craft iron armor (8 iron ingots per chestplate)
- **Inventory**: Has 27x iron_ingot, crafting_table exists on ground

### Bug 2: bot.placeBlock() Timeout
- **Cause**: placeBlock() awaits blockUpdate event that never fires
- **Location**: Portal site (-25, 110, 25)
- **Error**: `Event blockUpdate:(-25, 110, 25) did not fire within timeout of 5000ms`
- **Attempt**: Tried to place 14 obsidian blocks for Nether portal frame (4x5 outer)
- **Impact**: Cannot build Nether portal; all 14 placement attempts failed
- **Inventory**: Has 14x obsidian, 1x flint_and_steel ready

### Bug 3: bot.pathfinder() Occasional Failures
- **Cause**: Some navigation goals fail with "No path to the goal"
- **Location**: (-25, 110, 25) unable to reach (0, 73, 7) crafting table directly (5.3 blocks away)
- **Error**: `No path to the goal!` even for short distances

## Workarounds Attempted
1. ✅ Navigated to portal site (26.2 blocks away via hops) — worked
2. ❌ Direct placeBlock() — timeout on all 14 attempts
3. ❌ bot.craft() with recipe objects — undefined recipes
4. ❌ Pathfinder to crafting table 5 blocks away — path failed

## Current Inventory Status
- obsidian: 14 ✅
- flint_and_steel: 1 ✅
- ender_eye: 10/12 (need 2 more from Nether)
- iron_ingot: 27 (cannot craft armor due to bot.craft() bug)
- diamond_pickaxe: 1 ✅
- diamond_sword: 1 ✅
- elytra: 1 ✅
- Food/HP: 18-20/20 (good)

## Expected vs Actual
**Expected**: Craft iron armor → Build obsidian portal frame (2x3 inner) → Light portal → Enter Nether → Collect 2 ender_eye from Endermen → Craft final 2 ender_eye → Proceed to Phase 7

**Actual**: Crafting API broken, block placement timeout. Phase 6 progression blocked.

## Recommendation
- Fix `bot.recipes` availability in mc_execute sandbox
- Fix `placeBlock()` blockUpdate event reliability or add retry logic
- Consider alternative placement method (e.g., direct chunk updates or manual event skip)
- Code-reviewer should check: `src/tools/mc-execute.ts`, `src/bot-manager/core-tools.ts`

## Status
**Reported** — Awaiting code-reviewer fix

---
Claude1 is at (-25, 110, 25) with full inventory ready for Nether progression.
