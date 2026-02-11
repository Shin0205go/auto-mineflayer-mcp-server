import type { Bot } from "mineflayer";
import pkg from "mineflayer-pathfinder";
const { goals } = pkg;

/**
 * Item-related bot operations
 * Extracted from bot-manager.ts for better organization
 */

/**
 * Helper: delay promise
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Collect dropped items near the bot
 */
export async function collectNearbyItems(bot: Bot): Promise<string> {
  const inventoryBefore = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);

  // Simplified and more reliable item detection
  const findItems = () => {
    const allEntities = Object.values(bot.entities);

    return allEntities.filter((entity) => {
      if (!entity || entity === bot.entity || !entity.position || !bot.entity.position) {
        return false;
      }

      const dist = entity.position.distanceTo(bot.entity.position);
      if (dist > 10) return false; // Reasonable range for item collection

      // Item detection - check multiple conditions for item entities
      // mineflayer v4.x: entity.name === "item", entity.type === "other", entity.displayName === "Item"
      const isItem = entity.id !== bot.entity.id && (
        entity.name === "item" ||
        entity.type === "other" ||
        entity.displayName === "Item" ||
        (entity.entityType !== undefined && entity.entityType === 2) // item entity type ID
      );

      return isItem;
    });
  };

  // Wait for items to appear if none found immediately
  // (server may not have spawned drop entities yet after block break)
  let items = findItems();

  if (items.length === 0) {
    for (let wait = 0; wait < 5; wait++) {
      await delay(400);
      items = findItems();
      if (items.length > 0) break;
    }
  }

  if (items.length === 0) {
    const nearbyEntities = Object.values(bot.entities)
      .filter(e => e && e !== bot.entity && e.position && e.position.distanceTo(bot.entity.position) < 15)
      .map(e => `${e.name || e.displayName || "unknown"}(type:${e.type})`)
      .slice(0, 5);
    return `No items nearby. Entities found: ${nearbyEntities.length > 0 ? nearbyEntities.join(", ") : "none"}`;
  }

  // Sort by distance
  items.sort((a, b) =>
    a.position.distanceTo(bot.entity.position) -
    b.position.distanceTo(bot.entity.position)
  );

  let collectedCount = 0;
  const maxAttempts = Math.min(items.length, 5); // Limit attempts

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Re-scan for items each attempt
    items = findItems().sort((a, b) =>
      a.position.distanceTo(bot.entity.position) -
      b.position.distanceTo(bot.entity.position)
    );

    if (items.length === 0) break;

    const item = items[0];
    const itemPos = item.position.clone();
    const distance = bot.entity.position.distanceTo(itemPos);

    try {
      if (distance < 2) {
        // Very close - move directly to the item position
        // Auto-pickup range is ~1 block, so get very close
        await bot.lookAt(itemPos);
        bot.setControlState("forward", true);
        await delay(500); // Increased from 300 to ensure closer approach
        bot.setControlState("forward", false);

        // If still not close enough, use pathfinder to get to exact position
        const remainingDist = bot.entity.position.distanceTo(itemPos);
        if (remainingDist > 1.0) {
          try {
            const goal = new goals.GoalNear(
              Math.floor(itemPos.x),
              Math.floor(itemPos.y),
              Math.floor(itemPos.z),
              0
            );
            bot.pathfinder.setGoal(goal);
            await delay(1500); // Increased timeout
            bot.pathfinder.setGoal(null);
          } catch (_) { /* ignore pathfinder errors */ }
        }
      } else {
        // Use pathfinder for longer distances
        const goal = new goals.GoalNear(
          Math.floor(itemPos.x),
          Math.floor(itemPos.y),
          Math.floor(itemPos.z),
          1
        );
        bot.pathfinder.setGoal(goal);

        // Wait for pathfinding with timeout
        const startTime = Date.now();
        let reachedItem = false;

        while (Date.now() - startTime < 4000) {
          await delay(200);

          // Check if item still exists
          if (!bot.entities[item.id]) {
            reachedItem = true;
            break;
          }

          // Check if we're close enough for auto-pickup (Minecraft auto-pickup range is ~1 block)
          const currentDist = bot.entity.position.distanceTo(itemPos);
          if (currentDist < 1.0) {
            reachedItem = true;
            break;
          }

          // Check if pathfinder stopped moving
          if (!bot.pathfinder.isMoving()) {
            break;
          }
        }

        bot.pathfinder.setGoal(null);

        // If close but not quite there, make final approach
        if (!reachedItem && bot.entities[item.id]) {
          const finalDist = bot.entity.position.distanceTo(itemPos);
          if (finalDist < 3) {
            await bot.lookAt(itemPos);
            bot.setControlState("forward", true);
            await delay(1000); // Increased from 800 to get closer
            bot.setControlState("forward", false);

            // Extra wait for auto-pickup to trigger
            await delay(200);
          }
        }
      }

      // Wait for auto-pickup and check if item was collected
      await delay(300);

      if (!bot.entities[item.id]) {
        collectedCount++;
      }

    } catch (error) {
      // Continue to next item on error
      continue;
    }
  }

  const inventoryAfter = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
  const actuallyCollected = inventoryAfter - inventoryBefore;

  if (actuallyCollected > 0) {
    return `Collected ${actuallyCollected} items (inventory: ${inventoryAfter} total)`;
  } else if (collectedCount > 0) {
    return `Approached ${collectedCount} items but inventory unchanged. Items may have been collected by other means or blocked.`;
  } else {
    return `No items collected after ${maxAttempts} attempts - items may have despawned or be inaccessible`;
  }
}

