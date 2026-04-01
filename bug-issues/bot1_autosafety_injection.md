## Bug: safetyState not injected into mc_execute sandbox

### Summary
AutoSafety state is defined in `src/bot-manager/auto-safety.ts` and assigned to `managed.safetyState` in constructor (line 43). However, when accessed in `mc_execute()` code, `safetyState` is undefined.

### Expected Behavior
- `safetyState` should be injected into mc_execute sandbox context (line 504 of mc-execute.ts)
- Agents should be able to access: `safetyState.autoEatActive`, `safetyState.lastAction`, etc.

### Actual Behavior
- `safetyState` is `undefined` in sandbox
- `log('safetyState: ' + JSON.stringify(safetyState))` throws "safetyState is not defined"

### Code Analysis

**mc-execute.ts line 504:**
```javascript
safetyState: managed.safetyState ?? null,
```

**bot-core.ts line 809-810:**
```javascript
const autoSafety = new AutoSafety(managedBot);
autoSafety.start();
```

**auto-safety.ts constructor line 43:**
```javascript
managed.safetyState = this.state;
```

### Hypothesis
1. `managed` object is retrieved, but the AutoSafety hasn't been initialized yet when mc_execute runs
2. OR managed.safetyState is set to undefined/null somewhere else after initialization
3. OR the managed object in mc_execute is a different instance than the one with AutoSafety

### Steps to Reproduce
```bash
node scripts/mc-connect.cjs localhost 25565 Claude1
BOT_USERNAME=Claude1 node scripts/mc-execute.cjs "log(typeof safetyState)"
# Output: undefined
```

### Test Case
Run any mc_execute code:
```javascript
if (safetyState) {
  log('autoEatActive: ' + safetyState.autoEatActive);
  log('lastAction: ' + safetyState.lastAction);
}
```

### Impact
- Tests for AutoSafety functionality cannot be run
- Cannot verify auto-eat, creeper flee, etc. are working
- Agents cannot introspect safety state

### Files Affected
- src/tools/mc-execute.ts (line 504)
- src/bot-manager/auto-safety.ts (full file)
- src/bot-manager/bot-core.ts (line 809-810)

### Status
Reported - awaiting code review
