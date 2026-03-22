/**
 * Tool Visibility Filter
 *
 * Game agents see only: mc_execute, mc_connect, mc_chat, mc_reload
 * Dev agents see ALL tools (for debugging)
 *
 * All other tools remain callable via CallTool (for internal use by bot.* API)
 * but are not listed in tools/list.
 */

export type AgentType = "game" | "dev";

/**
 * Tools visible to game agents in tools/list
 */
export const VISIBLE_TOOLS = new Set([
  "mc_execute",
  "mc_connect",
  "mc_chat",
  "mc_reload",
]);
