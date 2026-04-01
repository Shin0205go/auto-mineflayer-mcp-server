# Bug Report: Pathfinder Timeout - Long Distance Navigation

## Issue
Claude1 encounters **timeout after 120 seconds** when attempting pathfinder navigation over distances > 30 blocks. Shorter segments (< 5 blocks) also timeout unexpectedly.

## Occurrence
- **Time**: 2026-04-01, Phase 2 farm setup
- **Coordinates**: (32, 99, -18) → attempting to reach base at (27, 107, -13)
- **Distance**: ~30 blocks horizontal

## Error Sequence
1. First attempt: `await bot.pathfinder.goto(new goals.GoalXZ(target.x, target.z), {timeout: 10000})` → **timeout after 120s**
2. Second attempt: Incremental short-distance goals (5 blocks each) → **timeout after 120s on first step**
3. Third attempt: `goals.GoalNear(27, -13, 3)` → **timeout after 120s**

## Last Log Before Failure
```
Position: (32, 99, -18)
Target: base at (27, 104, -13)
step 1: move west
[120s timeout - process killed]
```

## Daemon Status
- Daemon crashed mid-session with "socket hang up"
- Recovered after restart
- Subsequent mc-execute calls work normally

## Hypothesis
- Pathfinder getting stuck analyzing terrain (forest area?)
- Possible infinite loop in pathfinding algorithm
- Timeout not being properly respected
- Chunk loading blocking pathfinding

## Impact
- Cannot navigate distances > 5 blocks reliably
- Blocks farm setup (base unreachable)
- Daemon stability at risk

## Status
Reported - awaiting code-reviewer fix
