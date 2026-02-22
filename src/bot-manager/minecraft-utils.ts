import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";

// ========== Dynamic Entity/Block Helpers ==========
// These use bot.registry for version-correct data instead of hardcoded lists

/** Check if entity is hostile using registry data with fallback list */
export function isHostileMob(bot: Bot, entityName: string): boolean {
  if (!entityName) return false;
  const name = entityName.toLowerCase();

  // Fallback list of known hostile mobs (for registry inconsistencies)
  const knownHostileMobs = [
    "zombie", "skeleton", "creeper", "spider", "cave_spider", "enderman",
    "witch", "slime", "phantom", "drowned", "husk", "stray", "pillager",
    "vindicator", "ravager", "vex", "evoker", "guardian", "elder_guardian",
    "blaze", "ghast", "magma_cube", "wither_skeleton", "piglin_brute",
    "hoglin", "zoglin", "wither", "ender_dragon", "shulker", "silverfish",
    "endermite", "warden", "piglin"
  ];

  // Check fallback list first
  if (knownHostileMobs.includes(name)) {
    return true;
  }

  // Then check registry
  const entityInfo = bot.registry.entitiesByName[name];
  return entityInfo?.type === "hostile";
}

/** Check if entity is passive/animal using registry data */
export function isPassiveMob(bot: Bot, entityName: string): boolean {
  if (!entityName) return false;
  const name = entityName.toLowerCase();
  const entityInfo = bot.registry.entitiesByName[name];
  return entityInfo?.type === "passive" || entityInfo?.type === "animal";
}

/** Check if block is an ore */
export function isOreBlock(blockName: string): boolean {
  return blockName.includes("_ore");
}

/** Check if block is a log */
export function isLogBlock(blockName: string): boolean {
  return blockName.includes("_log");
}

/** Check if item is food (can be eaten) */
export function isFoodItem(bot: Bot, itemName: string): boolean {
  // Check if item has food property in registry
  const item = bot.registry.itemsByName[itemName];
  if (!item) return false;
  // Common food items - use patterns that match both with and without prefix
  const foodPatterns = ["beef", "porkchop", "mutton", "chicken", "rabbit",
    "cod", "salmon", "bread", "apple", "carrot", "potato", "beetroot",
    "melon_slice", "sweet_berries", "glow_berries", "cookie", "pie", "cake",
    "stew", "soup", "dried_kelp", "rotten_flesh", "spider_eye", "chorus_fruit"];
  return foodPatterns.some(p => itemName.includes(p)) ||
         itemName.startsWith("cooked_") ||
         itemName.startsWith("baked_") ||
         itemName === "golden_apple" ||
         itemName === "enchanted_golden_apple";
}

/** Check if block requires pickaxe to mine */
export function requiresPickaxe(bot: Bot, blockName: string): boolean {
  const block = bot.registry.blocksByName[blockName];
  if (!block || !block.harvestTools) return false;

  // Check if any pickaxe can harvest this block
  const pickaxeItems = ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe", "golden_pickaxe", "diamond_pickaxe", "netherite_pickaxe"];
  for (const pickaxeName of pickaxeItems) {
    const pickaxe = bot.registry.itemsByName[pickaxeName];
    if (pickaxe && block.harvestTools[pickaxe.id] !== undefined) {
      return true;
    }
  }
  return false;
}

/** Check if block requires axe to mine */
export function requiresAxe(bot: Bot, blockName: string): boolean {
  const block = bot.registry.blocksByName[blockName];
  if (!block || !block.harvestTools) return false;

  // Check if any axe can harvest this block
  const axeItems = ["wooden_axe", "stone_axe", "iron_axe", "golden_axe", "diamond_axe", "netherite_axe"];
  for (const axeName of axeItems) {
    const axe = bot.registry.itemsByName[axeName];
    if (axe && block.harvestTools[axe.id] !== undefined) {
      return true;
    }
  }
  return false;
}

/** Check if block requires shovel to mine */
export function requiresShovel(bot: Bot, blockName: string): boolean {
  const block = bot.registry.blocksByName[blockName];
  if (!block || !block.harvestTools) return false;

  // Check if any shovel can harvest this block
  const shovelItems = ["wooden_shovel", "stone_shovel", "iron_shovel", "golden_shovel", "diamond_shovel", "netherite_shovel"];
  for (const shovelName of shovelItems) {
    const shovel = bot.registry.itemsByName[shovelName];
    if (shovel && block.harvestTools[shovel.id] !== undefined) {
      return true;
    }
  }
  return false;
}

