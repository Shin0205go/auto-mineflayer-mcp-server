#!/bin/bash

# Run Claude3 agent for 5 minutes
export BOT_USERNAME=Claude3
export START_MCP_SERVER=false

echo "[Claude3] Starting 5-minute play session..."
node dist/agent/claude-agent.js &
AGENT_PID=$!

echo "[Claude3] Agent PID: $AGENT_PID"

# Wait for 5 minutes (300 seconds)
sleep 300

echo "[Claude3] 5 minutes elapsed, stopping agent..."
kill $AGENT_PID 2>/dev/null

echo "[Claude3] Session complete"
