import { botManager } from "../bot-manager.js";

export const craftingTools = {
  minecraft_get_inventory: {
    description: "Get the bot's inventory contents",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  minecraft_craft: {
    description: "Craft an item. Requires a crafting table nearby for complex recipes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        item_name: {
          type: "string",
          description: "Item to craft (e.g., 'oak_planks', 'stick', 'crafting_table', 'wooden_pickaxe')",
        },
        count: {
          type: "number",
          description: "Number of times to craft (default: 1)",
        },
      },
      required: ["item_name"],
    },
  },

  minecraft_equip: {
    description: "Equip an item to hand or armor slot",
    inputSchema: {
      type: "object" as const,
      properties: {
        item_name: {
          type: "string",
          description: "Item name to equip",
        },
        destination: {
          type: "string",
          enum: ["hand", "off-hand", "head", "torso", "legs", "feet"],
          description: "Where to equip the item (default: hand)",
        },
      },
      required: ["item_name"],
    },
  },

  minecraft_drop_item: {
    description: "Drop items from inventory",
    inputSchema: {
      type: "object" as const,
      properties: {
        item_name: {
          type: "string",
          description: "Item name to drop",
        },
        count: {
          type: "number",
          description: "Number to drop (default: all)",
        },
      },
      required: ["item_name"],
    },
  },
};

export async function handleCraftingTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const username = botManager.requireSingleBot();

  switch (name) {
    case "minecraft_get_inventory": {
      const inventory = botManager.getInventory(username);
      if (inventory.length === 0) {
        return "Inventory is empty";
      }
      return `Inventory:\n${inventory.map(item => `- ${item.name} x${item.count}`).join("\n")}`;
    }

    case "minecraft_craft": {
      const itemName = args.item_name as string;
      const count = (args.count as number) || 1;

      if (!itemName) {
        throw new Error("Item name is required");
      }

      const result = await botManager.craftItem(username, itemName, count);
      return result;
    }

    case "minecraft_equip": {
      const itemName = args.item_name as string;
      // equipItem not implemented in multi-bot manager yet
      return `Equip ${itemName}: Not yet implemented`;
    }

    case "minecraft_drop_item": {
      const itemName = args.item_name as string;
      // dropItem not implemented in multi-bot manager yet
      return `Drop ${itemName}: Not yet implemented`;
    }

    default:
      throw new Error(`Unknown crafting tool: ${name}`);
  }
}
