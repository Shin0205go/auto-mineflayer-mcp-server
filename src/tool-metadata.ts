/**
 * Tool metadata for Tool Search functionality
 *
 * Each tool is tagged with categories and keywords for efficient discovery.
 * Covers all 3 tiers: core (mc_*), situational (mc_sleep etc.), and legacy (minecraft_*).
 */

export interface ToolMetadata {
  tags: string[];
  category: string;
  priority?: number; // Higher priority tools appear first in search results
}

export const TOOL_METADATA: Record<string, ToolMetadata> = {
  // ─── Tier 1: Core Tools (always visible) ───────────────────────────────

  mc_status: {
    tags: ["status", "info", "health", "hunger", "position", "inventory", "surroundings", "threats", "infrastructure"],
    category: "info",
    priority: 10,
  },
  mc_gather: {
    tags: ["mining", "gathering", "resources", "collect", "dig", "wood", "stone", "ore"],
    category: "actions",
    priority: 10,
  },
  mc_craft: {
    tags: ["crafting", "recipes", "items", "tools", "craft_chain", "dependency"],
    category: "crafting",
    priority: 10,
  },
  mc_build: {
    tags: ["building", "construction", "shelter", "wall", "platform", "tower"],
    category: "building",
    priority: 9,
  },
  mc_navigate: {
    tags: ["movement", "move", "travel", "goto", "pathfinding", "walk"],
    category: "movement",
    priority: 10,
  },
  mc_combat: {
    tags: ["combat", "attack", "fight", "kill", "hunt", "weapon"],
    category: "combat",
    priority: 10,
  },
  mc_eat: {
    tags: ["survival", "food", "eat", "hunger", "cook", "health"],
    category: "survival",
    priority: 10,
  },
  mc_store: {
    tags: ["storage", "chest", "deposit", "withdraw", "list", "inventory"],
    category: "storage",
    priority: 9,
  },
  mc_chat: {
    tags: ["communication", "message", "chat", "read", "send", "team"],
    category: "communication",
    priority: 9,
  },
  mc_connect: {
    tags: ["connection", "setup", "start", "disconnect", "server"],
    category: "connection",
    priority: 10,
  },

  // ─── Tier 2: Situational Tools ─────────────────────────────────────────

  mc_sleep: {
    tags: ["survival", "sleep", "bed", "night", "rest"],
    category: "survival",
    priority: 8,
  },
  mc_flee: {
    tags: ["survival", "flee", "escape", "run", "danger"],
    category: "survival",
    priority: 9,
  },
  mc_death_recovery: {
    tags: ["survival", "respawn", "death", "recovery", "base"],
    category: "survival",
    priority: 9,
  },
  mc_smelt: {
    tags: ["smelting", "furnace", "ore", "cook", "raw_iron", "raw_gold", "ingot"],
    category: "crafting",
    priority: 8,
  },
  mc_place_block: {
    tags: ["building", "place", "build", "block", "crafting_table", "furnace", "chest", "torch"],
    category: "building",
    priority: 8,
  },
  mc_equip: {
    tags: ["items", "equip", "armor", "weapon", "hand", "wear"],
    category: "items",
    priority: 8,
  },
  mc_enter_portal: {
    tags: ["movement", "portal", "nether", "end", "teleport", "travel"],
    category: "movement",
    priority: 9,
  },

  // ─── Tier 3: Legacy Low-Level Tools (search_tools only) ────────────────

  // Connection
  minecraft_connect: { tags: ["connection", "setup", "start"], category: "connection", priority: 5 },
  minecraft_disconnect: { tags: ["connection", "cleanup", "end"], category: "connection", priority: 5 },
  minecraft_get_chat_messages: { tags: ["communication", "message", "chat", "read"], category: "communication", priority: 5 },

  // Movement
  minecraft_get_position: { tags: ["info", "position", "location", "coordinates"], category: "info", priority: 5 },
  minecraft_move_to: { tags: ["movement", "move", "travel", "goto"], category: "movement", priority: 5 },
  minecraft_chat: { tags: ["communication", "message", "chat", "send"], category: "communication", priority: 5 },
  minecraft_enter_portal: { tags: ["movement", "portal", "nether", "teleport", "travel"], category: "movement", priority: 7 },

  // Environment awareness
  minecraft_get_surroundings: { tags: ["environment", "blocks", "nearby", "info"], category: "info", priority: 5 },
  minecraft_get_nearby_entities: { tags: ["environment", "mobs", "players", "entities", "info"], category: "info", priority: 5 },
  minecraft_find_block: { tags: ["search", "blocks", "find", "locate"], category: "info", priority: 5 },
  minecraft_check_infrastructure: { tags: ["check", "crafting-table", "furnace", "info"], category: "info", priority: 5 },
  minecraft_check_portal_frame: { tags: ["portal", "nether", "obsidian", "check"], category: "info", priority: 6 },
  minecraft_diagnose_server: { tags: ["debug", "server", "diagnose", "config"], category: "info", priority: 4 },

  // Building
  minecraft_place_block: { tags: ["building", "place", "build", "construct"], category: "building", priority: 5 },
  minecraft_dig_block: { tags: ["mining", "dig", "break", "mine"], category: "mining", priority: 6 },
  minecraft_collect_items: { tags: ["items", "collect", "pickup", "gather"], category: "items", priority: 5 },
  minecraft_level_ground: { tags: ["building", "flatten", "level", "clear"], category: "building", priority: 5 },
  minecraft_pillar_up: { tags: ["movement", "pillar", "climb", "up"], category: "movement", priority: 5 },
  minecraft_use_item_on_block: { tags: ["items", "use", "bucket", "flint", "bone_meal"], category: "items", priority: 5 },
  minecraft_till_soil: { tags: ["farming", "till", "hoe", "soil", "farmland"], category: "farming", priority: 5 },
  minecraft_throw_item: { tags: ["items", "throw", "egg", "ender_pearl", "snowball"], category: "items", priority: 4 },

  // Crafting & Items
  minecraft_craft: { tags: ["crafting", "items", "basic", "recipe"], category: "crafting", priority: 5 },
  minecraft_smelt: { tags: ["smelting", "furnace", "ore", "cook"], category: "crafting", priority: 5 },
  minecraft_get_inventory: { tags: ["info", "inventory", "items", "check"], category: "info", priority: 5 },
  minecraft_equip: { tags: ["items", "equip", "hold", "hand"], category: "items", priority: 5 },
  minecraft_drop_item: { tags: ["items", "drop", "discard"], category: "items", priority: 4 },

  // Storage (Chest)
  minecraft_list_chest: { tags: ["storage", "chest", "list", "contents", "check"], category: "storage", priority: 5 },
  minecraft_open_chest: { tags: ["storage", "chest", "open", "view"], category: "storage", priority: 5 },
  minecraft_take_from_chest: { tags: ["storage", "chest", "take", "withdraw", "get"], category: "storage", priority: 5 },
  minecraft_store_in_chest: { tags: ["storage", "chest", "store", "deposit", "put"], category: "storage", priority: 5 },

  // Combat & Survival
  minecraft_get_status: { tags: ["info", "status", "health", "hunger", "hp"], category: "info", priority: 5 },
  minecraft_attack: { tags: ["combat", "attack", "fight", "kill"], category: "combat", priority: 5 },
  minecraft_eat: { tags: ["survival", "food", "eat", "hunger"], category: "survival", priority: 5 },
  minecraft_equip_armor: { tags: ["combat", "armor", "equip", "protection"], category: "combat", priority: 5 },
  minecraft_equip_weapon: { tags: ["combat", "weapon", "equip", "sword"], category: "combat", priority: 5 },
  minecraft_flee: { tags: ["survival", "flee", "escape", "run"], category: "survival", priority: 5 },
  minecraft_respawn: { tags: ["survival", "respawn", "death", "reset", "emergency"], category: "survival", priority: 6 },
  minecraft_fish: { tags: ["survival", "food", "fish", "fishing", "rod"], category: "survival", priority: 5 },

  // High-level (Tier 3, kept for backward compat)
  minecraft_gather_resources: { tags: ["mining", "gathering", "resources", "collect", "high-level"], category: "actions", priority: 6 },
  minecraft_build_structure: { tags: ["building", "construction", "shelter", "high-level"], category: "actions", priority: 6 },
  minecraft_craft_chain: { tags: ["crafting", "recipes", "items", "high-level"], category: "actions", priority: 6 },
  minecraft_survival_routine: { tags: ["survival", "food", "shelter", "tools", "auto", "high-level"], category: "actions", priority: 6 },
  minecraft_explore_area: { tags: ["exploration", "search", "biome", "travel", "high-level"], category: "actions", priority: 6 },
  minecraft_validate_survival_environment: { tags: ["survival", "validate", "environment", "food"], category: "actions", priority: 5 },
  minecraft_death_recovery: { tags: ["survival", "respawn", "death", "recovery"], category: "survival", priority: 6 },

  // Bootstrap
  minecraft_check_bootstrap: { tags: ["bootstrap", "check", "items", "admin"], category: "admin", priority: 4 },
  minecraft_generate_bootstrap_script: { tags: ["bootstrap", "script", "give", "admin"], category: "admin", priority: 4 },
  minecraft_list_bootstrap_needs: { tags: ["bootstrap", "status", "admin"], category: "admin", priority: 4 },
};

