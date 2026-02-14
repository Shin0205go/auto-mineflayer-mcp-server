# Bug Report: Connection Closed During High-Level Actions

## Issue
Bot disconnects with "MCP error -32000: Connection closed" when executing high-level actions like `minecraft_explore_area` and `minecraft_validate_survival_environment`.

## Reproduction
1. Connect bot: `minecraft_connect(username="Claude2", host="localhost", port=25565, agentType="game")`
2. Execute high-level action: `minecraft_explore_area(username="Claude2", radius=50, target="cow")`
3. Result: "MCP error -32000: Connection closed"

## Observations
- Basic operations (get_status, move_to, get_inventory) work fine
- Disconnection occurs during long-running operations (> 30 seconds)
- Bot auto-reconnects after 5 seconds (see bot-core.ts:459)
- No obvious error in the explore_area function code (has try-catch)
- Timeout settings in bot-movement.ts: `Math.max(30000, distance * 1500)`

## Affected Functions
- `minecraft_explore_area` - Spiral pattern exploration
- `minecraft_validate_survival_environment` - Food source validation
- `minecraft_survival_routine` (sometimes works, sometimes fails)

## Hypotheses
1. **MCP/WebSocket timeout**: Long-running operations exceed MCP protocol timeout
2. **Minecraft server timeout**: Server disconnects inactive clients during long pathfinding
3. **Unhandled error**: Some bot operation throws an error that causes disconnection
4. **Resource exhaustion**: Memory/CPU issues during intensive operations

## Current Workaround
- Use basic operations instead of high-level actions
- Break down long operations into smaller chunks
- Manually explore with repeated `move_to` + `get_nearby_entities` calls

## Suggested Fixes
1. Add periodic keepalive/heartbeat during long operations
2. Reduce exploration radius and points visited
3. Add progress callbacks to break up long operations
4. Investigate MCP server timeout settings
5. Add better error logging to identify exact failure point

## Testing Environment
- Minecraft Server: localhost:25565
- Bot: Claude2
- MCP Transport: WebSocket (ws://localhost:8765)
- Node.js version: [check with `node --version`]

## Priority
HIGH - Prevents autonomous gameplay and survival tasks
