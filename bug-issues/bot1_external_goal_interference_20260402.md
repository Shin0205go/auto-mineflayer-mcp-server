## Bug: External Goal Interference During Navigation

**Date**: 2026-04-02 14:45 UTC
**Bot**: Claude1
**Status**: CRITICAL

### Symptoms
- `bot.pathfinder.goto()` fails with error: "The goal was changed before it could be completed!"
- Multiple sequential pathfinder calls (multiStagePathfind, regular pathfinder) all fail with same error
- Error occurs even with simple 3-block radius GoalNear
- Happens after bot was recovered from void/suspended state

### Environment
- Bot Position: (-3, 52-55, -2 range)
- Target: Base at (~4, ~92, ~6)
- Distance: ~40 blocks horizontal, ~40 blocks vertical
- Timeout: 30000ms for each attempt

### Last Working Action
Session 255d64f: Claude1 successfully navigated and planted wheat multiple times before terrain deadlock

### Possible Causes
1. Multiple agents trying to control Claude1 simultaneously (Claude2-7 interference?)
2. Daemon process changing bot goals externally
3. Pathfinder state corruption after descendSafely()
4. Goal stack overflow from abandoned/cancelled goals

### Affected Code
- `mc_execute.ts` pathfinder.goto() calls
- `multiStagePathfind()` helper
- `pathfinderGoto()` wrapper

### Impact
- Phase 2 cannot continue (cannot reach farm blocks)
- Bot is stranded at (-3, 52-55, -2)
- Cannot execute any pathfinder-based navigation

### Reproduction
```javascript
// Any of these fail with same error:
await bot.pathfinder.goto(new goals.GoalNear(4, 92, 6, 3));
await multiStagePathfind(4, 6, 30, 92);
```

### Workaround
- Manual movement using `bot.setControlState()` (used in previous session successfully)
- Avoid multiStagePathfind and parallel goal changes

### Investigation Needed
1. Check if Claude2-7 bots are active and interfering
2. Review pathfinder goal queue/state
3. Check bot-manager for concurrent goal changes
4. Verify sandbox isolation in mc_execute
