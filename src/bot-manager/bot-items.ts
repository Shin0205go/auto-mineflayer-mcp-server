import type { Bot } from "mineflayer";
import pkg from "mineflayer-pathfinder";
const { goals } = pkg;
import type { ManagedBot } from "./types.js";

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
export async function collectNearbyItems(managed: ManagedBot): Promise<string> {
  const bot = managed.bot;
  console.error(`[CollectItems] Starting collection, bot at ${bot.entity.position.toString()}`);
  const inventoryBefore = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);

  // Simplified and more reliable item detection
  const findItems = () => {
    console.error(`[CollectItems] findItems() called, scanning ${Object.keys(bot.entities).length} entities`);
    const allEntities = Object.values(bot.entities);

    const items = allEntities.filter((entity) => {
      if (!entity || entity === bot.entity || !entity.position || !bot.entity.position) {
        return false;
      }

      const dist = entity.position.distanceTo(bot.entity.position);
      if (dist > 10) return false; // Reasonable range for item collection

      // Item detection - simplified to just check name
      // This works because getNearbyEntities shows items with name="item"
      const isItem = entity.id !== bot.entity.id && entity.name === "item";

      if (isItem && dist < 5) {
        console.error(`[CollectItems] Found item: name=${entity.name}, type=${entity.type}, distance=${dist.toFixed(2)}, pos=${entity.position.toString()}`);
      }

      return isItem;
    });

    console.error(`[CollectItems] findItems() found ${items.length} items within 10 blocks`);
    return items;
  };

  // Wait for items to appear if none found immediately
  // (server may not have spawned drop entities yet after block break)
  let items = findItems();

  if (items.length === 0) {
    for (let wait = 0; wait < 8; wait++) {
      await delay(500);
      items = findItems();
      if (items.length > 0) break;
    }
  }

  if (items.length === 0) {
    const nearbyEntities = Object.values(bot.entities)
      .filter(e => e && e !== bot.entity && e.position && e.position.distanceTo(bot.entity.position) < 15)
      .map(e => `${e.name || e.displayName || "unknown"}(type:${e.type})`)
      .slice(0, 5);
    console.error(`[CollectItems] No items found after wait. Nearby entities: ${nearbyEntities.join(", ") || "none"}`);
    return `No items nearby. Entities found: ${nearbyEntities.length > 0 ? nearbyEntities.join(", ") : "none"}`;
  }

  console.error(`[CollectItems] Found ${items.length} items to collect`);


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

    console.error(`[CollectItems] Attempt ${attempt + 1}/${maxAttempts}: Item at distance ${distance.toFixed(2)}, pos: ${itemPos.toString()}`);

    try {
      if (distance < 2) {
        console.error(`[CollectItems] Using close-range collection strategy`);

        // Very close - move directly THROUGH the item position to force collision pickup
        // Auto-pickup sometimes fails, so we need to move through the item multiple times

        // DON'T back away if too close - instead move through it aggressively
        // First approach: Look at item and move forward while jumping (repeat multiple times)
        for (let pass = 0; pass < 3; pass++) {
          if (!bot.entities[item.id]) break; // Item collected

          await bot.lookAt(itemPos);
          bot.setControlState("forward", true);
          bot.setControlState("jump", true);
          await delay(400);
          bot.setControlState("forward", false);
          bot.setControlState("jump", false);
          await delay(100);
        }

        // Check if item still exists
        if (!bot.entities[item.id]) {
          // Item was collected, continue to next item
          continue;
        }

        // Second approach: Move to exact item position using pathfinder
        const remainingDist = bot.entity.position.distanceTo(itemPos);
        if (remainingDist > 0.3) {
          try {
            // Use GoalNear with range 0 to get as close as possible to the EXACT item position
            // GoalBlock floors coordinates which loses precision - use GoalNear instead
            const goal = new goals.GoalNear(
              itemPos.x,
              itemPos.y,
              itemPos.z,
              0
            );
            bot.pathfinder.setGoal(goal);

            // Wait for pathfinding with timeout, checking if item disappears
            const startTime = Date.now();
            while (Date.now() - startTime < 3000) {
              await delay(100);

              // Check if item was collected
              if (!bot.entities[item.id]) {
                bot.pathfinder.setGoal(null);
                break;
              }

              // Check if we're very close
              const currentDist = bot.entity.position.distanceTo(itemPos);
              if (currentDist < 0.3) {
                break;
              }

              if (!bot.pathfinder.isMoving()) {
                break;
              }
            }

            bot.pathfinder.setGoal(null);

            // After getting close, aggressively move THROUGH the item position while jumping
            if (bot.entities[item.id]) {
              await bot.lookAt(itemPos);
              bot.setControlState("forward", true);
              bot.setControlState("jump", true);
              await delay(500);
              bot.setControlState("forward", false);
              bot.setControlState("jump", false);
              await delay(300);
            }
          } catch (_) { /* ignore pathfinder errors */ }
        }

        // Third approach: If item still exists, try moving in a small circle around it
        if (bot.entities[item.id]) {
          const directions = [
            itemPos.offset(0.5, 0, 0),
            itemPos.offset(-0.5, 0, 0),
            itemPos.offset(0, 0, 0.5),
            itemPos.offset(0, 0, -0.5)
          ];

          for (const dir of directions) {
            if (!bot.entities[item.id]) break;

            await bot.lookAt(dir);
            bot.setControlState("forward", true);
            bot.setControlState("jump", true);
            await delay(300);
            bot.setControlState("forward", false);
            bot.setControlState("jump", false);
            await delay(100);
          }
        }

        // Final wait for pickup to trigger
        await delay(300);
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
          if (currentDist < 1.2) { // Slightly increased threshold
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
            bot.setControlState("jump", true);
            await delay(1200); // Increased from 1000 to get even closer
            bot.setControlState("forward", false);
            bot.setControlState("jump", false);

            // Extra wait for auto-pickup to trigger
            await delay(500); // Increased from 200
          }
        }
      }

      // Wait for auto-pickup and check if item was collected
      await delay(500); // Increased from 300

      if (!bot.entities[item.id]) {
        collectedCount++;
      } else {
        // Item still exists - try manual pickup by right-clicking on it
        // Some servers have auto-pickup disabled and require manual collection
        console.error(`[CollectItems] Item still exists after movement - trying manual pickup`);
        try {
          const itemEntity = bot.entities[item.id];
          if (itemEntity && itemEntity.position) {
            // Look at the item and try to activate/use it (right-click)
            await bot.lookAt(itemEntity.position);
            await delay(100);

            // Try activating entity (some servers support right-click pickup)
            if (bot.entity.position.distanceTo(itemEntity.position) < 4) {
              bot.activateEntity(itemEntity);
              await delay(300);

              // Check if it worked
              if (!bot.entities[item.id]) {
                console.error(`[CollectItems] Manual pickup successful!`);
                collectedCount++;
              }
            }
          }
        } catch (manualErr) {
          console.error(`[CollectItems] Manual pickup failed: ${manualErr}`);
        }
      }

    } catch (error) {
      // Continue to next item on error
      continue;
    }
  }

  const inventoryAfter = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
  const actuallyCollected = inventoryAfter - inventoryBefore;

  // CRITICAL: Detect if server has item pickup disabled
  // Only flag if items exist AND we got very close to them but still couldn't collect
  // This prevents false positives from unreachable/stuck items
  if (items.length > 0 && actuallyCollected === 0 && collectedCount >= 2) {
    // Check if we actually got close to items (< 2 blocks)
    const closestItemDist = items.length > 0 ?
      Math.min(...items.map(item => item.position.distanceTo(bot.entity.position))) : 999;

    if (closestItemDist < 2) {
      // We got very close to items but couldn't collect them - likely pickup is disabled
      console.error(`[CollectItems] CRITICAL: ${items.length} items exist, got within ${closestItemDist.toFixed(2)} blocks, but 0 collected - server likely has item pickup disabled!`);
      managed.serverHasItemPickupDisabled = true;
      managed.serverHasItemPickupDisabledTimestamp = Date.now();
      return `CRITICAL: Server has item pickup disabled! Found ${items.length} items but cannot collect them. Survival impossible without admin intervention. Use /give command or fix server config.`;
    } else {
      console.error(`[CollectItems] Items exist but too far away (${closestItemDist.toFixed(2)} blocks) - not flagging as pickup disabled`);
    }
  }

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
 * Drop items from inventory (handles multiple stacks)
 */
