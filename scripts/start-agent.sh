#!/bin/bash
# Start self-healing Minecraft Agent with PM2

set -e

echo "🤖 Starting Minecraft Self-Healing Agent..."

# Ensure logs directory exists
mkdir -p logs

# Use npx to run pm2
PM2="npx pm2"

# Start Board Viewer (if not already running)
if ! $PM2 show board-viewer &>/dev/null; then
  echo "📱 Starting Board Viewer..."
  $PM2 start ecosystem.config.cjs --only board-viewer
fi

# Start MCP WebSocket Server (if not already running)
if ! $PM2 show mcp-ws-server &>/dev/null; then
  echo "📡 Starting MCP WebSocket Server..."
  $PM2 start npm --name mcp-ws-server -- run start:mcp-ws
fi

# Copy MCP config to Claude's config directory
mkdir -p ~/.claude
cp scripts/claude-mcp-config.json ~/.claude/mcp_settings.json
echo "✅ Claude Code MCP config installed (stdio bridge → WebSocket)"

# Wait for MCP server to be ready
echo "⏳ Waiting for MCP server..."
sleep 3

# Start Claude Code agent
echo "🚀 Starting Claude Code agent..."
$PM2 start ecosystem.config.cjs

# Show status
echo ""
echo "✅ Agent started!"
echo ""
$PM2 status

echo ""
echo "📊 View logs:"
echo "  npx pm2 logs minecraft-agent"
echo ""
echo "🌐 Web Viewers:"
echo "  Board Viewer:       http://localhost:3001"
echo "  Prismarine Viewer:  http://localhost:3007  (starts when bot connects to Minecraft)"
echo ""
echo "🛑 Stop agent:"
echo "  npx pm2 stop minecraft-agent"
echo ""
echo "🔄 Restart agent:"
echo "  npx pm2 restart minecraft-agent"
