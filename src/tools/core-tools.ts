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
  return await getHighLevel().minecraft_gather_resources(username, [{ name: block, count }], maxDistance);
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

  if (count === 1) {
    // Use craft_chain for dependency resolution
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
    // For long distances, move in segments (from movement.ts logic)
    const pos = botManager.getPosition(username);
    if (pos) {
      const dx = args.x - pos.x;
      const dy = args.y - pos.y;
      const dz = args.z - pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist > 50) {
        const segmentSize = 30;
        const steps = Math.ceil(dist / segmentSize);
        let lastResult = "";
        for (let i = 1; i <= steps; i++) {
          const curPos = botManager.getPosition(username);
          if (!curPos) break;
          const rdx = args.x - curPos.x;
          const rdy = args.y - curPos.y;
          const rdz = args.z - curPos.z;
          const remainDist = Math.sqrt(rdx * rdx + rdy * rdy + rdz * rdz);
          if (remainDist < 3) break;
          const t = Math.min(segmentSize / remainDist, 1.0);
          const ix = curPos.x + rdx * t;
          const iz = curPos.z + rdz * t;
          const iy = remainDist <= segmentSize ? args.y : (curPos.y + rdy * t);
          lastResult = await botManager.moveTo(username, ix, iy, iz);
        }
        return lastResult || await botManager.moveTo(username, args.x, args.y, args.z);
      }
    }
    return await botManager.moveTo(username, args.x, args.y, args.z);
  }

  return "Provide coordinates (x, y, z), target_block, or target_entity";
}

// ─── mc_combat ───────────────────────────────────────────────────────────────

export async function mc_combat(
  target?: string,
  fleeAtHp: number = 4
): Promise<string> {
  const username = botManager.requireSingleBot();

  // Auto-equip best weapon
  try {
    await botManager.equipWeapon(username);
  } catch {
    // Continue without weapon
  }

  // Attack target
  if (target) {
    const result = await botManager.fight(username, target, fleeAtHp);
    // Wait briefly for drops to spawn, then collect
    await new Promise(r => setTimeout(r, 500));
    const collected = await botManager.collectNearbyItems(username);
    return collected ? `${result}\nCollected: ${collected}` : result;
  }

  // Attack nearest hostile
  const result = await botManager.attack(username);
  await new Promise(r => setTimeout(r, 500));
  const collected = await botManager.collectNearbyItems(username);
  return collected ? `${result}\nCollected: ${collected}` : result;
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
  action: "list" | "deposit" | "withdraw" | "deposit_all_except",
  itemName?: string,
  count?: number,
  chestX?: number,
  chestY?: number,
  chestZ?: number,
  keepItems?: string[]
): Promise<string> {
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
  return `Connected to ${host}:${port} as ${username}`;
}

// ─── Registry registration (for hot-reload) ─────────────────────────────────

registry.coreTools = {
  mc_status, mc_gather, mc_craft, mc_build, mc_navigate,
  mc_combat, mc_eat, mc_store, mc_chat, mc_connect,
};
