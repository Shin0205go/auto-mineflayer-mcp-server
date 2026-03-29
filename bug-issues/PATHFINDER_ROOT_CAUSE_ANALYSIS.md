# Pathfinder & Movement System - Root Cause Analysis

## Bug Report Summary

Three critical symptoms reported:
1. `bot.pathfinder.goto()` hangs/times out on ANY distance (even 3 blocks)
2. `setControlState('forward')` + manual walking doesn't move bot at all
3. Bot appears stuck at fixed coordinates despite control input

## Root Causes Identified

### ROOT CAUSE #1: Race Condition in mcExecuteActive Flag Timing

**Location**: `src/tools/mc-execute.ts` (line 54) vs `src/bot-manager/bot-core.ts` (line 819)

**Problem**:
```javascript
// mc-execute.ts:54 - Flag set AFTER bot reference obtained
managed.mcExecuteActive = true;  // <-- Set at line 54
// ... code execution ...
const fn = new AsyncFunction(...keys, `\n${code}\n`);  // <-- Execution at line 96
await Promise.race([fn(...values), timeoutPromise]);     // <-- Promise race at line 104
```

**The race condition**:
- `mcExecuteActive = true` is set synchronously at line 54
- User code is executed asynchronously in `AsyncFunction` at line 96+
- If ANY async code in user script calls `await wait(0)` or yields to event loop, physics ticks fire BEFORE user code fully executes
- Physics tick handler (bot-core.ts:809) checks `if (managedBot.mcExecuteActive)` WHILE still inside AsyncFunction execution
- **BUT**: The flag is set BEFORE the promise chain starts, so the first check passes
- If subsequent code yields (await wait, await pathfinder.goto), creeperFlee CAN fire again

**Evidence from bug-issues/bot1.md**:
```
Bug: pathfinder "The goal was changed before it could be completed" 繰り返し失敗
Frequency: このセッションで20回以上発生。ほぼすべての移動試みで失敗。
```

This pattern matches: bot enters mc_execute → calls `await bot.pathfinder.goto()` → yields control to event loop → physics tick fires → creeperFlee (or another handler) calls `safeSetGoal()` → emits "goal_updated" event → goto() promise rejects with "The goal was changed before it could be completed!"

### ROOT CAUSE #2: safeSetGoal() Calls bot.pathfinder.setGoal() Directly (Line 73)

**Location**: `src/bot-manager/pathfinder-safety.ts` (line 73)

**Problem**:
```javascript
export function safeSetGoal(bot: Bot, goal: any, options: SafeGoalOptions = {}): SafeGoalHandle {
  // ...
  bot.pathfinder.setGoal(goal);  // <-- Direct call at line 73
  // ... interval monitoring ...
}
```

**The issue**:
- `safeSetGoal()` wraps goal-setting with Y-descent monitoring, but does NOT prevent pathfinder event emissions
- When creeperFlee calls `safeSetGoal()` (line 879 in bot-core.ts), it triggers:
  - `setGoal()` event
  - `goal_updated` event in pathfinder
  - Any active `bot.pathfinder.goto()` promise receives "goal was changed" error
- This is the DIRECT cause of "The goal was changed before it could be completed" errors

### ROOT CAUSE #3: setControlState() Not Synchronized with Physics Ticks

**Location**: `src/bot-manager/bot-movement.ts` (lines 102-105, 570, 829, 862)

**Problem**:
```javascript
// Line 102-105: Clear states before pathfinding
bot.setControlState("forward", false);
bot.setControlState("back", false);
bot.setControlState("sprint", false);
bot.setControlState("jump", false);

// Line 862: Sprint-flee sets states
bot.setControlState("sprint", true);
bot.setControlState("forward", true);

// But there's no guarantee the network packet is sent/processed before next physics tick
// Mineflayer queues packets but doesn't guarantee immediate network delivery
```

**The issue** (from bug-issues/bot1.md):
```
setControlState('forward') + jumping: oscillates between Y=88-89, cannot reach Y=93-94
```

This suggests:
1. Control states are queued locally
2. Network packet delivery is delayed (1-2 ticks)
3. Physics engine on server hasn't received the movement update yet
4. Server computes physics with OLD control state
5. Bot position updates without actually moving

### ROOT CAUSE #4: Pathfinder Goal Cleared on Exit, But Interval Listeners Remain

**Location**: `src/tools/mc-execute.ts` (line 130) + `src/bot-manager/bot-movement.ts` (line 168)

**Problem**:
```javascript
// mc-execute.ts:130 - Cleanup after execution
try { rawBot.pathfinder.setGoal(null); } catch {}

// bot-movement.ts:168 - cleanup in finish()
try { bot.pathfinder.setGoal(null); } catch (_) {}
```

**The issue**:
- When mc_execute times out or completes, line 130 sets goal to null
- BUT: if moveToBasic() was in progress, its `checkInterval` (initialized at line 263 in bot-movement.ts) may still be running
- The interval fires after pathfinder is nulled, trying to access stale goal/path state
- This can cause subsequent movement attempts to fail with "no path found" or physics sync issues

