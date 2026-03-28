/**
 * Core Tools - mc_status, mc_connect, mc_chat, mc_reconnect
 *
 * All complex wrapper functions (mc_gather, mc_craft, mc_combat, etc.) have been
 * removed. Agents now write mineflayer code directly in mc_execute.
 */

import { botManager } from "../bot-manager/index.js";
import { checkDangerNearby, isHostileMob, EDIBLE_FOOD_NAMES } from "../bot-manager/minecraft-utils.js";
import { setAgentType } from "../agent-state.js";
import { registry } from "../tool-handler-registry.js";
import { lastSleepTick } from "../bot-manager/bot-survival.js";

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
      warnings.push(`NIGHT DANGER: ${threats.length} hostile(s) nearby. Do NOT navigate or engage — flee or dig 1x1x2 shelter and wait for dawn.`);
    }
    // NO ARMOR warning: Bot1 Sessions 16-42, Bot2/Bot3 multiple deaths at night without armor.
    // Many bots navigate/gather/combat at night with empty armor slots, taking full damage from mobs.
    // Warn explicitly so the agent equips armor before any night action.
    if (armorItems.length <= 1) {
      warnings.push(`NO ARMOR: Only ${armorItems.length}/4 armor slots equipped. Mobs deal full damage without armor. Craft and equip armor (iron_helmet, iron_chestplate, iron_leggings, iron_boots) before any night activity.`);
    }
    if (hasBed) {
      warnings.push("You have a bed. Sleep NOW to skip night and reset phantom insomnia timer.");
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
    warnings.push(`STARVATION: Hunger=${food}, HP=${Math.round(health*10)/10}. Find food IMMEDIATELY. Do NOT pathfind long distances while starving with no food.`);
  }
  // Early starvation warning: hunger<=3 with no food is a pre-death state.
  if (food <= 3 && foodItems.length === 0 && health >= 10) {
    warnings.push(`NEAR-STARVATION: Hunger=${food}, no food in inventory. HP will start draining soon. Prioritize food BEFORE doing other tasks. Find and kill animals (cow/pig/chicken), check nearbyEntities first.`);
  }
  if (foodItems.length === 0 && food < 10) {
    warnings.push("NO FOOD in inventory. Hunger will deplete. Hunt animals or harvest crops before it's critical.");
  }
  // HP-no-regen warning: In Minecraft, HP only regenerates naturally when hunger >= 18.
  // At hunger 1-17, HP neither regens nor drains — waiting does nothing.
  if (health < 10 && food < 18 && food > 0) {
    const foodItem = foodItems.length > 0 ? foodItems[0] : null;
    if (foodItem) {
      warnings.push(`LOW HP (${Math.round(health*10)/10}/20) + Hunger=${food}<18: HP WILL NOT REGENERATE NATURALLY. Eat immediately to raise hunger above 18 for HP recovery.`);
    } else {
      warnings.push(`LOW HP (${Math.round(health*10)/10}/20) + Hunger=${food}<18 + NO FOOD: HP cannot regenerate. Get food immediately — hunger must be >= 18 for natural HP regen.`);
    }
  }
  // Underground warning: many deaths from being trapped underground where mobs are dense.
  if (pos.y < 60) {
    warnings.push(`UNDERGROUND: You are at Y=${Math.round(pos.y)} (below surface). Cave mobs are dense and escape is difficult. Return to surface before other actions.`);
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

// ─── Registry registration (for hot-reload) ─────────────────────────────────

registry.coreTools = {
  mc_status, mc_chat, mc_connect, mc_reconnect,
};
