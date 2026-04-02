## Bug: Pathfinder "goal was changed" error on consecutive navigation attempts

**Date**: 2026-04-02
**Status**: REPORTED

### Symptoms

When attempting multiple `bot.pathfinder.goto()` calls in quick succession (within same mc_execute block), the second and subsequent navigation calls fail with:
```
Error: The goal was changed before it could be completed!
```

This occurs even when the goals are set sequentially with proper error handling.

### Reproduction Steps

1. Set movements: `bot.pathfinder.setMovements(new Movements(bot))`
2. First goal: `await bot.pathfinder.goto(new goals.GoalNear(x1, y1, z1, range))`
3. Wait briefly
4. Second goal: `await bot.pathfinder.goto(new goals.GoalNear(x2, y2, z2, range))`
   → **FAILS with "goal was changed"**

### Code Example

```javascript
const movements = new Movements(bot);
bot.pathfinder.setMovements(movements);

const directions = [{x: 15, z: 0}, {x: -15, z: 0}, {x: 0, z: 15}, {x: 0, z: -15}];

for (const dir of directions) {
  const pos = bot.entity.position;
  const target = new Vec3(pos.x + dir.x, pos.y, pos.z + dir.z);

  try {
    // All 4 iterations fail with "goal was changed"
    await bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 3));
    await wait(500);
  } catch(e) {
    log('Navigation failed: ' + e.message);
  }
}
```

### Expected Behavior

Each goto() call should complete independently. If the goal needs to change, the previous pathfinding should cancel cleanly.

### Actual Behavior

Second and subsequent goto() calls always fail with "goal was changed", making exploration/multi-waypoint navigation impossible.

### Impact

- Cannot explore in multiple directions
- Cannot implement waypoint-based travel
- Animal hunting exploration fails
- Severely limits bot mobility

### Possible Causes

- Mineflayer pathfinder state not being reset between goals
- Goal change detection not working correctly
- Previous navigation thread still running when next goal is set

### Workaround

Currently none. Single-destination navigation works, but sequential exploration fails.

### System Info

- Mineflayer version: (from package.json dependencies)
- Node.js version: (current env)
- Minecraft server: localhost 25565
- Bot: Claude1
