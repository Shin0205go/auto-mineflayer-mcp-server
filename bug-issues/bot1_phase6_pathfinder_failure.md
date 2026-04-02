# Bot1 Phase 6: Pathfinder Failure & Goal Changed Bug

## Incident Details
- **Date**: 2026-04-02
- **Bot**: Claude1
- **Location**: Underground cave system, Y=32~39
- **Session Start Pos**: (8, 43, 17)

## Events
1. **14:35 UTC** - Attempted to ascend from Y=43 cave to surface. Goal: gather ender_pearls via Enderman farming.
2. **14:36 UTC** - First pathfinder move: `goalXZ(8, -3)` → **Error: "The goal was changed before it could be completed!"**
   - Tried 3 iterations of short hops (10 block max), all failed with same error.
3. **14:37 UTC** - Attempted manual block placement + climbing. `placeBlock()` → **blockUpdate timeout (5s)**.
4. **14:38 UTC** - Bot reconnected to reset state. New pos: (13, 32, 15). HP dropped to 19/20, Hunger to 15/20.
5. **14:39 UTC** - `setControlState(jump, forward)` worked for 1 block ascent.
6. **14:40 UTC** - Found water at (4, 39, 10). Pathfinder to (5, 33, 10) succeeded (took 32s).
7. **14:42 UTC** - Pathfinder to water `GoalBlock(4, 39, 10)` → **timeout (60s)**.

## Root Cause
- **Hypothesis 1**: Bot has auto-safety loop running in background that constantly changes pathfinder goals (e.g., mob avoidance, HP safety).
- **Hypothesis 2**: Something in mc-execute sandbox or bot-core is injecting concurrent goal changes.
- **Hypothesis 3**: Server-side entity updates causing bot.entity.position to change mid-pathfind.

## Current State
- **Pos**: (5, 33, 10)
- **HP**: 19/20
- **Hunger**: 15/20
- **Inventory**: arrow×64, blaze_powder×12, bread×14, cobblestone×65
- **Status**: Stuck in underground cave. Cannot ascend to surface via pathfinder.

## Reproduced Errors
```
1. pathfinder.goto(new goals.GoalXZ(...)) → "The goal was changed before it could be completed!"
2. bot.placeBlock(...) → "Event blockUpdate did not fire within timeout of 5000ms"
3. pathfinder.goto(new goals.GoalBlock(...)) → timeout after 60s
```

## Next Steps
- **Option A**: Admin provides `/teleport` command to surface (Y≥63).
- **Option B**: Admin enables creative mode `/gamemode creative` for instant ascent.
- **Option C**: Code reviewer disables auto-safety loop (if it exists) and redeploy.
- **Option D**: Fallback to different bot (Claude2) to complete Phase 6.

## Phase 6 Progress
- **Goal**: Obtain ender_pearl×2 (via Enderman farming)
- **Blocker**: Cannot reach surface (night time = Enderman spawns in grass)
- **ETA**: 5 min after surface reached + ender_eye craft

---
Status: **Reported & Awaiting Admin Decision**
