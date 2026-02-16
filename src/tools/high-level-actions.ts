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

        // Safety check: Don't mine ANY blocks while high up (Y > 80) to prevent fall damage
        // Mining causes pathfinding which can lead to falls from high structures
        const botPos = botManager.getPosition(username);
        if (botPos && botPos.y > 80) {
          console.error(`[GatherResources] Aborting resource gathering - bot at dangerous altitude (Y:${botPos.y}). Descend to ground level (Y < 80) before mining.`);
          break; // Abort the entire gathering operation
        }

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
    // Note: craftItem already handles automatic movement to crafting tables within 32 blocks
    try {
      const craftResult = await botManager.craftItem(username, itemName, count);
      results.push(craftResult);
      craftedItems.add(itemName);
      return;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[CraftChain] Direct craft failed: ${errMsg}`);

      // If error is about crafting table placement, provide more helpful message
      if (errMsg.includes("crafting_table") && errMsg.includes("Place one nearby")) {
        throw new Error(`${itemName} requires a crafting_table. ${errMsg}`);
      }

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
    // Find and hunt animals for food - increased radius to 128 blocks for better coverage
    // Check for ALL entities (don't filter by "passive" since it's not a valid entity type)
    const nearbyEntities = botManager.findEntities(username, undefined, 128);

    // Determine which food animal is actually available
    const foodAnimals = ["cow", "pig", "chicken", "sheep"];
    const availableAnimal = foodAnimals.find(animal => nearbyEntities.includes(animal));

    if (availableAnimal) {
      try {
        // Fight the available food animal
        // CRITICAL: When hunting for food in survival mode, allow fighting even at low HP
        // because we NEED food to restore health. Set flee threshold to 0 for food animals.
        const fightResult = await botManager.fight(username, availableAnimal, 0);
        results.push(`Food: ${fightResult}`);

        // Collect drops
        await botManager.collectNearbyItems(username);
      } catch (err) {
        results.push(`Food gathering failed: ${err}`);
      }
    } else {
      // No animals found - try alternative food sources
      console.error("[SurvivalRoutine] No food animals found (checked: cow, pig, chicken, sheep within 128 blocks), trying alternatives");

      // EMERGENCY FALLBACK 1: Hunt zombies for rotten_flesh (better than starving)
      if (nearbyEntities.includes("zombie")) {
        console.error("[SurvivalRoutine] Found zombie - hunting for rotten_flesh (emergency food)");
        try {
          const fightResult = await botManager.fight(username, "zombie", 6); // flee at 6 HP
          results.push(`Emergency zombie hunt: ${fightResult}`);
          await botManager.collectNearbyItems(username);

          // Check if we got rotten flesh and eat it immediately if hunger is critical
          const currentStatus = botManager.getStatus(username);
          const statusObj = JSON.parse(currentStatus);
          const hungerMatch = statusObj.hunger?.match(/([\d.]+)\//);
          const currentHunger = hungerMatch ? parseFloat(hungerMatch[1]) : 20;

          if (currentHunger < 6) {
            const updatedInventory = botManager.getInventory(username);
            if (updatedInventory.some(item => item.name === "rotten_flesh")) {
              console.error("[SurvivalRoutine] Critical hunger - eating rotten_flesh immediately");
              try {
                const eatResult = await botManager.eat(username, "rotten_flesh");
                results.push(`Ate rotten_flesh: ${eatResult}`);
              } catch (eatErr) {
                console.error(`[SurvivalRoutine] Failed to eat rotten_flesh: ${eatErr}`);
              }
            }
          }
        } catch (err) {
          results.push(`Emergency zombie hunt failed: ${err}`);
        }
      } else {
        // EMERGENCY FALLBACK 2: Try fishing
        console.error("[SurvivalRoutine] No zombies nearby, attempting fishing");
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
              results.push("No food sources found. Need: animals nearby OR zombies for rotten_flesh OR fishing rod OR (3 sticks + 2 string to craft rod)");
            }
          }
        } catch (err) {
          results.push(`Emergency fishing failed: ${err}`);
        }
      }
    }
  }

  if (selectedPriority === "shelter") {
    // Check if we have a bed (any color)
    const hasBed = inventory.some(item => item.name.includes("_bed"));
    const hasWool = inventory.some(item => item.name.includes("wool"));
    const hasPlanks = inventory.some(item => item.name.includes("planks"));

    if (!hasBed) {
      if (!hasWool) {
        // Need to find sheep and shear them
        const sheepResult = botManager.findEntities(username, "sheep", 64);
        if (sheepResult.includes("sheep")) {
          return "Found sheep nearby. Craft shears (2 iron_ingot) first, then use minecraft_craft_chain for 'white_bed'.";
        }
      }

      if (hasWool && hasPlanks) {
        try {
          // Minecraft requires color-specific bed name
          const bedResult = await botManager.craftItem(username, "white_bed", 1);
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

  // Warn if searching for enderman during daytime (they only spawn at night)
  if (target?.toLowerCase() === "enderman") {
    const bot = botManager.getBot(username);
    if (bot) {
      const timeOfDay = bot.time?.timeOfDay ?? 0;
      if (timeOfDay < 12541 || timeOfDay > 23458) {
        return `Cannot find enderman during daytime (current time: ${timeOfDay}). Endermen only spawn at night (12541-23458). Wait for nightfall or do other tasks like mining iron for armor.`;
      }
    }
  }

  const startPos = botManager.getPosition(username);
  if (!startPos) {
    return "Failed to get bot position";
  }

  const startX = Math.floor(startPos.x);
  const startZ = Math.floor(startPos.z);

  const findings: string[] = [];
  let visitedPoints = 0;
  // Use larger steps for entity hunting (detection range is 32 blocks, so step=20 still has overlap)
  const knownEntitiesForStep = ["cow", "pig", "chicken", "sheep", "rabbit", "horse", "donkey", "cat", "ocelot", "parrot", "wolf", "llama", "turtle", "panda", "fox", "bee", "axolotl", "frog", "goat", "zombie", "skeleton", "spider", "creeper", "enderman", "blaze"];
  const isEntityHunt = target && knownEntitiesForStep.some(e => target.toLowerCase().includes(e));
  const stepSize = isEntityHunt ? 20 : 5; // Larger steps for entity hunting (32-block detection range)
  const maxVisitedPoints = Math.min(50, Math.ceil((radius * 2 / stepSize) ** 2 / 4)); // Cover area proportional to radius
  const startTime = Date.now();
  const maxDuration = 120000; // 2 minutes max

  // Spiral pattern exploration
  let x = startX;
  let z = startZ;
  let dx = 0;
  let dz = -stepSize; // Start moving north/south
  let segmentLength = 1;
  let segmentPassed = 0;

  while (Math.abs(x - startX) <= radius && Math.abs(z - startZ) <= radius &&
         visitedPoints < maxVisitedPoints &&
         (Date.now() - startTime) < maxDuration) {
    visitedPoints++;

    try {
      // Safety check: abort if hunger is critical (unless searching for food)
      const status = botManager.getStatus(username);

      // Parse status - handle both JSON and old text format
      let food = 20;
      let hp = 20;
      try {
        const statusObj = JSON.parse(status);
        const hungerMatch = statusObj.hunger?.match(/([\d.]+)\//);
        if (hungerMatch) food = parseFloat(hungerMatch[1]);
        const healthMatch = statusObj.health?.match(/([\d.]+)\//);
        if (healthMatch) hp = parseFloat(healthMatch[1]);
      } catch (e) {
        // Fallback: try old text format
        const statusMatch = status.match(/Food: ([\d.]+)\/20/);
        if (statusMatch) food = parseFloat(statusMatch[1]);
        const hpMatch = status.match(/Health: ([\d.]+)\//);
        if (hpMatch) hp = parseFloat(hpMatch[1]);
      }

      // Auto-eat when HP is low and we have food
      if (hp < 15 && food < 18) {
        try {
          await botManager.eat(username);
          console.error(`[ExploreArea] Auto-ate food (HP was ${hp}, hunger was ${food})`);
        } catch (_) { /* no food available */ }
      }

      // Abort if HP is critically low
      if (hp <= 6) {
        return `Exploration aborted at ${visitedPoints} points due to critical HP (${hp}/20). Flee and recover! Findings: ${findings.length > 0 ? findings.join(", ") : "none"}`;
      }

      // More aggressive hunger monitoring to prevent starvation
      if (food < 8) {
        // Emergency mode: allow short-range search for food animals only
        const foodAnimals = ["cow", "pig", "chicken", "sheep", "rabbit"];
        const foodSearchTerms = ["animal", "passive", "mob", "food", "meat"];
        const isSearchingForFood = target && (
          foodAnimals.includes(target.toLowerCase()) ||
          foodSearchTerms.some(term => target.toLowerCase().includes(term))
        );

        if (!isSearchingForFood) {
          return `Exploration aborted at ${visitedPoints} points due to low hunger (${food}/20). Return to safety and eat! Findings so far: ${findings.length > 0 ? findings.join(", ") : "none"}`;
        }

        // In emergency mode, limit search to just a few nearby points
        if (visitedPoints > 6) {
          return `Emergency food search completed at ${visitedPoints} points. Hunger: ${food}/20. Findings: ${findings.length > 0 ? findings.join(", ") : "none"}`;
        }
      }

      // Also warn and limit exploration when hunger is moderately low
      if (food < 12 && visitedPoints > Math.min(15, maxVisitedPoints / 2)) {
        return `Exploration limited at ${visitedPoints} points due to moderate hunger (${food}/20). Findings: ${findings.length > 0 ? findings.join(", ") : "none"}`;
      }

      // Move to next point
      try {
        await botManager.moveTo(username, x, startPos.y, z);
      } catch (moveErr) {
        console.error(`[ExploreArea] Move failed at (${x}, ${z}): ${moveErr}`);
        // Skip this point and continue
        x += dx;
        z += dz;
        segmentPassed++;
        continue;
      }

      // Small delay to prevent overwhelming the connection
      await new Promise(resolve => setTimeout(resolve, 100));

      // Abort enderman hunt if it becomes daytime (endermen despawn in sunlight)
      if (target?.toLowerCase() === "enderman") {
        const timeBot = botManager.getBot(username);
        if (timeBot) {
          const timeOfDay = timeBot.time?.timeOfDay ?? 0;
          if (timeOfDay < 12541 || timeOfDay > 23458) {
            return `Enderman hunt ended: daytime started (time: ${timeOfDay}). Explored ${visitedPoints} points. Findings: ${findings.length > 0 ? findings.join(", ") : "none"}. Wait for night or do other tasks.`;
          }
        }
      }

      // Categorize target type to avoid false matches
      const knownBiomes = ["plains", "forest", "taiga", "desert", "savanna", "jungle", "swamp", "mountains", "ocean", "river", "beach", "snowy", "ice", "mushroom", "nether", "end"];
      const knownEntities = ["cow", "pig", "chicken", "sheep", "rabbit", "horse", "donkey", "cat", "ocelot", "parrot", "wolf", "llama", "turtle", "panda", "fox", "bee", "axolotl", "frog", "goat", "zombie", "skeleton", "spider", "creeper", "enderman"];

      const isBiomeSearch = target && knownBiomes.some(b => target.toLowerCase().includes(b));
      const isEntitySearch = target && knownEntities.some(e => target.toLowerCase().includes(e) || e.includes(target.toLowerCase()));

      // Check biome (only if explicitly searching for biome)
      if (isBiomeSearch) {
        const biome = await botManager.getBiome(username);
        if (biome.includes(target)) {
          findings.push(`${target} biome at (${x}, ${z})`);
        }
      }

      // Check for target block (only if not searching for entity)
      if (target && !isEntitySearch) {
        const blockResult = botManager.findBlock(username, target, 16);
        if (!blockResult.includes("No") && !blockResult.includes("not found")) {
          findings.push(`${target} block at current location`);
        }
      }

      // Check for target entity (skip "passive" keyword as it matches items too)
      if (target && target !== "passive" && target !== "hostile" && target !== "all") {
        const entityResult = botManager.findEntities(username, target, 32);
        // Only count as found if NOT starting with "No" (avoid false positives)
        if (entityResult.includes(target) && !entityResult.startsWith("No")) {
          findings.push(`${target} entity at current location`);

          // Auto-fight hostile mobs when found during exploration (especially enderman)
          const combatTargets = ["enderman", "blaze", "zombie", "skeleton", "spider", "creeper"];
          if (combatTargets.some(mob => target.toLowerCase().includes(mob))) {
            // Loop: fight all nearby targets of this type, not just one
            let fightCount = 0;
            const maxFights = 5; // Safety limit per exploration step
            while (fightCount < maxFights) {
              const checkResult = botManager.findEntities(username, target, 32);
              if (!checkResult.includes(target) || checkResult.startsWith("No")) break;

              console.error(`[ExploreArea] Found ${target} (#${fightCount + 1}) — auto-engaging in combat!`);
              try {
                const fightResult = await botManager.attack(username, target);
                findings.push(`Combat #${fightCount + 1}: ${fightResult}`);
                fightCount++;
                // Eat between fights if HP or hunger is low
                const botAfterFight = botManager.getBot(username);
                if (botAfterFight) {
                  const botHealth = botAfterFight.health ?? 20;
                  if (botHealth <= 12) {
                    console.error(`[ExploreArea] HP low after combat, stopping fight chain`);
                    break;
                  }
                  if (botHealth < 18 && botAfterFight.food < 20) {
                    try {
                      await botManager.eat(username);
                      console.error(`[ExploreArea] Ate food between fights (HP: ${botHealth})`);
                    } catch (_) { /* no food available */ }
                  }
                }
              } catch (fightErr) {
                console.error(`[ExploreArea] Combat failed: ${fightErr}`);
                findings.push(`Combat attempted but failed: ${fightErr}`);
                break;
              }
            }
            if (fightCount > 0) {
              console.error(`[ExploreArea] Fought ${fightCount} ${target}(s) at this location`);
            }
          }
        }
      } else if (target === "passive") {
        // For passive mobs, filter out dropped items
        const entityResult = botManager.findEntities(username, "passive", 16);
        const passiveMobs = ["cow", "pig", "chicken", "sheep", "rabbit", "horse", "donkey", "cat", "ocelot", "parrot", "wolf", "llama", "turtle", "panda", "fox", "bee", "axolotl", "frog", "goat"];
        for (const mobType of passiveMobs) {
          if (entityResult.includes(mobType)) {
            findings.push(`${mobType} at current location`);
          }
        }
      }

      // Defensive combat: fight back if a hostile mob is close (attacking us)
      // Exclude creepers — fighting them at close range causes explosions, flee instead
      const botObj = botManager.getBot(username);
      if (botObj) {
        // Flee if HP is dangerously low
        if (botObj.health <= 8) {
          console.error(`[ExploreArea] HP critically low (${botObj.health.toFixed(1)}), fleeing!`);
          try { await botManager.flee(username, 20); } catch (_) {}
          // Try to eat while fleeing
          try { await botManager.eat(username); } catch (_) {}
          return `Exploration aborted at ${visitedPoints} points due to critical HP (${botObj.health.toFixed(1)}/20). Flee and eat! Findings: ${findings.length > 0 ? findings.join(", ") : "none"}`;
        }

        if (botObj.health < 18) {
          // Flee from nearby creepers and ghasts (don't try to melee these)
          const fleeTarget = Object.values(botObj.entities)
            .find(e => e !== botObj.entity && (e.name === "creeper" || e.name === "ghast") && e.position.distanceTo(botObj.entity.position) < 12);
          if (fleeTarget) {
            console.error(`[ExploreArea] ${fleeTarget.name} nearby at ${fleeTarget.position.distanceTo(botObj.entity.position).toFixed(1)} blocks — fleeing!`);
            try { await botManager.flee(username, 15); } catch (_) {}
          } else {
            const nearHostile = Object.values(botObj.entities)
              .filter(e => e !== botObj.entity && e.name && e.position.distanceTo(botObj.entity.position) < 8)
              .filter(e => ["zombie", "skeleton", "spider", "drowned", "husk", "stray", "wither_skeleton", "piglin_brute", "blaze", "magma_cube", "hoglin"].includes(e.name || ""))
              .sort((a, b) => a.position.distanceTo(botObj.entity.position) - b.position.distanceTo(botObj.entity.position))[0];
            if (nearHostile) {
              console.error(`[ExploreArea] Defensive: ${nearHostile.name} at ${nearHostile.position.distanceTo(botObj.entity.position).toFixed(1)} blocks, fighting back!`);
              try {
                await botManager.attack(username, nearHostile.name);
              } catch (_) { /* ignore combat errors */ }
            }
          }
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

      // No need for additional break - loop condition handles it

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

/**
 * Validate if the environment has sufficient food sources for survival
 * Checks for: passive mobs, edible plants, and fishing viability
 * Returns a report with viability status and recommendations
 */
export async function minecraft_validate_survival_environment(
  username: string,
  searchRadius: number = 100
): Promise<string> {
  console.error(`[ValidateEnvironment] Checking survival viability within ${searchRadius} blocks`);

  // Check if bot is critically low on health - validation takes time and bot might die
  const initialStatus = botManager.getStatus(username);
  console.error(`[ValidateEnvironment] Current status: ${initialStatus}`);
  try {
    const statusObj = JSON.parse(initialStatus);
    const healthMatch = statusObj.health?.match(/([\d.]+)\//);
    const health = healthMatch ? parseFloat(healthMatch[1]) : null;
    console.error(`[ValidateEnvironment] Parsed health: ${health}`);
    if (health !== null && health < 10.0) {
      console.error(`[ValidateEnvironment] SKIPPING - health too low: ${health} HP`);
      return `\n⚠️ VALIDATION SKIPPED: Bot health too low (${health} HP)\nBot may die during validation. Please heal first or use creative mode.`;
    }
  } catch (e) {
    console.error(`[ValidateEnvironment] Error parsing status:`, e);
    // Continue if status parsing fails
  }

  const findings: string[] = [];
  let foodSourcesFound = 0;

  // Check for passive mobs (primary food source)
  // Use smaller search radius initially to avoid timeout
  const quickSearchRadius = Math.min(searchRadius, 50);
  const passiveMobs = ["cow", "pig", "chicken", "sheep", "rabbit"];
  for (const mobType of passiveMobs) {
    // Check if bot still connected (avoid timeout issues)
    if (!botManager.isConnected(username)) {
      console.error(`[ValidateEnvironment] Bot disconnected during validation`);
      break;
    }

    const entityResult = botManager.findEntities(username, mobType, quickSearchRadius);
    if (!entityResult.startsWith("No") && entityResult.includes(mobType)) {
      findings.push(`✅ Found ${mobType} (huntable food)`);
      foodSourcesFound++;
      // Early exit if we found food
      if (foodSourcesFound >= 2) break;
    }
  }

  // Check for edible plants (only if no mobs found)
  if (foodSourcesFound < 2) {
    const ediblePlants = ["sweet_berry_bush", "melon", "kelp", "wheat", "carrots", "potatoes"];
    for (const plantType of ediblePlants) {
      // Check if bot still connected
      if (!botManager.isConnected(username)) {
        console.error(`[ValidateEnvironment] Bot disconnected during validation`);
        break;
      }

      const blockResult = botManager.findBlock(username, plantType, quickSearchRadius);
      if (!blockResult.includes("No") && !blockResult.includes("not found")) {
        findings.push(`✅ Found ${plantType} (harvestable food)`);
        foodSourcesFound++;
        // Early exit if we found enough food sources
        if (foodSourcesFound >= 2) break;
      }
    }
  }

  // Check for fishing viability (water + string for fishing rod) - only if still need food sources
  if (foodSourcesFound < 2 && botManager.isConnected(username)) {
    const waterResult = botManager.findBlock(username, "water", quickSearchRadius);
    const hasWater = !waterResult.includes("No") && !waterResult.includes("not found");

    if (hasWater) {
      const inventory = botManager.getInventory(username);
      const hasString = inventory.some(item => item.name === "string");
      const hasSticks = inventory.some(item => item.name === "stick");

      if (hasString && hasSticks) {
        findings.push("✅ Fishing viable (water + string + sticks)");
        foodSourcesFound++;
      } else if (hasSticks) {
        findings.push("⚠️ Water found but missing string for fishing rod");
      }
    }
  }

  // Generate viability report
  const status = botManager.getStatus(username);
  let currentHunger = 20;
  try {
    const statusObj = JSON.parse(status);
    const hungerMatch = statusObj.hunger?.match(/([\d.]+)\//);
    if (hungerMatch) currentHunger = parseFloat(hungerMatch[1]);
  } catch (e) {
    // Ignore parse errors
  }

  const header = `\n=== SURVIVAL ENVIRONMENT VALIDATION ===\nCurrent Hunger: ${currentHunger}/20\nSearch Radius: ${quickSearchRadius} blocks (optimized for performance)\n`;

  if (foodSourcesFound === 0) {
    // If hunger is not critically low, treat as warning instead of CRITICAL
    // Bot might have food in inventory or can explore to find food
    if (currentHunger > 10) {
      return header +
        `\n⚠️ WARNING: NO IMMEDIATE FOOD SOURCES DETECTED\n` +
        `\nFindings:\n- No passive mobs found in ${quickSearchRadius} block radius\n- No edible plants found\n- No fishing viability\n` +
        `\nCurrent Status: Hunger at ${currentHunger}/20 - not critical yet\n` +
        `\nRecommendations:\n` +
        `1. Check inventory for existing food\n` +
        `2. Explore beyond ${quickSearchRadius} blocks to find food sources\n` +
        `3. If persistent, check server configuration (mob spawning may be disabled)`;
    }

    return header +
      `\n❌ CRITICAL: NO FOOD SOURCES DETECTED\n` +
      `\nFindings:\n- No passive mobs found\n- No edible plants found\n- No fishing viability\n` +
      `\n⚠️ WARNING: Survival may be impossible in this environment!\n` +
      `\nRecommendations:\n` +
      `1. Check server configuration (mob spawning may be disabled)\n` +
      `2. Move to a different area with /tp command\n` +
      `3. Use creative mode or /give commands to obtain food\n` +
      `4. Enable mob spawning in server.properties (spawn-monsters=true, spawn-animals=true)`;
  } else if (foodSourcesFound < 2) {
    return header +
      `\n⚠️ LIMITED FOOD SOURCES (${foodSourcesFound} type found)\n` +
      `\nFindings:\n${findings.join("\n")}\n` +
      `\nStatus: Survival possible but challenging. Food scarcity may occur.`;
  } else {
    return header +
      `\n✅ ENVIRONMENT VIABLE (${foodSourcesFound} food source types found)\n` +
      `\nFindings:\n${findings.join("\n")}\n` +
      `\nStatus: Good survival conditions detected.`;
  }
}
