import { botManager } from "../bot-manager/index.js";

export const storageTools = {
  minecraft_open_chest: {
    description: "Open a chest and list its contents. Use this ONLY to inspect chest contents. To take/store items, use minecraft_take_from_chest or minecraft_store_in_chest directly (they open the chest automatically).",
    inputSchema: {
      type: "object" as const,
      properties: {
        x: {
          type: "number",
          description: "X coordinate of chest",
        },
        y: {
          type: "number",
          description: "Y coordinate of chest",
        },
        z: {
          type: "number",
          description: "Z coordinate of chest",
        },
      },
      required: ["x", "y", "z"],
    },
  },

  minecraft_take_from_chest: {
    description: "Take items from a nearby chest (within 4 blocks). DO NOT call minecraft_open_chest first - this tool opens the chest automatically. Optionally specify chest coordinates to target a specific chest.",
    inputSchema: {
      type: "object" as const,
      properties: {
        item_name: {
          type: "string",
          description: "Item name to take (e.g., 'bread', 'cooked_beef')",
        },
        count: {
          type: "number",
          description: "Number of items to take (default: all)",
        },
        x: {
          type: "number",
          description: "X coordinate of chest (optional, uses nearest if omitted)",
        },
        y: {
          type: "number",
          description: "Y coordinate of chest (optional, uses nearest if omitted)",
        },
        z: {
          type: "number",
          description: "Z coordinate of chest (optional, uses nearest if omitted)",
        },
      },
      required: ["item_name"],
    },
  },

  minecraft_store_in_chest: {
    description: "Store items from inventory into a nearby chest (within 4 blocks). DO NOT call minecraft_open_chest first - this tool opens the chest automatically. Optionally specify chest coordinates to target a specific chest.",
    inputSchema: {
      type: "object" as const,
      properties: {
        item_name: {
          type: "string",
          description: "Item name to store",
        },
        count: {
          type: "number",
          description: "Number of items to store (default: all)",
        },
        x: {
          type: "number",
          description: "X coordinate of chest (optional, uses nearest if omitted)",
        },
        y: {
          type: "number",
          description: "Y coordinate of chest (optional, uses nearest if omitted)",
        },
        z: {
          type: "number",
          description: "Z coordinate of chest (optional, uses nearest if omitted)",
        },
      },
      required: ["item_name"],
    },
  },

  minecraft_list_chest: {
    description: "List contents of nearest chest (within 32 blocks)",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
};

export async function handleStorageTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const username = botManager.requireSingleBot();

  switch (name) {
    case "minecraft_open_chest": {
      const x = args.x as number;
      const y = args.y as number;
      const z = args.z as number;
      return await botManager.openChest(username, x, y, z);
    }

    case "minecraft_take_from_chest": {
      const itemName = args.item_name as string;
      const count = args.count as number | undefined;
      const tx = args.x as number | undefined;
      const ty = args.y as number | undefined;
      const tz = args.z as number | undefined;
      return await botManager.takeFromChest(username, itemName, count, tx, ty, tz);
    }

    case "minecraft_store_in_chest": {
      const itemName = args.item_name as string;
      const count = args.count as number | undefined;
      const sx = args.x as number | undefined;
      const sy = args.y as number | undefined;
      const sz = args.z as number | undefined;
      return await botManager.storeInChest(username, itemName, count, sx, sy, sz);
    }

    case "minecraft_list_chest": {
      return await botManager.listChest(username);
    }

    default:
      throw new Error(`Unknown storage tool: ${name}`);
  }
}
