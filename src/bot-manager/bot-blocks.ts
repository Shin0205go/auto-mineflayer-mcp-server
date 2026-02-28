import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import pkg from "mineflayer-pathfinder";
const { goals } = pkg;

import type { ManagedBot } from "./types.js";
import {
  requiresPickaxe,
  requiresAxe,
  requiresShovel,
  canPickaxeHarvest,
  getRequiredPickaxeTier,
} from "./minecraft-utils.js";
import { collectNearbyItems } from "./bot-items.js";

// ========== Block Manipulation Methods ==========

/**
 * Place a block at specified coordinates
 */
export async function placeBlock(
  managed: ManagedBot,
  blockType: string,
  x: number,
  y: number,
  z: number,
  useCommand: boolean = false,
  _delay: (ms: number) => Promise<void>,
  _getBriefStatus: (username: string) => string
): Promise<{ success: boolean; message: string }> {
  const bot = managed.bot;
  const targetPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
  const botPos = bot.entity.position;
  const distance = botPos.distanceTo(targetPos);
  const REACH_DISTANCE = 4.5;

  if (distance > REACH_DISTANCE) {
    // Try to move closer to the target position
    try {
      // Move to within reach distance of the target
      const goal = new goals.GoalNear(x, y, z, REACH_DISTANCE - 0.5);
      bot.pathfinder.setGoal(goal);

      // Wait for movement with timeout
      const startTime = Date.now();
      const timeout = 10000; // 10 seconds timeout

      while (bot.entity.position.distanceTo(targetPos) > REACH_DISTANCE && Date.now() - startTime < timeout) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      bot.pathfinder.setGoal(null);

      // Check if we're now within reach
      const newDistance = bot.entity.position.distanceTo(targetPos);
      if (newDistance > REACH_DISTANCE) {
        return {
          success: false,
          message: `Could not reach target. Distance: ${newDistance.toFixed(1)} blocks. Max reach is ${REACH_DISTANCE} blocks.`
        };
      }
    } catch (err) {
      return {
        success: false,
        message: `Target is too far (${distance.toFixed(1)} blocks). Failed to move closer: ${err}`
      };
    }
  }

  // Creative mode or OP: use /setblock command
  if (useCommand) {
    bot.chat(`/setblock ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)} ${blockType}`);
    return { success: true, message: `Placed ${blockType} at (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})` };
  }

  // Survival mode: use actual block from inventory
  const blockItem = bot.inventory.items().find(item =>
    item.name === blockType || item.name === blockType.replace("minecraft:", "")
  );

  if (!blockItem) {
    return {
      success: false,
      message: `No ${blockType} in inventory. Available blocks: ${
        bot.inventory.items()
          .map(i => `${i.name}(${i.count})`)
          .join(", ")
      }`
    };
  }

  // Equip the block
  try {
    await bot.equip(blockItem, "hand");
  } catch (err) {
    return { success: false, message: `Failed to equip ${blockType}: ${err}` };
  }

  // Find a reference block to place against
  const referenceBlock = findReferenceBlock(bot, targetPos);
  if (!referenceBlock) {
    // Check nearby blocks to suggest better placement location
    const nearbyBlocks = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          const checkPos = new Vec3(Math.floor(x) + dx, Math.floor(y) + dy, Math.floor(z) + dz);
          const block = bot.blockAt(checkPos);
          if (block && block.name !== "air" && block.name !== "water" && block.name !== "lava") {
            // Check if we can place on top of this block
            const abovePos = checkPos.offset(0, 1, 0);
            const aboveBlock = bot.blockAt(abovePos);
            if (aboveBlock && aboveBlock.name === "air") {
              nearbyBlocks.push(`${checkPos.x},${checkPos.y + 1},${checkPos.z} (on ${block.name})`);
              if (nearbyBlocks.length >= 3) break;
            }
          }
        }
        if (nearbyBlocks.length >= 3) break;
      }
      if (nearbyBlocks.length >= 3) break;
    }

    const suggestion = nearbyBlocks.length > 0
      ? ` Try these locations: ${nearbyBlocks.slice(0, 3).join(', ')}`
      : ' No suitable nearby locations found. You may need to place a block on the ground first.';

    return {
      success: false,
      message: `No adjacent block to place against at (${x}, ${y}, ${z}).${suggestion}`
    };
  }

  // Place the block
  try {
    await bot.placeBlock(referenceBlock.block, referenceBlock.faceVector);
  } catch (err: any) {
    // Ignore timeout errors, verify placement below
    const errMsg = err.message || String(err);
    if (!errMsg.includes('blockUpdate') && !errMsg.includes('timeout') && !errMsg.includes('did not fire') && !errMsg.includes('Event')) {
      return { success: false, message: `Failed to place block: ${err}` };
    }
  }

  // Seed items place as crop blocks with different names
  const seedToCropMap: Record<string, string> = {
    "wheat_seeds": "wheat",
    "beetroot_seeds": "beetroots",
    "melon_seeds": "melon_stem",
    "pumpkin_seeds": "pumpkin_stem",
  };
  const expectedBlockName = seedToCropMap[blockType] || blockType.replace("minecraft:", "");

  // Wait longer and verify placement multiple times
  await new Promise(resolve => setTimeout(resolve, 500));
  for (let i = 0; i < 3; i++) {
    const placedBlock = bot.blockAt(targetPos);
    if (placedBlock && (placedBlock.name === blockType || placedBlock.name === blockType.replace("minecraft:", "") || placedBlock.name === expectedBlockName)) {
      return { success: true, message: `Placed ${blockType} at (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})` };
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  const finalBlock = bot.blockAt(targetPos);
  // Check if the block placed is actually a crop from seeds
  if (finalBlock && finalBlock.name === expectedBlockName) {
    return { success: true, message: `Planted ${blockType} at (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}) → ${finalBlock.name} (age 0)` };
  }
  return { success: false, message: `Block not placed at (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}). Current block: ${finalBlock?.name || "unknown"}` };
}

function findReferenceBlock(bot: Bot, targetPos: Vec3): { block: any; faceVector: Vec3 } | null {
  // Check all 6 adjacent positions for a solid block to place against
  const faces = [
    { offset: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) },  // bottom
    { offset: new Vec3(0, 1, 0), face: new Vec3(0, -1, 0) },  // top
    { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) },  // west
    { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) },  // east
    { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },  // north
    { offset: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) },  // south
  ];

  for (const { offset, face } of faces) {
    const checkPos = targetPos.plus(offset);
    const block = bot.blockAt(checkPos);
    if (block && block.name !== "air" && block.name !== "water" && block.name !== "lava") {
      return { block, faceVector: face };
    }
  }

  return null;
}

/**
 * Get the expected item drop from breaking a block
 * @param blockName The name of the block being broken (e.g., "coal_ore")
 * @returns The expected drop item name (e.g., "coal"), or null if no specific drop expected
 */
function getExpectedDrop(blockName: string): string | null {
  // Blocks that drop different items than their block name
  const dropMappings: Record<string, string> = {
    // Ore blocks
    "coal_ore": "coal",
    "deepslate_coal_ore": "coal",
    "iron_ore": "raw_iron",
    "deepslate_iron_ore": "raw_iron",
    "gold_ore": "raw_gold",
    "deepslate_gold_ore": "raw_gold",
    "copper_ore": "raw_copper",
    "deepslate_copper_ore": "raw_copper",
    "diamond_ore": "diamond",
    "deepslate_diamond_ore": "diamond",
    "emerald_ore": "emerald",
    "deepslate_emerald_ore": "emerald",
    "lapis_ore": "lapis_lazuli",
    "deepslate_lapis_ore": "lapis_lazuli",
    "redstone_ore": "redstone",
    "deepslate_redstone_ore": "redstone",
    "nether_quartz_ore": "quartz",
    "nether_gold_ore": "gold_nugget",
    "ancient_debris": "ancient_debris",

    // Common blocks that don't drop themselves
    "stone": "cobblestone",
    "deepslate": "cobbled_deepslate",
    "grass_block": "dirt",
    "gravel": "gravel", // Can drop flint, but usually gravel
    "clay": "clay_ball",
    "glowstone": "glowstone_dust",
    "redstone_lamp": "redstone_lamp", // Drops itself
    "sea_lantern": "prismarine_crystals",
    "grass": "wheat_seeds", // ~12.5% chance to drop seeds
    "short_grass": "wheat_seeds", // 1.20+ renamed grass to short_grass
    "tall_grass": "wheat_seeds", // ~12.5% chance to drop seeds
    "fern": "wheat_seeds", // ~12.5% chance to drop seeds
    "large_fern": "wheat_seeds", // ~12.5% chance to drop seeds

    // Crop blocks - primary drops (mature crops drop both item + seeds)
    "wheat": "wheat", // Mature wheat (age 7) primary drop is wheat (food item), seeds are secondary
    "beetroots": "beetroot",
    "carrots": "carrot",
    "potatoes": "potato",
  };

  // If not in dropMappings, assume block drops itself (logs, planks, etc.)
  return dropMappings[blockName] || blockName;
}

/**
 * Dig a block at specified coordinates
 */
