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

  return `Resource gathering complete. ${results.join(", ")}. Inventory: ${invStr}`;
}

/**
 * Build predefined structures (shelter, wall, platform, tower)
 * Levels ground first, then constructs the structure
 */
export async function minecraft_build_structure(
  username: string,
  type: "shelter" | "wall" | "platform" | "tower",
  size: "small" | "medium" | "large",
  materials?: string
): Promise<string> {
  const position = botManager.getPosition(username);
  const centerX = Math.floor(position.x);
  const centerY = Math.floor(position.y);
  const centerZ = Math.floor(position.z);

  console.error(`[BuildStructure] Building ${size} ${type} at (${centerX}, ${centerY}, ${centerZ})`);

  // Determine dimensions based on size
  const dimensions: Record<string, { width: number; height: number; length: number }> = {
    small: { width: 3, height: 3, length: 3 },
    medium: { width: 5, height: 4, length: 5 },
    large: { width: 7, height: 5, length: 7 }
  };

  const dim = dimensions[size];

  // Auto-select building material if not specified
  let buildMaterial = materials;
  if (!buildMaterial) {
    const inventory = botManager.getInventory(username);
    const candidates = ["cobblestone", "planks", "oak_planks", "stone", "dirt", "wood"];
    for (const candidate of candidates) {
      const item = inventory.find(i => i.name.includes(candidate));
      if (item && item.count > 20) {
        buildMaterial = item.name;
        break;
      }
    }
  }

  if (!buildMaterial) {
    return "No suitable building materials found in inventory. Need at least 20 blocks (cobblestone, planks, stone, dirt, or wood).";
  }

  console.error(`[BuildStructure] Using material: ${buildMaterial}`);

  // Level ground first
  try {
    const levelResult = await botManager.levelGround(username, {
      centerX,
      centerZ,
      radius: Math.ceil(dim.width / 2) + 1,
      targetY: centerY,
      fillBlock: buildMaterial,
      mode: "both"
    });
    console.error(`[BuildStructure] Ground leveling: ${levelResult}`);
  } catch (err) {
    console.error(`[BuildStructure] Ground leveling failed: ${err}`);
  }

  let blocksPlaced = 0;
  const errors: string[] = [];

  try {
    switch (type) {
      case "shelter":
        // Build 4 walls and a roof
        // Floor
        for (let x = -Math.floor(dim.width / 2); x <= Math.floor(dim.width / 2); x++) {
          for (let z = -Math.floor(dim.length / 2); z <= Math.floor(dim.length / 2); z++) {
            try {
              await botManager.placeBlock(username, buildMaterial, centerX + x, centerY, centerZ + z);
              blocksPlaced++;
            } catch (err) {
              errors.push(`Floor (${centerX + x}, ${centerY}, ${centerZ + z}): ${err}`);
            }
          }
        }

        // Walls
        for (let y = 1; y <= dim.height; y++) {
          for (let x = -Math.floor(dim.width / 2); x <= Math.floor(dim.width / 2); x++) {
            for (let z = -Math.floor(dim.length / 2); z <= Math.floor(dim.length / 2); z++) {
              // Only place blocks on the perimeter
              if (x === -Math.floor(dim.width / 2) || x === Math.floor(dim.width / 2) ||
                  z === -Math.floor(dim.length / 2) || z === Math.floor(dim.length / 2)) {
                // Leave a door opening on one wall
                if (y === 1 && x === 0 && z === -Math.floor(dim.length / 2)) {
                  continue; // Door opening
                }
                try {
                  await botManager.placeBlock(username, buildMaterial, centerX + x, centerY + y, centerZ + z);
                  blocksPlaced++;
                } catch (err) {
                  errors.push(`Wall (${centerX + x}, ${centerY + y}, ${centerZ + z}): ${err}`);
                }
              }
            }
          }
        }

        // Roof
        for (let x = -Math.floor(dim.width / 2); x <= Math.floor(dim.width / 2); x++) {
          for (let z = -Math.floor(dim.length / 2); z <= Math.floor(dim.length / 2); z++) {
            try {
              await botManager.placeBlock(username, buildMaterial, centerX + x, centerY + dim.height + 1, centerZ + z);
              blocksPlaced++;
            } catch (err) {
              errors.push(`Roof (${centerX + x}, ${centerY + dim.height + 1}, ${centerZ + z}): ${err}`);
            }
          }
        }
        break;

      case "wall":
        // Build a straight wall
        for (let y = 0; y < dim.height; y++) {
          for (let x = 0; x < dim.width; x++) {
            try {
              await botManager.placeBlock(username, buildMaterial, centerX + x, centerY + y, centerZ);
              blocksPlaced++;
            } catch (err) {
              errors.push(`Wall (${centerX + x}, ${centerY + y}, ${centerZ}): ${err}`);
            }
          }
        }
        break;

      case "platform":
        // Build a flat platform
        for (let x = -Math.floor(dim.width / 2); x <= Math.floor(dim.width / 2); x++) {
          for (let z = -Math.floor(dim.length / 2); z <= Math.floor(dim.length / 2); z++) {
            try {
              await botManager.placeBlock(username, buildMaterial, centerX + x, centerY, centerZ + z);
              blocksPlaced++;
            } catch (err) {
              errors.push(`Platform (${centerX + x}, ${centerY}, ${centerZ + z}): ${err}`);
            }
          }
        }
        break;

      case "tower":
        // Build a vertical tower
        for (let y = 0; y < dim.height; y++) {
          // Create a hollow tower (walls only)
          for (let x = -1; x <= 1; x++) {
            for (let z = -1; z <= 1; z++) {
              // Only place blocks on the perimeter
              if (x === -1 || x === 1 || z === -1 || z === 1) {
                try {
                  await botManager.placeBlock(username, buildMaterial, centerX + x, centerY + y, centerZ + z);
                  blocksPlaced++;
                } catch (err) {
                  errors.push(`Tower (${centerX + x}, ${centerY + y}, ${centerZ + z}): ${err}`);
                }
              }
            }
          }
        }
        break;
    }
  } catch (err) {
    return `Structure building interrupted: ${err}. Placed ${blocksPlaced} blocks before error.`;
  }

  const errorSummary = errors.length > 0 ? ` Errors: ${errors.length} (first: ${errors[0]})` : "";
  return `Built ${size} ${type} with ${buildMaterial}. Placed ${blocksPlaced} blocks.${errorSummary}`;
}

