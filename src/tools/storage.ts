import { botManager } from "../bot-manager/index.js";

export const storageTools = {
  minecraft_list_chest: {
    description: "List contents of the nearest chest within 32 blocks",
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
        x: { type: "number", description: "X coordinate" },
        y: { type: "number", description: "Y coordinate" },
        z: { type: "number", description: "Z coordinate" },
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
          description: "Number of items to take (optional, defaults to all)",
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
          description: "Item name to store in chest",
        },
        count: {
          type: "number",
          description: "Number of items to store (optional, defaults to all)",
        },
      },
      required: ["item_name"],
    },
  },
};

export async function handleStorageTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const username = botManager.requireSingleBot();
  const managed = botManager.getBotByUsername(username);
  if (!managed) {
    throw new Error(`Bot ${username} not found`);
  }

  switch (name) {
    case "minecraft_list_chest": {
      const { listChest } = await import("../bot-manager/bot-storage.js");
      return await listChest(managed);
    }

    case "minecraft_open_chest": {
      const x = args.x as number;
      const y = args.y as number;
      const z = args.z as number;
      if (x === undefined || y === undefined || z === undefined) {
        throw new Error("x, y, z coordinates are required");
      }
      const { openChest } = await import("../bot-manager/bot-storage.js");
      return await openChest(managed, x, y, z);
    }

    case "minecraft_take_from_chest": {
      const itemName = args.item_name as string;
      const count = args.count as number | undefined;
      if (!itemName) {
        throw new Error("item_name is required");
      }
      const { takeFromChest } = await import("../bot-manager/bot-storage.js");
      return await takeFromChest(managed, itemName, count);
    }

    case "minecraft_store_in_chest": {
      const itemName = args.item_name as string;
      const count = args.count as number | undefined;
      if (!itemName) {
        throw new Error("item_name is required");
      }
      const { storeInChest } = await import("../bot-manager/bot-storage.js");
      return await storeInChest(managed, itemName, count);
    }

    default:
      throw new Error(`Unknown storage tool: ${name}`);
  }
}
