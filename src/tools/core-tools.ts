/**
 * Tier 1 Core Tools - 10 unified tools that replace 48+ individual tools
 *
 * Each tool is "one meaningful action" - not too granular (dig_block),
 * not too orchestrated (day1_boot_sequence).
 *
 * mc_status, mc_gather, mc_craft, mc_build, mc_navigate,
 * mc_combat, mc_eat, mc_store, mc_chat, mc_connect
 */

import { botManager } from "../bot-manager/index.js";
import { checkDangerNearby } from "../bot-manager/minecraft-utils.js";
import { setAgentType } from "../agent-state.js";
import { registry } from "../tool-handler-registry.js";

// High-level actions accessed via registry for hot-reload support
function getHighLevel() {
  return registry.highLevel as {
    minecraft_gather_resources: Function;
    minecraft_build_structure: Function;
    minecraft_craft_chain: Function;
  };
}

// ─── mc_status ───────────────────────────────────────────────────────────────

export async function mc_status(): Promise<string> {
  const username = botManager.requireSingleBot();
  const bot = botManager.getBot(username);
  if (!bot) throw new Error("Not connected");

  const pos = bot.entity.position;
  const health = bot.health ?? 0;
  const food = bot.food ?? 0;
  const timeOfDay = bot.time?.timeOfDay ?? 0;

  // Time phase
  let timePhase: string;
  if (timeOfDay < 6000) timePhase = "morning";
  else if (timeOfDay < 12000) timePhase = "day";
  else if (timeOfDay < 12541) timePhase = "sunset";
  else if (timeOfDay < 17843) timePhase = "night";
  else if (timeOfDay < 23458) timePhase = "midnight";
  else timePhase = "dawn";

  // Equipment
  const handItem = bot.heldItem?.name ?? "empty";
  const armorItems: string[] = [];
  if (bot.inventory) {
    // Armor slots: 5=helmet, 6=chestplate, 7=leggings, 8=boots
    for (const slot of [5, 6, 7, 8]) {
      const item = bot.inventory.slots[slot];
      if (item) armorItems.push(item.name);
    }
  }

  // Inventory categorized
  const inventory = botManager.getInventory(username);
  const tools: string[] = [];
  const foodItems: string[] = [];
  const materials: string[] = [];
  const toolSuffixes = ["_pickaxe", "_axe", "_sword", "_shovel", "_hoe", "fishing_rod", "shield", "bow", "crossbow", "shears", "flint_and_steel"];
  const foodNames = new Set([
    "bread", "cooked_beef", "cooked_porkchop", "cooked_chicken", "cooked_mutton",
    "cooked_rabbit", "cooked_cod", "cooked_salmon", "baked_potato", "golden_apple",
    "golden_carrot", "apple", "melon_slice", "sweet_berries", "carrot", "potato",
    "beetroot", "cookie", "pumpkin_pie", "cake", "mushroom_stew", "rabbit_stew",
    "beef", "porkchop", "chicken", "mutton", "rabbit", "cod", "salmon",
    "rotten_flesh", "spider_eye", "poisonous_potato",
  ]);

  for (const item of inventory) {
    const isTool = toolSuffixes.some(s => item.name.includes(s));
    if (isTool) {
      tools.push(item.name);
    } else if (foodNames.has(item.name)) {
      foodItems.push(`${item.name} x${item.count}`);
    } else {
      materials.push(`${item.name} x${item.count}`);
    }
  }

  // Threats
  const danger = checkDangerNearby(bot, 16);
  const threats: Array<{ type: string; distance: number; direction: string }> = [];
  if (danger.dangerous && danger.nearestHostile) {
    // Get all hostiles from nearby entities
    const entities = Object.values(bot.entities);
    for (const entity of entities) {
      if (!entity || !entity.position || entity === bot.entity) continue;
      const dist = entity.position.distanceTo(bot.entity.position);
      if (dist > 16) continue;
      // Check if hostile (has entity type or name matching common hostiles)
      const name = entity.name ?? (entity as any).username ?? "unknown";
      const hostileNames = ["zombie", "skeleton", "creeper", "spider", "enderman", "witch", "pillager", "vindicator", "phantom", "drowned", "husk", "stray", "blaze", "ghast", "wither_skeleton", "piglin_brute"];
      if (hostileNames.some(h => name.toLowerCase().includes(h))) {
        const dx = entity.position.x - pos.x;
        const dz = entity.position.z - pos.z;
        let dir = "";
        if (Math.abs(dz) > Math.abs(dx)) {
          dir = dz < 0 ? "north" : "south";
        } else {
          dir = dx > 0 ? "east" : "west";
        }
        threats.push({ type: name, distance: Math.round(dist * 10) / 10, direction: dir });
      }
    }
  }

  // Nearby resources (scan for common blocks)
  const nearbyResources: string[] = [];
  const resourceBlocks = ["oak_log", "birch_log", "spruce_log", "coal_ore", "iron_ore", "diamond_ore", "gold_ore", "crafting_table", "furnace"];
  for (const blockName of resourceBlocks) {
    try {
      const result = await botManager.findBlock(username, blockName, 16);
      if (result && typeof result === "string" && !result.includes("No ") && !result.includes("not found")) {
        const distMatch = result.match(/distance: ([\d.]+)/i) || result.match(/([\d.]+)m/);
        const dist = distMatch ? `${Math.round(parseFloat(distMatch[1]))}m` : "nearby";
        nearbyResources.push(`${blockName}(${dist})`);
      }
    } catch {
      // Skip blocks that error
    }
  }

  // Infrastructure
  const infra: Record<string, [number, number, number] | null> = {
    crafting_table: null,
    furnace: null,
  };
  const chests: Array<[number, number, number]> = [];

  for (const infraBlock of ["crafting_table", "furnace", "chest"]) {
    try {
      const result = await botManager.findBlock(username, infraBlock, 32);
      if (result && typeof result === "string" && !result.includes("No ") && !result.includes("not found")) {
        const posMatch = result.match(/\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/);
        if (posMatch) {
          const coords: [number, number, number] = [
            Math.floor(parseFloat(posMatch[1])),
            Math.floor(parseFloat(posMatch[2])),
            Math.floor(parseFloat(posMatch[3])),
          ];
          if (infraBlock === "chest") {
            chests.push(coords);
          } else {
            infra[infraBlock] = coords;
          }
        }
      }
    } catch {
      // Skip
    }
  }

  // Biome
  let biome = "unknown";
  try {
    biome = await botManager.getBiome(username);
  } catch {
    // Ignore
  }

  const result = {
    health: Math.round(health * 10) / 10,
    hunger: Math.round(food * 10) / 10,
    position: {
      x: Math.round(pos.x * 10) / 10,
      y: Math.round(pos.y * 10) / 10,
      z: Math.round(pos.z * 10) / 10,
    },
    biome,
    time: { ticks: timeOfDay, phase: timePhase },
    equipment: { hand: handItem, armor: armorItems },
    inventory: {
      tools,
      food: foodItems,
      materials,
      slots_used: inventory.length,
    },
    threats,
    nearby_resources: nearbyResources,
    infrastructure: {
      crafting_table: infra.crafting_table,
      furnace: infra.furnace,
      chests,
    },
  };

  return JSON.stringify(result, null, 2);
}

