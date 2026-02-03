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

  minecraft_smelt: {
    description: "Smelt items in a furnace. Requires a furnace nearby and fuel.",
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
        
        // Log the actual error and inventory state for debugging
        console.log(`Craft error for ${itemName}: ${errorMsg}`);
        console.log(`Current inventory: ${inventoryStr}`);
        
        // Check if we already have enough of the item first
        const existingCount = inventory.find(item => item.name === itemName)?.count || 0;
        if (existingCount >= count) {
          return `Already have ${existingCount} ${itemName}(s). Requested to craft ${count}, but you already have enough. Inventory: ${inventoryStr}`;
        }
        
        // Check for stick crafting specific issues
        if (itemName === 'stick') {
          const plankTypes = ['oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'pale_oak_planks'];
          const availablePlanks = inventory.filter(item => plankTypes.includes(item.name));
          const totalPlanks = availablePlanks.reduce((sum, item) => sum + item.count, 0);
          
          if (totalPlanks >= 2) {
            const plankList = availablePlanks.map(item => `${item.name}(${item.count})`).join(', ');
            return `Cannot craft stick. Tool requires specific plank type but any planks should work. Recipe issue detected. Have planks: ${plankList} (total: ${totalPlanks}). The MCP tool incorrectly requires '${errorMsg.match(/Need: (\w+)/)?.[1] || 'specific planks'}' but stick recipe accepts any plank type. Try crafting more planks to reach 2+ of the same type. Error: ${errorMsg}. Inventory: ${inventoryStr}`;
          } else {
            return `Cannot craft stick. Need: any wood planks x2. Have only ${totalPlanks} planks total (${availablePlanks.map(item => `${item.name}:${item.count}`).join(', ')}). Craft more planks from wood logs first. Inventory: ${inventoryStr}`;
          }
        }
        
        // Check for items that should be craftable in 2x2 grid but are being rejected
        const basicCraftableItems = ['crafting_table', 'torch', 'planks', 'wooden_pickaxe', 'wooden_sword', 'wooden_axe', 'wooden_shovel', 'wooden_hoe'];
        const isBasicCraftable = basicCraftableItems.some(item => itemName.includes(item) || item.includes(itemName));
        
        if (isBasicCraftable && errorMsg.includes('crafting_table')) {
          return `Failed to craft ${itemName}: This item should be craftable in basic 2x2 grid without crafting_table. Error suggests crafting_table needed but this is incorrect. Actual error: ${errorMsg}. Inventory: ${inventoryStr}`;
        }
        
        // Check if error is about needing a crafting table nearby
        if (errorMsg.includes('requires a crafting_table nearby')) {
          const hasCraftingTable = inventory.find(item => item.name === 'crafting_table')?.count || 0;
          if (hasCraftingTable > 0) {
            return `Cannot craft ${itemName}: You need to place a crafting_table first. You have ${hasCraftingTable} crafting_table(s) in inventory. Use minecraft_place_block to place it near you, then try crafting again. Error: ${errorMsg}. Inventory: ${inventoryStr}`;
          } else {
            return `Cannot craft ${itemName}: You need a crafting_table nearby. First craft a crafting_table (4 planks in 2x2), then place it near you using minecraft_place_block. Error: ${errorMsg}. Inventory: ${inventoryStr}`;
          }
        }
        
        // Check if we already have enough of the item before processing any errors
        if (itemName.includes('_planks') || itemName === 'stick' || itemName === 'torch') {
          const existingCount = inventory.find(item => item.name === itemName)?.count || 0;
          if (existingCount >= count) {
            return `Already have enough ${itemName} (${existingCount}/${count}). No need to craft more. Inventory: ${inventoryStr}`;
          }
        }
        
        // Check for planks crafting specific issues
        if (itemName.includes('_planks')) {
          const logType = itemName.replace('_planks', '_log');
          const logCount = inventory.find(item => item.name === logType)?.count || 0;
          const existingPlanks = inventory.find(item => item.name === itemName)?.count || 0;
          
          // If the error says we have 0 logs but we actually have planks, it's likely a tool state issue
          if (errorMsg.includes('have 0') && existingPlanks > 0) {
            return `Tool state inconsistency: Error reports missing ${logType} but you already have ${existingPlanks} ${itemName}. The crafting may have succeeded in a previous attempt. Current inventory shows sufficient materials. Inventory: ${inventoryStr}`;
          }
          
          // Check if error mentions crafting_table requirement for basic planks recipe
          if (errorMsg.includes('crafting_table')) {
            return `Failed to craft ${itemName}: Tool incorrectly requires crafting_table for basic planks recipe. Planks are a 2x2 recipe (1 log → 4 planks) that should work in inventory crafting. Have ${logType}: ${logCount}. This is a MCP tool limitation. Inventory: ${inventoryStr}`;
          }
          
          if (logCount === 0) {
            return `Cannot craft ${itemName}. Need: ${logType} x1. Missing: ${logType} (need 1, have 0). Find and chop down trees to get logs. Inventory: ${inventoryStr}`;
          } else {
            return `Failed to craft ${itemName}: Have required materials (${logType}: ${logCount}) but crafting failed. Error: ${errorMsg}. This indicates a recipe recognition issue in the MCP tool - planks should craft from logs in 2x2 grid without crafting_table. Try using different log types or check if MCP tool is using wrong recipe format. Inventory: ${inventoryStr}`;
          }
        }
        
        // Check for torch crafting specific issues
        if (itemName === 'torch') {
          const coalCount = inventory.find(item => item.name === 'coal')?.count || 0;
          const charcoalCount = inventory.find(item => item.name === 'charcoal')?.count || 0;
          const stickCount = inventory.find(item => item.name === 'stick')?.count || 0;
          
          if (coalCount === 0 && charcoalCount === 0) {
            return `Failed to craft torch: Missing fuel. Need (coal OR charcoal) + stick. Have ${stickCount} sticks but 0 coal and 0 charcoal. Mine coal ore or smelt wood to get fuel. Inventory: ${inventoryStr}`;
          } else if (stickCount === 0) {
            return `Failed to craft torch: Missing sticks. Need stick + (coal OR charcoal). Have ${coalCount} coal and ${charcoalCount} charcoal but 0 sticks. Craft sticks from planks first. Inventory: ${inventoryStr}`;
          } else if (errorMsg.includes('missing ingredient')) {
            return `Failed to craft torch: Recipe not recognized. Have materials (coal: ${coalCount}, charcoal: ${charcoalCount}, stick: ${stickCount}) but MCP tool reports 'missing ingredient'. This suggests the tool doesn't recognize the correct torch recipe. Try crafting sticks first if you have coal but no sticks. Inventory: ${inventoryStr}`;
          } else if (errorMsg.includes('crafting_table')) {
            return `Failed to craft torch: Tool incorrectly requires crafting_table. Torch is a basic 2x2 recipe (coal/charcoal + stick) that should work in inventory crafting. This is a tool limitation - torch should not need crafting_table. Inventory: ${inventoryStr}`;
          } else if ((coalCount > 0 || charcoalCount > 0) && stickCount > 0) {
            return `Failed to craft torch: Have all required materials (coal: ${coalCount}, charcoal: ${charcoalCount}, stick: ${stickCount}) but crafting failed. Error: ${errorMsg}. This indicates a recipe recognition issue in the MCP tool. Inventory: ${inventoryStr}`;
          }
        }
        
        // Check for timeout errors - suggest retry
        if (errorMsg.includes('timeout') || errorMsg.includes('did not fire')) {
          return `Failed to craft ${itemName}: Timeout error occurred. This might be a temporary issue. Try again or check if you have the required materials. Error: ${errorMsg}. Inventory: ${inventoryStr}`;
        }
        
        // Check if error mentions wrong materials and suggest alternatives
        if (errorMsg.includes('cobbled_deepslate')) {
          if (itemName.includes('stone_') || itemName.includes('_stone') || itemName === 'furnace') {
            const cobblestoneCount = inventory.find(item => item.name === 'cobblestone')?.count || 0;
            const stickCount = inventory.find(item => item.name === 'stick')?.count || 0;
            const needCobblestone = itemName === 'furnace' ? 8 : (itemName === 'stone_sword' ? 2 : 3);
            const needStick = itemName === 'stone_pickaxe' ? 2 : (itemName === 'stone_sword' ? 1 : 0);
            const missingCobblestone = needCobblestone - cobblestoneCount;
            const missingStick = needStick - stickCount;
            
            if (missingCobblestone > 0 || missingStick > 0) {
              let message = `Cannot craft ${itemName}. Need: cobblestone x${needCobblestone}`;
              if (needStick > 0) message += ` + stick x${needStick}`;
              message += `. Missing:`;
              if (missingCobblestone > 0) message += ` cobblestone (need ${needCobblestone}, have ${cobblestoneCount})`;
              if (missingStick > 0) message += ` stick (need ${needStick}, have ${stickCount})`;
              message += `. Hint: Mine ${missingCobblestone} more stone blocks with wooden_pickaxe to get cobblestone.`;
              message += ` Have: ${inventoryStr}`;
              return message;
            } else {
              return `Cannot craft ${itemName}. Recipe error: game requires 'cobbled_deepslate' but should use 'cobblestone'. You have enough materials (cobblestone: ${cobblestoneCount}, stick: ${stickCount}). Current inventory: ${inventoryStr}`;
            }
          }
        }
        
        throw new Error(`Cannot craft ${itemName}. ${errorMsg}. Have: ${inventoryStr}`);
      }
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
        
        if (errorMsg.includes("No furnace found")) {
          const cobblestoneCount = inventory.find(item => item.name === 'cobblestone')?.count || 0;
          const hasFurnace = inventory.find(item => item.name === 'furnace')?.count || 0;
          
          if (hasFurnace > 0) {
            return `Cannot smelt ${itemName}: No furnace found within 4 blocks. You have ${hasFurnace} furnace(s) in inventory but need to place one first. Use minecraft_place_block to place the furnace near you, then try smelting again.`;
          } else if (cobblestoneCount >= 8) {
            return `Cannot smelt ${itemName}: No furnace found within 4 blocks. You have ${cobblestoneCount} cobblestone. First craft a furnace using minecraft_craft with item_name: 'furnace', then place it near you using minecraft_place_block.`;
          } else {
            return `Cannot smelt ${itemName}: No furnace found within 4 blocks. Need 8 cobblestone to craft a furnace. You have ${cobblestoneCount} cobblestone. Mine ${8 - cobblestoneCount} more stone blocks to get cobblestone, craft a furnace, then place it.`;
          }
        } else if (errorMsg.includes("destination full")) {
          return `Cannot smelt ${itemName}: Furnace output slot is full. The furnace contains finished items that must be collected first. Use minecraft_interact_block on the furnace to open it, then collect the smelted items from the output slot before trying to smelt more. You may need to free up inventory space first.`;
        }
        
        throw new Error(`Cannot smelt ${itemName}. ${errorMsg}. Have: ${inventoryStr}`);
      }
    }

    default:
      throw new Error(`Unknown crafting tool: ${name}`);
  }
}