export async function digBlock(
  managed: ManagedBot,
  x: number,
  y: number,
  z: number,
  useCommand: boolean,
  delay: (ms: number) => Promise<void>,
  moveToBasic: (username: string, x: number, y: number, z: number) => Promise<{ success: boolean; message: string }>,
  getBriefStatus: (username: string) => string,
  autoCollect: boolean = true,
  force: boolean = false
): Promise<string> {
  const bot = managed.bot;
  const username = managed.username;

  // Check if bot is still connected
  if (!bot || !bot.entity) {
    return "Bot is not connected to the server. Please reconnect.";
  }

  const blockPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
  const block = bot.blockAt(blockPos);

  if (!block || block.name === "air") {
    return "No block at that position";
  }

  const blockName = block.name;

  // Check crop maturity before harvesting - immature crops only drop seeds, not the crop item
  const cropBlocks = ["wheat", "beetroots", "carrots", "potatoes"];
  if (cropBlocks.includes(blockName)) {
    try {
      const props = block.getProperties();
      const age = props?.age;
      const maxAge = blockName === "beetroots" ? 3 : 7; // beetroots max age is 3, others are 7
      if (age !== undefined && Number(age) < maxAge) {
        return `⚠️ ${blockName} is NOT mature (age=${age}/${maxAge}). Harvesting now will only give seeds, NOT the crop item. Wait for it to fully grow (age=${maxAge}) or apply bone_meal to speed up growth. Use minecraft_use_item_on_block with bone_meal on this block.`;
      }
    } catch (e) {
      // getProperties may fail on some versions, continue with dig
      console.error(`[Dig] Could not check crop maturity: ${e}`);
    }
  }

  // Check for lava in adjacent blocks before digging (skip if force=true)
  if (!force) {
    const adjacentPositions = [
      blockPos.offset(1, 0, 0), blockPos.offset(-1, 0, 0),
      blockPos.offset(0, 1, 0), blockPos.offset(0, -1, 0),
      blockPos.offset(0, 0, 1), blockPos.offset(0, 0, -1),
    ];
    for (const adjPos of adjacentPositions) {
      const adjBlock = bot.blockAt(adjPos);
      if (adjBlock?.name === "lava") {
        console.error(`[Dig] ⚠️ LAVA adjacent to target block at (${adjPos.x}, ${adjPos.y}, ${adjPos.z})`);
        return `🚨 警告: このブロックの隣に溶岩があります！掘ると溶岩が流れ込みます。別の場所を掘るか、水バケツで溶岩を固めてから掘ってください。溶岩位置: (${adjPos.x}, ${adjPos.y}, ${adjPos.z}). force=trueで強制的に掘ることも可能。`;
      }
    }
  }

  // Creative mode or OP: use command
  if (useCommand) {
    bot.chat(`/setblock ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)} air destroy`);
    return `Broke ${blockName} at (${x}, ${y}, ${z})`;
  }

  // Survival mode: actually dig the block
  let distance = bot.entity.position.distanceTo(blockPos);
  console.error(`[Dig] ${blockName} at (${x}, ${y}, ${z}), distance: ${distance.toFixed(1)}`);

  // Auto-move closer if too far (Minecraft survival reach is 4.5 blocks)
  const REACH_DISTANCE = 4.5;
  if (distance > REACH_DISTANCE) {
    console.error(`[Dig] Too far, moving closer...`);

    // Try multiple movement strategies
    let moved = false;

    // Calculate target position considering Y difference
    const yDiff = Math.abs(bot.entity.position.y - y);
    let targetRange = 3;
    if (yDiff > 2) {
      // If there's significant Y difference, get closer horizontally
      targetRange = 2;
    }

    // Configure pathfinder for better vertical movement
    bot.pathfinder.movements.scafoldingBlocks = bot.registry.blocksArray
      .filter(block => block.material && block.material === 'rock')
      .map(block => block.id);
    bot.pathfinder.movements.allowParkour = false; // Disable parkour for more predictable movement
    bot.pathfinder.movements.allowSprinting = false; // Disable sprinting to be more careful
    bot.pathfinder.movements.maxDropDown = 10; // Allow larger drops
    bot.pathfinder.movements.infiniteLiquidDropdownDistance = true; // Allow dropping into water from any height

    // First try: Get close with pathfinder
    // Temporarily enable digging to reach difficult blocks
    const originalCanDig = bot.pathfinder.movements.canDig;
    bot.pathfinder.movements.canDig = true;

    // For large Y differences, try to build/pillar up first
    if (yDiff > 2) {
      console.error(`[Dig] Large Y difference (${yDiff.toFixed(1)}), trying to build up/dig down...`);

      // Move horizontally closer first
      const horizontalGoal = new goals.GoalXZ(Math.floor(x), Math.floor(z));
      bot.pathfinder.setGoal(horizontalGoal);

      // Wait for horizontal movement
      const horizontalStart = Date.now();
      while (Date.now() - horizontalStart < 6000) {
        await delay(200);
        const horizontalDistance = Math.sqrt(
          Math.pow(bot.entity.position.x - x, 2) +
          Math.pow(bot.entity.position.z - z, 2)
        );
        if (horizontalDistance <= 3 || !bot.pathfinder.isMoving()) {
          break;
        }
      }
      bot.pathfinder.setGoal(null);

      // After getting horizontally closer, enable building to reach higher blocks
      // Note: scaffolding blocks are already set above
      bot.pathfinder.movements.blocksCantBreak.clear(); // Allow breaking blocks if needed
    }

    const goal = new goals.GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), targetRange);
    bot.pathfinder.setGoal(goal);

    // Wait for movement (max 15 seconds for difficult vertical movements)
    const startTime = Date.now();
    while (Date.now() - startTime < 15000) {
      await delay(200);
      distance = bot.entity.position.distanceTo(blockPos);
      if (distance <= REACH_DISTANCE) {
        moved = true;
        break;
      }
      if (!bot.pathfinder.isMoving()) {
        break;
      }
    }
    bot.pathfinder.setGoal(null);

    // Restore original digging setting
    bot.pathfinder.movements.canDig = originalCanDig;

    // Second try: If still too far, try direct movement
    if (!moved && distance > REACH_DISTANCE) {
      console.error(`[Dig] Pathfinder failed, trying direct movement...`);

      // Special handling for large Y differences
      const yDiff = Math.abs(bot.entity.position.y - y);
      if (yDiff > 3) {
        console.error(`[Dig] Large Y difference detected (${yDiff.toFixed(1)} blocks), trying vertical approach...`);

        // Try to move to a position horizontally aligned but at a better Y level
        // If block is above us, try to pillar up or find a higher position
        // If block is below us, get closer horizontally
        if (bot.entity.position.y < y) {
          // Block is above, try to get to same Y level
          const targetY = Math.min(y, bot.entity.position.y + 3);
          try {
            await moveToBasic(username, x, targetY, z);
            await delay(500);
            distance = bot.entity.position.distanceTo(blockPos);
            if (distance <= REACH_DISTANCE) {
              moved = true;
            }
          } catch (e) {
            console.error(`[Dig] Vertical upward approach failed: ${e}`);
          }
        } else {
          // Block is below, get closer horizontally first
          const horizontalDistance = Math.sqrt(
            Math.pow(bot.entity.position.x - x, 2) +
            Math.pow(bot.entity.position.z - z, 2)
          );
          if (horizontalDistance > 2) {
            try {
              // Move closer horizontally while maintaining current Y
              const direction = new Vec3(x - bot.entity.position.x, 0, z - bot.entity.position.z).normalize();
              const targetPos = bot.entity.position.plus(direction.scaled(horizontalDistance - 2));
              await moveToBasic(username, targetPos.x, bot.entity.position.y, targetPos.z);
              await delay(500);
              distance = bot.entity.position.distanceTo(blockPos);
              if (distance <= REACH_DISTANCE) {
                moved = true;
              }
            } catch (e) {
              console.error(`[Dig] Horizontal approach failed: ${e}`);
            }
          }
        }
      }

      if (!moved) {
        const direction = blockPos.minus(bot.entity.position).normalize();
        const targetPos = blockPos.minus(direction.scaled(3));

        try {
          await moveToBasic(username, targetPos.x, targetPos.y, targetPos.z);
          await delay(500);
          distance = bot.entity.position.distanceTo(blockPos);
          if (distance <= REACH_DISTANCE) {
            moved = true;
          }
        } catch (e) {
          console.error(`[Dig] Direct movement failed: ${e}`);
        }
      }
    }

    distance = bot.entity.position.distanceTo(blockPos);
    console.error(`[Dig] After moving, distance: ${distance.toFixed(1)}`);

    if (distance > REACH_DISTANCE) {
      // Try to find adjacent reachable position
      const offsets = [
        new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
        new Vec3(0, 0, 1), new Vec3(0, 0, -1),
        new Vec3(1, 0, 1), new Vec3(-1, 0, 1),
        new Vec3(1, 0, -1), new Vec3(-1, 0, -1),
        // Add Y-level variations
        new Vec3(0, 1, 0), new Vec3(0, -1, 0),
        new Vec3(1, 1, 0), new Vec3(-1, 1, 0),
        new Vec3(0, 1, 1), new Vec3(0, 1, -1)
      ];

      for (const offset of offsets) {
        const adjPos = blockPos.plus(offset);
        const adjBlock = bot.blockAt(adjPos);
        // Find an air block adjacent to target that we can stand near
        if (!adjBlock || adjBlock.name === "air") {
          try {
            await moveToBasic(username, adjPos.x, adjPos.y, adjPos.z);
            await delay(300);
            distance = bot.entity.position.distanceTo(blockPos);
            if (distance <= REACH_DISTANCE) {
              break;
            }
          } catch (e) {
            // Try next offset
          }
        }
      }

      if (distance > REACH_DISTANCE) {
        // Provide more detailed error information
        const yDiff = Math.abs(bot.entity.position.y - y);
        const horizontalDistance = Math.sqrt(
          Math.pow(bot.entity.position.x - x, 2) +
          Math.pow(bot.entity.position.z - z, 2)
        );

        if (yDiff > 10) {
          // Y difference too large
        } else if (horizontalDistance > 20) {
          // Horizontal distance too large
        }

        return `Cannot reach block at (${x}, ${y}, ${z}). Stopped ${distance.toFixed(1)} blocks away. Block may be unreachable.`;
      }
    }
  }

  // Check if block is diggable
  if (block.hardness < 0) {
    return `Cannot dig ${blockName} (unbreakable like bedrock)`;
  }

  // Save original held item to restore after digging
  const originalHeldItem = bot.heldItem;

  // Auto-equip the best tool for this block type (using dynamic registry check)
  let toolType: "pickaxe" | "axe" | "shovel" | null = null;
  if (requiresPickaxe(bot, blockName)) {
    toolType = "pickaxe";
  } else if (requiresAxe(bot, blockName)) {
    toolType = "axe";
  } else if (requiresShovel(bot, blockName)) {
    toolType = "shovel";
  }

  if (toolType) {
    const toolPriority = [
      `netherite_${toolType}`, `diamond_${toolType}`, `iron_${toolType}`, `stone_${toolType}`, `wooden_${toolType}`
    ];
    const inventory = bot.inventory.items();
    let equippedTool: string | null = null;
    for (const toolName of toolPriority) {
      const tool = inventory.find(i => i.name === toolName);
      if (tool) {
        try {
          await bot.equip(tool, "hand");
          equippedTool = toolName;
          console.error(`[Dig] Auto-equipped ${toolName} for ${blockName}`);
          // Verify tool was actually equipped
          const verifyHeld = bot.heldItem?.name;
          console.error(`[Dig] Verification: held item after equip = ${verifyHeld}`);
          if (verifyHeld !== toolName) {
            console.error(`[Dig] WARNING: Tool equip verification failed! Expected ${toolName}, got ${verifyHeld}`);
          }
          break;
        } catch (equipErr) {
          console.error(`[Dig] Failed to equip ${toolName}: ${equipErr}`);
        }
      }
    }

    // Check if tool is sufficient for this block (using dynamic registry check)
    // Warn but don't block mining - player can still dig without proper tool (just no drops)
    const blockData = bot.registry.blocksByName[blockName];
    const hasHarvestToolReq = blockData && blockData.harvestTools && Object.keys(blockData.harvestTools).length > 0;
    if (toolType === "pickaxe" && hasHarvestToolReq && equippedTool) {
      if (!canPickaxeHarvest(bot, blockName, equippedTool)) {
        const requiredTier = getRequiredPickaxeTier(bot, blockName);
        console.error(`[Dig] Warning: ${blockName} requires ${requiredTier || "better pickaxe"} for drops, have ${equippedTool}. Proceeding anyway.`);
      }
    } else if (toolType === "pickaxe" && hasHarvestToolReq && !equippedTool) {
      const requiredTier = getRequiredPickaxeTier(bot, blockName);
      console.error(`[Dig] Warning: ${blockName} requires ${requiredTier || "wooden_pickaxe"} for drops. No pickaxe equipped. Proceeding anyway.`);
    }
  }

  // Special case: If shears are equipped for non-leaves blocks, unequip them
  // Shears are only useful for leaves, wool, cobwebs - for wood logs, they prevent drops!
  if (bot.heldItem?.name === "shears") {
    const shearsUseful = blockName.includes("leaves") || blockName.includes("wool") ||
                        blockName.includes("cobweb") || blockName.includes("vine");
    if (!shearsUseful) {
      try {
        await bot.unequip("hand");
        console.error(`[Dig] Unequipped shears for ${blockName} - not useful for this block`);
      } catch (err) {
        console.error(`[Dig] Failed to unequip shears: ${err}`);
      }
    }
  }

  const heldItem = bot.heldItem?.name || "empty hand";
  const gameMode = bot.game?.gameMode || "unknown";
  console.error(`[Dig] Final held item check: ${heldItem}, block hardness: ${block.hardness}, gameMode: ${gameMode}`);

  try {
    // Get expected drop item name (e.g., coal_ore -> coal, diamond_ore -> diamond)
    const expectedDrop = getExpectedDrop(blockName);

    // Check if inventory is full - BLOCK mining to prevent item loss
    // UNLESS autoCollect is false (items will stay on ground for manual pickup)
    // Mineflayer inventory slots: 0=craft output, 1-4=craft grid, 5-8=armor,
    // 9-35=main inventory (27), 36-44=hotbar (9), 45=off-hand
    // Only count main inventory (9-35) + hotbar (36-44) = 36 usable slots
    const TOTAL_SLOTS = 36; // 27 main + 9 hotbar
    let usedSlots = 0;
    for (let slot = 9; slot <= 44; slot++) {
      if (bot.inventory.slots[slot] !== null) {
        usedSlots++;
      }
    }
    const emptySlots = TOTAL_SLOTS - usedSlots;
    console.error(`[Dig] Empty slots: ${emptySlots} (${usedSlots}/${TOTAL_SLOTS} used), autoCollect: ${autoCollect}`);

    // Check if expected drop can stack with existing items
    let canStack = false;
    if (expectedDrop) {
      const existingItems = bot.inventory.items().filter(i => i.name === expectedDrop);
      console.error(`[Dig] Found ${existingItems.length} stacks of ${expectedDrop}: ${existingItems.map(i => `${i.count}/${i.stackSize}`).join(', ')}`);

      // Check if ANY existing stack has room
      for (const item of existingItems) {
        const maxStackSize = item.stackSize || 64;
        if (item.count < maxStackSize) {
          canStack = true;
          console.error(`[Dig] Can stack into existing ${expectedDrop} (${item.count}/${maxStackSize})`);
          break;
        }
      }
    }

    const isFull = emptySlots === 0 && !canStack;

    // Only block mining if inventory is full AND autoCollect is enabled
    if (isFull && autoCollect) {
      // Provide helpful suggestions for common items that accumulate
      let suggestion = "Use minecraft_drop_item to free up space first, then try again. Or set auto_collect=false to leave items on ground.";
      if (expectedDrop === "cobblestone") {
        const cobblestoneCount = bot.inventory.items()
          .filter(i => i.name === "cobblestone")
          .reduce((sum, i) => sum + i.count, 0);
        if (cobblestoneCount > 100) {
          suggestion = `You have ${cobblestoneCount} cobblestone. Consider dropping excess cobblestone: minecraft_drop_item(item_name="cobblestone", count=${cobblestoneCount - 64})`;
        }
      }
      const errorMsg = `⚠️ CANNOT DIG: Inventory is FULL (${emptySlots} empty slots) and ${expectedDrop || 'item'} cannot stack! Items would drop and be lost. ${suggestion}`;
      console.error(`[Dig] ${errorMsg}`);
      return errorMsg;
    }

    const inventoryBefore = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
    // Snapshot full inventory for accurate "what was collected" reporting
    const inventorySnapshotBefore = new Map<string, number>();
    for (const item of bot.inventory.items()) {
      inventorySnapshotBefore.set(item.name, (inventorySnapshotBefore.get(item.name) || 0) + item.count);
    }
    // Count ALL stacks of the expected item, not just the first one
    const specificItemBefore = expectedDrop
      ? bot.inventory.items().filter(i => i.name === expectedDrop).reduce((sum, i) => sum + i.count, 0)
      : 0;

    // Check if bot can dig this block
    const canDig = bot.canDigBlock(block);
    const currentDistance = bot.entity.position.distanceTo(blockPos);
    console.error(`[Dig] canDigBlock: ${canDig}, current distance: ${currentDistance.toFixed(1)}`);

    if (!canDig) {
      // Get more specific error information
      const reasons = [];
      if (currentDistance > REACH_DISTANCE) {
        reasons.push(`too far (${currentDistance.toFixed(1)} blocks, max: ${REACH_DISTANCE})`);
      }
      if (block.shapes && block.shapes.length === 0) {
        reasons.push(`block has no collision shape`);
      }

      // Check tool requirements dynamically using registry
      const heldItem = bot.heldItem;
      const requiredTier = getRequiredPickaxeTier(bot, blockName);

      if (requiredTier && heldItem) {
        // Check if held pickaxe can harvest this block
        if (heldItem.name.includes("pickaxe")) {
          if (!canPickaxeHarvest(bot, blockName, heldItem.name)) {
            reasons.push(`requires ${requiredTier} or better (have: ${heldItem.name})`);
          }
        } else {
          reasons.push(`requires pickaxe (have: ${heldItem.name})`);
        }
      } else if (requiredTier && !heldItem) {
        reasons.push(`requires ${requiredTier} (have: empty hand)`);
      }

      // If the only reason is distance or tool, we might still be able to dig
      // Let's try anyway if we have the right tool
      if (reasons.length === 0 || (reasons.length === 1 && !reasons[0].includes('too far'))) {
        // Continue trying to dig even if canDig is false
      } else {
        return `Cannot dig ${blockName} at (${x}, ${y}, ${z}) - ${reasons.length > 0 ? reasons.join(', ') : 'unknown reason (may be protected)'}`;
      }
    }

    // Look at the block first
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));

    console.error(`[Dig] Starting to dig ${blockName}...`);
    const digTime = bot.digTime(block);
    console.error(`[Dig] Estimated dig time: ${digTime}ms`);

    // Stop all movements before digging to prevent "Digging aborted" error
    bot.clearControlStates();
    bot.pathfinder.setGoal(null);
    try { bot.stopDigging(); } catch (_) { /* ignore if not digging */ }

    // Wait until bot velocity is near zero (fully stopped)
    for (let waitTick = 0; waitTick < 20; waitTick++) {
      const vel = bot.entity.velocity;
      if (Math.abs(vel.x) < 0.01 && Math.abs(vel.y) < 0.01 && Math.abs(vel.z) < 0.01) break;
      bot.clearControlStates();
      await delay(100);
    }

    // Ensure bot is on ground before digging
    for (let groundTick = 0; groundTick < 20; groundTick++) {
      if (bot.entity.onGround) break;
      await delay(100);
    }

    // Re-check block exists before digging
    const blockBeforeDig = bot.blockAt(blockPos);
    if (!blockBeforeDig || blockBeforeDig.name === "air") {
      return `Block at (${x}, ${y}, ${z}) no longer exists`;
    }

    // Re-look at the block right before digging
    await bot.lookAt(blockBeforeDig.position.offset(0.5, 0.5, 0.5));
    await delay(50);

    try {
      await bot.dig(blockBeforeDig, true);  // forceLook = true
      console.error(`[Dig] Finished digging ${blockName}`);
    } catch (digError: any) {
      console.error(`[Dig] Dig failed: ${digError.message}`);

      // If digging was aborted, it might be due to movement or distance
      if (digError.message.includes("aborted")) {
        // Try once more after ensuring we're close and stable
        const currentDist = bot.entity.position.distanceTo(blockPos);
        if (currentDist > 4.5) {
          // Too far, need to get closer
          return `Failed to dig ${blockName}: Too far away (${currentDist.toFixed(1)} blocks). Move closer first.`;
        }

        // Clear movements again and retry
        bot.clearControlStates();
        bot.pathfinder.setGoal(null);
        try { bot.stopDigging(); } catch (_) { /* ignore if not digging */ }

        // Wait until bot velocity is near zero (fully stopped)
        for (let waitTick = 0; waitTick < 15; waitTick++) {
          const vel = bot.entity.velocity;
          if (Math.abs(vel.x) < 0.01 && Math.abs(vel.z) < 0.01) break;
          bot.clearControlStates();
          await delay(100);
        }

        // Re-check and re-acquire the block reference
        const blockRetry = bot.blockAt(blockPos);
        if (!blockRetry || blockRetry.name === "air") {
          return `Block at (${x}, ${y}, ${z}) no longer exists`;
        }

        try {
          await bot.lookAt(blockRetry.position.offset(0.5, 0.5, 0.5));
          await delay(50);
          await bot.dig(blockRetry, true);
          console.error(`[Dig] Retry successful for ${blockName}`);
        } catch (retryError: any) {
          return `Failed to dig ${blockName}: ${retryError.message}`;
        }
      } else {
        return `Failed to dig ${blockName}: ${digError.message}`;
      }
    }

    // Verify block is actually gone
    const blockAfter = bot.blockAt(blockPos);
    console.error(`[Dig] Block after dig: ${blockAfter?.name || "null"}`);
    if (blockAfter && blockAfter.name !== "air") {
      return `Dig seemed to complete but block is still there (${blockAfter.name}). May be protected area.`;
    }

    // Wait for item to spawn and stabilize (reduced from 2000ms - exponential backoff in collectNearbyItems handles late spawns)
    await delay(800);

    // Check for nearby item entities on the ground
    // Also scan all entities to diagnose server configuration issues
    const allNearbyEntities = Object.values(bot.entities)
      .filter(e => e && e.position && e.position.distanceTo(blockPos) < 5)
      .map(e => ({ name: e.name || 'unknown', type: e.type, distance: e.position.distanceTo(blockPos).toFixed(2) }));

    console.error(`[Dig] All entities within 5 blocks: ${JSON.stringify(allNearbyEntities)}`);

    // Find nearby item entities - check distance to BOTH blockPos AND bot position
    // Item entities sometimes have delayed/incorrect position updates
    // Use comprehensive detection matching collectNearbyItems logic (entity name varies by server)
    const nearbyItems = bot.nearestEntity(entity => {
      if (entity && entity !== bot.entity && entity.position && bot.entity.position) {
        const isItem = (
          entity.name === "item" ||
          entity.displayName === "Item" ||
          entity.displayName === "Dropped Item" ||
          entity.type === "object"
        );
        if (!isItem) return false;
        const distToBlock = entity.position.distanceTo(blockPos);
        const distToBot = entity.position.distanceTo(bot.entity.position);
        // Accept items within 5 blocks of block OR within 3 blocks of bot
        return distToBlock < 5 || distToBot < 3;
      }
      return false;
    });

    if (nearbyItems) {
      console.error(`[Dig] Found item entity on ground within 3 blocks, attempting collection...`);
    } else {
      console.error(`[Dig] ⚠️ NO ITEM ENTITIES found within 3 blocks of mined block!`);
      console.error(`[Dig] This suggests server has item drops disabled via:`);
      console.error(`[Dig]   1. /gamerule doTileDrops false (blocks don't drop)`);
      console.error(`[Dig]   2. /gamerule doMobLoot false (mobs don't drop)`);
      console.error(`[Dig]   3. Server plugin blocking drops`);
      console.error(`[Dig]   4. Item despawn rate set to 0 (instant despawn)`);
    }

    // Check inventory immediately - items within 1 block are auto-collected
    let inventoryAfter = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
    let pickedUp = inventoryAfter - inventoryBefore;
    // Count ALL stacks of the expected item, not just the first one
    let specificItemAfter = expectedDrop
      ? bot.inventory.items().filter(i => i.name === expectedDrop).reduce((sum, i) => sum + i.count, 0)
      : 0;
    let specificItemGained = specificItemAfter - specificItemBefore;
    console.error(`[Dig] Inventory check (immediate): before=${inventoryBefore}, after=${inventoryAfter}, picked=${pickedUp}, ${expectedDrop}: ${specificItemBefore}->${specificItemAfter} (+${specificItemGained})`);

    // If nothing picked up yet and auto-collect is enabled, use the proven collectNearbyItems function
    if (autoCollect && pickedUp === 0 && specificItemGained === 0) {
      console.error(`[Dig] No items auto-collected, using collectNearbyItems()...`);

      // First, move to the block position to get closer to items
      // Items may have spawned at or near the mined block position
      const distToBlock = bot.entity.position.distanceTo(blockPos);
      console.error(`[Dig] Distance to mined block: ${distToBlock.toFixed(2)}`);

      if (distToBlock > 1.5) {
        console.error(`[Dig] Moving closer to mined block position for better item pickup...`);
        try {
          // Move right to the mined block position (now air)
          const goal = new goals.GoalBlock(blockPos.x, blockPos.y, blockPos.z);
          bot.pathfinder.setGoal(goal);

          const moveStart = Date.now();
          while (Date.now() - moveStart < 3000) {
            await delay(100);
            if (bot.entity.position.distanceTo(blockPos) < 1.5) break;
            if (!bot.pathfinder.isMoving()) break;
          }
          bot.pathfinder.setGoal(null);

          // Wait longer for auto-pickup to trigger now that we're closer
          await delay(1000);
          console.error(`[Dig] Moved to mined block, new distance: ${bot.entity.position.distanceTo(blockPos).toFixed(2)}`);
        } catch (moveErr) {
          console.error(`[Dig] Failed to move closer: ${moveErr}`);
        }
      }

      // Try a second collection pass with more aggressive movement
      // Walk in a small circle around the mined block position
      console.error(`[Dig] Trying aggressive collection: walking around mined block position...`);
      const circlePositions = [
        blockPos.offset(1, 0, 0),
        blockPos.offset(0, 0, 1),
        blockPos.offset(-1, 0, 0),
        blockPos.offset(0, 0, -1)
      ];

      for (const pos of circlePositions) {
        try {
          const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 0.5);
          bot.pathfinder.setGoal(goal);
          await delay(800);
          bot.pathfinder.setGoal(null);
        } catch (_) {
          // Ignore movement errors
        }
      }
      await delay(500);

      const collectResult = await collectNearbyItems(managed);
      console.error(`[Dig] collectNearbyItems result: ${collectResult}`);

      // Wait for collection to complete
      await delay(1000);

      // Re-check inventory after collection
      inventoryAfter = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
      pickedUp = inventoryAfter - inventoryBefore;
      // Count ALL stacks of the expected item, not just the first one
      specificItemAfter = expectedDrop
        ? bot.inventory.items().filter(i => i.name === expectedDrop).reduce((sum, i) => sum + i.count, 0)
        : 0;
      specificItemGained = specificItemAfter - specificItemBefore;
      console.error(`[Dig] Inventory check (after collectNearbyItems): picked=${pickedUp}, ${expectedDrop}: +${specificItemGained}`);
    } else if (!autoCollect) {
      console.error(`[Dig] Auto-collect disabled, skipping item collection`);
    }

    if (pickedUp > 0 || specificItemGained > 0) {
      if (specificItemGained > 0) {
        return `Dug ${blockName} with ${heldItem} and picked up ${specificItemGained} ${expectedDrop}!` + getBriefStatus(username);
      } else {
        // Picked up items, but NOT the expected drop — show what was actually collected
        const actuallyGained: string[] = [];
        for (const item of bot.inventory.items()) {
          const before = inventorySnapshotBefore.get(item.name) || 0;
          const gained = item.count - before;
          if (gained > 0) actuallyGained.push(`${item.name} x${gained}`);
        }
        const gainedStr = actuallyGained.length > 0 ? actuallyGained.join(", ") : `${pickedUp} item(s)`;
        return `Dug ${blockName} with ${heldItem} but ${expectedDrop} did NOT drop! Collected nearby: ${gainedStr}. Server may have item drops disabled (doTileDrops/doMobLoot).` + getBriefStatus(username);
      }
    }

    // Check if we expected drops but got none
    const oresNeedingPickaxe = ["_ore", "stone", "cobblestone", "deepslate"];
    const isOre = oresNeedingPickaxe.some(s => blockName.includes(s));
    const hasPickaxe = heldItem.includes("pickaxe");

    // If we used correct tool but still got no drops, check inventory fullness first
    if (isOre && hasPickaxe && pickedUp === 0 && specificItemGained === 0) {
      // Re-check inventory fullness at this point (inventory state may have changed)
      const currentEmptySlots = TOTAL_SLOTS - (() => {
        let used = 0;
        for (let slot = 9; slot <= 44; slot++) {
          if (bot.inventory.slots[slot] !== null) used++;
        }
        return used;
      })();

      // Re-check if expected drop can stack
      let currentCanStack = false;
      if (expectedDrop) {
        const existingItems = bot.inventory.items().filter(i => i.name === expectedDrop);
        for (const item of existingItems) {
          const maxStackSize = item.stackSize || 64;
          if (item.count < maxStackSize) {
            currentCanStack = true;
            break;
          }
        }
      }

      const currentIsFull = currentEmptySlots === 0 && !currentCanStack;

      if (currentIsFull) {
        return `⚠️ WARNING: Dug ${blockName} but items couldn't be collected because inventory is FULL (${currentEmptySlots} empty slots) and ${expectedDrop || 'items'} cannot stack! Items may have dropped on the ground - free up inventory space with minecraft_drop_item, then use minecraft_collect_items to pick them up!` + getBriefStatus(username);
      }

      // Check if item entities spawned on the ground
      if (nearbyItems) {
        const itemPos = nearbyItems.position ? nearbyItems.position.toString() : 'unknown';
        const itemDist = nearbyItems.position ? nearbyItems.position.distanceTo(bot.entity.position).toFixed(2) : '?';
        console.error(`[Dig] ⚠️ Items spawned but not auto-collected (at ${itemPos}, ${itemDist}m) - may have been picked up by another bot or need manual collection`);
        // Return success message since block was actually mined successfully
        return `✅ Dug ${blockName} with ${heldItem}. ⚠️ NOTE: Items dropped at ${itemPos} (${itemDist}m away) but weren't auto-collected. Try minecraft_collect_items() or move closer.` + getBriefStatus(username);
      }

      // No item entities found - server configuration issue
      // Provide actionable diagnosis
      const entityCount = Object.keys(bot.entities).length;
      const nearbyEntityList = allNearbyEntities.length > 0
        ? allNearbyEntities.map(e => `${e.name}(${e.distance}m)`).join(', ')
        : 'none';

      console.error(`[Dig] ⚠️ Server config issue: No item entity spawned after mining ${blockName}. Entities=${entityCount}, nearby=${nearbyEntityList}`);
      // Return success message since block was actually mined successfully
      return `✅ Dug ${blockName} with ${heldItem}. ⚠️ NOTE: No items dropped due to server configuration (likely doTileDrops=false or plugin blocking drops). Block mining works but no resources obtained.` + getBriefStatus(username);
    }

    if (isOre && !hasPickaxe) {
      return `WARNING: Dug ${blockName} with ${heldItem} but NO ITEM DROPPED! Need pickaxe for ore/stone!` + getBriefStatus(username);
    }

    // Restore original held item if it was changed
    if (originalHeldItem && bot.heldItem?.name !== originalHeldItem.name) {
      try {
        await bot.equip(originalHeldItem, "hand");
        console.error(`[Dig] Restored original held item: ${originalHeldItem.name}`);
      } catch (equipErr) {
        console.error(`[Dig] Failed to restore original item: ${equipErr}`);
      }
    }

    return `Dug ${blockName} with ${heldItem}. ${pickedUp === 0 ? 'No items dropped (auto-collected or wrong tool).' : ''}` + getBriefStatus(username);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Dig] Error: ${errMsg}`);
    return `Failed to dig ${blockName}: ${errMsg}`;
  }
}

/**
 * Level ground in an area - dig blocks above target height and fill holes below
 */
export async function levelGround(
  managed: ManagedBot,
  options: {
    centerX: number;
    centerZ: number;
    radius: number;
    targetY?: number;
    fillBlock?: string;
    mode: "dig" | "fill" | "both";
  },
  delay: (ms: number) => Promise<void>,
  collectNearbyItems: (username: string) => Promise<string>,
  getBriefStatus: (username: string) => string
): Promise<string> {
  const bot = managed.bot;
  const username = managed.username;
  const { centerX, centerZ, radius, mode } = options;
  let { targetY, fillBlock } = options;

  // Step 1: Scan area and determine target Y if not specified
  const blockHeights: Map<number, number> = new Map(); // y -> count
  const blocksToProcess: Array<{ x: number; y: number; z: number; action: "dig" | "fill" }> = [];

  console.error(`[LevelGround] Scanning area: center=(${centerX}, ${centerZ}), radius=${radius}`);

  // Scan area to find ground heights
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const x = Math.floor(centerX + dx);
      const z = Math.floor(centerZ + dz);

      // Find highest solid block at this position (scan from top down)
      for (let y = 100; y >= -60; y--) {
        const block = bot.blockAt(new Vec3(x, y, z));
        if (block && block.name !== "air" && !block.name.includes("leaves") && !block.name.includes("log")) {
          const count = blockHeights.get(y) || 0;
          blockHeights.set(y, count + 1);
          break;
        }
      }
    }
  }

  // Auto-detect target Y: most common ground level
  if (targetY === undefined) {
    let maxCount = 0;
    for (const [y, count] of blockHeights) {
      if (count > maxCount) {
        maxCount = count;
        targetY = y;
      }
    }
    console.error(`[LevelGround] Auto-detected targetY: ${targetY} (${maxCount} blocks at this level)`);
  }

  if (targetY === undefined) {
    return "Failed to detect ground level. Please specify target_y manually.";
  }

  // Step 2: Identify blocks to dig and positions to fill
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const x = Math.floor(centerX + dx);
      const z = Math.floor(centerZ + dz);

      // Check blocks above targetY (to dig)
      if (mode === "dig" || mode === "both") {
        for (let y = targetY + 1; y <= targetY + 10; y++) {
          const block = bot.blockAt(new Vec3(x, y, z));
          if (block && block.name !== "air" && !block.name.includes("bedrock")) {
            blocksToProcess.push({ x, y, z, action: "dig" });
          }
        }
      }

      // Check if position at targetY needs filling
      if (mode === "fill" || mode === "both") {
        const blockAtTarget = bot.blockAt(new Vec3(x, targetY, z));
        if (!blockAtTarget || blockAtTarget.name === "air" || blockAtTarget.name.includes("water")) {
          blocksToProcess.push({ x, y: targetY, z, action: "fill" });
        }
      }
    }
  }

  // Sort: dig from top to bottom, fill from bottom
  blocksToProcess.sort((a, b) => {
    if (a.action === "dig" && b.action === "dig") return b.y - a.y; // Top to bottom
    if (a.action === "fill" && b.action === "fill") return a.y - b.y; // Bottom to top
    return a.action === "dig" ? -1 : 1; // Dig before fill
  });

  console.error(`[LevelGround] Found ${blocksToProcess.length} blocks to process`);

  // Auto-select fill block from inventory if not specified
  if ((mode === "fill" || mode === "both") && !fillBlock) {
    const fillCandidates = ["dirt", "cobblestone", "stone", "sand", "gravel"];
    for (const candidate of fillCandidates) {
      const item = bot.inventory.items().find(i => i.name === candidate);
      if (item && item.count > 0) {
        fillBlock = candidate;
        console.error(`[LevelGround] Auto-selected fill block: ${fillBlock}`);
        break;
      }
    }
  }

  // Step 3: Process blocks
  let dugCount = 0;
  let filledCount = 0;
  let errorCount = 0;
  const maxErrors = 5;

  for (const task of blocksToProcess) {
    if (errorCount >= maxErrors) {
      console.error(`[LevelGround] Too many errors, stopping`);
      break;
    }

    try {
      // Move to position if too far
      const distance = Math.sqrt(
        Math.pow(bot.entity.position.x - task.x, 2) +
        Math.pow(bot.entity.position.z - task.z, 2)
      );

      if (distance > 4) {
        const goal = new goals.GoalNear(task.x, task.y, task.z, 2);
        bot.pathfinder.setGoal(goal);
        await delay(2000);
        bot.pathfinder.setGoal(null);
      }

      if (task.action === "dig") {
        const block = bot.blockAt(new Vec3(task.x, task.y, task.z));
        if (block && block.name !== "air") {
          await bot.dig(block);
          dugCount++;
        }
      } else if (task.action === "fill" && fillBlock) {
        const item = bot.inventory.items().find(i => i.name === fillBlock);
        if (item) {
          await bot.equip(item, "hand");
          const blockBelow = bot.blockAt(new Vec3(task.x, task.y - 1, task.z));
          if (blockBelow && blockBelow.name !== "air") {
            try {
              await bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
              filledCount++;
            } catch {
              // Ignore placement errors
            }
          }
        }
      }

      // Brief delay between operations
      await delay(100);

    } catch (err) {
      errorCount++;
      console.error(`[LevelGround] Error at (${task.x}, ${task.y}, ${task.z}): ${err}`);
    }
  }

  // Collect dropped items
  await collectNearbyItems(username);

  const result = `Leveled ground at (${centerX}, ${centerZ}) radius ${radius}, targetY=${targetY}. ` +
    `Dug: ${dugCount} blocks, Filled: ${filledCount} blocks` +
    (errorCount > 0 ? `, Errors: ${errorCount}` : "");

  return result + getBriefStatus(username);
}

/**
 * Activate/interact with a block (doors, buttons, chests, etc.)
 */
export async function activateBlock(
  managed: ManagedBot,
  x: number,
  y: number,
  z: number,
  moveTo: (username: string, x: number, y: number, z: number) => Promise<string>
): Promise<string> {
  const bot = managed.bot;
  const username = managed.username;
  const pos = new Vec3(x, y, z);
  const block = bot.blockAt(pos);

  if (!block) {
    throw new Error(`No block at (${x}, ${y}, ${z})`);
  }

  const interactableBlocks = [
    "button", "lever", "door", "trapdoor", "gate",
    "chest", "barrel", "shulker", "hopper", "dropper", "dispenser",
    "note_block", "jukebox", "bell", "respawn_anchor",
    "crafting_table", "furnace", "blast_furnace", "smoker",
    "brewing_stand", "anvil", "grindstone", "stonecutter",
    "loom", "cartography_table", "smithing_table"
  ];

  const isInteractable = interactableBlocks.some(name => block.name.includes(name));
  if (!isInteractable) {
    console.error(`[ActivateBlock] Warning: ${block.name} may not be interactable`);
  }

  const dist = bot.entity.position.distanceTo(pos);
  if (dist > 5) {
    // Move closer first
    await moveTo(username, x, y, z);
  }

  try {
    await bot.activateBlock(block);
    return `Activated ${block.name} at (${x}, ${y}, ${z}).`;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to activate ${block.name}: ${errMsg}`);
  }
}

