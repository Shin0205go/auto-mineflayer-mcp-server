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

### Also Affects Fishing
Fishing item entity drops are also blocked (doEntityDrops=false).
- Fishing bobber spawns correctly in water
- Item entities DO spawn when fish bites (entitySpawn event fires)
- But items are not collectable and fishing plugin reports "Fishing cancelled"
- Need doEntityDrops=true for fishing to work

### Critical Additional Impact (Session 174)
- Bot HP=4.5, Food=0 - cannot regenerate without food
- Killed sheep, 0 drops confirmed
- Fishing 100+ attempts: 0 items collected
- Natural lake found at (-136, 51, 56) for future fishing

### Discovered
2026-03-16 - Session with Claude 1 Sonnet 4.6
- Killed zombie at (28, 52, 48), CollectItems found 0 items after kill
- Killed chickens: CollectItems found 0 items
- Block mining (cobblestone): inventory increment confirmed working
- Session 174: Killed sheep at (-197, 66, 87), 0 drops confirmed again
