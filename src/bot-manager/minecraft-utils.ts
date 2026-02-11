import type { Bot } from "mineflayer";

// ========== Dynamic Entity/Block Helpers ==========
// These use bot.registry for version-correct data instead of hardcoded lists

/** Check if entity is hostile using registry data */
export function isHostileMob(bot: Bot, entityName: string): boolean {
  if (!entityName) return false;
  const name = entityName.toLowerCase();
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
  // Common food items end with these suffixes or are known foods
  const foodPatterns = ["_beef", "_porkchop", "_mutton", "_chicken", "_rabbit",
    "_cod", "_salmon", "bread", "apple", "carrot", "potato", "beetroot",
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
  return block?.material?.includes("pickaxe") || false;
}

/** Check if block requires axe to mine */
export function requiresAxe(bot: Bot, blockName: string): boolean {
  const block = bot.registry.blocksByName[blockName];
  const mat = block?.material || "";
  return mat.includes("axe") && !mat.includes("pickaxe");
}

/** Check if block requires shovel to mine */
export function requiresShovel(bot: Bot, blockName: string): boolean {
  const block = bot.registry.blocksByName[blockName];
  return block?.material?.includes("shovel") || false;
}

/** Check if item can be used as fuel */
export function isFuelItem(itemName: string): boolean {
  // Fuel items: coal, charcoal, logs, planks, sticks, wooden tools, etc.
  const fuelPatterns = ["coal", "charcoal", "_log", "_planks", "_wood",
    "stick", "wooden_", "bamboo", "carpet", "wool", "banner",
    "scaffolding", "ladder", "fence", "boat", "bowl", "bookshelf"];
  return fuelPatterns.some(p => itemName.includes(p)) ||
         itemName === "blaze_rod" ||
         itemName === "dried_kelp_block" ||
         itemName === "lava_bucket";
}

/** Check if block is a bed */
export function isBedBlock(blockName: string): boolean {
  return blockName.includes("_bed");
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