export async function dropItem(bot: Bot, itemName: string, count?: number): Promise<string> {
  const items = bot.inventory.items().filter(i => i.name === itemName);
  if (items.length === 0) {
    const inventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";
    throw new Error(`No ${itemName} in inventory. Have: ${inventory}`);
  }

  // Calculate total available
  const totalAvailable = items.reduce((sum, item) => sum + item.count, 0);
  const targetCount = count ?? totalAvailable;

  let remaining = targetCount;
  let totalDropped = 0;

  try {
    // Drop from stacks until we reach the target count
    // Refetch items each iteration as tossing changes inventory state
    while (remaining > 0) {
      const currentItems = bot.inventory.items().filter(i => i.name === itemName);
      console.error(`[Drop] Remaining: ${remaining}, found ${currentItems.length} stacks of ${itemName}`);
      if (currentItems.length === 0) break;

      const item = currentItems[0]; // Always take first matching item
      const dropFromThis = Math.min(remaining, item.count);
      console.error(`[Drop] Dropping ${dropFromThis} from stack of ${item.count}`);
      await bot.toss(item.type, null, dropFromThis);
      totalDropped += dropFromThis;
      remaining -= dropFromThis;

      // Wait for server inventory sync - listen for setSlot event
      // Toss triggers server to send window_item updates
      await new Promise<void>(resolve => {
        let resolved = false;
        const onSlot = () => {
          if (!resolved) { resolved = true; resolve(); }
        };
        bot.inventory.on("updateSlot" as any, onSlot);
        // Fallback timeout if event doesn't fire
        setTimeout(() => {
          bot.inventory.removeListener("updateSlot" as any, onSlot);
          if (!resolved) { resolved = true; resolve(); }
        }, 1000);
      });
    }

    const newInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";
    return `Dropped ${totalDropped}x ${itemName}. Inventory: ${newInventory}`;
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
  // Support unequipping (switching to empty hand)
  const normalizedName = itemName.toLowerCase().trim();
  if (normalizedName === "none" || normalizedName === "empty" || normalizedName === "") {
    try {
      await bot.unequip("hand");
      return `Unequipped hand - now using empty hand`;
    } catch (err) {
      return `Failed to unequip hand: ${err}`;
    }
  }

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
