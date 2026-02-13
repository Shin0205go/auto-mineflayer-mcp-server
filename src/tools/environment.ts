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

  minecraft_diagnose_server: {
    description: "Diagnose server configuration issues (mob spawning, item drops, permissions). Use when experiencing gameplay problems like missing animals or items not dropping.",
    inputSchema: {
      type: "object" as const,
      properties: {
        auto_fix: {
          type: "boolean",
          description: "Attempt to automatically fix detected issues (default: false)",
          default: false
        }
      },
      required: [],
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

    case "minecraft_diagnose_server": {
      const { auto_fix = false } = _args as { auto_fix?: boolean };
      const diagnostics: string[] = [];

      diagnostics.push("🔍 Server Configuration Diagnosis\n");

      // 1. Check entity spawning - use specific food animals like validation does
      try {
        const entityInfo = botManager.getNearbyEntities(username, 64, "all");
        const entities = JSON.parse(entityInfo);

        const hostiles = entities.filter((e: any) => e.type === "hostile");
        const passives = entities.filter((e: any) => e.type === "passive");

        // Check for actual food animals (same logic as validation)
        const foodAnimals = ["cow", "pig", "chicken", "sheep", "rabbit"];
        let foodAnimalCount = 0;
        for (const animal of foodAnimals) {
          const found = entities.filter((e: any) =>
            e.name && e.name.toLowerCase().includes(animal)
          );
          foodAnimalCount += found.length;
        }

        diagnostics.push(`📊 Entity Spawn Status:`);
        diagnostics.push(`  - Hostile mobs: ${hostiles.length}`);
        diagnostics.push(`  - Passive mobs (all): ${passives.length}`);
        diagnostics.push(`  - Food animals (cow/pig/chicken/sheep/rabbit): ${foodAnimalCount}`);

        if (hostiles.length > 0 && foodAnimalCount === 0) {
          diagnostics.push(`  ⚠️ WARNING: Food animals not spawning! Hostile mobs exist but no food sources.`);
          diagnostics.push(`  Note: ${passives.length} passive mobs detected (may be bats, squid, etc.)`);
          diagnostics.push(`  Possible cause: /gamerule doMobSpawning issue or passive mob spawning disabled`);
          diagnostics.push(`  Impact: Cannot obtain food from animals, wool for beds unavailable`);

          if (auto_fix) {
            botManager.chat(username, "/gamerule doMobSpawning true");
            diagnostics.push(`  🔧 Attempted fix: /gamerule doMobSpawning true`);
          }
        } else if (foodAnimalCount > 0) {
          diagnostics.push(`  ✅ Food animal spawning appears normal`);
        } else if (passives.length > 0) {
          diagnostics.push(`  ⚠️ Passive mobs exist but no food animals found (may be bats, squid, etc.)`);
        }
      } catch (error) {
        diagnostics.push(`  ❌ Failed to check entity spawning: ${error}`);
      }

      diagnostics.push("");

      // 2. Check item pickup (critical for survival)
      diagnostics.push(`📦 Item Pickup Test:`);
      try {
        const bot = botManager.getBot(username);
        if (!bot) {
          diagnostics.push(`  ⚠️ Bot not found, skipping item pickup test`);
        } else {
          // Try to find a safe block to test (dirt or similar)
          const testBlock = bot.findBlock({
            matching: (block: any) => ['dirt', 'grass_block', 'stone', 'cobblestone'].includes(block.name),
            maxDistance: 10,
          });

          if (testBlock) {
            const beforeCount = bot.inventory.items().length;

            // Dig the block
            await botManager.digBlock(username, testBlock.position.x, testBlock.position.y, testBlock.position.z);

            // Wait briefly for item pickup
            await new Promise(resolve => setTimeout(resolve, 500));

            const afterCount = bot.inventory.items().length;

            if (afterCount > beforeCount) {
              diagnostics.push(`  ✅ Item pickup working normally`);
            } else {
              // Check if item entity exists on ground
              const itemEntity = Object.values(bot.entities).find((e: any) =>
                e.name === 'item' && e.position && e.position.distanceTo(testBlock.position) < 2
              );

              if (itemEntity) {
                diagnostics.push(`  ❌ CRITICAL: Items spawn but CANNOT BE COLLECTED`);
                diagnostics.push(`  Possible causes:`);
                diagnostics.push(`    - Server plugin blocking item pickup (EssentialsX, WorldGuard)`);
                diagnostics.push(`    - Gamemode issue (adventure mode)`);
                diagnostics.push(`    - Server-side anti-cheat preventing collection`);
                diagnostics.push(`  Impact: **SURVIVAL GAMEPLAY IMPOSSIBLE** - cannot collect any resources`);

                if (auto_fix) {
                  botManager.chat(username, "/gamemode survival");
                  diagnostics.push(`  🔧 Attempted fix: /gamemode survival`);
                }
              } else {
                diagnostics.push(`  ⚠️ WARNING: Block broke but no item spawned`);
                diagnostics.push(`  Possible cause: /gamerule doTileDrops false`);
              }
            }
          } else {
            diagnostics.push(`  ⚠️ Could not find test block nearby, skipping item pickup test`);
          }
        }
      } catch (error) {
        diagnostics.push(`  ⚠️ Item pickup test failed: ${error}`);
      }

      diagnostics.push("");

      // 3. Check permissions
      diagnostics.push(`🔐 Permission Check:`);
      try {
        botManager.chat(username, "/gamerule");
        // Wait briefly to see if response comes
        await new Promise(resolve => setTimeout(resolve, 1000));
        const messages = botManager.getChatMessages(username, false);

        if (messages.length === 0) {
          diagnostics.push(`  ⚠️ WARNING: No response to /gamerule command`);
          diagnostics.push(`  Possible cause: Bot lacks OP permissions or is in LANmode with restricted commands`);
          diagnostics.push(`  Impact: Cannot verify or modify server gamerules`);

          if (auto_fix) {
            botManager.chat(username, `/op ${username}`);
            diagnostics.push(`  🔧 Attempted fix: /op ${username}`);
          }
        } else {
          diagnostics.push(`  ✅ Chat commands responding`);
        }
      } catch (error) {
        diagnostics.push(`  ❌ Failed to check permissions: ${error}`);
      }

      diagnostics.push("");

      // 4. Summary and recommendations
      diagnostics.push(`📋 Recommendations:`);
      diagnostics.push(`  1. Ensure bot has OP permissions: /op ${username}`);
      diagnostics.push(`  2. Verify mob spawning: /gamerule doMobSpawning (should be true)`);
      diagnostics.push(`  3. Verify item drops: /gamerule doTileDrops (should be true)`);
      diagnostics.push(`  4. Verify mob loot: /gamerule doMobLoot (should be true)`);
      diagnostics.push(`  5. Check server plugins that may block item pickup or mob spawning`);
      diagnostics.push(`  6. Test with vanilla Minecraft server to isolate configuration issues`);
      diagnostics.push(``);
      diagnostics.push(`💡 Run with auto_fix=true to attempt automatic fixes`);

      return diagnostics.join("\n");
    }

    default:
      throw new Error(`Unknown environment tool: ${name}`);
  }
}
