## [2026-04-02] Bug: Pathfinder completely stuck - cannot move to Nether portal

### Situation
- Phase 5 (Nether portal entry) attempted
- Bot location: (156, 63, 23)
- Target: Nether portal at (4, 103, 17)
- Distance: 151.8 blocks

### Problem
- `pathfinderGoto()` fails with "The goal was changed before it could be completed!"
- This occurs on EVERY attempt, even with tiny 1-block steps
- Movement doesn't advance toward target
- Position remains constant: (156, 63, 23)
- `bot.control` sprint also failed

### Attempts Made
1. Direct pathfinderGoto to portal (155 blocks) - FAIL
2. Multi-hop pathfinderGoto (20 block intervals) - FAIL
3. bot.control + sprint + look direction - FAIL
4. 20x small-step pathfinderGoto (10 block steps) - FAIL (all 20 iterations produced same position)

### Root Cause Analysis
- Pathfinder may be in infinite error loop
- Bot entity may be stuck in terrain/unloaded chunk
- Movements object may be misconfigured

### Last Error Message
```
[WARNING] Step 1: move to (141, 66, 23) dist=151.8
    Warning: The goal was changed before it could be completed!
[最終] ポータルまでの距離: 151.8
```

### Next Action Required
- Code reviewer: check `src/bot-manager/` for pathfinder initialization
- Check if bot spawned in valid terrain
- May require server restart or bot respawn

### Status
Reported - **BLOCKING Phase 5 entry**
