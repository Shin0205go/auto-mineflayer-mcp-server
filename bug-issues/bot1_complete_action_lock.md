## [2026-04-01] Critical Bug: Complete Action Lock - All Async Ops Timeout

**Status**: BLOCKING gameplay. Bot cannot move, dig, place blocks.

### Timeline

1. **awareness()** - PASS (HP 20/20, hunger 17/20, position (8,83,4))
2. **crafting_table create** - PASS (inventory craft via bot.craft())
3. **pathfinder.goto(chest)** - FAIL: 120s timeout (distance 2.6m)
4. **manual setControlState()** - FAIL: wrong direction, falls to y=74
5. **placeBlock()** - FAIL: 120s timeout (blockUpdate event not received)
6. **dig()** - FAIL: 120s timeout (even water block)
7. **Current**: Hunger 16/20, food 0, bot trapped at (2,74,8)

### Root Cause Analysis

```
All async operations timeout at EXACTLY 120s:
- bot.pathfinder.goto(goal)
- bot.dig(block)
- bot.placeBlock(supportBlock, faceVec)
- bot.place(blockName)
```

This suggests:
- **Server is not acknowledging actions** (no `blockUpdate`, `blockBreak`, movement events)
- **Client-server state desynchronized**
- **Not a pathfinder-specific bug** - affects all block interactions

### Code Evidence

```javascript
// This times out:
const movements = new Movements(bot);
bot.pathfinder.setMovements(movements);
const goal = new goals.GoalNear(chest.position.x, chest.position.y, chest.position.z, 2);
await bot.pathfinder.goto(goal);  // 120s timeout

// This also times out:
const block = bot.blockAt(above);
await bot.dig(block);  // 120s timeout on water block

// And this:
await bot.placeBlock(supportBlock, new Vec3(0, 1, 0));  // blockUpdate:(8, 84, 4) timeout
```

### Server Observations

- Bot is **connected** (`bot.isConnected` = true)
- Bot can **read state** (blockAt, entity.position, health, food)
- Bot **cannot initiate** any action requiring server ACK
- Timeout is consistent: exactly 120000ms

### Hypothesis

**mineflayer Bot instance is out of sync with server.** Possible causes:
1. Server chunk not loaded properly
2. Server authentication/session issue
3. Bot's `_client` is not properly forwarding packets
4. Network latency spike locked the connection

### What Works

- `bot.blockAt()` - synchronous read
- `bot.inventory.items()` - read
- `bot.health`, `bot.food` - read
- `bot.chat()` - UNKNOWN (attempted but no feedback)

### What Fails (120s timeout)

- `bot.dig()` - awaits blockBreak event
- `bot.placeBlock()` - awaits blockUpdate event
- `bot.pathfinder.goto()` - awaits movement goal completion
- `bot.equip()` - potentially (not tested due to timeout delays)

### Immediate Fix Required

One of:
1. **Restart bot connection** (`node scripts/mc-connect.cjs`)
2. **Kill and reconnect** (fresh session)
3. **Server-side**: check if bot player is stuck in "no-respond" state
4. **mineflayer**: check `bot._client.status` and packet queue

### Impact

- Claude1 cannot continue gameplay
- Hunger 16/20 → will hit 0 if time passes (estimated 30min of IRL time)
- Food secured in chest (7,80,9) but unreachable
- Crafting_table created but not placed

### Workaround for Other Bots

If Claude1 is lost:
1. Use Claude2-7 to continue gameplay
2. Avoid **any awaited action** until pathfinder is fixed
3. Inspect mineflayer bot state in code before committing actions

---

**Action**: Code reviewer should:
1. Check mineflayer version and known issues
2. Verify server chunk loading around bot position
3. Consider bot reconnect / factory reset
4. Add defensive timeout handler for action failures