/** Check if item can be used as fuel */
export function isFuelItem(itemName: string): boolean {
  // Fuel items: coal, charcoal, logs, planks, sticks, wooden tools, etc.
  const fuelPatterns = ["coal", "charcoal", "_log", "_planks", "_wood",
    "stick", "wooden_", "bamboo", "carpet", "wool", "banner",
    "scaffolding", "ladder", "fence", "boat", "bowl", "bookshelf"];
  // Note: blaze_rod is technically fuel but too valuable (needed for Phase 6 ender eyes)
  // so it is excluded from auto-fuel selection
  return fuelPatterns.some(p => itemName.includes(p)) ||
         itemName === "dried_kelp_block" ||
         itemName === "lava_bucket";
}

/** Check if block is a bed */
export function isBedBlock(blockName: string): boolean {
  return blockName.includes("_bed");
}

/** Check for nearby hostile mobs and recommend action */
export function checkDangerNearby(bot: Bot, dangerRadius: number = 8): {
  dangerous: boolean;
  nearestHostile: { name: string; distance: number } | null;
  hostileCount: number;
  recommendation: "flee" | "fight" | "safe";
} {
  const hostiles = Object.values(bot.entities)
    .filter(e => e && e !== bot.entity && isHostileMob(bot, e.name?.toLowerCase() || ""))
    .map(e => ({
      name: e.name || "unknown",
      distance: e.position.distanceTo(bot.entity.position),
    }))
    .filter(h => h.distance <= dangerRadius)
    .sort((a, b) => a.distance - b.distance);

  if (hostiles.length === 0) {
    return { dangerous: false, nearestHostile: null, hostileCount: 0, recommendation: "safe" };
  }

  const nearest = hostiles[0];
  // Creepers: always flee (explosion danger)
  const hasCreeper = hostiles.some(h => h.name === "creeper");
  // 3+ hostiles: flee to avoid being overwhelmed
  const recommendation: "flee" | "fight" = (hasCreeper || hostiles.length >= 3) ? "flee" : "fight";

  return {
    dangerous: true,
    nearestHostile: nearest,
    hostileCount: hostiles.length,
    recommendation,
  };
}

/** Check if there is solid ground below a position */
export function checkGroundBelow(bot: Bot, x: number, y: number, z: number, maxFallCheck: number = 4): {
  safe: boolean;
  fallDistance: number;
} {
  for (let dy = 1; dy <= maxFallCheck; dy++) {
    const block = bot.blockAt(new Vec3(Math.floor(x), Math.floor(y) - dy, Math.floor(z)));
    if (block && block.name !== "air" && block.name !== "cave_air" && block.name !== "void_air") {
      // Fall distance of 3 or less = no damage
      return { safe: dy <= 3, fallDistance: dy - 1 };
    }
  }
  return { safe: false, fallDistance: maxFallCheck };
}

/** Check if block is solid and can be used as scaffold */
export function isScaffoldBlock(bot: Bot, blockName: string): boolean {
  const blockInfo = bot.registry.blocksByName[blockName];
  if (!blockInfo) return false;
  if (blockInfo.boundingBox !== "block") return false;
  // Exclude valuable/special blocks
  const exclude = ["_ore", "spawner", "bedrock", "obsidian", "portal",
    "diamond_block", "emerald_block", "gold_block", "iron_block", "netherite_block",
    "ancient_debris", "crying_obsidian", "reinforced_deepslate"];
  return !exclude.some(p => blockName.includes(p));
}

/** Check if a pickaxe can harvest a block (using harvestTools from registry) */
export function canPickaxeHarvest(bot: Bot, blockName: string, pickaxeName: string): boolean {
  const block = bot.registry.blocksByName[blockName];
  if (!block || !block.harvestTools) return true; // No tool requirement

  const pickaxe = bot.registry.itemsByName[pickaxeName];
  if (!pickaxe) return false;

  return block.harvestTools[pickaxe.id] === true;
}

/** Get the minimum pickaxe tier required for a block */
export function getRequiredPickaxeTier(bot: Bot, blockName: string): string | null {
  const block = bot.registry.blocksByName[blockName];
  if (!block || !block.harvestTools) return null;

  // Check from lowest to highest tier
  const tiers = ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe", "golden_pickaxe", "diamond_pickaxe", "netherite_pickaxe"];
  for (const tier of tiers) {
    const item = bot.registry.itemsByName[tier];
    if (item && block.harvestTools[item.id]) {
      return tier;
    }
  }
  return "diamond_pickaxe"; // Default to highest if not found
}
