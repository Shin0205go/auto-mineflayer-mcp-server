## Bug: Base surrounded by water - critical blocker for Phase 5+

**Date**: 2026-04-02
**Status**: REPORTED
**Severity**: CRITICAL

### Problem Summary

Claude1's base (crafting table @ 0,73,7) is surrounded by water at Y=75, making it impossible to escape to higher ground for normal gameplay. This blocks progression to Phase 5+ (nether preparation).

### Symptoms

- Claude1 spawns at (1.7, 75.0, 7.1) which is in water
- Crafting table and furnace are on dry land below at Y=73
- Water pockets surround the base (see scan3D output from earlier)
- Pathfinder fails to navigate between water pockets
- Block placement times out (5000ms) in water environment

### Reproduction

1. Connect Claude1 to game
2. Check position: `await awareness()`
3. Observe water at Y=75
4. Try `bot.pathfinder.goto(new goals.GoalNear(0, 73, 7, 2))` → fails with "goal was changed"

### Root Cause (Design)

The original shelter was built without drainage plan. Water sources exist at (1, 75, 7) and surrounding areas, creating a water-logged level that:
- Blocks pillar construction (blockUpdate timeout)
- Makes block placement slow
- Isolates the base from normal terrain

### Impact

- Cannot reach crafting table reliably
- Cannot build obsidian storage system
- Cannot prepare for nether portal
- Subsequent phases blocked

### Current Workarounds (Attempted)

1. **Jump to higher ground**: Y can only reach 75.7 (not enough to clear water)
2. **Pillar building**: `bot.placeBlock()` times out after 5000ms
3. **Pathfinder navigation**: "goal was changed" error (separate pathfinder bug)
4. **Direct water escape**: No adjacent dry land in any cardinal direction

### Recommended Solutions

**Option A: Emergency Shelter (Simplest)**
- Drain water by placing blocks
- Create temporary shelter at Y=77+
- Allow base restart from dry ground

**Option B: Teleport/Reset**
- Admin command to teleport Claude1 to safe location
- Or restart bot session at new coordinates

**Option C: Code-Level Auto-Escape**
- Detect water-surrounded condition in auto-safety
- Automatically dig upward + place blocks until reaching dry ground
- Or trigger water-displacement algorithm

### Expected Behavior

- Shelter should be built on solid ground (Y >= stone/dirt layer)
- Water should be planned before shelter construction
- If water exists, bot should have drainage or alternative exit route

### Actual Behavior

- Water completely surrounds escape routes
- No dry land accessible from current position
- Stuck in water indefinitely

### Blockers for Future Phases

Without resolution:
- ❌ Phase 5: Cannot build nether portal (no accessible crafting)
- ❌ Phase 6: Cannot enter nether
- ❌ Phase 7-8: Cannot reach ender dragon

### Additional Notes

This appears to be a design/setup issue rather than code bug, but it severely impacts bot gameplay. The pathfinder "goal changed" error (separate bug) makes the situation worse by preventing navigation even to known safe locations.

### System Context

- Bot: Claude1
- Position: (1.7, 75.0, 7.1)
- Surroundings: Water-logged (confirmed with scan3D)
- Inventory: Sufficient resources, diamond tools present
- Phase: Ready for Phase 5, blocked by water escape
