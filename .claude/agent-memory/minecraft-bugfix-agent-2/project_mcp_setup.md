---
name: MCP Setup for minecraft-bugfix-agent-2 session
description: How the mineflayer MCP server is configured and what tools are available
type: project
---

## MCP Tools Available

The Minecraft tools are provided by this project's MCP server (dist/index.js).
They are available as `mcp__mineflayer__*` tools ONLY when:
1. The .mcp.json file exists at project root with the mineflayer server config
2. Claude Code session is restarted to pick up the .mcp.json

## Current .mcp.json (created 2026-03-23)
Points to: `node dist/index.js` with MC_BOT_USERNAME=Claude2

## Tools (4 visible in game mode)
- `mc_connect` — connect/disconnect to Minecraft server
- `mc_chat` — send/receive chat (must call before EVERY action)
- `mc_execute` — main gameplay tool, runs JS code with bot.* API
- `mc_reload` — hot-reload after code changes

## Note
If tools are not available after session start, check:
1. .mcp.json exists at /Users/shingo/Develop/auto-mineflayer-mcp-server/.mcp.json
2. dist/index.js exists (run `npm run build` if not)
3. Restart Claude Code session to pick up MCP config
