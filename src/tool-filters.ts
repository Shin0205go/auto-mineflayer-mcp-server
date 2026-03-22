/**
 * 3-Tier Tool Filtering System
 *
 * Tier 1: Core tools (mc_*) — always visible in tools/list (~10 tools)
 * Tier 2: Situational tools — added dynamically based on bot state (max 3-4)
 * Tier 3: Low-level tools — hidden from tools/list, discoverable via search_tools
 *
 * Dev Agent: ALL tools visible (for debugging)
 * Game Agent: Tier 1 + applicable Tier 2 only
 */

import { botManager } from "./bot-manager/index.js";

export type AgentType = "game" | "dev";

/**
 * Tier 1: Always-visible core tools
 *
 * mc_execute is the PRIMARY tool — agents write JavaScript code against
 * the bot.* API to perform all gameplay operations. Individual mc_* tools
 * are moved to Tier 3 (searchable but hidden from tools/list).
 */
export const TIER1_CORE_TOOLS = new Set([
  // Code execution — the main gameplay tool
  "mc_execute",
  // Connection management
  "mc_connect",
  // Chat — needed for team coordination
  "mc_chat",
  // Hot-reload after code changes
  "mc_reload",
  // Tool search for discovering legacy tools if needed
  "search_tools",
]);

/**
 * Tier 2: Situational tools that appear based on bot state
 * Each entry has a condition function that determines visibility
 */
export interface Tier2Tool {
  name: string;
  condition: (username: string) => boolean;
}

/** Raw ore/material items that need smelting */
const SMELTABLE_ITEMS = new Set([
  "raw_iron", "raw_gold", "raw_copper",
  "iron_ore", "gold_ore", "copper_ore",
  "deepslate_iron_ore", "deepslate_gold_ore", "deepslate_copper_ore",
  "sand", "clay_ball", "wet_sponge",
]);

/** Armor slot names for equip detection */
const ARMOR_SLOTS = ["head", "torso", "legs", "feet"];
const ARMOR_ITEMS = new Set([
  "leather_helmet", "leather_chestplate", "leather_leggings", "leather_boots",
  "chainmail_helmet", "chainmail_chestplate", "chainmail_leggings", "chainmail_boots",
  "iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots",
  "golden_helmet", "golden_chestplate", "golden_leggings", "golden_boots",
  "diamond_helmet", "diamond_chestplate", "diamond_leggings", "diamond_boots",
  "netherite_helmet", "netherite_chestplate", "netherite_leggings", "netherite_boots",
  "turtle_helmet",
]);
const WEAPON_ITEMS = new Set([
  "wooden_sword", "stone_sword", "iron_sword", "golden_sword", "diamond_sword", "netherite_sword",
  "wooden_axe", "stone_axe", "iron_axe", "golden_axe", "diamond_axe", "netherite_axe",
  "bow", "crossbow", "trident",
]);

