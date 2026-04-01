# [2026-04-01] Critical Bug: Daemon Crash During Gameplay

## Status
**CRITICAL** - Bot daemon crashed unexpectedly while Claude1 was executing mining code

## Cause
Unknown - daemon process terminated without error message

## Context
- Claude1 was safe underground (Y=82) at coordinates (62, 85, 32)
- Attempting to execute mining/ore search code
- Daemon crash on 6th iteration of downward mining loop
- All bots will be disconnected when daemon is restarted

## Error
```
Daemon not running. Start with: npm run daemon
socket hang up
```

## Timeline
1. Claude1 at HP=20, Food=19
2. Underground shelter secured (safe from night mobs)
3. Attempted downward mining code loop
4. Mid-execution: daemon died
5. All subsequent commands fail with "socket hang up"

## Last Bot State
- Position: (62, 85, 32) underground
- HP: 20, Food: 19
- Inventory: 19/36 items, no ore collected yet
- Safe: Yes (underground at night)

## Impact
- Daemon restart required, but will disconnect all 7 bots
- Cannot resume Claude1 gameplay until daemon restarts
- 90+ minute mining session progress lost

## Notes
- Per CLAUDE.md: "NEVER run `npm run daemon`" — restart disables all 7 bots
- This appears to be a stability issue in the daemon or bot manager
- May be related to rapid pathfinder calls or ore-finding loops

## Action Required
- [ ] Investigate daemon stability (check logs)
- [ ] Determine if this is a memory leak or timeout issue
- [ ] Consider adding daemon auto-restart capability
- [ ] Check if rapid bot.findBlock() calls cause daemon crashes
