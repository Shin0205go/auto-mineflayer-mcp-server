#!/bin/bash
# Run Claude Code Agent Team in interactive mode with auto-restart

set -e

cd /Users/shingo/Develop/minecraftAIViewer

echo "👥 Starting Claude Code Agent Team..."
echo "3 agents will start: Lead, Member1, Member2"
echo "Press Ctrl+C to stop all agents"
echo ""

# Function to run a single agent
run_agent() {
  local AGENT_NAME=$1
  local BOT_USERNAME=$2
  local ROLE=$3
  local PORT=$4

  while true; do
    echo "[$AGENT_NAME] Starting... (port offset: $PORT)"

    if [ "$ROLE" = "lead" ]; then
      PROMPT="You are the Team Leader.

Connect to Minecraft server: minecraft_connect(host=localhost, port=60038, username=$BOT_USERNAME)

Leader role:
1. Use agent_board_write to give instructions
2. Assign tasks (Member1: mining, Member2: building/food)
3. Monitor progress

Connect first, then give instructions to team members."
    else
      PROMPT="You are team member $AGENT_NAME.

Connect to Minecraft server: minecraft_connect(host=localhost, port=60038, username=$BOT_USERNAME)

Member role:
1. Use agent_board_read to check leader instructions
2. Execute assigned tasks ($AGENT_NAME: $ROLE)
3. Report completion via agent_board_write

Connect first, then wait for leader instructions."
    fi

    # Use printf to avoid encoding issues with echo
    printf '%s\n' "$PROMPT" | claude \
      --dangerously-skip-permissions \
      --mcp-config /Users/shingo/Develop/minecraftAIViewer/scripts/claude-mcp-config.json

    echo "[$AGENT_NAME] Exited, restarting in 3 seconds..."
    sleep 3
  done
}

# Start board viewer if not running
if ! lsof -i :3001 >/dev/null 2>&1; then
  echo "📱 Starting Board Viewer..."
  npm run board:view >/dev/null 2>&1 &
  sleep 2
fi

# Start agents in background
echo "🚀 Launching agents..."
echo ""

run_agent "LeadAgent" "LeadAgent" "lead" "3007" > logs/team-lead.log 2>&1 &
LEAD_PID=$!

sleep 3

run_agent "Member1" "Member1" "mining" "3008" > logs/team-member1.log 2>&1 &
MEMBER1_PID=$!

sleep 3

run_agent "Member2" "Member2" "building/food" "3009" > logs/team-member2.log 2>&1 &
MEMBER2_PID=$!

echo "✅ All agents started!"
echo ""
echo "👑 Lead Agent  (PID: $LEAD_PID) - Viewer: http://localhost:3007"
echo "⛏️  Member 1    (PID: $MEMBER1_PID) - Viewer: http://localhost:3008"
echo "🏗️  Member 2    (PID: $MEMBER2_PID) - Viewer: http://localhost:3009"
echo "📋 Board Viewer: http://localhost:3001"
echo ""
echo "📊 View logs:"
echo "  tail -f logs/team-lead.log"
echo "  tail -f logs/team-member1.log"
echo "  tail -f logs/team-member2.log"
echo ""

# Wait for all background processes
wait
