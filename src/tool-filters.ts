/**
 * Tool filtering definitions for agent types
 *
 * Game Agent: Basic high-level tools only (complex operations via skills)
 * Dev Agent: All tools (for debugging and development)
 */

// All tools for Game Agent (stdio version - full access)
export const GAME_AGENT_TOOLS = new Set([
  // Connection (3 tools)
  "minecraft_connect",
  "minecraft_disconnect",
  "minecraft_get_chat_messages",

  // Movement (3 tools)
  "minecraft_get_position",
  "minecraft_move_to",
  "minecraft_chat",

  // Environment (3 tools)
  "minecraft_check_infrastructure",
  "minecraft_get_surroundings",
  "minecraft_find_block",

  // Building (4 tools)
  "minecraft_place_block",
  "minecraft_dig_block",
  "minecraft_collect_items",
  "minecraft_level_ground",

  // Coordination (4 tools)
  "agent_board_read",
  "agent_board_wait",
  "agent_board_write",
  "agent_board_clear",

  // Crafting (5 tools)
  "minecraft_get_inventory",
  "minecraft_craft",
  "minecraft_equip",
  "minecraft_drop_item",
  "minecraft_smelt",

  // Combat (7 tools)
  "minecraft_get_status",
  "minecraft_get_nearby_entities",
  "minecraft_attack",
  "minecraft_eat",
  "minecraft_equip_armor",
  "minecraft_equip_weapon",
  "minecraft_flee",

  // Learning (7 tools)
  "log_experience",
  "get_recent_experiences",
  "save_memory",
  "recall_memory",
  "forget_memory",
  "list_agent_skills",
  "get_agent_skill",

  // Tool Search (1 tool)
  "search_tools",
]);

export type AgentType = "game" | "dev";