export const TIER2_TOOLS: Tier2Tool[] = [
  {
    name: "mc_sleep",
    condition: (username: string) => {
      try {
        const bot = botManager.getBot(username);
        if (!bot) return false;
        const timeOfDay = bot.time?.timeOfDay ?? 0;
        return timeOfDay > 12541 || timeOfDay < 100; // Night time
      } catch {
        return false;
      }
    },
  },
  {
    name: "mc_flee",
    condition: (username: string) => {
      try {
        const bot = botManager.getBot(username);
        if (!bot) return false;
        return (bot.health ?? 20) < 10;
      } catch {
        return false;
      }
    },
  },
  {
    name: "mc_death_recovery",
    condition: (username: string) => {
      try {
        const bot = botManager.getBot(username);
        if (!bot) return false;
        const inventory = botManager.getInventory(username);
        const health = bot.health ?? 20;
        // Show if recently respawned (full health but empty inventory)
        return health >= 18 && inventory.length === 0;
      } catch {
        return false;
      }
    },
  },
  {
    name: "mc_smelt",
    condition: (username: string) => {
      try {
        const inventory = botManager.getInventory(username);
        return inventory.some(item => SMELTABLE_ITEMS.has(item.name));
      } catch {
        return false;
      }
    },
  },
  {
    name: "mc_place_block",
    condition: (username: string) => {
      try {
        const inventory = botManager.getInventory(username);
        // Show when bot has building materials (more than just tools/food)
        return inventory.some(item =>
          item.name.includes("_planks") ||
          item.name === "cobblestone" || item.name === "stone" ||
          item.name === "dirt" || item.name === "sand" ||
          item.name.includes("brick") ||
          item.name === "crafting_table" || item.name === "furnace" ||
          item.name === "chest" || item.name === "torch" ||
          item.name.includes("_bed") ||
          item.name === "obsidian"
        );
      } catch {
        return false;
      }
    },
  },
  {
    name: "mc_equip",
    condition: (username: string) => {
      try {
        const bot = botManager.getBot(username);
        if (!bot) return false;
        const inventory = botManager.getInventory(username);

        // Check for unequipped armor
        const hasUnequippedArmor = inventory.some(item => ARMOR_ITEMS.has(item.name));
        // Check for weapons in inventory (may need equipping)
        const hasWeapons = inventory.some(item => WEAPON_ITEMS.has(item.name));

        return hasUnequippedArmor || hasWeapons;
      } catch {
        return false;
      }
    },
  },
  {
    name: "minecraft_till_soil",
    condition: (username: string) => {
      try {
        const inventory = botManager.getInventory(username);
        // Show when bot has a hoe (for farming)
        return inventory.some(item =>
          item.name.includes("_hoe")
        );
      } catch {
        return false;
      }
    },
  },
  {
    name: "minecraft_use_item_on_block",
    condition: (username: string) => {
      try {
        const inventory = botManager.getInventory(username);
        // Show when bot has seeds, bone_meal, bucket, or flint_and_steel
        return inventory.some(item =>
          item.name.includes("_seeds") ||
          item.name === "bone_meal" ||
          item.name === "bucket" ||
          item.name === "water_bucket" ||
          item.name === "lava_bucket" ||
          item.name === "flint_and_steel"
        );
      } catch {
        return false;
      }
    },
  },
  {
    name: "minecraft_pillar_up",
    condition: (username: string) => {
      try {
        const inventory = botManager.getInventory(username);
        // Show when bot has stackable building blocks (cobblestone, dirt, netherrack, etc.)
        return inventory.some(item =>
          item.name === "cobblestone" || item.name === "dirt" ||
          item.name === "netherrack" || item.name === "stone" ||
          item.name.includes("_planks") || item.name === "sandstone" ||
          item.name === "deepslate"
        );
      } catch {
        return false;
      }
    },
  },
  {
    name: "mc_enter_portal",
    condition: (username: string) => {
      try {
        const bot = botManager.getBot(username);
        if (!bot) return false;
        // Check for nether/end portal within 10 blocks
        const portalBlock = bot.findBlock({
          matching: (block: { name: string }) =>
            block.name === "nether_portal" || block.name === "end_portal",
          maxDistance: 10,
        });
        return portalBlock !== null;
      } catch {
        return false;
      }
    },
  },
];

/**
 * Tier 2 tool MCP definitions — only for tools not already in core-tools-mcp
 */
