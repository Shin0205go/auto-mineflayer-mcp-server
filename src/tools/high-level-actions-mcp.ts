import {
  minecraft_gather_resources,
  minecraft_build_structure,
  minecraft_craft_chain,
  minecraft_survival_routine,
  minecraft_explore_area,
  minecraft_validate_survival_environment,
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
    description: "Validate if environment has sufficient food sources for survival - checks for passive mobs, edible plants, and fishing viability. Run this at session start to detect unplayable environments.",
    inputSchema: {
      type: "object" as const,
      properties: {
        username: { type: "string", description: "Bot username" },
        searchRadius: { type: "number", description: "Search radius in blocks (default: 100)" }
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

    default:
      return `Unknown high-level action tool: ${name}`;
  }
}
