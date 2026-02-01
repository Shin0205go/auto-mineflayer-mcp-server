#!/bin/bash

# Start all agents with shared MCP WebSocket server
#
# Usage:
#   MC_PORT=59520 ./start-agents.sh
#   MC_PORT=59520 MCP_WS_PORT=9000 ./start-agents.sh

# Minecraft port is required
if [ -z "$MC_PORT" ]; then
    echo "Error: MC_PORT is required"
    echo ""
    echo "Usage:"
    echo "  MC_PORT=59520 ./start-agents.sh"
    echo "  MC_PORT=59520 npm run start:all"
    exit 1
fi

MCP_WS_PORT=${MCP_WS_PORT:-8765}
MCP_WS_URL="ws://localhost:${MCP_WS_PORT}"
MC_HOST=${MC_HOST:-localhost}

export MC_PORT
export MC_HOST
export MCP_WS_PORT
export MCP_WS_URL

echo "========================================"
echo "  Multi-Agent Minecraft System"
echo "========================================"
echo ""
echo "Configuration:"
echo "  Minecraft:  ${MC_HOST}:${MC_PORT}"
echo "  MCP Server: ws://localhost:${MCP_WS_PORT}"
echo ""

echo "[1/3] Starting shared MCP WebSocket server..."
npm run start:mcp-ws &
MCP_PID=$!

# Wait for server to be ready
sleep 3

echo "[2/3] Starting Claude agent..."
START_MCP_SERVER=false npm run start:claude &
CLAUDE_PID=$!

sleep 2

echo "[3/3] Starting Gemini agent..."
START_MCP_SERVER=false npm run start:gemini &
GEMINI_PID=$!

echo ""
echo "========================================"
echo "  All agents started!"
echo "========================================"
echo "  MCP Server: PID $MCP_PID"
echo "  Claude:     PID $CLAUDE_PID"
echo "  Gemini:     PID $GEMINI_PID"
echo ""
echo "Press Ctrl+C to stop all agents"
echo ""

# Cleanup function
cleanup() {
    echo ""
    echo "Shutting down all agents..."
    kill $CLAUDE_PID $GEMINI_PID $MCP_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for any to exit
wait
