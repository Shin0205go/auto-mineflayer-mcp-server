---
name: AutoSafety architecture
description: AutoSafety class structure, integration points, and known past bugs
type: project
---

# AutoSafety Architecture

**File:** `src/bot-manager/auto-safety.ts`

## Integration
- Instantiated in `bot-core.ts` inside the `spawn` event handler (line 809-810):
  `const autoSafety = new AutoSafety(managedBot); autoSafety.start();`
- Stopped in `bot.on("end", ...)` via `autoSafety.stop()`
- State injected into mc_execute sandbox as `safetyState: managed.safetyState ?? null` (mc-execute.ts:505)

## Tick structure
- `setInterval(() => tick(), 2000)` — auto-eat, general-flee, auto-sleep
- `bot.on("physicsTick", onPhysicsTick)` — creeper-flee + emergency-dodge (~50ms)

## Priority order in tick()
1. tryEmergencyEat (HP < 6, has food)
2. tryAutoEat (food <= 6, has food)
3. tryGeneralFlee (idle-only, HP < 10, hostile within 8 blocks)
4. tryAutoSleep (idle-only, night, no threats, has bed)

## physicsTick order
1. tryEmergencyDodge (HP < 4, hostile within 5 blocks, raw back+jump+sprint)
2. Creeper-flee (creeper within 7 blocks, sprint-flee + optional pathfinder)

## Past bug: emergencyDodge not wired (fixed 2026-04-01 commit 1780ace)
tryEmergencyDodge() existed but was never called from onPhysicsTick().
Fix: added `this.tryEmergencyDodge()` at the top of onPhysicsTick().

## Past bug: generalFleeActive updateState used wrong field (fixed 2026-04-01 commit d1b26d8)
tryGeneralFlee() called updateState("general-flee", ..., "creeperFleeActive") — updating the
wrong SafetyState field. safetyState.creeperFleeActive would become true during general flee
events, misleading agents that read the state. Also SafetyState lacked generalFleeActive field.
Fix: added generalFleeActive to SafetyState interface + updated all three updateState calls.

## Past bug: "goal was changed" from AutoSafety/mc_execute race (fixed 2026-04-01 commit 72f6c5f)
All three pathfinder-using actions (navigateTo, tryGeneralFlee, creeper flee) set a goal and
then waited a fixed time (2-10s) before calling goalHandle.cleanup(). If mc_execute started
during that window and called pathfinderGoto() -> rawBot.pathfinder.goto(), the new goal
overwrote the AutoSafety goal, causing mineflayer to emit "goal was changed before it could
be completed" on the AutoSafety goto promise. This error propagated back to pathfinderGoto().
Fix: replaced all fixed-duration cleanups with 200ms mcExecuteActive polling. Each action
now calls goalHandle.cleanup() within ~200ms of mc_execute starting.

## Known limitations
- tryGeneralFlee uses GoalNear (horizontal flee target) — cannot flee from aerial mobs like Phantom
- Phantom defense relies on auto-sleep to skip night before Phantoms spawn
- general-flee is idle-only (mcExecuteActive guard) — does not protect during long mc_execute calls
- emergencyEat/autoEat fire even during mc_execute (no mcExecuteActive guard)
