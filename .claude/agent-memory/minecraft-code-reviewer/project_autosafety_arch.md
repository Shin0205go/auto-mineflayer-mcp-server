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

## Known limitations
- tryGeneralFlee uses GoalXZ (horizontal only) — cannot flee from aerial mobs like Phantom
- Phantom defense relies on auto-sleep to skip night before Phantoms spawn
- general-flee is idle-only (mcExecuteActive guard) — does not protect during long mc_execute calls
- emergencyEat/autoEat fire even during mc_execute (no mcExecuteActive guard)