// ─── mc_gather ───────────────────────────────────────────────────────────────

export async function mc_gather(
  block: string,
  count: number = 1,
  maxDistance: number = 32
): Promise<string> {
  const username = botManager.requireSingleBot();

  // Special case: wheat — only harvest mature crops (age >= 7), never auto-farm.
  // Use mc_farm() explicitly to plant new crops. mc_gather('wheat') collects only.
  if (block === "wheat") {
    const bot = botManager.getBot(username);
    if (bot) {
      const { Vec3 } = await import("vec3");
      const matureWheat = bot.findBlocks({
        matching: (b: any) => {
          if (b.name !== "wheat") return false;
          const props = b.getProperties ? b.getProperties() : null;
          const age = props?.age ?? b.metadata ?? 0;
          return age >= 7;
        },
        maxDistance: maxDistance,
        count: count * 2,
      });
      if (matureWheat.length === 0) {
        return `No mature wheat found within ${maxDistance} blocks. Wheat crops need more time to grow (age 7/7). Use mc_farm() to plant new seeds.`;
      }
      // Harvest the mature wheat blocks directly
      let gathered = 0;
      const logs: string[] = [];
      for (const pos of matureWheat) {
        if (gathered >= count) break;
        try {
          await botManager.moveTo(username, pos.x, pos.y, pos.z);
          const wb = bot.blockAt(pos);
          if (wb && wb.name === "wheat") {
            await bot.dig(wb);
            await new Promise(r => setTimeout(r, 300));
            await botManager.collectNearbyItems(username);
            gathered++;
            logs.push(`Harvested wheat at (${pos.x},${pos.y},${pos.z})`);
          }
        } catch (e) {
          logs.push(`Failed at (${pos.x},${pos.y},${pos.z}): ${e}`);
        }
      }
      const inv = botManager.getInventory(username);
      const wheatInInv = inv.find(i => i.name === "wheat");
      return `Gathered ${gathered} wheat. ${logs.join("; ")}. Wheat in inventory: ${wheatInInv?.count ?? 0}`;
    }
  }

  // Global timeout: mc_gather should never take more than 120s total
  // Prevents infinite hang when pathfinder can't reach blocks (e.g. in caves)
  const GATHER_TIMEOUT_MS = 120000;
  const gatherPromise = getHighLevel().minecraft_gather_resources(username, [{ name: block, count }], maxDistance);
  const timeoutPromise = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error(`mc_gather timed out after ${GATHER_TIMEOUT_MS / 1000}s. Block "${block}" may be unreachable. Try moving to a different area first.`)), GATHER_TIMEOUT_MS)
  );
  try {
    return await Promise.race([gatherPromise, timeoutPromise]);
  } catch (e) {
    // Stop pathfinder on timeout
    try { botManager.getBot(username)?.pathfinder?.stop(); } catch (_) {}
    return e instanceof Error ? e.message : String(e);
  }
}

// ─── mc_craft ────────────────────────────────────────────────────────────────

export async function mc_craft(
  item: string,
  count: number = 1,
  autoGather: boolean = false
): Promise<string> {
  const username = botManager.requireSingleBot();

  // Items obtained by smelting — smelt all at once instead of looping craft_chain
  const SMELT_RAW: Record<string, string> = {
    iron_ingot: "raw_iron",
    gold_ingot: "raw_gold",
    copper_ingot: "raw_copper",
  };

  if (SMELT_RAW[item]) {
    const rawItem = SMELT_RAW[item];
    const inv = botManager.getInventory(username);
    const rawInInv = inv.find(i => i.name === rawItem);
    const need = count;
    if (rawInInv && rawInInv.count >= need) {
      return await botManager.smeltItem(username, rawItem, need);
    }
    // Not enough raw material in inventory — fall through to craft_chain for auto-gather
  }

  // Wrap entire craft operation in 180s timeout to prevent hangs (autoGather can trigger long gather loops)
  const CRAFT_TIMEOUT_MS = 180000;
  const craftPromise = async () => {
    if (count === 1) {
      return await getHighLevel().minecraft_craft_chain(username, item, autoGather);
    }

    // For count > 1 non-smelt items, craft multiple times
    const results: string[] = [];
    for (let i = 0; i < count; i++) {
      try {
        const result = await getHighLevel().minecraft_craft_chain(username, item, autoGather);
        results.push(result);
      } catch (err) {
        results.push(`Attempt ${i + 1} failed: ${err}`);
        break;
      }
    }

    const inventory = botManager.getInventory(username);
    const invStr = inventory.map(i => `${i.name}(${i.count})`).join(", ");
    return `Crafted ${item} x${count}. ${results.join("; ")}. Inventory: ${invStr}`;
  };

  try {
    return await Promise.race([
      craftPromise(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error(`mc_craft timed out after ${CRAFT_TIMEOUT_MS / 1000}s crafting ${item} x${count}`)), CRAFT_TIMEOUT_MS))
    ]);
  } catch (e) {
    try { botManager.getBot(username)?.pathfinder?.stop(); } catch (_) {}
    return e instanceof Error ? e.message : String(e);
  }
}

// ─── mc_farm ─────────────────────────────────────────────────────────────────
//
// Full farming sequence: till dirt → place crafting_table → plant seeds →
// apply bone_meal → harvest wheat → craft bread → eat.
// Requires: stone_hoe + wheat_seeds in inventory. Dirt is always available.
// Optional: bone_meal for instant growth.

