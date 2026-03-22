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
import { checkDangerNearby, isHostileMob, isNeutralMob, EDIBLE_FOOD_NAMES } from "../bot-manager/minecraft-utils.js";
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

  // Threats - scan radius 24 to catch skeletons/ranged mobs beyond 16 blocks
  const THREAT_RADIUS = 24;
  const danger = checkDangerNearby(bot, THREAT_RADIUS);
  const threats: Array<{ type: string; distance: number; direction: string }> = [];
  // Always scan entities independently (don't gate on danger.dangerous to avoid missing edge cases)
  // Use centralized isHostileMob() instead of inline list with substring matching.
  // Bug: inline "zombie".includes() falsely matched "zombified_piglin" (neutral mob).
  const entities = Object.values(bot.entities);
  for (const entity of entities) {
    if (!entity || !entity.position || entity === bot.entity) continue;
    const dist = entity.position.distanceTo(bot.entity.position);
    if (dist > THREAT_RADIUS) continue;
    const name = entity.name ?? (entity as any).username ?? "unknown";
    if (isHostileMob(bot, name.toLowerCase())) {
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

  // Warnings: actionable alerts based on current state.
  // Bot1 Sessions 20-43: 20+ deaths from ignoring night danger, no food, and phantom spawns.
  const warnings: string[] = [];
  const isNight = timeOfDay > 12541 || timeOfDay < 100;
  if (isNight) {
    const hasBed = inventory.some(i => i.name.includes("_bed"));
    if (threats.length > 0) {
      warnings.push(`NIGHT DANGER: ${threats.length} hostile(s) nearby. Do NOT navigate or engage — mc_flee or dig 1x1x2 shelter and wait for dawn.`);
    }
    // NO ARMOR warning: Bot1 Sessions 16-42, Bot2/Bot3 multiple deaths at night without armor.
    // Many bots navigate/gather/combat at night with empty armor slots, taking full damage from mobs.
    // Warn explicitly so the agent equips armor before any night action.
    if (armorItems.length <= 1) {
      warnings.push(`NO ARMOR: Only ${armorItems.length}/4 armor slots equipped. Mobs deal full damage without armor. Craft and equip armor (iron_helmet, iron_chestplate, iron_leggings, iron_boots) before any night activity.`);
    }
    if (hasBed) {
      warnings.push("You have a bed. Use mc_sleep NOW to skip night and reset phantom insomnia timer.");
    } else {
      warnings.push("PHANTOM RISK: Sleeping in a bed resets insomnia. Without sleep for 3+ nights, Phantoms will spawn and attack from above. Craft a bed (3 wool + 3 planks) when possible.");
    }
  }
  // Daytime phantom/bed reminder: Phantoms spawn after 3+ nights without sleeping.
  // Bot1 [2026-03-22]: killed by Phantom during daytime farming. Bot1 Session 43: killed by
  // Phantom at night. The night-only warning (above) only fires at night when it may be too
  // late to craft a bed. Warn during daytime so the agent can proactively craft a bed.
  // Only show if the bot doesn't have a bed in inventory (avoids nagging).
  if (!isNight) {
    const hasBedDay = inventory.some(i => i.name.includes("_bed"));
    if (!hasBedDay) {
      warnings.push("NO BED: Craft a bed (3 wool + 3 planks) before nightfall. Sleeping resets the Phantom insomnia timer — without it, Phantoms spawn after 3 nights and attack from above (hard to flee).");
    }
  }
  if (food <= 0 && health < 10) {
    warnings.push(`STARVATION: Hunger=${food}, HP=${Math.round(health*10)/10}. Find food IMMEDIATELY — mc_combat(cow/pig/chicken) or mc_eat. Do NOT navigate long distances.`);
  }
  if (foodItems.length === 0 && food < 10) {
    warnings.push("NO FOOD in inventory. Hunger will deplete. Hunt animals (mc_combat cow/pig) or harvest crops before it's critical.");
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
    ...(warnings.length > 0 ? { warnings } : {}),
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

  // Safety: Auto-equip armor before gathering at night.
  // mc_gather is a long-running operation (up to 120s). Bot is stationary while mining,
  // exposed to mob attacks. Bot1: mc_gather(short_grass) timed out 120s, mobs killed bot.
  // Bot2: skeleton shot bot from HP 20→8 during gather because no armor equipped.
  // mc_navigate and mc_combat auto-equip armor, but mc_gather did not — fixed here.
  const gatherBot = botManager.getBot(username);
  if (gatherBot) {
    const gatherTime = gatherBot.time?.timeOfDay ?? 0;
    const gatherIsNight = gatherTime > 12541 || gatherTime < 100;

    // Auto-equip armor before ALL gathering — not just at night or when danger detected.
    // mc_gather is a long operation (up to 120s) where the bot is stationary/vulnerable.
    // Surprise attacks from pillagers, cave zombies, and skeletons happen during daytime too.
    // Bot2 [2026-03-22]: skeleton shot bot HP 20→1 during daytime gather, no armor equipped.
    // Equipping armor is cheap (milliseconds) and prevents significant damage.
    try {
      await botManager.equipArmor(username);
    } catch {
      // Continue without armor
    }

    // Pre-gather proactive eat: consume food before gathering if HP < 18 OR hunger < 14.
    // mc_gather is a long operation (up to 120s) where the bot is stationary. Without
    // sufficient hunger/saturation, HP drops from starvation during the operation.
    // Bot1: started gather at low hunger, hunger hit 0 mid-gather, HP drained, died.
    // Bot2/Bot3: similar starvation-during-gather patterns.
    const preGatherHp = gatherBot.health ?? 20;
    const preGatherHunger = (gatherBot as any).food ?? 20;
    if (preGatherHp < 18 || preGatherHunger < 14) {
      const preGatherFood = gatherBot.inventory.items().find((item: any) => EDIBLE_FOOD_NAMES.has(item.name));
      if (preGatherFood) {
        try {
          await gatherBot.equip(preGatherFood, "hand");
          await gatherBot.consume();
          console.error(`[Gather] Pre-gather auto-ate ${preGatherFood.name} (HP: ${preGatherHp.toFixed(1)} → ${gatherBot.health?.toFixed(1)}, hunger: ${preGatherHunger} → ${(gatherBot as any).food ?? "?"})`);
        } catch (_) { /* ignore eat errors */ }
      }
    }

    // Refuse gathering at critically low HP regardless of time — mc_gather is a long
    // operation (up to 120s) where the bot is stationary and vulnerable. Starting at low HP
    // means any single mob hit or starvation tick is lethal. The runtime HP monitor aborts
    // at HP<8, but by then the bot has wasted time and is in a worse position.
    // Bot1 [2026-03-22]: started mc_gather(short_grass) at low HP, timed out 120s, mobs killed bot.
    const gatherHpStart = Math.round((gatherBot.health ?? 20) * 10) / 10;
    if (gatherHpStart < 8) {
      return `[REFUSED] HP too low to gather (${gatherHpStart}/20). Gathering takes up to 120s and leaves bot stationary/vulnerable. Heal first: mc_eat, or mc_combat(target="cow") for food.`;
    }

    if (gatherIsNight) {
      const danger = checkDangerNearby(gatherBot, 20);
      if (danger.dangerous) {
        const threatDesc = danger.nearestHostile
          ? `${danger.nearestHostile.name} at ${danger.nearestHostile.distance.toFixed(1)} blocks`
          : `${danger.hostileCount} hostile(s)`;
        return `[REFUSED] Too dangerous to gather at night — ${threatDesc} nearby, HP=${gatherHpStart}. Gathering is a long operation (up to 120s) and bot is stationary/vulnerable. Use mc_flee or mc_combat to clear threats first, or wait for daytime.`;
      }
    } else {
      // Daytime hostile pre-check: mc_gather takes up to 120s and the bot is stationary.
      // Bot2 [2026-03-22]: skeleton shot bot from HP 20→1 during DAYTIME gather with no
      // pre-start hostile check. The mid-gather monitor only activates at HP<12 (line 366),
      // so the first 8+ damage from skeleton arrows goes unchecked.
      // Scan 20 blocks (skeleton shooting range) and refuse if hostiles are within 12 blocks.
      const dayDanger = checkDangerNearby(gatherBot, 20);
      if (dayDanger.dangerous && dayDanger.nearestHostile && dayDanger.nearestHostile.distance <= 12) {
        const threatDesc = `${dayDanger.nearestHostile.name} at ${dayDanger.nearestHostile.distance.toFixed(1)} blocks`;
        return `[REFUSED] Too dangerous to gather — ${threatDesc} nearby, HP=${gatherHpStart}. Gathering is stationary (up to 120s). Use mc_flee or mc_combat to clear threats first.`;
      }
    }
  }

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
        // Safety: HP/hostile check between wheat harvest iterations.
        // The main mc_gather path has a 1s HP monitor, but this wheat harvest sub-path
        // had no safety checks — moveTo + dig + collectItems runs unmonitored.
        // Bot1/Bot2: mobs attacked during long gather operations with no abort.
        const wheatHp = bot.health ?? 20;
        if (wheatHp < 8) {
          logs.push(`[ABORTED] HP critically low during wheat harvest (${wheatHp.toFixed(1)}/20). Stopping.`);
          break;
        }
        const wheatDanger = checkDangerNearby(bot, 16);
        if (wheatDanger.dangerous && wheatDanger.nearestHostile && wheatDanger.nearestHostile.distance <= 12) {
          logs.push(`[ABORTED] Hostile ${wheatDanger.nearestHostile.name} detected ${wheatDanger.nearestHostile.distance.toFixed(1)} blocks away during wheat harvest. Stopping.`);
          break;
        }
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
  // HP monitoring: periodically check HP during gather and abort if critically low.
  // Bot1: mc_gather(short_grass) ran 120s while mobs attacked, HP dropped to 3.
  // Bot2: skeleton shot bot from HP 20→8 during gather — no mid-operation abort.
  // The gather_resources function has per-iteration HP checks, but between iterations
  // (during moveTo + dig), no check runs. This interval catches HP drops in real-time.
  const hpMonitorPromise = new Promise<string>((resolve) => {
    const hpCheckInterval = setInterval(() => {
      try {
        const monBot = botManager.getBot(username);
        if (!monBot) { clearInterval(hpCheckInterval); return; }
        const monHp = monBot.health ?? 20;
        // Bot1: died at HP 6-8 during gather from single zombie/skeleton hit (4-8 damage).
        // Bot2: skeleton shot from HP 20→8 during gather. A single hit at HP<8 is often lethal.
        // Threshold raised from 6 to 8 to give the agent time to react before death.
        if (monHp < 8) {
          clearInterval(hpCheckInterval);
          try { monBot.pathfinder?.stop(); } catch (_) {}
          resolve(`[ABORTED] mc_gather stopped: HP dropped to ${monHp.toFixed(1)} during gathering. Use mc_flee or mc_eat before retrying.`);
          return;
        }
        // Hostile check during gathering — both night AND daytime.
        // mc_gather can take up to 120s. The bot is stationary/moving slowly, vulnerable.
        // Night: check 20-block radius (mobs are everywhere).
        // Daytime: check 12-block radius when HP<12 — pillagers, cave zombies, and
        // remnant mobs attack during day. Bot2 [2026-03-22]: skeleton shot bot from
        // HP 20→1 during daytime dirt placement. The initial night-only check missed this.
        const monTime = monBot.time?.timeOfDay ?? 0;
        const monIsNight = monTime > 12541 || monTime < 100;
        const gatherScanRadius = monIsNight ? 20 : 12;
        const shouldCheckHostiles = monIsNight || monHp < 12;
        if (shouldCheckHostiles) {
          const monDanger = checkDangerNearby(monBot, gatherScanRadius);
          const distThreshold = monIsNight ? 16 : 10;
          if (monDanger.dangerous && monDanger.nearestHostile && monDanger.nearestHostile.distance <= distThreshold) {
            clearInterval(hpCheckInterval);
            try { monBot.pathfinder?.stop(); } catch (_) {}
            const timeNote = monIsNight ? "night fell and " : "";
            resolve(`[ABORTED] mc_gather stopped: ${timeNote}${monDanger.nearestHostile.name} detected ${monDanger.nearestHostile.distance.toFixed(1)} blocks away (HP=${monHp.toFixed(1)}). Use mc_flee or mc_combat to handle threat first.`);
            return;
          }
        }
      } catch (_) {
        clearInterval(hpCheckInterval);
      }
    }, 1000);
    // Clean up interval when gather completes (will be garbage collected, but be explicit)
    gatherPromise.finally(() => clearInterval(hpCheckInterval));
    timeoutPromise.catch(() => clearInterval(hpCheckInterval));
  });
  try {
    return await Promise.race([gatherPromise, timeoutPromise, hpMonitorPromise]);
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
  const FARM_TIMEOUT_MS = 120000; // 120s global timeout, same as mc_gather
  const farmStartTime = Date.now();

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

  // Safety: Refuse farming when starving — farming is a long operation (up to 120s) that
  // produces food only after wheat grows. With hunger=0, starvation damage ticks continuously
  // and the bot will die long before wheat is harvestable.
  // Bot1,Bot2,Bot3: multiple deaths from mc_farm at hunger=0 with no food — HP drained
  // to 0 during the 120s farming window. Kill animals for immediate food instead.
  const farmHunger = (bot as any).food ?? 20;
  const farmHasFood = inv.some(i => EDIBLE_FOOD_NAMES.has(i.name));
  if (farmHunger <= 2 && !farmHasFood) {
    const farmHpNow = Math.round((bot.health ?? 20) * 10) / 10;
    return `[REFUSED] Cannot farm while starving — hunger=${farmHunger}, HP=${farmHpNow}, no food in inventory. Farming takes 60-120s but starvation damage is immediate. Get food first: mc_combat(target="cow"), mc_combat(target="pig"), mc_combat(target="chicken"), or mc_eat(rotten_flesh).`;
  }

  // Safety: Refuse farming at critically low HP — mc_farm is a long operation (up to 120s)
  // where the bot is stationary and vulnerable. Starting at low HP means any single mob hit
  // or starvation tick is lethal. The mid-farm HP monitor (Step 3) aborts at HP<10, but by
  // then the bot has wasted time navigating to water (Step 2b) without HP checks.
  // Bot3 Death #27: mc_farm at HP 2/20 with enderman 8.5m away — killed during operation.
  // mc_gather already has this gate (HP<8 → REFUSED). mc_farm should match.
  const farmHpStart = Math.round((bot.health ?? 20) * 10) / 10;
  if (farmHpStart < 8) {
    return `[REFUSED] HP too low to farm (${farmHpStart}/20). Farming takes up to 120s and leaves bot stationary/vulnerable. Heal first: mc_eat, or mc_combat(target="cow") for food.`;
  }

  // Safety: Refuse farming at night — farming is a long, stationary operation that
  // leaves the bot exposed to hostile mob spawns. Multiple deaths from this pattern:
  // Bot1: killed by creeper during night mc_farm, Bot2: skeleton shot from HP 20→1 during dirt placement,
  // Bot3 Bug #19: mc_farm at night led to mob surround.
  // Farming should only happen during safe daylight hours.
  const farmTimeOfDay = bot.time?.timeOfDay ?? 0;
  const farmIsNight = farmTimeOfDay > 12541 || farmTimeOfDay < 100;
  if (farmIsNight) {
    const farmHp = Math.round((bot.health ?? 20) * 10) / 10;
    return `[REFUSED] Too dangerous to farm at night (time=${farmTimeOfDay}). Mobs spawn during the long farming operation and bot is stationary/vulnerable. Wait for dawn (mc_sleep if you have a bed) or build shelter. HP=${farmHp}.`;
  }

  // Auto-equip armor before farming — mc_farm is a long operation (up to 120s) where
  // the bot is stationary and vulnerable. Bot2 [2026-03-22]: skeleton shot bot from HP 20→1
  // during dirt placement with no armor equipped. Equipping armor prevents 4-8 damage per hit.
  try {
    await botManager.equipArmor(username);
  } catch {
    // Continue without armor
  }

  // Safety: Check for hostile mobs before starting long farming operation.
  // Skeletons can shoot from ~20 blocks, so scan 20 blocks (not 16) for any hostiles.
  // Bug report: bot2 was killed by skeleton during mc_farm because safety radius was too small.
  const danger = checkDangerNearby(bot, 20);
  if (danger.dangerous) {
    const hp = Math.round((bot.health ?? 20) * 10) / 10;
    const threatDesc = danger.nearestHostile
      ? `${danger.nearestHostile.name} at ${danger.nearestHostile.distance.toFixed(1)} blocks`
      : `${danger.hostileCount} hostile(s)`;
    return `[REFUSED] Too dangerous to farm — ${threatDesc} nearby, HP=${hp}. Use mc_flee or mc_combat to clear threats first, or wait for daytime.`;
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
        const dist = Math.max(Math.abs(fc.x - wp.x), Math.abs(fc.z - wp.z)); // Chebyshev distance on XZ (Minecraft irrigation is 9x9 area)
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
              if (Math.max(Math.abs(dx2), Math.abs(dz2)) > 4) continue; // Chebyshev distance <= 4 from water (9x9 irrigation area)
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
              // Cap consecutive failures to avoid spending too long stationary (vulnerable to mobs).
              // Bot2: 19 consecutive placement failures while skeleton shot bot from HP 20 to 1.
              let placedCount = 0;
              let consecutivePlaceFails = 0;
              const MAX_PLACE_FAILS = 5;
              let dirtPlaceAborted = false;
              for (let pdx = -3; pdx <= 3 && placedCount < seedCount && consecutivePlaceFails < MAX_PLACE_FAILS && !dirtPlaceAborted; pdx++) {
                for (let pdz = -3; pdz <= 3 && placedCount < seedCount && consecutivePlaceFails < MAX_PLACE_FAILS && !dirtPlaceAborted; pdz++) {
                  // Hostile check during dirt placement: bot2 was shot by skeleton
                  // from HP 20 to 1 during 19 consecutive placement attempts.
                  // The till/plant loop (Step 3) has a danger check but this loop didn't.
                  if (Date.now() - farmStartTime > FARM_TIMEOUT_MS) {
                    logs.push(`[ABORTED] mc_farm timed out during dirt placement.`);
                    dirtPlaceAborted = true;
                    break;
                  }
                  const placeDanger = checkDangerNearby(bot, 20);
                  if (placeDanger.dangerous) {
                    const pd = placeDanger.nearestHostile
                      ? `${placeDanger.nearestHostile.name} at ${placeDanger.nearestHostile.distance.toFixed(1)} blocks`
                      : `${placeDanger.hostileCount} hostile(s)`;
                    logs.push(`[ABORTED] Hostile detected during dirt placement: ${pd}. Stopping.`);
                    dirtPlaceAborted = true;
                    break;
                  }
                  // HP check during dirt placement: bot2 was shot by skeleton from HP 20→1
                  // during 19 consecutive placement attempts. The hostile check above catches
                  // visible mobs, but misses damage from mobs behind terrain or starvation.
                  // This matches the HP<10 abort in the tilling loop (Step 3) and bone meal loop (Step 4).
                  const placeHp = bot.health ?? 20;
                  if (placeHp < 10) {
                    logs.push(`[ABORTED] HP critically low during dirt placement (${placeHp.toFixed(1)}/20). Stopping farm to survive.`);
                    dirtPlaceAborted = true;
                    break;
                  }
                  if (pdx === 0 && pdz === 0) continue; // skip water position
                  if (Math.max(Math.abs(pdx), Math.abs(pdz)) > 4) continue; // Chebyshev distance <= 4 from water (irrigation range)
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
                      // Skip positions at or below water level — bot can't reliably place
                      // dirt on submerged rocks or cliff faces next to water.
                      // Bot2 Bug: 17 consecutive "got air" failures placing dirt near water.
                      // Bot3 Bug #20: dirt placement failed at water-adjacent positions.
                      if (py <= waterPos.y) {
                        // Only accept if block is already tillable (natural dirt near water is fine)
                        if (!TILLABLE.has(block.name)) {
                          continue; // skip non-tillable blocks at/below water level
                        }
                      }
                      // If already tillable, just use it
                      if (TILLABLE.has(block.name)) {
                        farmCoords.push({ x: px, y: py, z: pz });
                        placedCount++;
                        logs.push(`Found tillable ${block.name} at (${px},${py},${pz})`);
                      } else {
                        // Place dirt ON TOP of this solid block
                        const placeY = py + 1;
                        try {
                          // Move close before placing — use 3D distance (Y matters for reach)
                          // and move to an adjacent position, not on top of the target.
                          // Bot3 Bug #20: placement failed because bot was too far or
                          // tried to stand at an unsupported Y-level.
                          const bpx = bot.entity.position.x, bpy = bot.entity.position.y, bpz = bot.entity.position.z;
                          const dist3d = Math.sqrt((bpx - px) ** 2 + (bpy - (py + 1)) ** 2 + (bpz - pz) ** 2);
                          if (dist3d > 3.5) {
                            // Move to adjacent solid ground, not on the target itself
                            await botManager.moveTo(username, px + 1, py + 1, pz);
                          }
                          await botManager.placeBlock(username, "dirt", px, placeY, pz);
                          const check = bot.blockAt(new (bot.entity.position.constructor as any)(px, placeY, pz));
                          if (check && check.name === "dirt") {
                            farmCoords.push({ x: px, y: placeY, z: pz });
                            placedCount++;
                            consecutivePlaceFails = 0;
                            logs.push(`Placed dirt on ${block.name} at (${px},${placeY},${pz})`);
                          } else {
                            consecutivePlaceFails++;
                            logs.push(`Dirt placement failed at (${px},${placeY},${pz}) — got ${check?.name}`);
                          }
                        } catch (e) {
                          consecutivePlaceFails++;
                          logs.push(`Place dirt error at (${px},${placeY},${pz}): ${e}`);
                        }
                      }
                      break; // found surface for this XZ, move to next
                    }
                  }
                }
              }
              if (consecutivePlaceFails >= MAX_PLACE_FAILS) {
                logs.push(`[ABORTED] Dirt placement stopped after ${MAX_PLACE_FAILS} consecutive failures — terrain unsuitable near water.`);
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
              // Re-scan for tillable blocks near water — MUST be within 4 blocks of water for irrigation.
              // Bug: bot1/bot3 farmland reverted to dirt because previous scan used bot position
              // instead of water position, finding blocks >4 blocks from water (no irrigation).
              const vWaterX = veryFarWater.position.x, vWaterY = veryFarWater.position.y, vWaterZ = veryFarWater.position.z;
              farmCoords.length = 0;
              for (let dx3 = -4; dx3 <= 4 && farmCoords.length < seedCount; dx3++) {
                for (let dz3 = -4; dz3 <= 4 && farmCoords.length < seedCount; dz3++) {
                  if (Math.max(Math.abs(dx3), Math.abs(dz3)) > 4) continue; // Chebyshev distance <= 4 from water (9x9 irrigation area)
                  const cx = vWaterX + dx3, cz = vWaterZ + dz3;
                  for (let dy3 = 0; dy3 >= -5; dy3--) {
                    const cy = vWaterY + dy3;
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
  let consecutiveTillFails = 0;
  for (const fc of farmCoords) {
    // Timeout check: abort if farming has taken too long
    if (Date.now() - farmStartTime > FARM_TIMEOUT_MS) {
      logs.push(`[ABORTED] mc_farm timed out after ${FARM_TIMEOUT_MS / 1000}s.`);
      break;
    }

    // Mid-farm hostile check: abort if enemies approach during farming
    // Use 20-block radius to match skeleton shooting range (~20 blocks).
    const midDanger = checkDangerNearby(bot, 20);
    if (midDanger.dangerous) {
      const threatDesc = midDanger.nearestHostile
        ? `${midDanger.nearestHostile.name} at ${midDanger.nearestHostile.distance.toFixed(1)} blocks`
        : `${midDanger.hostileCount} hostile(s)`;
      logs.push(`[ABORTED] Hostile detected during farming: ${threatDesc}. Stopping to avoid death.`);
      break;
    }

    // Mid-farm HP check: abort if HP dropped during tilling (from starvation, unseen mobs,
    // fall damage, etc.). The hostile check above only catches visible mobs within 20 blocks,
    // but Bot2 [2026-03-22] had HP drop from 20→1 during dirt placement from a skeleton
    // that wasn't detected (possibly behind terrain). The bone_meal and harvest phases
    // already have HP<10 checks, but the tilling/planting loop did NOT — fixed here.
    const midFarmHp = bot.health ?? 20;
    if (midFarmHp < 10) {
      logs.push(`[ABORTED] HP critically low during tilling (${midFarmHp.toFixed(1)}/20). Stopping farm to survive.`);
      break;
    }

    // Enable sneaking BEFORE moving near the block — prevents farmland trampling
    // if the pathfinder routes over tilled soil during approach or planting.
    // Bot3 Bug #20, Bot2 Bug: farmland reverts to dirt because bot walks on it
    // between tilling and planting. Sneaking prevents this.
    bot.setControlState("sneak", true);
    await new Promise(r => setTimeout(r, 100));

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

    // Till the block — retry from different positions if first attempt fails.
    // Bot1, Bot3 Bug #20: tilling consistently fails from (fc.x+1, fc.y+1, fc.z).
    // Root cause: activateBlock face detection may pick wrong face depending on bot position.
    // Fix: try multiple approach positions to ensure top-face interaction.
    const tillPositions = [
      { x: fc.x + 1, y: fc.y + 1, z: fc.z },      // east
      { x: fc.x - 1, y: fc.y + 1, z: fc.z },      // west
      { x: fc.x, y: fc.y + 1, z: fc.z + 1 },      // south
      { x: fc.x, y: fc.y + 1, z: fc.z - 1 },      // north
    ];
    let farmlandConfirmed = false;
    for (let tillAttempt = 0; tillAttempt < tillPositions.length && !farmlandConfirmed; tillAttempt++) {
      const tp = tillPositions[tillAttempt];
      // Move to this approach position
      if (tillAttempt > 0) {
        try {
          await botManager.moveTo(username, tp.x, tp.y, tp.z);
          logs.push(`Retry till from (${tp.x},${tp.y},${tp.z})`);
        } catch (_) { continue; }
      }
      // Till the block
      try {
        const tillResult = await botManager.tillSoil(username, fc.x, fc.y, fc.z);
        logs.push(`Till (${fc.x},${fc.y},${fc.z}): ${tillResult}`);
      } catch (e) {
        logs.push(`Till failed at (${fc.x},${fc.y},${fc.z}): ${e}`);
        continue;
      }
      // Poll for farmland state — up to 1.5 second (server may take several ticks)
      {
        const { Vec3: Vec3Cls } = await import("vec3");
        for (let poll = 0; poll < 10; poll++) {
          await new Promise(r => setTimeout(r, 150));
          const b = bot.blockAt(new Vec3Cls(fc.x, fc.y, fc.z));
          if (b && b.name === "farmland") { farmlandConfirmed = true; break; }
        }
      }
    }
    if (!farmlandConfirmed) {
      logs.push(`Farmland check (${fc.x},${fc.y},${fc.z}): NOT farmland after ${tillPositions.length} positions — skipping`);
      bot.setControlState("sneak", false);
      consecutiveTillFails++;
      // Bot2 [2026-03-22]: 19 consecutive dirt placement failures while skeleton attacked.
      // Abort early when tilling consistently fails — staying stationary is lethal.
      if (consecutiveTillFails >= 5) {
        logs.push(`[ABORTED] ${consecutiveTillFails} consecutive tilling failures — terrain unsuitable for farming. Move to a flatter area near water.`);
        break;
      }
      continue;
    }
    consecutiveTillFails = 0; // Reset on success
    logs.push(`Farmland check (${fc.x},${fc.y},${fc.z}): farmland confirmed`);

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

  // Safety: ensure sneak is released after farming loop (in case of unexpected break path)
  bot.setControlState("sneak", false);

  // Step 4: Apply bone_meal for instant growth (up to 8x per crop)
  const boneMealInv = botManager.getInventory(username).find(i => i.name === "bone_meal");
  if (boneMealInv && boneMealInv.count > 0) {
    const { Vec3: Vec3Cls } = await import("vec3");
    for (const fc of plantedCoords) {
      // Safety checks during bone meal application
      if (Date.now() - farmStartTime > FARM_TIMEOUT_MS) {
        logs.push(`[ABORTED] mc_farm timed out during bone meal phase.`);
        break;
      }
      // Use 20-block radius to match skeleton shooting range (~20 blocks).
      // Previously used 16 — inconsistent with other mc_farm phases that use 20.
      const bmDanger = checkDangerNearby(bot, 20);
      if (bmDanger.dangerous) {
        logs.push(`[ABORTED] Hostile detected during bone meal: ${bmDanger.nearestHostile?.name}. Stopping.`);
        break;
      }
      // HP monitoring: abort if bot is taking damage from any source
      const bmHp = bot.health ?? 20;
      if (bmHp < 10) {
        logs.push(`[ABORTED] HP critically low during bone meal (${bmHp.toFixed(1)}/20). Stopping farm to survive.`);
        break;
      }
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
    // Safety: hostile + HP check during harvest — harvest involves moveTo + dig per block,
    // leaving bot exposed. Bot2: HP 20→1 during stationary farm operations.
    const harvestDanger = checkDangerNearby(bot, 20);
    if (harvestDanger.dangerous) {
      const hd = harvestDanger.nearestHostile
        ? `${harvestDanger.nearestHostile.name} at ${harvestDanger.nearestHostile.distance.toFixed(1)} blocks`
        : `${harvestDanger.hostileCount} hostile(s)`;
      logs.push(`[ABORTED] Hostile detected during harvest: ${hd}. Stopping.`);
      break;
    }
    const harvestHp = bot.health ?? 20;
    if (harvestHp < 10) {
      logs.push(`[ABORTED] HP critically low during harvest (${harvestHp.toFixed(1)}/20). Stopping farm to survive.`);
      break;
    }
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
            // Safety: hostile + HP check per block during nearby wheat harvest
            const scanDanger = checkDangerNearby(freshBot, 20);
            if (scanDanger.dangerous) {
              logs.push(`[ABORTED] Hostile detected during nearby wheat harvest. Stopping.`);
              break;
            }
            if ((freshBot.health ?? 20) < 10) {
              logs.push(`[ABORTED] HP low during nearby wheat harvest (${(freshBot.health ?? 20).toFixed(1)}). Stopping.`);
              break;
            }
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
  const bot = botManager.getBot(username);

  // Night-time safety: auto-equip armor and detect nearby hostiles
  let nightWarning = "";
  if (bot) {
    const timeOfDay = bot.time?.timeOfDay ?? 0;
    const isNight = timeOfDay > 12541 || timeOfDay < 100; // night/midnight/pre-dawn
    const hp = Math.round((bot.health ?? 20) * 10) / 10;
    const hunger = Math.round(((bot as any).food ?? 20) * 10) / 10;

    // Check if bot has any food in inventory
    const inv = botManager.getInventory(username);
    const hasFood = inv.some(i => EDIBLE_FOOD_NAMES.has(i.name));

    // BLOCK navigation when starving or near-starving with no food — regardless of time of day.
    // Bot1 Session 44: hunger=0, navigated to find animals, fell into cave, drowned.
    // Bot3 Death #11: hunger=0, navigated to farm, fell into ravine.
    // Bot1 Session 28: hunger=1, navigated at night, hunger hit 0 mid-travel, died.
    // Without food, HP only declines. Long navigation = guaranteed death.
    // Threshold raised from 0 to 2: at hunger=1-2, sprint drains the remaining hunger
    // to 0 within seconds of navigation start, then starvation damage begins immediately.
    // Navigation at hunger 1-2 without food is functionally identical to hunger=0.
    if (hunger <= 2 && !hasFood) {
      // At hunger<=2 without food, HP only declines — any navigation leads to death.
      // Bot1 Sessions 28,35,44: died at HP 10-14 navigating with hunger=0-1, no food.
      // Previous threshold (hunger=0 && hp < 15) was too lenient — hunger=1 depletes to 0
      // within the first navigation segment, and mobs + starvation killed at HP 14.
      // Block all non-emergency navigation when near-starving without food.
      if (hp < 15) {
        return `[REFUSED] Cannot navigate while starving — HP=${hp}, hunger=${hunger}, no food in inventory. HP will only decrease. Find food first: mc_combat(target="cow"), mc_combat(target="pig"), or mc_eat. Short-range movement only (mc_flee, dig shelter).`;
      }
      // Even at HP >= 15, warn strongly — starvation drains HP and mob hits are cumulative.
      nightWarning += `\n[STARVATION WARNING] Hunger=${hunger}, no food. HP will only decline. Find food urgently.`;
    }

    // Auto-equip armor before ALL navigation — not just at night.
    // Bot1/Bot2 [2026-03-22]: multiple deaths from surprise pillager/skeleton attacks during
    // daytime navigation. Pillagers are active 24/7, cave zombies surface near openings.
    // Equipping armor is cheap (milliseconds) and prevents 4-8 damage per unarmored hit.
    // Previous code only equipped at night or when daytime hostiles were already detected,
    // which misses surprise attacks that happen DURING pathfinder movement.
    try {
      await botManager.equipArmor(username);
    } catch {
      // Continue without armor
    }

    if (isNight) {
      // Scan for nearby hostile threats using centralized isHostileMob().
      // Bug fix: inline list with .includes() falsely matched "zombified_piglin" via "zombie" substring.
      const nearbyHostiles: Array<{ name: string; dist: number }> = [];
      for (const entity of Object.values(bot.entities)) {
        if (!entity || !entity.position || entity === bot.entity) continue;
        const dist = entity.position.distanceTo(bot.entity.position);
        if (dist > 24) continue;
        const name = entity.name?.toLowerCase() ?? "";
        if (isHostileMob(bot, name)) {
          nearbyHostiles.push({ name, dist: Math.round(dist * 10) / 10 });
        }
      }
      if (nearbyHostiles.length > 0) {
        const closestDist = nearbyHostiles.sort((a, b) => a.dist - b.dist)[0].dist;
        const threatList = nearbyHostiles
          .slice(0, 5)
          .map(h => `${h.name}(${h.dist}m)`)
          .join(", ");
        // BLOCK navigation when HP is dangerously low at night with nearby hostiles.
        // Bot1 Sessions 20-42: 15+ deaths from navigating at night with low HP near mobs.
        // Navigating exposes the bot to mob attacks during pathfinder movement.
        // Raise threshold to HP<=14 when bot has no food — HP can't regenerate so any
        // damage from mobs during navigation is permanent and cumulative.
        // Bot1 Session 28: HP=14, hunger=1, died during night navigation.
        const hpThreshold = hasFood ? 10 : 14;
        if (hp <= hpThreshold && closestDist <= 16) {
          const noFoodNote = hasFood ? "" : " No food — HP cannot regenerate.";
          return `[REFUSED] Too dangerous to navigate at night — HP=${hp}, ${nearbyHostiles.length} hostile(s) nearby: ${threatList}.${noFoodNote} Use mc_flee first, then mc_navigate. Or build shelter (dig 1x1x2 hole + place block overhead) and wait for dawn.`;
        }
        nightWarning = `\n[NIGHT WARNING] HP=${hp}, ${nearbyHostiles.length} hostile(s) nearby: ${threatList}. Consider mc_flee or shelter before long navigation.`;
      }
    } else {
      // DAYTIME close-range hostile check: pillagers, cave zombies, and other hostiles
      // can attack during daytime. Only block navigation when a hostile is VERY close
      // (within 10 blocks) AND HP is low — daytime is generally safer but not risk-free.
      // Bot1 [2026-03-22]: killed by zombie during daytime navigation at low HP.
      // Bot2: pillager knockback caused fall during daytime movement.
      // The night check uses 16-block radius; daytime uses tighter 10-block radius
      // since most daytime hostiles are remnants from night or cave dwellers.
      if (hp < 12) {
        const dayHostiles: Array<{ name: string; dist: number }> = [];
        for (const entity of Object.values(bot.entities)) {
          if (!entity || !entity.position || entity === bot.entity) continue;
          const dist = entity.position.distanceTo(bot.entity.position);
          if (dist > 10) continue;
          const name = entity.name?.toLowerCase() ?? "";
          if (isHostileMob(bot, name)) {
            dayHostiles.push({ name, dist: Math.round(dist * 10) / 10 });
          }
        }
        if (dayHostiles.length > 0) {
          // Armor already equipped above (always-equip). Just warn about threats.
          const dayThreatList = dayHostiles
            .sort((a, b) => a.dist - b.dist)
            .slice(0, 5)
            .map(h => `${h.name}(${h.dist}m)`)
            .join(", ");
          nightWarning += `\n[DANGER WARNING] HP=${hp}, ${dayHostiles.length} hostile(s) within 10 blocks: ${dayThreatList}. Use mc_flee or mc_combat before navigating.`;
        }
      }
    }
  }

  // Pre-navigation proactive eat: consume food before starting ANY navigation if HP < 18
  // OR hunger < 14. HP-only check missed starvation spirals: Bot1 Session 28 started at
  // HP=14/hunger=1, hunger hit 0 mid-travel, HP couldn't regenerate, died to mobs.
  // Bot2/Bot3: multiple hunger-0 deadlocks where HP was initially fine but hunger depletion
  // during navigation caused irrecoverable starvation. Eating at hunger<14 maintains the
  // saturation buffer that prevents hunger from hitting 0 during travel.
  if (bot) {
    const preNavHp = bot.health ?? 20;
    const preNavHunger = (bot as any).food ?? 20;
    if (preNavHp < 18 || preNavHunger < 14) {
      const preNavFood = bot.inventory.items().find((item: any) => EDIBLE_FOOD_NAMES.has(item.name));
      if (preNavFood) {
        try {
          await bot.equip(preNavFood, "hand");
          await bot.consume();
          console.error(`[Navigate] Pre-nav auto-ate ${preNavFood.name} (HP: ${preNavHp.toFixed(1)} → ${bot.health?.toFixed(1)}, hunger: ${preNavHunger} → ${(bot as any).food ?? "?"})`);
        } catch (_) { /* ignore eat errors */ }
      }
    }
  }

  // Navigate to entity
  if (args.target_entity) {
    // Use filtered findEntities to check existence — passing entityType applies
    // the same passive/hostile filtering as fight() (e.g., "pig" won't match "zombified_piglin").
    const entityInfo = botManager.findEntities(username, args.target_entity, args.max_distance ?? 64);
    if (entityInfo.includes("No ") || entityInfo.includes("not found")) {
      return `No ${args.target_entity} found within ${args.max_distance ?? 64} blocks`;
    }

    // Find entity position from nearby entities
    const bot = botManager.getBot(username);
    if (!bot) throw new Error("Not connected");

    const entities = Object.values(bot.entities);
    let bestScore = Infinity;
    let closestDist = Infinity;
    let closestPos: { x: number; y: number; z: number } | null = null;

    // Determine if the requested target is itself hostile (same logic as fight() in bot-survival.ts).
    // If searching for a passive mob name like "pig", we must NOT match hostile mobs
    // that contain the substring (e.g., "zombified_piglin").
    // Bot1 death: fight("pig") matched zombified_piglin. Same risk exists in navigation.
    const targetLower = args.target_entity.toLowerCase();
    const targetIsHostile = isHostileMob(bot, targetLower);
    const botY = bot.entity.position.y;

    for (const entity of entities) {
      if (!entity || !entity.position) continue;
      const eName = (entity.name ?? "").toLowerCase();
      const eDisplayName = ((entity as any).displayName ?? "").toLowerCase();
      const eUsername = ((entity as any).username ?? "").toLowerCase();

      // Exact match is always OK
      const exactMatch = eName === targetLower || eDisplayName === targetLower || eUsername === targetLower;
      if (!exactMatch) {
        // Substring match — but reject if target is passive and match is hostile,
        // and always reject neutral mobs (zombified_piglin) from substring matches.
        // Bot3 Deaths #1,#9,#16: "zombie" substring-matched "zombified_piglin".
        const substringMatch = eName.includes(targetLower) || eDisplayName.includes(targetLower);
        if (!substringMatch) continue;
        if (!targetIsHostile && isHostileMob(bot, eName)) continue;
        if (isNeutralMob(eName)) continue;
      }

      const dist = entity.position.distanceTo(bot.entity.position);
      // Surface preference scoring: penalize entities underground relative to bot.
      // Bot1 Sessions 31-34,44, Bot2, Bot3 #3: mc_navigate to passive mobs (cow, pig)
      // picked the closest entity by distance, which was often underground in a cave.
      // Navigating to underground entities causes cave routing and repeated deaths.
      // Penalty: +3 distance per block below bot's Y level (beyond 5-block tolerance).
      // Surface/above entities get no penalty. Same approach as findBlock surface preference.
      const depthBelowBot = Math.max(botY - entity.position.y - 5, 0);
      const score = dist + depthBelowBot * 3;
      if (score < bestScore) {
        bestScore = score;
        closestDist = dist;
        closestPos = { x: entity.position.x, y: entity.position.y, z: entity.position.z };
      }
    }

    if (!closestPos) {
      return `Found ${args.target_entity} in entity list but could not get position`;
    }

    // Delegate to coordinate-based navigation which has segmented HP checks,
    // auto-eating, and starvation detection for long distances (>50 blocks).
    // Bot1 Sessions 12,31-34,37: deaths during long-distance entity navigation
    // (e.g., navigating to pig at 64 blocks) that bypassed all segment safety checks.
    const entityNavResult = await mc_navigate({ x: closestPos.x, y: closestPos.y, z: closestPos.z });
    return `Found ${args.target_entity} at (${closestPos.x.toFixed(1)}, ${closestPos.y.toFixed(1)}, ${closestPos.z.toFixed(1)}), ${closestDist.toFixed(1)} blocks away.\n${entityNavResult}`;
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
    // Delegate to coordinate-based navigation which has segmented HP checks,
    // auto-eating, and starvation detection for long distances (>50 blocks).
    const blockNavResult = await mc_navigate({ x, y, z });
    return `${findResult}\n${blockNavResult}`;
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
          // Between-segment safety check: abort if HP dropped critically during travel.
          // Bot1 Sessions 21-42: 15+ deaths from HP dropping during multi-segment night navigation.
          // The initial HP check passes (HP>10), but mobs whittle HP down between segments.
          // Also check hunger: at hunger=0, HP drains from starvation and can't regenerate.
          // Bot1 Session 28: started HP=14/hunger=1, died during navigation as hunger hit 0.
          const segBot = botManager.getBot(username);
          if (segBot) {
            const segHp = segBot.health ?? 0;
            const segHunger = (segBot as any).food ?? 20;
            const segTime = segBot.time?.timeOfDay ?? 0;
            const segIsNight = segTime > 12541 || segTime < 100;
            // Check food availability mid-travel for smarter thresholds
            const segInv = botManager.getInventory(username);
            const segHasFood = segInv.some(item => EDIBLE_FOOD_NAMES.has(item.name));
            // Abort at night with low HP — use higher threshold when no food since HP can't regen.
            // Bot1 Session 28: HP=14/hunger=1, died during multi-segment night navigation.
            const nightHpThreshold = segHasFood ? 8 : 12;
            if (segHp <= nightHpThreshold && segIsNight) {
              const curPos2 = botManager.getPosition(username);
              const posStr = curPos2 ? `(${Math.round(curPos2.x)}, ${Math.round(curPos2.y)}, ${Math.round(curPos2.z)})` : "unknown";
              const foodNote = segHasFood ? "" : " No food in inventory — HP cannot regenerate.";
              return `[ABORTED] Navigation stopped after ${i-1}/${steps} segments — HP=${Math.round(segHp*10)/10} at night.${foodNote} Current position: ${posStr}. Use mc_flee, build shelter (dig 1x1x2 + cover), or mc_eat before continuing.`;
            }
            // Abort if starving or near-starvation with low HP — starvation drains HP and mobs finish the job.
            // Bot1 Session 28: HP=14, hunger=1, died during multi-segment navigation because hunger
            // hit 0 mid-travel (HP can't regen) and mobs killed bot. Previous threshold (hunger<=0 && HP<=10)
            // was too lenient — bot kept navigating with hunger near 0 until HP dropped below 10.
            // New: abort at hunger<=2 with no food (hunger will hit 0 during travel) AND HP<=14.
            const starvationDanger = (segHunger <= 0 && segHp <= 12) || (segHunger <= 2 && !segHasFood && segHp <= 14);
            if (starvationDanger) {
              const curPos2 = botManager.getPosition(username);
              const posStr = curPos2 ? `(${Math.round(curPos2.x)}, ${Math.round(curPos2.y)}, ${Math.round(curPos2.z)})` : "unknown";
              return `[ABORTED] Navigation stopped after ${i-1}/${steps} segments — HP=${Math.round(segHp*10)/10}, hunger=${Math.round(segHunger)} (starving). Current position: ${posStr}. Find food immediately (mc_combat cow/pig, mc_eat) before continuing.`;
            }
            // Mid-segment hostile threat scan: abort if hostile mobs are nearby.
            // Bot1 Sessions 20-44: 15+ deaths from mobs spawning between segments during night nav.
            // The initial hostile check passes (no mobs at start), but new mobs spawn during
            // the 5-15 seconds each segment takes. Without this check, bot walks into new mobs.
            // At night: scan 16 blocks. During day: scan 12 blocks.
            // Bot1/Bot2 [2026-03-22]: killed by pillagers/zombies during DAYTIME navigation
            // at HP >= 12 — the old condition (segIsNight || segHp < 12) skipped daytime scans
            // entirely when HP was healthy, missing creepers and pillagers that attacked mid-nav.
            // Creepers can one-shot at any HP without blast protection armor.
            // Pillagers are active 24/7 and deal significant ranged damage.
            // Now: ALWAYS scan between segments regardless of time/HP. Scan radius is wider
            // at night (16) since more hostiles are active.
            const segScanRadius = segIsNight ? 16 : 16;
            {
              const segDanger = checkDangerNearby(segBot, segScanRadius);
              if (segDanger.dangerous && segDanger.nearestHostile) {
                const nearDist = segDanger.nearestHostile.distance;
                const nearName = segDanger.nearestHostile.name;
                // Creepers within 12 blocks are especially lethal (1-shot explosion at any HP).
                // Always abort for creepers — they are the #1 cause of death across all bots.
                const isCreeperClose = nearName === "creeper" && nearDist <= 12;
                // Other hostiles within 10 blocks when HP < 16 (need HP buffer for hits).
                const isHostileClose = nearDist <= 10 && segHp < 16;
                // At night, also abort for any hostile within 12 blocks regardless of HP.
                // Night hostiles are denser and harder to escape — better to stop and assess.
                const isNightHostileClose = segIsNight && nearDist <= 12;
                // Ranged mobs (skeleton, stray, pillager, drowned) within 16 blocks when unarmored.
                // Bot1 Sessions 22,35, Bot2 [2026-03-22]: killed by skeleton during daytime
                // at HP >= 16 because old scan (12 blocks) missed skeletons at 14-16 blocks.
                // Skeletons shoot from ~16+ blocks. With no armor, each hit deals 4-5 damage.
                // Check armor: count equipped armor pieces.
                let segArmorCount = 0;
                for (const slotName of ["head", "torso", "legs", "feet"] as const) {
                  const slot = segBot.inventory.slots[segBot.getEquipmentDestSlot(slotName)];
                  if (slot && slot.name.includes("_")) segArmorCount++;
                }
                const RANGED_MOBS = ["skeleton", "stray", "pillager", "drowned"];
                const isRangedMobClose = segArmorCount <= 1 && RANGED_MOBS.includes(nearName) && nearDist <= 16;
                if (isCreeperClose || isHostileClose || isNightHostileClose || isRangedMobClose) {
                  const curPos2 = botManager.getPosition(username);
                  const posStr = curPos2 ? `(${Math.round(curPos2.x)}, ${Math.round(curPos2.y)}, ${Math.round(curPos2.z)})` : "unknown";
                  const timeNote = segIsNight ? "at night" : "during daytime";
                  return `[ABORTED] Navigation stopped after ${i-1}/${steps} segments — ${nearName} detected ${nearDist.toFixed(1)} blocks away ${timeNote}, HP=${Math.round(segHp*10)/10}. Current position: ${posStr}. Use mc_flee or mc_combat to handle threat before continuing.`;
                }
              }
            }
            // Auto-eat between segments when HP < 18 OR hunger < 14.
            // Bot1 Sessions 28,30,35: HP dropped during multi-segment travel but food in
            // inventory was never consumed. Previous threshold was HP-only, but the root cause
            // of many death spirals is hunger depletion: Bot1 Session 28 (hunger=1→0, died),
            // Bot2/Bot3 (hunger 0 deadlocks). At hunger<14, saturation is depleted and hunger
            // bar drops rapidly during sprinting/navigation. Eating proactively prevents the
            // hunger→0→starvation→death chain that kills bots even at full HP.
            if ((segHp < 18 || segHunger < 14) && segHasFood) {
              const segFoodItem = segBot.inventory.items().find((item: any) => EDIBLE_FOOD_NAMES.has(item.name));
              if (segFoodItem) {
                try {
                  await segBot.equip(segFoodItem, "hand");
                  await segBot.consume();
                  console.error(`[Navigate] Auto-ate ${segFoodItem.name} between segments (HP: ${segHp.toFixed(1)} → ${segBot.health?.toFixed(1)}, hunger: ${segHunger} → ${(segBot as any).food ?? "?"})`);
                } catch (_) { /* ignore eat errors */ }
              }
            }
          }

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
          // SAFETY: For intermediate segments, keep Y at bot's current level instead of
          // interpolating downward. Linear Y interpolation sends the pathfinder into caves
          // when target is lower than start (e.g., target Y=62, start Y=96 -> intermediate
          // targets at Y=85, Y=74, Y=63... each one triggers cave routing).
          // The moveTo cave detection (bot-movement.ts L274-291) only fires when
          // targetIsAtOrAboveStart, so a lower target Y bypasses that safety check entirely.
          // Bot1 Sessions 31-34,44: 6+ drowning deaths from pathfinder routing through
          // water at Y=61-62 during multi-segment navigation to lower-Y targets.
          // Bot3 Death #11: fell into ravine during multi-segment nav to farm.
          // Fix: only use the actual target Y on the final segment (remainDist <= segmentSize).
          const isFinalSegment = remainDist <= segmentSize;
          const iy = isFinalSegment ? ny : curPos.y;
          lastResult = await botManager.moveTo(username, ix, iy, iz);
          // Check if segment failed — stop early instead of wasting turns
          if (lastResult.includes("Cannot reach") || lastResult.includes("Path blocked") || lastResult.includes("timeout")) {
            consecutiveFailures++;
            if (consecutiveFailures >= 2) {
              return `Navigation stopped after ${i}/${steps} segments: ${lastResult}. Stuck at current position — try a different route or clear obstacles.` + nightWarning;
            }
          } else {
            consecutiveFailures = 0;
          }
          // SAFETY: Detect cave/underground routing within a segment.
          // moveToBasic detects underground routing and returns descriptive messages,
          // but the segment loop previously treated these as generic failures (2 needed
          // to abort). Cave routing is immediately dangerous — one segment underground
          // can trap the bot. Abort immediately on cave descent detection.
          // Bot1 Sessions 42-44, Bot2/Bot3: multi-segment navigation where one segment
          // routed underground, bot got trapped in cave system with mobs.
          if (lastResult.includes("underground") || lastResult.includes("cave") || lastResult.includes("descended")) {
            const curPos3 = botManager.getPosition(username);
            const posStr3 = curPos3 ? `(${Math.round(curPos3.x)}, ${Math.round(curPos3.y)}, ${Math.round(curPos3.z)})` : "unknown";
            return `[ABORTED] Navigation stopped after ${i}/${steps} segments — underground/cave routing detected. ${lastResult} Current position: ${posStr3}. Navigate in shorter hops or use mc_tunnel(direction="up") to return to surface.` + nightWarning;
          }
        }
        const segResult = lastResult || await botManager.moveTo(username, nx, ny, nz);
        return segResult + nightWarning;
      }
    }
    // SAFETY: For short-distance navigation, clamp target Y to prevent deep cave routing.
    // When target Y is extremely far below bot's current Y, pathfinder routes underground
    // through caves to reach the lower elevation. The segmented path (dist>50) already
    // keeps intermediate Y at bot level, but short-distance direct paths had no such
    // protection. Bot1 Sessions 42-44, Bot2/Bot3: pathfinder routed underground for
    // short-distance navigation to very deep targets (e.g., chest at Y=62, bot at Y=96).
    // Previous threshold (5 blocks) was too aggressive — prevented reaching chests and
    // infrastructure 5-15 blocks below bot. Bot1 stuck at Y=66, chests at Y=89.
    // Bot2: pathfinding deadlock because chests at Y=88 were clamped from bot at Y=99+.
    // New threshold: 20 blocks. moveToBasic's dynamic cave detection (proportional to
    // target depth + 5 block buffer) catches actual cave routing during navigation.
    // This clamp only prevents pathfinder from targeting extremely deep positions (>20
    // blocks below) which are almost certainly underground cave destinations.
    let safeNy = ny;
    if (pos && ny < pos.y - 20) {
      console.error(`[Navigate] Short-distance Y-clamp: target Y=${ny} is ${(pos.y - ny).toFixed(1)} blocks below bot Y=${pos.y.toFixed(1)}. Clamping to bot Y to prevent deep cave routing.`);
      safeNy = Math.round(pos.y);
    }
    const directResult = await botManager.moveTo(username, nx, safeNy, nz);
    return directResult + nightWarning;
  }

  return "Provide coordinates (x, y, z), target_block, or target_entity";
}

// ─── mc_combat ───────────────────────────────────────────────────────────────

export async function mc_combat(
  targetOrArgs?: string | { target?: string; flee_at_hp?: number; fleeAtHp?: number; collect_items?: boolean },
  fleeAtHpArg: number = 8
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

  // Pre-combat HP safety check: refuse combat when HP is critically low.
  // Bot1 Sessions 23,25,28,29: entered combat at HP<10, died before flee threshold triggered.
  // Bot3 Deaths #1,#3,#9: combat at low HP against hostile/neutral mobs.
  // Passive food mobs (cow, pig, chicken) are exempted — they don't fight back.
  const combatBot = botManager.getBot(username);
  if (combatBot) {
    const combatHp = combatBot.health ?? 20;
    const passiveFoodMobs = ["cow", "pig", "chicken", "sheep", "rabbit", "horse", "donkey", "mule", "mooshroom", "llama", "goat", "salmon", "cod", "squid", "turtle"];
    const isPassiveFood = target ? passiveFoodMobs.some(p => target!.toLowerCase().includes(p)) : false;
    if (!isPassiveFood && combatHp < 8) {
      return `[REFUSED] HP too low for combat (${combatHp.toFixed(1)}/20). Hostile mobs can kill in 1-2 hits at this HP. Use mc_eat to heal first, or mc_flee to escape. If no food available, dig a 1x1x2 shelter hole and wait.`;
    }
  }

  // Pre-combat creeper proximity check: refuse ALL combat when a creeper is within 8 blocks.
  // Bot1 Sessions 24,27: called mc_combat(zombie) while creeper at 5-11 blocks. Combat movement
  // brought bot near creeper, which exploded (up to 49 damage unarmored, lethal at any HP).
  // Applies to ALL combat — with or without target. When mc_combat() is called without a target,
  // bot approaches the nearest hostile, potentially walking toward a creeper or closing distance
  // to one. The in-loop creeper check in attack()/fight() only fires mid-combat, but by then
  // the bot may already be within explosion range.
  if (combatBot) {
    for (const entity of Object.values(combatBot.entities)) {
      if (!entity || !entity.position || entity === combatBot.entity) continue;
      const eName = entity.name?.toLowerCase() ?? "";
      if (eName !== "creeper") continue;
      const creeperDist = entity.position.distanceTo(combatBot.entity.position);
      if (creeperDist <= 8) {
        const engageTarget = target || "nearest hostile";
        return `[REFUSED] Creeper detected ${creeperDist.toFixed(1)} blocks away — too dangerous to engage ${engageTarget}. Creeper explosion deals up to 49 damage, lethal at any HP without blast protection armor. Use mc_flee first to escape the creeper, THEN engage.`;
      }
    }
  }

  // Pre-combat proactive eat: consume food before fighting if HP < 16 OR hunger < 14.
  // Bot1 Sessions 23,28,29: started combat at HP 10-14 with food in inventory, never ate,
  // died during combat when flee threshold triggered too late. Eating before combat provides
  // HP buffer that can mean the difference between surviving a hit and dying.
  // Also eat when hunger < 14: combat drains hunger rapidly (sprinting + attacking), and
  // if hunger hits 0 during combat, HP stops regenerating — making every hit potentially fatal.
  // Bot1 Session 28: hunger=1 at combat start, hunger hit 0 mid-fight, HP couldn't regen, died.
  if (combatBot) {
    const preCombatHp = combatBot.health ?? 20;
    const preCombatHunger = (combatBot as any).food ?? 20;
    if (preCombatHp < 16 || preCombatHunger < 14) {
      const preCombatFood = combatBot.inventory.items().find((item: any) => EDIBLE_FOOD_NAMES.has(item.name));
      if (preCombatFood) {
        try {
          await combatBot.equip(preCombatFood, "hand");
          await combatBot.consume();
          console.error(`[Combat] Pre-combat auto-ate ${preCombatFood.name} (HP: ${preCombatHp.toFixed(1)} → ${combatBot.health?.toFixed(1)}, hunger: ${preCombatHunger} → ${(combatBot as any).food ?? "?"})`);
        } catch (_) { /* ignore eat errors */ }
      }
    }
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
    // Warn about nearby hostiles when targeting passive mobs (sheep, cow, pig, chicken, etc.)
    // Bot1 Session 16: died to zombie while fighting sheep. Bot3 deaths #1,#3: similar pattern.
    const passiveMobs = ["sheep", "cow", "pig", "chicken", "rabbit", "horse", "donkey", "mule", "mooshroom", "llama", "fox", "goat", "frog", "turtle", "salmon", "cod", "squid"];
    const isPassiveTarget = passiveMobs.some(p => target!.toLowerCase().includes(p));
    let hostileWarning = "";
    if (isPassiveTarget) {
      const combatBot = botManager.getBot(username);
      if (combatBot) {
        // Night + no armor: refuse passive hunts entirely.
        // Bot1 Session 16: died to zombie while fighting sheep at night.
        // Passive hunts take time (chase + kill + collect), during which new mobs spawn.
        // The hostile check below only catches EXISTING hostiles — it misses mobs that
        // spawn during the hunt. At night without armor, this is consistently fatal.
        const huntTime = combatBot.time?.timeOfDay ?? 0;
        const huntIsNight = huntTime > 12541 || huntTime < 100;
        if (huntIsNight) {
          let huntArmorCount = 0;
          for (const slotName of ["head", "torso", "legs", "feet"] as const) {
            const slot = combatBot.inventory.slots[combatBot.getEquipmentDestSlot(slotName)];
            if (slot && slot.name.includes("_")) huntArmorCount++;
          }
          const huntHp = combatBot.health ?? 20;
          if (huntArmorCount <= 1 && huntHp < 14) {
            return `[REFUSED] Too dangerous to hunt ${target} at night without armor — HP=${huntHp.toFixed(1)}, armor=${huntArmorCount}/4. Mobs spawn during passive hunts and attack while bot is chasing ${target}. Wait for dawn, equip armor, or use mc_eat to raise HP first.`;
          }
        }

        // Use centralized isHostileMob() instead of inline list with substring matching.
        // Bug fix: inline "zombie".includes() falsely matched "zombified_piglin" (neutral mob).
        const nearbyHostiles: Array<{ name: string; dist: number }> = [];
        for (const entity of Object.values(combatBot.entities)) {
          if (!entity || !entity.position || entity === combatBot.entity) continue;
          const dist = entity.position.distanceTo(combatBot.entity.position);
          if (dist > 20) continue;
          const eName = entity.name?.toLowerCase() ?? "";
          if (isHostileMob(combatBot, eName)) {
            nearbyHostiles.push({ name: eName, dist: Math.round(dist * 10) / 10 });
          }
        }
        if (nearbyHostiles.length > 0) {
          const closestHostileDist = nearbyHostiles.sort((a, b) => a.dist - b.dist)[0].dist;
          const threatList = nearbyHostiles
            .slice(0, 5)
            .map(h => `${h.name}(${h.dist}m)`)
            .join(", ");
          // BLOCK the fight if hostiles are within 16 blocks — bot will die during passive mob hunt
          // Bot1 Session 16: zombie killed while fighting sheep. Bot3 deaths #1,#3,#9: same pattern.
          if (closestHostileDist <= 16) {
            return `[REFUSED] Cannot hunt ${target} — ${nearbyHostiles.length} hostile(s) within attack range: ${threatList}. Use mc_flee or mc_combat(target="${nearbyHostiles[0].name}") to clear threats first, or wait for daytime.`;
          }
          hostileWarning = `\n[DANGER] ${nearbyHostiles.length} hostile(s) nearby while hunting ${target}: ${threatList}. Kill or flee hostiles FIRST.`;
        }
      }
    }
    const fightResult = await botManager.fight(username, target, fleeAtHp);
    return fightResult + hostileWarning;
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
  // Use short walk with ground-check to avoid walking off cliffs or into water.
  // Previous: 3s blind sprint in random direction caused cliff/water deaths.
  try {
    const dropPos = bot.entity.position.clone();
    // Try up to 4 random directions to find a safe one
    for (let attempt = 0; attempt < 4; attempt++) {
      const yaw = Math.random() * Math.PI * 2;
      const checkX = Math.floor(dropPos.x + Math.cos(yaw) * 3);
      const checkZ = Math.floor(dropPos.z - Math.sin(yaw) * 3);
      const checkY = Math.floor(dropPos.y);
      const groundBlock = bot.blockAt(new (await import("vec3")).Vec3(checkX, checkY - 1, checkZ));
      const feetBlock = bot.blockAt(new (await import("vec3")).Vec3(checkX, checkY, checkZ));
      // Only walk if there's solid ground and no water/lava
      if (groundBlock && groundBlock.name !== "air" && groundBlock.name !== "water" && groundBlock.name !== "lava" &&
          feetBlock && (feetBlock.name === "air" || feetBlock.name === "cave_air")) {
        bot.look(yaw, 0);
        await new Promise(r => setTimeout(r, 100));
        bot.setControlState("forward", true);
        await new Promise(r => setTimeout(r, 1500));
        bot.setControlState("forward", false);
        await new Promise(r => setTimeout(r, 300));
        break;
      }
    }
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
