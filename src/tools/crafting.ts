import { botManager } from "../bot-manager/index.js";

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
    description: "Craft an item. Requires a crafting table nearby for complex recipes. IMPORTANT: Before crafting, call 'minecraft_check_infrastructure' to find existing crafting tables. If one exists at a saved location, go there instead of making a new one.",
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
    description: "Equip an item to hand or armor slot. Use 'none' or 'empty' as item_name to unequip and switch to empty hand.",
    inputSchema: {
      type: "object" as const,
      properties: {
        item_name: {
          type: "string",
          description: "Item name to equip, or 'none'/'empty' to unequip and use empty hand",
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
    description: "Drop items from inventory. WARNING: Dropped items may disappear on some servers due to item entity sync issues. For reliable item transfer between bots, use minecraft_store_in_chest + minecraft_take_from_chest instead.",
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

  minecraft_smelt: {
    description: "Smelt items in a furnace. Requires a furnace nearby and fuel. IMPORTANT: Before smelting (e.g., iron_ore), call 'minecraft_check_infrastructure' first. If a furnace exists at a saved location, go there. Don't mine more ore if you already have ore and a furnace is available.",
    inputSchema: {
      type: "object" as const,
      properties: {
        item_name: {
          type: "string",
          description: "Item to smelt (e.g., 'iron_ore', 'cobblestone', 'sand', 'spruce_log')",
        },
        count: {
          type: "number",
          description: "Number to smelt (default: 1)",
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

      try {
        const result = await botManager.craftItem(username, itemName, count);
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const inventory = botManager.getInventory(username);
        const inventoryStr = inventory.map(item => `${item.name}(${item.count})`).join(", ");
        // Return as info, not error - let agent decide next action
        return `Cannot craft ${itemName}: ${errorMsg}. Inventory: ${inventoryStr}`;
      }
    }

    case "minecraft_equip": {
      const itemName = args.item_name as string;
      if (!itemName) {
        throw new Error("item_name is required");
      }
      try {
        const result = await botManager.equipItem(username, itemName);
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return `Failed to equip ${itemName}: ${errorMsg}`;
      }
    }

    case "minecraft_drop_item": {
      const itemName = args.item_name as string;
      const count = args.count as number | undefined;

      if (!itemName) {
        throw new Error("item_name is required");
      }

      try {
        const result = await botManager.dropItem(username, itemName, count);
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return `Failed to drop ${itemName}: ${errorMsg}`;
      }
    }

    case "minecraft_smelt": {
      const itemName = args.item_name as string;
      const count = (args.count as number) || 1;

      if (!itemName) {
        throw new Error("Item name is required");
      }

      try {
        const result = await botManager.smeltItem(username, itemName, count);
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const inventory = botManager.getInventory(username);
        const inventoryStr = inventory.map(item => `${item.name}(${item.count})`).join(", ");
        // Return as info, not error - let agent decide next action
        return `Cannot smelt ${itemName}: ${errorMsg}. Inventory: ${inventoryStr}`;
      }
    }

    default:
      throw new Error(`Unknown crafting tool: ${name}`);
  }
}
