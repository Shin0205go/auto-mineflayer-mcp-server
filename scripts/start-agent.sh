#!/bin/bash
# Start self-healing Minecraft Agent with PM2

set -e

echo "🤖 Starting Minecraft Self-Healing Agent..."

# Ensure logs directory exists
mkdir -p logs

# Start MCP WebSocket Server (if not already running)
if ! pm2 show mcp-ws-server &>/dev/null; then
  echo "📡 Starting MCP WebSocket Server..."
  pm2 start npm --name mcp-ws-server -- run start:mcp-ws
fi

# Wait for MCP server to be ready
echo "⏳ Waiting for MCP server..."
sleep 3

# Start Claude Code agent
echo "🚀 Starting Claude Code agent..."
pm2 start ecosystem.config.js

# Show status
echo ""
echo "✅ Agent started!"
echo ""
pm2 status

echo ""
echo "📊 View logs:"
echo "  pm2 logs minecraft-agent"
echo ""
echo "🛑 Stop agent:"
echo "  pm2 stop minecraft-agent"
echo ""
echo "🔄 Restart agent:"
echo "  pm2 restart minecraft-agent"
