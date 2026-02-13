import { botManager } from "../bot-manager/index.js";

/**
 * High-level, task-oriented Minecraft actions
 * These functions orchestrate multiple bot-manager operations to accomplish complex tasks
 */

/**
 * Gather specific resources by finding, mining, and collecting blocks
 * Loops until target count is reached or no more blocks are found
 */
export async function minecraft_gather_resources(
  username: string,
  items: Array<{ name: string; count: number }>,
  maxDistance: number = 32
): Promise<string> {
  const results: string[] = [];

  for (const item of items) {
    let collected = 0;
    const targetCount = item.count;
    let attempts = 0;
    const maxAttempts = targetCount * 3; // Allow multiple attempts per item

    console.error(`[GatherResources] Target: ${item.name} x${targetCount}`);

    while (collected < targetCount && attempts < maxAttempts) {
      attempts++;

      try {
        // Find the block
        const findResult = botManager.findBlock(username, item.name, maxDistance);

        if (findResult.includes("No") || findResult.includes("not found")) {
          console.error(`[GatherResources] No more ${item.name} found within ${maxDistance} blocks`);
          break;
        }

        // Parse position from findResult (format: "Found blockname at (x, y, z)")
        const posMatch = findResult.match(/\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/);
        if (!posMatch) {
          console.error(`[GatherResources] Could not parse position from: ${findResult}`);
          break;
        }

        const x = parseFloat(posMatch[1]);
        const y = parseFloat(posMatch[2]);
        const z = parseFloat(posMatch[3]);

        console.error(`[GatherResources] Found ${item.name} at (${x}, ${y}, ${z})`);

        // Move to the block
        const moveResult = await botManager.moveTo(username, x, y, z);
        if (!moveResult.includes("Reached") && !moveResult.includes("Moved")) {
          console.error(`[GatherResources] Move failed: ${moveResult}`);
          continue; // Try finding another block
        }

        // Check inventory before mining
        const invBefore = botManager.getInventory(username);
        const beforeCount = invBefore.find(i => i.name === item.name)?.count || 0;

        // Dig the block
        const digResult = await botManager.digBlock(username, Math.floor(x), Math.floor(y), Math.floor(z));

        // Check if dig was successful
        if (digResult.includes("Failed") || digResult.includes("Cannot")) {
          console.error(`[GatherResources] Dig failed: ${digResult}`);
          continue;
        }

        // Collect nearby items
        await botManager.collectNearbyItems(username);

        // Check inventory after mining
        const invAfter = botManager.getInventory(username);
        const afterCount = invAfter.find(i => i.name === item.name)?.count || 0;
        const gained = afterCount - beforeCount;

        if (gained > 0) {
          collected += gained;
          console.error(`[GatherResources] Collected ${gained} ${item.name}, total: ${collected}/${targetCount}`);
        } else {
          console.error(`[GatherResources] No items gained, may need correct tool`);
        }

        // Small delay between mining operations
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (err) {
        console.error(`[GatherResources] Error: ${err}`);
        continue;
      }
    }

    results.push(`${item.name}: ${collected}/${targetCount}`);
  }

  const inventory = botManager.getInventory(username);
  const invStr = inventory.map(i => `${i.name}(${i.count})`).join(", ");

  return `Gathering complete. ${results.join(", ")}. Inventory: ${invStr}`;
}

/**
 * Build a structure at the bot's current location
 * Supports: shelter, wall, platform, tower
 */
export async function minecraft_build_structure(
  username: string,
  type: "shelter" | "wall" | "platform" | "tower",
  size: "small" | "medium" | "large" = "small"
): Promise<string> {
  console.error(`[BuildStructure] Type: ${type}, Size: ${size}`);

  const position = botManager.getPosition(username);
  if (!position) {
    return "Failed to get bot position";
  }

  const baseX = Math.floor(position.x);
  const baseY = Math.floor(position.y);
  const baseZ = Math.floor(position.z);

  // Determine dimensions based on size
  const dimensions = {
    small: { width: 3, length: 3, height: 3 },
    medium: { width: 5, length: 5, height: 4 },
    large: { width: 7, length: 7, height: 5 }
  };

  const dim = dimensions[size];

  // Level ground first
  const levelResult = await botManager.levelGround(username, {
    centerX: baseX,
    centerZ: baseZ,
    radius: Math.floor(dim.width / 2),
    mode: "both",
  });
  console.error(`[BuildStructure] Level ground: ${levelResult}`);

  // Check inventory for building materials
  const inventory = botManager.getInventory(username);
  const buildingMaterials = ["cobblestone", "oak_planks", "birch_planks", "spruce_planks", "stone", "dirt"];
  const material = inventory.find(item => buildingMaterials.includes(item.name) && item.count >= 20);

  if (!material) {
    return `Need at least 20 building blocks. Have: ${inventory.map(i => `${i.name}(${i.count})`).join(", ")}`;
  }

  console.error(`[BuildStructure] Using material: ${material.name}`);

  const results: string[] = [];
  let blocksPlaced = 0;

  try {
    if (type === "shelter") {
      // Build walls (4 sides)
      for (let y = 0; y < dim.height; y++) {
        // Front and back walls
        for (let x = 0; x < dim.width; x++) {
          await botManager.placeBlock(username, material.name, baseX + x, baseY + y, baseZ);
          await botManager.placeBlock(username, material.name, baseX + x, baseY + y, baseZ + dim.length - 1);
          blocksPlaced += 2;
        }
        // Side walls (skip corners to avoid duplication)
        for (let z = 1; z < dim.length - 1; z++) {
          await botManager.placeBlock(username, material.name, baseX, baseY + y, baseZ + z);
          await botManager.placeBlock(username, material.name, baseX + dim.width - 1, baseY + y, baseZ + z);
          blocksPlaced += 2;
        }
      }

      // Build roof
      for (let x = 0; x < dim.width; x++) {
        for (let z = 0; z < dim.length; z++) {
          await botManager.placeBlock(username, material.name, baseX + x, baseY + dim.height, baseZ + z);
          blocksPlaced++;
        }
      }

      results.push(`Built ${size} shelter (${dim.width}x${dim.length}x${dim.height})`);

    } else if (type === "wall") {
      // Build a protective wall
      const wallLength = dim.width * 2;
      for (let y = 0; y < dim.height; y++) {
        for (let x = 0; x < wallLength; x++) {
          await botManager.placeBlock(username, material.name, baseX + x, baseY + y, baseZ);
          blocksPlaced++;
        }
      }
      results.push(`Built ${size} wall (${wallLength}x${dim.height})`);

    } else if (type === "platform") {
      // Build a flat platform
      for (let x = 0; x < dim.width; x++) {
        for (let z = 0; z < dim.length; z++) {
          await botManager.placeBlock(username, material.name, baseX + x, baseY, baseZ + z);
          blocksPlaced++;
        }
      }
      results.push(`Built ${size} platform (${dim.width}x${dim.length})`);

    } else if (type === "tower") {
      // Build a vertical tower
      const towerHeight = dim.height * 2;
      for (let y = 0; y < towerHeight; y++) {
        await botManager.placeBlock(username, material.name, baseX, baseY + y, baseZ);
        blocksPlaced++;
      }
      results.push(`Built ${size} tower (height ${towerHeight})`);
    }

  } catch (err) {
    console.error(`[BuildStructure] Error: ${err}`);
    results.push(`Placed ${blocksPlaced} blocks before error: ${err}`);
  }

  const finalInventory = botManager.getInventory(username);
  const invStr = finalInventory.map(i => `${i.name}(${i.count})`).join(", ");

  return `${results.join("; ")}. Blocks placed: ${blocksPlaced}. Inventory: ${invStr}`;
}

/**
 * Craft items with automatic dependency resolution
 * Uses Mineflayer's recipe system to dynamically determine what needs to be crafted
 */
export async function minecraft_craft_chain(
  username: string,
  target: string,
  autoGather: boolean = false
): Promise<string> {
  console.error(`[CraftChain] Target: ${target}, autoGather: ${autoGather}`);

  const results: string[] = [];
  const craftedItems = new Set<string>(); // Prevent infinite loops

  /**
   * Recursively craft an item and its dependencies
   */
  const craftRecursive = async (itemName: string, count: number): Promise<void> => {
    if (craftedItems.has(itemName)) {
      console.error(`[CraftChain] Already crafted ${itemName}, skipping to prevent loop`);
      return;
    }

    console.error(`[CraftChain] Attempting to craft ${itemName} x${count}`);

    // Try to craft directly first
    try {
      const craftResult = await botManager.craftItem(username, itemName, count);
      results.push(craftResult);
      craftedItems.add(itemName);
      return;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[CraftChain] Direct craft failed: ${errMsg}`);

      // If autoGather is enabled and error is about missing ingredients, try to gather/craft them
      if (autoGather && errMsg.includes("missing ingredient")) {
        // Parse the error message to extract needed ingredients
        // Format: "Recipe needs: item1(need N), item2(need M)"
        const needsMatch = errMsg.match(/Recipe needs: ([^.]+)/);
        if (needsMatch) {
          const needsStr = needsMatch[1];
          const ingredients = needsStr.split(/,\s*/);

          for (const ingredient of ingredients) {
            const match = ingredient.match(/(\w+)\(need (\d+)\)/);
            if (match) {
              const neededItem = match[1];
              const neededCount = parseInt(match[2]);

              console.error(`[CraftChain] Need ${neededCount}x ${neededItem}`);

              // Check if this item can be obtained by smelting
              if (isItemSmeltable(neededItem)) {
                const sourceItem = smeltingRecipes[neededItem];
                console.error(`[CraftChain] ${neededItem} can be smelted from ${sourceItem}`);

                // Check if we have the source material
                const inventory = botManager.getInventory(username);
                const sourceInInv = inventory.find(i => i.name === sourceItem);

                if (!sourceInInv || sourceInInv.count < neededCount) {
                  // Need to gather the source material first
                  const needToGather = neededCount - (sourceInInv?.count || 0);
                  console.error(`[CraftChain] Need to gather ${needToGather}x ${sourceItem} first`);
                  const gatherResult = await minecraft_gather_resources(
                    username,
                    [{ name: sourceItem, count: needToGather }],
                    32
                  );
                  results.push(`Gathered for smelting: ${gatherResult}`);
                }

                // Smelt the source material
                console.error(`[CraftChain] Smelting ${neededCount}x ${sourceItem} -> ${neededItem}`);
                const smeltResult = await botManager.smeltItem(username, sourceItem, neededCount);
                results.push(`Smelted: ${smeltResult}`);
              }
              // Check if this item can be crafted
              else if (await isItemCraftable(neededItem)) {
                // Recursively craft the dependency
                await craftRecursive(neededItem, neededCount);
              } else {
                // Gather the raw material
                console.error(`[CraftChain] ${neededItem} is not craftable, gathering...`);
                const gatherResult = await minecraft_gather_resources(
                  username,
                  [{ name: neededItem, count: neededCount }],
                  32
                );
                results.push(`Gathered: ${gatherResult}`);
              }
            }
          }

          // Retry crafting after gathering/crafting dependencies
          const retryCraftResult = await botManager.craftItem(username, itemName, count);
          results.push(retryCraftResult);
          craftedItems.add(itemName);
          return;
        }
      }

      throw new Error(`Failed to craft ${itemName}: ${errMsg}`);
    }
  };

  /**
   * Smelting recipes: output -> input
   */
  const smeltingRecipes: Record<string, string> = {
    // Ores to ingots
    "iron_ingot": "iron_ore",
    "gold_ingot": "gold_ore",
    "copper_ingot": "copper_ore",
    // Other smelting
    "glass": "sand",
    "stone": "cobblestone",
    "smooth_stone": "stone",
    // Food
    "cooked_beef": "beef",
    "cooked_porkchop": "porkchop",
    "cooked_chicken": "chicken",
    "cooked_mutton": "mutton",
    "cooked_rabbit": "rabbit",
    "cooked_cod": "cod",
    "cooked_salmon": "salmon",
  };

  /**
   * Check if an item can be obtained by smelting
   */
  const isItemSmeltable = (itemName: string): boolean => {
    return itemName in smeltingRecipes;
  };

  /**
   * Check if an item can be crafted (has recipes) or must be gathered
   */
  const isItemCraftable = async (itemName: string): Promise<boolean> => {
    // Items that are typically raw materials (not craftable or smeltable)
    const rawMaterials = [
      // Logs and natural blocks
      "oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log",
      "mangrove_log", "cherry_log", "pale_oak_log",
      "cobblestone", "dirt", "sand", "gravel",
      // Ores
      "coal_ore", "iron_ore", "gold_ore", "diamond_ore", "lapis_ore", "redstone_ore",
      "copper_ore", "emerald_ore",
      "coal", "diamond", "emerald",
      // Natural resources
      "wheat", "carrot", "potato", "beetroot",
      "leather", "wool", "string", "feather",
      "flint", "clay_ball", "beef", "porkchop", "chicken", "mutton", "rabbit",
    ];

    return !rawMaterials.includes(itemName) && !isItemSmeltable(itemName);
  };

  try {
    await craftRecursive(target, 1);
    const inventory = botManager.getInventory(username);
    const invStr = inventory.map(i => `${i.name}(${i.count})`).join(", ");
    return `Crafting chain complete for ${target}. ${results.join("; ")}. Inventory: ${invStr}`;
  } catch (err) {
    const inventory = botManager.getInventory(username);
    const invStr = inventory.map(i => `${i.name}(${i.count})`).join(", ");
    return `Crafting chain failed for ${target}: ${err}. Results so far: ${results.join("; ")}. Inventory: ${invStr}`;
  }
}

/**
 * Execute survival priorities: gather food, build shelter, craft tools
 * Auto-detects current state and takes appropriate action
 */
export async function minecraft_survival_routine(
  username: string,
  priority: "food" | "shelter" | "tools" | "auto"
): Promise<string> {
  console.error(`[SurvivalRoutine] Priority: ${priority}`);

  // Get current bot status
  const status = botManager.getStatus(username);
  const inventory = botManager.getInventory(username);

  let selectedPriority = priority;

  if (priority === "auto") {
    // Auto-detect priority based on current state
    // Parse JSON status: {"health":"X/20","hunger":"Y/20",...}
    let food = 20;

    try {
      const statusObj = JSON.parse(status);
      const hungerMatch = statusObj.hunger?.match(/([\d.]+)\//);
      if (hungerMatch) food = parseFloat(hungerMatch[1]);
    } catch (e) {
      // Fallback: try old text format
      const statusMatch = status.match(/Health: ([\d.]+)\/20, Food: ([\d.]+)\/20/);
      if (statusMatch) {
        food = parseFloat(statusMatch[2]);
      }
    }

    const hasPickaxe = inventory.some(item => item.name.includes("pickaxe"));

    if (food < 10) {
      selectedPriority = "food";
    } else if (!hasPickaxe) {
      selectedPriority = "tools";
    } else {
      selectedPriority = "shelter";
    }

    console.error(`[SurvivalRoutine] Auto-selected priority: ${selectedPriority}`);
  }

  const results: string[] = [];

  if (selectedPriority === "food") {
    // Find and hunt animals for food
    const nearbyEntities = botManager.findEntities(username, "passive", 32);

    if (nearbyEntities.includes("cow") || nearbyEntities.includes("pig") || nearbyEntities.includes("chicken") || nearbyEntities.includes("sheep")) {
      try {
        // Fight passive mobs for food (this will attack them)
        const fightResult = await botManager.fight(username, "cow"); // Try cow first
        results.push(`Food: ${fightResult}`);

        // Collect drops
        await botManager.collectNearbyItems(username);
      } catch (err) {
        results.push(`Food gathering failed: ${err}`);
      }
    } else {
      // No animals found - try fishing as emergency fallback
      console.error("[SurvivalRoutine] No animals found, attempting fishing");

      try {
        // Check if we have a fishing rod
        const hasFishingRod = inventory.some(item => item.name === "fishing_rod");

        if (hasFishingRod) {
          const fishResult = await botManager.fish(username, 30);
          results.push(`Emergency fishing: ${fishResult}`);
        } else {
          // Try to craft a fishing rod (requires 3 sticks + 2 string)
          const hasSticks = inventory.some(item => item.name === "stick" && item.count >= 3);
          const hasString = inventory.some(item => item.name === "string" && item.count >= 2);

          if (hasSticks && hasString) {
            const craftResult = await botManager.craftItem(username, "fishing_rod", 1);
            results.push(`Crafted fishing rod: ${craftResult}`);

            const fishResult = await botManager.fish(username, 30);
            results.push(`Emergency fishing: ${fishResult}`);
          } else {
            results.push("No food sources found. Need: animals nearby OR fishing rod OR (3 sticks + 2 string to craft rod)");
          }
        }
      } catch (err) {
        results.push(`Emergency fishing failed: ${err}`);
      }
    }
  }

  if (selectedPriority === "shelter") {
    // Check if we have a bed
    const hasBed = inventory.some(item => item.name === "bed");
    const hasWool = inventory.some(item => item.name === "wool");
    const hasPlanks = inventory.some(item => item.name.includes("planks"));

    if (!hasBed) {
      if (!hasWool) {
        // Need to find sheep and shear them
        const sheepResult = botManager.findEntities(username, "sheep", 64);
        if (sheepResult.includes("sheep")) {
          return "Found sheep nearby. Craft shears (2 iron_ingot) first, then use minecraft_craft_chain for 'bed'.";
        }
      }

      if (hasWool && hasPlanks) {
        try {
          const bedResult = await botManager.craftItem(username, "bed", 1);
          results.push(`Shelter: ${bedResult}`);
        } catch (err) {
          results.push(`Bed crafting failed: ${err}`);
        }
      }
    }

    // Build a small shelter
    try {
      const buildResult = await minecraft_build_structure(username, "shelter", "small");
      results.push(`Shelter: ${buildResult}`);
    } catch (err) {
      results.push(`Shelter building failed: ${err}`);
    }
  }

  if (selectedPriority === "tools") {
    // Craft basic tools
    const hasPickaxe = inventory.some(item => item.name.includes("pickaxe"));
    const hasAxe = inventory.some(item => item.name.includes("axe"));
    const hasShovel = inventory.some(item => item.name.includes("shovel"));

    const results: string[] = [];

    if (!hasPickaxe) {
      try {
        const pickaxeResult = await minecraft_craft_chain(username, "wooden_pickaxe", true);
        results.push(`Pickaxe: ${pickaxeResult}`);
      } catch (err) {
        console.error(`[SurvivalRoutine] Pickaxe crafting failed: ${err}`);
      }
    }

    if (!hasAxe) {
      try {
        const axeResult = await minecraft_craft_chain(username, "wooden_axe", true);
        results.push(`Axe: ${axeResult}`);
      } catch (err) {
        console.error(`[SurvivalRoutine] Axe crafting failed: ${err}`);
      }
    }

    if (!hasShovel) {
      try {
        const shovelResult = await minecraft_craft_chain(username, "wooden_shovel", true);
        results.push(`Shovel: ${shovelResult}`);
      } catch (err) {
        console.error(`[SurvivalRoutine] Shovel crafting failed: ${err}`);
      }
    }
  }

  const finalInventory = botManager.getInventory(username);
  const invStr = finalInventory.map(i => `${i.name}(${i.count})`).join(", ");

  return `Survival routine (${selectedPriority}) complete. ${results.join("; ")}. Inventory: ${invStr}`;
}

/**
 * Explore an area in a spiral pattern to discover biomes, structures, and resources
 */
export async function minecraft_explore_area(
  username: string,
  radius: number = 100,
  target?: string
): Promise<string> {
  console.error(`[ExploreArea] Radius: ${radius}, Target: ${target || "general"}`);

  const startPos = botManager.getPosition(username);
  if (!startPos) {
    return "Failed to get bot position";
  }

  const startX = Math.floor(startPos.x);
  const startZ = Math.floor(startPos.z);

  const findings: string[] = [];
  let visitedPoints = 0;

  // Spiral pattern exploration
  let x = startX;
  let z = startZ;
  let dx = 0;
  let dz = -5; // Start moving north
  let segmentLength = 1;
  let segmentPassed = 0;

  while (Math.abs(x - startX) <= radius && Math.abs(z - startZ) <= radius) {
    visitedPoints++;

    try {
      // Safety check: abort if hunger is critical (unless searching for food)
      const status = botManager.getStatus(username);
      const statusMatch = status.match(/Food: ([\d.]+)\/20/);
      if (statusMatch) {
        const food = parseFloat(statusMatch[1]);
        if (food < 6) {
          // Emergency mode: allow short-range search for food animals
          const foodAnimals = ["cow", "pig", "chicken", "sheep", "rabbit"];
          const isSearchingForFood = target && foodAnimals.includes(target.toLowerCase());

          if (!isSearchingForFood) {
            return `Exploration aborted at ${visitedPoints} points due to critical hunger (${food}/20). Return to safety and eat! Findings so far: ${findings.length > 0 ? findings.join(", ") : "none"}`;
          }

          // In emergency mode, limit search radius to 30 blocks max
          if (visitedPoints > 20) {
            return `Emergency food search completed at ${visitedPoints} points. Hunger: ${food}/20. Findings: ${findings.length > 0 ? findings.join(", ") : "none"}`;
          }
        }
      }

      // Move to next point
      await botManager.moveTo(username, x, startPos.y, z);

      // Check biome
      const biome = await botManager.getBiome(username);
      if (target && biome.includes(target)) {
        findings.push(`${target} biome at (${x}, ${z})`);
      }

      // Check for target block
      if (target) {
        const blockResult = botManager.findBlock(username, target, 16);
        if (!blockResult.includes("No") && !blockResult.includes("not found")) {
          findings.push(`${target} block at current location`);
        }
      }

      // Check for target entity
      if (target) {
        const entityResult = botManager.findEntities(username, target, 16);
        if (entityResult.includes(target)) {
          findings.push(`${target} entity at current location`);
        }
      }

      // Move in spiral
      x += dx;
      z += dz;
      segmentPassed++;

      if (segmentPassed === segmentLength) {
        segmentPassed = 0;

        // Turn 90 degrees clockwise
        const temp = dx;
        dx = -dz;
        dz = temp;

        // Increase segment length every 2 turns
        if (dz === 0) {
          segmentLength++;
        }
      }

      // Break if we've explored enough
      if (visitedPoints >= 100) {
        break;
      }

    } catch (err) {
      console.error(`[ExploreArea] Error at (${x}, ${z}): ${err}`);
      break;
    }
  }

  if (findings.length > 0) {
    return `Exploration complete. Visited ${visitedPoints} points. Findings: ${findings.join(", ")}`;
  } else {
    return `Exploration complete. Visited ${visitedPoints} points. No notable findings.`;
  }
}

/**
 * Enchant an item at an enchanting table
 * Requires: enchanting table nearby (within 32 blocks), lapis lazuli, and XP levels
 */
export async function minecraft_enchant_item(
  username: string,
  itemName: string,
  enchantmentLevel: number = 1
): Promise<string> {
  console.error(`[EnchantItem] Enchanting ${itemName} at level ${enchantmentLevel}`);

  try {
    const result = await botManager.enchant(username, itemName, enchantmentLevel);
    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return `Failed to enchant ${itemName}: ${errMsg}`;
  }
}

/**
 * Brew potions at a brewing stand
 * Requires: brewing stand nearby (within 32 blocks), blaze powder (fuel), base potion, and ingredient
 * Note: Currently returns a placeholder as full brewing functionality is under development
 */
export async function minecraft_brew_potion(
  username: string,
  basePotionName: string,
  ingredientName: string,
  count: number = 1
): Promise<string> {
  console.error(`[BrewPotion] Brewing ${count}x potions: ${basePotionName} + ${ingredientName}`);

  try {
    const result = await botManager.brewPotion(username, basePotionName, ingredientName, count);
    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return `Failed to brew potion: ${errMsg}`;
  }
}
