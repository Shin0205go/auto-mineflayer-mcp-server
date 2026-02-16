import { Vec3 } from "vec3";
import pkg from "mineflayer-pathfinder";
const { goals } = pkg;
import type { ManagedBot } from "./types.js";
import { isFuelItem } from "./minecraft-utils.js";

// Mamba向けの簡潔ステータスを付加するか（デフォルトはfalse=Claude向け）
const APPEND_BRIEF_STATUS = process.env.APPEND_BRIEF_STATUS === "true";

/**
 * Get brief status for appending to responses (Mamba mode only)
 */
function getBriefStatus(managed: ManagedBot): string {
  if (!APPEND_BRIEF_STATUS) return "";

  const bot = managed.bot;
  const pos = bot.entity.position;
  const hp = bot.health?.toFixed(1) ?? "?";
  const food = bot.food ?? "?";
  const x = Math.floor(pos.x);
  const y = Math.floor(pos.y);
  const z = Math.floor(pos.z);

  const getBlock = (dx: number, dy: number, dz: number) => {
    const block = bot.blockAt(new Vec3(x + dx, y + dy, z + dz));
    return block?.name || "unknown";
  };

  // Check walkable directions
  const dirs = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  const walkable: string[] = [];
  const blocked: string[] = [];

  for (const [dir, [dx, dz]] of Object.entries(dirs)) {
    const feet = getBlock(dx, 0, dz);
    const head = getBlock(dx, 1, dz);
    const ground = getBlock(dx, -1, dz);
    const canWalk = (feet === "air" || feet === "water") && (head === "air" || head === "water");
    const hasGround = ground !== "air" && ground !== "water";

    if (canWalk && hasGround) {
      walkable.push(dir);
    } else {
      blocked.push(dir);
    }
  }

  return ` [HP:${hp}/20 Food:${food}/20 Pos:(${x},${y},${z}) Walk:${walkable.join(",") || "none"} Blocked:${blocked.join(",") || "none"}]`;
}

/**
 * List all craftable items by category
 */
export async function listAllRecipes(_managed: ManagedBot, category?: string): Promise<string> {
  // Define useful recipes by category
  const recipes: Record<string, { name: string; ingredients: string }[]> = {
    tools: [
      { name: "wooden_pickaxe", ingredients: "3 planks + 2 sticks" },
      { name: "stone_pickaxe", ingredients: "3 cobblestone + 2 sticks" },
      { name: "iron_pickaxe", ingredients: "3 iron_ingot + 2 sticks" },
      { name: "diamond_pickaxe", ingredients: "3 diamond + 2 sticks" },
      { name: "wooden_axe", ingredients: "3 planks + 2 sticks" },
      { name: "stone_axe", ingredients: "3 cobblestone + 2 sticks" },
      { name: "iron_axe", ingredients: "3 iron_ingot + 2 sticks" },
      { name: "wooden_shovel", ingredients: "1 plank + 2 sticks" },
      { name: "stone_shovel", ingredients: "1 cobblestone + 2 sticks" },
      { name: "iron_shovel", ingredients: "1 iron_ingot + 2 sticks" },
    ],
    weapons: [
      { name: "wooden_sword", ingredients: "2 planks + 1 stick" },
      { name: "stone_sword", ingredients: "2 cobblestone + 1 stick" },
      { name: "iron_sword", ingredients: "2 iron_ingot + 1 stick" },
      { name: "diamond_sword", ingredients: "2 diamond + 1 stick" },
      { name: "bow", ingredients: "3 sticks + 3 string" },
      { name: "arrow", ingredients: "1 flint + 1 stick + 1 feather" },
      { name: "shield", ingredients: "6 planks + 1 iron_ingot" },
    ],
    armor: [
      { name: "leather_helmet", ingredients: "5 leather" },
      { name: "leather_chestplate", ingredients: "8 leather" },
      { name: "leather_leggings", ingredients: "7 leather" },
      { name: "leather_boots", ingredients: "4 leather" },
      { name: "iron_helmet", ingredients: "5 iron_ingot" },
      { name: "iron_chestplate", ingredients: "8 iron_ingot" },
      { name: "iron_leggings", ingredients: "7 iron_ingot" },
      { name: "iron_boots", ingredients: "4 iron_ingot" },
    ],
    basics: [
      { name: "crafting_table", ingredients: "4 planks (no table needed)" },
      { name: "stick", ingredients: "2 planks (no table needed)" },
      { name: "planks", ingredients: "1 log (no table needed)" },
      { name: "chest", ingredients: "8 planks" },
      { name: "furnace", ingredients: "8 cobblestone" },
      { name: "torch", ingredients: "1 coal + 1 stick" },
      { name: "white_bed", ingredients: "3 white_wool + 3 planks" },
      { name: "bucket", ingredients: "3 iron_ingot" },
      { name: "flint_and_steel", ingredients: "1 iron_ingot + 1 flint (no table needed)" },
      { name: "paper", ingredients: "3 sugar_cane" },
      { name: "book", ingredients: "3 paper + 1 leather" },
      { name: "bookshelf", ingredients: "6 planks + 3 books" },
      { name: "enchanting_table", ingredients: "2 diamond + 4 obsidian + 1 book" },
    ],
    nether: [
      { name: "ender_eye", ingredients: "1 ender_pearl + 1 blaze_powder (no table needed)" },
      { name: "blaze_powder", ingredients: "1 blaze_rod (no table needed)" },
    ],
    food: [
      { name: "bread", ingredients: "3 wheat" },
      { name: "cake", ingredients: "3 milk + 2 sugar + 1 egg + 3 wheat" },
      { name: "golden_apple", ingredients: "8 gold_ingot + 1 apple" },
    ],
    building: [
      { name: "stone_bricks", ingredients: "4 stone" },
      { name: "ladder", ingredients: "7 sticks" },
      { name: "fence", ingredients: "4 planks + 2 sticks" },
      { name: "door", ingredients: "6 planks" },
      { name: "trapdoor", ingredients: "6 planks" },
      { name: "glass_pane", ingredients: "6 glass" },
    ],
  };

  if (category && recipes[category]) {
    const list = recipes[category]
      .map(r => `- ${r.name}: ${r.ingredients}`)
      .join("\n");
    return `## ${category.toUpperCase()} Recipes\n${list}`;
  }

  // Return all categories summary
  let result = "## All Craftable Items\n\n";
  for (const [cat, items] of Object.entries(recipes)) {
    result += `### ${cat.toUpperCase()}\n`;
    result += items.map(r => `- ${r.name}: ${r.ingredients}`).join("\n");
    result += "\n\n";
  }
  return result;
}

/**
 * List items that can be crafted with current inventory
 */
export async function listCraftableNow(managed: ManagedBot): Promise<string> {
  const bot = managed.bot;
  const minecraftData = await import("minecraft-data");
  const mcData = minecraftData.default(bot.version);

  // Get current inventory
  const inventory: Record<string, number> = {};
  for (const item of bot.inventory.items()) {
    inventory[item.name] = (inventory[item.name] || 0) + item.count;
  }

  // Check for crafting table nearby or in inventory
  const craftingTableId = mcData.blocksByName.crafting_table?.id;
  const hasCraftingTable = !!bot.findBlock({
    matching: craftingTableId,
    maxDistance: 4,
  });

  // Define recipes with requirements
  const allRecipes = [
    { name: "planks", needs: { oak_log: 1 }, noTable: true, output: 4, alt: ["birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"] },
    { name: "stick", needs: { oak_planks: 2 }, noTable: true, output: 4, alt: ["birch_planks", "spruce_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"] },
    { name: "crafting_table", needs: { oak_planks: 4 }, noTable: true, alt: ["birch_planks", "spruce_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"] },
    { name: "chest", needs: { oak_planks: 8 }, alt: ["birch_planks", "spruce_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"] },
    { name: "furnace", needs: { cobblestone: 8 } },
    { name: "torch", needs: { coal: 1, stick: 1 }, output: 4 },
    { name: "wooden_pickaxe", needs: { oak_planks: 3, stick: 2 }, alt: ["birch_planks", "spruce_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"] },
    { name: "stone_pickaxe", needs: { cobblestone: 3, stick: 2 } },
    { name: "iron_pickaxe", needs: { iron_ingot: 3, stick: 2 } },
    { name: "diamond_pickaxe", needs: { diamond: 3, stick: 2 } },
    { name: "wooden_sword", needs: { oak_planks: 2, stick: 1 }, alt: ["birch_planks", "spruce_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"] },
    { name: "stone_sword", needs: { cobblestone: 2, stick: 1 } },
    { name: "iron_sword", needs: { iron_ingot: 2, stick: 1 } },
    { name: "wooden_axe", needs: { oak_planks: 3, stick: 2 }, alt: ["birch_planks", "spruce_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"] },
    { name: "stone_axe", needs: { cobblestone: 3, stick: 2 } },
    { name: "iron_axe", needs: { iron_ingot: 3, stick: 2 } },
    { name: "bucket", needs: { iron_ingot: 3 } },
    { name: "shield", needs: { oak_planks: 6, iron_ingot: 1 }, alt: ["birch_planks", "spruce_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"] },
    { name: "white_bed", needs: { oak_planks: 3, white_wool: 3 }, alt: ["birch_planks", "spruce_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"] },
    { name: "bread", needs: { wheat: 3 } },
    { name: "iron_helmet", needs: { iron_ingot: 5 } },
    { name: "iron_chestplate", needs: { iron_ingot: 8 } },
    { name: "iron_leggings", needs: { iron_ingot: 7 } },
    { name: "iron_boots", needs: { iron_ingot: 4 } },
    { name: "flint_and_steel", needs: { iron_ingot: 1, flint: 1 }, noTable: true },
    { name: "arrow", needs: { flint: 1, stick: 1, feather: 1 }, output: 4 },
    { name: "bone_meal", needs: { bone: 1 }, noTable: true, output: 3 },
    { name: "ender_eye", needs: { ender_pearl: 1, blaze_powder: 1 }, noTable: true },
    { name: "blaze_powder", needs: { blaze_rod: 1 }, noTable: true, output: 2 },
    { name: "paper", needs: { sugar_cane: 3 }, output: 3 },
    { name: "book", needs: { paper: 3, leather: 1 } },
    { name: "bookshelf", needs: { oak_planks: 6, book: 3 }, alt: ["birch_planks", "spruce_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"] },
    { name: "enchanting_table", needs: { diamond: 2, obsidian: 4, book: 1 } },
    { name: "diamond_sword", needs: { diamond: 2, stick: 1 } },
    { name: "diamond_axe", needs: { diamond: 3, stick: 2 } },
    { name: "golden_pickaxe", needs: { gold_ingot: 3, stick: 2 } },
  ];

  const craftable: string[] = [];
  const almostCraftable: { name: string; missing: string }[] = [];

  for (const recipe of allRecipes) {
    // Skip if requires crafting table and none nearby
    if (!recipe.noTable && !hasCraftingTable) continue;

    let canCraft = true;
    const missingItems: string[] = [];

    for (const [item, count] of Object.entries(recipe.needs)) {
      let have = inventory[item] || 0;

      // Check alternative items (e.g., different wood types)
      if (have < count && recipe.alt) {
        for (const altItem of recipe.alt) {
          const altName = item.replace("oak_", "").replace("birch_", "").replace("spruce_", "");
          const checkItem = altItem.includes(altName) ? altItem : item.replace("oak_", altItem.split("_")[0] + "_");
          have += inventory[checkItem] || 0;
        }
      }

      if (have < count) {
        canCraft = false;
        missingItems.push(`${item} (need ${count}, have ${have})`);
      }
    }

    // Check if player has at least one required item in inventory
    const hasAnyIngredient = Object.entries(recipe.needs).some(([item, _count]) => {
      let have = inventory[item] || 0;
      if (have === 0 && recipe.alt) {
        for (const altItem of recipe.alt) {
          const altName = item.replace("oak_", "").replace("birch_", "").replace("spruce_", "");
          const checkItem = altItem.includes(altName) ? altItem : item.replace("oak_", altItem.split("_")[0] + "_");
          have += inventory[checkItem] || 0;
        }
      }
      return have > 0;
    });

    if (canCraft) {
      craftable.push(recipe.name + (recipe.output ? ` (makes ${recipe.output})` : ""));
    } else if (missingItems.length === 1 && hasAnyIngredient) {
      almostCraftable.push({ name: recipe.name, missing: missingItems[0] });
    }
  }

  let result = `## Inventory: ${Object.entries(inventory).map(([k, v]) => `${k}(${v})`).join(", ") || "empty"}\n`;
  result += `## Crafting Table: ${hasCraftingTable ? "nearby" : "NOT nearby"}\n\n`;

  if (craftable.length > 0) {
    result += `### Can Craft NOW:\n${craftable.map(c => `- ${c}`).join("\n")}\n\n`;
  } else {
    result += "### Can Craft NOW: Nothing\n\n";
  }

  if (almostCraftable.length > 0) {
    result += `### Almost Craftable (1 item missing):\n`;
    result += almostCraftable.map(a => `- ${a.name}: missing ${a.missing}`).join("\n");
  }

  return result;
}

