import { botManager } from "../bot-manager.js";

export const buildingTools = {
  minecraft_place_block: {
    description: "Place a block from your inventory at the specified coordinates. You must have the block in your inventory!",
    inputSchema: {
      type: "object" as const,
      properties: {
        block_type: {
          type: "string",
          description: "Block from your inventory (e.g., 'cobblestone', 'oak_planks', 'dirt')",
        },
        x: {
          type: "number",
          description: "X coordinate",
        },
        y: {
          type: "number",
          description: "Y coordinate",
        },
        z: {
          type: "number",
          description: "Z coordinate",
        },
      },
      required: ["block_type", "x", "y", "z"],
    },
  },

  minecraft_dig_block: {
    description: "Mine/dig a block at the specified coordinates. The block drops as an item to collect.",
    inputSchema: {
      type: "object" as const,
      properties: {
        x: {
          type: "number",
          description: "X coordinate",
        },
        y: {
          type: "number",
          description: "Y coordinate",
        },
        z: {
          type: "number",
          description: "Z coordinate",
        },
      },
      required: ["x", "y", "z"],
    },
  },

  minecraft_collect_items: {
    description: "Collect dropped items nearby (within 10 blocks)",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
};

export async function handleBuildingTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const username = botManager.requireSingleBot();

  switch (name) {
    case "minecraft_place_block": {
      const blockType = args.block_type as string;
      const x = args.x as number;
      const y = args.y as number;
      const z = args.z as number;

      if (!blockType) {
        throw new Error("Block type is required");
      }

      // Always survival mode - must have block in inventory
      const result = await botManager.placeBlock(username, blockType, x, y, z, false);
      if (!result.success) {
        throw new Error(result.message);
      }
      return result.message;
    }

    case "minecraft_dig_block": {
      const x = args.x as number;
      const y = args.y as number;
      const z = args.z as number;

      // Always survival mode - actually mine the block
      const result = await botManager.digBlock(username, x, y, z, false);
      return result;
    }

    case "minecraft_collect_items": {
      const result = await botManager.collectNearbyItems(username);
      return result;
    }

    default:
      throw new Error(`Unknown building tool: ${name}`);
  }
}