/**
 * List dropped items within range
 */
export function listDroppedItems(bot: Bot, range: number = 10): string {
  const botPos = bot.entity.position;

  const items = Object.values(bot.entities)
    .filter(entity => {
      if (!entity || entity === bot.entity) return false;
      const dist = entity.position.distanceTo(botPos);
      return dist < range && entity.name === "item";
    })
    .map(entity => {
      const dist = entity.position.distanceTo(botPos);
      // Try to get item info from metadata
      const metadata = entity.metadata;
      let itemName = "unknown";
      if (metadata && Array.isArray(metadata)) {
        // Item entity metadata slot 8 contains the item stack
        const itemStack = metadata.find((m: unknown) =>
          m && typeof m === "object" && "itemId" in (m as object)
        );
        if (itemStack && typeof itemStack === "object" && "itemId" in itemStack) {
          itemName = `item_id:${(itemStack as { itemId: number }).itemId}`;
        }
      }
      return {
        entityId: entity.id,
        name: itemName,
        distance: dist.toFixed(1),
        position: {
          x: entity.position.x.toFixed(1),
          y: entity.position.y.toFixed(1),
          z: entity.position.z.toFixed(1),
        },
      };
    })
    .sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

  if (items.length === 0) {
    return `No dropped items within ${range} blocks`;
  }

  return JSON.stringify({
    count: items.length,
    range,
    items: items.slice(0, 10), // Limit to 10 closest items
  }, null, 2);
}

/**
 * Use an item (bucket, flint_and_steel, ender_eye, etc.)
 */
export async function useItem(bot: Bot, itemName?: string): Promise<string> {
  // If item specified, equip it first
  if (itemName) {
    const item = bot.inventory.items().find(i => i.name === itemName);
    if (!item) {
      const inventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";
      throw new Error(`No ${itemName} in inventory. Have: ${inventory}`);
    }
    await bot.equip(item, "hand");
  }

  const heldItem = bot.heldItem;
  if (!heldItem) {
    throw new Error("No item in hand to use.");
  }

  try {
    // Activate the item (right-click)
    bot.activateItem();
    return `Used ${heldItem.name}`;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to use ${heldItem.name}: ${errMsg}`);
  }
}

/**
 * Drop items from inventory
 */
export async function dropItem(bot: Bot, itemName: string, count?: number): Promise<string> {
  const item = bot.inventory.items().find(i => i.name === itemName);
  if (!item) {
    const inventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";
    throw new Error(`No ${itemName} in inventory. Have: ${inventory}`);
  }

  const dropCount = count ? Math.min(count, item.count) : item.count;

  try {
    await bot.toss(item.type, null, dropCount);
    const newInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";
    return `Dropped ${dropCount}x ${itemName}. Inventory: ${newInventory}`;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to drop ${itemName}: ${errMsg}`);
  }
}

/**
 * Equip best available armor
 */
export async function equipArmor(bot: Bot): Promise<string> {
  const armorPriority = ["netherite", "diamond", "iron", "chainmail", "gold", "leather"];
  const armorSlots = {
    helmet: "head",
    chestplate: "torso",
    leggings: "legs",
    boots: "feet",
  } as const;

  const equipped: string[] = [];

  for (const [armorType, slot] of Object.entries(armorSlots)) {
    for (const material of armorPriority) {
      const itemName = `${material}_${armorType}`;
      const item = bot.inventory.items().find(i => i.name === itemName);
      if (item) {
        try {
          await bot.equip(item, slot as "head" | "torso" | "legs" | "feet");
          equipped.push(itemName);
        } catch {
          // Already equipped or can't equip
        }
        break;
      }
    }
  }

  return equipped.length > 0
    ? `Equipped: ${equipped.join(", ")}`
    : "No armor to equip";
}

