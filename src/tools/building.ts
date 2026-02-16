import { botManager } from "../bot-manager/index.js";

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
        auto_collect: {
          type: "boolean",
          description: "Automatically collect dropped items after digging (default: true). Set to false if you want to manually control item pickup or if you're clearing inventory space.",
        },
        force: {
          type: "boolean",
          description: "Force dig even if lava is adjacent (default: false). Use when mining obsidian or other blocks that naturally generate next to lava.",
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

  minecraft_level_ground: {
    description: "Level ground in an area - dig blocks above target height and fill holes below. Essential for preparing building sites, farms, and paths.",
    inputSchema: {
      type: "object" as const,
      properties: {
        center_x: {
          type: "number",
          description: "X coordinate of area center",
        },
        center_z: {
          type: "number",
          description: "Z coordinate of area center",
        },
        radius: {
          type: "number",
          description: "Radius of area to level (default: 5, max: 15)",
        },
        target_y: {
          type: "number",
          description: "Target height (Y coordinate). If omitted, auto-detects the most common ground level in the area.",
        },
        fill_block: {
          type: "string",
          description: "Block type to fill holes (e.g., 'dirt', 'cobblestone'). Uses inventory if omitted.",
        },
        mode: {
          type: "string",
          enum: ["dig", "fill", "both"],
          description: "Operation mode: 'dig' (only remove), 'fill' (only fill holes), 'both' (default)",
        },
      },
      required: ["center_x", "center_z"],
    },
  },

  minecraft_pillar_up: {
    description: "Build a pillar upward by jump-placing blocks. Use this to climb to higher locations.",
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

  minecraft_use_item_on_block: {
    description: "Use a held item on a block at the specified coordinates. Use cases: bucket on water/lava to collect fluid, water_bucket to place water, flint_and_steel to ignite, bone_meal on crops, shears on sheep, etc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        item_name: {
          type: "string",
          description: "Item to use (e.g., 'bucket', 'water_bucket', 'lava_bucket', 'flint_and_steel', 'bone_meal')",
        },
        x: {
          type: "number",
          description: "X coordinate of target block",
        },
        y: {
          type: "number",
          description: "Y coordinate of target block",
        },
        z: {
          type: "number",
          description: "Z coordinate of target block",
        },
      },
      required: ["item_name", "x", "y", "z"],
    },
  },

  minecraft_till_soil: {
    description: "Till soil (grass_block or dirt) to create farmland for planting crops. Workaround for hoe crafting bug.",
    inputSchema: {
      type: "object" as const,
      properties: {
        x: {
          type: "number",
          description: "X coordinate of block to till",
        },
        y: {
          type: "number",
          description: "Y coordinate of block to till",
        },
        z: {
          type: "number",
          description: "Z coordinate of block to till",
        },
      },
      required: ["x", "y", "z"],
    },
  },

  minecraft_throw_item: {
    description: "Throw a projectile item (egg, snowball, ender_pearl) by activating it. Used to spawn chickens from eggs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        item_name: {
          type: "string",
          description: "Item to throw (e.g., 'egg', 'snowball', 'ender_pearl')",
        },
        count: {
          type: "number",
          description: "Number of items to throw (default: 1)",
          default: 1,
        },
      },
      required: ["item_name"],
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

      // Use botManager.placeBlock which handles the placement properly
      try {
        const result = await botManager.placeBlock(username, blockType, x, y, z, false);
        return result.success ? result.message : `Failed to place block: ${result.message}`;
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(`Failed to place block: ${error.message}`);
        }
        throw error;
      }
    }

    case "minecraft_dig_block": {
      const x = args.x as number;
      const y = args.y as number;
      const z = args.z as number;
      const autoCollect = args.auto_collect !== undefined ? (args.auto_collect as boolean) : true;
      const force = args.force !== undefined ? (args.force as boolean) : false;

      // Check if bot is connected first
      const bot = botManager.getBot(username);
      if (!bot) {
        throw new Error("Not connected. Call minecraft_connect first.");
      }

      // Check if bot can navigate to target position
      if (bot) {
        const distance = Math.sqrt(
          Math.pow(bot.entity.position.x - x, 2) +
          Math.pow(bot.entity.position.y - y, 2) +
          Math.pow(bot.entity.position.z - z, 2)
        );

        // If too far, suggest movement instead of failing immediately
        if (distance > 6) {
          throw new Error(`Target position (${x}, ${y}, ${z}) is too far away (${distance.toFixed(1)} blocks). Use minecraft_move_to to get closer first, then try digging again. Current position: (${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.y.toFixed(1)}, ${bot.entity.position.z.toFixed(1)})`);
        }

        // Give bot time to position properly before mining
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      try {
        // Always survival mode - actually mine the block
        const result = await botManager.digBlock(username, x, y, z, false, autoCollect, force);
        return result;
      } catch (error) {
        if (error instanceof Error) {
          // Provide more helpful error messages for common mining issues
          if (error.message.includes('Cannot reach')) {
            throw new Error(`${error.message} Try moving closer to the target block.`);
          }
          if (error.message.includes('requires') && error.message.includes('pickaxe')) {
            // Extract block type and required tool from error message for better guidance
            const blockMatch = error.message.match(/Cannot mine (\w+)/);
            const toolMatch = error.message.match(/(\w+ pickaxe)/);
            const blockType = blockMatch ? blockMatch[1] : 'this block';
            const requiredTool = toolMatch ? toolMatch[1] : 'better pickaxe';
            throw new Error(`Cannot mine ${blockType} with current tool - requires ${requiredTool} or better! Craft the required tool first, then try mining again. ${error.message}`);
          }
        }
        throw error;
      }
    }

    case "minecraft_collect_items": {
      const result = await botManager.collectNearbyItems(username);
      return result;
    }

    case "minecraft_level_ground": {
      const centerX = args.center_x as number;
      const centerZ = args.center_z as number;
      const radius = Math.min((args.radius as number) || 5, 15);
      const targetY = args.target_y as number | undefined;
      const fillBlock = args.fill_block as string | undefined;
      const mode = (args.mode as "dig" | "fill" | "both") || "both";

      const result = await botManager.levelGround(username, {
        centerX,
        centerZ,
        radius,
        targetY,
        fillBlock,
        mode,
      });
      return result;
    }

    case "minecraft_pillar_up": {
      const height = Math.min((args.height as number) || 1, 15);
      const result = await botManager.pillarUp(username, height);
      return result;
    }

    case "minecraft_use_item_on_block": {
      const itemName = args.item_name as string;
      const x = args.x as number;
      const y = args.y as number;
      const z = args.z as number;

      if (!itemName) {
        throw new Error("item_name is required");
      }

      const result = await botManager.useItemOnBlock(username, itemName, x, y, z);
      return result;
    }

    case "minecraft_till_soil": {
      const x = args.x as number;
      const y = args.y as number;
      const z = args.z as number;
      const result = await botManager.tillSoil(username, x, y, z);
      return result;
    }

    case "minecraft_throw_item": {
      const itemName = args.item_name as string;
      const count = (args.count as number) || 1;
      if (!itemName) {
        throw new Error("item_name is required");
      }
      const result = await botManager.throwItem(username, itemName, count);
      return result;
    }

    default:
      throw new Error(`Unknown building tool: ${name}`);
  }
}