/**
 * Validate nether portal interior for non-air blocks
 * Returns array of non-air block descriptions found inside portal frame
 */
function validatePortalInterior(bot: any, frameBlocks: Vec3[]): string[] {
  if (frameBlocks.length < 10) {
    return [`[PORTAL DEBUG] Frame too small (${frameBlocks.length} blocks), need at least 10 obsidian for valid portal`];
  }

  // Detect portal orientation by checking if frame blocks share X or Z coordinates
  const xCoords = [...new Set(frameBlocks.map(b => b.x))];
  const zCoords = [...new Set(frameBlocks.map(b => b.z))];

  // Portal is X-aligned if it has 2 distinct X coords (portal spans X axis)
  // Portal is Z-aligned if it has 2 distinct Z coords (portal spans Z axis)
  const isXAligned = xCoords.length === 2 && zCoords.length >= 3;
  const isZAligned = zCoords.length === 2 && xCoords.length >= 3;

  if (!isXAligned && !isZAligned) {
    return [`[PORTAL DEBUG] Cannot determine portal orientation. X coords: ${xCoords.length}, Z coords: ${zCoords.length}`];
  }

  // Get interior bounds
  const minX = Math.min(...frameBlocks.map(b => b.x));
  const maxX = Math.max(...frameBlocks.map(b => b.x));
  const minY = Math.min(...frameBlocks.map(b => b.y));
  const maxY = Math.max(...frameBlocks.map(b => b.y));
  const minZ = Math.min(...frameBlocks.map(b => b.z));
  const maxZ = Math.max(...frameBlocks.map(b => b.z));

  const nonAirBlocks: string[] = [];

  // Check interior coordinates (excluding frame edges)
  if (isXAligned) {
    // Portal spans X axis, interior is between the two X coordinates
    const interiorX = minX + 1;
    for (let y = minY + 1; y < maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        const block = bot.blockAt(new Vec3(interiorX, y, z));
        if (block && block.name !== "air" && block.name !== "nether_portal") {
          nonAirBlocks.push(`(${interiorX},${y},${z}):${block.name}`);
        }
      }
    }
  } else if (isZAligned) {
    // Portal spans Z axis, interior is between the two Z coordinates
    const interiorZ = minZ + 1;
    for (let y = minY + 1; y < maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const block = bot.blockAt(new Vec3(x, y, interiorZ));
        if (block && block.name !== "air" && block.name !== "nether_portal") {
          nonAirBlocks.push(`(${x},${y},${interiorZ}):${block.name}`);
        }
      }
    }
  }

  return nonAirBlocks;
}

