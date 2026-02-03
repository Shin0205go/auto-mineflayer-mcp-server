import { botManager } from "../bot-manager.js";

export const environmentTools = {
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
          const result = await botManager.findBlock(username, variant, max_distance);
          if (result && typeof result === 'string' && !result.startsWith('No ') && !result.includes('not found')) {
            return result;
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
