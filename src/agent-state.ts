/**
 * Global agent state management
 *
 * Tracks the current agent type for tool filtering in stdio MCP server
 */

import type { AgentType } from "./tool-filters.js";

// Get default agent type from environment variable (default: "game" for testing)
const DEFAULT_AGENT_TYPE = (process.env.AGENT_TYPE === "dev" ? "dev" : "game") as AgentType;

// Current agent type
let currentAgentType: AgentType = DEFAULT_AGENT_TYPE;

console.error(`[Agent State] Initial agent type: ${currentAgentType} (from ${process.env.AGENT_TYPE ? 'env var' : 'default'})`);


/**
 * Get current agent type
 */
export function getAgentType(): AgentType {
  return currentAgentType;
}

/**
 * Set agent type (called by minecraft_connect)
 */
export function setAgentType(type: AgentType): void {
  currentAgentType = type;
  console.error(`[Agent State] Agent type set to: ${type}`);
}
