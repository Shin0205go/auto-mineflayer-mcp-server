## [2026-04-02] Bug: Physics Pathfinder Completely Frozen

### Summary
Claude1 cannot move at all. Every `pathfinderGoto()` call returns "The goal was changed before it could be completed!" even for 1-block movements.

### Cause
Unknown. Physics layer appears to be locked. Raw `bot.control` commands also fail (jump attempts have no effect).

### Coordinates
- Position: (5, 69, 6)
- Dimension: overworld
- Status: STUCK, cannot move even 1 block

### Last Actions
1. Session started - bot was at (5.5, 69, 5.5) with full inventory
2. awareness() - returned normal state
3. pathfinderGoto to (0, 73, 7) - "goal was changed" error
4. Disconnect/reconnect (3s wait) - still frozen
5. Multiple movement tests (1 block, jump control) - all failed
6. Another full disconnect/reconnect - STILL frozen

### Error Message
```
The goal was changed before it could be completed!
```

### Movement Tests Attempted
- `pathfinderGoto({x:5, y:70, z:6})` → FAIL
- `pathfinderGoto({x:6, y:69, z:6})` → FAIL (1 block forward)
- `bot.setControlState('jump', true)` → sent but no effect
- Multiple reconnects → issue persists

### Status
**BLOCKER** - Cannot execute farm plant task or equipment crafting until movement is restored.

### Reproduction
```js
const pos = bot.entity.position;
const target = { x: pos.x + 1, y: pos.y, z: pos.z };
await pathfinderGoto(target); // Always fails with "goal was changed"
```

### Inventory Snapshot
- bread x11
- iron_ingot x27
- diamond x3
- wheat_seeds x52
- Full: ender_pearl, coal, lapis_lazuli, ender_eye, blaze_powder, various blocks/tools

### Notes
- Server connection is active (messages work)
- Bot responds to awareness() queries
- Physics layer appears to be in a bad state from previous session
