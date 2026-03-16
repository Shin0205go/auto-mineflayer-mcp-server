/**
 * High-Level Action Tools — Tier 3 (discoverable via search_tools only)
 *
 * God functions removed:
 * - minecraft_day1_boot_sequence → survival SKILL.md "Day 1 Protocol"
 * - minecraft_establish_base → building SKILL.md "Base Protocol"
 * - minecraft_upgrade_tools → crafting-chain SKILL.md "Tool Upgrade Protocol"
 * - minecraft_night_routine → survival SKILL.md "Night Protocol"
 * - minecraft_food_emergency → survival SKILL.md "Food Emergency Protocol"
 *
 * Remaining tools are useful as Tier 3 low-level alternatives.
 * minecraft_death_recovery → moved to Tier 2 (conditional on respawn state).
 */

import {
  minecraft_gather_resources,
  minecraft_build_structure,
  minecraft_craft_chain,
  minecraft_survival_routine,
  minecraft_explore_area,
  minecraft_validate_survival_environment,
  minecraft_death_recovery,
} from "./high-level-actions.js";

export const highLevelActionTools = {
  minecraft_gather_resources: {
    description: "High-level resource gathering - automatically finds, mines, and collects specified items",
    inputSchema: {
      type: "object" as const,
      properties: {
        username: { type: "string", description: "Bot username" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Item name (e.g., 'oak_log', 'cobblestone')" },
              count: { type: "number", description: "Target quantity" }
            },
            required: ["name", "count"]
          },
          description: "List of items to gather"
        },
        maxDistance: { type: "number", description: "Maximum search distance (default: 32)" }
      },
      required: ["username", "items"]
    }
  },
  minecraft_build_structure: {
    description: "High-level building - constructs predefined structures (shelter, wall, platform, tower)",
    inputSchema: {
      type: "object" as const,
      properties: {
        username: { type: "string", description: "Bot username" },
        type: { type: "string", enum: ["shelter", "wall", "platform", "tower"], description: "Structure type" },
        size: { type: "string", enum: ["small", "medium", "large"], description: "Structure size" }
      },
      required: ["username", "type", "size"]
    }
  },
  minecraft_craft_chain: {
    description: "High-level crafting - crafts items with automatic dependency resolution and optional material gathering",
    inputSchema: {
      type: "object" as const,
      properties: {
        username: { type: "string", description: "Bot username" },
        target: { type: "string", description: "Target item to craft (e.g., 'iron_pickaxe', 'furnace')" },
        autoGather: { type: "boolean", description: "Automatically gather missing materials (default: false)" }
      },
      required: ["username", "target"]
    }
  },
  minecraft_survival_routine: {
    description: "High-level survival - executes survival priorities (food, shelter, tools) based on current needs",
    inputSchema: {
      type: "object" as const,
      properties: {
        username: { type: "string", description: "Bot username" },
        priority: { type: "string", enum: ["food", "shelter", "tools", "auto"], description: "Priority mode (auto = intelligent selection)" }
      },
      required: ["username", "priority"]
    }
  },
  minecraft_explore_area: {
    description: "High-level exploration - explores area in spiral pattern, searching for biomes, blocks, or entities",
    inputSchema: {
      type: "object" as const,
      properties: {
        username: { type: "string", description: "Bot username" },
        radius: { type: "number", description: "Exploration radius in blocks" },
        target: { type: "string", description: "Optional target to search for (biome, block, or entity name)" }
      },
      required: ["username", "radius"]
    }
  },
  minecraft_validate_survival_environment: {
    description: "Validate if environment has sufficient food sources for survival - checks for passive mobs, edible plants, and fishing viability.",
    inputSchema: {
      type: "object" as const,
      properties: {
        username: { type: "string", description: "Bot username" },
        searchRadius: { type: "number", description: "Search radius in blocks (default: 100)" }
      },
      required: ["username"]
    }
  },
  minecraft_death_recovery: {
    description: "Post-respawn recovery protocol. Navigate to base, get food/tools from shared chest, eat, equip armor.",
    inputSchema: {
      type: "object" as const,
      properties: {
        username: { type: "string", description: "Bot username" },
        baseX: { type: "number", description: "Base X coordinate (optional)" },
        baseY: { type: "number", description: "Base Y coordinate (optional)" },
        baseZ: { type: "number", description: "Base Z coordinate (optional)" },
      },
      required: ["username"]
    }
  },
};

export async function handleHighLevelActionTool(name: string, args: Record<string, unknown>): Promise<string> {
  const username = args.username as string;

  switch (name) {
    case "minecraft_gather_resources": {
      const items = args.items as Array<{ name: string; count: number }>;
      const maxDistance = args.maxDistance as number | undefined;
      return await minecraft_gather_resources(username, items, maxDistance);
    }

    case "minecraft_build_structure": {
      const type = args.type as "shelter" | "wall" | "platform" | "tower";
      const size = args.size as "small" | "medium" | "large";
      return await minecraft_build_structure(username, type, size);
    }

    case "minecraft_craft_chain": {
      const target = args.target as string;
      const autoGather = args.autoGather as boolean | undefined;
      return await minecraft_craft_chain(username, target, autoGather);
    }

    case "minecraft_survival_routine": {
      const priority = args.priority as "food" | "shelter" | "tools" | "auto";
      return await minecraft_survival_routine(username, priority);
    }

    case "minecraft_explore_area": {
      const radius = args.radius as number;
      const target = args.target as string | undefined;
      return await minecraft_explore_area(username, radius, target);
    }

    case "minecraft_validate_survival_environment": {
      const searchRadius = args.searchRadius as number | undefined;
      return await minecraft_validate_survival_environment(username, searchRadius);
    }

    case "minecraft_death_recovery": {
      const baseX = args.baseX as number | undefined;
      const baseY = args.baseY as number | undefined;
      const baseZ = args.baseZ as number | undefined;
      return await minecraft_death_recovery(username, baseX, baseY, baseZ);
    }

    default:
      return `Unknown high-level action tool: ${name}`;
  }
}
