/**
 * PM2 Process Management Configuration
 *
 * Minecraft Agent with self-healing capabilities:
 * - Auto-restart on crash
 * - Error logging and analysis
 * - Dev Agent integration for auto-fix
 */

/**
 * PM2 Process Management Configuration
 *
 * Claude Code as self-healing Minecraft Agent:
 * - Plays Minecraft (Game Agent)
 * - Fixes own errors (Dev Agent)
 * - Manages tasks autonomously
 * - Auto-restarts on crash
 */

module.exports = {
  apps: [
    {
      name: 'minecraft-agent',
      script: 'claude',
      args: '--continue --dangerously-skip-permissions',

      // Auto-restart configuration
      autorestart: true,
      max_restarts: 20,           // Claude Code can fix errors, so allow more retries
      min_uptime: '30s',          // Must run 30s to be considered successful
      restart_delay: 10000,       // Wait 10s before restart (time to read error logs)

      // Logging
      error_file: 'logs/agent-error.log',
      out_file: 'logs/agent-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      combine_logs: true,

      // Environment
      env: {
        NODE_ENV: 'production',
        MCP_WS_URL: 'ws://localhost:8765',
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        MC_HOST: 'localhost',
        MC_PORT: '25565',
        BOT_USERNAME: 'Claude'
      },

      // Process options
      exec_mode: 'fork',
      watch: false,
      kill_timeout: 5000,

      // Health monitoring
      max_memory_restart: '2G'
    }
  ]
};