/**
 * Search tools by query string
 */
export function searchTools(query: string, availableTools: Set<string>): string[] {
  const lowerQuery = query.toLowerCase().trim();

  // If query is empty, return high-priority tools
  if (!lowerQuery) {
    return Array.from(availableTools)
      .filter(name => TOOL_METADATA[name])
      .sort((a, b) => {
        const priorityA = TOOL_METADATA[a]?.priority || 0;
        const priorityB = TOOL_METADATA[b]?.priority || 0;
        return priorityB - priorityA;
      })
      .slice(0, 15);
  }

  // Search by tags, category, and tool name
  const results = Array.from(availableTools)
    .filter(name => {
      const metadata = TOOL_METADATA[name];
      if (!metadata) return false;

      // Check tool name
      if (name.includes(lowerQuery)) return true;

      // Check category
      if (metadata.category.includes(lowerQuery)) return true;

      // Check tags
      return metadata.tags.some(tag => tag.includes(lowerQuery));
    })
    .sort((a, b) => {
      const priorityA = TOOL_METADATA[a]?.priority || 0;
      const priorityB = TOOL_METADATA[b]?.priority || 0;

      if (priorityA !== priorityB) {
        return priorityB - priorityA;
      }

      // Exact match in category or name gets priority
      const metaA = TOOL_METADATA[a];
      const metaB = TOOL_METADATA[b];
      const exactA = (metaA.category === lowerQuery || a.includes(lowerQuery)) ? 1 : 0;
      const exactB = (metaB.category === lowerQuery || b.includes(lowerQuery)) ? 1 : 0;

      return exactB - exactA;
    });

  return results;
}

/**
 * Get categories for all available tools
 */
export function getToolCategories(availableTools: Set<string>): Record<string, string[]> {
  const categories: Record<string, string[]> = {};

  for (const toolName of availableTools) {
    const metadata = TOOL_METADATA[toolName];
    if (!metadata) continue;

    const { category } = metadata;
    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push(toolName);
  }

  return categories;
}