/**
 * Use an item on a block (bucket on water/lava, flint_and_steel, bone_meal, etc.)
 */
export async function useItemOnBlock(
  managed: ManagedBot,
  x: number,
  y: number,
  z: number,
  itemName: string,
  moveTo: (username: string, x: number, y: number, z: number) => Promise<string>
): Promise<string> {
  const bot = managed.bot;
  const username = managed.username;
  const pos = new Vec3(x, y, z);

  // Find and equip the item
  const item = bot.inventory.items().find(i => i.name === itemName);
  if (!item) {
    const inventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";
    throw new Error(`No ${itemName} in inventory. Have: ${inventory}`);
  }
  await bot.equip(item, "hand");

  // Move closer if needed
  const dist = bot.entity.position.distanceTo(pos);
  if (dist > 5) {
    await moveTo(username, x, y, z);
  }

  const block = bot.blockAt(pos);
  if (!block) {
    throw new Error(`No block at (${x}, ${y}, ${z})`);
  }

  try {
    // Look at the block first
    await bot.lookAt(pos.offset(0.5, 0.5, 0.5));
    await new Promise(resolve => setTimeout(resolve, 100));

    // DEBUG: Always log block name for bucket and bone_meal operations
    if (itemName === "bucket" || itemName === "water_bucket" || itemName === "lava_bucket" || itemName === "bone_meal") {
      console.log(`[DEBUG useItemOnBlock] Item "${itemName}" on block: "${block.name}" (type: ${block.type}) at (${x},${y},${z})`);
    }

    // For buckets on liquid blocks, use _genericPlace to collect water/lava
    // This sends the proper block_place packet with all required fields (including sequence)
    if (itemName === "bucket" && (block.name === "water" || block.name === "flowing_water" || block.name === "lava" || block.name === "flowing_lava")) {
      const initialItem = bot.heldItem?.name;
      console.log(`[DEBUG] Initial item: ${initialItem}, collecting ${block.name} at (${x},${y},${z})`);

      const expectedBucket = (block.name === "water" || block.name === "flowing_water") ? "water_bucket" : "lava_bucket";
      let collected = false;

      // Attempt 1: activateItem (use_item packet) - primary method for bucket on liquid
      // In Minecraft, buckets on liquid work by right-clicking in the air while looking at the liquid
      try {
        console.log(`[DEBUG] Attempt 1: activateItem (use_item) while looking at ${block.name}`);
        await bot.lookAt(pos.offset(0.5, 0.5, 0.5));
        await new Promise(resolve => setTimeout(resolve, 300));
        bot.activateItem(false); // main hand - sends use_item packet
        await new Promise(resolve => setTimeout(resolve, 2000));
        collected = !!bot.inventory.items().find(i => i.name === expectedBucket);
        console.error(`[DEBUG] activateItem (Attempt 1): collected=${collected}`);
      } catch (e) {
        console.error(`[DEBUG] activateItem failed: ${e}`);
        await new Promise(resolve => setTimeout(resolve, 500));
        collected = !!bot.inventory.items().find(i => i.name === expectedBucket);
        if (collected) {
          console.log(`[DEBUG] activateItem errored but bucket collected successfully`);
        }
      }

      // Attempt 2: bot.placeBlock on the liquid block directly (correct method for 1.21+)
      if (!collected) {
        try {
          console.error(`[DEBUG] Attempt 2: bot.placeBlock on liquid ${block.name}...`);
          await bot.lookAt(pos.offset(0.5, 0.5, 0.5));
          await new Promise(resolve => setTimeout(resolve, 200));
          await bot.placeBlock(block, new Vec3(0, 1, 0));
          await new Promise(resolve => setTimeout(resolve, 1500));
          collected = !!bot.inventory.items().find(i => i.name === expectedBucket);
          console.error(`[DEBUG] bot.placeBlock on liquid: collected=${collected}`);
        } catch (e) {
          console.error(`[DEBUG] bot.placeBlock on liquid failed: ${e}`);
          await new Promise(resolve => setTimeout(resolve, 500));
          collected = !!bot.inventory.items().find(i => i.name === expectedBucket);
          if (collected) {
            console.log(`[DEBUG] bot.placeBlock errored but bucket collected successfully`);
          }
        }
      }

      // Attempt 3: activateItem while looking at the liquid
      if (!collected) {
        try {
          console.error(`[DEBUG] Attempt 3: activateItem while looking at ${block.name}...`);
          await bot.lookAt(pos.offset(0.5, 0.5, 0.5));
          await new Promise(resolve => setTimeout(resolve, 200));
          bot.activateItem();
          await new Promise(resolve => setTimeout(resolve, 500));
          bot.deactivateItem();
          await new Promise(resolve => setTimeout(resolve, 1000));
          collected = !!bot.inventory.items().find(i => i.name === expectedBucket);
          console.error(`[DEBUG] activateItem attempt: collected=${collected}`);
        } catch (e) {
          console.error(`[DEBUG] activateItem failed: ${e}`);
        }
      }

      // Attempt 4: use_item packet with different look angle
      if (!collected) {
        try {
          console.error(`[DEBUG] Attempt 4: use_item packet while looking at liquid top surface...`);
          await bot.lookAt(pos.offset(0.5, 1.0, 0.5)); // Look at top surface
          await new Promise(resolve => setTimeout(resolve, 300));
          bot.activateItem(false); // false = main hand
          await new Promise(resolve => setTimeout(resolve, 2000));
          collected = !!bot.inventory.items().find(i => i.name === expectedBucket);
          console.error(`[DEBUG] use_item (Attempt 4) attempt: collected=${collected}`);
        } catch (e) {
          console.error(`[DEBUG] direct use_item_on failed: ${e}`);
        }
      }

      // Attempt 5: Direct block_place packet on liquid block (1.21.3+ with worldBorderHit)
      if (!collected) {
        try {
          console.error(`[DEBUG] Attempt 5: Direct block_place packet on liquid block...`);
          await bot.lookAt(pos.offset(0.5, 1.0, 0.5));
          await new Promise(resolve => setTimeout(resolve, 300));
          // For 1.21.3+, block_place needs worldBorderHit field
          (bot as any)._client.write('block_place', {
            location: pos,
            direction: 1, // top face
            hand: 0,
            cursorX: 0.5,
            cursorY: 1.0,
            cursorZ: 0.5,
            insideBlock: false,
            sequence: 0,
            worldBorderHit: false
          });
          await new Promise(resolve => setTimeout(resolve, 2000));
          collected = !!bot.inventory.items().find(i => i.name === expectedBucket);
          console.error(`[DEBUG] block_place (Attempt 5) attempt: collected=${collected}`);
        } catch (e) {
          console.error(`[DEBUG] block_place Attempt 5 failed: ${e}`);
        }
      }

      // Attempt 6: Move bot INTO the liquid block position and use activateItem
      if (!collected) {
        try {
          console.error(`[DEBUG] Attempt 6: Move into liquid and use activateItem...`);
          // Move very close (same Y level as liquid)
          await bot.lookAt(pos.offset(0.5, 0.5, 0.5));
          await new Promise(resolve => setTimeout(resolve, 200));
          // Try activateItem from close range
          bot.activateItem(false);
          await new Promise(resolve => setTimeout(resolve, 2000));
          collected = !!bot.inventory.items().find(i => i.name === expectedBucket);
          console.error(`[DEBUG] Attempt 6: collected=${collected}`);
        } catch (e) {
          console.error(`[DEBUG] Attempt 6 failed: ${e}`);
        }
      }
    } else if (itemName === "water_bucket" && (block.name === "lava" || block.name === "flowing_lava")) {
      // Special case: water_bucket on lava source → right-click lava directly to place water (creates obsidian)
      // Must NOT use placeBlock on adjacent solid blocks, as that can incorrectly collect the lava.
      console.log(`[DEBUG] water_bucket on lava: using activateItem directly on lava block at (${x},${y},${z})`);
      let placed = false;
      for (let attempt = 0; attempt < 3 && !placed; attempt++) {
        try {
          await bot.lookAt(pos.offset(0.5, 0.5, 0.5));
          await new Promise(resolve => setTimeout(resolve, 300));
          bot.activateItem(false);
          await new Promise(resolve => setTimeout(resolve, 2000));
          // Success if water_bucket is consumed (now holds empty bucket, or no bucket)
          const held = bot.heldItem;
          placed = !held || held.name === "bucket";
          // Also check if lava block was replaced (obsidian or water nearby)
          if (!placed) {
            const blockNow = bot.blockAt(pos);
            if (blockNow && blockNow.name !== "lava" && blockNow.name !== "flowing_lava") {
              placed = true; // lava was replaced by water/obsidian
            }
          }
          console.error(`[DEBUG] water_bucket on lava attempt ${attempt + 1}: placed=${placed}, held=${held?.name}`);
        } catch (e) {
          console.error(`[DEBUG] water_bucket on lava attempt ${attempt + 1} failed: ${e}`);
        }
      }
      if (placed) {
        return `Placed water on lava at (${x},${y},${z}) - obsidian may have formed`;
      } else {
        return `⚠️ WARNING: Could not place water_bucket on lava at (${x},${y},${z}). Try moving closer.`;
      }
    } else if (itemName === "water_bucket" || itemName === "lava_bucket") {
      // For placing water/lava, we need to right-click a SOLID block's face.
      // Use bot.placeBlock(solidBlock, faceVector) which handles protocol correctly.
      console.log(`[DEBUG] Placing ${itemName} at (${x},${y},${z}) on block: "${block.name}" (solid: ${block.boundingBox === 'block'})`);

      let referenceBlock: any = null;
      let faceVector: Vec3 = new Vec3(0, 1, 0); // default: top face

      if (block.boundingBox === 'block') {
        referenceBlock = block;
        faceVector = new Vec3(0, 1, 0);
      } else {
        const adjacentChecks = [
          { offset: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) },
          { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },
          { offset: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) },
          { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) },
          { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) },
          { offset: new Vec3(0, 1, 0), face: new Vec3(0, -1, 0) },
        ];

        for (const check of adjacentChecks) {
          const adjPos = pos.plus(check.offset);
          const adjBlock = bot.blockAt(adjPos);
          if (adjBlock && adjBlock.boundingBox === 'block') {
            referenceBlock = adjBlock;
            faceVector = check.face;
            console.log(`[DEBUG] Found solid block "${adjBlock.name}" at (${adjPos.x},${adjPos.y},${adjPos.z}), face=${faceVector}`);
            break;
          }
        }

        if (!referenceBlock) {
          console.error(`[DEBUG] No solid block adjacent to (${x},${y},${z}) for water placement`);
          throw new Error(`No solid block adjacent to (${x},${y},${z}) to place ${itemName} against. Need a solid block nearby.`);
        }
      }

      let placed = false;

      // Attempt 1: Use bot.placeBlock() - the proper Mineflayer API
      try {
        console.log(`[DEBUG] Attempt 1: bot.placeBlock on "${referenceBlock.name}" at (${referenceBlock.position.x},${referenceBlock.position.y},${referenceBlock.position.z}), face=${faceVector}`);
        await bot.placeBlock(referenceBlock, faceVector);
        await new Promise(resolve => setTimeout(resolve, 500));
        const heldNow0 = bot.heldItem;
        placed = !heldNow0 || heldNow0.name === "bucket";
        console.log(`[DEBUG] placeBlock attempt: placed=${placed}, held=${heldNow0?.name}`);
      } catch (e: any) {
        const errMsg = e.message || String(e);
        console.error(`[DEBUG] placeBlock for ${itemName} error: ${errMsg}`);
        await new Promise(resolve => setTimeout(resolve, 500));
        const heldAfterError = bot.heldItem;
        if (!heldAfterError || heldAfterError.name === "bucket") {
          placed = true;
          console.log(`[DEBUG] placeBlock errored but bucket was consumed - placement likely succeeded`);
        }
      }

      // Attempt 2: activateBlock on the adjacent solid block (fallback)
      if (!placed && referenceBlock) {
        try {
          console.log(`[DEBUG] Attempt 2: activateBlock on solid "${referenceBlock.name}"`);
          await bot.lookAt(referenceBlock.position.offset(
            0.5 + faceVector.x * 0.5,
            0.5 + faceVector.y * 0.5,
            0.5 + faceVector.z * 0.5
          ));
          await new Promise(resolve => setTimeout(resolve, 100));
          await bot.activateBlock(referenceBlock);
          await new Promise(resolve => setTimeout(resolve, 1000));
          const heldNow = bot.heldItem;
          placed = !heldNow || heldNow.name === "bucket";
          console.log(`[DEBUG] activateBlock attempt: placed=${placed}, held=${heldNow?.name}`);
        } catch (e) {
          console.error(`[DEBUG] activateBlock for ${itemName} failed: ${e}`);
        }
      }

      // Attempt 3: activateItem (right-click in the air while looking at target face)
      if (!placed) {
        try {
          console.error(`[DEBUG] Attempt 3: activateItem while looking at solid block face`);
          if (referenceBlock) {
            await bot.lookAt(referenceBlock.position.offset(
              0.5 + faceVector.x * 0.5,
              0.5 + faceVector.y * 0.5,
              0.5 + faceVector.z * 0.5
            ));
          } else {
            await bot.lookAt(pos.offset(0.5, 0.5, 0.5));
          }
          await new Promise(resolve => setTimeout(resolve, 200));
          bot.activateItem();
          await new Promise(resolve => setTimeout(resolve, 500));
          bot.deactivateItem();
          await new Promise(resolve => setTimeout(resolve, 500));
          const heldNow2 = bot.heldItem;
          placed = !heldNow2 || heldNow2.name === "bucket";
          console.log(`[DEBUG] activateItem attempt: placed=${placed}, held=${heldNow2?.name}`);
        } catch (e) {
          console.error(`[DEBUG] activateItem for ${itemName} failed: ${e}`);
        }
      }
    } else if (itemName === "flint_and_steel") {
      // For flint_and_steel, right-click on obsidian to ignite nether portal.
      // Strategy: equip flint_and_steel, look at block, send block_place packet directly.
      let ignited = false;

      // Attempt 1: activateBlock (right-click on obsidian)
      const faceVectors = [
        new Vec3(0, 1, 0),  // top face (most common for bottom obsidian)
        new Vec3(0, 0, 1),  // south face
        new Vec3(0, 0, -1), // north face
        new Vec3(1, 0, 0),  // east face
        new Vec3(-1, 0, 0), // west face
      ];

      for (const face of faceVectors) {
        if (ignited) break;
        try {
          const lookTarget = pos.offset(0.5 + face.x * 0.5, 0.5 + face.y * 0.5, 0.5 + face.z * 0.5);
          console.error(`[DEBUG] flint_and_steel: activateBlock on "${block.name}" face=${face}`);
          await bot.lookAt(lookTarget);
          await new Promise(resolve => setTimeout(resolve, 150));
          await bot.activateBlock(block);
          await new Promise(resolve => setTimeout(resolve, 1500));

          const portalBlock = bot.findBlock({
            matching: (b) => b.name === "nether_portal",
            maxDistance: 20,
          });
          if (portalBlock) {
            ignited = true;
            console.error(`[DEBUG] flint_and_steel: nether_portal ignited via activateBlock! face=${face}`);
          }
        } catch (e) {
          console.error(`[DEBUG] flint_and_steel activateBlock face=${face} failed: ${e}`);
        }
      }

      // Attempt 2: direct block_place packet (on adjacent block, not the target block itself)
      if (!ignited) {
        // Try clicking on adjacent air block inside the portal frame
        const adjacentOffsets = [
          { offset: new Vec3(0, -1, 0), face: 1 },  // block below, top face
          { offset: new Vec3(1, 0, 0), face: 4 },   // block to east, west face
          { offset: new Vec3(-1, 0, 0), face: 5 },  // block to west, east face
          { offset: new Vec3(0, 0, 1), face: 2 },   // block to south, north face
          { offset: new Vec3(0, 0, -1), face: 3 },  // block to north, south face
        ];
        for (const adj of adjacentOffsets) {
          if (ignited) break;
          try {
            const adjPos = pos.plus(adj.offset);
            const adjBlock = bot.blockAt(adjPos);
            // Only use solid blocks as reference (not air or portal)
            if (adjBlock && adjBlock.name !== "air" && adjBlock.name !== "nether_portal") {
              console.error(`[DEBUG] flint_and_steel: block_place on adjacent "${adjBlock.name}" at (${adjPos.x},${adjPos.y},${adjPos.z}) face=${adj.face}`);
              await bot.lookAt(pos.offset(0.5, 1.0, 0.5));
              await new Promise(resolve => setTimeout(resolve, 100));
              (bot as any)._client.write('block_place', {
                hand: 0,
                location: { x: adjPos.x, y: adjPos.y, z: adjPos.z },
                direction: adj.face,
                cursorX: 0.5,
                cursorY: 0.5,
                cursorZ: 0.5,
                insideBlock: false,
                sequence: 0,
                worldBorderHit: false,
              });
              await new Promise(resolve => setTimeout(resolve, 1500));

              const portalBlock = bot.findBlock({
                matching: (b) => b.name === "nether_portal",
                maxDistance: 20,
              });
              if (portalBlock) {
                ignited = true;
                console.error(`[DEBUG] flint_and_steel: nether_portal ignited via block_place on adjacent! face=${adj.face}`);
              }
            }
          } catch (e) {
            console.error(`[DEBUG] flint_and_steel block_place failed: ${e}`);
          }
        }
        // Fallback: original approach (block_place on target block itself)
        if (!ignited) {
          for (const face of faceVectors) {
            if (ignited) break;
            try {
              const faceId = face.y === 1 ? 1 : face.y === -1 ? 0 : face.z === 1 ? 3 : face.z === -1 ? 2 : face.x === 1 ? 5 : 4;
              console.error(`[DEBUG] flint_and_steel: block_place (fallback) face=${faceId}`);
              await bot.lookAt(pos.offset(0.5, 1.0, 0.5));
              await new Promise(resolve => setTimeout(resolve, 100));
              (bot as any)._client.write('block_place', {
                hand: 0,
                location: { x: pos.x, y: pos.y, z: pos.z },
                direction: faceId,
                cursorX: 0.5,
                cursorY: 1.0,
                cursorZ: 0.5,
                insideBlock: false,
                sequence: 0,
                worldBorderHit: false,
              });
              await new Promise(resolve => setTimeout(resolve, 1500));

              const portalBlock = bot.findBlock({
                matching: (b) => b.name === "nether_portal",
                maxDistance: 20,
              });
              if (portalBlock) {
                ignited = true;
                console.error(`[DEBUG] flint_and_steel: nether_portal ignited via block_place fallback! face=${faceId}`);
              }
            } catch (e) {
              console.error(`[DEBUG] flint_and_steel block_place fallback failed: ${e}`);
            }
          }
        }
      }

      // Attempt 3: activateItem (use item while looking at block)
      if (!ignited) {
        try {
          await bot.lookAt(pos.offset(0.5, 1.0, 0.5));
          await new Promise(resolve => setTimeout(resolve, 100));
          bot.activateItem();
          await new Promise(resolve => setTimeout(resolve, 600));
          bot.deactivateItem();
        } catch (e) {
          console.error(`[DEBUG] flint_and_steel activateItem failed: ${e}`);
        }
      }

      // Portal interior validation diagnostics - run after all ignition attempts fail
      if (!ignited) {
        console.error(`[PORTAL DEBUG] Portal ignition FAILED after all attempts. Running interior validation...`);

        // Find nearby obsidian blocks to detect portal frame
        const nearbyObsidian: Vec3[] = [];
        for (let dx = -5; dx <= 5; dx++) {
          for (let dy = -5; dy <= 5; dy++) {
            for (let dz = -5; dz <= 5; dz++) {
              const checkPos = pos.offset(dx, dy, dz);
              const checkBlock = bot.blockAt(checkPos);
              if (checkBlock?.name === "obsidian") {
                nearbyObsidian.push(checkPos);
              }
            }
          }
        }

        if (nearbyObsidian.length >= 10) {
          const nonAirBlocks = validatePortalInterior(bot, nearbyObsidian);
          if (nonAirBlocks.length > 0) {
            console.error(`[PORTAL DEBUG] Non-air blocks found in portal interior (${nonAirBlocks.length}):`);
            nonAirBlocks.forEach(blockInfo => console.error(`  - ${blockInfo}`));
            console.error(`[PORTAL DEBUG] Remove these blocks with dig_block, then re-ignite with flint_and_steel.`);
          } else {
            console.error(`[PORTAL DEBUG] Portal interior is clear (all air). Ignition failure cause unknown.`);
          }
        } else {
          console.error(`[PORTAL DEBUG] Found ${nearbyObsidian.length} obsidian blocks nearby (need ≥10 for portal frame).`);
        }
      }
    } else {
      // For other items, use activateBlock
      await bot.activateBlock(block);
    }

    // Wait longer for inventory to update properly
    await new Promise(resolve => setTimeout(resolve, 500));

    // Force inventory update by checking actual inventory, not just heldItem
    bot.updateHeldItem();
    const heldAfter = bot.heldItem;
    const heldName = heldAfter?.name || "nothing";

    // Detect what happened based on item type
    if (itemName === "bucket" && (block.name === "water" || block.name === "flowing_water")) {
      // Verify we actually got water_bucket
      const waterBucket = bot.inventory.items().find(i => i.name === "water_bucket");
      if (waterBucket) {
        return `✅ Collected water with bucket → now have water_bucket. Block at (${x}, ${y}, ${z}) cleared.`;
      } else {
        return `⚠️ Used bucket on water but water_bucket not found in inventory. Holding: ${heldName}`;
      }
    } else if (itemName === "bucket" && (block.name === "lava" || block.name === "flowing_lava")) {
      // Verify we actually got lava_bucket
      const lavaBucket = bot.inventory.items().find(i => i.name === "lava_bucket");
      if (lavaBucket) {
        return `✅ Collected lava with bucket → now have lava_bucket. Block at (${x}, ${y}, ${z}) cleared.`;
      } else {
        return `⚠️ Used bucket on lava but lava_bucket not found in inventory. Holding: ${heldName}`;
      }
    } else if (itemName === "water_bucket" || itemName === "lava_bucket") {
      // Check if water/lava actually appeared, and if obsidian formed
      await new Promise(resolve => setTimeout(resolve, 500)); // extra wait for world updates

      // Verify bucket was consumed (held item should be empty bucket)
      const bucketConsumed = !heldAfter || heldAfter.name === "bucket";
      const placedFluid = itemName === "water_bucket" ? "water" : "lava";

      // Check block at target position
      const blockAfterPlace = bot.blockAt(pos);
      const blockAfterName = blockAfterPlace?.name || "unknown";

      // Verify water/lava appeared (may be at target or transformed to obsidian/cobblestone)
      const fluidAppeared = blockAfterName === placedFluid || blockAfterName === `flowing_${placedFluid}`;
      const transformed = blockAfterName === "obsidian" || blockAfterName === "cobblestone" || blockAfterName === "stone";

      let obsidianInfo = "";
      if (itemName === "water_bucket") {
        // Search nearby for obsidian that may have formed
        const nearbyObsidian: string[] = [];
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            for (let dz = -2; dz <= 2; dz++) {
              const checkBlock = bot.blockAt(pos.offset(dx, dy, dz));
              if (checkBlock?.name === "obsidian") {
                nearbyObsidian.push(`(${pos.x+dx},${pos.y+dy},${pos.z+dz})`);
              }
            }
          }
        }
        if (nearbyObsidian.length > 0) {
          obsidianInfo = ` ✅ Obsidian formed at: ${nearbyObsidian.join(", ")}`;
        } else if (transformed) {
          obsidianInfo = ` Block at target transformed to: ${blockAfterName}`;
        } else if (!fluidAppeared && !bucketConsumed) {
          obsidianInfo = ` ⚠️ Water placement FAILED. Block at target: ${blockAfterName}. Bucket not consumed.`;
        } else {
          obsidianInfo = ` Block at target is now: ${blockAfterName}`;
        }
      }

      if (!bucketConsumed) {
        return `⚠️ ${itemName} placement may have FAILED at (${x}, ${y}, ${z}). Still holding ${heldName}. Block: ${blockAfterName}.${obsidianInfo}`;
      }
      return `✅ Placed ${placedFluid} at (${x}, ${y}, ${z}). Now holding ${heldName}.${obsidianInfo}`;
    } else if (itemName === "bone_meal") {
      // Report crop growth status after bone_meal application
      const blockAfterBoneMeal = bot.blockAt(pos);
      if (blockAfterBoneMeal) {
        const cropBlocks = ["wheat", "beetroots", "carrots", "potatoes"];
        if (cropBlocks.includes(blockAfterBoneMeal.name)) {
          try {
            const props = blockAfterBoneMeal.getProperties();
            const age = props?.age;
            const maxAge = blockAfterBoneMeal.name === "beetroots" ? 3 : 7;
            if (age !== undefined) {
              const mature = Number(age) >= maxAge;
              return `Used bone_meal on ${blockAfterBoneMeal.name} at (${x}, ${y}, ${z}). Age: ${age}/${maxAge}${mature ? " ✅ MATURE - ready to harvest!" : " - not yet mature, apply more bone_meal"}`;
            }
          } catch (_) { /* fall through to generic message */ }
        }
      }
      return `Used ${itemName} on ${block.name} at (${x}, ${y}, ${z}). Now holding ${heldName}.`;
    } else {
      return `Used ${itemName} on ${block.name} at (${x}, ${y}, ${z}). Now holding ${heldName}.`;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to use ${itemName} on block at (${x}, ${y}, ${z}): ${errMsg}`);
  }
}
