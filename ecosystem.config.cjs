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
 * - Agent Teams support
 */

module.exports = {
  apps: [
    // ========== Board Viewer (Web UI) ==========
    {
      name: 'board-viewer',
      script: 'npm',
      args: 'run board:view',

      autorestart: true,
      max_restarts: 10,

      error_file: 'logs/board-viewer-error.log',
      out_file: 'logs/board-viewer-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      env: {
        NODE_ENV: 'production',
        BOARD_PORT: '3001'
      },

      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '500M'
    },

    // ========== Single Agent Mode ==========
    {
      name: 'minecraft-agent',
      script: '/Users/shingo/Develop/minecraftAIViewer/scripts/run-claude-agent.sh',
      args: '',

      // Auto-restart configuration
      autorestart: true,
      max_restarts: 20,
      min_uptime: '30s',
      restart_delay: 10000,

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
      max_memory_restart: '2G'
    },

    // ========== Agent Teams Mode ==========
    // Uncomment to enable multi-agent team
    /*
    {
      name: 'team-lead',
      script: 'claude',
      args: '--continue --dangerously-skip-permissions --teammate-mode in-process',

      autorestart: true,
      max_restarts: 20,
      min_uptime: '30s',
      restart_delay: 10000,

      error_file: 'logs/team-lead-error.log',
      out_file: 'logs/team-lead-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      env: {
        NODE_ENV: 'production',
        MCP_WS_URL: 'ws://localhost:8765',
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        MC_HOST: 'localhost',
        MC_PORT: '25565',
        BOT_USERNAME: 'LeadAgent',
        AGENT_ROLE: 'lead'
      },

      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '2G'
    },

    {
      name: 'team-member-1',
      script: 'claude',
      args: '--continue --dangerously-skip-permissions',

      autorestart: true,
      max_restarts: 20,
      min_uptime: '30s',
      restart_delay: 10000,

      error_file: 'logs/team-member-1-error.log',
      out_file: 'logs/team-member-1-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      env: {
        NODE_ENV: 'production',
        MCP_WS_URL: 'ws://localhost:8765',
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        MC_HOST: 'localhost',
        MC_PORT: '25565',
        BOT_USERNAME: 'Member1',
        AGENT_ROLE: 'member'
      },

      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '2G'
    },

    {
      name: 'team-member-2',
      script: 'claude',
      args: '--continue --dangerously-skip-permissions',

      autorestart: true,
      max_restarts: 20,
      min_uptime: '30s',
      restart_delay: 10000,

      error_file: 'logs/team-member-2-error.log',
      out_file: 'logs/team-member-2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      env: {
        NODE_ENV: 'production',
        MCP_WS_URL: 'ws://localhost:8765',
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        MC_HOST: 'localhost',
        MC_PORT: '25565',
        BOT_USERNAME: 'Member2',
        AGENT_ROLE: 'member'
      },

      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '2G'
    }
    */
  ]
};
