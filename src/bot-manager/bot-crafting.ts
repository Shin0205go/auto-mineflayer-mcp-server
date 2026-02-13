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
      { name: "bed", ingredients: "3 wool + 3 planks" },
      { name: "bucket", ingredients: "3 iron_ingot" },
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
    { name: "planks", needs: { oak_log: 1 }, noTable: true, output: 4, alt: ["birch_log", "spruce_log"] },
    { name: "stick", needs: { oak_planks: 2 }, noTable: true, output: 4, alt: ["birch_planks", "spruce_planks"] },
    { name: "crafting_table", needs: { oak_planks: 4 }, noTable: true, alt: ["birch_planks", "spruce_planks"] },
    { name: "chest", needs: { oak_planks: 8 }, alt: ["birch_planks", "spruce_planks"] },
    { name: "furnace", needs: { cobblestone: 8 } },
    { name: "torch", needs: { coal: 1, stick: 1 }, output: 4 },
    { name: "wooden_pickaxe", needs: { oak_planks: 3, stick: 2 }, alt: ["birch_planks", "spruce_planks"] },
    { name: "stone_pickaxe", needs: { cobblestone: 3, stick: 2 } },
    { name: "iron_pickaxe", needs: { iron_ingot: 3, stick: 2 } },
    { name: "diamond_pickaxe", needs: { diamond: 3, stick: 2 } },
    { name: "wooden_sword", needs: { oak_planks: 2, stick: 1 }, alt: ["birch_planks", "spruce_planks"] },
    { name: "stone_sword", needs: { cobblestone: 2, stick: 1 } },
    { name: "iron_sword", needs: { iron_ingot: 2, stick: 1 } },
    { name: "wooden_axe", needs: { oak_planks: 3, stick: 2 }, alt: ["birch_planks", "spruce_planks"] },
    { name: "stone_axe", needs: { cobblestone: 3, stick: 2 } },
    { name: "iron_axe", needs: { iron_ingot: 3, stick: 2 } },
    { name: "bucket", needs: { iron_ingot: 3 } },
    { name: "shield", needs: { oak_planks: 6, iron_ingot: 1 }, alt: ["birch_planks", "spruce_planks"] },
    { name: "bed", needs: { oak_planks: 3, white_wool: 3 }, alt: ["birch_planks", "spruce_planks"] },
    { name: "bread", needs: { wheat: 3 } },
    { name: "iron_helmet", needs: { iron_ingot: 5 } },
    { name: "iron_chestplate", needs: { iron_ingot: 8 } },
    { name: "iron_leggings", needs: { iron_ingot: 7 } },
    { name: "iron_boots", needs: { iron_ingot: 4 } },
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
  let craftingTable = null;
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

  // Special handling for planks -> stick/crafting_table to avoid wood type issues
  // These recipes work with ANY planks type, so we manually find compatible recipes
  if (itemName === "stick" || itemName === "crafting_table") {
    // Find any planks in inventory
    const anyPlanks = inventoryItems.find(i => i.name.endsWith("_planks"));
    if (!anyPlanks) {
      throw new Error(`Cannot craft ${itemName}: Need any type of planks. Craft planks from logs first. Inventory: ${inventory}`);
    }

    // Check if we have enough planks
    const totalPlanks = inventoryItems
      .filter(i => i.name.endsWith("_planks"))
      .reduce((sum, item) => sum + item.count, 0);

    const requiredPlanks = itemName === "stick" ? 2 : 4;
    if (totalPlanks < requiredPlanks) {
      throw new Error(`Cannot craft ${itemName}: Need ${requiredPlanks} planks, have ${totalPlanks}. Craft more planks from logs first. Inventory: ${inventory}`);
    }

    // Get the specific item ID for the planks we have
    const planksItemId = mcData.itemsByName[anyPlanks.name]?.id;
    if (!planksItemId) {
      throw new Error(`Cannot find item ID for ${anyPlanks.name}`);
    }

    // Get all recipes and find one that uses the planks type we actually have
    const allRecipes = bot.recipesAll(item.id, null, null);

    // Try to find a recipe that uses our specific planks type
    let compatibleRecipe = allRecipes.find(recipe => {
      const delta = recipe.delta as Array<{ id: number; count: number }>;
      return delta.some(d => {
        if (d.count >= 0) return false; // Skip output items
        return d.id === planksItemId;
      });
    });

    // If no exact match, try to find any planks-based recipe and check if we have the materials
    if (!compatibleRecipe) {
      compatibleRecipe = allRecipes.find(recipe => {
        const delta = recipe.delta as Array<{ id: number; count: number }>;
        // Check if all negative deltas (ingredients) can be satisfied with our planks
        return delta.every(d => {
          if (d.count >= 0) return true; // Output items, always ok
          const ingredientItem = mcData.items[d.id];
          if (!ingredientItem) return false;

          // If it's any type of planks, we can use our planks
          if (ingredientItem.name.endsWith("_planks")) {
            const requiredCount = Math.abs(d.count);
            return totalPlanks >= requiredCount;
          }

          return false;
        });
      });
    }

    if (!compatibleRecipe) {
      throw new Error(`Cannot craft ${itemName}: No compatible recipe found for ${anyPlanks.name}. Available planks: ${totalPlanks}. This may be a Minecraft version compatibility issue.`);
    }

    console.error(`[Craft] Attempting to craft ${itemName} using ${anyPlanks.name} (have ${totalPlanks} planks)`);

    try {
      for (let i = 0; i < count; i++) {
        await bot.craft(compatibleRecipe, 1, undefined);

        // Wait for crafting to complete (match timing from general crafting path)
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Additional wait for inventory synchronization
        await new Promise(resolve => setTimeout(resolve, 700));
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

  // If we can craft in inventory, prefer that to avoid crafting table bugs
  if (canCraftInInventory) {
    craftingTable = null;
    console.error(`[Craft] Using player inventory (2x2) for ${itemName} - avoiding crafting table`);
  } else if (craftingTable) {
    // Only use crafting table if we must (no 2x2 recipes available)
    recipes = bot.recipesAll(item.id, null, craftingTable);
    console.error(`[Craft] Using crafting table (3x3) for ${itemName}`);
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
    // CRITICAL SAFETY CHECK: For valuable items, warn about potential loss if server has item pickup disabled
    const valuableItems = ["diamond_pickaxe", "diamond_axe", "diamond_sword", "diamond_shovel", "diamond_hoe",
                           "diamond_helmet", "diamond_chestplate", "diamond_leggings", "diamond_boots",
                           "netherite_pickaxe", "netherite_axe", "netherite_sword", "netherite_shovel",
                           "iron_pickaxe", "iron_axe", "iron_sword", "iron_shovel"];

    if (valuableItems.includes(itemName)) {
      console.error(`[Craft] CRITICAL: Cannot craft valuable item ${itemName} - server has item pickup disabled.`);
      console.error(`[Craft] Crafting would consume materials but output would be lost permanently.`);
      throw new Error(`Cannot craft ${itemName}: Server has item pickup disabled. Crafting this item would permanently waste valuable materials (diamonds, iron, etc). This server configuration makes crafting of valuable items impossible. Use existing tools or change server settings to enable item pickup.`);
    }

    if (craftingTable) {
      console.error(`[Craft] WARNING: Crafting ${itemName} using crafting table. If server has item pickup disabled, ingredients will be lost.`);
      // For all items, prefer to craft in player inventory if possible to avoid this bug
      // Try to find 2x2 recipes first
      const recipes2x2 = bot.recipesAll(item.id, null, null);
      if (recipes2x2.length > 0) {
        craftingTable = null;
        console.error(`[Craft] Using player inventory (2x2) instead to avoid potential item loss`);
      }
    }

    // Before crafting, ensure we have the exact items needed
    // Sometimes the bot needs specific item types even if we have compatible ones
    // This is a workaround for mineflayer's strict recipe matching
    for (let i = 0; i < count; i++) {
      // Try each craftable recipe in order until one succeeds
      let crafted = false;
      let lastError = null;

      for (const tryRecipe of craftableRecipes) {
        try {
          await bot.craft(tryRecipe, 1, craftingTable || undefined);

          // Wait for crafting to complete and item transfer
          // Increased timeout to 1500ms to handle slower servers
          await new Promise(resolve => setTimeout(resolve, 1500));

          // Only close window if we used a crafting table (not player inventory)
          // Closing the inventory window can cause items to drop!
          if (craftingTable && bot.currentWindow) {
            bot.closeWindow(bot.currentWindow);
            await new Promise(resolve => setTimeout(resolve, 300));
          }

          // Additional wait for inventory synchronization
          await new Promise(resolve => setTimeout(resolve, 700));

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
                await collectNearbyItems(bot);
              } catch (collectErr) {
                console.error(`[Craft] collectNearbyItems failed: ${collectErr}`);
              }

              // Additional wait after collection attempt for inventory sync (increased to 2000ms)
              await new Promise(resolve => setTimeout(resolve, 2000));

              // Verify item was actually collected
              const verifyCollected = bot.inventory.items().find(item => item.name === itemName);
              if (!verifyCollected) {
                // Debug: Show all inventory items to see what we actually have
                const inventoryNames = bot.inventory.items().map(i => i.name).join(", ");
                console.error(`[Craft] Expected ${itemName}, but inventory has: ${inventoryNames}`);
                console.error(`[Craft] CRITICAL: Item pickup disabled on server - crafted item lost permanently`);

                // CRITICAL BUG FIX: Throw error to prevent resource waste
                // Ingredients were consumed but output is lost - this is a failure, not success
                throw new Error(`Cannot craft ${itemName}: Server has item pickup disabled. Crafted item dropped on ground but cannot be collected. This server configuration is incompatible with crafting. Ingredients consumed: recipe materials lost permanently.`);
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
      // Item not in inventory - might have been dropped due to server config
      console.error(`[Craft] WARNING: ${itemName} not found in inventory after crafting - may have dropped due to server settings`);
      // Return success with a warning message instead of throwing error
      return `Crafted ${count}x ${itemName} (WARNING: Item may have dropped - server has item pickup disabled). Inventory: ${newInventory}` + getBriefStatus(managed);
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

  console.error(`[SMELT-DEBUG-2026] Starting smelt: ${itemName} x${count}`);

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
    throw new Error("No furnace found within 32 blocks. Craft one with 8 cobblestone.");
  }

  // Find the item to smelt in inventory
  const itemToSmelt = bot.inventory.items().find(i => i.name === itemName);
  if (!itemToSmelt) {
    const inventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";
    throw new Error(`No ${itemName} in inventory. Have: ${inventory}`);
  }

  // Find fuel (coal, charcoal, wood, etc.) using dynamic helper
  const fuel = bot.inventory.items().find(i => isFuelItem(i.name));
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
    // Track initial inventory count for accurate verification (sum ALL stacks)
    let initialOutputCount = 0;
    if (expectedOutputName) {
      const allStacks = bot.inventory.items().filter(i => i.name === expectedOutputName);
      initialOutputCount = allStacks.reduce((sum, item) => sum + item.count, 0);
    }
    const furnace = await bot.openFurnace(furnaceBlock);

    // Track initial output count for accurate reporting
    let existingOutputCount = 0;
    const existingOutput = furnace.outputItem();
    if (existingOutput) {
      existingOutputCount = existingOutput.count;

      // Check if inventory has space before taking output
      const inventorySlots = bot.inventory.slots;
      const emptySlots = inventorySlots.filter((slot, idx) =>
        idx >= bot.inventory.inventoryStart &&
        idx < bot.inventory.inventoryEnd &&
        !slot
      ).length;

      if (emptySlots === 0) {
        // Check if we can stack with existing items
        const canStack = bot.inventory.items().some(item =>
          item.name === expectedOutputName &&
          item.count < item.stackSize
        );

        if (!canStack) {
          furnace.close();
          throw new Error(`Inventory full (0 empty slots). Cannot take output from furnace. Drop items first.`);
        }
      }

      try {
        await furnace.takeOutput();
        // Wait for item to transfer to inventory
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (takeErr) {
        furnace.close();
        const takeErrMsg = takeErr instanceof Error ? takeErr.message : String(takeErr);
        throw new Error(`Cannot take existing output from furnace (inventory may be full): ${takeErrMsg}. Clear inventory space first.`);
      }
    }

    // Put fuel if needed
    if (!furnace.fuelItem()) {
      await furnace.putFuel(fuel.type, null, Math.min(fuel.count, 8));
    }

    // Check if furnace input slot is already occupied
    const existingInput = furnace.inputItem();
    if (existingInput) {
      // Try to take existing input first to clear the slot
      try {
        await furnace.takeInput();
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (inputErr) {
        furnace.close();
        throw new Error(`Furnace input slot occupied with ${existingInput.name} x${existingInput.count}. Cannot add new items. Clear furnace first.`);
      }
    }

    // Put item to smelt
    const smeltCount = Math.min(count, itemToSmelt.count);
    try {
      await furnace.putInput(itemToSmelt.type, null, smeltCount);
    } catch (putErr) {
      furnace.close();
      const putErrMsg = putErr instanceof Error ? putErr.message : String(putErr);
      throw new Error(`Cannot put ${itemName} into furnace (${putErrMsg}). Inventory may be full or furnace state is invalid. Try dropping some items first.`);
    }

    // Wait for smelting (roughly 10 seconds per item)
    // For multiple items, wait and periodically take output to prevent output slot from filling
    let totalOutputTaken = 0;
    const targetCount = smeltCount;
    const maxWaitTime = targetCount * 12000; // 12 seconds per item (10s smelt + 2s buffer)
    const startTime = Date.now();

    // Poll for output items and take them as they become available
    console.error(`[Smelt] Starting polling loop: targetCount=${targetCount}, maxWaitTime=${maxWaitTime}ms`);
    while (totalOutputTaken < targetCount && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Check every 2 seconds

      const output = furnace.outputItem();
      console.error(`[Smelt] Poll check: output=${output ? `${output.count}x ${output.name}` : 'null'}, totalTaken=${totalOutputTaken}/${targetCount}, elapsed=${Date.now() - startTime}ms`);
      if (output && output.count > 0) {
        totalOutputTaken += output.count;
        await furnace.takeOutput();
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for transfer
        console.error(`[Smelt] Took ${output.count}x output (total: ${totalOutputTaken}/${targetCount})`);
      }
    }
    console.error(`[Smelt] Polling loop finished: totalTaken=${totalOutputTaken}/${targetCount}`);

    // Final check for any remaining output
    const finalOutput = furnace.outputItem();
    if (finalOutput && finalOutput.count > 0) {
      totalOutputTaken += finalOutput.count;
      await furnace.takeOutput();
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for transfer
      console.error(`[Smelt] Final take: ${finalOutput.count}x output (total: ${totalOutputTaken}/${targetCount})`);
    }

    furnace.close();

    const newOutputCount = totalOutputTaken;

    const totalGained = existingOutputCount + newOutputCount;
    const newInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");

    // Verify that the smelted output actually entered inventory (handle server with item pickup disabled)
    // Check for the item that SHOULD have been produced from smelting
    if (expectedOutputName) {
      const outputInInventory = bot.inventory.items().filter(i => i.name === expectedOutputName);
      const finalOutputCount = outputInInventory.reduce((sum, item) => sum + item.count, 0);
      const actualGained = finalOutputCount - initialOutputCount;

      // Always include debug info in message
      const debugInfo = ` [Expected: ${expectedOutputName}, Initial: ${initialOutputCount}, Final: ${finalOutputCount}, Gained: ${actualGained}, SmeltCount: ${smeltCount}, TakenFromFurnace: ${totalGained}]`;

      if (outputInInventory.length === 0 && totalGained > 0) {
        // Items were taken from furnace but expected output not in inventory - they must have dropped
        console.error(`[Smelt] CRITICAL: ${expectedOutputName} not found in inventory after smelting - output lost permanently`);
        throw new Error(`Cannot smelt ${itemName}: Server has item pickup disabled or inventory sync failed. ${totalGained}x ${expectedOutputName} was taken from furnace but lost. Raw materials consumed but output disappeared. This indicates a critical server configuration issue.${debugInfo}`);
      }

      // CRITICAL CHECK: Verify that the expected number of items were actually gained
      // We should gain exactly what we took from the furnace (newOutputCount, not totalGained)
      // totalGained includes existingOutputCount which was already in inventory before smelting started
      if (actualGained < newOutputCount) {
        console.error(`[Smelt] WARNING: Expected to gain ${newOutputCount}x ${expectedOutputName} but only gained ${actualGained}x`);
        throw new Error(`Smelting ${itemName} lost items! Expected to gain ${newOutputCount}x ${expectedOutputName} from furnace but only gained ${actualGained}x in inventory. Missing ${newOutputCount - actualGained} items. This indicates a critical bug in the smelting system.${debugInfo}`);
      }

      // Also warn if we didn't smelt the expected amount
      if (totalGained < smeltCount) {
        console.error(`[Smelt] WARNING: Only smelted ${totalGained}x out of ${smeltCount}x items. Smelting may have been incomplete.`);
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
