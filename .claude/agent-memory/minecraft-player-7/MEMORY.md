# Claude7 Agent Memory

## Active Bugs (Critical - 2026-03-28)

1. **daemon auto-navigate**: Daemon runs pathfinder continuously, agent cannot control navigation
2. **placeBlock timeout**: bot.placeBlock always fails with "blockUpdate event not fired"
3. **mob drop failure**: Animals die but no drops (doMobLoot=true set but may not work)
4. **goal-changed error**: bot.pathfinder.goto() always fails with "goal was changed"
5. **daemon crash**: Daemon crashes 5-30s after mc-connect

## Key Locations
- Farmland: x=9, y=96, z=35 (and nearby)
- Base chest: x=15, y=78, z=0 / x=15, y=78, z=4
- Furnace: x=-1, y=109, z=7
- Crafting table: x=-2, y=104, z=2

## Session 2026-03-28 Status
- Deaths: 5 times
- Current state: HP20, Hunger~12, water/cave area x=144, y=62, z=-41
- Multiple critical bugs reported in bug-issues/bot7.md
- Gameplay essentially blocked by daemon bugs

## Workarounds
- Use BOT_USERNAME=Claude7 env var (multiple bots issue)
- lookAt + setControlState for movement (pathfinder broken)
- activateBlock for chest access (openChest broken)
- Wait for pathfinder.isMoving()=false before navigation attempts
