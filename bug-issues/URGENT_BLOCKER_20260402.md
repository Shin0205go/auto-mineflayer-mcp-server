# URGENT BLOCKER: dig() and pathfinder.goto() Hang for 120+ Seconds

## Executive Summary
Game session is completely blocked. All mining and navigation operations time out after 120 seconds with no recovery. Affects all bots that depend on these core operations.

## Affected Operations
- `bot.dig(block)` — mining blocks (timeout every time)
- `bot.pathfinder.goto()` — navigation to any distance > 1 block (timeout every time)

## Session Timeline
- **T=00:00** Phase 3 started: iron pickaxe + sword target
- **T=01:00** First dig() timeout (coal_ore mining)
- **T=02:00** Second dig() timeout (pillar descent attempt)
- **T=03:00** Pathfinder timeout (Y=30 descent)
- **T=04:00** Third dig() timeout (coal_ore mining at different location)
- **T=05:00** Pathfinder timeout (base return)
- **T=06:00+** Persistent hangs on all pathfinder calls, including 5-block micro-movements

## Reproduction Steps
1. Connect bot to server
2. Call `bot.dig(blockObject)` for any block
3. Result: Promise never resolves, 120-second timeout

OR

1. Call `bot.pathfinder.goto(new goals.GoalXZ(x, z))`
2. Result: Promise never resolves, 120-second timeout

## Evidence from Logs
```
Error: Execution timed out after 120000ms
Logs before error:
=== Y=30への掘り下げ開始 ===
（何も実行されない）
```

Repeated 3+ times in single session.

## Probable Causes
1. **Chunk loading failure** — `bot.world.getColumns().size` returns `undefined` (should be number)
2. **Navigation graph corruption** — After dig() failures, all pathfinding fails even for trivial distances
3. **Block state mismatch** — dig() may fail to update internal state, causing pathfinder to deadlock
4. **Timeout handling in mineflayer** — Promises not properly caught/rejected when path calculation stalls

## Impact
- **Severity**: CRITICAL (game unplayable)
- **Affected Bots**: All (Claude1, Claude2-7)
- **Phase Impact**: Phase 1-8 blocked (all require mining or navigation)

## Required Actions for Code-Reviewer
1. **Immediate**: Check `src/tools/mc-execute.ts` for dig() / pathfinder wrapper logic
2. **Chunk loading**: Verify `bot.world.getColumns()` returns valid data
3. **Timeout handling**: Add explicit promise rejection after timeout threshold
4. **Test**: Single dig() call on cobblestone, then pathfinder to nearby block
5. **Fallback**: Implement alternative mining method (e.g., attack-based block destruction) if dig() is unfixable

## Notes
- Session was NOT salvageable with current code
- Bot reconnect did NOT fix the issue (persistent)
- Player requested alternative approaches but all depend on dig() / pathfinder

---
**Reported by:** Claude1 (game agent)
**Date:** 2026-04-02
**Status:** Waiting for code-reviewer fix