/**
 * Craft an item
 */
export async function craftItem(managed: ManagedBot, itemName: string, count: number = 1): Promise<string> {
  const bot = managed.bot;

  // Check if bot is still connected
  if (!bot || !bot.entity) {
    throw new Error("Bot is not connected to the server. Please reconnect.");
  }

  // Dynamic import of minecraft-data
  const minecraftData = await import("minecraft-data");
  const mcData = minecraftData.default(bot.version);

  // Show what's in inventory for debugging
  const inventoryItems = bot.inventory.items();
  const inventory = inventoryItems.map(i => `${i.name}(${i.count})`).join(", ") || "empty";

  const item = mcData.itemsByName[itemName];
  if (!item) {
    // Try to find similar items
    const similar = Object.keys(mcData.itemsByName)
      .filter(name => name.includes(itemName) || itemName.includes(name))
      .slice(0, 5);
    throw new Error(`Unknown item: ${itemName}. Similar: ${similar.join(", ")}. Inventory: ${inventory}`);
  }

  // Get recipes - try with and without crafting table
  const craftingTableId = mcData.blocksByName.crafting_table?.id;

  // List of items that can be crafted in 2x2 grid (player inventory) and should NOT use crafting table
  // This avoids bugs with crafting table window item retrieval
  const simpleRecipes = [
    "stick", "planks", "oak_planks", "spruce_planks", "birch_planks", "jungle_planks",
    "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks",
    "crafting_table", "torch",
  ];

  const isSimpleRecipe = simpleRecipes.includes(itemName) || itemName.endsWith("_planks");

  // First check nearby (5 blocks) - but skip for simple recipes
  // Using 5 blocks to be more forgiving of bot positioning
  let craftingTable: ReturnType<typeof bot.findBlock> = null;
  if (!isSimpleRecipe) {
    craftingTable = bot.findBlock({
      matching: craftingTableId,
      maxDistance: 5,
    });
  }

  // If not nearby, search wider and move to it (but skip for simple recipes)
  if (!isSimpleRecipe && !craftingTable) {
    const farTable = bot.findBlock({
      matching: craftingTableId,
      maxDistance: 32,
    });

    if (farTable) {
      console.error(`[Craft] Found crafting table at ${farTable.position}, moving...`);
      const goal = new goals.GoalNear(farTable.position.x, farTable.position.y, farTable.position.z, 3);
      bot.pathfinder.setGoal(goal);

      // Wait for movement
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          bot.pathfinder.setGoal(null);
          resolve();
        }, 10000);

        const check = setInterval(() => {
          const dist = bot.entity.position.distanceTo(farTable.position);
          if (dist < 4 || !bot.pathfinder.isMoving()) {
            clearInterval(check);
            clearTimeout(timeout);
            bot.pathfinder.setGoal(null);
            resolve();
          }
        }, 300);
      });

      // Re-check nearby - use maxDistance 5 to account for pathfinding settling at goal distance 3
      // This prevents false negatives when bot stops at ~3.5 blocks from table
      craftingTable = bot.findBlock({
        matching: craftingTableId,
        maxDistance: 5,
      });
    }
  }

  // Special handling for planks -> stick/crafting_table/wooden_tools to avoid wood type issues
  // Re-enabled: the general crafting path fails with "no_table" for sticks because
  // isSimpleRecipe=true skips crafting table search, but recipesAll returns 0 recipes
  // without handling plank type substitution properly
  const simpleWoodenRecipes: string[] = ["stick", "crafting_table"];
  if (simpleWoodenRecipes.includes(itemName)) {
    // Find the plank type with the highest count in inventory
    const planksByType = new Map<string, number>();
    let bestPlank: typeof inventoryItems[0] | undefined;
    let bestPlankCount = 0;
    for (const i of inventoryItems) {
      if (i.name.endsWith("_planks")) {
        const total = (planksByType.get(i.name) || 0) + i.count;
        planksByType.set(i.name, total);
        if (total > bestPlankCount) {
          bestPlankCount = total;
          bestPlank = i;
        }
      }
    }
    const anyPlanks = bestPlank;
    if (!anyPlanks) {
      throw new Error(`Cannot craft ${itemName}: Need any type of planks. Craft planks from logs first. Inventory: ${inventory}`);
    }

    // Check if we have enough planks and sticks for wooden tools
    const totalPlanks = inventoryItems
      .filter(i => i.name.endsWith("_planks"))
      .reduce((sum, item) => sum + item.count, 0);

    const stickItem = inventoryItems.find(i => i.name === "stick");
    const totalSticks = stickItem ? stickItem.count : 0;

    // Define required materials for each wooden tool
    const requirements: Record<string, {planks: number, sticks: number}> = {
      "stick": {planks: 2, sticks: 0},
      "crafting_table": {planks: 4, sticks: 0},
      "wooden_pickaxe": {planks: 3, sticks: 2},
      "wooden_axe": {planks: 3, sticks: 2},
      "wooden_sword": {planks: 2, sticks: 1},
      "wooden_shovel": {planks: 1, sticks: 2},
      "wooden_hoe": {planks: 2, sticks: 2},
    };

    const required = requirements[itemName];
    if (!required) {
      throw new Error(`Unknown wooden tool: ${itemName}`);
    }

    if (totalPlanks < required.planks) {
      throw new Error(`Cannot craft ${itemName}: Need ${required.planks} planks, have ${totalPlanks}. Craft more planks from logs first. Inventory: ${inventory}`);
    }

    if (totalSticks < required.sticks) {
      throw new Error(`Cannot craft ${itemName}: Need ${required.sticks} sticks, have ${totalSticks}. Craft sticks from planks first (2 planks → 4 sticks). Inventory: ${inventory}`);
    }

    // Get the specific item ID for the planks we have
    const planksItemId = mcData.itemsByName[anyPlanks.name]?.id;
    if (!planksItemId) {
      throw new Error(`Cannot find item ID for ${anyPlanks.name}`);
    }

    // Try to get recipes in multiple ways:
    // 1. Without crafting table (2x2 grid) - preferred for stick and crafting_table
    // 2. With crafting table if available (3x3 grid) - but NEVER for stick or crafting_table

    let allRecipes = bot.recipesAll(item.id, null, null);
    let craftingTableBlock = null;
    console.error(`[Craft] recipesAll(${item.id}, null, null) returned ${allRecipes.length} recipes`);

    // FIX: ALWAYS use manual recipe for stick/crafting_table
    // recipesAll() often returns broken recipes for these items (Mineflayer version bug)
    // Manual recipe is more reliable than filtering broken recipesAll results
    if (itemName === "stick" || itemName === "crafting_table") {
      console.error(`[Craft] No recipes found with recipesAll, using manual crafting...`);

      // Manual crafting for stick: 2 planks → 4 sticks
      if (itemName === "stick") {
        // Find planks with the HIGHEST count to avoid picking a plank type we don't have enough of
        const allPlanks = inventoryItems.filter(i => i.name.endsWith("_planks"));
        const availablePlanks = allPlanks.sort((a, b) => b.count - a.count)[0];
        if (!availablePlanks || availablePlanks.count < 2) {
          throw new Error(`Cannot craft stick: Need 2 planks, have ${availablePlanks?.count || 0}. Inventory: ${inventory}`);
        }

        // Get the specific planks item from mcData
        const planksItem = mcData.itemsByName[availablePlanks.name];
        if (!planksItem) {
          throw new Error(`Cannot find item data for ${availablePlanks.name}`);
        }

        // Create manual recipe: 2 planks in vertical pattern → 4 sticks
        // Pattern: planks at (0,0) and (0,1) in 2x2 grid
        const manualRecipe = {
          result: { id: item.id, count: 4 },
          inShape: [[planksItem.id], [planksItem.id]],
          ingredients: [planksItem.id, planksItem.id],
          delta: [
            { id: item.id, count: 4 },
            { id: planksItem.id, count: -2 }
          ],
          requiresTable: false
        };

        console.error(`[Craft] Manual recipe created for stick using ${availablePlanks.name}`);
        allRecipes = [manualRecipe as any];
      }

      // Manual crafting for crafting_table: 4 planks → 1 crafting_table
      if (itemName === "crafting_table") {
        // Find planks with the HIGHEST count to avoid picking a plank type we don't have enough of
        const allPlanks = inventoryItems.filter(i => i.name.endsWith("_planks"));
        const availablePlanks = allPlanks.sort((a, b) => b.count - a.count)[0];
        if (!availablePlanks || availablePlanks.count < 4) {
          throw new Error(`Cannot craft crafting_table: Need 4 planks, have ${availablePlanks?.count || 0}. Inventory: ${inventory}`);
        }

        const planksItem = mcData.itemsByName[availablePlanks.name];
        if (!planksItem) {
          throw new Error(`Cannot find item data for ${availablePlanks.name}`);
        }

        // Create manual recipe: 4 planks in 2x2 grid → 1 crafting_table
        const manualRecipe = {
          result: { id: item.id, count: 1 },
          inShape: [[planksItem.id, planksItem.id], [planksItem.id, planksItem.id]],
          ingredients: [planksItem.id, planksItem.id, planksItem.id, planksItem.id],
          delta: [
            { id: item.id, count: 1 },
            { id: planksItem.id, count: -4 }
          ],
          requiresTable: false
        };

        console.error(`[Craft] Manual recipe created for crafting_table using ${availablePlanks.name}`);
        allRecipes = [manualRecipe as any];
      }
    }

    // IMPORTANT: stick and crafting_table should NEVER use a crafting table (they're 2x2 recipes)
    // If no recipes found and it's NOT stick/crafting_table, try with crafting table
    if (allRecipes.length === 0 && itemName !== "stick" && itemName !== "crafting_table") {
      const craftingTableId = mcData.blocksByName.crafting_table?.id;
      craftingTableBlock = bot.findBlock({
        matching: craftingTableId,
        maxDistance: 5,
      });

      if (craftingTableBlock) {
        allRecipes = bot.recipesAll(item.id, null, craftingTableBlock);
        console.error(`[Craft] recipesAll with crafting table returned ${allRecipes.length} recipes`);
      } else {
        console.error(`[Craft] No crafting table found within 5 blocks`);
      }
    }

    // Manual recipe fallback for common items when recipesAll returns nothing
    // Manual recipe fallback for Phase 6+ items
    const shapelessRecipes: Record<string, { inputs: Record<string, number>; outputCount: number; requiresTable: boolean }> = {
      "flint_and_steel": { inputs: { iron_ingot: 1, flint: 1 }, outputCount: 1, requiresTable: false },
      "ender_eye": { inputs: { ender_pearl: 1, blaze_powder: 1 }, outputCount: 1, requiresTable: false },
      "blaze_powder": { inputs: { blaze_rod: 1 }, outputCount: 2, requiresTable: false },
      "paper": { inputs: { sugar_cane: 3 }, outputCount: 3, requiresTable: true },
      "book": { inputs: { paper: 3, leather: 1 }, outputCount: 1, requiresTable: true },
      "arrow": { inputs: { flint: 1, stick: 1, feather: 1 }, outputCount: 4, requiresTable: true },
    };

    if (shapelessRecipes[itemName]) {
      const recipe = shapelessRecipes[itemName];
      console.error(`[Craft] Using manual shapeless recipe for ${itemName} (bypassing potentially broken recipesAll)...`);

      const ingredientIds: number[] = [];
      const delta: { id: number; count: number }[] = [{ id: item.id, count: recipe.outputCount }];

      for (const [ingredientName, count] of Object.entries(recipe.inputs)) {
        const ingredientItem = mcData.itemsByName[ingredientName];
        if (!ingredientItem) throw new Error(`Cannot find item data for ${ingredientName}`);
        const have = inventoryItems.filter(i => i.name === ingredientName).reduce((s, i) => s + i.count, 0);
        if (have < count) throw new Error(`Cannot craft ${itemName}: Need ${count} ${ingredientName}, have ${have}`);
        for (let j = 0; j < count; j++) ingredientIds.push(ingredientItem.id);
        delta.push({ id: ingredientItem.id, count: -count });
      }

      const manualRecipe = {
        result: { id: item.id, count: recipe.outputCount },
        inShape: [ingredientIds],
        ingredients: ingredientIds,
        delta,
        requiresTable: recipe.requiresTable
      };
      allRecipes = [manualRecipe as any];
    }

    if (itemName === "bread" || itemName === "bone_meal" || itemName === "shield") {
      console.error(`[Craft] Using manual recipe for ${itemName} (bypassing potentially broken recipesAll)...`);

      if (itemName === "bread") {
        const wheatItem = mcData.itemsByName["wheat"];
        if (!wheatItem) throw new Error("Cannot find wheat item data");
        const wheatInv = inventoryItems.filter(i => i.name === "wheat").reduce((s, i) => s + i.count, 0);
        if (wheatInv < 3) throw new Error(`Cannot craft bread: Need 3 wheat, have ${wheatInv}`);

        const manualRecipe = {
          result: { id: item.id, count: 1 },
          inShape: [[wheatItem.id, wheatItem.id, wheatItem.id]],
          ingredients: [wheatItem.id, wheatItem.id, wheatItem.id],
          delta: [
            { id: item.id, count: 1 },
            { id: wheatItem.id, count: -3 }
          ],
          requiresTable: true
        };
        allRecipes = [manualRecipe as any];
      }

      if (itemName === "bone_meal") {
        const boneItem = mcData.itemsByName["bone"];
        if (!boneItem) throw new Error("Cannot find bone item data");
        const boneInv = inventoryItems.filter(i => i.name === "bone").reduce((s, i) => s + i.count, 0);
        if (boneInv < 1) throw new Error(`Cannot craft bone_meal: Need 1 bone, have ${boneInv}`);

        const manualRecipe = {
          result: { id: item.id, count: 3 },
          inShape: [[boneItem.id]],
          ingredients: [boneItem.id],
          delta: [
            { id: item.id, count: 3 },
            { id: boneItem.id, count: -1 }
          ],
          requiresTable: false
        };
        allRecipes = [manualRecipe as any];
      }

      if (itemName === "shield") {
        const ironItem = mcData.itemsByName["iron_ingot"];
        if (!ironItem) throw new Error("Cannot find iron_ingot item data");
        const ironInv = inventoryItems.filter(i => i.name === "iron_ingot").reduce((s, i) => s + i.count, 0);
        if (ironInv < 1) throw new Error(`Cannot craft shield: Need 1 iron_ingot, have ${ironInv}`);
        // Find any planks
        const plankItem = inventoryItems.find(i => i.name.endsWith("_planks"));
        if (!plankItem) throw new Error("Cannot craft shield: Need 6 planks");
        const plankMcData = mcData.itemsByName[plankItem.name];
        if (!plankMcData) throw new Error(`Cannot find item data for ${plankItem.name}`);
        const plankInv = inventoryItems.filter(i => i.name === plankItem.name).reduce((s, i) => s + i.count, 0);
        if (plankInv < 6) throw new Error(`Cannot craft shield: Need 6 planks, have ${plankInv}`);

        const P = plankMcData.id;
        const I = ironItem.id;
        const manualRecipe = {
          result: { id: item.id, count: 1 },
          inShape: [[P, I, P], [P, P, P], [0, P, 0]],
          ingredients: [P, I, P, P, P, P, P],
          delta: [
            { id: item.id, count: 1 },
            { id: plankMcData.id, count: -6 },
            { id: ironItem.id, count: -1 }
          ],
          requiresTable: true
        };
        allRecipes = [manualRecipe as any];
      }
    }

    // Manual recipe for tools - always prefer manual over broken recipesAll (Mineflayer version bug)
    // Pattern: material + stick in standard tool shapes
    if (allRecipes.length === 0) {
      const toolRecipes: Record<string, { material: string; shape: number[][]; sticks: number; materialCount: number }> = {
        // Pickaxes: 3 material on top, 2 sticks below center
        "stone_pickaxe": { material: "cobblestone", shape: [[1,1,1],[0,2,0],[0,2,0]], sticks: 2, materialCount: 3 },
        "iron_pickaxe": { material: "iron_ingot", shape: [[1,1,1],[0,2,0],[0,2,0]], sticks: 2, materialCount: 3 },
        "golden_pickaxe": { material: "gold_ingot", shape: [[1,1,1],[0,2,0],[0,2,0]], sticks: 2, materialCount: 3 },
        "diamond_pickaxe": { material: "diamond", shape: [[1,1,1],[0,2,0],[0,2,0]], sticks: 2, materialCount: 3 },
        // Axes: 2 material top-left + 1 mid-left, 2 sticks right
        "stone_axe": { material: "cobblestone", shape: [[1,1],[1,2],[0,2]], sticks: 2, materialCount: 3 },
        "iron_axe": { material: "iron_ingot", shape: [[1,1],[1,2],[0,2]], sticks: 2, materialCount: 3 },
        "diamond_axe": { material: "diamond", shape: [[1,1],[1,2],[0,2]], sticks: 2, materialCount: 3 },
        // Swords: 2 material top, 1 stick bottom
        "stone_sword": { material: "cobblestone", shape: [[1],[1],[2]], sticks: 1, materialCount: 2 },
        "iron_sword": { material: "iron_ingot", shape: [[1],[1],[2]], sticks: 1, materialCount: 2 },
        "diamond_sword": { material: "diamond", shape: [[1],[1],[2]], sticks: 1, materialCount: 2 },
        // Shovels: 1 material top, 2 sticks below
        "stone_shovel": { material: "cobblestone", shape: [[1],[2],[2]], sticks: 2, materialCount: 1 },
        "iron_shovel": { material: "iron_ingot", shape: [[1],[2],[2]], sticks: 2, materialCount: 1 },
        "diamond_shovel": { material: "diamond", shape: [[1],[2],[2]], sticks: 2, materialCount: 1 },
        // Hoes: 2 material top, 2 sticks below
        "stone_hoe": { material: "cobblestone", shape: [[1,1],[0,2],[0,2]], sticks: 2, materialCount: 2 },
        "iron_hoe": { material: "iron_ingot", shape: [[1,1],[0,2],[0,2]], sticks: 2, materialCount: 2 },
        "diamond_hoe": { material: "diamond", shape: [[1,1],[0,2],[0,2]], sticks: 2, materialCount: 2 },
        // Furnace
        "furnace": { material: "cobblestone", shape: [[1,1,1],[1,0,1],[1,1,1]], sticks: 0, materialCount: 8 },
      };

      const toolRecipe = toolRecipes[itemName];
      if (toolRecipe) {
        // Find material (check compatible substitutes too)
        let materialName = toolRecipe.material;
        let materialItem = mcData.itemsByName[materialName];
        const materialInv = inventoryItems.filter(i => i.name === materialName).reduce((s, i) => s + i.count, 0);

        // Check cobbled_deepslate as substitute for cobblestone
        if (materialInv < toolRecipe.materialCount && materialName === "cobblestone") {
          const deepslateInv = inventoryItems.filter(i => i.name === "cobbled_deepslate").reduce((s, i) => s + i.count, 0);
          if (deepslateInv >= toolRecipe.materialCount) {
            materialName = "cobbled_deepslate";
            materialItem = mcData.itemsByName[materialName];
          }
        }

        const finalMaterialInv = inventoryItems.filter(i => i.name === materialName).reduce((s, i) => s + i.count, 0);
        if (!materialItem) throw new Error(`Cannot find item data for ${materialName}`);
        if (finalMaterialInv < toolRecipe.materialCount) throw new Error(`Cannot craft ${itemName}: Need ${toolRecipe.materialCount} ${materialName}, have ${finalMaterialInv}`);

        const stickItem = mcData.itemsByName["stick"];
        if (toolRecipe.sticks > 0) {
          const stickInv = inventoryItems.filter(i => i.name === "stick").reduce((s, i) => s + i.count, 0);
          if (stickInv < toolRecipe.sticks) throw new Error(`Cannot craft ${itemName}: Need ${toolRecipe.sticks} stick, have ${stickInv}`);
        }

        // Build inShape from pattern (1=material, 2=stick, 0=empty)
        const inShape = toolRecipe.shape.map(row =>
          row.map(cell => cell === 1 ? materialItem!.id : cell === 2 ? stickItem!.id : 0)
        );
        const ingredients = inShape.flat().filter(id => id !== 0);

        const delta: Array<{ id: number; count: number }> = [
          { id: item.id, count: 1 },
          { id: materialItem.id, count: -toolRecipe.materialCount },
        ];
        if (toolRecipe.sticks > 0 && stickItem) {
          delta.push({ id: stickItem.id, count: -toolRecipe.sticks });
        }

        const manualRecipe = {
          result: { id: item.id, count: 1 },
          inShape,
          ingredients,
          delta,
          requiresTable: true
        };

        console.error(`[Craft] Manual recipe created for ${itemName} using ${materialName}`);
        allRecipes = [manualRecipe as any];
      }
    }

    // If we have exactly 1 recipe (manual recipe from above), use it directly.
    // The planks/sticks filter below is only needed when recipesAll() returns
    // multiple native recipes and we need to pick the right one for our plank type.
    let compatibleRecipe: any;
    if (allRecipes.length === 1) {
      compatibleRecipe = allRecipes[0];
      console.error(`[Craft] Using single recipe directly for ${itemName}`);
    } else {
      // For wooden tools, ANY planks work. Just find ANY recipe that uses planks + sticks.
      compatibleRecipe = allRecipes.find(recipe => {
        const delta = recipe.delta as Array<{ id: number; count: number }>;

        let needsPlanks = false;
        let needsSticks = false;
        let planksCount = 0;
        let sticksCount = 0;

        for (const d of delta) {
          if (d.count >= 0) continue;
          const ingredientItem = mcData.items[d.id];
          if (!ingredientItem) continue;
          if (ingredientItem.name.endsWith("_planks")) {
            needsPlanks = true;
            planksCount = Math.abs(d.count);
          } else if (ingredientItem.name === "stick") {
            needsSticks = true;
            sticksCount = Math.abs(d.count);
          }
        }

        const hasEnoughPlanks = planksCount === 0 || totalPlanks >= planksCount;
        const hasEnoughSticks = sticksCount === 0 || totalSticks >= sticksCount;
        return (needsPlanks || needsSticks) && hasEnoughPlanks && hasEnoughSticks;
      });
    }

    if (!compatibleRecipe) {
      throw new Error(`Cannot craft ${itemName}: No compatible recipe found. Have ${totalPlanks} planks and ${totalSticks} sticks. Found ${allRecipes.length} recipes total. This may be a Minecraft version compatibility issue.`);
    }

    // CRITICAL FIX: Mineflayer's bot.craft() does STRICT ID matching.
    // If recipe requires oak_planks but we have birch_planks, it fails with "missing ingredient".
    // We must replace the plank IDs in the recipe with the planks we actually have.
    const ourPlanksItem = mcData.itemsByName[anyPlanks.name];
    if (ourPlanksItem) {
      const delta = compatibleRecipe.delta as Array<{ id: number; count: number }>;
      const recipePlanksId = delta.find(d => {
        if (d.count >= 0) return false;
        const ing = mcData.items[d.id];
        return ing?.name.endsWith("_planks");
      })?.id;

      if (recipePlanksId && recipePlanksId !== ourPlanksItem.id) {
        console.error(`[Craft] Recipe uses plank ID ${recipePlanksId}, but we have ${anyPlanks.name} (ID ${ourPlanksItem.id}). Substituting...`);
        // Replace plank IDs in delta
        for (const d of delta) {
          if (d.id === recipePlanksId) d.id = ourPlanksItem.id;
        }
        // Replace in inShape if present
        if ((compatibleRecipe as any).inShape) {
          const shape = (compatibleRecipe as any).inShape as number[][];
          for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
              if (shape[row][col] === recipePlanksId) shape[row][col] = ourPlanksItem.id;
            }
          }
        }
        // Replace in ingredients if present
        if ((compatibleRecipe as any).ingredients) {
          const ingredients = (compatibleRecipe as any).ingredients as number[];
          for (let i = 0; i < ingredients.length; i++) {
            if (ingredients[i] === recipePlanksId) ingredients[i] = ourPlanksItem.id;
          }
        }
      }
    }

    console.error(`[Craft] Attempting to craft ${itemName} using ${anyPlanks.name} (have ${totalPlanks} planks)`);
    console.error(`[Craft] Compatible recipe found: ${JSON.stringify({
      requiresTable: compatibleRecipe.requiresTable,
      delta: compatibleRecipe.delta,
      craftingTableBlock: craftingTableBlock ? 'present' : 'null'
    })}`);

    try {
      for (let i = 0; i < count; i++) {
        // Pass crafting table if recipe requires it
        // IMPORTANT: For stick/crafting_table, always pass undefined (never use table)
        const tableToUse = (itemName === "stick" || itemName === "crafting_table") ? undefined : (craftingTableBlock || undefined);
        console.error(`[Craft] Calling bot.craft() with table: ${tableToUse ? 'YES' : 'NO'}`);

        const invBeforeSimple = bot.inventory.items().map(it => `${it.name}x${it.count}`).join(", ");
        console.error(`[Craft] Inventory before simple wooden craft: ${invBeforeSimple}`);

        try {
          await bot.craft(compatibleRecipe, 1, tableToUse);
        } catch (craftErr: any) {
          // Fallback: If bot.craft() fails with manual recipe, try recipesFor as alternative
          const craftErrMsg = craftErr.message || String(craftErr);
          console.error(`[Craft] bot.craft() failed: ${craftErrMsg}, trying recipesFor fallback...`);

          if (craftErrMsg.includes("missing ingredient") && (itemName === "stick" || itemName === "crafting_table")) {
            // Try recipesFor with specific planks item as metadata
            const planksInInv = bot.inventory.items().filter(inv => inv.name.endsWith("_planks"));
            let fallbackWorked = false;

            for (const planksStack of planksInInv) {
              try {
                const recipesFor = bot.recipesFor(item.id, planksStack.type, 1, null);
                console.error(`[Craft] recipesFor(${item.id}, ${planksStack.type}, 1, null) returned ${recipesFor.length} recipes`);
                if (recipesFor.length > 0) {
                  await bot.craft(recipesFor[0], 1, undefined);
                  fallbackWorked = true;
                  break;
                }
              } catch (e2) {
                console.error(`[Craft] recipesFor fallback with ${planksStack.name} failed: ${e2}`);
              }
            }

            if (!fallbackWorked) {
              // Final fallback: window-based crafting using clickWindow
              console.error(`[Craft] recipesFor fallback failed, trying window-based crafting...`);
              try {
                const planksForWindow = bot.inventory.items().filter(inv => inv.name.endsWith("_planks")).sort((a, b) => b.count - a.count)[0];
                if (planksForWindow) {
                  // Open player inventory window
                  const invWindow = await (bot as any).openInventoryWindow?.() || bot.inventory;
                  if (invWindow) {
                    // Player inventory 2x2 crafting grid: slots 1,2,3,4 (result=0)
                    // For stick: place planks in slot 1 (top-left) and slot 3 (bottom-left)
                    // For crafting_table: place planks in slots 1,2,3,4
                    const planksSlot = planksForWindow.slot;

                    if (itemName === "stick") {
                      // Click planks to pick up, then place 1 in slot 1
                      await bot.clickWindow(planksSlot, 0, 0); // pick up planks stack
                      await new Promise(r => setTimeout(r, 100));
                      await bot.clickWindow(1, 1, 0); // right-click to place 1 in slot 1
                      await new Promise(r => setTimeout(r, 100));
                      await bot.clickWindow(3, 1, 0); // right-click to place 1 in slot 3
                      await new Promise(r => setTimeout(r, 100));
                      // Put remaining planks back
                      await bot.clickWindow(planksSlot, 0, 0);
                      await new Promise(r => setTimeout(r, 100));
                      // Pick up result (4 sticks from slot 0)
                      await bot.clickWindow(0, 0, 0);
                      await new Promise(r => setTimeout(r, 100));
                      // Put sticks in inventory
                      const emptySlot = Array.from({length: 36}, (_, i) => i + 9).find(s => !invWindow.slots[s]);
                      if (emptySlot !== undefined) {
                        await bot.clickWindow(emptySlot, 0, 0);
                      }
                      await new Promise(r => setTimeout(r, 200));
                    } else if (itemName === "crafting_table") {
                      // Click planks to pick up, then place 1 in each of slots 1,2,3,4
                      await bot.clickWindow(planksSlot, 0, 0);
                      await new Promise(r => setTimeout(r, 100));
                      for (const slot of [1, 2, 3, 4]) {
                        await bot.clickWindow(slot, 1, 0); // right-click = place 1
                        await new Promise(r => setTimeout(r, 100));
                      }
                      // Put remaining planks back
                      await bot.clickWindow(planksSlot, 0, 0);
                      await new Promise(r => setTimeout(r, 100));
                      // Pick up result
                      await bot.clickWindow(0, 0, 0);
                      await new Promise(r => setTimeout(r, 100));
                      const emptySlot2 = Array.from({length: 36}, (_, i) => i + 9).find(s => !invWindow.slots[s]);
                      if (emptySlot2 !== undefined) {
                        await bot.clickWindow(emptySlot2, 0, 0);
                      }
                      await new Promise(r => setTimeout(r, 200));
                    }

                    // Close inventory window
                    if (invWindow !== bot.inventory && typeof (invWindow as any).close === 'function') {
                      (invWindow as any).close();
                    }

                    // Check if crafting succeeded
                    const stickCount = bot.inventory.items().filter(inv => inv.name === itemName).reduce((s, inv) => s + inv.count, 0);
                    if (stickCount > 0) {
                      fallbackWorked = true;
                      console.error(`[Craft] Window-based crafting succeeded! ${itemName} count: ${stickCount}`);
                    }
                  }
                }
              } catch (windowErr) {
                console.error(`[Craft] Window-based crafting failed: ${windowErr}`);
              }

              if (!fallbackWorked) {
                console.error(`[Craft] All craft attempts failed, throwing original error`);
                throw craftErr;
              }
            }
          } else {
            throw craftErr;
          }
        }

        // Wait for crafting to complete (match timing from general crafting path)
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Close any lingering crafting window to flush items to inventory
        if (bot.currentWindow) {
          bot.closeWindow(bot.currentWindow);
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Additional wait for inventory synchronization
        await new Promise(resolve => setTimeout(resolve, 700));

        const invAfterSimple = bot.inventory.items().map(it => `${it.name}x${it.count}`).join(", ");
        console.error(`[Craft] Inventory after simple wooden craft: ${invAfterSimple}`);

        // Verify crafted item is in inventory
        const craftedCheck = bot.inventory.items().find(it => it.name === itemName);
        if (!craftedCheck) {
          console.error(`[Craft] WARNING: ${itemName} not in inventory after simple wooden craft, trying to collect dropped items...`);
          // Try to collect dropped items nearby
          const { collectNearbyItems } = await import("./bot-items.js");
          try {
            await collectNearbyItems(managed);
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (collectErr) {
            console.error(`[Craft] collectNearbyItems failed: ${collectErr}`);
          }

          const recheck = bot.inventory.items().find(it => it.name === itemName);
          if (!recheck) {
            throw new Error(`Failed to craft ${itemName}: Item not in inventory after crafting. Materials were consumed but item vanished. Try again.`);
          }
        }
      }

      const newInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
      return `Crafted ${count}x ${itemName}. Inventory: ${newInventory}` + getBriefStatus(managed);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      // If crafting failed due to ingredient mismatch, suggest crafting more planks
      if (errMsg.includes("missing ingredient")) {
        throw new Error(`Failed to craft ${itemName} from ${anyPlanks.name}: ${errMsg}. Try crafting planks from logs first, or this may be a Minecraft version compatibility issue. Inventory: ${inventory}`);
      }

      throw new Error(`Failed to craft ${itemName}: ${errMsg}. Inventory: ${inventory}`);
    }
  }

  // Always use recipesAll to get all possible recipes for this item
  // recipesFor sometimes misses valid recipes due to ingredient matching issues
  // First try without crafting table (player inventory 2x2 grid)
  let recipes = bot.recipesAll(item.id, null, null);

  // Check if any recipes can be done without crafting table
  const canCraftInInventory = recipes.length > 0;

  console.error(`[Craft] ${itemName}: found ${recipes.length} 2x2 recipes, craftingTable=${!!craftingTable}`);

  // If we can craft in inventory, prefer that to avoid crafting table bugs
  if (canCraftInInventory) {
    craftingTable = null;
    console.error(`[Craft] Using player inventory (2x2) for ${itemName} - avoiding crafting table`);
  } else if (craftingTable) {
    // Only use crafting table if we must (no 2x2 recipes available)
    recipes = bot.recipesAll(item.id, null, craftingTable);
    console.error(`[Craft] Using crafting table (3x3) for ${itemName}, found ${recipes.length} recipes`);
  } else {
    console.error(`[Craft] No 2x2 recipes and no crafting table found for ${itemName}`);
  }

  // Manual recipe fallback for armor and other shaped items when recipesAll returns 0
  // These require a crafting table (3x3 grid). Shape uses 1=material, 0=empty.
  if (recipes.length === 0) {
    const armorRecipes: Record<string, { material: string; shape: number[][]; materialCount: number }> = {
      "iron_helmet":      { material: "iron_ingot", shape: [[1,1,1],[1,0,1]],             materialCount: 5 },
      "iron_chestplate":  { material: "iron_ingot", shape: [[1,0,1],[1,1,1],[1,1,1]],     materialCount: 8 },
      "iron_leggings":   { material: "iron_ingot", shape: [[1,1,1],[1,0,1],[1,0,1]],     materialCount: 7 },
      "iron_boots":       { material: "iron_ingot", shape: [[1,0,1],[1,0,1]],             materialCount: 4 },
      "diamond_helmet":   { material: "diamond",    shape: [[1,1,1],[1,0,1]],             materialCount: 5 },
      "diamond_chestplate":{ material: "diamond",   shape: [[1,0,1],[1,1,1],[1,1,1]],     materialCount: 8 },
      "diamond_leggings": { material: "diamond",    shape: [[1,1,1],[1,0,1],[1,0,1]],     materialCount: 7 },
      "diamond_boots":    { material: "diamond",    shape: [[1,0,1],[1,0,1]],             materialCount: 4 },
    };

    const armorRecipe = armorRecipes[itemName];
    if (armorRecipe) {
      const materialItem = mcData.itemsByName[armorRecipe.material];
      if (materialItem) {
        const materialInv = inventoryItems.filter(i => i.name === armorRecipe.material).reduce((s, i) => s + i.count, 0);
        if (materialInv >= armorRecipe.materialCount) {
          // Need a crafting table for armor (3x3 recipes)
          if (!craftingTable) {
            const craftingTableId = mcData.blocksByName.crafting_table?.id;
            craftingTable = bot.findBlock({ matching: craftingTableId, maxDistance: 32 });
            if (craftingTable) {
              // Move to crafting table
              const goal = new goals.GoalNear(craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, 3);
              bot.pathfinder.setGoal(goal);
              await new Promise<void>((resolve) => {
                const timeout = setTimeout(() => { bot.pathfinder.setGoal(null); resolve(); }, 10000);
                const check = setInterval(() => {
                  if (craftingTable && bot.entity.position.distanceTo(craftingTable.position) < 4 || !bot.pathfinder.isMoving()) {
                    clearInterval(check); clearTimeout(timeout); bot.pathfinder.setGoal(null); resolve();
                  }
                }, 300);
              });
            }
          }

          if (!craftingTable) {
            throw new Error(`${itemName} requires a crafting_table nearby. Place one first. Inventory: ${inventory}`);
          }

          const inShape = armorRecipe.shape.map(row =>
            row.map(cell => cell === 1 ? materialItem.id : 0)
          );
          const ingredients = inShape.flat().filter(id => id !== 0);

          const manualRecipe = {
            result: { id: item.id, count: 1 },
            inShape,
            ingredients,
            delta: [
              { id: item.id, count: 1 },
              { id: materialItem.id, count: -armorRecipe.materialCount },
            ],
            requiresTable: true,
          };

          console.error(`[Craft] Manual armor recipe created for ${itemName} using ${armorRecipe.material}`);
          recipes = [manualRecipe as any];
        }
      }
    }
  }

  // Helper function to check if we have a compatible item
  // Returns a virtual item with the total count of all compatible items
  const findCompatibleItem = (ingredientName: string) => {
    // First try exact match - but sum up ALL stacks of the same item
    const exactMatches = inventoryItems.filter(i => i.name === ingredientName);
    if (exactMatches.length > 0) {
      const totalCount = exactMatches.reduce((sum, item) => sum + item.count, 0);
      // Return a virtual item representing the total count
      return { name: ingredientName, count: totalCount };
    }

    // Try compatible substitutions for common materials
    const compatibleMaterials: Record<string, string[]> = {
      // Any planks can substitute for any other planks
      "oak_planks": ["spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
      "spruce_planks": ["oak_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
      "birch_planks": ["oak_planks", "spruce_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
      "jungle_planks": ["oak_planks", "spruce_planks", "birch_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
      "acacia_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
      "dark_oak_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
      "mangrove_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "cherry_planks", "pale_oak_planks"],
      "cherry_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "pale_oak_planks"],
      "pale_oak_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks"],
      // Any logs can substitute for any other logs
      "oak_log": ["spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
      "spruce_log": ["oak_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
      "birch_log": ["oak_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
      "jungle_log": ["oak_log", "spruce_log", "birch_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
      "acacia_log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "dark_oak_log", "mangrove_log", "cherry_log"],
      "dark_oak_log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "mangrove_log", "cherry_log"],
      "mangrove_log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "cherry_log"],
      "cherry_log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log"],
      // Cobblestone and cobbled_deepslate are interchangeable for most recipes
      "cobblestone": ["cobbled_deepslate"],
      "cobbled_deepslate": ["cobblestone"],
      // Coal and charcoal are interchangeable for torch and other recipes
      "coal": ["charcoal"],
      "charcoal": ["coal"],
    };

    // Check if we have any compatible substitute
    const compatibles = compatibleMaterials[ingredientName] || [];
    for (const compatible of compatibles) {
      const compatibleMatches = inventoryItems.filter(i => i.name === compatible);
      if (compatibleMatches.length > 0) {
        const totalCount = compatibleMatches.reduce((sum, item) => sum + item.count, 0);
        // Return a virtual item representing the total count of the compatible item
        return { name: compatible, count: totalCount };
      }
    }

    // Also check reverse compatibility (e.g., if looking for cobbled_deepslate, check if cobblestone lists it as compatible)
    for (const [materialName, compatibleList] of Object.entries(compatibleMaterials)) {
      if (compatibleList.includes(ingredientName)) {
        const reverseMatches = inventoryItems.filter(i => i.name === materialName);
        if (reverseMatches.length > 0) {
          const totalCount = reverseMatches.reduce((sum, item) => sum + item.count, 0);
          return { name: materialName, count: totalCount };
        }
      }
    }

    return null;
  };

  // Filter recipes to only those we can actually craft with current inventory
  // Check both exact matches AND compatible substitutes
  const craftableRecipes = recipes.filter(recipe => {
    const delta = recipe.delta as Array<{ id: number; count: number }>;
    return delta.every(d => {
      if (d.count >= 0) return true; // Output items, always ok

      const ingredientItem = mcData.items[d.id];
      const ingredientName = ingredientItem?.name;
      if (!ingredientName) return false;

      const requiredCount = Math.abs(d.count);

      // First check if we have the EXACT item required by this recipe
      const exactMatches = inventoryItems.filter(i => i.name === ingredientName);
      const exactCount = exactMatches.reduce((sum, item) => sum + item.count, 0);

      if (exactCount >= requiredCount) {
        return true; // We have enough of the exact item
      }

      // If not enough exact matches, check for compatible substitutes
      const compatibleItem = findCompatibleItem(ingredientName);
      if (compatibleItem && compatibleItem.count >= requiredCount) {
        return true; // We have enough of a compatible substitute
      }

      return false;
    });
  });

  // CRITICAL FIX: Sort recipes to prioritize those using EXACT ingredients we have
  // Mineflayer's bot.craft() does strict ID matching and won't substitute materials
  // So recipes requiring items we don't have (like pale_oak_planks) will fail even if we have substitutes
  craftableRecipes.sort((a, b) => {
    const deltaA = a.delta as Array<{ id: number; count: number }>;
    const deltaB = b.delta as Array<{ id: number; count: number }>;

    // Count how many ingredients are EXACT matches vs substitutes
    let exactMatchesA = 0;
    let exactMatchesB = 0;

    for (const d of deltaA) {
      if (d.count >= 0) continue;
      const ingredientItem = mcData.items[d.id];
      const ingredientName = ingredientItem?.name;
      if (!ingredientName) continue;

      const exactMatches = inventoryItems.filter(i => i.name === ingredientName);
      if (exactMatches.length > 0) exactMatchesA++;
    }

    for (const d of deltaB) {
      if (d.count >= 0) continue;
      const ingredientItem = mcData.items[d.id];
      const ingredientName = ingredientItem?.name;
      if (!ingredientName) continue;

      const exactMatches = inventoryItems.filter(i => i.name === ingredientName);
      if (exactMatches.length > 0) exactMatchesB++;
    }

    // Prefer recipes with more exact matches (fewer substitutes needed)
    return exactMatchesB - exactMatchesA;
  });

  if (craftableRecipes.length === 0) {
    // Try to get all recipes for this item (even if we can't craft them)
    let allRecipes = bot.recipesAll(item.id, null, null);
    if (craftingTable) {
      const allRecipes3x3 = bot.recipesAll(item.id, null, craftingTable);
      if (allRecipes3x3.length > allRecipes.length) {
        allRecipes = allRecipes3x3;
      }
    }

    // First, check if we need a crafting table before checking ingredients
    // Skip this check if we're trying to craft a crafting table itself
    if (!craftingTable && itemName !== "crafting_table" && allRecipes.length > 0) {
      // Check if any of the available recipes require a crafting table
      const needsTable = allRecipes.some(r => r.requiresTable);
      if (needsTable) {
        throw new Error(`${itemName} requires a crafting_table nearby. Place one first, then craft. Inventory: ${inventory}`);
      }
    }

    if (allRecipes.length > 0) {
      // Analyze what's missing for the first recipe
      const recipe = allRecipes[0] as { delta: Array<{ id: number; count: number }>; requiresTable?: boolean };
      const needed: string[] = [];
      const missing: string[] = [];

      for (const d of recipe.delta) {
        if (d.count < 0) {
          const ingredientItem = mcData.items[d.id];
          const ingredientName = ingredientItem?.name || `id:${d.id}`;
          const requiredCount = Math.abs(d.count);

          // Check if we have enough (including compatible items)
          const compatible = findCompatibleItem(ingredientName);
          const haveCount = compatible?.count || 0;

          // For display purposes, show what ingredient we actually need
          // If we have a compatible item, show that we can use it
          // Special case for cobblestone/cobbled_deepslate - show cobblestone as primary
          if (ingredientName === "cobbled_deepslate" && findCompatibleItem("cobblestone")) {
            needed.push(`cobblestone x${requiredCount} (or cobbled_deepslate)`);
          } else if (compatible && compatible.name !== ingredientName) {
            needed.push(`${ingredientName} x${requiredCount} (or ${compatible.name})`);
          } else {
            needed.push(`${ingredientName} x${requiredCount}`);
          }

          if (haveCount < requiredCount) {
            const availableText = compatible ? `${compatible.name}(${haveCount})` : "none";
            // Check if there are compatible alternatives we could use
            // Define compatibleMaterials here since it's not in scope
            const compatibleMaterials: Record<string, string[]> = {
              // Any planks can substitute for any other planks
              "oak_planks": ["spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
              "spruce_planks": ["oak_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
              "birch_planks": ["oak_planks", "spruce_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
              "jungle_planks": ["oak_planks", "spruce_planks", "birch_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
              "acacia_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
              "dark_oak_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
              "mangrove_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "cherry_planks", "pale_oak_planks"],
              "cherry_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "pale_oak_planks"],
              "pale_oak_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks"],
              // Any logs can substitute for any other logs
              "oak_log": ["spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
              "spruce_log": ["oak_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
              "birch_log": ["oak_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
              "jungle_log": ["oak_log", "spruce_log", "birch_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
              "acacia_log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "dark_oak_log", "mangrove_log", "cherry_log"],
              "dark_oak_log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "mangrove_log", "cherry_log"],
              "mangrove_log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "cherry_log"],
              "cherry_log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log"],
              // Cobblestone and cobbled_deepslate are interchangeable for most recipes
              "cobblestone": ["cobbled_deepslate"],
              "cobbled_deepslate": ["cobblestone"],
              // Coal and charcoal are interchangeable for torch and other recipes
              "coal": ["charcoal"],
              "charcoal": ["coal"],
            };
            const compatibles = compatibleMaterials[ingredientName] || [];
            let foundAlternative = false;

            for (const alt of compatibles) {
              const altItem = inventoryItems.find(i => i.name === alt);
              if (altItem && altItem.count >= requiredCount) {
                // We have enough of a compatible item
                foundAlternative = true;
                break;
              }
            }

            if (!foundAlternative) {
              // Special handling for cobblestone/cobbled_deepslate
              if (ingredientName === "cobbled_deepslate" && compatibles.includes("cobblestone")) {
                // Check cobblestone availability
                const cobblestoneItem = inventoryItems.filter(i => i.name === "cobblestone");
                const cobblestoneCount = cobblestoneItem.reduce((sum, item) => sum + item.count, 0);
                if (cobblestoneCount > 0) {
                  missing.push(`cobblestone (need ${requiredCount}, have ${cobblestoneCount})`);
                } else {
                  missing.push(`cobblestone or cobbled_deepslate (need ${requiredCount}, have none)`);
                }
              } else if (compatibles.length > 0) {
                missing.push(`${ingredientName} (need ${requiredCount}, have ${availableText}, can also use: ${compatibles.slice(0, 3).join(", ")})`);
              } else {
                missing.push(`${ingredientName} (need ${requiredCount}, have ${availableText})`);
              }
            }
          }
        }
      }

      // Build helpful error message
      let errorMsg = `Cannot craft ${itemName}.`;
      errorMsg += ` Need: ${needed.join(" + ")}.`;
      if (missing.length > 0) {
        errorMsg += ` Missing: ${missing.join(", ")}.`;
      }

      // Check if crafting table is needed
      if (recipe.requiresTable && !craftingTable) {
        errorMsg += ` Also need crafting_table nearby.`;
      }

      // Add crafting chain hints for common tools
      const craftingHints: Record<string, string> = {
        "wooden_pickaxe": "Craft order: log → planks (4) → stick (from 2 planks) → wooden_pickaxe",
        "wooden_axe": "Craft order: log → planks (4) → stick (from 2 planks) → wooden_axe",
        "wooden_sword": "Craft order: log → planks (4) → stick (from 2 planks) → wooden_sword",
        "wooden_shovel": "Craft order: log → planks (4) → stick (from 2 planks) → wooden_shovel",
        "stone_pickaxe": "Need: cobblestone x3 + stick x2. Mine stone with wooden_pickaxe first.",
        "crafting_table": "Craft order: log → planks (4) → crafting_table",
        "stick": "Craft from 2 planks (any wood type gives 4 sticks)",
        "oak_planks": "Craft from 1 oak_log (gives 4 planks)",
        "spruce_planks": "Craft from 1 spruce_log (gives 4 planks)",
        "birch_planks": "Craft from 1 birch_log (gives 4 planks)",
        "jungle_planks": "Craft from 1 jungle_log (gives 4 planks)",
        "acacia_planks": "Craft from 1 acacia_log (gives 4 planks)",
        "dark_oak_planks": "Craft from 1 dark_oak_log (gives 4 planks)",
      };

      if (craftingHints[itemName]) {
        errorMsg += ` Hint: ${craftingHints[itemName]}`;
      }

      errorMsg += ` Have: ${inventory}`;
      throw new Error(errorMsg);
    }

    // No recipes at all - might need crafting table
    let errorMsg = `No recipe found for ${itemName}.`;

    // Special handling for items that commonly require crafting table
    const requiresTableItems = ["stone_pickaxe", "stone_axe", "stone_shovel", "stone_sword", "stone_hoe",
                                 "iron_pickaxe", "iron_axe", "iron_shovel", "iron_sword", "iron_hoe",
                                 "golden_pickaxe", "golden_axe", "golden_shovel", "golden_sword", "golden_hoe",
                                 "diamond_pickaxe", "diamond_axe", "diamond_shovel", "diamond_sword", "diamond_hoe",
                                 "netherite_pickaxe", "netherite_axe", "netherite_shovel", "netherite_sword", "netherite_hoe"];

    if (!craftingTable && requiresTableItems.includes(itemName)) {
      errorMsg = `${itemName} requires a crafting_table. Place one nearby first.`;
    } else if (!craftingTable) {
      errorMsg += ` Try placing a crafting_table nearby for advanced recipes.`;
    }
    errorMsg += ` Inventory: ${inventory}`;
    throw new Error(errorMsg);
  }

  // Use the first craftable recipe
  const recipe = craftableRecipes[0];

  if (recipe.requiresTable && !craftingTable) {
    throw new Error(`${itemName} requires a crafting table nearby (within 4 blocks). Inventory: ${inventory}`);
  }

  try {
    // Before crafting, ensure we have the exact items needed
    // Sometimes the bot needs specific item types even if we have compatible ones
    // This is a workaround for mineflayer's strict recipe matching
    for (let i = 0; i < count; i++) {
      // Try each craftable recipe in order until one succeeds
      let crafted = false;
      let lastError = null;

      for (const tryRecipe of craftableRecipes) {
        try {
          // CRITICAL FIX: Substitute recipe ingredient IDs with items we actually have
          // Mineflayer's bot.craft() does strict ID matching - if recipe requires oak_planks
          // but we have birch_planks, it fails with "missing ingredient" even though they're compatible.
          const recipeDelta = tryRecipe.delta as Array<{ id: number; count: number }>;
          for (const d of recipeDelta) {
            if (d.count >= 0) continue; // Skip output items
            const ingredientItem = mcData.items[d.id];
            if (!ingredientItem) continue;

            // Check if we have this exact ingredient
            const exactMatch = inventoryItems.find(i => i.name === ingredientItem.name);
            if (exactMatch) continue; // We have it, no substitution needed

            // We don't have the exact ingredient - find a compatible substitute
            const substitute = findCompatibleItem(ingredientItem.name);
            if (substitute && substitute.name !== ingredientItem.name) {
              const substituteItemData = mcData.itemsByName[substitute.name];
              if (substituteItemData) {
                const oldId = d.id;
                console.error(`[Craft] Substituting ${ingredientItem.name} (ID ${oldId}) with ${substitute.name} (ID ${substituteItemData.id})`);
                // Replace in delta
                for (const dd of recipeDelta) {
                  if (dd.id === oldId) dd.id = substituteItemData.id;
                }
                // Replace in inShape if present
                if ((tryRecipe as any).inShape) {
                  const shape = (tryRecipe as any).inShape as number[][];
                  for (let row = 0; row < shape.length; row++) {
                    for (let col = 0; col < shape[row].length; col++) {
                      if (shape[row][col] === oldId) shape[row][col] = substituteItemData.id;
                    }
                  }
                }
                // Replace in ingredients if present
                if ((tryRecipe as any).ingredients) {
                  const ingredients = (tryRecipe as any).ingredients as number[];
                  for (let idx = 0; idx < ingredients.length; idx++) {
                    if (ingredients[idx] === oldId) ingredients[idx] = substituteItemData.id;
                  }
                }
              }
            }
          }

          // Debug: Log recipe details before attempting craft
          const recipeIngredients = recipeDelta
            .filter(d => d.count < 0)
            .map(d => {
              const ing = mcData.items[d.id];
              return `${ing?.name || d.id}x${Math.abs(d.count)}`;
            })
            .join(", ");
          console.error(`[Craft] Attempting recipe: ${recipeIngredients}`);

          // Close any existing open window to prevent windowOpen event conflicts
          if (bot.currentWindow) {
            console.error(`[Craft] Closing existing open window before crafting`);
            bot.closeWindow(bot.currentWindow);
            await new Promise(resolve => setTimeout(resolve, 300));
          }

          // Ensure bot is close enough to crafting table before crafting (within 3.5 blocks)
          if (craftingTable) {
            const distToTable = bot.entity.position.distanceTo(craftingTable.position);
            if (distToTable > 3.5) {
              console.error(`[Craft] Too far from crafting table (${distToTable.toFixed(1)} blocks), moving closer...`);
              const goal = new goals.GoalNear(craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, 2);
              bot.pathfinder.setGoal(goal);
              await new Promise<void>((resolve) => {
                const timeout = setTimeout(() => { bot.pathfinder.setGoal(null); resolve(); }, 8000);
                const check = setInterval(() => {
                  const d = bot.entity.position.distanceTo(craftingTable!.position);
                  if (d < 3.5 || !bot.pathfinder.isMoving()) {
                    clearInterval(check); clearTimeout(timeout); bot.pathfinder.setGoal(null); resolve();
                  }
                }, 200);
              });
            }
            // Look at the crafting table to ensure line-of-sight for windowOpen
            await bot.lookAt(craftingTable.position.offset(0.5, 0.5, 0.5));
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          // Try bot.craft() with crafting table
          if (craftingTable) {
            // Verify distance right before interaction
            const finalDist = bot.entity.position.distanceTo(craftingTable.position);
            if (finalDist > 4.5) {
              console.error(`[Craft] Still too far from crafting table (${finalDist.toFixed(1)} blocks), aborting this attempt`);
              throw new Error(`Too far from crafting table (${finalDist.toFixed(1)} blocks)`);
            }
            console.error(`[Craft] Distance to crafting table: ${finalDist.toFixed(1)} blocks`);

            // Try direct bot.craft() with table reference first (simplest approach)
            const invBefore = bot.inventory.items().map(i => `${i.name}x${i.count}`).join(", ");
            console.error(`[Craft] Inventory before craft: ${invBefore}`);
            try {
              await bot.craft(tryRecipe, 1, craftingTable);
              const invAfter = bot.inventory.items().map(i => `${i.name}x${i.count}`).join(", ");
              console.error(`[Craft] Inventory after craft: ${invAfter}`);
            } catch (directErr: any) {
              const errMsg = String(directErr?.message || directErr);
              console.error(`[Craft] Direct craft failed: ${errMsg}`);

              // If windowOpen timeout, try pre-open approach
              if (errMsg.includes("windowOpen")) {
                // Close any lingering window
                if (bot.currentWindow) {
                  bot.closeWindow(bot.currentWindow);
                  await new Promise(resolve => setTimeout(resolve, 300));
                }
                // Re-look at the crafting table
                await bot.lookAt(craftingTable.position.offset(0.5, 0.5, 0.5));
                await new Promise(resolve => setTimeout(resolve, 200));

                try {
                  console.error(`[Craft] Pre-opening crafting table at ${craftingTable.position}...`);
                  const tableWindow = await bot.openContainer(craftingTable);
                  console.error(`[Craft] Crafting table window opened successfully`);
                  // Wait for window to be fully ready
                  await new Promise(resolve => setTimeout(resolve, 300));
                  // Now craft with table=undefined since window is already open
                  await bot.craft(tryRecipe, 1, undefined);
                  // Close the window after crafting
                  bot.closeWindow(tableWindow);
                  await new Promise(resolve => setTimeout(resolve, 300));
                } catch (preOpenErr: any) {
                  const preMsg = String(preOpenErr?.message || preOpenErr);
                  console.error(`[Craft] Pre-open craft also failed: ${preMsg}`);
                  if (bot.currentWindow) {
                    bot.closeWindow(bot.currentWindow);
                    await new Promise(resolve => setTimeout(resolve, 300));
                  }
                  throw preOpenErr;
                }
              } else {
                throw directErr;
              }
            }
          } else {
            const invBefore = bot.inventory.items().map(i => `${i.name}x${i.count}`).join(", ");
            console.error(`[Craft] Inventory before simple craft: ${invBefore}`);
            await bot.craft(tryRecipe, 1, undefined);
            const invAfter = bot.inventory.items().map(i => `${i.name}x${i.count}`).join(", ");
            console.error(`[Craft] Inventory after simple craft: ${invAfter}`);
          }

          // Wait for crafting to complete and item transfer
          // Increased timeout to 1500ms to handle slower servers
          await new Promise(resolve => setTimeout(resolve, 1500));

          // Only close window if we used a crafting table (not player inventory)
          // Closing the inventory window can cause items to drop!
          if (craftingTable && bot.currentWindow) {
            bot.closeWindow(bot.currentWindow);
            await new Promise(resolve => setTimeout(resolve, 300));
          }

          // Additional wait for inventory synchronization (increased from 700ms to 1500ms to reduce false positives)
          // Simple recipes (planks, sticks) crafted in player inventory can take time to sync
          await new Promise(resolve => setTimeout(resolve, 1500));

          // CRITICAL: Check if item appears in inventory
          // If not, it may have been dropped as an entity
          const craftedItemInInventory = bot.inventory.items().find(item => item.name === itemName);

          if (!craftedItemInInventory) {
            console.error(`[Craft] ${itemName} not in inventory after crafting, searching for dropped items...`);

            // Wait longer for item to spawn as entity (800ms to match dig_block timing)
            await new Promise(resolve => setTimeout(resolve, 800));

            // Try to collect any dropped items within 10 blocks
            // Support multiple entity types for items (varies by server/version)
            // Use comprehensive item detection logic matching bot-items.ts
            const nearbyItems = Object.values(bot.entities).filter(
              entity => {
                if (!entity || entity === bot.entity || !entity.position || !bot.entity.position) {
                  return false;
                }
                const dist = entity.position.distanceTo(bot.entity.position);
                if (dist > 10) return false;

                // Item detection - check multiple conditions for item entities
                const isItem = entity.id !== bot.entity.id && (
                  entity.name === "item" ||
                  entity.type === "other" ||
                  entity.type === "object" ||
                  ((entity.type as string) === "passive" && entity.name === "item") ||
                  entity.displayName === "Item" ||
                  (entity.entityType !== undefined && entity.entityType === 2)
                );
                return isItem;
              }
            );

            if (nearbyItems.length > 0) {
              console.error(`[Craft] Found ${nearbyItems.length} dropped items, using collectNearbyItems()...`);

              // Use the dedicated collection function from bot-items
              const { collectNearbyItems } = await import("./bot-items.js");
              try {
                await collectNearbyItems(managed);
              } catch (collectErr) {
                console.error(`[Craft] collectNearbyItems failed: ${collectErr}`);
              }

              // Additional wait after collection attempt for inventory sync (increased to 3500ms to reduce false positives)
              // Network lag or server lag can delay item pickup, so we give it more time before declaring failure
              await new Promise(resolve => setTimeout(resolve, 3500));

              // Verify item was actually collected
              const verifyCollected = bot.inventory.items().find(item => item.name === itemName);
              if (!verifyCollected) {
                // Debug: Show all inventory items to see what we actually have
                const inventoryNames = bot.inventory.items().map(i => i.name).join(", ");
                console.error(`[Craft] Expected ${itemName}, but inventory has: ${inventoryNames}`);
                console.error(`[Craft] WARNING: Crafted item not found in inventory - may have been picked up by another bot or despawned`);

                throw new Error(`Failed to craft ${itemName}: Item not found in inventory after crafting. It may have been collected by another nearby bot or despawned. Inventory: ${inventoryNames}`);
              }
            } else {
              throw new Error(`Failed to craft ${itemName}: Item not in inventory after crafting and no dropped items found nearby. This indicates a server configuration issue or the crafting operation did not complete successfully.`);
            }
          }

          crafted = true;
          break;
        } catch (craftErr) {
          lastError = craftErr;
          // Continue trying other recipes
        }
      }

      if (!crafted) {
        throw lastError;
      }
    }

    // Double-check that the item is actually in inventory
    const craftedItem = bot.inventory.items().find(i => i.name === itemName);
    const newInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");

    if (!craftedItem) {
      // Item not in inventory after crafting - may have been picked up by another bot nearby
      console.error(`[Craft] ERROR: ${itemName} not found in inventory after crafting`);
      throw new Error(`Failed to craft ${itemName}: Item not found in inventory after crafting. It may have been collected by another nearby bot or despawned. Try again.`);
    }

    // Success - item is in inventory
    return `Crafted ${count}x ${itemName}. Inventory: ${newInventory}` + getBriefStatus(managed);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // If error is about missing ingredients, add more context
    if (errMsg.includes("missing ingredient")) {
      // Get current inventory for accurate reporting
      const currentInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";

      // Extract recipe ingredients
      const delta = recipe.delta as Array<{ id: number; count: number }>;
      const needed: string[] = [];

      for (const d of delta) {
        if (d.count < 0) {
          const ingredientItem = mcData.items[d.id];
          const ingredientName = ingredientItem?.name || `id:${d.id}`;
          const requiredCount = Math.abs(d.count);
          needed.push(`${ingredientName}(need ${requiredCount})`);
        }
      }

      const tableInfo = craftingTable ? `table@(${craftingTable.position.x},${craftingTable.position.y},${craftingTable.position.z})` : "no_table";
      throw new Error(`Failed to craft ${itemName}: ${errMsg}. Recipe needs: ${needed.join(", ")}. ${tableInfo}. Inventory: ${currentInventory}`);
    }

    throw new Error(`Failed to craft ${itemName}: ${errMsg}. Inventory: ${inventory}`);
  }
}

/**
 * Smelt items in a furnace
 */
export async function smeltItem(managed: ManagedBot, itemName: string, count: number = 1): Promise<string> {
  const bot = managed.bot;

  // Check if bot is still connected
  if (!bot || !bot.entity) {
    throw new Error("Bot is not connected to the server. Please reconnect.");
  }

  const minecraftData = await import("minecraft-data");
  const mcData = minecraftData.default(bot.version);

  // Find a furnace nearby
  let furnaceBlock = bot.findBlock({
    matching: mcData.blocksByName.furnace?.id,
    maxDistance: 4,
  });

  // If not nearby, search wider and move to it
  if (!furnaceBlock) {
    const farFurnace = bot.findBlock({
      matching: mcData.blocksByName.furnace?.id,
      maxDistance: 32,
    });

    if (farFurnace) {
      console.error(`[Smelt] Found furnace at ${farFurnace.position}, moving...`);
      const goal = new goals.GoalNear(farFurnace.position.x, farFurnace.position.y, farFurnace.position.z, 3);
      bot.pathfinder.setGoal(goal);

      // Wait for movement
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          bot.pathfinder.setGoal(null);
          resolve();
        }, 10000);

        const check = setInterval(() => {
          const dist = bot.entity.position.distanceTo(farFurnace.position);
          if (dist < 4 || !bot.pathfinder.isMoving()) {
            clearInterval(check);
            clearTimeout(timeout);
            bot.pathfinder.setGoal(null);
            resolve();
          }
        }, 300);
      });

      // Re-check nearby
      furnaceBlock = bot.findBlock({
        matching: mcData.blocksByName.furnace?.id,
        maxDistance: 4,
      });
    }
  }

  if (!furnaceBlock) {
    // Check if player has a furnace in inventory
    const furnaceInInventory = bot.inventory.items().find(i => i.name === "furnace");
    if (furnaceInInventory) {
      throw new Error("No furnace found within 32 blocks, but you have one in inventory. Place it first using minecraft_place_block, then try smelting again.");
    }
    throw new Error("No furnace found within 32 blocks. Craft one with 8 cobblestone.");
  }

  // Find the item to smelt in inventory
  const itemToSmelt = bot.inventory.items().find(i => i.name === itemName);
  if (!itemToSmelt) {
    const inventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";
    throw new Error(`No ${itemName} in inventory. Have: ${inventory}`);
  }

  // Find fuel - prefer coal/charcoal over wood to avoid wasting building materials
  const allFuel = bot.inventory.items().filter(i => isFuelItem(i.name));
  const fuel = allFuel.find(i => i.name === "coal" || i.name === "charcoal")
    || allFuel.find(i => i.name === "lava_bucket" || i.name === "dried_kelp_block")
    || allFuel[0];
  if (!fuel) {
    throw new Error("No fuel in inventory. Need coal, charcoal, or wood.");
  }

  // Determine what the smelted output should be (common smelting recipes)
  const smeltingOutputMap: Record<string, string> = {
    'raw_iron': 'iron_ingot',
    'raw_copper': 'copper_ingot',
    'raw_gold': 'gold_ingot',
    'cobblestone': 'stone',
    'stone': 'smooth_stone',
    'sand': 'glass',
    'clay_ball': 'brick',
    'netherrack': 'nether_brick',
    'cobbled_deepslate': 'deepslate',
    'ancient_debris': 'netherite_scrap',
    // Add wood logs
    'oak_log': 'charcoal',
    'birch_log': 'charcoal',
    'spruce_log': 'charcoal',
    'jungle_log': 'charcoal',
    'acacia_log': 'charcoal',
    'dark_oak_log': 'charcoal',
    'mangrove_log': 'charcoal',
    'cherry_log': 'charcoal',
    // Food items
    'beef': 'cooked_beef',
    'porkchop': 'cooked_porkchop',
    'chicken': 'cooked_chicken',
    'mutton': 'cooked_mutton',
    'rabbit': 'cooked_rabbit',
    'cod': 'cooked_cod',
    'salmon': 'cooked_salmon',
    'potato': 'baked_potato',
    'kelp': 'dried_kelp',
  };
  const expectedOutputName = smeltingOutputMap[itemName];

  try {
    const furnace = await bot.openFurnace(furnaceBlock);

    // Track initial output count for accurate reporting
    let existingOutputCount = 0;
    const existingOutput = furnace.outputItem();
    if (existingOutput) {
      existingOutputCount = existingOutput.count;
      await furnace.takeOutput();
    }

    // Put fuel if needed
    if (!furnace.fuelItem()) {
      await furnace.putFuel(fuel.type, null, Math.min(fuel.count, 8));
    }

    // Put item to smelt
    const smeltCount = Math.min(count, itemToSmelt.count);
    await furnace.putInput(itemToSmelt.type, null, smeltCount);

    // Wait for smelting (roughly 10 seconds per item, with reasonable max)
    // Minecraft takes 10s per item, so allow time for all items to finish
    const waitTime = Math.min(smeltCount * 10000, 180000); // Cap at 3 minutes (18 items max)
    await new Promise(resolve => setTimeout(resolve, waitTime));

    // Track inventory count BEFORE taking output
    const inventoryBefore = bot.inventory.items().find(i => i.name === expectedOutputName);
    const countBefore = inventoryBefore?.count || 0;

    // Take output and track count
    const output = furnace.outputItem();
    let newOutputCount = 0;
    if (output) {
      newOutputCount = output.count;
      await furnace.takeOutput();
    }

    furnace.close();

    // Small delay to ensure items are transferred to inventory
    await new Promise(resolve => setTimeout(resolve, 500));

    // Track inventory count AFTER taking output
    const inventoryAfter = bot.inventory.items().find(i => i.name === expectedOutputName);
    const countAfter = inventoryAfter?.count || 0;
    const actualGained = countAfter - countBefore;

    const totalGained = existingOutputCount + newOutputCount;
    const newInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");

    // Verify that the smelted output actually entered inventory (handle server with item pickup disabled)
    // Check for the item that SHOULD have been produced from smelting
    if (expectedOutputName && (newOutputCount > 0 || existingOutputCount > 0)) {
      const outputInInventory = bot.inventory.items().find(i => i.name === expectedOutputName);
      const inventoryHasOutput = !!outputInInventory;
      const outputCount = outputInInventory?.count || 0;

      // Always include debug info in message
      const debugInfo = ` [Expected: ${expectedOutputName}, InInventory: ${inventoryHasOutput}${inventoryHasOutput ? ` (${outputCount}x)` : ''}, Gained: ${actualGained}/${totalGained}]`;

      if (actualGained === 0 && totalGained > 0) {
        // Items were smelted but didn't enter inventory - they must have dropped or there's a transfer issue
        console.error(`[Smelt] WARNING: ${expectedOutputName} not transferred to inventory after smelting - may need manual collection`);
        return `Smelted ${smeltCount}x ${itemName} (WARNING: ${totalGained}x ${expectedOutputName} may not have entered inventory - try minecraft_collect_items()). Inventory: ${newInventory}${debugInfo}`;
      }
    }

    // Report both smelted count and total gained if there was existing output
    if (existingOutputCount > 0) {
      return `Smelted ${smeltCount}x ${itemName}, gained ${totalGained} total (${existingOutputCount} were already in furnace). Inventory: ${newInventory}`;
    } else {
      return `Smelted ${smeltCount}x ${itemName}. Inventory: ${newInventory}`;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to smelt ${itemName}: ${errMsg}`);
  }
}

/**
 * Enchant an item at an enchanting table
 */
export async function enchant(managed: ManagedBot, itemName: string, enchantmentLevel: number = 1): Promise<string> {
  const bot = managed.bot;

  // Find nearby enchantment table
  const tableBlock = bot.findBlock({
    matching: (block) => block.name === "enchanting_table",
    maxDistance: 32,
  });

  if (!tableBlock) {
    throw new Error("No enchanting table found within 32 blocks.");
  }

  // Move closer if needed - simplified approach without moveTo dependency
  const dist = bot.entity.position.distanceTo(tableBlock.position);
  if (dist > 4) {
    const goal = new goals.GoalNear(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 3);
    bot.pathfinder.setGoal(goal);
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        bot.pathfinder.setGoal(null);
        resolve();
      }, 10000);
      const check = setInterval(() => {
        const currentDist = bot.entity.position.distanceTo(tableBlock.position);
        if (currentDist < 4 || !bot.pathfinder.isMoving()) {
          clearInterval(check);
          clearTimeout(timeout);
          bot.pathfinder.setGoal(null);
          resolve();
        }
      }, 300);
    });
  }

  // Check for lapis lazuli
  const lapis = bot.inventory.items().find(i => i.name === "lapis_lazuli");
  if (!lapis) {
    throw new Error("No lapis lazuli in inventory - required for enchanting.");
  }

  // Find item to enchant
  const item = bot.inventory.items().find(i => i.name === itemName);
  if (!item) {
    const inventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";
    throw new Error(`No ${itemName} in inventory. Have: ${inventory}`);
  }

  try {
    const enchantTable = await bot.openEnchantmentTable(tableBlock);

    // Put item and lapis
    await enchantTable.putTargetItem(item);
    await enchantTable.putLapis(lapis);

    // Wait for enchantments to load
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get available enchantments
    const enchantments = enchantTable.enchantments;

    // Select enchantment level (0, 1, or 2 for levels 1-3)
    const slotIndex = Math.max(0, Math.min(2, enchantmentLevel - 1));

    if (!enchantments[slotIndex]) {
      enchantTable.close();
      return `No enchantment available at level ${enchantmentLevel}. Available: ${JSON.stringify(enchantments)}`;
    }

    await enchantTable.enchant(slotIndex);
    await enchantTable.takeTargetItem();
    enchantTable.close();

    return `Enchanted ${itemName} at level ${enchantmentLevel}.`;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to enchant ${itemName}: ${errMsg}`);
  }
}

/**
 * Use anvil to repair, combine, or rename items
 */
export async function useAnvil(managed: ManagedBot, targetItem: string, materialItem?: string, newName?: string): Promise<string> {
  const bot = managed.bot;

  // Find nearby anvil
  const anvilBlock = bot.findBlock({
    matching: (block) => block.name.includes("anvil"),
    maxDistance: 32,
  });

  if (!anvilBlock) {
    throw new Error("No anvil found within 32 blocks.");
  }

  // Move closer if needed - simplified approach
  const dist = bot.entity.position.distanceTo(anvilBlock.position);
  if (dist > 4) {
    const goal = new goals.GoalNear(anvilBlock.position.x, anvilBlock.position.y, anvilBlock.position.z, 3);
    bot.pathfinder.setGoal(goal);
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        bot.pathfinder.setGoal(null);
        resolve();
      }, 10000);
      const check = setInterval(() => {
        const currentDist = bot.entity.position.distanceTo(anvilBlock.position);
        if (currentDist < 4 || !bot.pathfinder.isMoving()) {
          clearInterval(check);
          clearTimeout(timeout);
          bot.pathfinder.setGoal(null);
          resolve();
        }
      }, 300);
    });
  }

  // Find items
  const target = bot.inventory.items().find(i => i.name === targetItem);
  if (!target) {
    throw new Error(`No ${targetItem} in inventory.`);
  }

  const material = materialItem ? bot.inventory.items().find(i => i.name === materialItem) : null;
  if (materialItem && !material) {
    throw new Error(`No ${materialItem} in inventory for repair/combine.`);
  }

  try {
    const anvil = await bot.openAnvil(anvilBlock);

    let result: string;
    if (material) {
      // Combine two items (repair or enchant combine)
      await anvil.combine(target, material, newName);
      result = `Combined ${targetItem} with ${materialItem}`;
      if (newName) result += `, renamed to "${newName}"`;
    } else if (newName) {
      // Just rename
      await anvil.rename(target, newName);
      result = `Renamed ${targetItem} to "${newName}"`;
    } else {
      throw new Error("Must provide either materialItem for combining or newName for renaming.");
    }

    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Anvil operation failed: ${errMsg}`);
  }
}

/**
 * Brew potions at a brewing stand
 * @param basePotionName - Base potion (e.g., "water_bottle", "awkward_potion")
 * @param ingredientName - Ingredient to add (e.g., "nether_wart", "glowstone_dust", "redstone")
 * @param count - Number of potions to brew (1-3)
 */
export async function brewPotion(
  managed: ManagedBot,
  basePotionName: string,
  ingredientName: string,
  count: number = 1
): Promise<string> {
  const bot = managed.bot;

  // Find nearby brewing stand
  const brewingStand = bot.findBlock({
    matching: (block) => block.name === "brewing_stand",
    maxDistance: 32,
  });

  if (!brewingStand) {
    throw new Error("No brewing stand found within 32 blocks.");
  }

  // Move closer if needed
  const dist = bot.entity.position.distanceTo(brewingStand.position);
  if (dist > 4) {
    const goal = new goals.GoalNear(brewingStand.position.x, brewingStand.position.y, brewingStand.position.z, 3);
    bot.pathfinder.setGoal(goal);
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        bot.pathfinder.setGoal(null);
        resolve();
      }, 10000);
      const check = setInterval(() => {
        const currentDist = bot.entity.position.distanceTo(brewingStand.position);
        if (currentDist < 4 || !bot.pathfinder.isMoving()) {
          clearInterval(check);
          clearTimeout(timeout);
          bot.pathfinder.setGoal(null);
          resolve();
        }
      }, 300);
    });
  }

  // Check for blaze powder (fuel)
  const blazePowder = bot.inventory.items().find(i => i.name === "blaze_powder");
  if (!blazePowder) {
    throw new Error("No blaze powder in inventory - required for brewing fuel.");
  }

  // Check for base potions
  const basePotions = bot.inventory.items().filter(i => i.name === basePotionName);
  const totalBottles = basePotions.reduce((sum, item) => sum + item.count, 0);
  if (totalBottles < count) {
    throw new Error(`Need ${count}x ${basePotionName}, but only have ${totalBottles}.`);
  }

  // Check for ingredient
  const ingredient = bot.inventory.items().find(i => i.name === ingredientName);
  if (!ingredient) {
    throw new Error(`No ${ingredientName} in inventory.`);
  }

  try {
    // Open brewing stand
    const window = await bot.openContainer(brewingStand);

    // Use deposit to add items (Mineflayer will place them in appropriate slots)
    // Add fuel (blaze powder)
    await window.deposit(blazePowder.type, null, 1);
    await new Promise(resolve => setTimeout(resolve, 300));

    // Add ingredient
    await window.deposit(ingredient.type, null, 1);
    await new Promise(resolve => setTimeout(resolve, 300));

    // Add base potions (up to 3)
    const bottlesToBrew = Math.min(count, 3);
    for (let i = 0; i < bottlesToBrew; i++) {
      const basePotion = bot.inventory.items().find(item => item.name === basePotionName);
      if (basePotion) {
        await window.deposit(basePotion.type, null, 1);
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // Wait for brewing to complete (20 seconds)
    console.error(`[BrewPotion] Waiting for brewing to complete (22 seconds)...`);
    await new Promise(resolve => setTimeout(resolve, 22000));

    // Close window (items automatically return to inventory)
    bot.closeWindow(window);

    return `Successfully brewed ${bottlesToBrew}x potions using ${basePotionName} + ${ingredientName}.`;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to brew potion: ${errMsg}`);
  }
}
