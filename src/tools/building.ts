import { botManager } from "../bot-manager.js";

export const buildingTools = {
  minecraft_place_block: {
    description: "Place a block from your inventory at the specified coordinates. You must have the block in your inventory!",
    inputSchema: {
      type: "object" as const,
      properties: {
        block_type: {
          type: "string",
          description: "Block from your inventory (e.g., 'cobblestone', 'oak_planks', 'dirt')",
        },
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
      required: ["block_type", "x", "y", "z"],
    },
  },

  minecraft_dig_block: {
    description: "Mine/dig a block at the specified coordinates. The block drops as an item to collect.",
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

  minecraft_collect_items: {
    description: "Collect dropped items nearby (within 10 blocks)",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
};

export async function handleBuildingTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const username = botManager.requireSingleBot();

  switch (name) {
    case "minecraft_place_block": {
      const blockType = args.block_type as string;
      const x = args.x as number;
      const y = args.y as number;
      const z = args.z as number;

      if (!blockType) {
        throw new Error("Block type is required");
      }

      // Always survival mode - must have block in inventory
      // Add validation and delay for all block types to ensure proper positioning
      // Torches need extra delay due to placement requirements
      const delay = blockType === 'torch' ? 2000 : 200;
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // For torches, add additional positioning delay to ensure bot is stable
      if (blockType === 'torch') {
        // Ensure bot is positioned optimally for torch placement
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Special validation for torch placement
      if (blockType === 'torch') {
        const bot = botManager.getBot(username);
        if (bot) {
          const blockBelow = bot.blockAt(new (bot as any).Vec3(x, y - 1, z));
          
          // Simplified torch validation - only check if there's a solid block below
          const hasSupportBelow = blockBelow && blockBelow.name !== 'air' && !blockBelow.name.includes('water') && !blockBelow.name.includes('lava') && blockBelow.type !== 0;
          
          if (!hasSupportBelow) {
            // Try to find the closest valid position below current position
            let foundValidPosition = false;
            for (let checkY = y - 1; checkY >= y - 3 && checkY >= 0; checkY--) {
              const checkBlock = bot.blockAt(new (bot as any).Vec3(x, checkY, z));
              if (checkBlock && checkBlock.name !== 'air' && !checkBlock.name.includes('water') && checkBlock.type !== 0) {
                const suggestedY = checkY + 1;
                throw new Error(`Cannot place torch at (${x}, ${y}, ${z}): no solid support below. Try position (${x}, ${suggestedY}, ${z}) instead.`);
              }
            }
            throw new Error(`Cannot place torch at (${x}, ${y}, ${z}): no solid block underneath. Torches require a solid block below for support.`);
          }
        }
      }
      
      // Validate target position is within reasonable range (4.5 blocks for better reliability)
      const bot = botManager.getBot(username);
      if (bot) {
        const distance = Math.sqrt(
          Math.pow(bot.entity.position.x - x, 2) + 
          Math.pow(bot.entity.position.y - y, 2) + 
          Math.pow(bot.entity.position.z - z, 2)
        );
        if (distance > 4.5) {
          throw new Error(`Target position (${x}, ${y}, ${z}) is too far away (${distance.toFixed(1)} blocks). Must be within 4.5 blocks for reliable placement.`);
        }
        
        // Check if target block is air before attempting placement
        const targetBlock = bot.blockAt(new (bot as any).Vec3(x, y, z));
        if (targetBlock && targetBlock.name !== 'air') {
          throw new Error(`Cannot place ${blockType} at (${x}, ${y}, ${z}): position is occupied by ${targetBlock.name}`);
        }
      }
      
      try {
        // Add pre-placement delay to ensure bot is stable
        await new Promise(resolve => setTimeout(resolve, 100));
        
        let result;
        try {
          // For torches, use manual placement without waiting for specific position events
          if (blockType === 'torch') {
            try {
              // For torches, skip event waiting completely and verify placement manually
              const bot = botManager.getBot(username);
              if (!bot) throw new Error('Bot not connected');
              
              // Get the item and target block
              const item = bot.inventory.items().find(i => i.name === blockType);
              if (!item) throw new Error(`No ${blockType} in inventory`);
              
              const targetBlock = bot.blockAt(new (bot as any).Vec3(x, y, z));
              if (!targetBlock) throw new Error('Target position not loaded');
              
              // Find reference block (floor or wall) for torch placement
              const blockBelow = bot.blockAt(new (bot as any).Vec3(x, y - 1, z));
              let referenceBlock = null;
              let referenceVec = null;
              
              if (blockBelow && blockBelow.name !== 'air') {
                referenceBlock = blockBelow;
                referenceVec = new (bot as any).Vec3(0, 1, 0); // place on top
              } else {
                // Check adjacent walls
                const adjacentPositions = [
                  {pos: new (bot as any).Vec3(x - 1, y, z), vec: new (bot as any).Vec3(1, 0, 0)},
                  {pos: new (bot as any).Vec3(x + 1, y, z), vec: new (bot as any).Vec3(-1, 0, 0)},
                  {pos: new (bot as any).Vec3(x, y, z - 1), vec: new (bot as any).Vec3(0, 0, 1)},
                  {pos: new (bot as any).Vec3(x, y, z + 1), vec: new (bot as any).Vec3(0, 0, -1)}
                ];
                
                for (const {pos, vec} of adjacentPositions) {
                  const block = bot.blockAt(pos);
                  if (block && block.name !== 'air') {
                    referenceBlock = block;
                    referenceVec = vec;
                    break;
                  }
                }
              }
              
              if (!referenceBlock) {
                throw new Error('No solid block found for torch placement');
              }
              
              // Place torch without waiting for events
              await bot.equip(item, 'hand');
              
              // Place torch with timeout handling
              try {
                await bot.placeBlock(referenceBlock, referenceVec);
              } catch (err: any) {
                // Ignore timeout errors for torches as they often place successfully
                // even when the blockUpdate event doesn't fire in time
                const errorMessage = err.message || err.toString() || '';
                if (!errorMessage.toLowerCase().includes('timeout') && !errorMessage.toLowerCase().includes('did not fire')) {
                  throw err;
                }
              }
              
              // Wait briefly then verify placement
              await new Promise(resolve => setTimeout(resolve, 500));
              
              // Check if torch was placed
              const checkPositions = [
                [x, y, z], [x + 1, y, z], [x - 1, y, z], 
                [x, y, z + 1], [x, y, z - 1], [x, y + 1, z]
              ];
              
              for (const [checkX, checkY, checkZ] of checkPositions) {
                const block = bot.blockAt(new (bot as any).Vec3(checkX, checkY, checkZ));
                if (block && (block.name === 'torch' || block.name === 'wall_torch')) {
                  result = {
                    success: true,
                    message: `Successfully placed torch at (${checkX}, ${checkY}, ${checkZ})`
                  };
                  break;
                }
              }
              
              if (!result) {
                throw new Error('Torch placement verification failed');
              }
            } catch (error) {
              // Always verify placement manually for torches
              await new Promise(resolve => setTimeout(resolve, 500));
              
              const bot = botManager.getBot(username);
              if (bot) {
                // Check the target position and nearby positions for torch placement
                const checkPositions = [
                  [x, y, z], [x + 1, y, z], [x - 1, y, z], 
                  [x, y, z + 1], [x, y, z - 1], [x, y + 1, z]
                ];
                
                for (const [checkX, checkY, checkZ] of checkPositions) {
                  try {
                    const block = bot.blockAt(new (bot as any).Vec3(checkX, checkY, checkZ));
                    if (block && (block.name === 'torch' || block.name === 'wall_torch' || block.name.includes('torch'))) {
                      result = {
                        success: true,
                        message: `Successfully placed torch at (${checkX}, ${checkY}, ${checkZ})`
                      };
                      break;
                    }
                  } catch (blockCheckError) {
                    continue;
                  }
                }
              }
              
              if (!result) {
                throw new Error(`Torch placement at (${x}, ${y}, ${z}) failed - no torch found after placement attempt`);
              }
            }
          } else {
            // Skip event waiting for all block types to avoid timeout issues
            const bot = botManager.getBot(username);
            if (!bot) throw new Error('Bot not connected');
            
            const item = bot.inventory.items().find(i => i.name === blockType);
            if (!item) throw new Error(`No ${blockType} in inventory`);
            
            const targetBlock = bot.blockAt(new (bot as any).Vec3(x, y, z));
            if (!targetBlock) throw new Error('Target position not loaded');
            
            // Find reference block for placement
            const blockBelow = bot.blockAt(new (bot as any).Vec3(x, y - 1, z));
            if (!blockBelow || blockBelow.name === 'air') {
              throw new Error('No solid block below for placement');
            }
            
            await bot.equip(item, 'hand');
            
            // Place block without waiting for events
            try {
              await bot.placeBlock(blockBelow, new (bot as any).Vec3(0, 1, 0));
              result = {
                success: true,
                message: `Successfully placed ${blockType} at (${x}, ${y}, ${z})`
              };
            } catch (err: any) {
              // For timeout errors, always verify placement manually
              const errorMessage = err.message || err.toString() || '';
              if (errorMessage.toLowerCase().includes('timeout') || errorMessage.toLowerCase().includes('did not fire')) {
                // Wait and verify
                await new Promise(resolve => setTimeout(resolve, 500));
                const placedBlock = bot.blockAt(new (bot as any).Vec3(x, y, z));
                if (placedBlock && placedBlock.name === blockType) {
                  result = {
                    success: true,
                    message: `Successfully placed ${blockType} at (${x}, ${y}, ${z}) (verified after timeout)`
                  };
                } else {
                  throw new Error(`Block placement timed out and verification failed for ${blockType} at (${x}, ${y}, ${z})`);
                }
              } else {
                throw err;
              }
            }
            
            // Wait briefly then verify placement
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const placedBlock = bot.blockAt(new (bot as any).Vec3(x, y, z));
            if (placedBlock && placedBlock.name === blockType) {
              result = {
                success: true,
                message: `Successfully placed ${blockType} at (${x}, ${y}, ${z})`
              };
            } else {
              throw new Error(`Failed to verify ${blockType} placement at (${x}, ${y}, ${z})`);
            }
          }
        } catch (error) {
          if (error instanceof Error && error.message.includes('timeout') && blockType !== 'torch') {
            // Wait longer for torch placement verification
            await new Promise(resolve => setTimeout(resolve, blockType === 'torch' ? 2000 : 1000));
            const bot = botManager.getBot(username);
            if (bot) {
              // For torches, check multiple possible attachment positions
              if (blockType === 'torch') {
                const checkPositions = [
                  // Target position (wall torch)
                  [x, y, z],
                  // Adjacent wall positions where torch might attach
                  [x + 1, y, z], [x - 1, y, z], [x, y, z + 1], [x, y, z - 1],
                  // Floor torch position (on top of support block)
                  [x, y, z], [x, y + 1, z]
                ];
                
                for (const [checkX, checkY, checkZ] of checkPositions) {
                  try {
                    const block = bot.blockAt(new (bot as any).Vec3(checkX, checkY, checkZ));
                    if (block && (block.name === 'torch' || block.name === 'wall_torch' || block.name.includes('torch'))) {
                      return `Successfully placed torch near (${x}, ${y}, ${z}) at actual position (${checkX}, ${checkY}, ${checkZ}) despite event timeout`;
                    }
                  } catch (blockCheckError) {
                    // Continue checking other positions
                    continue;
                  }
                }
                
                // Check a wider area around the target position for torch placement
                for (let dx = -1; dx <= 1; dx++) {
                  for (let dy = -1; dy <= 1; dy++) {
                    for (let dz = -1; dz <= 1; dz++) {
                      try {
                        const block = bot.blockAt(new (bot as any).Vec3(x + dx, y + dy, z + dz));
                        if (block && (block.name === 'torch' || block.name === 'wall_torch' || block.name.includes('torch'))) {
                          return `Successfully placed torch near (${x}, ${y}, ${z}) at actual position (${x + dx}, ${y + dy}, ${z + dz}) despite event timeout`;
                        }
                      } catch (blockCheckError) {
                        continue;
                      }
                    }
                  }
                }
                
                // For torch, try a different approach - suggest manual verification
                throw new Error(`Torch placement at (${x}, ${y}, ${z}) timed out. This may be due to lack of proper attachment surface. Torches need a solid block below (floor torch) or adjacent solid block (wall torch). Please verify if torch was placed and check inventory.`);
              } else {
                // For other blocks, check exact position
                const placedBlock = bot.blockAt(new (bot as any).Vec3(x, y, z));
                if (placedBlock && placedBlock.name === blockType) {
                  return `Successfully placed ${blockType} at (${x}, ${y}, ${z}) despite event timeout`;
                }
              }
            }
          }
          throw error;
        }
        
        if (!result.success) {
          throw new Error(`Failed to place block: ${result.message}`);
        }
        
        // Additional delay for all blocks to ensure placement is registered
        await new Promise(resolve => setTimeout(resolve, blockType === 'torch' ? 500 : 200));
        
        return result.message;
      } catch (error) {
        // Provide more context for timeout errors
        if (error instanceof Error && error.message.includes('timeout')) {
          // Special handling for torch placement
          if (blockType === 'torch') {
            throw new Error(`Torch placement failed at (${x}, ${y}, ${z}). Torches require a solid block underneath (y-1) or an adjacent wall. Try placing on solid ground or against a wall. The target position must be air and have proper support. Error: ${error.message}`);
          }
          throw new Error(`Block placement timed out at (${x}, ${y}, ${z}). The position might be occupied, out of reach, invalid, or lack required support blocks. Error: ${error.message}`);
        }
        throw error;
      }
    }

    case "minecraft_dig_block": {
      const x = args.x as number;
      const y = args.y as number;
      const z = args.z as number;

      // Check if bot is connected first
      const bot = botManager.getBot(username);
      if (!bot) {
        throw new Error("Not connected. Call minecraft_connect first.");
      }

      // Check if bot can navigate to target position
      if (bot) {
        const distance = Math.sqrt(
          Math.pow(bot.entity.position.x - x, 2) + 
          Math.pow(bot.entity.position.y - y, 2) + 
          Math.pow(bot.entity.position.z - z, 2)
        );
        
        // If too far, suggest movement instead of failing immediately
        if (distance > 6) {
          throw new Error(`Target position (${x}, ${y}, ${z}) is too far away (${distance.toFixed(1)} blocks). Use minecraft_move_to to get closer first, then try digging again. Current position: (${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.y.toFixed(1)}, ${bot.entity.position.z.toFixed(1)})`);
        }
        
        // Give bot time to position properly before mining
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      try {
        // Always survival mode - actually mine the block
        const result = await botManager.digBlock(username, x, y, z, false);
        return result;
      } catch (error) {
        if (error instanceof Error) {
          // Provide more helpful error messages for common mining issues
          if (error.message.includes('Cannot reach')) {
            throw new Error(`${error.message} Try moving closer to the target block.`);
          }
          if (error.message.includes('requires') && error.message.includes('pickaxe')) {
            // Extract block type and required tool from error message for better guidance
            const blockMatch = error.message.match(/Cannot mine (\w+)/);
            const toolMatch = error.message.match(/(\w+ pickaxe)/);
            const blockType = blockMatch ? blockMatch[1] : 'this block';
            const requiredTool = toolMatch ? toolMatch[1] : 'better pickaxe';
            throw new Error(`Cannot mine ${blockType} with current tool - requires ${requiredTool} or better! Craft the required tool first, then try mining again. ${error.message}`);
          }
        }
        throw error;
      }
    }

    case "minecraft_collect_items": {
      const result = await botManager.collectNearbyItems(username);
      return result;
    }

    default:
      throw new Error(`Unknown building tool: ${name}`);
  }
}