/**
 * Craft items in the correct order, with optional automatic material gathering
 * Calculates recipe dependencies and crafts in sequence
 */
export async function minecraft_craft_chain(
  username: string,
  target: string,
  autoGather: boolean = false
): Promise<string> {
  console.error(`[CraftChain] Target: ${target}, autoGather: ${autoGather}`);

  // Define crafting chains for common items
  const craftingChains: Record<string, Array<{ item: string; count: number; needs?: Array<{ item: string; count: number }> }>> = {
    "wooden_pickaxe": [
      { item: "oak_planks", count: 3, needs: [{ item: "oak_log", count: 1 }] },
      { item: "stick", count: 2, needs: [{ item: "oak_planks", count: 1 }] },
      { item: "wooden_pickaxe", count: 1 }
    ],
    "stone_pickaxe": [
      { item: "stick", count: 2 },
      { item: "stone_pickaxe", count: 1, needs: [{ item: "cobblestone", count: 3 }, { item: "stick", count: 2 }] }
    ],
    "iron_pickaxe": [
      { item: "stick", count: 2 },
      { item: "iron_ingot", count: 3, needs: [{ item: "iron_ore", count: 3 }] },
      { item: "iron_pickaxe", count: 1 }
    ],
    "crafting_table": [
      { item: "oak_planks", count: 4, needs: [{ item: "oak_log", count: 1 }] },
      { item: "crafting_table", count: 1 }
    ],
    "furnace": [
      { item: "furnace", count: 1, needs: [{ item: "cobblestone", count: 8 }] }
    ],
    "torch": [
      { item: "stick", count: 1 },
      { item: "torch", count: 4, needs: [{ item: "coal", count: 1 }, { item: "stick", count: 1 }] }
    ]
  };

  const chain = craftingChains[target];
  if (!chain) {
    // If no predefined chain, try to craft directly
    try {
      const result = await botManager.craftItem(username, target, 1);
      return result;
    } catch (err) {
      return `No crafting chain defined for ${target} and direct craft failed: ${err}`;
    }
  }

  const results: string[] = [];

  for (const step of chain) {
    console.error(`[CraftChain] Step: craft ${step.item} x${step.count}`);

    // Check if we need to gather materials
    if (autoGather && step.needs) {
      for (const need of step.needs) {
        const inventory = botManager.getInventory(username);
        const currentCount = inventory.find(i => i.name === need.item)?.count || 0;

        if (currentCount < need.count) {
          const shortage = need.count - currentCount;
          console.error(`[CraftChain] Need ${shortage} more ${need.item}, attempting to gather...`);

          try {
            const gatherResult = await minecraft_gather_resources(
              username,
              [{ name: need.item, count: shortage }],
              32
            );
            results.push(`Gathered: ${gatherResult}`);
          } catch (err) {
            return `Failed to gather ${need.item}: ${err}. Crafting chain aborted.`;
          }
        }
      }
    }

    // Check if item needs smelting (iron_ingot from iron_ore)
    if (step.item === "iron_ingot" && step.needs) {
      try {
        const oreNeed = step.needs.find(n => n.item === "iron_ore");
        if (oreNeed) {
          const smeltResult = await botManager.smeltItem(username, "iron_ore", oreNeed.count);
          results.push(`Smelted: ${smeltResult}`);
        }
      } catch (err) {
        return `Failed to smelt iron_ore: ${err}`;
      }
    } else {
      // Normal crafting
      try {
        const craftResult = await botManager.craftItem(username, step.item, step.count);
        results.push(`Crafted: ${craftResult}`);
      } catch (err) {
        return `Failed to craft ${step.item}: ${err}. Chain aborted at this step. Results so far: ${results.join("; ")}`;
      }
    }
  }

  const inventory = botManager.getInventory(username);
  const invStr = inventory.map(i => `${i.name}(${i.count})`).join(", ");

  return `Crafting chain complete for ${target}. ${results.join("; ")}. Inventory: ${invStr}`;
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

  console.error(`[SurvivalRoutine] Status: ${status}`);

  // Parse hunger from status
  const hungerMatch = status.match(/Food:\s*(\d+\.?\d*)/);
  const hunger = hungerMatch ? parseFloat(hungerMatch[1]) : 20;

  // Auto-detect priority based on current state
  let actualPriority = priority;
  if (priority === "auto") {
    if (hunger < 10) {
      actualPriority = "food";
    } else if (!inventory.some(i => i.name.includes("pickaxe"))) {
      actualPriority = "tools";
    } else {
      actualPriority = "shelter";
    }
  }

  console.error(`[SurvivalRoutine] Executing priority: ${actualPriority}`);

  switch (actualPriority) {
    case "food":
      // Find and gather food sources
      const foodSources = ["apple", "beetroot", "carrot", "potato", "melon", "pumpkin", "beef", "porkchop", "chicken", "mutton"];

      // First check for animals nearby
      const entities = botManager.findEntities(username, "passive", 32);

      if (entities.includes("cow") || entities.includes("pig") || entities.includes("chicken") || entities.includes("sheep")) {
        // Try to hunt animals
        console.error(`[SurvivalRoutine] Found animals, attempting to hunt...`);

        try {
          // Equip weapon if available
          const weapon = inventory.find(i => i.name.includes("sword") || i.name.includes("axe"));
          if (weapon) {
            await botManager.equipItem(username, weapon.name);
          }

          // Attack nearby passive mob for food
          const attackResult = await botManager.attack(username, "cow");

          // Collect drops
          await botManager.collectNearbyItems(username);

          // Try to cook if we have furnace and fuel
          const rawMeat = inventory.find(i => i.name.includes("beef") || i.name.includes("porkchop") || i.name.includes("chicken") || i.name.includes("mutton"));
          if (rawMeat) {
            try {
              await botManager.smeltItem(username, rawMeat.name, Math.min(rawMeat.count, 5));
            } catch (err) {
              console.error(`[SurvivalRoutine] Could not cook meat: ${err}`);
            }
          }

          return `Hunted animals for food. ${attackResult}. Check inventory for raw/cooked meat.`;
        } catch (err) {
          console.error(`[SurvivalRoutine] Hunting failed: ${err}`);
        }
      }

      // Fall back to gathering plant-based food
      for (const food of foodSources) {
        try {
          const gatherResult = await minecraft_gather_resources(username, [{ name: food, count: 5 }], 32);
          return `Food gathering: ${gatherResult}`;
        } catch (err) {
          console.error(`[SurvivalRoutine] Could not gather ${food}: ${err}`);
        }
      }

      return "No food sources found nearby. Explore further or hunt animals.";

    case "shelter":
      // Build basic shelter
      const hasShelter = inventory.some(i => i.name === "bed");

      if (!hasShelter) {
        // Need to craft bed first (requires wool and planks)
        const hasWool = inventory.some(i => i.name.includes("wool"));
        const hasPlanks = inventory.some(i => i.name.includes("planks"));

        if (!hasWool) {
          // Need to find sheep and shear them
          const sheepResult = botManager.findEntities(username, "sheep", 64);
          if (sheepResult.includes("sheep")) {
            return "Found sheep nearby. Craft shears (2 iron_ingot) first, then use minecraft_craft_chain for 'bed'.";
          }
        }

        if (hasWool && hasPlanks) {
          try {
            await botManager.craftItem(username, "bed", 1);
          } catch (err) {
            console.error(`[SurvivalRoutine] Could not craft bed: ${err}`);
          }
        }
      }

      // Build shelter structure
      try {
        const buildResult = await minecraft_build_structure(username, "shelter", "small");
        return `Shelter routine: ${buildResult}`;
      } catch (err) {
        return `Shelter building failed: ${err}`;
      }

    case "tools":
      // Craft basic tool set
      const hasPickaxe = inventory.some(i => i.name.includes("pickaxe"));
      const hasAxe = inventory.some(i => i.name.includes("axe"));
      const hasShovel = inventory.some(i => i.name.includes("shovel"));

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
          const axeResult = await botManager.craftItem(username, "wooden_axe", 1);
          results.push(`Axe: ${axeResult}`);
        } catch (err) {
          console.error(`[SurvivalRoutine] Axe crafting failed: ${err}`);
        }
      }

      if (!hasShovel) {
        try {
          const shovelResult = await botManager.craftItem(username, "wooden_shovel", 1);
          results.push(`Shovel: ${shovelResult}`);
        } catch (err) {
          console.error(`[SurvivalRoutine] Shovel crafting failed: ${err}`);
        }
      }

      return `Tool crafting routine: ${results.join("; ")}`;

    default:
      return `Unknown priority: ${actualPriority}`;
  }
}

