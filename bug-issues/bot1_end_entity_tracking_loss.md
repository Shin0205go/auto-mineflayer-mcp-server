## [2026-04-02] Critical: End Dimension Entity Tracking Loss - Dragon Disappears

### Summary
After entering The End, Claude1 initially detected Ender Dragon at 53m distance. Dragon approached to 12-16m range over ~10 seconds. Then dragon entity completely disappeared from bot.entities() and cannot be re-found despite 20+ re-detection attempts. No dragon_egg appears. Pathfinder hangs for 20+ seconds in End terrain.

### Timeline
1. **T0**: Dragon detected at (−42, 89, 0), distance 53m
2. **T1-T10**: Wait loop, dragon approaches: 21m → 20m → 17m → 13m → 12m
3. **T11**: Attack loop started but yielded NO logs (code ran but no output)
4. **T12+**: Dragon no longer found in bot.entities()
5. **T13-T32**: 20 re-detection attempts, 0 dragon sightings
6. **T33**: dragon_egg block search, not found
7. **T34+**: pathfinder timeout (>20 seconds) to coordinate (0, 70, 0)

### Hypothesis (Priority Order)
1. **Entity Tracking Corruption**: Server has dragon (still alive), but client-side bot.entities() lost track of it
2. **Dimension Sync Failure**: Client dimension != server dimension (appears as The_End but server is different)
3. **Packet Loss / Network**: Entity state updates stopped arriving at bot
4. **Pathfinder State Corruption**: Pathfinder marked entire End as no-path, causing system freeze

### Evidence
- **Dragon confirmed real initially**: Distance calculation worked (53m, approaching to 12m)
- **No dragon_egg**: If dragon died, egg should appear within seconds
- **No re-acquisition**: 20 repeated entity.find() calls over 10 seconds = dragon truly missing from bot state
- **Other entities visible**: Endermen (30), zombie, skeleton, bat, creeper, spider all visible and tracked
- **Coordinates shift**: Bot position reported as (27, 101, 5) when island should be centered at (0, 64, 0) ± 20

### Immediate Problem
**Cannot proceed with Phase 8** — Ender Dragon not killable without entity tracking.

### Logs/Coordinates
- Last dragon sighting: (-42, 89, 0) at T0
- Last successful move: (27, 101, 5) after pathfinder timeout attempt
- Island center (expected): (0, 64-80, 0)
- Current dimension: The_End

### Failed Actions
```js
// Entity tracking
bot.nearestEntity(e => e.name === 'ender_dragon')  // Returns null after T12

// Pathfinder in End
bot.pathfinder.goto(new goals.GoalNear(0, 70, 0, 5))  // Hangs 20+ seconds, timeout

// Block search
bot.blockAt(new Vec3(x, y, z)) with x∈[-30,30], y∈[50,100], z∈[-30,30]  // All air
```

### Potential Fix (Code Review)
1. **Add entity tracking heartbeat** — Re-request entity list from server if find() returns nothing for 2+ seconds
2. **Dimension validation** — Compare bot.game.dimension client ↔ server on demand
3. **Pathfinder timeout in End** — Use short hops (<5 blocks) instead of full path for End terrain
4. **Dragon re-spawn detection** — Listen for particle effects or sound cues if entity tracking fails

### Next Steps
1. Verify server-side dragon status (admin check: `/locate dragon`)
2. Investigate packet trace (Entity Update / Entity Spawn packets)
3. Retry with shorter pathfinder goals or manual climbing

### Status
**Reported** — Blocking Phase 8 completion. Awaiting diagnosis.
