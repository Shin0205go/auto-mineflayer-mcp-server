/**
 * Tool filtering definitions for agent types
 *
 * Game Agent: Basic high-level tools only (complex operations via skills)
 * Dev Agent: All tools (for debugging and development)
 */

// All tools for Game Agent (48 tools total)
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

  // Building (5 tools)
  "minecraft_place_block",
  "minecraft_dig_block",
  "minecraft_collect_items",
  "minecraft_level_ground",
  "minecraft_pillar_up",

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

  // Storage (4 tools)
  "minecraft_open_chest",
  "minecraft_take_from_chest",
  "minecraft_store_in_chest",
  "minecraft_list_chest",

  // Combat (8 tools)
  "minecraft_get_status",
  "minecraft_get_nearby_entities",
  "minecraft_attack",
  "minecraft_eat",
  "minecraft_equip_armor",
  "minecraft_equip_weapon",
  "minecraft_flee",
  "minecraft_respawn",


  // Tool Search (1 tool)
  "search_tools",

  // High-Level Actions (6 tools) - for skills
  "minecraft_gather_resources",
  "minecraft_build_structure",
  "minecraft_craft_chain",
  "minecraft_survival_routine",
  "minecraft_explore_area",
  "minecraft_validate_survival_environment",
]);

export type AgentType = "game" | "dev";