export async function mc_farm(): Promise<string> {
  const username = botManager.requireSingleBot();
  const bot = botManager.getBot(username);
  if (!bot) throw new Error("Not connected");

  const logs: string[] = [];

  // Check for required items
  const inv = botManager.getInventory(username);
  const hasHoe = inv.some(i => i.name.includes("_hoe"));
  const seeds = inv.find(i => i.name.includes("_seeds"));
  const boneMeal = inv.find(i => i.name === "bone_meal");
  const hasCraftingTable = inv.some(i => i.name === "crafting_table");

  if (!hasHoe) {
    return "mc_farm: No hoe in inventory. Craft a stone_hoe first (2 cobblestone + 2 sticks).";
  }
  if (!seeds) {
    return "mc_farm: No seeds in inventory. Find wheat_seeds by breaking tall grass.";
  }

  const pos = bot.entity.position;
  const bx = Math.floor(pos.x);
  const by = Math.floor(pos.y);
  const bz = Math.floor(pos.z);

  // Step 1: Place crafting_table if not nearby
  const nearbyTable = bot.findBlock({
    matching: (b: any) => b.name === "crafting_table",
    maxDistance: 8,
  });
  if (!nearbyTable && hasCraftingTable) {
    try {
      const placeResult = await botManager.placeBlock(username, "crafting_table", bx + 1, by, bz);
      logs.push(`Placed crafting_table: ${placeResult.message}`);
    } catch (e) {
      logs.push(`Could not place crafting_table: ${e}`);
    }
  } else if (nearbyTable) {
    logs.push("Crafting table already nearby.");
  }

  // Step 2: Find actual dirt/grass blocks to till near the bot
  // Scan in a 5-block radius at ground level for tillable blocks
  const TILLABLE = new Set(["dirt", "grass_block", "coarse_dirt", "rooted_dirt", "farmland"]);
  const farmCoords: Array<{ x: number; y: number; z: number }> = [];
  const seedCount = Math.min(seeds.count, 4);

  // Search a 7x7 area around the bot for dirt blocks on the surface
  outer:
  for (let dx = -3; dx <= 3 && farmCoords.length < seedCount; dx++) {
    for (let dz = -3; dz <= 3 && farmCoords.length < seedCount; dz++) {
      const cx = bx + dx;
      const cz = bz + dz;
      // Scan Y from bot level down 5 to find ground
      for (let dy = 0; dy >= -5; dy--) {
        const cy = by + dy;
        const groundBlock = bot.blockAt(new (bot.entity.position.constructor as any)(cx, cy, cz));
        const aboveBlock = bot.blockAt(new (bot.entity.position.constructor as any)(cx, cy + 1, cz));
        const above2Block = bot.blockAt(new (bot.entity.position.constructor as any)(cx, cy + 2, cz));
        if (
          groundBlock && TILLABLE.has(groundBlock.name) &&
          aboveBlock && aboveBlock.name === "air" &&
          above2Block && above2Block.name === "air"
        ) {
          farmCoords.push({ x: cx, y: cy, z: cz });
          break;
        }
        // Stop scanning down if we hit a solid non-tillable block
        if (groundBlock && groundBlock.name !== "air" && !TILLABLE.has(groundBlock.name)) break;
      }
    }
  }

  // NOTE: Don't place dirt from inventory here — water check (Step 2b) will handle
  // dirt placement near water to ensure irrigation. Placing dirt far from water wastes blocks.
  if (farmCoords.length === 0) {
    logs.push("No natural tillable blocks nearby — will check water proximity before placing dirt.");
  }

  logs.push(`Farm locations: ${farmCoords.map(c => `(${c.x},${c.y},${c.z})`).join(", ")}`);

  // Step 2b: Check for water within 4 blocks of farm area — farmland needs water to stay moist
  // If no water nearby, navigate to find water and re-scan for farmCoords near it
  {
    const waterBlock = bot.findBlock({
      matching: (b: any) => b.name === "water",
      maxDistance: 10,
    });
    if (waterBlock) {
      // Filter farmCoords to only include blocks within 4 blocks of water (irrigation range)
      const wp = waterBlock.position;
      const beforeCount = farmCoords.length;
      for (let i = farmCoords.length - 1; i >= 0; i--) {
        const fc = farmCoords[i];
        const dist = Math.abs(fc.x - wp.x) + Math.abs(fc.z - wp.z); // Manhattan distance on XZ
        const yDiff = Math.abs(fc.y - wp.y);
        if (dist > 4 || yDiff > 1) {
          farmCoords.splice(i, 1);
        }
      }
      if (farmCoords.length < beforeCount) {
        logs.push(`Filtered farmCoords: ${beforeCount} → ${farmCoords.length} (within 4 blocks of water at ${wp.x},${wp.y},${wp.z})`);
      }
    }
    if (!waterBlock || farmCoords.length === 0) {
      // No water nearby or no valid farm spots near water
      if (!waterBlock) {
        logs.push("No water within 10 blocks — farmland may dry out. Searching for water source...");
      } else {
        logs.push("No farmable blocks within irrigation range of nearby water. Searching for better water source...");
      }
      const farWater = bot.findBlock({
        matching: (b: any) => b.name === "water",
        maxDistance: 64,
      });
      if (farWater) {
        logs.push(`Found water at (${farWater.position.x}, ${farWater.position.y}, ${farWater.position.z}), moving close...`);
        try {
          // Navigate to a LAND block adjacent to water, NOT into the water itself (prevents drowning)
          const wp = farWater.position;
          let landTarget = { x: wp.x, y: wp.y, z: wp.z };
          let foundLand = false;
          for (const [ddx, ddz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
            const lx = wp.x + ddx, lz = wp.z + ddz;
            for (let ly = wp.y + 1; ly >= wp.y - 1; ly--) {
              const lb = bot.blockAt(new (bot.entity.position.constructor as any)(lx, ly, lz));
              const labove = bot.blockAt(new (bot.entity.position.constructor as any)(lx, ly + 1, lz));
              if (lb && lb.name !== "air" && lb.name !== "water" && lb.name !== "lava" &&
                  labove && (labove.name === "air" || labove.name === "grass" || labove.name === "tall_grass")) {
                landTarget = { x: lx, y: ly + 1, z: lz };
                foundLand = true;
                break;
              }
            }
            if (foundLand) break;
          }
          if (!foundLand) {
            logs.push("Warning: No land block found adjacent to water, navigating 2 blocks away from water.");
            landTarget = { x: wp.x + 2, y: wp.y + 1, z: wp.z };
          }
          logs.push(`Navigating to land near water at (${landTarget.x}, ${landTarget.y}, ${landTarget.z})`);
          await botManager.moveTo(username, landTarget.x, landTarget.y, landTarget.z);
          // Re-scan for tillable blocks near water — MUST be within 4 blocks of water for irrigation
          const waterX = farWater.position.x, waterY = farWater.position.y, waterZ = farWater.position.z;
          farmCoords.length = 0;
          for (let dx2 = -4; dx2 <= 4 && farmCoords.length < seedCount; dx2++) {
            for (let dz2 = -4; dz2 <= 4 && farmCoords.length < seedCount; dz2++) {
              if (Math.abs(dx2) + Math.abs(dz2) > 4) continue; // Manhattan distance <= 4 from water
              const cx = waterX + dx2, cz = waterZ + dz2;
              for (let dy2 = 0; dy2 >= -5; dy2--) {
                const cy = waterY + dy2;
                const gb = bot.blockAt(new (bot.entity.position.constructor as any)(cx, cy, cz));
                const ab = bot.blockAt(new (bot.entity.position.constructor as any)(cx, cy + 1, cz));
                const a2b = bot.blockAt(new (bot.entity.position.constructor as any)(cx, cy + 2, cz));
                if (gb && TILLABLE.has(gb.name) && ab?.name === "air" && a2b?.name === "air") {
                  farmCoords.push({ x: cx, y: cy, z: cz });
                  break;
                }
                if (gb && gb.name !== "air" && !TILLABLE.has(gb.name)) break;
              }
            }
          }
          // If no natural tillable blocks near water, place dirt from inventory
          if (farmCoords.length === 0) {
            const dirtInv2 = botManager.getInventory(username).find((i: any) => i.name === "dirt");
            if (dirtInv2 && dirtInv2.count >= seedCount) {
              logs.push("No natural dirt near water — placing dirt blocks from inventory.");
              const waterPos = farWater.position;
              // Strategy: find surface level near water, then place dirt ON TOP of solid ground
              let placedCount = 0;
              for (let pdx = -3; pdx <= 3 && placedCount < seedCount; pdx++) {
                for (let pdz = -3; pdz <= 3 && placedCount < seedCount; pdz++) {
                  if (pdx === 0 && pdz === 0) continue; // skip water position
                  if (Math.abs(pdx) + Math.abs(pdz) > 4) continue; // stay within irrigation range
                  const px = waterPos.x + pdx, pz = waterPos.z + pdz;
                  // Scan from high to low to find the surface (first solid block with air above)
                  for (let py = waterPos.y + 3; py >= waterPos.y - 3; py--) {
                    const block = bot.blockAt(new (bot.entity.position.constructor as any)(px, py, pz));
                    const above1 = bot.blockAt(new (bot.entity.position.constructor as any)(px, py + 1, pz));
                    const above2 = bot.blockAt(new (bot.entity.position.constructor as any)(px, py + 2, pz));
                    if (!block || !above1 || !above2) continue;
                    // Found solid ground with 2 air blocks above = surface
                    if (block.name !== "air" && block.name !== "water" &&
                        above1.name === "air" && above2.name === "air") {
                      // If already tillable, just use it
                      if (TILLABLE.has(block.name)) {
                        farmCoords.push({ x: px, y: py, z: pz });
                        placedCount++;
                        logs.push(`Found tillable ${block.name} at (${px},${py},${pz})`);
                      } else {
                        // Place dirt ON TOP of this solid block
                        const placeY = py + 1;
                        try {
                          // Move close before placing
                          const dist = Math.sqrt((bot.entity.position.x - px) ** 2 + (bot.entity.position.z - pz) ** 2);
                          if (dist > 4) {
                            await botManager.moveTo(username, px, py + 1, pz);
                          }
                          await botManager.placeBlock(username, "dirt", px, placeY, pz);
                          const check = bot.blockAt(new (bot.entity.position.constructor as any)(px, placeY, pz));
                          if (check && check.name === "dirt") {
                            farmCoords.push({ x: px, y: placeY, z: pz });
                            placedCount++;
                            logs.push(`Placed dirt on ${block.name} at (${px},${placeY},${pz})`);
                          } else {
                            logs.push(`Dirt placement failed at (${px},${placeY},${pz}) — got ${check?.name}`);
                          }
                        } catch (e) {
                          logs.push(`Place dirt error at (${px},${placeY},${pz}): ${e}`);
                        }
                      }
                      break; // found surface for this XZ, move to next
                    }
                  }
                }
              }
              logs.push(`Placed/found ${placedCount} farm spots near water`);
            } else {
              logs.push("No dirt in inventory to place near water.");
            }
          }
          logs.push(`Near-water farm locations found: ${farmCoords.length}`);
        } catch (e) {
          logs.push(`Failed to move to water: ${e}`);
        }
      } else {
        // No water within 64 blocks — try to create water source or search further
        logs.push("No water found within 64 blocks.");

        // Option 1: Use water_bucket if we have one
        const waterBucket = botManager.getInventory(username).find((i: any) => i.name === "water_bucket");
        if (waterBucket) {
          logs.push("Have water_bucket — placing water source next to farm.");
          try {
            const waterX = bx, waterY = by - 1, waterZ = bz;
            await botManager.placeBlock(username, "water_bucket", waterX, waterY, waterZ);
            logs.push(`Placed water at (${waterX},${waterY},${waterZ})`);
          } catch (e) {
            logs.push(`Failed to place water: ${e}`);
          }
        } else {
          // Option 2: Craft bucket from iron_ingots if available
          const ironIngots = botManager.getInventory(username).find((i: any) => i.name === "iron_ingot");
          if (ironIngots && ironIngots.count >= 3) {
            logs.push("Have iron_ingots — crafting bucket to fetch water.");
            try {
              const craftResult = await getHighLevel().minecraft_craft_chain(username, "bucket", false);
              logs.push(`Craft bucket: ${craftResult}`);
            } catch (e) {
              logs.push(`Craft bucket failed: ${e}`);
            }
          }

          // Option 3: Search wider (200 blocks) for water
          logs.push("Searching up to 200 blocks for water...");
          const veryFarWater = bot.findBlock({
            matching: (b: any) => b.name === "water",
            maxDistance: 200,
          });
          if (veryFarWater) {
            logs.push(`Found water at (${veryFarWater.position.x}, ${veryFarWater.position.y}, ${veryFarWater.position.z}), moving near...`);
            try {
              // Navigate to land adjacent to water, not into it (prevents drowning)
              const vwp = veryFarWater.position;
              let vLandTarget = { x: vwp.x + 2, y: vwp.y + 1, z: vwp.z };
              for (const [vdx, vdz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                const vlx = vwp.x + vdx, vlz = vwp.z + vdz;
                const vlb = bot.blockAt(new (bot.entity.position.constructor as any)(vlx, vwp.y, vlz));
                if (vlb && vlb.name !== "water" && vlb.name !== "air" && vlb.name !== "lava") {
                  vLandTarget = { x: vlx, y: vwp.y + 1, z: vlz };
                  break;
                }
              }
              await botManager.moveTo(username, vLandTarget.x, vLandTarget.y, vLandTarget.z);
              // Re-scan for tillable blocks near water
              const newPos2 = bot.entity.position;
              const nbx2 = Math.floor(newPos2.x), nby2 = Math.floor(newPos2.y), nbz2 = Math.floor(newPos2.z);
              farmCoords.length = 0;
              for (let dx3 = -3; dx3 <= 3 && farmCoords.length < seedCount; dx3++) {
                for (let dz3 = -3; dz3 <= 3 && farmCoords.length < seedCount; dz3++) {
                  const cx = nbx2 + dx3, cz = nbz2 + dz3;
                  for (let dy3 = 0; dy3 >= -5; dy3--) {
                    const cy = nby2 + dy3;
                    const gb = bot.blockAt(new (bot.entity.position.constructor as any)(cx, cy, cz));
                    const ab = bot.blockAt(new (bot.entity.position.constructor as any)(cx, cy + 1, cz));
                    const a2b = bot.blockAt(new (bot.entity.position.constructor as any)(cx, cy + 2, cz));
                    if (gb && TILLABLE.has(gb.name) && ab?.name === "air" && a2b?.name === "air") {
                      farmCoords.push({ x: cx, y: cy, z: cz });
                      break;
                    }
                    if (gb && gb.name !== "air" && !TILLABLE.has(gb.name)) break;
                  }
                }
              }
              logs.push(`Near-water farm locations found: ${farmCoords.length}`);
            } catch (e) {
              logs.push(`Failed to move to water: ${e}`);
            }
          } else {
            logs.push("No water found within 200 blocks — farming not possible here. Move to a river/ocean biome.");
          }
        }
      }
    } else {
      logs.push(`Water source nearby at (${waterBlock.position.x}, ${waterBlock.position.y}, ${waterBlock.position.z}) — farmland will stay moist.`);
    }
  }

  // Step 3: Till then immediately plant each block (till+plant per block, with wait)
  const plantedCoords: Array<{ x: number; y: number; z: number }> = [];
  for (const fc of farmCoords) {
    // Move close to the block before tilling (must be within 4 blocks)
    try {
      const botPos = bot.entity.position;
      const dist = botPos.distanceTo(new (bot.entity.position.constructor as any)(fc.x + 0.5, fc.y + 1, fc.z + 0.5));
      if (dist > 3.5) {
        await botManager.moveTo(username, fc.x + 1, fc.y + 1, fc.z);
        logs.push(`Moved to (${fc.x + 1},${fc.y + 1},${fc.z}) for tilling`);
      }
    } catch (e) {
      logs.push(`Move to farm block failed: ${e}`);
    }

    // Till the block
    try {
      const tillResult = await botManager.tillSoil(username, fc.x, fc.y, fc.z);
      logs.push(`Till (${fc.x},${fc.y},${fc.z}): ${tillResult}`);
    } catch (e) {
      logs.push(`Till failed at (${fc.x},${fc.y},${fc.z}): ${e}`);
      continue;
    }
    // Poll for farmland state — up to 1 second (server may take several ticks)
    {
      const { Vec3: Vec3Cls } = await import("vec3");
      let farmlandConfirmed = false;
      for (let poll = 0; poll < 10; poll++) {
        await new Promise(r => setTimeout(r, 150));
        const b = bot.blockAt(new Vec3Cls(fc.x, fc.y, fc.z));
        if (b && b.name === "farmland") { farmlandConfirmed = true; break; }
      }
      if (!farmlandConfirmed) {
        logs.push(`Farmland check (${fc.x},${fc.y},${fc.z}): NOT farmland — skipping this location`);
        continue;
      }
      logs.push(`Farmland check (${fc.x},${fc.y},${fc.z}): farmland confirmed`);
    }

    // Enable sneaking to prevent farmland trampling during movement
    bot.setControlState("sneak", true);
    await new Promise(r => setTimeout(r, 100));

    // Navigate NEXT TO the farmland (not on top — walking on farmland tramples it!)
    try {
      await botManager.moveTo(username, fc.x + 1, fc.y + 1, fc.z);
    } catch (_) {
      try {
        await botManager.moveTo(username, fc.x - 1, fc.y + 1, fc.z);
      } catch (_) {}
    }

    // Disable sneaking
    bot.setControlState("sneak", false);
    await new Promise(r => setTimeout(r, 100));

    // Re-verify farmland hasn't been trampled
    {
      const { Vec3: Vec3Cls } = await import("vec3");
      const recheck = bot.blockAt(new Vec3Cls(fc.x, fc.y, fc.z));
      if (!recheck || recheck.name !== "farmland") {
        logs.push(`Farmland at (${fc.x},${fc.y},${fc.z}) was trampled! Now: ${recheck?.name}. Skipping.`);
        continue;
      }
    }

    // Plant seeds ON TOP of farmland (same x,y,z — seeds go on top face)
    try {
      const plantResult = await botManager.useItemOnBlock(username, seeds.name, fc.x, fc.y, fc.z);
      logs.push(`Plant ${seeds.name} at (${fc.x},${fc.y},${fc.z}): ${plantResult}`);
      // Wait for seed to register on server
      await new Promise(r => setTimeout(r, 500));
      // Check if crop appeared above farmland
      const { Vec3: Vec3Cls2 } = await import("vec3");
      const cropBlock = bot.blockAt(new Vec3Cls2(fc.x, fc.y + 1, fc.z));
      if (cropBlock && cropBlock.name === "wheat") {
        logs.push(`Crop confirmed at (${fc.x},${fc.y + 1},${fc.z})`);
        plantedCoords.push(fc);
      } else {
        logs.push(`Crop not visible at (${fc.x},${fc.y + 1},${fc.z}) — got "${cropBlock?.name ?? 'null'}" — skipping`);
        // Don't add to plantedCoords — no point bone-mealing a non-existent crop
      }
    } catch (e) {
      logs.push(`Plant failed at (${fc.x},${fc.y},${fc.z}): ${e}`);
    }
  }

  // Step 4: Apply bone_meal for instant growth (up to 8x per crop)
  const boneMealInv = botManager.getInventory(username).find(i => i.name === "bone_meal");
  if (boneMealInv && boneMealInv.count > 0) {
    const { Vec3: Vec3Cls } = await import("vec3");
    for (const fc of plantedCoords) {
      // Move close to crop before applying bone_meal
      try {
        const bDist = bot.entity.position.distanceTo(new Vec3Cls(fc.x + 0.5, fc.y + 1, fc.z + 0.5));
        if (bDist > 3.5) {
          await botManager.moveTo(username, fc.x + 1, fc.y + 1, fc.z);
        }
      } catch (_) { /* best effort */ }
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          // Check whether crop exists at fc.y+1 — bone_meal must target the crop block, not farmland
          const cropAbove = bot.blockAt(new Vec3Cls(fc.x, fc.y + 1, fc.z));
          if (!cropAbove || cropAbove.name !== "wheat") {
            logs.push(`No wheat crop at (${fc.x},${fc.y + 1},${fc.z}) — got "${cropAbove?.name}". Skipping bone_meal.`);
            break;
          }
          const targetY = fc.y + 1; // always target crop, not farmland
          const boneResult = await botManager.useItemOnBlock(username, "bone_meal", fc.x, targetY, fc.z);
          logs.push(`Bone_meal at (${fc.x},${targetY},${fc.z}): ${boneResult}`);
          await new Promise(r => setTimeout(r, 200));
          const crop = bot.blockAt(new Vec3Cls(fc.x, fc.y + 1, fc.z));
          if (crop && crop.name === "wheat") {
            const props = crop && (crop as any).getProperties ? (crop as any).getProperties() : null;
            const age = props?.age ?? (crop as any).metadata;
            if (age >= 7) break; // fully grown
          }
        } catch (e) {
          logs.push(`Bone_meal failed at (${fc.x},${fc.y + 1},${fc.z}): ${e}`);
          break;
        }
      }
    }
  } else {
    logs.push("No bone_meal — crops will grow naturally (takes several minutes).");
  }

  // Step 5: Harvest wheat — only harvest mature crops (age >= 7)
  let wheatGathered = false;
  const hasBoneMeal = boneMealInv && boneMealInv.count > 0;

  // If no bone_meal, crops need several minutes to grow naturally.
  // Don't waste time waiting — just report that seeds are planted.
  if (!hasBoneMeal && plantedCoords.length > 0) {
    logs.push("Seeds planted! Wheat needs ~5 minutes to grow without bone_meal.");
    logs.push("Come back later to harvest, or find bone_meal (kill skeletons → bone → craft bone_meal).");
  }

  // Check for any already-mature wheat nearby (from previous plantings)
  // and harvest bone-mealed crops
  await new Promise(r => setTimeout(r, 500));

  for (const fc of plantedCoords) {
    const cropY = fc.y + 1;
    try {
      const freshBot = botManager.getBot(username);
      const { Vec3: Vec3Cls } = await import("vec3");
      const cropPos = new Vec3Cls(fc.x, cropY, fc.z);
      const cropBlock = freshBot?.blockAt(cropPos);
      if (cropBlock && cropBlock.name === "wheat") {
        // Check age — only harvest if fully grown (age >= 7)
        const props = cropBlock && (cropBlock as any).getProperties ? (cropBlock as any).getProperties() : null;
        const age = props?.age ?? (cropBlock as any).metadata;
        if (age >= 7) {
          await botManager.moveTo(username, fc.x, cropY, fc.z);
          await freshBot!.dig(cropBlock);
          await new Promise(r => setTimeout(r, 300));
          await botManager.collectNearbyItems(username);
          logs.push(`Harvested mature wheat (age=${age}) at (${fc.x},${cropY},${fc.z})`);
          wheatGathered = true;
        } else {
          logs.push(`Wheat at (${fc.x},${cropY},${fc.z}) still growing (age=${age}/7) — skipping`);
        }
      }
    } catch (e) {
      logs.push(`Harvest check at (${fc.x},${cropY},${fc.z}) failed: ${e}`);
    }
  }

  // Also check for any mature wheat within 16 blocks (from older plantings)
  if (!wheatGathered) {
    try {
      const freshBot = botManager.getBot(username);
      const { Vec3: Vec3Cls } = await import("vec3");
      if (freshBot) {
        const wheatBlocks = freshBot.findBlocks({ matching: (block: any) => {
          if (block.name !== "wheat") return false;
          const p = block.getProperties ? block.getProperties() : null;
          return (p?.age ?? block.metadata) >= 7;
        }, maxDistance: 16, count: 10 });
        if (wheatBlocks.length > 0) {
          logs.push(`Found ${wheatBlocks.length} mature wheat nearby — harvesting`);
          for (const pos of wheatBlocks) {
            try {
              await botManager.moveTo(username, pos.x, pos.y, pos.z);
              const wb = freshBot.blockAt(pos);
              if (wb) {
                await freshBot.dig(wb);
                await new Promise(r => setTimeout(r, 300));
                await botManager.collectNearbyItems(username);
                wheatGathered = true;
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch (e) {
      logs.push(`Nearby wheat scan failed: ${e}`);
    }
  }

  // Step 6: Craft bread (3 wheat = 1 bread)
  const invAfter = botManager.getInventory(username);
  const wheatInInv = invAfter.find(i => i.name === "wheat");
  if (wheatInInv && wheatInInv.count >= 3) {
    const breadCount = Math.floor(wheatInInv.count / 3);
    try {
      const craftResult = await getHighLevel().minecraft_craft_chain(username, "bread", false);
      logs.push(`Craft bread: ${craftResult}`);
    } catch (e) {
      logs.push(`Craft bread failed: ${e}`);
    }
  } else if (wheatGathered) {
    logs.push(`Not enough wheat for bread (need 3, have ${wheatInInv?.count ?? 0}).`);
  }

  // Step 7: Eat any food
  try {
    const eatResult = await botManager.eat(username);
    logs.push(`Eat: ${eatResult}`);
  } catch (e) {
    logs.push(`Eat failed: ${e}`);
  }

  const finalInv = botManager.getInventory(username);
  const finalBot = botManager.getBot(username);
  return [
    `mc_farm complete. HP: ${finalBot?.health ?? '?'}, Hunger: ${finalBot?.food ?? '?'}`,
    ...logs,
    `Inventory: ${finalInv.map(i => `${i.name}(${i.count})`).join(", ")}`,
  ].join("\n");
}

// ─── mc_build ────────────────────────────────────────────────────────────────

export async function mc_build(
  preset: "shelter" | "wall" | "platform" | "tower",
  size: "small" | "medium" | "large" = "small"
): Promise<string> {
  const username = botManager.requireSingleBot();
  return await getHighLevel().minecraft_build_structure(username, preset, size);
}

// ─── mc_navigate ─────────────────────────────────────────────────────────────

export async function mc_navigate(
  args: {
    x?: number;
    y?: number;
    z?: number;
    target_block?: string;
    target_entity?: string;
    max_distance?: number;
  }
): Promise<string> {
  const username = botManager.requireSingleBot();

  // Navigate to entity
  if (args.target_entity) {
    const entityInfo = botManager.findEntities(username, undefined, args.max_distance ?? 64);
    if (!entityInfo.includes(args.target_entity)) {
      return `No ${args.target_entity} found within ${args.max_distance ?? 64} blocks`;
    }

    // Find entity position from nearby entities
    const bot = botManager.getBot(username);
    if (!bot) throw new Error("Not connected");

    const entities = Object.values(bot.entities);
    let closestDist = Infinity;
    let closestPos: { x: number; y: number; z: number } | null = null;

    for (const entity of entities) {
      if (!entity || !entity.position) continue;
      const name = entity.name ?? (entity as any).username ?? "";
      if (name.toLowerCase().includes(args.target_entity.toLowerCase())) {
        const dist = entity.position.distanceTo(bot.entity.position);
        if (dist < closestDist) {
          closestDist = dist;
          closestPos = { x: entity.position.x, y: entity.position.y, z: entity.position.z };
        }
      }
    }

    if (!closestPos) {
      return `Found ${args.target_entity} in entity list but could not get position`;
    }

    return await botManager.moveTo(username, closestPos.x, closestPos.y, closestPos.z);
  }

  // Navigate to block type
  if (args.target_block) {
    const findResult = await botManager.findBlock(username, args.target_block, args.max_distance ?? 32);
    if (!findResult || findResult.includes("No ") || findResult.includes("not found")) {
      return `No ${args.target_block} found within ${args.max_distance ?? 32} blocks`;
    }

    const posMatch = findResult.match(/\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/);
    if (!posMatch) {
      return `Found ${args.target_block} but could not parse position: ${findResult}`;
    }

    const x = parseFloat(posMatch[1]);
    const y = parseFloat(posMatch[2]);
    const z = parseFloat(posMatch[3]);
    const moveResult = await botManager.moveTo(username, x, y, z);
    return `${findResult}\n${moveResult}`;
  }

  // Navigate to coordinates
  if (args.x !== undefined && args.y !== undefined && args.z !== undefined) {
    // Coerce to numbers (MCP may pass as strings)
    const nx = Number(args.x);
    const ny = Number(args.y);
    const nz = Number(args.z);
    if (isNaN(nx) || isNaN(ny) || isNaN(nz)) {
      return `Invalid coordinates: x=${args.x}, y=${args.y}, z=${args.z}`;
    }
    // For long distances, move in segments (from movement.ts logic)
    const pos = botManager.getPosition(username);
    if (pos) {
      const dx = nx - pos.x;
      const dy = ny - pos.y;
      const dz = nz - pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist > 50) {
        const segmentSize = 50;
        const steps = Math.ceil(dist / segmentSize);
        let lastResult = "";
        let consecutiveFailures = 0;
        for (let i = 1; i <= steps; i++) {
          const curPos = botManager.getPosition(username);
          if (!curPos) break;
          const rdx = nx - curPos.x;
          const rdy = ny - curPos.y;
          const rdz = nz - curPos.z;
          const remainDist = Math.sqrt(rdx * rdx + rdy * rdy + rdz * rdz);
          if (remainDist < 3) break;
          const t = Math.min(segmentSize / remainDist, 1.0);
          const ix = curPos.x + rdx * t;
          const iz = curPos.z + rdz * t;
          const iy = remainDist <= segmentSize ? ny : (curPos.y + rdy * t);
          lastResult = await botManager.moveTo(username, ix, iy, iz);
          // Check if segment failed — stop early instead of wasting turns
          if (lastResult.includes("Cannot reach") || lastResult.includes("Path blocked") || lastResult.includes("timeout")) {
            consecutiveFailures++;
            if (consecutiveFailures >= 2) {
              return `Navigation stopped after ${i}/${steps} segments: ${lastResult}. Stuck at current position — try a different route or clear obstacles.`;
            }
          } else {
            consecutiveFailures = 0;
          }
        }
        return lastResult || await botManager.moveTo(username, nx, ny, nz);
      }
    }
    return await botManager.moveTo(username, nx, ny, nz);
  }

  return "Provide coordinates (x, y, z), target_block, or target_entity";
}

// ─── mc_combat ───────────────────────────────────────────────────────────────

export async function mc_combat(
  targetOrArgs?: string | { target?: string; flee_at_hp?: number; fleeAtHp?: number; collect_items?: boolean },
  fleeAtHpArg: number = 4
): Promise<string> {
  const username = botManager.requireSingleBot();

  // Support both positional and object argument styles
  let target: string | undefined;
  let fleeAtHp = fleeAtHpArg;

  if (targetOrArgs && typeof targetOrArgs === "object") {
    target = targetOrArgs.target;
    fleeAtHp = targetOrArgs.flee_at_hp ?? targetOrArgs.fleeAtHp ?? fleeAtHpArg;
  } else {
    target = targetOrArgs as string | undefined;
  }

  // Auto-equip best weapon and armor
  try {
    await botManager.equipWeapon(username);
  } catch {
    // Continue without weapon
  }
  try {
    await botManager.equipArmor(username);
  } catch {
    // Continue without armor
  }

  // Attack target
  // Note: fight() and attack() both call collectNearbyItems internally after the kill.
  // Do NOT call collectNearbyItems again here — it would run after items are already
  // collected and return "No items nearby", creating misleading output.
  if (target) {
    return await botManager.fight(username, target, fleeAtHp);
  }

  // Attack nearest hostile
  return await botManager.attack(username);
}

// ─── mc_drop ─────────────────────────────────────────────────────────────────

export async function mc_drop(
  item_name: string,
  count?: number
): Promise<string> {
  const username = botManager.requireSingleBot();
  const bot = botManager.getBot(username);
  if (!bot) throw new Error("Bot not connected");

  const { dropItem } = await import("../bot-manager/bot-items.js");
  const result = await dropItem(bot, item_name, count);

  // Move away after dropping to prevent auto re-pickup.
  // Use simple forward walk (not pathfinder — pathfinder fails on hilly terrain).
  try {
    // Look in a random horizontal direction and walk forward for 3 seconds
    const yaw = Math.random() * Math.PI * 2;
    bot.look(yaw, 0);
    await new Promise(r => setTimeout(r, 100));
    bot.setControlState("forward", true);
    bot.setControlState("sprint", true);
    await new Promise(r => setTimeout(r, 3000));
    bot.setControlState("forward", false);
    bot.setControlState("sprint", false);
    await new Promise(r => setTimeout(r, 500));
  } catch {
    console.error("[Drop] Could not move away after drop");
  }

  return result;
}

// ─── mc_eat ──────────────────────────────────────────────────────────────────

export async function mc_eat(food?: string): Promise<string> {
  const username = botManager.requireSingleBot();

  // If specific food requested, just eat it
  if (food) {
    try {
      return await botManager.eat(username, food);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Promise timed out")) {
        throw new Error(`Failed to eat ${food}: Item not found in inventory or not edible`);
      }
      throw error;
    }
  }

  // Smart eat: check inventory for food and eat best available
  const inventory = botManager.getInventory(username);
  const foodPriority = [
    "golden_carrot", "golden_apple", "cooked_beef", "cooked_porkchop",
    "cooked_mutton", "cooked_salmon", "cooked_chicken", "cooked_rabbit",
    "cooked_cod", "baked_potato", "bread", "pumpkin_pie", "mushroom_stew",
    "rabbit_stew", "apple", "melon_slice", "sweet_berries", "carrot",
    "potato", "beetroot", "cookie", "beef", "porkchop", "mutton",
    "chicken", "rabbit", "cod", "salmon", "rotten_flesh",
  ];

  // Check if we have food and a furnace nearby to cook raw meat
  const rawToCookedMap: Record<string, string> = {
    beef: "cooked_beef",
    porkchop: "cooked_porkchop",
    chicken: "cooked_chicken",
    mutton: "cooked_mutton",
    rabbit: "cooked_rabbit",
    cod: "cooked_cod",
    salmon: "cooked_salmon",
  };

  for (const rawMeat of Object.keys(rawToCookedMap)) {
    const rawItem = inventory.find(i => i.name === rawMeat);
    if (rawItem) {
      // Check if furnace nearby
      try {
        const furnaceResult = await botManager.findBlock(username, "furnace", 8);
        if (furnaceResult && !furnaceResult.includes("No ") && !furnaceResult.includes("not found")) {
          // Cook then eat
          try {
            await botManager.smeltItem(username, rawMeat, 1);
            return await botManager.eat(username, rawToCookedMap[rawMeat]);
          } catch {
            // Fall through to eat raw
          }
        }
      } catch {
        // No furnace nearby
      }
    }
  }

  // Eat best available food
  for (const foodName of foodPriority) {
    if (inventory.some(i => i.name === foodName)) {
      try {
        return await botManager.eat(username, foodName);
      } catch {
        continue;
      }
    }
  }

  return "No food in inventory. Use mc_gather or mc_combat to obtain food.";
}

// ─── mc_store ────────────────────────────────────────────────────────────────

export async function mc_store(
  actionOrArgs:
    | "list"
    | "deposit"
    | "withdraw"
    | "deposit_all_except"
    | {
        action: "list" | "deposit" | "withdraw" | "deposit_all_except";
        item?: string;
        item_name?: string;
        count?: number;
        x?: number;
        y?: number;
        z?: number;
        keep_items?: string[];
      },
  itemName?: string,
  count?: number,
  chestX?: number,
  chestY?: number,
  chestZ?: number,
  keepItems?: string[]
): Promise<string> {
  // Support object argument style (consistent with mc_navigate, mc_combat)
  let action: "list" | "deposit" | "withdraw" | "deposit_all_except";
  if (actionOrArgs && typeof actionOrArgs === "object") {
    action = actionOrArgs.action;
    itemName = actionOrArgs.item ?? actionOrArgs.item_name ?? itemName;
    count = actionOrArgs.count ?? count;
    chestX = actionOrArgs.x ?? chestX;
    chestY = actionOrArgs.y ?? chestY;
    chestZ = actionOrArgs.z ?? chestZ;
    keepItems = actionOrArgs.keep_items ?? keepItems;
  } else {
    action = actionOrArgs;
  }

  const username = botManager.requireSingleBot();

  switch (action) {
    case "list": {
      if (chestX !== undefined && chestY !== undefined && chestZ !== undefined) {
        return await botManager.openChest(username, chestX, chestY, chestZ);
      }
      return await botManager.listChest(username);
    }

    case "deposit": {
      if (!itemName) throw new Error("item_name required for deposit");
      return await botManager.storeInChest(username, itemName, count, chestX, chestY, chestZ);
    }

    case "withdraw": {
      if (!itemName) throw new Error("item_name required for withdraw");
      return await botManager.takeFromChest(username, itemName, count, chestX, chestY, chestZ);
    }

    case "deposit_all_except": {
      const keep = new Set(keepItems ?? []);
      const inventory = botManager.getInventory(username);
      const results: string[] = [];

      for (const item of inventory) {
        if (keep.has(item.name)) continue;
        // Skip tools and armor by default
        const isEquipment = item.name.includes("_pickaxe") || item.name.includes("_axe") ||
          item.name.includes("_sword") || item.name.includes("_shovel") ||
          item.name.includes("_helmet") || item.name.includes("_chestplate") ||
          item.name.includes("_leggings") || item.name.includes("_boots") ||
          item.name.includes("shield");
        if (isEquipment) continue;

        try {
          const result = await botManager.storeInChest(username, item.name, undefined, chestX, chestY, chestZ);
          results.push(`${item.name}: ${result}`);
        } catch (err) {
          results.push(`${item.name}: failed - ${err}`);
        }
      }

      return results.length > 0 ? results.join("\n") : "Nothing to deposit";
    }

    default:
      throw new Error(`Unknown action: ${action}. Use: list, deposit, withdraw, deposit_all_except`);
  }
}

// ─── mc_chat ─────────────────────────────────────────────────────────────────

export async function mc_chat(
  message?: string,
  readMessages: boolean = true
): Promise<string> {
  const username = botManager.requireSingleBot();
  const results: string[] = [];

  // Send message if provided
  if (message) {
    botManager.chat(username, message);
    results.push(`Sent: ${message}`);
  }

  // Read unread messages
  if (readMessages) {
    const messages = botManager.getChatMessages(username, true);
    if (messages.length > 0) {
      const chatLines = messages.map((m: { username: string; message: string }) =>
        `<${m.username}> ${m.message}`
      );
      results.push(`Messages (${messages.length}):\n${chatLines.join("\n")}`);
    } else if (!message) {
      results.push("No new messages");
    }
  }

  return results.join("\n\n");
}

// ─── mc_connect ──────────────────────────────────────────────────────────────

export async function mc_connect(
  args: {
    action: "connect" | "disconnect";
    username?: string;
    host?: string;
    port?: number;
    version?: string;
  }
): Promise<string> {
  if (args.action === "disconnect") {
    const username = botManager.requireSingleBot();
    await botManager.disconnect(username);
    return "Disconnected";
  }

  // Connect
  const host = args.host || process.env.MC_HOST || "localhost";
  const port = args.port || parseInt(process.env.MC_PORT || "25565");
  const username = args.username || process.env.BOT_USERNAME || "";
  const version = args.version;

  if (!username) {
    throw new Error("Username is required");
  }

  // Always set game agent type for core tools
  setAgentType("game");

  await botManager.connect({ host, port, username, version });

  // Start prismarine-viewer via persistent viewer server if VIEWER=1
  if (process.env.VIEWER === "1") {
    const viewerPort = parseInt(process.env.VIEWER_PORT || "3007");
    try {
      const { onBotConnected } = await import("../viewer-server.js");
      const bot = botManager.getBot(username);
      if (bot) {
        await onBotConnected(bot, username, viewerPort);
        console.error(`[Viewer] Started at http://localhost:${viewerPort}`);
      }
    } catch (e) {
      console.error(`[Viewer] Failed to start: ${e}`);
    }
  }

  return `Connected to ${host}:${port} as ${username}`;
}

// ─── mc_flee ─────────────────────────────────────────────────────────────────

export async function mc_flee(distance: number = 20): Promise<string> {
  const username = botManager.requireSingleBot();
  return await botManager.flee(username, distance);
}

// ─── minecraft_pillar_up ─────────────────────────────────────────────────────

export async function minecraft_pillar_up(height: number = 1): Promise<string> {
  const username = botManager.requireSingleBot();
  const clampedHeight = Math.min(height || 1, 15);
  return await botManager.pillarUp(username, clampedHeight);
}

// ─── mc_smelt ─────────────────────────────────────────────────────────────────

export async function mc_smelt(item_name: string, count: number = 1): Promise<string> {
  const username = botManager.requireSingleBot();
  return await botManager.smeltItem(username, item_name, count);
}

// ─── mc_tunnel ────────────────────────────────────────────────────────────────

export async function mc_tunnel(direction: string, length: number = 10): Promise<string> {
  const username = botManager.requireSingleBot();
  const validDirs = ["north", "south", "east", "west", "down", "up"] as const;
  const dir = direction as typeof validDirs[number];
  if (!validDirs.includes(dir)) {
    throw new Error(`Invalid direction: ${direction}. Use: ${validDirs.join(", ")}`);
  }
  return await botManager.digTunnel(username, dir, length);
}

// ─── Registry registration (for hot-reload) ─────────────────────────────────

registry.coreTools = {
  mc_status, mc_gather, mc_craft, mc_build, mc_navigate,
  mc_combat, mc_eat, mc_store, mc_chat, mc_connect,
  mc_flee, minecraft_pillar_up, mc_smelt, mc_tunnel,
};
