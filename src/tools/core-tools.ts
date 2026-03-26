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
import { checkDangerNearby, isHostileMob, isNeutralMob, EDIBLE_FOOD_NAMES, isWaterBlock, isNearCliffEdge } from "../bot-manager/minecraft-utils.js";
import { setAgentType } from "../agent-state.js";
import { registry } from "../tool-handler-registry.js";
import { lastSleepTick } from "../bot-manager/bot-survival.js";

// High-level actions accessed via registry for hot-reload support
function getHighLevel() {
  const hl = registry.highLevel as {
    minecraft_gather_resources: Function;
    minecraft_build_structure: Function;
    minecraft_craft_chain: Function;
  } | undefined;
  if (!hl) {
    throw new Error("registry.highLevel is undefined — high-level-actions.ts was not loaded. Ensure 'import \"./tools/high-level-actions.js\"' exists in index.ts. Try mc_reload to reinitialize.");
  }
  return hl;
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
  // Use centralized EDIBLE_FOOD_NAMES for food categorization — ensures consistency
  // between "status shows food available" and "auto-eat can actually eat it".
  // Bug: mc_status had a local foodNames set that included spider_eye/poisonous_potato
  // (harmful) and was missing dried_kelp/beetroot_soup/suspicious_stew/enchanted_golden_apple
  // (all edible). This caused agents to believe they had food when they didn't, or miss
  // food items categorized as "materials" in the status output.
  // Also include "cake" for display — it's a placeable food block that's useful to report.
  const foodDisplayNames = new Set([...EDIBLE_FOOD_NAMES, "cake"]);

  for (const item of inventory) {
    const isTool = toolSuffixes.some(s => item.name.includes(s));
    if (isTool) {
      tools.push(item.name);
    } else if (foodDisplayNames.has(item.name)) {
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
  // nearbyEntities: count all entities within 24 blocks by name (passive, hostile, players, items).
  // Bug [2026-03-23]: status.nearbyEntities was undefined — field was never included in the
  // return object. Agents rely on this to find cows/pigs for food, detect players for team
  // coordination, and verify entity presence before combat/navigate. Without it, agents
  // called combat("cow") blindly, navigate("cow") without knowing if cows exist, and
  // couldn't assess nearby passive mobs for food gathering.
  const nearbyEntities: Record<string, number> = {};
  for (const entity of entities) {
    if (!entity || !entity.position || entity === bot.entity) continue;
    const dist = entity.position.distanceTo(bot.entity.position);
    if (dist > THREAT_RADIUS) continue;
    const name = entity.name ?? (entity as any).username ?? "unknown";
    // Count all entities by name
    if (name && name !== "unknown") {
      nearbyEntities[name] = (nearbyEntities[name] || 0) + 1;
    }
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
  // Phantom insomnia tracking: warn when bot hasn't slept for too long.
  // Phantoms spawn after 72000 ticks (3 in-game days) without sleeping.
  // Bot1 [2026-03-22]: killed by Phantom during daytime farming — had not slept for multiple nights.
  // Bot1 Session 43: killed by Phantom at night. Phantom attacks from above, hard to flee.
  // This provides actionable warning BEFORE phantoms spawn, so the agent can proactively sleep.
  {
    const worldAge = bot.time?.age ?? 0;
    const lastSleep = lastSleepTick.get(username) ?? 0;
    const ticksSinceLastSleep = worldAge - lastSleep;
    // 72000 ticks = 3 in-game days. Warn at 48000 (2 days) so there's time to act.
    if (ticksSinceLastSleep > 48000 && worldAge > 0) {
      const nightsAwake = Math.floor(ticksSinceLastSleep / 24000);
      if (ticksSinceLastSleep >= 72000) {
        warnings.push(`PHANTOM IMMINENT: ${nightsAwake} night(s) without sleeping (${ticksSinceLastSleep} ticks). Phantoms ARE spawning! Sleep in a bed NOW or they will attack from above. If no bed, craft one IMMEDIATELY (3 wool + 3 planks).`);
      } else {
        warnings.push(`PHANTOM WARNING: ${nightsAwake} night(s) without sleeping (${ticksSinceLastSleep} ticks). Phantoms spawn at 72000 ticks. Sleep soon to reset the insomnia timer.`);
      }
    }
  }
  if (food <= 0 && health < 10) {
    warnings.push(`STARVATION: Hunger=${food}, HP=${Math.round(health*10)/10}. Find food IMMEDIATELY — mc_combat(cow/pig/chicken) or mc_eat. Do NOT navigate long distances (moveTo > 30 blocks is blocked when starving with no food).`);
  }
  // Early starvation warning: hunger<=3 with no food is a pre-death state.
  // Bot1 Session 70b: hunger=0, HP=5.5, no food — navigated 200+ blocks to find sheep, killed.
  // The existing warning (food<=0 && hp<10) fires too late — at that point the bot is already
  // close to death. Warn earlier at hunger<=3 with no food in inventory so the agent acts
  // BEFORE HP drops from starvation damage. Also remind that moveTo > 30 blocks is blocked.
  if (food <= 3 && foodItems.length === 0 && health >= 10) {
    warnings.push(`NEAR-STARVATION: Hunger=${food}, no food in inventory. HP will start draining soon. Prioritize food BEFORE doing other tasks. bot.combat("cow"/"pig"/"chicken") — check nearbyEntities first. bot.navigate("cow") searches 64 blocks. DO NOT moveTo far coordinates while starving (>30 blocks is blocked with no food).`);
  }
  if (foodItems.length === 0 && food < 10) {
    warnings.push("NO FOOD in inventory. Hunger will deplete. Hunt animals (mc_combat cow/pig) or harvest crops before it's critical.");
  }
  // Underground warning: many deaths from being trapped underground where mobs are dense.
  // Bot1 Sessions 31-44: 15+ deaths from pathfinder routing underground into cave systems.
  // Bot2/Bot3: repeated deaths from being underground with no escape path.
  // Warn when Y < 60 so the agent knows to return to surface before doing anything else.
  if (pos.y < 60) {
    warnings.push(`UNDERGROUND: You are at Y=${Math.round(pos.y)} (below surface). Cave mobs are dense and escape is difficult. Return to surface (mc_navigate to Y=80+ or mc_tunnel direction=up) before other actions.`);
  }

  // Include both "health" and "hp" keys so agents can access via either name.
  // Bot2 [2026-03-23]: agent read status.hp but field was "health" → got undefined,
  // causing HP management to fail (craft abort, eat skip, death).
  const roundedHealth = Math.round(health * 10) / 10;
  const result = {
    health: roundedHealth,
    hp: roundedHealth,
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
      // items: flat array of all inventory items for agents that do status.inventory.items.forEach()
      // Bug: agents calling status.inventory.forEach() got TypeError because inventory is an object.
      // Providing a flat array alongside the categorized view supports both access patterns.
      items: inventory.map(i => ({ name: i.name, count: i.count })),
    },
    nearbyEntities,
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

  // Auto-expand maxDistance for underground-only blocks (ores).
  // Bot1 [2026-03-22]: bot.gather("iron_ore", 10) returned 0 in 47ms because
  // iron_ore only spawns at Y≤72, and bot at Y=95 can't find ore within 32 blocks
  // (vertical distance alone is 23+ blocks). The 3D distance easily exceeds 32.
  // Expand search radius for all ore types so gather can find blocks below the bot.
  // This doesn't guarantee reachability (moveToBasic may still abort for cave routing),
  // but at least gives the bot a chance to find ores near surface caves/ravines.
  const UNDERGROUND_BLOCKS = new Set([
    "iron_ore", "deepslate_iron_ore", "gold_ore", "deepslate_gold_ore",
    "copper_ore", "deepslate_copper_ore", "coal_ore", "deepslate_coal_ore",
    "diamond_ore", "deepslate_diamond_ore", "emerald_ore", "deepslate_emerald_ore",
    "lapis_ore", "deepslate_lapis_ore", "redstone_ore", "deepslate_redstone_ore",
    "nether_gold_ore", "nether_quartz_ore", "ancient_debris",
  ]);
  if (UNDERGROUND_BLOCKS.has(block) && maxDistance <= 32) {
    maxDistance = 64;
    console.error(`[Gather] Expanded maxDistance to 64 for underground block "${block}"`);
  }

  // Early exit for smelted/crafted items that cannot be gathered from the world.
  // Bot1 [2026-03-22]: bot.gather("iron_ore", 10) returned 0 in 47ms; bot.gather("iron_ingot")
  // tried to find "iron_ingot" blocks (which don't exist in the world) and exited instantly.
  // Agents commonly confuse gathering raw ores vs smelted products.
  // Provide a clear error message directing them to the correct API.
  const SMELTED_ITEMS: Record<string, string> = {
    iron_ingot: "raw_iron (from iron_ore)",
    gold_ingot: "raw_gold (from gold_ore)",
    copper_ingot: "raw_copper (from copper_ore)",
    glass: "sand",
    smooth_stone: "cobblestone",
    charcoal: "oak_log",
    cooked_beef: "beef (from cow)",
    cooked_porkchop: "porkchop (from pig)",
    cooked_chicken: "chicken (from chicken)",
    cooked_mutton: "mutton (from sheep)",
    cooked_cod: "cod (from cod)",
    cooked_salmon: "salmon (from salmon)",
    brick: "clay_ball",
    nether_brick: "netherrack",
  };
  if (SMELTED_ITEMS[block]) {
    return `Cannot gather "${block}" — it's a smelted/cooked item, not a mineable block. Use bot.craft("${block}", ${count}, true) to smelt from ${SMELTED_ITEMS[block]}, or gather the raw material first with bot.gather().`;
  }

  // Safety: Auto-equip armor before gathering at night.
  // mc_gather is a long-running operation (up to 120s). Bot is stationary while mining,
  // exposed to mob attacks. Bot1: mc_gather(short_grass) timed out 120s, mobs killed bot.
  // Bot2: skeleton shot bot from HP 20→8 during gather because no armor equipped.
  // mc_navigate and mc_combat auto-equip armor, but mc_gather did not — fixed here.
  let gatherWarning = "";
  const gatherBot = botManager.getBot(username);
  if (gatherBot) {
    const gatherTime = gatherBot.time?.timeOfDay ?? 0;
    const gatherIsNight = gatherTime > 12541 || gatherTime < 100;

    // Pre-gather auto-sleep: if nighttime with bed nearby, sleep first.
    // mc_gather takes up to 120s and bot is stationary — nighttime gathering is extremely
    // dangerous. Sleeping skips the night, making the gather operation much safer.
    // Bot1/Bot2 [2026-03-22]: multiple deaths during nighttime gather from mob attacks.
    if (gatherIsNight) {
      try {
        const sleepResult = await botManager.sleep(username);
        console.error(`[Gather] Pre-gather auto-sleep succeeded: ${sleepResult}`);
      } catch (sleepErr) {
        console.error(`[Gather] Pre-gather auto-sleep skipped: ${sleepErr instanceof Error ? sleepErr.message : String(sleepErr)}`);
      }
    }

    // Phantom insomnia auto-sleep: Phantoms spawn after 72000 ticks without sleeping and
    // attack even during DAYTIME. mc_gather takes up to 120s stationary — Phantom attacks
    // during gather are nearly impossible to dodge (they dive from above).
    // Bot1 [2026-03-22]: killed by Phantom during daytime farming after 3+ nights without sleep.
    // The night auto-sleep above only fires at night; this fires at ANY time when insomnia is critical.
    if (!gatherIsNight) {
      const worldAge = gatherBot.time?.age ?? 0;
      const lastSleep = lastSleepTick.get(username) ?? 0;
      const ticksSinceLastSleep = worldAge - lastSleep;
      if (ticksSinceLastSleep > 60000 && worldAge > 0) {
        console.error(`[Gather] Phantom insomnia high (${ticksSinceLastSleep} ticks). Attempting pre-gather sleep to reset timer.`);
        try {
          const sleepResult = await botManager.sleep(username);
          console.error(`[Gather] Phantom insomnia auto-sleep succeeded: ${sleepResult}`);
        } catch (sleepErr) {
          console.error(`[Gather] Phantom insomnia auto-sleep skipped: ${sleepErr instanceof Error ? sleepErr.message : String(sleepErr)}`);
        }
      }
    }

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

    // Pre-gather HP check: WARNING (not block) if HP < 8.
    // Bot3 Bug #22 [2026-03-23]: gather ABORTED at HP<8, combat REFUSED at cliff, flee
    // returned 0m, navigate blocked by hostiles — complete deadlock, all actions blocked.
    // Converting to WARNING: operation continues but agent is strongly warned.
    // The mid-gather HP monitor (line ~495) will still abort if HP drops further during operation.
    const gatherHpStart = Math.round((gatherBot.health ?? 20) * 10) / 10;
    if (gatherHpStart < 8) {
      console.error(`[Gather] WARNING: HP low (${gatherHpStart}/20) for 120s stationary operation. Proceeding despite risk.`);
      gatherWarning += `\n[WARNING] HP low (${gatherHpStart}/20). Gathering is a long stationary operation (up to 120s) — starting at low HP is risky.\n[推奨アクション]\n1. bot.eat() — 食料があればHP回復\n2. bot.combat("cow") — 食料動物を狩って食料確保\n3. bot.flee(20) — 敵から逃走してから再試行`;
    }

    // Pre-gather hostile check: WARNING (not block) if hostiles within 20 blocks.
    // Bot3 Bug #22 [2026-03-23]: gather blocked by "skeleton at 8.8 blocks", combat
    // also blocked (cliff), flee returned 0m — nothing could be done. Deadlock.
    // Converting to WARNING: operation continues but agent is warned to clear threats.
    // The mid-gather hostile monitor will still abort if mobs close in during operation.
    const gatherDanger = checkDangerNearby(gatherBot, 20);
    if (gatherDanger.dangerous) {
      const gThreat = gatherDanger.nearestHostile
        ? `${gatherDanger.nearestHostile.name} at ${gatherDanger.nearestHostile.distance.toFixed(1)} blocks`
        : `${gatherDanger.hostileCount} hostile(s)`;
      console.error(`[Gather] WARNING: ${gThreat} nearby. Proceeding despite risk.`);
      gatherWarning += `\n[WARNING] ${gThreat} within 20 blocks. Gathering is stationary — nearby hostiles are dangerous.\n[推奨アクション]\n1. bot.flee(20) — 敵から逃走してから採掘\n2. bot.combat() — 敵を先に倒す\n3. bot.equipArmor() — 防具を装備`;
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
        // Check for immature wheat to give the agent a more actionable message.
        // Bot1 [2026-03-23]: agent kept retrying gather("wheat") not knowing crops were immature.
        const anyWheat = bot.findBlocks({
          matching: (b: any) => b.name === "wheat",
          maxDistance: maxDistance,
          count: 5,
        });
        if (anyWheat.length > 0) {
          const { Vec3: V3 } = await import("vec3");
          const sampleBlock = bot.blockAt(anyWheat[0]);
          const sampleProps = sampleBlock && (sampleBlock as any).getProperties ? (sampleBlock as any).getProperties() : null;
          const sampleAge = sampleProps?.age ?? (sampleBlock as any)?.metadata ?? 0;
          return `No mature wheat found within ${maxDistance} blocks. Found ${anyWheat.length} immature wheat crop(s) (age ${sampleAge}/7). They need more time to grow to age 7. Options: (1) Use bot.farm() with bone_meal to speed up growth, (2) Wait ~5 minutes for natural growth, (3) Hunt animals for food instead.`;
        }
        return `No wheat found within ${maxDistance} blocks. Use bot.farm() to plant wheat_seeds, or hunt animals (bot.combat("cow")) for food.`;
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
          logs.push(`[WARNING] HP low during wheat harvest (${wheatHp.toFixed(1)}/20). Continuing but consider eating/fleeing.`);
          console.error(`[Gather] WARNING: HP=${wheatHp.toFixed(1)} during wheat harvest. Continuing.`);
        }
        const wheatDanger = checkDangerNearby(bot, 16);
        if (wheatDanger.dangerous && wheatDanger.nearestHostile && wheatDanger.nearestHostile.distance <= 12) {
          logs.push(`[WARNING] Hostile ${wheatDanger.nearestHostile.name} detected ${wheatDanger.nearestHostile.distance.toFixed(1)} blocks away during wheat harvest. Consider fleeing.`);
          console.error(`[Gather] WARNING: ${wheatDanger.nearestHostile.name} at ${wheatDanger.nearestHostile.distance.toFixed(1)} blocks during wheat harvest. Continuing.`);
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
      return `Gathered ${gathered} wheat. ${logs.join("; ")}. Wheat in inventory: ${wheatInInv?.count ?? 0}` + gatherWarning;
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
        if (monHp < 4) {
          clearInterval(hpCheckInterval);
          try { monBot.pathfinder?.stop(); } catch (_) {}
          resolve(`[ABORTED] mc_gather stopped: HP critically low (${monHp.toFixed(1)}) during gathering. Use mc_flee or mc_eat before retrying.`);
          return;
        }
        // Hostile check during gathering — ALWAYS, both night AND daytime.
        // mc_gather can take up to 120s. The bot is stationary/moving slowly, vulnerable.
        // Night: check 20-block radius (mobs are everywhere).
        // Daytime: check 16-block radius — pillagers, cave zombies, skeletons attack 24/7.
        // Bot2 [2026-03-22]: skeleton shot bot from HP 20→1 during DAYTIME gather.
        // Previous code gated daytime checks on monHp<12, meaning the first 8+ damage
        // from skeleton arrows went completely unchecked. Skeletons deal 4-5 damage per
        // hit with no armor, so HP can drop from 20 to 1 in 4-5 hits (~4 seconds).
        // Now: ALWAYS check hostiles regardless of HP. The pre-start check catches mobs
        // present at start, but mobs spawn or approach DURING the 120s operation.
        const monTime = monBot.time?.timeOfDay ?? 0;
        const monIsNight = monTime > 12541 || monTime < 100;
        const gatherScanRadius = monIsNight ? 20 : 16;
        {
          const monDanger = checkDangerNearby(monBot, gatherScanRadius);
          // Night: abort if hostile within 16 blocks.
          // Day: abort if hostile within 12 blocks (closer threshold since fewer mobs).
          // Ranged mobs (skeleton, pillager): always abort within 16 blocks regardless of time.
          if (monDanger.dangerous && monDanger.nearestHostile) {
            const nearName = monDanger.nearestHostile.name;
            const nearDist = monDanger.nearestHostile.distance;
            const timeNote = monIsNight ? "night — " : "";
            // Only log warning, don't abort — let the game's natural combat play out
            if (nearDist <= 8) {
              console.error(`[Gather] WARNING: ${timeNote}${nearName} at ${nearDist.toFixed(1)} blocks during gather (HP=${monHp.toFixed(1)})`);
            }
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
    const gatherResult = await Promise.race([gatherPromise, timeoutPromise, hpMonitorPromise]);
    return gatherResult + gatherWarning;
  } catch (e) {
    // Stop pathfinder on timeout
    try { botManager.getBot(username)?.pathfinder?.stop(); } catch (_) {}
    return (e instanceof Error ? e.message : String(e)) + gatherWarning;
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

  // ── Pre-flight checks (fast-fail before entering the 180s timeout) ──────────
  // Problem: calling bot.craft() with a 3×3 recipe when no crafting_table is
  // present causes Mineflayer to hang indefinitely waiting for a window event
  // that never fires, resulting in a 120-180 s timeout every time.
  // Fix: detect the missing-table condition synchronously and return an
  // actionable error in < 1 ms, before any async work begins.
  {
    const bot = botManager.getBot(username);
    if (bot) {
      // Items that are always 2×2 (player inventory) — never need a crafting table.
      const SIMPLE_2X2 = new Set([
        "stick", "crafting_table",
        "oak_planks", "spruce_planks", "birch_planks", "jungle_planks",
        "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks",
        "pale_oak_planks", "torch",
      ]);
      const isSimple = SIMPLE_2X2.has(item) || item.endsWith("_planks");

      if (!isSimple) {
        // Check inventory first (bot has a crafting_table item it can place)
        const inv = botManager.getInventory(username);
        const hasTableInInv = inv.some(i => i.name === "crafting_table");

        if (!hasTableInInv) {
          // Check for a placed crafting_table within 5 blocks
          const mcData = (await import("minecraft-data")).default(bot.version);
          const tableId = mcData.blocksByName.crafting_table?.id;
          const nearbyTable = tableId
            ? bot.findBlock({ matching: tableId, maxDistance: 5 })
            : null;

          if (!nearbyTable) {
            // Check ingredients as well so error is maximally useful
            const invStr = inv.map(i => `${i.name}(${i.count})`).join(", ") || "empty";
            return `Cannot craft ${item}: crafting_table not found nearby (within 5 blocks). Place one first, then retry. Inventory: ${invStr}`;
          }
        }
        // Note: if bot has crafting_table in inventory, craft_chain will auto-place it — skip check.
      }
    }
  }
  // ── End pre-flight ──────────────────────────────────────────────────────────

  // Wrap entire craft operation in 180s timeout to prevent hangs (autoGather can trigger long gather loops)
  const CRAFT_TIMEOUT_MS = 180000;
  const craftPromise = async () => {
    if (count === 1) {
      // Track inventory before crafting to verify actual gain — same as count>1 path.
      // Bot1/Bot2 [2026-03-22]: bot.craft('chest', 1) and bot.craft('white_bed', 1) reported
      // success but inventory had no item — craft_chain caught internal errors and returned
      // a "complete" message without verifying items were actually added. The agent thought
      // the craft succeeded and wasted time on subsequent steps.
      // The count>1 path (commit 0b960b9) already had this check; count==1 did not.
      const invBefore = botManager.getInventory(username);
      const countBefore = invBefore.find(i => i.name === item)?.count ?? 0;
      const result = await getHighLevel().minecraft_craft_chain(username, item, autoGather);
      const invAfter = botManager.getInventory(username);
      const countAfter = invAfter.find(i => i.name === item)?.count ?? 0;
      const actualGain = countAfter - countBefore;
      if (actualGain <= 0) {
        // craft_chain said it completed but item count didn't increase — report failure
        const invStr = invAfter.map((i: { name: string; count: number }) => `${i.name}(${i.count})`).join(", ");
        return `Failed to craft ${item}: craft_chain returned "${result}" but inventory has ${countAfter}x ${item} (unchanged). Inventory: ${invStr}`;
      }
      return result;
    }

    // For count > 1 non-smelt items, craft multiple times
    const results: string[] = [];
    // Track inventory before crafting to verify actual gain
    const invBefore = botManager.getInventory(username);
    const countBefore = invBefore.find(i => i.name === item)?.count ?? 0;
    let successCount = 0;
    for (let i = 0; i < count; i++) {
      try {
        const result = await getHighLevel().minecraft_craft_chain(username, item, autoGather);
        // Check if result indicates failure (craft_chain returns "failed" on error instead of throwing)
        if (result.includes("failed") || result.includes("Failed")) {
          results.push(`Attempt ${i + 1}: ${result}`);
          break;
        }
        successCount++;
        results.push(result);
      } catch (err) {
        results.push(`Attempt ${i + 1} failed: ${err}`);
        break;
      }
    }

    const inventory = botManager.getInventory(username);
    const invStr = inventory.map(i => `${i.name}(${i.count})`).join(", ");
    // Verify actual inventory change to avoid misleading "Crafted" message
    // Bot1 [2026-03-22]: bot.craft('chest', 2) reported "Crafted chest x2" but inventory
    // had no chest — the internal craft_chain caught errors and returned "complete" without
    // verifying items were actually added. Agent thought craft succeeded, wasted time.
    const countAfter = inventory.find(i => i.name === item)?.count ?? 0;
    const actualGain = countAfter - countBefore;
    if (actualGain <= 0 && successCount === 0) {
      return `Failed to craft ${item} x${count}. ${results.join("; ")}. Inventory: ${invStr}`;
    }
    if (actualGain < count) {
      return `Partially crafted ${item}: ${actualGain}/${count} in inventory (${successCount} attempts succeeded). ${results.join("; ")}. Inventory: ${invStr}`;
    }
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

  // Helper: moveTo with remaining farm timeout enforced.
  // All plain `await botManager.moveTo(...)` calls inside mc_farm must use this wrapper.
  // Without it, a stuck pathfinder can block moveTo indefinitely, causing mc_farm to
  // exceed the MCP server's 180s hard timeout (Session 80 bug: "Execution timed out
  // after 180000ms"). This wrapper returns "TIMEOUT" string if time runs out, matching
  // the pattern used in the water-navigation blocks above.
  const farmMoveTo = async (x: number, y: number, z: number): Promise<string> => {
    const remaining = FARM_TIMEOUT_MS - (Date.now() - farmStartTime);
    if (remaining <= 0) return "TIMEOUT";
    return Promise.race([
      botManager.moveTo(username, x, y, z),
      new Promise<string>(resolve => setTimeout(() => resolve("TIMEOUT"), remaining)),
    ]);
  };

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

  // Pre-farm HP check: WARNING (not block) if HP < 8.
  // Bot3 Bug #22 [2026-03-23]: farm/gather/combat all blocked simultaneously = deadlock.
  // Converting to WARNING: operation continues but agent is warned.
  let farmWarning = "";
  const farmHpStart = Math.round((bot.health ?? 20) * 10) / 10;
  if (farmHpStart < 8) {
    console.error(`[Farm] WARNING: HP low (${farmHpStart}/20) for 60-120s stationary operation. Proceeding despite risk.`);
    farmWarning += `\n[WARNING] HP low (${farmHpStart}/20). Farming is a long stationary operation (60-120s) — starting at low HP is risky.\n[推奨アクション]\n1. bot.eat() — 食料があればHP回復\n2. bot.combat("cow") — 食料動物を狩って食料確保\n3. bot.flee(20) — 敵から逃走してから再試行`;
  }

  // Pre-farm auto-sleep: if nighttime with bed nearby, sleep first to skip night.
  // mc_navigate and mc_gather both auto-sleep before operating; mc_farm did not,
  // causing REFUSED deadlocks where bot had a bed but couldn't farm because it was night.
  // Bot1/Bot2/Bot3 [2026-03-22]: multiple "REFUSED at night" while holding a bed.
  // Sleeping first makes it daytime, allowing farming to proceed safely.
  let farmTimeOfDay = bot.time?.timeOfDay ?? 0;
  let farmIsNight = farmTimeOfDay > 12541 || farmTimeOfDay < 100;
  if (farmIsNight) {
    try {
      const sleepResult = await botManager.sleep(username);
      console.error(`[Farm] Pre-farm auto-sleep succeeded: ${sleepResult}`);
      // Re-check time after sleep — should now be daytime
      farmTimeOfDay = bot.time?.timeOfDay ?? 0;
      farmIsNight = farmTimeOfDay > 12541 || farmTimeOfDay < 100;
    } catch (sleepErr) {
      console.error(`[Farm] Pre-farm auto-sleep skipped: ${sleepErr instanceof Error ? sleepErr.message : String(sleepErr)}`);
    }
  }

  // Phantom insomnia auto-sleep for daytime farming: same as mc_gather.
  // Phantoms attack even during daytime after 72000 ticks without sleep.
  // mc_farm is 60-120s stationary — Phantom dive attacks are lethal.
  // Bot1 [2026-03-22]: killed by Phantom during daytime farming.
  if (!farmIsNight) {
    const farmWorldAge = bot.time?.age ?? 0;
    const farmLastSleep = lastSleepTick.get(username) ?? 0;
    const farmTicksSinceLastSleep = farmWorldAge - farmLastSleep;
    if (farmTicksSinceLastSleep > 60000 && farmWorldAge > 0) {
      console.error(`[Farm] Phantom insomnia high (${farmTicksSinceLastSleep} ticks). Attempting pre-farm sleep.`);
      try {
        const sleepResult = await botManager.sleep(username);
        console.error(`[Farm] Phantom insomnia auto-sleep succeeded: ${sleepResult}`);
      } catch (sleepErr) {
        console.error(`[Farm] Phantom insomnia auto-sleep skipped: ${sleepErr instanceof Error ? sleepErr.message : String(sleepErr)}`);
      }
    }
  }

  if (farmIsNight) {
    console.error(`[Farm] WARNING: Farming at night (time=${farmTimeOfDay}). Proceeding anyway.`);
  }

  // Auto-equip armor before farming — mc_farm is a long operation (up to 120s) where
  // the bot is stationary and vulnerable. Bot2 [2026-03-22]: skeleton shot bot from HP 20→1
  // during dirt placement with no armor equipped. Equipping armor prevents 4-8 damage per hit.
  try {
    await botManager.equipArmor(username);
  } catch {
    // Continue without armor
  }

  // Pre-farm hostile check: WARNING (not block) if hostiles within 20 blocks.
  // Bot3 Bug #22 [2026-03-23]: farm blocked + combat blocked + gather blocked = deadlock.
  // Converting to WARNING: operation continues but agent is warned.
  const danger = checkDangerNearby(bot, 20);
  if (danger.dangerous) {
    const threatDesc = danger.nearestHostile
      ? `${danger.nearestHostile.name} at ${danger.nearestHostile.distance.toFixed(1)} blocks`
      : `${danger.hostileCount} hostile(s)`;
    console.error(`[Farm] WARNING: ${threatDesc} nearby. Proceeding despite risk.`);
    farmWarning += `\n[WARNING] ${threatDesc} within 20 blocks. Farming is stationary — nearby hostiles are dangerous.\n[推奨アクション]\n1. bot.flee(20) — 敵から逃走してから農場作業\n2. bot.combat() — 敵を先に倒す\n3. bot.equipArmor() — 防具を装備`;
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
  // No artificial cap — plant as many seeds as we have tillable blocks for.
  const seedCount = seeds.count;

  // Search a 9x9 area around the bot for dirt blocks on the surface
  outer:
  for (let dx = -4; dx <= 4 && farmCoords.length < seedCount; dx++) {
    for (let dz = -4; dz <= 4 && farmCoords.length < seedCount; dz++) {
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
    // SHORT-CIRCUIT: If water is nearby and farmCoords is empty, check if there are
    // growing crops in the 20-block radius. If so, the established farm just has no
    // empty spots — skip expensive water navigation and go straight to bone-meal/harvest.
    // Bug: bot had 51+ wheat_seeds but mc_farm navigated away from existing irrigated farm
    // because farmCoords=[] after filter, wasting 30-60s navigating while doing nothing.
    let skipWaterNav = false;
    if (waterBlock && farmCoords.length === 0) {
      const GROWING_CROPS_CHECK = new Set(["wheat", "carrots", "potatoes", "beetroots"]);
      const nearGrowingCrops = bot.findBlocks({
        matching: (b: any) => GROWING_CROPS_CHECK.has(b.name),
        maxDistance: 20,
        count: 5,
      });
      if (nearGrowingCrops.length > 0) {
        logs.push(`Established farm detected: ${nearGrowingCrops.length} growing crop(s) nearby. Water is present. Skipping water navigation — will bone-meal existing crops and harvest mature ones.`);
        skipWaterNav = true;
      }
    }
    if (!skipWaterNav && (!waterBlock || farmCoords.length === 0)) {
      // No water nearby or no valid farm spots near water
      if (!waterBlock) {
        logs.push("No water within 10 blocks — farmland may dry out. Searching for water source...");
      } else {
        logs.push("No farmable blocks within irrigation range of nearby water. Searching for better water source...");
      }
      // Search for water with surface preference: underground water (caves, ravines)
      // causes mc_farm to navigate underground where bot gets trapped by mobs.
      // Bot1 [2026-03-22]: mc_navigate to water routed underground, drowned.
      // Bot2: mc_farm navigated to underground water, skeleton killed bot.
      // Use bot.findBlocks to get multiple candidates and pick the closest surface one.
      const botFarmY = bot.entity.position.y;
      const waterCandidates = bot.findBlocks({
        matching: (b: any) => b.name === "water",
        maxDistance: 64,
        count: 20,
      });
      // Score candidates: prefer water at or above bot Y, penalize underground water.
      // HARD REJECT water more than 15 blocks below bot Y — navigating to deep water
      // causes underground routing regardless of score-based penalty.
      // Bot1/Bot2/Bot3 [2026-03-22]: mc_farm selected underground cave water because
      // score-based penalty still allowed deeply underground candidates when no surface
      // water existed. Bot navigated underground, got trapped by mobs, and died.
      let farWater: { position: { x: number; y: number; z: number } } | null = null;
      if (waterCandidates.length > 0) {
        let bestScore = Infinity;
        for (const wp of waterCandidates) {
          // Absolute rejection: never navigate to water >15 blocks below bot
          if (botFarmY - wp.y > 15) continue;
          const dist = bot.entity.position.distanceTo(wp);
          const depthBelow = Math.max(botFarmY - wp.y - 3, 0); // 3-block tolerance
          const score = dist + depthBelow * 5; // Same 5x penalty as findBlock
          if (score < bestScore) {
            bestScore = score;
            farWater = { position: { x: wp.x, y: wp.y, z: wp.z } };
          }
        }
      }
      if (farWater) {
        // SAFETY: Check for drowned mobs near the water target before navigating.
        // Bot1 [2026-03-24]: drowned at (2,72,5) killed bot during mc_farm water navigation (Sessions 52-53).
        // Drowned spawn in/near water and attack immediately when the bot approaches the water source.
        {
          const farWaterPos = farWater.position;
          const drownedNearWater = Object.values(bot.entities).filter((e: any) => {
            if (e.type !== 'mob' || e.name !== 'drowned') return false;
            const dx = e.position.x - farWaterPos.x;
            const dy = e.position.y - farWaterPos.y;
            const dz = e.position.z - farWaterPos.z;
            const distToWater = Math.sqrt(dx * dx + dy * dy + dz * dz);
            return distToWater < 30;
          });
          if (drownedNearWater.length > 0) {
            logs.push(`[WARNING] Drowned mob(s) detected near water at (${farWaterPos.x}, ${farWaterPos.y}, ${farWaterPos.z}) — skipping this water source to avoid death. ${drownedNearWater.length} drowned within 30 blocks.`);
            farWater = null;
          }
        }
      }
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
          // TIMEOUT: Wrap water navigation in Promise.race to enforce global farm timeout.
          // Bug Session 50: moveTo() hung indefinitely when pathfinder was stuck, causing
          // mc_farm to hang for the full 180s MCP timeout while mobs attacked the bot.
          // The FARM_TIMEOUT_MS constant existed but was only checked inside loops that
          // are never reached if this blocking await never resolves.
          {
            const remainingMs = FARM_TIMEOUT_MS - (Date.now() - farmStartTime);
            if (remainingMs <= 0) {
              logs.push(`[ABORTED] mc_farm timed out before water navigation.`);
              const finalBot = botManager.getBot(username);
              return logs.join("\n") + `\nmc_farm: global timeout hit before water navigation. HP: ${finalBot?.health ?? '?'}, Hunger: ${finalBot?.food ?? '?'}.`;
            }
          }
          const waterNavRemainingMs = FARM_TIMEOUT_MS - (Date.now() - farmStartTime);
          const moveToWaterResult = await Promise.race([
            botManager.moveTo(username, landTarget.x, landTarget.y, landTarget.z),
            new Promise<string>(resolve => setTimeout(() => resolve("TIMEOUT"), waterNavRemainingMs))
          ]);
          if (moveToWaterResult === "TIMEOUT") {
            logs.push(`[ABORTED] mc_farm water navigation timed out (${FARM_TIMEOUT_MS / 1000}s global limit). Pathfinder may be stuck.`);
            const finalBot = botManager.getBot(username);
            return logs.join("\n") + `\nmc_farm: timed out during water navigation (pathfinder stuck). HP: ${finalBot?.health ?? '?'}, Hunger: ${finalBot?.food ?? '?'}. Try moving to a different area first.`;
          }
          // SAFETY: Abort if moveTo routed underground (cave routing).
          // Bot1/Bot2 [2026-03-22]: mc_farm navigated to water, pathfinder routed underground,
          // bot got trapped in cave with mobs. The moveTo result contains "underground" or
          // "cave" when cave routing is detected. Also check Y descent: if bot ended up
          // significantly below its starting Y, it's likely underground.
          const postMoveY = bot.entity.position.y;
          if (moveToWaterResult.includes("underground") || moveToWaterResult.includes("cave") || moveToWaterResult.includes("descended")) {
            logs.push(`[ABORTED] Navigation to water caused underground routing: ${moveToWaterResult}`);
            const finalBot = botManager.getBot(username);
            return logs.join("\n") + `\nmc_farm aborted: pathfinder routed underground while navigating to water. HP: ${finalBot?.health ?? '?'}, Hunger: ${finalBot?.food ?? '?'}. Use mc_navigate to return to surface first.`;
          }
          if (botFarmY - postMoveY > 8) {
            logs.push(`[ABORTED] Bot descended ${(botFarmY - postMoveY).toFixed(0)} blocks (Y=${botFarmY.toFixed(0)}→${postMoveY.toFixed(0)}) during navigation to water — likely underground.`);
            const finalBot = botManager.getBot(username);
            return logs.join("\n") + `\nmc_farm aborted: bot fell underground during water navigation (Y=${botFarmY.toFixed(0)}→${postMoveY.toFixed(0)}). HP: ${finalBot?.health ?? '?'}. Use minecraft_pillar_up or mc_navigate to return to surface.`;
          }
          // HOSTILE-NEAR-WATER ABORT: After navigation, check for any hostile mobs within 20 blocks.
          // Bot1 [2026-03-24]: drowned attacked immediately after arriving at water (Sessions 52-53).
          // Even if no drowned was visible before nav started, one may have spawned during travel.
          {
            const postNavBot = botManager.getBot(username);
            const hostileNearWater = postNavBot ? Object.values(postNavBot.entities).filter((e: any) => {
              if (e.type !== 'mob') return false;
              const hostileNames = ['drowned', 'zombie', 'skeleton', 'creeper', 'spider', 'witch', 'pillager', 'phantom', 'slime', 'magma_cube', 'blaze', 'ghast', 'enderman', 'husk', 'stray', 'drowned'];
              if (!hostileNames.includes(e.name)) return false;
              const distToBot = e.position.distanceTo(postNavBot.entity.position);
              return distToBot < 20;
            }) : [];
            if (hostileNearWater.length > 0) {
              const hostileNames = hostileNearWater.map((e: any) => `${e.name}@${e.position.distanceTo(postNavBot!.entity.position).toFixed(0)}m`).join(', ');
              logs.push(`[ABORTED] Hostile mob(s) detected within 20 blocks after reaching water: ${hostileNames}. Aborting to avoid death.`);
              const finalBot = botManager.getBot(username);
              return logs.join("\n") + `\nmc_farm aborted: hostile mobs near water source (${hostileNames}). Flee and wait for daytime or clear threats before farming near water. HP: ${finalBot?.health ?? '?'}, Hunger: ${finalBot?.food ?? '?'}.`;
            }
          }
          // POST-WATER-NAVIGATION SAFETY: Re-check HP and hostiles after reaching water.
          // Navigation to water can take 10-30s during which the bot may take damage from
          // mobs or starvation. The initial pre-farm safety checks passed, but conditions
          // may have changed during travel. Without this re-check, bot starts the long
          // tilling loop (60-120s stationary) at dangerously low HP.
          // Bot1/Bot2 [2026-03-22]: navigated to water, took skeleton/mob damage during travel,
          // then started farming at HP<8 and died during tilling.
          // Bot2: skeleton appeared during navigation to water, no re-check before tilling.
          // Bot2 [2026-03-23]: HP=9.5 ABORT here blocked farming entirely. When hunger=0,
          // farming is the ONLY way to get food → deadlock. Convert to WARNING, continue.
          {
            const postNavHp = bot.health ?? 20;
            if (postNavHp < 6) {
              logs.push(`[ABORTED] HP dropped to ${postNavHp.toFixed(1)} during water navigation. Critically low — aborting.`);
              const finalBot = botManager.getBot(username);
              return logs.join("\n") + `\nmc_farm aborted: HP critically low after reaching water (${postNavHp.toFixed(1)}/20). Heal first: bot.eat() or bot.combat("cow"). HP: ${finalBot?.health ?? '?'}, Hunger: ${finalBot?.food ?? '?'}.`;
            }
            if (postNavHp < 10) {
              logs.push(`[WARNING] HP dropped to ${postNavHp.toFixed(1)} during water navigation. Proceeding with caution — farming is needed for food production.`);
              console.error(`[Farm] WARNING: HP=${postNavHp.toFixed(1)} after water navigation. Continuing anyway to avoid food deadlock.`);
            }
            const postNavDanger = checkDangerNearby(bot, 20);
            if (postNavDanger.dangerous) {
              const ptd = postNavDanger.nearestHostile
                ? `${postNavDanger.nearestHostile.name} at ${postNavDanger.nearestHostile.distance.toFixed(1)} blocks`
                : `${postNavDanger.hostileCount} hostile(s)`;
              logs.push(`[WARNING] Hostile detected after reaching water: ${ptd}. Proceeding with caution.`);
              console.error(`[Farm] WARNING: ${ptd} nearby after water navigation. Continuing to avoid deadlock.`);
            }
          }
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
                    logs.push(`[WARNING] Hostile detected during dirt placement: ${pd}. Continuing but consider fleeing.`);
                    console.error(`[Farm] WARNING: ${pd} during dirt placement. Continuing.`);
                  }
                  // HP check during dirt placement: bot2 was shot by skeleton from HP 20→1
                  // during 19 consecutive placement attempts. The hostile check above catches
                  // visible mobs, but misses damage from mobs behind terrain or starvation.
                  // This matches the HP<10 abort in the tilling loop (Step 3) and bone meal loop (Step 4).
                  const placeHp = bot.health ?? 20;
                  if (placeHp < 10) {
                    logs.push(`[WARNING] HP low during dirt placement (${placeHp.toFixed(1)}/20). Continuing but consider eating/fleeing.`);
                    console.error(`[Farm] WARNING: HP=${placeHp.toFixed(1)} during dirt placement. Continuing.`);
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
                            // Wrap in Promise.race to enforce global farm timeout (Session 50 fix).
                            const dirtNavRemaining = FARM_TIMEOUT_MS - (Date.now() - farmStartTime);
                            if (dirtNavRemaining > 0) {
                              await Promise.race([
                                botManager.moveTo(username, px + 1, py + 1, pz),
                                new Promise<string>(resolve => setTimeout(() => resolve("TIMEOUT"), dirtNavRemaining))
                              ]);
                            }
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

          // Option 3: Search wider (200 blocks) for water with surface preference
          logs.push("Searching up to 200 blocks for water...");
          // Use findBlocks for multiple candidates + surface preference scoring.
          // Same logic as the 64-block search above: penalize underground water.
          const veryFarCandidates = bot.findBlocks({
            matching: (b: any) => b.name === "water",
            maxDistance: 200,
            count: 30,
          });
          let veryFarWater: { position: { x: number; y: number; z: number } } | null = null;
          if (veryFarCandidates.length > 0) {
            let bestVScore = Infinity;
            for (const vwp of veryFarCandidates) {
              // Absolute rejection: never navigate to water >15 blocks below bot (same as 64-block search)
              if (botFarmY - vwp.y > 15) continue;
              const vDist = bot.entity.position.distanceTo(vwp);
              const vDepthBelow = Math.max(botFarmY - vwp.y - 3, 0);
              const vScore = vDist + vDepthBelow * 5;
              if (vScore < bestVScore) {
                bestVScore = vScore;
                veryFarWater = { position: { x: vwp.x, y: vwp.y, z: vwp.z } };
              }
            }
          }
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
              // Wrap vLandTarget moveTo in Promise.race to enforce global farm timeout.
              // Without this, moveTo can hang indefinitely (e.g., pathfinder stuck at Y=60)
              // causing mc_farm to exceed the 120s MCP response timeout.
              // Bot1 Session 69: farm() timeout (120s+) because vMoveResult had no timeout wrap.
              const vMoveRemainingMs = FARM_TIMEOUT_MS - (Date.now() - farmStartTime);
              const vMoveResult = await Promise.race([
                botManager.moveTo(username, vLandTarget.x, vLandTarget.y, vLandTarget.z),
                new Promise<string>(resolve => setTimeout(() => resolve("TIMEOUT"), vMoveRemainingMs))
              ]);
              if (vMoveResult === "TIMEOUT") {
                logs.push(`[ABORTED] mc_farm far-water navigation timed out (${FARM_TIMEOUT_MS / 1000}s global limit).`);
                const finalBot = botManager.getBot(username);
                return logs.join("\n") + `\nmc_farm: timed out during far-water navigation (pathfinder stuck). HP: ${finalBot?.health ?? '?'}, Hunger: ${finalBot?.food ?? '?'}. Try moving to a different area first.`;
              }
              // SAFETY: Abort if moveTo routed underground (same check as 64-block search)
              const vPostMoveY = bot.entity.position.y;
              if (vMoveResult.includes("underground") || vMoveResult.includes("cave") || vMoveResult.includes("descended")) {
                logs.push(`[ABORTED] Navigation to far water caused underground routing: ${vMoveResult}`);
                const finalBot = botManager.getBot(username);
                return logs.join("\n") + `\nmc_farm aborted: pathfinder routed underground. HP: ${finalBot?.health ?? '?'}. Return to surface first.`;
              }
              if (botFarmY - vPostMoveY > 8) {
                logs.push(`[ABORTED] Bot descended ${(botFarmY - vPostMoveY).toFixed(0)} blocks during far water navigation.`);
                const finalBot = botManager.getBot(username);
                return logs.join("\n") + `\nmc_farm aborted: bot fell underground (Y=${botFarmY.toFixed(0)}→${vPostMoveY.toFixed(0)}). HP: ${finalBot?.health ?? '?'}. Return to surface first.`;
              }
              // POST-FAR-WATER-NAVIGATION SAFETY: same HP/hostile re-check as the near-water path.
              // Bot2 [2026-03-23]: HP=9.5 ABORT blocked farming → food deadlock. Convert to WARNING.
              {
                const postFarNavHp = bot.health ?? 20;
                if (postFarNavHp < 6) {
                  logs.push(`[ABORTED] HP dropped to ${postFarNavHp.toFixed(1)} during far water navigation. Critically low — aborting.`);
                  const finalBot = botManager.getBot(username);
                  return logs.join("\n") + `\nmc_farm aborted: HP critically low after reaching far water (${postFarNavHp.toFixed(1)}/20). Heal first. HP: ${finalBot?.health ?? '?'}, Hunger: ${finalBot?.food ?? '?'}.`;
                }
                if (postFarNavHp < 10) {
                  logs.push(`[WARNING] HP dropped to ${postFarNavHp.toFixed(1)} during far water navigation. Proceeding with caution — farming is needed for food production.`);
                  console.error(`[Farm] WARNING: HP=${postFarNavHp.toFixed(1)} after far water navigation. Continuing anyway to avoid food deadlock.`);
                }
                const postFarNavDanger = checkDangerNearby(bot, 20);
                if (postFarNavDanger.dangerous) {
                  const fptd = postFarNavDanger.nearestHostile
                    ? `${postFarNavDanger.nearestHostile.name} at ${postFarNavDanger.nearestHostile.distance.toFixed(1)} blocks`
                    : `${postFarNavDanger.hostileCount} hostile(s)`;
                  logs.push(`[WARNING] Hostile detected after reaching far water: ${fptd}. Proceeding with caution.`);
                  console.error(`[Farm] WARNING: ${fptd} nearby after far water navigation. Continuing to avoid deadlock.`);
                }
              }
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
      logs.push(`Water source nearby at (${waterBlock?.position.x}, ${waterBlock?.position.y}, ${waterBlock?.position.z}) — farmland will stay moist.`);
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

    // Mid-farm hostile check: abort if enemies approach during farming.
    // Use 20-block radius to match skeleton shooting range (~20 blocks).
    // Bot2 [2026-03-23]: killed by zombie during farm() — abort only broke the loop
    // but did NOT flee, leaving bot stationary and exposed. Now auto-flees on abort.
    const midDanger = checkDangerNearby(bot, 20);
    if (midDanger.dangerous) {
      const midThreat = midDanger.nearestHostile;
      const midThreatDesc = midThreat
        ? `${midThreat.name} at ${midThreat.distance.toFixed(1)} blocks`
        : `${midDanger.hostileCount} hostile(s)`;
      if (midThreat && midThreat.distance <= 2) {
        // Hostile within melee range — immediately abort and flee
        bot.setControlState("sneak", false);
        try { await mc_flee(15); } catch (_) {}
        const finalBot2 = botManager.getBot(username);
        return logs.join("\n") + `\nmc_farm ABORTED: ${midThreatDesc} within melee range during farming. Fled immediately. HP: ${finalBot2?.health ?? '?'}` + farmWarning;
      }
      logs.push(`[WARNING] Hostile detected during farming: ${midThreatDesc}. Auto-fleeing as precaution.`);
      console.error(`[Farm] WARNING: ${midThreatDesc} during tilling. Fleeing then continuing.`);
      bot.setControlState("sneak", false);
      try {
        const fleeResult = await mc_flee(15);
        logs.push(`[FLEE] ${fleeResult}`);
      } catch (fleeErr) {
        logs.push(`[FLEE FAILED] ${fleeErr}`);
      }
      // Continue farming after fleeing — don't break
    }

    // Mid-farm HP check: abort if HP critically low, warn if just low.
    const midFarmHp = bot.health ?? 20;
    if (midFarmHp < 5) {
      bot.setControlState("sneak", false);
      try { await mc_flee(15); } catch (_) {}
      const finalBot2 = botManager.getBot(username);
      return logs.join("\n") + `\nmc_farm ABORTED: HP critically low (${midFarmHp.toFixed(1)}/20) during farming. Fled. HP: ${finalBot2?.health ?? '?'}` + farmWarning;
    } else if (midFarmHp < 10) {
      logs.push(`[WARNING] HP low (${midFarmHp.toFixed(1)}/20). Fleeing.`);
      bot.setControlState("sneak", false);
      try { logs.push(`[FLEE] ${await mc_flee(15)}`); } catch (e) { logs.push(`[FLEE FAILED] ${e}`); }
    }

    // Mid-farm IN-WATER check: if bot entered water (e.g. pathfinder routed through water
    // toward a farm block adjacent to a river), immediately swim up and abort this iteration.
    // Bot1 Session 72b [2026-03-26]: farm() loop navigated into water body at night,
    // HP dropped to 4.7 from drowning with no escape triggered.
    {
      const fPos = bot.entity.position.floor();
      const fBlock = bot.blockAt(fPos);
      const hBlock = bot.blockAt(bot.entity.position.offset(0, 1, 0).floor());
      const midInWater = isWaterBlock(fBlock?.name) || isWaterBlock(hBlock?.name);
      if (midInWater) {
        bot.setControlState("sneak", false);
        bot.setControlState("jump", true);
        logs.push(`[WARNING] Bot in water during farming! Attempting swim-up emergency escape.`);
        let surfaced = false;
        for (let wi = 0; wi < 16; wi++) {
          await new Promise(r => setTimeout(r, 500));
          const wFeet = bot.blockAt(bot.entity.position.floor());
          const wHead = bot.blockAt(bot.entity.position.offset(0, 1, 0).floor());
          if (!isWaterBlock(wFeet?.name) && !isWaterBlock(wHead?.name)) { surfaced = true; break; }
        }
        bot.setControlState("jump", false);
        const finalBotW = botManager.getBot(username);
        if (!surfaced) {
          return logs.join("\n") + `\nmc_farm ABORTED: bot entered water and could not surface. HP: ${finalBotW?.health ?? '?'}, Hunger: ${finalBotW?.food ?? '?'}. Escape water manually (bot.navigate or bot.pillarUp).` + farmWarning;
        }
        logs.push(`Surfaced from water at (${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.y.toFixed(1)}, ${bot.entity.position.z.toFixed(1)}). Skipping farm block at (${fc.x},${fc.y},${fc.z}).`);
        continue; // skip this farm coord — don't navigate back into water
      }
    }

    // Enable sneaking BEFORE moving near the block — prevents farmland trampling
    // if the pathfinder routes over tilled soil during approach or planting.
    // Bot3 Bug #20, Bot2 Bug: farmland reverts to dirt because bot walks on it
    // between tilling and planting. Sneaking prevents this.
    bot.setControlState("sneak", true);
    await new Promise(r => setTimeout(r, 100));

    // Move close to the block before tilling (must be within 4 blocks).
    // Filter approach positions to avoid water blocks — bot falls off a riverbank
    // adjacent to a farm block and enters the water below.
    // Bot1 Session 72b [2026-03-26]: moveTo(fc.x+1, fc.y+1, fc.z) for blocks right next
    // to a river sent the bot into the river, causing drowning.
    try {
      const botPos = bot.entity.position;
      const dist = botPos.distanceTo(new (bot.entity.position.constructor as any)(fc.x + 0.5, fc.y + 1, fc.z + 0.5));
      if (dist > 3.5) {
        // Find a safe (non-water) approach position among the 4 cardinal directions
        const approachCandidates = [
          { x: fc.x + 1, y: fc.y + 1, z: fc.z },
          { x: fc.x - 1, y: fc.y + 1, z: fc.z },
          { x: fc.x, y: fc.y + 1, z: fc.z + 1 },
          { x: fc.x, y: fc.y + 1, z: fc.z - 1 },
        ];
        let safeApproach = approachCandidates[0]; // default fallback
        for (const ap of approachCandidates) {
          const apBlock = bot.blockAt(new (bot.entity.position.constructor as any)(ap.x, ap.y, ap.z));
          const apBelow = bot.blockAt(new (bot.entity.position.constructor as any)(ap.x, ap.y - 1, ap.z));
          // Prefer a position with solid ground below and no water at foot-level
          if (!isWaterBlock(apBlock?.name) && apBelow && apBelow.name !== "air" && !isWaterBlock(apBelow.name)) {
            safeApproach = ap;
            break;
          }
        }
        await farmMoveTo(safeApproach.x, safeApproach.y, safeApproach.z);
        logs.push(`Moved to (${safeApproach.x},${safeApproach.y},${safeApproach.z}) for tilling`);
        // Post-move in-water check: if the safe approach still ended up in water, skip this coord
        const pFeet = bot.blockAt(bot.entity.position.floor());
        const pHead = bot.blockAt(bot.entity.position.offset(0, 1, 0).floor());
        if (isWaterBlock(pFeet?.name) || isWaterBlock(pHead?.name)) {
          bot.setControlState("sneak", false);
          bot.setControlState("jump", true);
          logs.push(`[WARNING] Entered water moving to farm block (${fc.x},${fc.y},${fc.z}). Swimming up and skipping.`);
          for (let wi2 = 0; wi2 < 12; wi2++) {
            await new Promise(r => setTimeout(r, 500));
            const wf2 = bot.blockAt(bot.entity.position.floor());
            const wh2 = bot.blockAt(bot.entity.position.offset(0, 1, 0).floor());
            if (!isWaterBlock(wf2?.name) && !isWaterBlock(wh2?.name)) break;
          }
          bot.setControlState("jump", false);
          continue;
        }
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
    let tillInWaterAbort = false;
    for (let tillAttempt = 0; tillAttempt < tillPositions.length && !farmlandConfirmed; tillAttempt++) {
      const tp = tillPositions[tillAttempt];
      // Skip approach positions that are water blocks — bot1 Session 72b drowning fix.
      const tpBlock = bot.blockAt(new (bot.entity.position.constructor as any)(tp.x, tp.y, tp.z));
      if (isWaterBlock(tpBlock?.name)) {
        logs.push(`Skipping water approach (${tp.x},${tp.y},${tp.z}) for till retry`);
        continue;
      }
      // Move to this approach position
      if (tillAttempt > 0) {
        try {
          await farmMoveTo(tp.x, tp.y, tp.z);
          logs.push(`Retry till from (${tp.x},${tp.y},${tp.z})`);
          // In-water check after retry moveTo
          const rtFeet = bot.blockAt(bot.entity.position.floor());
          const rtHead = bot.blockAt(bot.entity.position.offset(0, 1, 0).floor());
          if (isWaterBlock(rtFeet?.name) || isWaterBlock(rtHead?.name)) {
            bot.setControlState("sneak", false);
            bot.setControlState("jump", true);
            logs.push(`[WARNING] Entered water during till retry moveTo. Swimming up and skipping farm coord.`);
            for (let wi3 = 0; wi3 < 12; wi3++) {
              await new Promise(r => setTimeout(r, 500));
              const rf3 = bot.blockAt(bot.entity.position.floor());
              const rh3 = bot.blockAt(bot.entity.position.offset(0, 1, 0).floor());
              if (!isWaterBlock(rf3?.name) && !isWaterBlock(rh3?.name)) break;
            }
            bot.setControlState("jump", false);
            tillInWaterAbort = true;
            break;
          }
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
    // If water abort was triggered in the retry loop, skip this farm coord entirely
    if (tillInWaterAbort) { continue; }
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
    // Use water-safe approach: try non-water positions first.
    {
      const plantApproaches = [
        { x: fc.x + 1, y: fc.y + 1, z: fc.z },
        { x: fc.x - 1, y: fc.y + 1, z: fc.z },
        { x: fc.x, y: fc.y + 1, z: fc.z + 1 },
        { x: fc.x, y: fc.y + 1, z: fc.z - 1 },
      ];
      let plantMoved = false;
      for (const pa of plantApproaches) {
        const paBlock = bot.blockAt(new (bot.entity.position.constructor as any)(pa.x, pa.y, pa.z));
        if (isWaterBlock(paBlock?.name)) continue; // skip water approach positions
        try {
          await botManager.moveTo(username, pa.x, pa.y, pa.z);
          plantMoved = true;
          break;
        } catch (_) {}
      }
      if (!plantMoved) {
        logs.push(`Could not move next to farmland at (${fc.x},${fc.y},${fc.z}) — all approach positions blocked/water. Skipping.`);
        continue;
      }
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
        logs.push(`[WARNING] Hostile detected during bone meal: ${bmDanger.nearestHostile?.name}. Consider fleeing.`);
        console.error(`[Farm] WARNING: ${bmDanger.nearestHostile?.name} during bone meal. Continuing.`);
      }
      // HP monitoring: warn if bot is taking damage from any source
      const bmHp = bot.health ?? 20;
      if (bmHp < 10) {
        logs.push(`[WARNING] HP low during bone meal (${bmHp.toFixed(1)}/20). Consider eating/fleeing.`);
        console.error(`[Farm] WARNING: HP=${bmHp.toFixed(1)} during bone meal. Continuing.`);
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
    // Step 4b: Apply remaining bone_meal to pre-existing growing crops in 20-block radius.
    // Bug: mc_farm had bone_meal but did nothing when plantedCoords was empty (established farm
    // with all spots occupied by growing crops). Bone-mealing existing crops accelerates
    // harvest so the bot can eat sooner, even when no new planting was done this session.
    const boneMealAfter = botManager.getInventory(username).find(i => i.name === "bone_meal");
    if (boneMealAfter && boneMealAfter.count > 0) {
      const BONEMEAL_CROP_NAMES = new Set(["wheat", "carrots", "potatoes", "beetroots"]);
      const growingCropBlocks = bot.findBlocks({
        matching: (b: any) => {
          if (!BONEMEAL_CROP_NAMES.has(b.name)) return false;
          const props = b.getProperties ? b.getProperties() : null;
          const age = props?.age ?? b.metadata;
          return age < 7; // not yet mature
        },
        maxDistance: 20,
        count: 10,
      });
      if (growingCropBlocks.length > 0) {
        logs.push(`Step 4b: Applying bone_meal to ${growingCropBlocks.length} pre-existing growing crop(s) in 20-block radius.`);
        const { Vec3: Vec3Cls4b } = await import("vec3");
        for (const gcPos of growingCropBlocks) {
          if (Date.now() - farmStartTime > FARM_TIMEOUT_MS) {
            logs.push(`[ABORTED] mc_farm timed out during pre-existing crop bone meal phase.`);
            break;
          }
          const bmNow = botManager.getInventory(username).find(i => i.name === "bone_meal");
          if (!bmNow || bmNow.count === 0) break;
          try {
            const bDist4b = bot.entity.position.distanceTo(new Vec3Cls4b(gcPos.x + 0.5, gcPos.y, gcPos.z + 0.5));
            if (bDist4b > 3.5) {
              await botManager.moveTo(username, gcPos.x + 1, gcPos.y, gcPos.z);
            }
            for (let attempt = 0; attempt < 8; attempt++) {
              const bmNowCheck = botManager.getInventory(username).find(i => i.name === "bone_meal");
              if (!bmNowCheck || bmNowCheck.count === 0) break;
              const cropBlock4b = bot.blockAt(new Vec3Cls4b(gcPos.x, gcPos.y, gcPos.z));
              if (!cropBlock4b || !BONEMEAL_CROP_NAMES.has(cropBlock4b.name)) break;
              const props4b = cropBlock4b && (cropBlock4b as any).getProperties ? (cropBlock4b as any).getProperties() : null;
              const age4b = props4b?.age ?? (cropBlock4b as any).metadata;
              if (age4b >= 7) break; // fully grown now
              const bmResult4b = await botManager.useItemOnBlock(username, "bone_meal", gcPos.x, gcPos.y, gcPos.z);
              logs.push(`Bone_meal pre-existing crop at (${gcPos.x},${gcPos.y},${gcPos.z}): ${bmResult4b}`);
              await new Promise(r => setTimeout(r, 200));
            }
          } catch (e) {
            logs.push(`Bone_meal pre-existing crop failed at (${gcPos.x},${gcPos.y},${gcPos.z}): ${e}`);
          }
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
      logs.push(`[WARNING] Hostile detected during harvest: ${hd}. Consider fleeing.`);
      console.error(`[Farm] WARNING: ${hd} during harvest. Continuing.`);
    }
    const harvestHp = bot.health ?? 20;
    if (harvestHp < 10) {
      logs.push(`[WARNING] HP low during harvest (${harvestHp.toFixed(1)}/20). Consider eating/fleeing.`);
      console.error(`[Farm] WARNING: HP=${harvestHp.toFixed(1)} during harvest. Continuing.`);
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

  // Always scan for any mature wheat/crop within 20 blocks (from older plantings) —
  // Bug fix [2026-03-25]: previously guarded by `!wheatGathered`, so if even one crop was
  // harvested from plantedCoords, the entire 16-block scan was skipped and older mature
  // crops (e.g., 51 planted seeds from previous sessions) were left unharvested.
  // Now runs unconditionally, with 20-block radius (matches other mc_farm scan radii),
  // and replants harvested spots to keep farm productive for next session.
  try {
    const freshBot = botManager.getBot(username);
    const { Vec3: Vec3Cls } = await import("vec3");
    if (freshBot) {
      const MATURE_CROP_NAMES = new Set(["wheat", "carrots", "potatoes", "beetroots"]);
      const matureCropBlocks = freshBot.findBlocks({ matching: (block: any) => {
        if (!MATURE_CROP_NAMES.has(block.name)) return false;
        const p = block.getProperties ? block.getProperties() : null;
        const age = p?.age ?? block.metadata;
        // wheat/beetroots max age=7, carrots/potatoes max age=7
        return age >= 7;
      }, maxDistance: 20, count: 20 });
      if (matureCropBlocks.length > 0) {
        logs.push(`Found ${matureCropBlocks.length} mature crops nearby (20-block scan) — harvesting`);
        for (const pos of matureCropBlocks) {
          // Timeout check
          if (Date.now() - farmStartTime > FARM_TIMEOUT_MS) {
            logs.push(`[ABORTED] mc_farm timed out during full-field harvest.`);
            break;
          }
          // Safety: hostile + HP check per block during nearby crop harvest
          const scanDanger = checkDangerNearby(freshBot, 20);
          if (scanDanger.dangerous) {
            logs.push(`[WARNING] Hostile detected during full-field harvest. Consider fleeing.`);
            console.error(`[Farm] WARNING: hostile during full-field harvest. Continuing.`);
          }
          if ((freshBot.health ?? 20) < 10) {
            logs.push(`[WARNING] HP low during full-field harvest (${(freshBot.health ?? 20).toFixed(1)}). Consider eating/fleeing.`);
            console.error(`[Farm] WARNING: HP=${(freshBot.health ?? 20).toFixed(1)} during full-field harvest. Continuing.`);
          }
          try {
            await botManager.moveTo(username, pos.x + 1, pos.y, pos.z);
            const wb = freshBot.blockAt(pos);
            if (wb && MATURE_CROP_NAMES.has(wb.name)) {
              await freshBot.dig(wb);
              await new Promise(r => setTimeout(r, 300));
              await botManager.collectNearbyItems(username);
              wheatGathered = true;
              logs.push(`Harvested ${wb.name} at (${pos.x},${pos.y},${pos.z})`);
              // Replant: if we have seeds and the block below is now farmland, replant immediately
              // This keeps the farm productive for subsequent sessions.
              const currentSeeds = botManager.getInventory(username).find((i: any) => i.name.includes("_seeds"));
              if (currentSeeds) {
                const farmlandBelow = freshBot.blockAt(new Vec3Cls(pos.x, pos.y - 1, pos.z));
                if (farmlandBelow && farmlandBelow.name === "farmland") {
                  try {
                    await botManager.useItemOnBlock(username, currentSeeds.name, pos.x, pos.y - 1, pos.z);
                    logs.push(`Replanted ${currentSeeds.name} at (${pos.x},${pos.y - 1},${pos.z})`);
                  } catch (replantErr) {
                    logs.push(`Replant failed at (${pos.x},${pos.y - 1},${pos.z}): ${replantErr}`);
                  }
                }
              }
            }
          } catch { /* skip */ }
        }
      } else {
        logs.push("No mature crops found in 20-block scan.");
      }
    }
  } catch (e) {
    logs.push(`Full-field harvest scan failed: ${e}`);
  }

  // Step 6: Craft bread (3 wheat = 1 bread)
  const invAfter = botManager.getInventory(username);
  const wheatInInv = invAfter.find(i => i.name === "wheat");
  if (wheatInInv && wheatInInv.count >= 3) {
    const breadCount = Math.floor(wheatInInv.count / 3);
    try {
      for (let b = 0; b < breadCount; b++) {
        const craftResult = await getHighLevel().minecraft_craft_chain(username, "bread", false);
        logs.push(`Craft bread ${b + 1}/${breadCount}: ${craftResult}`);
      }
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
  ].join("\n") + farmWarning;
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
    // BLOCK navigation when starving with no food and HP is low.
    // Bot2 [2026-03-23]: hunger=4, no food, navigated long distance, killed by zombie mid-travel.
    // Threshold raised from 2 to 6: at hunger<=6, sprinting is disabled by Minecraft, making
    // flee from mobs much harder. Navigation drains hunger, so hunger=4-6 reaches 0 quickly.
    // Bot1 Sessions 28,35,44: died at HP 10-14 navigating with hunger=0-1, no food.
    //
    // TWO-TIER check:
    //   1) LONG DISTANCE (>30 blocks): Block at ANY HP when hunger<=6 and no food.
    //      Bug: Bot2 [2026-03-23] had HP>14, hunger=4, no food, navigated 50+ blocks.
    //      The old `hp <= 14` gate let high-HP bots through, but hunger WILL hit 0
    //      during any long nav (sprinting depletes ~1 hunger/7s). After hunger=0,
    //      HP drains 1/4s from starvation and cannot regenerate. Any mob hit is lethal.
    //   2) SHORT DISTANCE (<=30 blocks): Block only when HP<=14 — allows emergency
    //      chest/food access. Without this exemption, starving bots are completely
    //      immobilized — they can't reach a chest 5 blocks away to get food.
    // Bot2 [2026-03-22]: "pathfinder emergency chest access" deadlock — hunger=0, HP=4,
    //   chest at 8 blocks, navigation REFUSED, died.
    // Bot3 Bug #13/#15: hunger=0, chest at 19.6m, navigation blocked, death loop.
    // moveTo already has its own safety (HP check, hostile scan, cave routing abort)
    // that will protect during short moves.
    if (hunger <= 6 && !hasFood) {
      const navPos = bot.entity.position;
      let estimatedDistance = Infinity;
      if (args.x !== undefined && args.z !== undefined) {
        const ty = args.y ?? navPos.y;
        estimatedDistance = Math.sqrt((args.x - navPos.x) ** 2 + (ty - navPos.y) ** 2 + (args.z - navPos.z) ** 2);
      } else if (args.target_block || args.target_entity) {
        // Try to estimate actual distance to entity/block target.
        // Bot2 [2026-03-23]: hunger=4, no food, navigate("cow") roamed 50+ blocks
        // because estimatedDistance was hardcoded to 30 (short-range bypass).
        // The bot starved mid-travel and was killed by a zombie.
        // Now: look up the target entity/block position to get real distance.
        // If not found, default to 30 (allows the attempt — moveTo safety handles danger).
        estimatedDistance = 30; // default: treat as short-range
        if (args.target_entity) {
          for (const entity of Object.values(bot.entities)) {
            if (!entity || !entity.position || entity === bot.entity) continue;
            const eName = entity.name?.toLowerCase() ?? "";
            if (eName === args.target_entity.toLowerCase()) {
              estimatedDistance = entity.position.distanceTo(navPos);
              break;
            }
          }
        } else if (args.target_block) {
          try {
            const foundBlock = bot.findBlock({
              matching: (b: any) => b.name === args.target_block,
              maxDistance: 128,
            });
            if (foundBlock) {
              estimatedDistance = foundBlock.position.distanceTo(navPos);
            }
          } catch { /* ignore search errors */ }
        }
      }
      if (estimatedDistance > 30) {
        // Warn about long-distance navigation at low hunger with no food.
        // Bot2 [2026-03-23]: HP>14, hunger=4, moveTo(80,69,-13) ~50+ blocks, killed by zombie.
        console.error(`[Navigate] WARNING: hunger=${hunger}, HP=${hp}, no food, distance=${Math.round(estimatedDistance)}. Long-distance nav risks starvation death.`);
        nightWarning += `\n[WARNING] hunger=${hunger}, HP=${hp}, no food. Long-distance nav (${Math.round(estimatedDistance)} blocks) risks starvation mid-travel.\n[推奨アクション]\n1. bot.combat("cow") or bot.combat("pig") — 近くの動物を狩って食料確保\n2. bot.eat() — 食料があればHP回復\n3. bot.navigate({target_block:"chest"}) — 近くのチェストから食料取得（<30ブロック）\n4. bot.farm() — 農場で食料収穫`;
      }
      // Short-distance: only block when HP is already low (<=14), allowing emergency
      // food/chest access at higher HP.
      if (hp <= 14) {
        nightWarning += `\n[STARVATION WARNING] Hunger=${hunger}, no food, HP=${hp}. Short-distance nav allowed but find food urgently.`;
      }
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
        // BUG FIX: Previously this only set nightWarning string but NEVER returned early,
        // despite the comment saying "BLOCK". The bot continued navigating and got killed.
        // Bot1 Sessions 20-42: 15+ deaths from night navigation with low HP + nearby mobs.
        // Bot2 [2026-03-23]: killed by zombie during night navigation.
        // WARNING (not block): per user instruction, operations continue with warning.
        // moveToBasic's mid-movement checks provide runtime safety during travel.
        const nightHpBlock = hasFood ? 10 : 14;
        if (hp <= nightHpBlock && closestDist <= 16) {
          console.error(`[Navigate] WARNING: HP=${hp} at night with ${nearbyHostiles.length} hostile(s) nearby (${threatList}). closestDist=${closestDist}.`);
          nightWarning += `\n[WARNING] HP=${hp} at night with ${nearbyHostiles.length} hostile(s) nearby (${threatList}). ${!hasFood ? "No food — HP cannot regenerate. " : ""}\n[推奨アクション]\n1. bot.flee(20) — 敵から逃走\n2. bot.place("dirt", x, y, z) — 周囲にブロックを置いてシェルター建設\n3. bot.eat() — 食料があればHP回復${!hasFood ? "\n4. bot.combat(\"cow\") — 食料動物を狩って食料確保" : ""}\n5. bot.wait(30000) — 夜明けまで安全な場所で待機`;
        }
        nightWarning += `\n[NIGHT WARNING] HP=${hp}, ${nearbyHostiles.length} hostile(s) nearby: ${threatList}. Consider mc_flee or shelter before long navigation.`;
      }
    } else {
      // DAYTIME close-range hostile check: pillagers, cave zombies, and other hostiles
      // can attack during daytime. Block navigation when a hostile is close AND HP is low.
      // Bot1 [2026-03-22]: killed by zombie during daytime navigation at low HP.
      // Bot2 [2026-03-23]: killed by zombie during daytime moveTo with hunger=4.
      // Bot2: pillager knockback caused fall during daytime movement.
      // Scan radius expanded from 10 to 16 — skeletons/pillagers shoot from 16+ blocks.
      // Bot2 [2026-03-23]: zombie at 22.8m closed in during navigate and killed bot.
      // HP threshold raised from 12 to 14 without food — permanent damage accumulates.
      {
        // Without food: scan at HP<=16 because damage is permanent and cannot regenerate.
        // Bot2 [2026-03-23]: HP>14, no food, zombie at 22.8m — old check (14) skipped.
        // However, dayHpCheck=20 (always true) was too aggressive: at full HP 20 with no
        // food, the bot can survive 4-5 zombie hits (3-5 damage each), so warning at HP=20
        // for ANY hostile within 24 blocks causes constant warning spam that the agent
        // ignores. Threshold 16 catches bots that have taken at least one hit (HP 15-16),
        // meaning they're in an active danger zone where further damage is permanent.
        // With food, limit to HP<=12 (can eat to recover).
        const dayHpCheck = hasFood ? 12 : 16;
        if (hp <= dayHpCheck) {
          // Scan radius: 16 blocks with food, 24 without food.
          // Bot2 [2026-03-23]: zombie at 22.8m was outside 16-block scan radius,
          // pre-check didn't detect it, bot navigated and zombie closed in during travel.
          // Without food, damage is permanent — widen scan to catch approaching mobs.
          const dayScanRadius = hasFood ? 16 : 24;
          const dayHostiles: Array<{ name: string; dist: number }> = [];
          for (const entity of Object.values(bot.entities)) {
            if (!entity || !entity.position || entity === bot.entity) continue;
            const dist = entity.position.distanceTo(bot.entity.position);
            if (dist > dayScanRadius) continue;
            const name = entity.name?.toLowerCase() ?? "";
            if (isHostileMob(bot, name)) {
              dayHostiles.push({ name, dist: Math.round(dist * 10) / 10 });
            }
          }
          if (dayHostiles.length > 0) {
            const dayThreatList = dayHostiles
              .sort((a, b) => a.dist - b.dist)
              .slice(0, 5)
              .map(h => `${h.name}(${h.dist}m)`)
              .join(", ");
            // BUG FIX: Previously only set nightWarning string but didn't block.
            // Bot2 [2026-03-23]: killed by zombie during daytime navigation at low HP.
            // Now actually blocks when hostiles are within 10 blocks and HP is critical.
            // Without food, increase block radius to 20 — any damage is permanent, and
            // mobs at 16-22 blocks close in during navigation (zombie walks at 2.3 blocks/s,
            // so a mob at 20 blocks reaches melee in ~8s — well within typical nav duration).
            // Bot2 [2026-03-23]: zombie at 22.8m was outside 16-block block radius, closed
            // in during navigate and killed bot with no food to regenerate. 16 blocks was
            // insufficient; at 20 blocks the pre-check catches most approaching zombies.
            const closestDayDist = dayHostiles.sort((a, b) => a.dist - b.dist)[0].dist;
            // Bot2 [2026-03-23]: zombie at 22.8m passed pre-check (dayBlockDist=20),
            // closed in during navigate, killed bot with no food. 20 blocks gives only
            // ~8.7s before a zombie reaches melee (2.3 blocks/s). During a 30-60s navigation,
            // the bot may move toward the mob, cutting closure time further. 24 blocks gives
            // ~10.4s and matches the dayScanRadius for no-food, eliminating the gap where mobs
            // pass the scan but not the block check.
            const dayBlockDist = hasFood ? 10 : 24;
            if (closestDayDist <= dayBlockDist) {
              // WARNING (not block): per user instruction, operations continue with warning.
              // moveToBasic's mid-movement checks (B1/B2/B3) provide runtime safety during travel.
              // Bot2 [2026-03-23]: killed by zombie during daytime navigation at low HP.
              console.error(`[Navigate] WARNING: HP=${hp} daytime with ${dayHostiles.length} hostile(s) nearby (${dayThreatList}). closestDist=${closestDayDist}.`);
              nightWarning += `\n[WARNING] HP=${hp} with ${dayHostiles.length} hostile(s) within ${closestDayDist.toFixed(1)} blocks (${dayThreatList}). ${!hasFood ? "No food — HP cannot regenerate. " : ""}\n[推奨アクション]\n1. bot.flee(20) — 敵から逃走\n2. bot.combat() — 最も近い敵を倒す（引数なし=最近接敵）\n3. bot.eat() — 食料があればHP回復${!hasFood ? "\n4. bot.combat(\"cow\") — 食料動物を狩って食料確保" : ""}`;
            }
            nightWarning += `\n[DANGER WARNING] HP=${hp}, ${dayHostiles.length} hostile(s) within ${dayScanRadius} blocks: ${dayThreatList}. Use mc_flee or mc_combat before navigating.`;
          }
        }
      }
    }
  }

  // Pre-navigation auto-sleep: if it's nighttime and a bed is nearby, sleep first.
  // Bot1 [2026-03-22]: killed by Phantom (insomnia from 3+ nights without sleep).
  // Bot1 [2026-03-22]: 15+ deaths from night navigation through mob-dense terrain.
  // Sleeping skips the entire night, preventing mob encounters and Phantom spawns.
  // Only attempt if not in a combat/flee emergency (caller should use mc_flee for that).
  if (bot) {
    const sleepTimeOfDay = bot.time?.timeOfDay ?? 0;
    const isSleepableNight = sleepTimeOfDay >= 12541 && sleepTimeOfDay <= 23458;
    if (isSleepableNight) {
      try {
        const sleepResult = await botManager.sleep(username);
        console.error(`[Navigate] Pre-nav auto-sleep succeeded: ${sleepResult}`);
        // After sleeping, night is over — continue with navigation normally
      } catch (sleepErr) {
        // Sleep failed (no bed nearby, bed occupied, etc.) — continue with navigation
        console.error(`[Navigate] Pre-nav auto-sleep skipped: ${sleepErr instanceof Error ? sleepErr.message : String(sleepErr)}`);
      }
    }

    // Phantom insomnia auto-sleep: Phantoms spawn after 72000 ticks without sleeping and
    // attack even during DAYTIME. mc_navigate can take 30-60s during which Phantoms
    // dive-attack from above, and the bot can't dodge during pathfinder movement.
    // mc_gather, mc_farm, and mc_combat all have this check, but mc_navigate did not.
    // Bot1 [2026-03-22]: killed by Phantom during daytime navigation/farming after 3+ nights
    // without sleep. The night auto-sleep above only fires at night; this fires at ANY time
    // when insomnia is critical.
    if (!isSleepableNight) {
      const navWorldAge = bot.time?.age ?? 0;
      const navLastSleep = lastSleepTick.get(username) ?? 0;
      const navTicksSinceLastSleep = navWorldAge - navLastSleep;
      if (navTicksSinceLastSleep > 60000 && navWorldAge > 0) {
        console.error(`[Navigate] Phantom insomnia high (${navTicksSinceLastSleep} ticks). Attempting pre-nav sleep to reset timer.`);
        try {
          const sleepResult = await botManager.sleep(username);
          console.error(`[Navigate] Phantom insomnia auto-sleep succeeded: ${sleepResult}`);
        } catch (sleepErr) {
          console.error(`[Navigate] Phantom insomnia auto-sleep skipped: ${sleepErr instanceof Error ? sleepErr.message : String(sleepErr)}`);
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
      // When searching for a food animal and none are found, check bot's hunger state.
      // Bot1 Session 70b: navigate("sheep") → not found → agent did moveTo(-133,75,188)
      // (200+ blocks away) with HP=5.5 Hunger=0 — killed by zombies mid-travel.
      // Provide clear guidance about safe alternatives instead of letting the agent
      // wander long distances while starving.
      const foodAnimals = new Set(["cow", "pig", "chicken", "sheep", "rabbit", "salmon", "cod"]);
      const targetIsFood = foodAnimals.has((args.target_entity ?? "").toLowerCase());
      const noFoodBot = botManager.getBot(username);
      if (targetIsFood && noFoodBot) {
        const noFoodHunger = (noFoodBot as any).food ?? 20;
        const noFoodHp = noFoodBot.health ?? 20;
        const noFoodInv = botManager.getInventory(username);
        const noFoodHasFood = noFoodInv.some((i: any) => EDIBLE_FOOD_NAMES.has(i.name));
        if (noFoodHunger <= 6 && !noFoodHasFood) {
          // Starvation danger: agent should NOT do long-distance moveTo to search for animals
          return `No ${args.target_entity} found within ${args.max_distance ?? 64} blocks.\n[WARNING] Hunger=${noFoodHunger}, HP=${noFoodHp.toFixed(1)}, no food. DO NOT use moveTo to search far away — long travel while starving is lethal (HP cannot regenerate, mobs will kill you mid-journey).\n[推奨アクション（優先順）]\n1. bot.navigate("pig") または bot.navigate("chicken") — 別の食料動物を探す（64ブロック以内）\n2. bot.navigate("chest") — チェストに食料があるか確認\n3. bot.craft("bread") — 小麦があれば（bot.inventory()で確認）パンをクラフト\n4. bot.farm() — 農場がある場合は収穫\n5. bot.combat("zombie") — 腐肉は食べられる（空腹度回復+10）、ゾンビが近くにいる場合のみ`;
        }
      }
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
      // Penalty: +5 distance per block below bot's Y level (beyond 5-block tolerance).
      // Increased from 3 to 5 (2026-03-22): Bot1/Bot2/Bot3 still targeted underground
      // entities because 3x penalty was insufficient. Matches findBlock 5x penalty.
      // Surface/above entities get no penalty.
      const depthBelowBot = Math.max(botY - entity.position.y - 5, 0);
      const score = dist + depthBelowBot * 5;
      if (score < bestScore) {
        bestScore = score;
        closestDist = dist;
        closestPos = { x: entity.position.x, y: entity.position.y, z: entity.position.z };
      }
    }

    if (!closestPos) {
      return `Found ${args.target_entity} in entity list but could not get position`;
    }

    // Cliff-edge safety check: warn if target entity is near a cliff edge.
    // Session 83: navigate("item") at Y=97 → fell from cliff edge. Drop items and other
    // entities can exist at cliff edges; navigating there causes pathfinder to approach
    // the edge, and the bot falls off. This is a WARNING (not REFUSED) — the agent may
    // still proceed, but should be aware of the risk. moveTo() enforces the real safety.
    {
      const cliffCheckBot = botManager.getBot(username);
      if (cliffCheckBot) {
        // Use isNearCliffEdge centered on the target position to detect edge hazard.
        // We pass a fake position object matching the entity position.
        const { Vec3 } = await import("vec3");
        const targetVec = new Vec3(closestPos.x, closestPos.y, closestPos.z);
        const cliffInfo = isNearCliffEdge(cliffCheckBot, targetVec);
        if (cliffInfo.nearEdge && cliffInfo.maxFallDistance > 3) {
          console.error(`[Navigate] CLIFF WARNING: ${args.target_entity} at (${closestPos.x.toFixed(1)}, ${closestPos.y.toFixed(1)}, ${closestPos.z.toFixed(1)}) is near cliff edge (fall: ${cliffInfo.maxFallDistance} blocks, dirs: ${cliffInfo.edgeDirections.join(",")}). Proceeding with caution.`);
          nightWarning += `\n[WARNING] Target ${args.target_entity} is near a cliff edge (max fall: ${cliffInfo.maxFallDistance} blocks). Approach carefully — do NOT run/sprint toward it. If it falls or you approach cliff, use bot.pillarUp() or bot.flee() to recover.`;
        }
      }
    }

    // Delegate to coordinate-based navigation which has segmented HP checks,
    // auto-eating, and starvation detection for long distances (>50 blocks).
    // Bot1 Sessions 12,31-34,37: deaths during long-distance entity navigation
    // (e.g., navigating to pig at 64 blocks) that bypassed all segment safety checks.
    const entityNavResult = await mc_navigate({ x: closestPos.x, y: closestPos.y, z: closestPos.z });
    return `Found ${args.target_entity} at (${closestPos.x.toFixed(1)}, ${closestPos.y.toFixed(1)}, ${closestPos.z.toFixed(1)}), ${closestDist.toFixed(1)} blocks away.\n${entityNavResult}${nightWarning}`;
  }

  // Navigate to block type
  if (args.target_block) {
    // Special case: wheat navigation should only target mature wheat (age>=7).
    // Bot1 [2026-03-23]: bot.navigate("wheat") found immature wheat (age 0-6),
    // then bot.gather("wheat") returned 0 because gather only harvests age>=7.
    // This mismatch confused agents into thinking gather was broken.
    // Navigate to mature wheat if any exists; otherwise report clearly.
    if (args.target_block === "wheat") {
      const bot = botManager.getBot(username);
      if (bot) {
        const { Vec3 } = await import("vec3");
        const maxDist = args.max_distance ?? 32;
        const matureWheat = bot.findBlocks({
          matching: (b: any) => {
            if (b.name !== "wheat") return false;
            const props = b.getProperties ? b.getProperties() : null;
            const age = props?.age ?? b.metadata ?? 0;
            return age >= 7;
          },
          maxDistance: maxDist,
          count: 1,
        });
        if (matureWheat.length > 0) {
          const wp = matureWheat[0];
          const blockNavResult = await mc_navigate({ x: wp.x, y: wp.y, z: wp.z });
          return `Found mature wheat (age 7/7) at (${wp.x}, ${wp.y}, ${wp.z}).\n${blockNavResult}`;
        }
        // Check for any immature wheat
        const anyWheat = bot.findBlocks({
          matching: (b: any) => b.name === "wheat",
          maxDistance: maxDist,
          count: 1,
        });
        if (anyWheat.length > 0) {
          const wp = anyWheat[0];
          const block = bot.blockAt(wp);
          const props = block && (block as any).getProperties ? (block as any).getProperties() : null;
          const age = props?.age ?? (block as any)?.metadata ?? 0;
          return `Found wheat at (${wp.x}, ${wp.y}, ${wp.z}) but it is still growing (age ${age}/7). Wait for it to mature, or use bot.farm() with bone_meal to speed up growth. Only mature wheat (age 7) can be harvested with bot.gather("wheat").`;
        }
        return `No wheat found within ${maxDist} blocks. Use bot.farm() to plant wheat_seeds first.`;
      }
    }

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
    let ny = Number(args.y);
    const nz = Number(args.z);
    if (isNaN(nx) || isNaN(ny) || isNaN(nz)) {
      return `Invalid coordinates: x=${args.x}, y=${args.y}, z=${args.z}`;
    }

    // Y-level safety clamping: prevent pathfinder from routing through caves/underground.
    // Bot1 Sessions 31-44: 15+ deaths from mc_navigate routing underground. The pathfinder
    // finds paths through cave openings when the target Y is significantly below the bot.
    // Bot2: mc_navigate fell bot from Y=97 to Y=68 (29 blocks) during navigation.
    // Bot1 Session 44: navigated to (100,96,0), fell into cave at Y=72, drowned.
    // Bot3 Death #4: move_to Y=64 routed through Y=112, then fell.
    // [2026-03-24] Bot1 Session: navigate({x:2, y:72, z:5}) routed to Y=55 underground cave,
    // bot got trapped (20+ navigate attempts failed "Path blocked"), fled, pillarUp → water → death.
    //
    // Core insight: Pathfinder will find EVEN LEGITIMATE surface-level targets by routing
    // through caves if a cave path is physically shorter. We must prevent ANY substantial
    // Y-descent that could trigger cave routing:
    // - ANY navigation more than 5 blocks downward is dangerous (surface caves start at Y~63-64)
    // - Horizontal distance makes cave routing MORE likely (longer paths = more cave opportunities)
    // - The only safe navigation is when target Y >= bot Y - 5 (shallow or level/upward)
    //
    // [2026-03-24 CRITICAL FIX]: Strengthen Y-clamping to prevent pathfinder from routing
    // through caves even to legitimate destinations. The previous logic allowed:
    // - Y <= 50: clamped (good)
    // - Y > 50 AND horizDist > 30 AND yDescent > 10: clamped to Y = bot.y - 10 (still vulnerable)
    // - Y > 50 AND (short distance OR shallow descent): NOT clamped (DANGEROUS)
    //
    // New strategy: ALWAYS clamp downward navigation to max 5 blocks below bot's Y.
    // This prevents cave routing entirely. For intentional underground work, use moveTo/gather.
    const pos = botManager.getPosition(username);
    if (pos) {
      const horizDist = Math.sqrt((nx - pos.x) ** 2 + (nz - pos.z) ** 2);
      const yDescent = pos.y - ny;

      // Downward descent limit: prevent cave routing.
      // Bot1 Session [2026-03-24]: navigate({x:2, y:72, z:5}) from Y~82 attempted
      // to descend 10 blocks. Pathfinder found a cave route through Y=55 and trapped the bot.
      //
      // ELEVATED TERRAIN EXCEPTION (Bot1 Session 56):
      // Bot stranded at Y=92 (birch forest cliff). 5-block clamp set target to Y=87 (still cliff).
      // Pathfinder found no horizontal path from Y=87-92 → ALL movements timed out.
      // Fix: when bot is elevated (Y>75), allow descent of up to 20 blocks to reach ground level.
      // Y=92-20=72, still well above Y=63 (sea level / surface caves).
      // The moveToBasic underground detection in bot-movement.ts enforces the real safety limit.
      //
      // Normal surface (Y<=75): clamp to 5 blocks (unchanged, prevents cave routing).
      // Elevated start (Y>75): clamp to 20 blocks (allows cliff descent to ground level).
      const yClampLimit = pos.y > 75 ? 20 : 5;
      if (yDescent > yClampLimit) {
        const clampedY = Math.round(pos.y - yClampLimit);
        console.error(`[Navigate] CAVE AVOIDANCE Y-CLAMP: Target Y=${ny} requires descent of ${yDescent.toFixed(0)} blocks from bot Y=${pos.y.toFixed(0)}. Clamping to Y=${clampedY} (max ${yClampLimit} blocks down, ${pos.y > 75 ? "elevated" : "surface"} start). For intentional underground travel, use bot.moveTo() in small Y-steps or bot.gather() for ores.`);
        nightWarning += `\n[WARNING] Target Y=${ny} would require descending ${yDescent.toFixed(0)} blocks (cave routing risk). Clamped to Y=${clampedY} (max ${yClampLimit} blocks down). For deeper underground travel, use bot.moveTo({x, y, z}) in steps.`;
        ny = clampedY;
      }
    }

    // For long distances, move in segments (from movement.ts logic)
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
            // Night HP check: abort without food (HP can't regen), warn-only with food (auto-eat handles it).
            // Bot1 Session 28: HP=14/hunger=1, died during multi-segment night navigation.
            // Bot2/Bot3: deadlocks from blocked movement when food was available.
            if (segIsNight) {
              if (segHp <= 4) {
                console.error(`[Navigate] WARNING: HP=${Math.round(segHp*10)/10} at night during segment ${i}/${steps}. Critically low.`);
              } else if (segHp <= 12) {
                console.error(`[Navigate] WARNING: HP=${Math.round(segHp*10)/10} at night during segment ${i}/${steps}. ${segHasFood ? "Has food — auto-eat will trigger." : "No food — HP cannot regenerate."}`);
              }
            }
            // Abort if starving or near-starvation with low HP — starvation drains HP and mobs finish the job.
            // Bot1 Session 28: HP=14, hunger=1, died during multi-segment navigation because hunger
            // hit 0 mid-travel (HP can't regen) and mobs killed bot. Previous threshold (hunger<=0 && HP<=10)
            // was too lenient — bot kept navigating with hunger near 0 until HP dropped below 10.
            // New: abort at hunger<=2 with no food (hunger will hit 0 during travel) AND HP<=14.
            const starvationDanger = (segHunger <= 0 && segHp <= 12) || (segHunger <= 2 && !segHasFood && segHp <= 14);
            if (starvationDanger) {
              console.error(`[Navigate] WARNING: HP=${Math.round(segHp*10)/10}, hunger=${Math.round(segHunger)} during segment ${i}/${steps}. Starvation risk — find food urgently.`);
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
            // Now: ALWAYS scan between segments regardless of time/HP. Scan radius 16 for both
            // day and night — pillagers and skeletons shoot from 16+ blocks at any time.
            const segScanRadius = 16;
            {
              const segDanger = checkDangerNearby(segBot, segScanRadius);
              if (segDanger.dangerous && segDanger.nearestHostile) {
                const nearDist = segDanger.nearestHostile.distance;
                const nearName = segDanger.nearestHostile.name;
                // Creepers within 8 blocks: REFUSED (explosion is lethal — this is a game constraint)
                const isCreeperClose = nearName === "creeper" && nearDist <= 8;
                if (isCreeperClose) {
                  try { await botManager.equipArmor(username); } catch { /* ignore */ }
                  const curPos2 = botManager.getPosition(username);
                  const posStr = curPos2 ? `(${Math.round(curPos2.x)}, ${Math.round(curPos2.y)}, ${Math.round(curPos2.z)})` : "unknown";
                  const timeNote = segIsNight ? "at night" : "during daytime";
                  return `[REFUSED] Navigation stopped after ${i-1}/${steps} segments — creeper detected ${nearDist.toFixed(1)} blocks away ${timeNote}. Current position: ${posStr}. Use mc_flee to escape creeper first.`;
                }
                // Other hostiles: just warn
                console.error(`[Navigate] WARNING: ${nearName} at ${nearDist.toFixed(1)} blocks during segment ${i}/${steps} (HP=${Math.round(segHp*10)/10})`);
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
          // [2026-03-24 CRITICAL]: Even final segment needs cave avoidance. If navigating
          // to a lower-Y target (e.g., Y=72 from Y=82), allow only shallow descent (<5 blocks)
          // per segment. If target is deeper, it should be reached in small moveTo steps
          // or as a genuine underground task via bot.gather().
          const isFinalSegment = remainDist <= segmentSize;
          let iy = isFinalSegment ? ny : curPos.y;
          // Even on final segment, clamp deep descents to prevent cave routing.
          // [2026-03-24]: navigate to Y=72 routed through Y=55 cave. Clamp final segment
          // to max 5 blocks descent to keep pathfinder above-ground.
          if (iy < curPos.y - 5) {
            const clampedSegY = curPos.y - 5;
            console.error(`[Navigate] Segment ${i}/${steps}: intermediate target Y=${iy} would descend ${(curPos.y - iy).toFixed(1)} blocks. Clamping to Y=${clampedSegY} (max 5 blocks) to prevent cave routing.`);
            iy = clampedSegY;
          }
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
            // [2026-03-24 FIX] Underground cave trap escape routing:
            // When navigate() detects underground/cave routing mid-travel, immediately abort
            // and suggest escape options: pillarUp + moveTo surface, or direct flee.
            // Bug: Bot1 Session [2026-03-24] got trapped Y=55 underground after navigate()
            // routed through cave. 20+ navigate attempts returned "Path blocked". Need explicit
            // surface-targeting escape instead of continuing same failed path.
            const escapeMsg = `\n[CAVE TRAP ESCAPE ROUTING]\n` +
              `1. bot.minecraft_pillar_up(30) — Climb straight up ${Math.max(80 - (curPos3?.y ?? 50), 10)} blocks to surface (Y=${80}).\n` +
              `2. bot.mc_navigate({x: ${Math.round(curPos3?.x ?? 0)}, y: 80, z: ${Math.round(curPos3?.z ?? 0)}}) — Navigate directly to surface level Y=80.\n` +
              `3. bot.mc_flee(40) — Flee away from cave in a different direction and try alternate surface path.\n` +
              `4. bot.mc_gather("stone") — Mine upward through solid rock if pillarUp blocks fail.`;
            return `[ABORTED] Navigation stopped after ${i}/${steps} segments — underground/cave routing detected. ${lastResult} Current position: ${posStr3}.${escapeMsg}` + nightWarning;
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
  fleeAtHpArg: number = 10
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

  let combatHpWarning = "";
  const combatBot = botManager.getBot(username);
  if (combatBot) {
    const combatHp = combatBot.health ?? 20;
    // WARNING (not block) at HP < 5: one hit from any mob is lethal.
    // Bot3 Bug #22 [2026-03-23]: combat REFUSED at HP<5 caused complete deadlock when
    // flee, gather, navigate were also blocked. Bot couldn't fight zombies to escape,
    // couldn't gather dirt for shelter, couldn't navigate away — stuck until death.
    // Converting to WARNING: operation continues but agent is strongly advised to flee.
    // Creeper proximity and cliff edge remain the only REFUSED exceptions.
    if (combatHp < 5) {
      const combatHasFood = combatBot.inventory.items().some((item: any) => EDIBLE_FOOD_NAMES.has(item.name));
      combatHpWarning = `\n[WARNING] HP critically low (${combatHp.toFixed(1)}/20). One mob hit (3-5 damage) is lethal.\n[推奨アクション]\n1. bot.flee(20) — 敵から逃走（最優先）\n2. bot.eat() — 食料があればHP回復${!combatHasFood ? "\n3. bot.combat(\"cow\") — 食料動物を狩って食料確保（HP5以上推奨）" : ""}\n4. bot.place(\"dirt\", x, y, z) — シェルター建設\n5. bot.wait(30000) — hunger>=18なら自然回復を待つ`;
      console.error(`[Combat] WARNING: HP critically low (${combatHp.toFixed(1)}/20). Proceeding despite risk — blocking causes deadlock.`);
    } else if (combatHp < 8) {
      console.error(`[Combat] WARNING: HP low (${combatHp.toFixed(1)}/20). Proceeding with caution.`);
    }
  }

  // Pre-combat auto-sleep at night: if bot has a bed, sleep first.
  // mc_navigate and mc_gather both auto-sleep; mc_combat did not, causing deadlocks:
  // Bot needs food -> mc_combat(cow) REFUSED at night -> no food -> starvation -> death.
  // If bot has a bed, sleeping skips night and allows safe passive mob hunting.
  // Bot1/Bot2 [2026-03-22]: starvation deadlock at night while holding a bed.
  // Extended to ALL targets (not just passive): sleeping skips the entire night,
  // avoiding nighttime mob density that causes combat to escalate into multi-mob fights.
  // Bot1/Bot2/Bot3: multiple deaths during nighttime hostile combat because additional
  // mobs spawned during the fight. Sleeping first eliminates the night mob density entirely.
  if (combatBot) {
    const preCombatTime = combatBot.time?.timeOfDay ?? 0;
    const preCombatIsNight = preCombatTime > 12541 || preCombatTime < 100;
    if (preCombatIsNight) {
      try {
        const sleepResult = await botManager.sleep(username);
        console.error(`[Combat] Pre-combat auto-sleep succeeded: ${sleepResult}`);
      } catch (sleepErr) {
        console.error(`[Combat] Pre-combat auto-sleep skipped: ${sleepErr instanceof Error ? sleepErr.message : String(sleepErr)}`);
      }
    }

    // Phantom insomnia auto-sleep: Phantoms spawn after 72000 ticks without sleeping.
    // mc_navigate and mc_gather both have this check, but mc_combat did not.
    // Bot1 [2026-03-22]: killed by Phantom during daytime — 3+ nights without sleep.
    // Combat can take 30-60s during which Phantoms dive-attack from above.
    if (!preCombatIsNight) {
      const combatWorldAge = combatBot.time?.age ?? 0;
      const combatLastSleep = lastSleepTick.get(username) ?? 0;
      const combatTicksSinceLastSleep = combatWorldAge - combatLastSleep;
      if (combatTicksSinceLastSleep > 60000 && combatWorldAge > 0) {
        console.error(`[Combat] Phantom insomnia high (${combatTicksSinceLastSleep} ticks). Attempting pre-combat sleep to reset timer.`);
        try {
          const sleepResult = await botManager.sleep(username);
          console.error(`[Combat] Phantom insomnia auto-sleep succeeded: ${sleepResult}`);
        } catch (sleepErr) {
          console.error(`[Combat] Phantom insomnia auto-sleep skipped: ${sleepErr instanceof Error ? sleepErr.message : String(sleepErr)}`);
        }
      }
    }
  }

  // Night passive hunt: log warning but don't block

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
        // Scan for nearby hostiles — BLOCK combat when hostile is close enough to attack
        // during the approach to the passive target. The fight() loop has an 8-block abort,
        // but the approach phase (pathfinding to the cow/pig/sheep) exposes the bot to mobs
        // that are 8-20 blocks away, which close in during the 10-30s approach.
        // Bot1 Session 16: died to zombie while fighting sheep.
        // Bot3 Deaths #1,#3,#5: killed by hostile mobs during passive mob hunts.
        // Bot2 [2026-03-23]: killed by zombie during navigate to cow.
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
          nearbyHostiles.sort((a, b) => a.dist - b.dist);
          const closestHostileDist = nearbyHostiles[0].dist;
          const threatList = nearbyHostiles
            .slice(0, 5)
            .map(h => `${h.name}(${h.dist}m)`)
            .join(", ");

          // BLOCK when hostile is close enough to be dangerous during passive hunt.
          // Armor-aware thresholds: unarmored bots take full damage from mobs.
          // Night: wider block radius (12 blocks) — mobs are dense, more spawn during approach.
          // Day: tighter (8 blocks) — fewer mobs, but still lethal when close.
          // Without food: widen by 4 blocks — any damage is permanent.
          const combatTime = combatBot.time?.timeOfDay ?? 0;
          const combatIsNight = combatTime > 12541 || combatTime < 100;
          const combatHasFood = combatBot.inventory.items().some((item: any) => EDIBLE_FOOD_NAMES.has(item.name));
          let combatArmorCount = 0;
          for (const slot of [5, 6, 7, 8]) {
            const item = combatBot.inventory.slots[slot];
            if (item) combatArmorCount++;
          }
          // Warning thresholds: distance at which to warn (not block) about hostiles.
          // CRITICAL FIX [2026-03-23]: Previous thresholds (8-16 blocks) were too aggressive
          // and made passive mob hunting nearly impossible. combat("cow") would get a WARNING,
          // fleeAtHp raised to 14, and fight() would flee instantly at HP < 14.
          // Reduced to match fight()'s new 5-block abort radius.
          // Night + no armor: 8 blocks
          // Night + armor: 6 blocks
          // Day: 5 blocks (matches fight() mid-combat hostile abort radius)
          let blockDist: number;
          if (combatIsNight) {
            blockDist = combatArmorCount <= 1 ? 8 : 6;
          } else {
            blockDist = 5;
          }

          if (closestHostileDist <= blockDist) {
            const timeNote = combatIsNight ? "at night" : "";
            const armorNote = combatArmorCount <= 1 ? " NO ARMOR —" : "";
            hostileWarning = `\n[WARNING] Cannot safely hunt ${target}: ${nearbyHostiles.length} hostile(s) nearby (${threatList}).${armorNote} ${timeNote} Hostile within ${closestHostileDist}m.\n[推奨アクション]\n1. bot.combat() — 最も近い敵を先に倒す（引数なし=最近接敵）\n2. bot.flee(20) — 敵から離れてから狩りを再開\n3. bot.equipArmor() — 防具を装備してから狩り`;
            // Raise fleeAtHp when hunting passive targets near hostiles.
            // CRITICAL FIX [2026-03-23]: Previous fleeAtHp=14 was too high — bots with HP 10-13
            // would flee instantly before landing any attack. A cow takes 2-3 sword hits (~2s).
            // Reduced to 10 (default) to allow the bot to finish the kill before fleeing.
            // fight() mid-combat hostile abort (5 blocks) provides safety if hostile gets close.
            //
            // EXCEPTION: food-desperate bots (no food + hunger <= 6). Cap fleeAtHp DOWN to 4.
            // At HP 1.8, the bot must fight — fleeing just delays starvation death.
            const isFoodDesperate = !combatHasFood && (combatBot!.food ?? 20) <= 6;
            if (isFoodDesperate) {
              fleeAtHp = Math.min(fleeAtHp, 4);
              console.error(`[Combat] Food-desperate: capped fleeAtHp DOWN to ${fleeAtHp} for passive hunt (hunger=${combatBot!.food}, no food, HP=${combatBot!.health?.toFixed(1)}).`);
            } else {
              fleeAtHp = Math.max(fleeAtHp, 10);
              console.error(`[Combat] Set fleeAtHp to ${fleeAtHp} for passive hunt near ${nearbyHostiles.length} hostile(s).`);
            }
          } else {
            hostileWarning = `\n[WARNING] ${nearbyHostiles.length} hostile(s) nearby while hunting ${target}: ${threatList}. Be cautious.`;
          }
        }
      }
    }
    const fightResult = await botManager.fight(username, target, fleeAtHp);
    return fightResult + hostileWarning + combatHpWarning;
  }

  // Attack nearest hostile
  const attackResult = await botManager.attack(username);
  return attackResult + combatHpWarning;
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
        await bot.look(yaw, 0);
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
  // Priority ordered by saturation value (higher = more efficient healing).
  // Must include ALL items from EDIBLE_FOOD_NAMES to prevent "no food" when food exists.
  // Bug: mc_eat was missing dried_kelp, beetroot_soup, suspicious_stew, enchanted_golden_apple,
  // glow_berries, chorus_fruit — agents would get "No food in inventory" despite having these items.
  const inventory = botManager.getInventory(username);
  const foodPriority = [
    "enchanted_golden_apple", "golden_carrot", "golden_apple",
    "cooked_beef", "cooked_porkchop", "cooked_mutton", "cooked_salmon",
    "cooked_chicken", "cooked_rabbit", "cooked_cod", "baked_potato",
    "bread", "pumpkin_pie", "mushroom_stew", "rabbit_stew", "beetroot_soup",
    "suspicious_stew", "apple", "melon_slice", "sweet_berries", "glow_berries",
    "carrot", "potato", "beetroot", "dried_kelp", "cookie",
    "beef", "porkchop", "mutton", "chicken", "rabbit", "cod", "salmon",
    "chorus_fruit", "rotten_flesh",
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

// Store last connection params for mc_reconnect
let _lastConnectArgs: { host: string; port: number; username: string; version?: string } | null = null;

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
  _lastConnectArgs = { host, port, username, version };

  return `Connected to ${host}:${port} as ${username}`;
}

// ─── mc_reconnect ────────────────────────────────────────────────────────────

export async function mc_reconnect(): Promise<string> {
  const params = _lastConnectArgs ||
    (process.env.BOT_USERNAME ? {
      host: process.env.MC_HOST || "localhost",
      port: parseInt(process.env.MC_PORT || "25565"),
      username: process.env.BOT_USERNAME,
    } : null);

  if (!params) {
    throw new Error("No previous connection info. Call mc_connect first.");
  }

  // Disconnect existing bot if connected
  try {
    const existing = botManager.getFirstBotUsername();
    if (existing) {
      await botManager.disconnect(existing);
    }
  } catch (_) { /* ignore if not connected */ }

  // Reconnect
  await botManager.connect(params);
  _lastConnectArgs = params;

  return `Reconnected to ${params.host}:${params.port} as ${params.username}`;
}

// ─── mc_flee ─────────────────────────────────────────────────────────────────

export async function mc_flee(distance: number = 20): Promise<string> {
  const username = botManager.requireSingleBot();
  const result = await botManager.flee(username, distance);

  // POST-FLEE AUTO-EAT: After fleeing, the bot is in a safer position.
  // If HP is low and food is available, eat immediately to start regeneration
  // before the agent decides on the next action. This closes the gap between
  // "fled to safety" and "agent calls bot.eat()".
  // Bot1/Bot2/Bot3 [2026-03-22]: many deaths where bot fled with food in inventory
  // but didn't eat. The agent then called wait/navigate which exposed the bot to
  // further attacks at low HP. Auto-eating after flee maximizes survival time.
  const fleeBot = botManager.getBot(username);
  if (fleeBot) {
    const fleeHp = fleeBot.health ?? 20;
    const fleeHunger = (fleeBot as any).food ?? 20;
    if (fleeHp < 16 || fleeHunger < 14) {
      const fleeFood = fleeBot.inventory.items().find((i: any) => EDIBLE_FOOD_NAMES.has(i.name));
      if (fleeFood) {
        try {
          await fleeBot.equip(fleeFood, "hand");
          await fleeBot.consume();
          console.error(`[Flee] Auto-ate ${fleeFood.name} after flee (HP: ${fleeHp.toFixed(1)} → ${(fleeBot.health ?? 0).toFixed(1)}, hunger: ${fleeHunger} → ${(fleeBot as any).food ?? "?"})`);
        } catch (_) {
          // Eat can fail if mob interrupted — not critical, agent can retry
        }
      }
    }
  }

  return result;
}

// ─── minecraft_pillar_up ─────────────────────────────────────────────────────

export async function minecraft_pillar_up(height: number = 1): Promise<string> {
  const username = botManager.requireSingleBot();
  return await botManager.pillarUp(username, height || 1);
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
  mc_combat, mc_eat, mc_store, mc_chat, mc_connect, mc_reconnect,
  mc_flee, minecraft_pillar_up, mc_smelt, mc_tunnel,
};
