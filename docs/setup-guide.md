# Mineflayer MCP Server Setup Guide

## Claude Code MCP Configuration

To use the learning tools (`save_memory`, `log_experience`, etc.) through Claude Code, you must add the mineflayer MCP server to your Claude desktop configuration.

### Configuration File Location

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Add Mineflayer Server

Add this entry to the `mcpServers` section:

```json
{
  "mcpServers": {
    "mineflayer": {
      "command": "node",
      "args": [
        "/path/to/minecraftAIViewer/dist/index.js"
      ],
      "env": {
        "MC_HOST": "localhost",
        "MC_PORT": "25565",
        "BOT_USERNAME": "Claude"
      }
    }
  }
}
```

**Important**: Update `/path/to/minecraftAIViewer` with your actual project path.

### Required Steps

1. **Build the project**:
   ```bash
   cd /path/to/minecraftAIViewer
   npm run build
   ```

2. **Add to Claude Code config** (see above)

3. **Restart Claude Code** to load the new MCP server

4. **Verify tools are available**:
   - Learning tools: `save_memory`, `log_experience`, `recall_memory`, `forget_memory`
   - Skill tools: `list_agent_skills`, `get_agent_skill`
   - All other Minecraft tools

### Troubleshooting

**"Unknown tool" errors**:
- Ensure the MCP server is added to the config
- Verify the path to `dist/index.js` is correct
- Restart Claude Code after configuration changes
- Check that `npm run build` completed successfully

**Connection issues**:
- Ensure Minecraft server is running on the specified host:port
- Verify BOT_USERNAME is allowed on the server
- Check the bot has op permissions: `/op Claude`

## Two Server Architecture

This project uses two MCP servers:

1. **Stdio MCP Server** (`index.js`):
   - Used by Claude Code for tool calls
   - Exposes all tools to Claude interface
   - Configured in `claude_desktop_config.json`

2. **WebSocket MCP Server** (`mcp-ws-server.js`):
   - Used by Game Agent and Dev Agent
   - Provides real-time event push notifications
   - Filters tools by agent type (game vs dev)
   - Started with `npm run start:mcp-ws`

Both servers share the same tool implementations from the `bot-manager` and `tools` modules.
