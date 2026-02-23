import { botManager } from "../bot-manager/index.js";
import { Bot } from "mineflayer"; // Import Bot type for type hinting

export const debugCraftingTools = {
  minecraft_debug_crafting_issues: {
    description: "Debugs crafting and resource gathering issues, specifically for 'stick' and 'oak_log'.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

export async function handleDebugCraftingTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const username = botManager.requireSingleBot();
  const bot = botManager.getBot(username);

  if (!bot) {
    throw new Error("Bot not found or not connected.");
  }

  const results: string[] = [];

  switch (name) {
    case "minecraft_debug_crafting_issues": {
      results.push("--- Debugging Crafting and Gathering Issues ---");

      // 1. Check mcData.blocksByName for "oak_log"
      try {
        const mcData = (bot as any).registry;
        const oakLogBlockData = mcData.blocksByName["oak_log"];
        if (oakLogBlockData) {
          results.push(`mcData.blocksByName["oak_log"] found: ID=${oakLogBlockData.id}, display_name=${oakLogBlockData.displayName}`);
        } else {
          results.push(`mcData.blocksByName["oak_log"] is UNDEFINED.`);
        }
      } catch (e) {
        results.push(`Error checking mcData.blocksByName["oak_log"]: ${e}`);
      }

      // 2. Check mcData.itemsByName for "birch_planks" and "stick"
      try {
        const mcData = (bot as any).registry;
        const birchPlanksItemData = mcData.itemsByName["birch_planks"];
        if (birchPlanksItemData) {
          results.push(`mcData.itemsByName["birch_planks"] found: ID=${birchPlanksItemData.id}, display_name=${birchPlanksItemData.displayName}`);
        } else {
          results.push(`mcData.itemsByName["birch_planks"] is UNDEFINED.`);
        }
        const stickItemData = mcData.itemsByName["stick"];
        if (stickItemData) {
          results.push(`mcData.itemsByName["stick"] found: ID=${stickItemData.id}, display_name=${stickItemData.displayName}`);
        } else {
          results.push(`mcData.itemsByName["stick"] is UNDEFINED.`);
        }
      } catch (e) {
        results.push(`Error checking mcData.itemsByName for planks/stick: ${e}`);
      }

      // 3. Attempt to find oak_log using botManager.findBlock
      try {
        results.push("Attempting botManager.findBlock for 'oak_log'...");
        const findResult = botManager.findBlock(username, "oak_log", 64);
        results.push(`botManager.findBlock('oak_log') result: ${findResult}`);
      } catch (e) {
        results.push(`Error calling botManager.findBlock for 'oak_log': ${e}`);
      }

      // 4. Attempt to craft stick using botManager.craftItem
      try {
        results.push("Attempting botManager.craftItem for 'stick'...");
        const craftResult = await botManager.craftItem(username, "stick", 1);
        results.push(`botManager.craftItem('stick') result: ${craftResult}`);
      } catch (e: any) {
        results.push(`Error calling botManager.craftItem('stick'): ${e.message || e}`);
      }

      return results.join("\n");
    }
    default:
      throw new Error(`Unknown debug crafting tool: ${name}`);
  }
}
