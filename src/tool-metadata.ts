/**
 * Tool metadata for Tool Search functionality
 *
 * Each tool is tagged with categories and keywords for efficient discovery
 */

export interface ToolMetadata {
  tags: string[];
  category: string;
  priority?: number; // Higher priority tools appear first in search results
}

export const TOOL_METADATA: Record<string, ToolMetadata> = {
  // Connection
  minecraft_connect: { tags: ["connection", "setup", "start"], category: "connection", priority: 10 },
  minecraft_disconnect: { tags: ["connection", "cleanup", "end"], category: "connection", priority: 10 },

  // State & Communication
  minecraft_get_state: { tags: ["status", "info", "state", "position", "health", "inventory"], category: "info", priority: 9 },
  minecraft_chat: { tags: ["communication", "message", "chat"], category: "communication", priority: 7 },
  minecraft_get_chat_messages: { tags: ["communication", "message", "chat", "read"], category: "communication", priority: 7 },
  subscribe_events: { tags: ["events", "monitoring", "notifications"], category: "system", priority: 8 },

  // Environment awareness
  minecraft_get_surroundings: { tags: ["environment", "blocks", "nearby", "info"], category: "info", priority: 8 },
  minecraft_get_nearby_entities: { tags: ["environment", "mobs", "players", "entities", "info"], category: "info", priority: 8 },
  minecraft_find_block: { tags: ["search", "blocks", "find", "locate"], category: "info", priority: 7 },

  // High-level actions
  minecraft_gather_resources: { tags: ["mining", "gathering", "resources", "collect", "high-level"], category: "actions", priority: 9 },
  minecraft_build_structure: { tags: ["building", "construction", "shelter", "high-level"], category: "actions", priority: 8 },
  minecraft_craft_chain: { tags: ["crafting", "recipes", "items", "high-level"], category: "actions", priority: 9 },
  minecraft_survival_routine: { tags: ["survival", "food", "shelter", "tools", "auto", "high-level"], category: "actions", priority: 10 },
  minecraft_explore_area: { tags: ["exploration", "search", "biome", "travel", "high-level"], category: "actions", priority: 8 },

  // Basic operations
  minecraft_craft: { tags: ["crafting", "items", "basic"], category: "crafting", priority: 7 },
  minecraft_smelt: { tags: ["smelting", "furnace", "ore", "basic"], category: "crafting", priority: 7 },
  minecraft_check_infrastructure: { tags: ["check", "crafting-table", "furnace", "info"], category: "info", priority: 6 },


  // Dev Agent integration
  dev_publish_loop_result: { tags: ["dev", "loop", "result"], category: "dev", priority: 3 },
  dev_get_loop_results: { tags: ["dev", "loop", "history"], category: "dev", priority: 3 },

  // === Low-level tools (stdio version) ===
  // Movement
  minecraft_get_position: { tags: ["info", "position", "location", "coordinates"], category: "info", priority: 7 },
  minecraft_move_to: { tags: ["movement", "move", "travel", "goto"], category: "movement", priority: 7 },

  // Combat & Survival
  minecraft_get_status: { tags: ["info", "status", "health", "hunger", "hp"], category: "info", priority: 9 },
  minecraft_attack: { tags: ["combat", "attack", "fight", "kill"], category: "combat", priority: 7 },
  minecraft_eat: { tags: ["survival", "food", "eat", "hunger"], category: "survival", priority: 9 },
  minecraft_equip_armor: { tags: ["combat", "armor", "equip", "protection"], category: "combat", priority: 7 },
  minecraft_equip_weapon: { tags: ["combat", "weapon", "equip", "sword"], category: "combat", priority: 7 },
  minecraft_flee: { tags: ["survival", "flee", "escape", "run"], category: "survival", priority: 8 },
  minecraft_respawn: { tags: ["survival", "respawn", "death", "reset", "emergency"], category: "survival", priority: 10 },

  // Crafting & Items
  minecraft_get_inventory: { tags: ["info", "inventory", "items", "check"], category: "info", priority: 8 },
  minecraft_equip: { tags: ["items", "equip", "hold", "hand"], category: "items", priority: 6 },
  minecraft_drop_item: { tags: ["items", "drop", "discard"], category: "items", priority: 5 },

  // Storage (Chest)
  minecraft_list_chest: { tags: ["storage", "chest", "list", "contents", "check"], category: "storage", priority: 7 },
  minecraft_open_chest: { tags: ["storage", "chest", "open", "view"], category: "storage", priority: 7 },
  minecraft_take_from_chest: { tags: ["storage", "chest", "take", "withdraw", "get"], category: "storage", priority: 7 },
  minecraft_store_in_chest: { tags: ["storage", "chest", "store", "deposit", "put"], category: "storage", priority: 7 },

  // Building
  minecraft_place_block: { tags: ["building", "place", "build", "construct"], category: "building", priority: 6 },
  minecraft_dig_block: { tags: ["mining", "dig", "break", "mine"], category: "mining", priority: 7 },
  minecraft_collect_items: { tags: ["items", "collect", "pickup", "gather"], category: "items", priority: 6 },
  minecraft_level_ground: { tags: ["building", "flatten", "level", "clear"], category: "building", priority: 5 },
};

/**
 * Search tools by query string
 */
export function searchTools(query: string, availableTools: Set<string>): string[] {
  const lowerQuery = query.toLowerCase().trim();
  console.error(`[searchTools] Query: "${lowerQuery}", availableTools count: ${availableTools.size}`);
  console.error(`[searchTools] availableTools:`, Array.from(availableTools).join(', '));

  // If query is empty, return high-priority tools
  if (!lowerQuery) {
    return Array.from(availableTools)
      .filter(name => TOOL_METADATA[name])
      .sort((a, b) => {
        const priorityA = TOOL_METADATA[a]?.priority || 0;
        const priorityB = TOOL_METADATA[b]?.priority || 0;
        return priorityB - priorityA;
      })
      .slice(0, 10); // Top 10 high-priority tools
  }

  // Search by tags and category
  const results = Array.from(availableTools)
    .filter(name => {
      const metadata = TOOL_METADATA[name];
      if (!metadata) {
        console.error(`[searchTools] No metadata for tool: ${name}`);
        return false;
      }

      // Check if query matches category
      if (metadata.category.includes(lowerQuery)) {
        console.error(`[searchTools] "${name}" matched on category: ${metadata.category}`);
        return true;
      }

      // Check if query matches any tag
      const tagMatch = metadata.tags.some(tag => tag.includes(lowerQuery));
      if (tagMatch) {
        console.error(`[searchTools] "${name}" matched on tags: ${metadata.tags.join(', ')}`);
      }
      return tagMatch;
    })
    .sort((a, b) => {
      // Sort by priority, then by relevance
      const priorityA = TOOL_METADATA[a]?.priority || 0;
      const priorityB = TOOL_METADATA[b]?.priority || 0;

      if (priorityA !== priorityB) {
        return priorityB - priorityA;
      }

      // Sort by exact match in category
      const metaA = TOOL_METADATA[a];
      const metaB = TOOL_METADATA[b];
      const exactA = metaA.category === lowerQuery ? 1 : 0;
      const exactB = metaB.category === lowerQuery ? 1 : 0;

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
