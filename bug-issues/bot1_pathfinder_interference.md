---
date: 2026-04-02
bot: Claude1
issue: Pathfinder goal interference during multibot session
severity: high
---

## Problem

Claude1 attempted multiple pathfinder operations during Phase 2 farming tasks, but each call failed with:
```
Error: The goal was changed before it could be completed!
```

This occurred across multiple attempts:
1. `pathfinderGoto(new goals.GoalXZ(0, 7))` → failed with goal changed
2. `pathfinderGoto(new goals.GoalNear(6, 71, -5))` → failed with goal changed
3. `multiStagePathfind(target.x, target.z, 8, target.y)` → failed with goal changed

## Root Cause

Another bot (Claude2-7) appears to be setting conflicting pathfinder goals simultaneously, overwriting Claude1's goal mid-navigation. This is a **multibot coordination issue** rather than Claude1-specific.

## Impact

- Cannot reach farmland blocks to plant wheat_seeds
- plantSeeds() requires distance < 5 blocks, but navigation fails before reaching targets
- Phase 2 farming incomplete: 9 farmland blocks exist but only 1 wheat grown
- Food stockpile at 11 bread (target: 20+)

## Affected Areas

- `src/bot-manager/pathfinder-wrapper.ts` (if exists) — needs goal lock mechanism
- `src/tools/mc-execute.ts` — sandbox goal management
- Multibot coordination layer — needs queue/lock for pathfinder access

## Reproducibility

HIGH — occurs consistently when multiple bots attempt navigation during same session

## Workaround

- Use only `pillup(height)`, `descendSafely()` for vertical movement
- Skip pathfinder-dependent tasks, use direct block placement instead
- Implement per-bot pathfinder queue/mutex

## Status

Reported for code-review team to investigate multibot goal synchronization.
