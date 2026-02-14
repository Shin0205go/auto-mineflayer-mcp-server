import { botManager } from "../bot-manager/index.js";

export const storageTools = {
  minecraft_list_chest: {
    description: "List contents of nearest chest (within 32 blocks)",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  minecraft_open_chest: {
    description: "Open a chest at specific coordinates and list its contents",
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

  minecraft_take_from_chest: {
    description: "Take items from a nearby chest (within 4 blocks)",
    inputSchema: {
      type: "object" as const,
      properties: {
        item_name: {
          type: "string",
          description: "Item name to take from chest",
        },
        count: {
          type: "number",
          description: "Number to take (default: all)",
        },
      },
      required: ["item_name"],
    },
  },

  minecraft_store_in_chest: {
    description: "Store items from inventory into a nearby chest (within 4 blocks)",
    inputSchema: {
      type: "object" as const,
      properties: {
        item_name: {
          type: "string",
          description: "Item name to store",
        },
        count: {
          type: "number",
          description: "Number to store (default: all)",
        },
      },
      required: ["item_name"],
    },
  },
};

// Tool handlers
export async function handleStorageTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const username = botManager.requireSingleBot();

  switch (name) {
    case "minecraft_list_chest":
      return await botManager.listChest(username);

    case "minecraft_open_chest": {
      const { x, y, z } = args as { x: number; y: number; z: number };
      return await botManager.openChest(username, x, y, z);
    }

    case "minecraft_take_from_chest": {
      const { item_name, count } = args as { item_name: string; count?: number };
      return await botManager.takeFromChest(username, item_name, count);
    }

    case "minecraft_store_in_chest": {
      const { item_name, count } = args as { item_name: string; count?: number };
      return await botManager.storeInChest(username, item_name, count);
    }

    default:
      throw new Error(`Unknown storage tool: ${name}`);
  }
}