/**
 * Equip best weapon or specific weapon
 */
export async function equipWeapon(bot: Bot, weaponName?: string): Promise<string> {
  const weaponPriority = [
    "netherite_sword", "diamond_sword", "iron_sword", "stone_sword", "wooden_sword",
    "netherite_axe", "diamond_axe", "iron_axe", "stone_axe", "wooden_axe",
  ];

  let weapon = null;
  if (weaponName) {
    weapon = bot.inventory.items().find(i =>
      i.name.toLowerCase() === weaponName.toLowerCase()
    );
  } else {
    for (const w of weaponPriority) {
      weapon = bot.inventory.items().find(i => i.name === w);
      if (weapon) break;
    }
  }

  if (!weapon) {
    return weaponName
      ? `No ${weaponName} in inventory`
      : "No weapon in inventory";
  }

  try {
    await bot.equip(weapon, "hand");
    return `Equipped ${weapon.name}`;
  } catch (err) {
    return `Failed to equip: ${err}`;
  }
}

/**
 * Equip a specific item (handles auto-detection of equipment slot)
 */
export async function equipItem(bot: Bot, itemName: string): Promise<string> {
  const item = bot.inventory.items().find(i =>
    i.name.toLowerCase() === itemName.toLowerCase() ||
    i.name.toLowerCase().includes(itemName.toLowerCase())
  );

  if (!item) {
    const allItems = bot.inventory.items();
    const available = allItems.map(i => `${i.name}(${i.count})`).join(", ");

    // Find similar items (e.g., other pickaxes when looking for iron_pickaxe)
    const similarItems = allItems.filter(i => {
      const itemType = itemName.toLowerCase().replace(/^(wooden_|stone_|iron_|golden_|diamond_|netherite_)/, '');
      return i.name.toLowerCase().includes(itemType) && i.name !== itemName;
    });

    let errorMsg = `No ${itemName} in inventory. Available: ${available || "nothing"}`;
    if (similarItems.length > 0) {
      errorMsg += `. Did you mean: ${similarItems.map(i => i.name).join(", ")}?`;
    }

    throw new Error(errorMsg);
  }

  // Determine the correct slot using minecraft-data enchantCategories
  let slot: "hand" | "off-hand" | "head" | "torso" | "legs" | "feet" = "hand";

  // Use minecraft-data directly (bot.registry may not have enchantCategories)
  const minecraftData = await import("minecraft-data");
  const mcData = minecraftData.default(bot.version);
  const itemData = mcData.itemsByName[item.name];
  const categories: string[] = itemData?.enchantCategories || [];

  // Debug log
  console.error(`[Equip] Item: ${item.name}, Categories: ${categories.join(", ") || "none"}, Version: ${bot.version}`);

  // Support both old (1.20) and new (1.21+) category names
  if (categories.includes("armor_head") || categories.includes("head_armor")) {
    slot = "head";
  } else if (categories.includes("armor_chest") || (categories.includes("armor") && item.name.includes("chestplate"))) {
    slot = "torso";
  } else if (categories.includes("armor_legs") || categories.includes("leg_armor")) {
    slot = "legs";
  } else if (categories.includes("armor_feet") || categories.includes("foot_armor")) {
    slot = "feet";
  } else if (item.name.includes("shield")) {
    slot = "off-hand";
  }

  console.error(`[Equip] Equipping ${item.name} to slot: ${slot}`);

  try {
    await bot.equip(item, slot);

    // Return with current equipment status for verification
    const slots = bot.inventory.slots;
    const currentEquip = {
      head: slots[5]?.name || "なし",
      chest: slots[6]?.name || "なし",
      legs: slots[7]?.name || "なし",
      feet: slots[8]?.name || "なし",
    };
    return `Equipped ${item.name} to ${slot}. 現在の装備: 頭=${currentEquip.head}, 胸=${currentEquip.chest}, 脚=${currentEquip.legs}, 足=${currentEquip.feet}`;
  } catch (err) {
    return `Failed to equip ${item.name} to ${slot}: ${err}`;
  }
}
