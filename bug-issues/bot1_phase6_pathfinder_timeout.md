# [2026-04-02] Bug: Pathfinder Timeout × 3 in Phase 6 - Ender Pearl Acquisition

## Summary
Claude1 encountered **consecutive pathfinder timeouts** (60+ seconds) when attempting to:
1. Reach Enderman (Y=80) from cave floor (Y=32)
2. Reach Nether Portal (Y=103) from cave floor (Y=32)
3. Move through complex cave system

**Impact**: Phase 6 (Ender Pearl acquisition) stalled. Unable to obtain ender_pearl × 2 to craft 2 additional ender_eye.

## Root Cause
- **Terrain complexity**: Multi-layered cave system with gaps, obstacles, blocks
- **Vertical distance**: pathfinder fails to handle 30+ block vertical gaps efficiently
- **Timeout threshold**: default 60s insufficient for terrain analysis

## Technical Details
```
Attempted Actions:
1. bot.pathfinder.goto(new goals.GoalNear(50, 80, 20, 3)) → 60s timeout
2. bot.pathfinder.goto(new goals.GoalBlock(6, 60, 17)) → 60s timeout (29.2m distance)
3. bot.pathfinder.goto(new goals.GoalBlock(6, 103, 17)) → timeout in loop

Error Output:
  [接近失敗] Pathfinder timeout after 60000ms
  [ホップ 1] (6, 60, 17), 距離: 29.2m → Pathfinder timeout after 60000ms

Current Position: (14, 32, 14) — underground cave
Dimension: overworld
Biome: unknown
```

## Inventory Status
```
ender_eye: 0 (expected: 6+)
ender_pearl: 0
blaze_powder: 12
```

## Attempted Workarounds
- **Enderman hunting**: Found 35 Endermen but failed to reach any (distance >60m)
- **Manual climbing**: tried bot.setControlState('jump', true) for 20 iterations, Y moved only 0.5 blocks
- **Chest retrieval**: Pathfinder timeout @ Chest (31.3m away)

## Recommendations for Code Reviewer
1. **Increase pathfinder timeout** for terrain-heavy navigation (consider 120-180s)
2. **Implement waypoint-based navigation**: break long-distance moves into 10-15 block hops
3. **Add terrain pre-analysis**: scan for path viability before pathfinder attempt
4. **Allow manual climbing**: when pathfinder fails, fallback to `pillarUp()` or step-by-step vertical navigation

## Status
- **Reported**: 2026-04-02 14:30 JST
- **Severity**: HIGH (Phase 6 progress blocked)
- **Next**: Waiting for pathfinder fix or manual navigation fallback
