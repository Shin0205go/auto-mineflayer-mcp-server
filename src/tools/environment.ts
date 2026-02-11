import { botManager } from "../bot-manager/index.js";
import { recallLocations } from "./learning.js";

export const environmentTools = {
  minecraft_check_infrastructure: {
    description: "Check for nearby crafting tables and furnaces. ALWAYS call this before crafting complex items or smelting. Returns both nearby blocks and saved locations.",
    inputSchema: {
      type: "object" as const,
      properties: {
        max_distance: {
          type: "number",
          description: "Maximum distance to search (default: 32)",
        },
      },
      required: [],
    },
  },

  minecraft_get_surroundings: {
    description:
      "Get immediate surroundings - which directions are passable, blocked, what's above/below, and nearby resources",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  minecraft_find_block: {
    description: "Find a specific block type within a given distance",
    inputSchema: {
      type: "object" as const,
      properties: {
        block_name: {
          type: "string",
          description: "The name of the block to find (e.g., 'oak_log', 'stone', 'diamond_ore')"
        },
        max_distance: {
          type: "number",
          description: "Maximum distance to search for the block",
          default: 20
        }
      },
      required: ["block_name"],
    },
  },
};

export async function handleEnvironmentTool(
  name: string,
  _args: Record<string, unknown>
): Promise<string> {
  const username = botManager.requireSingleBot();

  switch (name) {
    case "minecraft_check_infrastructure": {
      const maxDistance = (_args.max_distance as number) || 64;
      const results: string[] = [];
      const pos = botManager.getPosition(username);

      // Check for nearby crafting tables
      try {
        const craftingTable = await botManager.findBlock(username, "crafting_table", maxDistance);
        if (craftingTable && !craftingTable.includes("No ") && !craftingTable.includes("not found")) {
          results.push(`🔨 Crafting Table: ${craftingTable}`);
        } else {
          results.push(`🔨 Crafting Table: None nearby (within ${maxDistance} blocks)`);
        }
      } catch {
        results.push(`🔨 Crafting Table: None nearby`);
      }

      // Check for nearby furnaces
      try {
        const furnace = await botManager.findBlock(username, "furnace", maxDistance);
        if (furnace && !furnace.includes("No ") && !furnace.includes("not found")) {
          results.push(`🔥 Furnace: ${furnace}`);
        } else {
          results.push(`🔥 Furnace: None nearby (within ${maxDistance} blocks)`);
        }
      } catch {
        results.push(`🔥 Furnace: None nearby`);
      }

      // Check saved locations
      try {
        const savedCraftingTables = recallLocations("crafting_table", pos?.x, pos?.z);
        const savedFurnaces = recallLocations("furnace", pos?.x, pos?.z);

        if (savedCraftingTables.length > 0) {
          const nearest = savedCraftingTables[0];
          const dist = pos ? Math.sqrt(Math.pow(nearest.x - pos.x, 2) + Math.pow(nearest.z - pos.z, 2)).toFixed(0) : "?";
          results.push(`📍 Saved Crafting Tables: ${savedCraftingTables.length} (nearest: "${nearest.name}" at ${nearest.x},${nearest.y},${nearest.z} - ~${dist} blocks away)`);
        } else {
          results.push(`📍 Saved Crafting Tables: None saved yet`);
        }

        if (savedFurnaces.length > 0) {
          const nearest = savedFurnaces[0];
          const dist = pos ? Math.sqrt(Math.pow(nearest.x - pos.x, 2) + Math.pow(nearest.z - pos.z, 2)).toFixed(0) : "?";
          results.push(`📍 Saved Furnaces: ${savedFurnaces.length} (nearest: "${nearest.name}" at ${nearest.x},${nearest.y},${nearest.z} - ~${dist} blocks away)`);
        } else {
          results.push(`📍 Saved Furnaces: None saved yet`);
        }
      } catch {
        results.push(`📍 Saved Locations: Unable to check`);
      }

      // Add recommendation
      results.push("");
      results.push("💡 Tips:");
      results.push("- Use 'remember_location' to save infrastructure positions");
      results.push("- Go to saved locations instead of crafting new tables/furnaces");

      return results.join("\n");
    }

    case "minecraft_get_surroundings": {
      try {
        return botManager.getSurroundings(username);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return `Failed to get surroundings: ${errMsg}`;
      }
    }

    case "minecraft_find_block": {
      const { block_name, max_distance = 20 } = _args as {
        block_name: string;
        max_distance?: number;
      };
      try {
        // 複数の名前形式で検索を試行
        const searchVariants = [
          block_name,
          block_name.includes(':') ? block_name : `minecraft:${block_name}`,
          block_name.includes(':') ? block_name.split(':')[1] : block_name
        ];
        
        // 重複を除去
        const uniqueVariants = [...new Set(searchVariants)];
        
        for (const variant of uniqueVariants) {
          try {
            const result = await botManager.findBlock(username, variant, max_distance);
            if (result && typeof result === 'string' && !result.startsWith('No ') && !result.includes('not found')) {
              return result;
            }
          } catch (innerError) {
            // 個別のvariantでエラーが発生しても続行
            continue;
          }
        }
        
        // ブロックが見つからない場合は正常な結果として返す
        return `No ${block_name} found within ${max_distance} blocks`;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.log(`Block search error for ${block_name}:`, errMsg);
        // ブロックが見つからない場合は正常な結果として扱う
        if (errMsg.includes('not found') || errMsg.includes('No ') || errMsg.includes('found within')) {
          return `No ${block_name} found within ${max_distance} blocks`;
        }
        return `Block search failed: ${errMsg}. Try increasing max_distance or moving to a different area.`;
      }
    }

    default:
      throw new Error(`Unknown environment tool: ${name}`);
  }
}