export const tier2ToolDefs: Record<string, { description: string; inputSchema: object }> = {
  mc_sleep: {
    description: "Sleep in a nearby bed to skip the night. Only available at night (timeOfDay > 12541).",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  mc_flee: {
    description: "Run away from nearest hostile mob. Flee 20 blocks in opposite direction. Use when HP is low.",
    inputSchema: {
      type: "object" as const,
      properties: {
        distance: {
          type: "number",
          description: "Distance to flee in blocks (default: 20)",
          default: 20,
        },
      },
      required: [],
    },
  },
  mc_death_recovery: {
    description: "Post-respawn recovery: navigate to base, get food/tools from chest, eat, equip armor.",
    inputSchema: {
      type: "object" as const,
      properties: {
        base_x: { type: "number", description: "Base X coordinate (optional)" },
        base_y: { type: "number", description: "Base Y coordinate (optional)" },
        base_z: { type: "number", description: "Base Z coordinate (optional)" },
      },
      required: [],
    },
  },
  mc_smelt: {
    description: "Smelt items in a furnace. Requires a furnace nearby and fuel. Appears when you have raw ores (raw_iron, raw_gold, etc.) in inventory.",
    inputSchema: {
      type: "object" as const,
      properties: {
        item_name: {
          type: "string",
          description: "Item to smelt (e.g., 'raw_iron', 'raw_gold', 'sand')",
        },
        count: {
          type: "number",
          description: "Number to smelt (default: 1)",
          default: 1,
        },
      },
      required: ["item_name"],
    },
  },
  mc_place_block: {
    description: "Place a block from inventory at specific coordinates. Use for precise block placement (crafting_table, furnace, chest, torch, bed, building blocks).",
    inputSchema: {
      type: "object" as const,
      properties: {
        block_type: {
          type: "string",
          description: "Block to place (e.g., 'crafting_table', 'furnace', 'chest', 'torch', 'cobblestone')",
        },
        x: { type: "number", description: "X coordinate" },
        y: { type: "number", description: "Y coordinate" },
        z: { type: "number", description: "Z coordinate" },
      },
      required: ["block_type", "x", "y", "z"],
    },
  },
  minecraft_till_soil: {
    description: "Till dirt or grass to create farmland for planting crops. Requires a hoe in inventory. Appears when you have a hoe.",
    inputSchema: {
      type: "object" as const,
      properties: {
        x: { type: "number", description: "X coordinate of block to till" },
        y: { type: "number", description: "Y coordinate of block to till" },
        z: { type: "number", description: "Z coordinate of block to till" },
      },
      required: ["x", "y", "z"],
    },
  },
  minecraft_use_item_on_block: {
    description: "Use a held item on a block. Use cases: bone_meal on crops to grow instantly, water_bucket to place water, flint_and_steel to ignite, seeds on farmland to plant. Appears when you have seeds, bone_meal, bucket, or flint_and_steel.",
    inputSchema: {
      type: "object" as const,
      properties: {
        item_name: {
          type: "string",
          description: "Item to use (e.g., 'bone_meal', 'wheat_seeds', 'water_bucket', 'flint_and_steel')",
        },
        x: { type: "number", description: "X coordinate of target block" },
        y: { type: "number", description: "Y coordinate of target block" },
        z: { type: "number", description: "Z coordinate of target block" },
      },
      required: ["item_name", "x", "y", "z"],
    },
  },
  mc_equip: {
    description: "Equip an item to the correct slot (auto-detects hand/armor slot). Appears when you have unequipped armor or weapons. Use 'none' to unequip.",
    inputSchema: {
      type: "object" as const,
      properties: {
        item_name: {
          type: "string",
          description: "Item to equip (e.g., 'iron_sword', 'diamond_helmet', 'none' to unequip)",
        },
      },
      required: ["item_name"],
    },
  },
  minecraft_pillar_up: {
    description: "Build a pillar upward by jump-placing blocks. Use to climb out of caves or reach higher locations. Max 15 blocks per call. Requires cobblestone/dirt/building blocks in inventory.",
    inputSchema: {
      type: "object" as const,
      properties: {
        height: {
          type: "number",
          description: "Number of blocks to pillar up (default: 1, max: 15)",
        },
      },
      required: [],
    },
  },
  mc_enter_portal: {
    description: "Enter a nearby Nether/End portal to teleport. Appears when a portal is within 10 blocks.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
};

/**
 * Tier 2 tool handler
 */
export async function handleTier2Tool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const username = botManager.requireSingleBot();

  switch (name) {
    case "mc_sleep": {
      return await botManager.sleep(username);
    }
    case "mc_flee": {
      const distance = (args.distance as number) || 20;
      return await botManager.flee(username, distance);
    }
    case "mc_death_recovery": {
      const { minecraft_death_recovery } = await import("./tools/high-level-actions.js");
      return await minecraft_death_recovery(
        username,
        args.base_x as number | undefined,
        args.base_y as number | undefined,
        args.base_z as number | undefined
      );
    }
    case "mc_smelt": {
      const itemName = args.item_name as string;
      const count = (args.count as number) || 1;
      if (!itemName) throw new Error("item_name is required");
      try {
        return await botManager.smeltItem(username, itemName, count);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const inventory = botManager.getInventory(username);
        const inventoryStr = inventory.map(item => `${item.name}(${item.count})`).join(", ");
        return `Cannot smelt ${itemName}: ${errorMsg}. Inventory: ${inventoryStr}`;
      }
    }
    case "mc_place_block": {
      const blockType = args.block_type as string;
      const x = args.x as number;
      const y = args.y as number;
      const z = args.z as number;
      if (!blockType) throw new Error("block_type is required");
      const result = await botManager.placeBlock(username, blockType, x, y, z);
      return result.message;
    }
    case "mc_equip": {
      const itemName = args.item_name as string;
      if (!itemName) throw new Error("item_name is required");
      // equipItem auto-detects the correct slot (hand/head/torso/legs/feet)
      return await botManager.equipItem(username, itemName);
    }
    case "minecraft_pillar_up": {
      const height = Math.min((args.height as number) || 1, 15);
      return await botManager.pillarUp(username, height);
    }
    case "mc_enter_portal": {
      return await botManager.enterPortal(username);
    }
    case "minecraft_till_soil": {
      const { handleBuildingTool } = await import("./tools/building.js");
      return await handleBuildingTool("minecraft_till_soil", args);
    }
    case "minecraft_use_item_on_block": {
      const { handleBuildingTool } = await import("./tools/building.js");
      return await handleBuildingTool("minecraft_use_item_on_block", args);
    }
    default:
      throw new Error(`Unknown Tier 2 tool: ${name}`);
  }
}

/**
 * Get currently active Tier 2 tools based on bot state
 */
export function getActiveTier2Tools(): string[] {
  try {
    const username = botManager.requireSingleBot();
    return TIER2_TOOLS
      .filter(t => {
        try {
          return t.condition(username);
        } catch (err) {
          // Show tool on error (safe default) — hiding tools silently breaks MCP client
          console.error(`[ToolFilter] Tier2 condition error for ${t.name}: ${err}`);
          return true;
        }
      })
      .map(t => t.name);
  } catch {
    // Not connected — no Tier 2 tools
    return [];
  }
}

/**
 * All tools that should appear in tools/list for game agents
 * (Tier 1 + active Tier 2)
 */
export function getVisibleGameTools(): Set<string> {
  const tools = new Set(TIER1_CORE_TOOLS);
  for (const tier2Name of getActiveTier2Tools()) {
    tools.add(tier2Name);
  }
  return tools;
}

/**
 * Legacy: All tool names (Tier 1 + Tier 2 + Tier 3) for search_tools
 * Tier 3 tools are the old minecraft_* tools, discoverable via search but not in tools/list
 */
export const ALL_TOOL_NAMES_FOR_SEARCH = new Set([
  // Tier 1 (mc_execute, mc_connect, mc_chat)
  ...TIER1_CORE_TOOLS,
  // Tier 2 (all, regardless of condition)
  ...TIER2_TOOLS.map(t => t.name),
  // Former Tier 1 core tools (now hidden, but still callable and searchable)
  "mc_status", "mc_gather", "mc_craft", "mc_build", "mc_navigate",
  "mc_combat", "mc_drop", "mc_eat", "mc_store", "mc_place_block",
  "mc_farm", "mc_smelt", "mc_flee", "mc_tunnel",
  // Tier 3: Legacy low-level tools (searchable but hidden)
  // Connection
  "minecraft_connect", "minecraft_disconnect", "minecraft_get_chat_messages",
  // Movement
  "minecraft_get_position", "minecraft_move_to", "minecraft_chat", "minecraft_enter_portal",
  // Environment
  "minecraft_check_infrastructure", "minecraft_get_surroundings", "minecraft_find_block",
  "minecraft_check_portal_frame", "minecraft_diagnose_server",
  // Building
  "minecraft_place_block", "minecraft_dig_block", "minecraft_collect_items",
  "minecraft_level_ground", "minecraft_pillar_up", "minecraft_use_item_on_block",
  "minecraft_till_soil", "minecraft_throw_item",
  // Crafting
  "minecraft_get_inventory", "minecraft_craft", "minecraft_equip",
  "minecraft_drop_item", "minecraft_smelt",
  // Storage
  "minecraft_open_chest", "minecraft_take_from_chest",
  "minecraft_store_in_chest", "minecraft_list_chest",
  // Combat
  "minecraft_get_status", "minecraft_get_nearby_entities", "minecraft_attack",
  "minecraft_eat", "minecraft_equip_armor", "minecraft_equip_weapon",
  "minecraft_flee", "minecraft_respawn", "minecraft_fish",
  // High-level (kept as Tier 3)
  "minecraft_gather_resources", "minecraft_build_structure",
  "minecraft_craft_chain", "minecraft_survival_routine",
  "minecraft_explore_area", "minecraft_validate_survival_environment",
  "minecraft_death_recovery",
  // Bootstrap
  "minecraft_check_bootstrap", "minecraft_generate_bootstrap_script",
  "minecraft_list_bootstrap_needs",
]);
