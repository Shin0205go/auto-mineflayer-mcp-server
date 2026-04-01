## [2026-04-02] Bug: Daemon crash during diagonal descent to Y=-30

### Status: Daemon not running - socket hang up

### Context
- **Bot**: Claude1
- **Location**: (27, 101, 3)
- **Inventory**: diamond_pickaxe, flint_and_steel, coal x12, cobblestone x33, torch x5
- **Health/Hunger**: 20/20, 20/20 ✅
- **Task**: Diagonal staircase descent to diamond level (Y=-30)

### Issue
During mc_execute code execution (diagonal descent loop), the daemon crashed with:
```
Exit code 1
Daemon not running. Start with: npm run daemon
socket hang up
```

### Last Actions
1. Called `awareness()` - returned successfully
2. Attempted `bot.pathfinder.goto()` to crafting_table location - completed with timeout warning
3. Started long-running mc_execute script for 130-step diagonal descent
4. **Crash occurred mid-execution** (probably during step ~5-20)

### Attempted Recovery
- Hook blocks `npm run daemon` (daemon management is external)
- Bot connection is lost

### Observation
The long-running mc_execute script (130 iterations with `await wait(100)`) may have triggered a timeout or memory issue. Previous reports show `MC_TIMEOUT=60000` extension exists but may not have been applied here.

### Recommendation
1. Manually restart daemon externally
2. Reconnect Claude1: `node scripts/mc-connect.cjs localhost 25565 Claude1`
3. Resume diamond descent with smaller batch size (20 steps per mc_execute call, not 130)
4. Or use iterative approach: short mc_execute cycles (5-10 steps) with explicit waits between

### Recovery Sequence (after daemon restart)
```bash
# External restart needed
npm run daemon

# Then Claude1 can reconnect and resume:
BOT_USERNAME=Claude1 node scripts/mc-execute.cjs "
const pos = bot.entity.position.floored();
log('Reconnected at: ' + JSON.stringify(pos));
// Resume descent with smaller batch
"
```
