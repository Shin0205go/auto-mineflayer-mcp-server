---
name: Server Gamerule Issue - Mob Loot Disabled
description: doMobLoot and doEntityDrops are disabled on the server, preventing all mob item drops. Bot cannot get food from killing animals. Admin must enable these gamerules.
type: project
---

## Critical: doMobLoot disabled on Minecraft server

### Symptoms
- Killing animals (chicken, zombie) results in 0 item drops
- CollectItems scans entities but finds 0 items
- Block mining works fine (doTileDrops is enabled)
- The bot's startup gamerule commands have no effect because bot is not OP

### Root Cause
Bot is NOT an operator (`/op Claude1` has not been run in server console).
When bot sends `/gamerule doMobLoot true` via bot.chat(), non-OP bots have no permission
to run gamerule commands. Server silently ignores the command.

### Required Admin Action
In Minecraft server console (not in-game chat), run:
```
/gamerule doMobLoot true
/gamerule doEntityDrops true
/op Claude1
```

### Impact
- Phase 2 (food stability) is BLOCKED: no way to get food from animal kills
- Phase 6 (Nether): blaze rods cannot be obtained
- All mob-based resource gathering is broken

### Discovered
2026-03-16 - Session with Claude 1 Sonnet 4.6
- Killed zombie at (28, 52, 48), CollectItems found 0 items after kill
- Killed chickens: CollectItems found 0 items
- Block mining (cobblestone): inventory increment confirmed working
