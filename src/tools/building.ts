import { botManager } from "../bot-manager.js";

export const buildingTools = {
  minecraft_place_block: {
    description: "Place a block at specified coordinates. In survival mode, uses block from inventory.",
    inputSchema: {
      type: "object" as const,
      properties: {
        block_type: {
          type: "string",
          description: "Minecraft block ID (e.g., 'stone', 'oak_planks', 'dirt')",
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
        use_command: {
          type: "boolean",
          description: "Use /setblock command (requires OP). Default false for survival mode.",
        },
      },
      required: ["block_type", "x", "y", "z"],
    },
  },

  minecraft_dig_block: {
    description: "Dig/break a single block at specified coordinates. In survival, actually mines the block.",
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
        use_command: {
          type: "boolean",
          description: "Use /setblock air (requires OP). Default false for survival mode.",
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
      const useCommand = (args.use_command as boolean) || false;

      if (!blockType) {
        throw new Error("Block type is required");
      }

      const result = await botManager.placeBlock(username, blockType, x, y, z, useCommand);
      if (!result.success) {
        throw new Error(result.message);
      }
      return result.message;
    }

    case "minecraft_dig_block": {
      const x = args.x as number;
      const y = args.y as number;
      const z = args.z as number;
      const useCommand = (args.use_command as boolean) || false;

      const result = await botManager.digBlock(username, x, y, z, useCommand);
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