### ROOT CAUSE #5: Elevation-Aware Drop Limits But No Corresponding Physics Tick Adjustments

**Location**: `src/bot-manager/bot-movement.ts` (lines 134-140) + pathfinder-safety.ts (lines 61-67)

**Problem**:
- pathfinder-safety.ts has `elevationAware` mode that auto-scales drop limits based on start Y
- At Y>90, it allows `maxYDescent = startY - 62 + 5` (e.g., 33 blocks from Y=90)
- BUT: the pathfinder `maxDropDown` setting in moveToBasic is NOT similarly adjusted
- Bot may plan a path that goes down 30 blocks, but pathfinder movement settings don't support it
- This causes "Cannot reach target" failures on high-elevation terrain

---

## Impact Summary

| Symptom | Root Cause | Evidence |
|---------|-----------|----------|
| goto() timeout on 3 blocks | mcExecuteActive race + safeSetGoal emits goal_updated | "goal was changed" error 20+ times |
| setControlState('forward') no movement | Network packet delay + server physics sync lag | oscillates Y=88-89, can't climb |
| Bot stuck at fixed coordinates | Physics state desync + stale checkInterval + cleared goal | Y=96 fixed, gravity ignored |

---

## Minimal Fix Recommendations

### FIX #1: Atomically Set mcExecuteActive Flag Around Code Execution

**File**: `src/tools/mc-execute.ts`

**Change**:
```javascript
// BEFORE: Set flag early, execution happens later
managed.mcExecuteActive = true;
const fn = new AsyncFunction(...keys, `\n${code}\n`);
await Promise.race([fn(...values), timeoutPromise]);
managed.mcExecuteActive = false;

// AFTER: Set flag inside execution boundary (before AsyncFunction runs)
const wrappedCode = `
try {
  ${code}
} finally {
  // Ensure flag is only true during actual execution
}
`;
const fn = new AsyncFunction(...keys, wrappedCode);
// Set flag right before calling, clear right after
managed.mcExecuteActive = true;
try {
  await Promise.race([fn(...values), timeoutPromise]);
} finally {
  managed.mcExecuteActive = false;
}
```

### FIX #2: Prevent safeSetGoal() from Interrupting Active Goals

**File**: `src/bot-manager/bot-core.ts` (line 879 creeperFlee call)

**Change**:
```javascript
// Check if a goal is already active BEFORE calling safeSetGoal
const hasActiveGoal = !!bot.pathfinder.goal;
if (hasActiveGoal && !managedBot.mcExecuteActive) {
  // Do NOT override an existing pathfinder goal with flee goal
  // Instead use control states only (sprint/forward)
  console.error(`[CreeperFlee] Active pathfinder goal detected, skipping safeSetGoal. Using sprint-only escape.`);
  // Continue with setControlState-only flee...
} else if (!hasActiveGoal) {
  // Safe to set new goal
  creeperGoalHandle = safeSetGoal(bot, ...);
}
```

### FIX #3: Synchronize setControlState() with Physics Tick

**File**: `src/bot-manager/bot-movement.ts` (line 102)

**Change**: Ensure setControlState calls wait for network delivery:
```javascript
// After clearing states, add small delay to ensure packets are sent
bot.setControlState("forward", false);
// ... other state clears ...
await new Promise(r => setTimeout(r, 50)); // Wait for network packet delivery
```

### FIX #4: Clean Up Stale Intervals on mc_execute Exit

**File**: `src/tools/mc-execute.ts` (line 130)

**Change**:
```javascript
// Before cleanup, wait briefly for any in-flight intervals to settle
await new Promise(r => setTimeout(r, 100));
// Then clear goal
try { rawBot.pathfinder.setGoal(null); } catch {}
```

### FIX #5: Elevation-Aware Physics Tick Settings

**File**: `src/bot-manager/bot-movement.ts` (line 1103)

**Change**: Sync pathfinder maxDropDown with safeSetGoal logic:
```javascript
const startY = bot.entity.position.y;
if (startY > 90) {
  bot.pathfinder.movements.maxDropDown = Math.min(startY - 62 + 5, 30);
} else if (startY > 75) {
  bot.pathfinder.movements.maxDropDown = 20;
} else {
  bot.pathfinder.movements.maxDropDown = 4;
}
```

---

## Testing Strategy

1. **Test Fix #1**: Run mc_execute with nested awaits (await wait + await goto) - verify no "goal was changed" errors
2. **Test Fix #2**: Spawn creeper while bot is mid-pathfind - verify goto() continues, not interrupted
3. **Test Fix #3**: Run moveTo 3 blocks away multiple times - verify consistent movement
4. **Test Fix #4**: Monitor stale interval cleanup on timeout - verify no lingering listeners
5. **Test Fix #5**: Test moveTo from high elevation (Y=95) to lower target - verify path planning

---

## Severity Assessment

**CRITICAL**: All three symptoms indicate fundamental pathfinder/physics desync.
Current state: Bot is unreliable for ANY movement. Must fix before gameplay can progress.