/**
 * Explore the area in a spiral pattern looking for specific biomes, structures, or resources
 * Reports findings and returns to starting position if desired
 */
export async function minecraft_explore_area(
  username: string,
  radius: number,
  target?: string
): Promise<string> {
  const startPos = botManager.getPosition(username);
  const startX = Math.floor(startPos.x);
  const startZ = Math.floor(startPos.z);

  console.error(`[ExploreArea] Starting exploration from (${startX}, ${startZ}), radius: ${radius}, target: ${target || "any"}`);

  const findings: string[] = [];
  let currentX = startX;
  let currentZ = startZ;
  let step = 1;
  let direction = 0; // 0: +X, 1: +Z, 2: -X, 3: -Z

  // Spiral pattern exploration
  const maxSteps = Math.ceil(radius / 5);

  for (let i = 0; i < maxSteps; i++) {
    for (let turn = 0; turn < 2; turn++) {
      for (let s = 0; s < step; s++) {
        // Calculate next position based on direction
        switch (direction) {
          case 0: currentX += 5; break; // East
          case 1: currentZ += 5; break; // South
          case 2: currentX -= 5; break; // West
          case 3: currentZ -= 5; break; // North
        }

        // Check if out of bounds
        const distFromStart = Math.sqrt(
          Math.pow(currentX - startX, 2) + Math.pow(currentZ - startZ, 2)
        );

        if (distFromStart > radius) {
          console.error(`[ExploreArea] Reached exploration radius limit`);
          const returnMsg = `Exploration complete. Visited ${findings.length} points. ` +
            (findings.length > 0 ? `Findings: ${findings.join(", ")}` : "No notable findings.");
          return returnMsg;
        }

        try {
          // Move to next exploration point
          const moveResult = await botManager.moveTo(username, currentX, startPos.y, currentZ);

          if (!moveResult.includes("Reached") && !moveResult.includes("Moved")) {
            console.error(`[ExploreArea] Move failed: ${moveResult}`);
            continue;
          }

          // Check biome at current location
          const biome = await botManager.getBiome(username);
          console.error(`[ExploreArea] At (${currentX}, ${currentZ}), biome: ${biome}`);

          // Check for target if specified
          if (target) {
            if (biome.toLowerCase().includes(target.toLowerCase())) {
              findings.push(`${target} biome at (${currentX}, ${currentZ})`);
            }

            // Check for target block
            const blockSearch = botManager.findBlock(username, target, 32);
            if (!blockSearch.includes("No") && !blockSearch.includes("not found")) {
              findings.push(`${target} block at current location`);
            }

            // Check for target entity
            const entitySearch = botManager.findEntities(username, target, 32);
            if (!entitySearch.includes("No") && !entitySearch.includes("not found")) {
              findings.push(`${target} entity at current location`);
            }
          } else {
            // General exploration - report interesting findings
            const surroundings = botManager.getSurroundings(username);
            if (surroundings.includes("diamond") || surroundings.includes("emerald") ||
                surroundings.includes("ancient_debris") || surroundings.includes("village")) {
              findings.push(`Interesting: ${surroundings.substring(0, 100)} at (${currentX}, ${currentZ})`);
            }
          }

          // Small delay between moves
          await new Promise(resolve => setTimeout(resolve, 500));

        } catch (err) {
          console.error(`[ExploreArea] Error at (${currentX}, ${currentZ}): ${err}`);
        }
      }

      direction = (direction + 1) % 4; // Turn right
    }

    step++;
  }

  const returnMsg = `Exploration complete. Visited ${maxSteps * 4} points. ` +
    (findings.length > 0 ? `Findings: ${findings.join(", ")}` : "No notable findings.");

  return returnMsg;
}
