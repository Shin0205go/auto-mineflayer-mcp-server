#!/bin/bash
# Start Agent Teams - Multiple Claude Code instances working together

set -e

echo "🤖👥 Starting Minecraft Agent Team..."

# Ensure logs directory exists
mkdir -p logs

# Use npx to run pm2
PM2="npx pm2"

# Start MCP WebSocket Server (if not already running)
if ! $PM2 show mcp-ws-server &>/dev/null; then
  echo "📡 Starting MCP WebSocket Server..."
  $PM2 start npm --name mcp-ws-server -- run start:mcp-ws
fi

# Wait for MCP server to be ready
echo "⏳ Waiting for MCP server..."
sleep 3

# Stop single agent if running
if $PM2 show minecraft-agent &>/dev/null; then
  echo "⚠️  Stopping single agent mode..."
  $PM2 stop minecraft-agent
fi

# Start team members
echo "🚀 Starting Agent Team..."
echo ""
echo "  👑 Team Lead (coordinator, task manager)"
echo "  🔨 Member 1 (mining, resource gathering)"
echo "  🏗️  Member 2 (building, crafting)"
echo ""

# Uncomment the agent team section in ecosystem.config.cjs
sed -i.bak 's|/\*||g; s|\*/||g' ecosystem.config.cjs

# Start all team members
$PM2 start ecosystem.config.cjs --only team-lead,team-member-1,team-member-2

# Restore original config
mv ecosystem.config.cjs.bak ecosystem.config.cjs

# Show status
echo ""
echo "✅ Agent Team started!"
echo ""
$PM2 status

echo ""
echo "📊 View logs:"
echo "  npx pm2 logs team-lead          # Team coordinator"
echo "  npx pm2 logs team-member-1      # Mining specialist"
echo "  npx pm2 logs team-member-2      # Building specialist"
echo "  npx pm2 logs                    # All logs"
echo ""
echo "🛑 Stop team:"
echo "  npx pm2 stop team-lead team-member-1 team-member-2"
echo ""
echo "💡 The team will:"
echo "  - Lead creates and assigns tasks"
echo "  - Members claim and execute tasks"
echo "  - Communicate via minecraft_chat"
echo "  - Self-heal on errors"
echo "  - Work in parallel on different objectives"
