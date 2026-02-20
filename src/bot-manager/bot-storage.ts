import { Vec3 } from "vec3";
import type { ManagedBot } from "./types.js";
import pkg from "mineflayer-pathfinder";
const { goals } = pkg;

/**
 * Global chest access lock to prevent multi-bot sync bugs
 * Key: "x,y,z" chest position, Value: timestamp of lock acquisition
 */
const chestLocks = new Map<string, number>();
const LOCK_TIMEOUT_MS = 10000; // 10s max lock duration

/**
 * Acquire lock for chest access
 * Returns true if lock acquired, false if chest is locked by another bot
 */
function acquireChestLock(x: number, y: number, z: number): boolean {
  const lockKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  const now = Date.now();

  // Clean up expired locks
  const expiredLocks = Array.from(chestLocks.entries())
    .filter(([_, timestamp]) => now - timestamp > LOCK_TIMEOUT_MS);
  expiredLocks.forEach(([key, _]) => chestLocks.delete(key));

  // Check if chest is currently locked
  if (chestLocks.has(lockKey)) {
    return false; // Chest is locked
  }

  // Acquire lock
  chestLocks.set(lockKey, now);
  return true;
}

/**
 * Release lock for chest access
 */
function releaseChestLock(x: number, y: number, z: number): void {
  const lockKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  chestLocks.delete(lockKey);
}

/**
 * Open a chest and list its contents
 * Handles double chests by trying adjacent blocks if needed
 */
export async function openChest(
  managed: ManagedBot,
  x: number,
  y: number,
  z: number
): Promise<string> {
  const bot = managed.bot;
  const chestPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));

  // Check if chest exists first
  const chestBlock = bot.blockAt(chestPos);
  if (!chestBlock || !chestBlock.name.includes("chest")) {
    throw new Error(`No chest at (${x}, ${y}, ${z}). Found: ${chestBlock?.name || "nothing"}`);
  }

  // Check current distance
  const initialDistance = bot.entity.position.distanceTo(chestPos);

  // If too far, try to move closer
  if (initialDistance > 4) {
    const GoalGetToBlock = goals.GoalGetToBlock;

    try {
      await bot.pathfinder.goto(new GoalGetToBlock(chestPos.x, chestPos.y, chestPos.z));
    } catch (err) {
      throw new Error(`Chest at (${x}, ${y}, ${z}) is ${initialDistance.toFixed(1)} blocks away and unreachable. Move closer manually first.`);
    }

    // Verify we're close enough now
    const finalDistance = bot.entity.position.distanceTo(chestPos);
    if (finalDistance > 4) {
      throw new Error(`Still too far from chest (${finalDistance.toFixed(1)} blocks). Move closer manually.`);
    }
  }

  // Wait a moment to prevent timing issues
  await new Promise(resolve => setTimeout(resolve, 500));

  // Try to open the chest - handle double chest case
  let chest;
  try {
    chest = await Promise.race([
      bot.openContainer(chestBlock),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 5000)
      )
    ]) as any;
  } catch (err) {
    // If timeout, this might be a double chest - try adjacent blocks
    const adjacentOffsets = [
      new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1), new Vec3(0, 0, -1)
    ];

    for (const offset of adjacentOffsets) {
      const adjPos = chestPos.plus(offset);
      const adjBlock = bot.blockAt(adjPos);

      if (adjBlock && adjBlock.name.includes("chest")) {
        try {
          await new Promise(resolve => setTimeout(resolve, 500));
          chest = await Promise.race([
            bot.openContainer(adjBlock),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("timeout")), 5000)
            )
          ]) as any;
          break; // Success!
        } catch {
          continue; // Try next adjacent block
        }
      }
    }

    if (!chest) {
      throw new Error(`Cannot open chest at (${x}, ${y}, ${z}). It may be in use by another player. Try again later.`);
    }
  }

  const items = chest.containerItems();

  if (items.length === 0) {
    chest.close();
    return `Chest at (${x}, ${y}, ${z}) is empty.`;
  }

  const itemList = items.map((i: any) => `${i.name}(${i.count})`).join(", ");
  chest.close();
  return `Chest at (${x}, ${y}, ${z}) contains: ${itemList}`;
}

/**
 * Store items from inventory into a nearby chest
 */
export async function storeInChest(
  managed: ManagedBot,
  itemName: string,
  count?: number,
  x?: number,
  y?: number,
  z?: number
): Promise<string> {
  const bot = managed.bot;

  // Use specified coordinates or find nearest chest
  let chestBlock;
  if (x !== undefined && y !== undefined && z !== undefined) {
    const chestPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    chestBlock = bot.blockAt(chestPos);
    if (!chestBlock || !chestBlock.name.includes("chest")) {
      throw new Error(`No chest at (${x}, ${y}, ${z}). Found: ${chestBlock?.name || "nothing"}`);
    }
  } else {
    chestBlock = bot.findBlock({
      matching: (block) => block.name.includes("chest"),
      maxDistance: 4,
    });
  }

  if (!chestBlock) {
    throw new Error("No chest within 4 blocks. Place a chest first.");
  }

  // Find item in inventory
  const item = bot.inventory.items().find(i => i.name === itemName);
  if (!item) {
    const inventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
    throw new Error(`No ${itemName} in inventory. Have: ${inventory}`);
  }

  // Move closer to chest to ensure we're within interaction range (1.5 blocks)
  const chestPos = chestBlock.position;
  const distance = bot.entity.position.distanceTo(chestPos);
  if (distance > 3) {
    const goal = new goals.GoalNear(chestPos.x, chestPos.y, chestPos.z, 2);
    await bot.pathfinder.goto(goal);
  }

  // Acquire chest lock to prevent multi-bot sync bugs
  let lockAcquired = acquireChestLock(chestPos.x, chestPos.y, chestPos.z);
  let lockRetries = 0;
  while (!lockAcquired && lockRetries < 5) {
    console.error(`[Storage] Chest (${chestPos.x},${chestPos.y},${chestPos.z}) is locked by another bot. Waiting 2s... (retry ${lockRetries+1}/5)`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    lockAcquired = acquireChestLock(chestPos.x, chestPos.y, chestPos.z);
    lockRetries++;
  }

  if (!lockAcquired) {
    throw new Error(`Failed to acquire chest lock after ${lockRetries} retries. Chest may be in use by another bot.`);
  }

  console.error(`[Storage] Lock acquired for chest (${chestPos.x},${chestPos.y},${chestPos.z}) by ${bot.username}`);

  // Wait a moment if chest was recently used (prevent timing issues)
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Retry openContainer with timeout to handle multi-bot chest access
  let chest: any;
  let retryCount = 0;
  const maxRetries = 3;
  while (retryCount < maxRetries) {
    try {
      chest = await Promise.race([
        bot.openContainer(chestBlock),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Chest open timeout")), 8000))
      ]);
      break;
    } catch (err) {
      retryCount++;
      if (retryCount >= maxRetries) {
        releaseChestLock(chestPos.x, chestPos.y, chestPos.z);
        throw new Error(`Failed to open chest after ${maxRetries} retries: ${err}`);
      }
      console.error(`[Storage] Chest open failed (attempt ${retryCount}/${maxRetries}), retrying in 2s...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  const storeCount = count || item.count;
  const actualCount = Math.min(storeCount, item.count);

  await chest.deposit(item.type, null, actualCount);
  chest.close();
  releaseChestLock(chestPos.x, chestPos.y, chestPos.z);

  const newInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
  return `Stored ${actualCount}x ${itemName} in chest at (${chestBlock.position.x}, ${chestBlock.position.y}, ${chestBlock.position.z}). Inventory: ${newInventory}`;
}

/**
 * Take items from a nearby chest
 */
export async function takeFromChest(
  managed: ManagedBot,
  itemName: string,
  count?: number,
  x?: number,
  y?: number,
  z?: number
): Promise<string> {
  const bot = managed.bot;

  // Use specified coordinates or find nearest chest
  let chestBlock;
  if (x !== undefined && y !== undefined && z !== undefined) {
    const chestPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    chestBlock = bot.blockAt(chestPos);
    if (!chestBlock || !chestBlock.name.includes("chest")) {
      throw new Error(`No chest at (${x}, ${y}, ${z}). Found: ${chestBlock?.name || "nothing"}`);
    }
  } else {
    chestBlock = bot.findBlock({
      matching: (block) => block.name.includes("chest"),
      maxDistance: 4,
    });
  }

  if (!chestBlock) {
    throw new Error("No chest within 4 blocks.");
  }

  // Move closer to chest to ensure we're within interaction range (1.5 blocks)
  const chestPos = chestBlock.position;
  const distance = bot.entity.position.distanceTo(chestPos);
  if (distance > 3) {
    const goal = new goals.GoalNear(chestPos.x, chestPos.y, chestPos.z, 2);
    await bot.pathfinder.goto(goal);
  }

  // Acquire chest lock to prevent multi-bot sync bugs
  let lockAcquired = acquireChestLock(chestPos.x, chestPos.y, chestPos.z);
  let lockRetries = 0;
  while (!lockAcquired && lockRetries < 5) {
    console.error(`[Storage] Chest (${chestPos.x},${chestPos.y},${chestPos.z}) is locked by another bot. Waiting 2s... (retry ${lockRetries+1}/5)`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    lockAcquired = acquireChestLock(chestPos.x, chestPos.y, chestPos.z);
    lockRetries++;
  }

  if (!lockAcquired) {
    throw new Error(`Failed to acquire chest lock after ${lockRetries} retries. Chest may be in use by another bot.`);
  }

  console.error(`[Storage] Lock acquired for chest (${chestPos.x},${chestPos.y},${chestPos.z}) by ${bot.username}`);

  // Wait a moment if chest was recently used (prevent timing issues)
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Retry openContainer with timeout to handle multi-bot chest access
  let chest: any;
  let retryCount = 0;
  const maxRetries = 3;
  while (retryCount < maxRetries) {
    try {
      chest = await Promise.race([
        bot.openContainer(chestBlock),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Chest open timeout")), 8000))
      ]);
      break;
    } catch (err) {
      retryCount++;
      if (retryCount >= maxRetries) {
        throw new Error(`Failed to open chest after ${maxRetries} retries: ${err}`);
      }
      console.error(`[Storage] Chest open failed (attempt ${retryCount}/${maxRetries}), retrying in 2s...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  const items = chest.containerItems();

  const item = items.find((i: any) => i.name === itemName);
  if (!item) {
    const chestContents = items.map((i: any) => `${i.name}(${i.count})`).join(", ") || "empty";
    chest.close();
    releaseChestLock(chestPos.x, chestPos.y, chestPos.z);
    throw new Error(`No ${itemName} in chest. Chest contains: ${chestContents}`);
  }

  const takeCount = count || item.count;
  const actualCount = Math.min(takeCount, item.count);

  // Record inventory before withdrawal for verification
  const inventoryBefore = bot.inventory.items().filter(i => i.name === itemName).reduce((sum, i) => sum + i.count, 0);
  console.error(`[Storage] Before withdrawal: ${itemName} count in inventory = ${inventoryBefore}`);

  try {
    await chest.withdraw(item.type, null, actualCount);
  } catch (err) {
    chest.close();
    releaseChestLock(chestPos.x, chestPos.y, chestPos.z);
    throw new Error(`Failed to withdraw from chest: ${err}`);
  }

  // Wait for inventory to sync (multi-bot chest access needs more time)
  // Extended from 1.5s to 3s to prevent item void bug
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Verify items were actually withdrawn
  const inventoryAfter = bot.inventory.items().filter(i => i.name === itemName).reduce((sum, i) => sum + i.count, 0);
  const withdrawnCount = inventoryAfter - inventoryBefore;
  console.error(`[Storage] After withdrawal: ${itemName} count in inventory = ${inventoryAfter}, withdrawn = ${withdrawnCount}`);

  // Only throw if zero items were withdrawn (partial success is acceptable due to sync delays)
  if (withdrawnCount === 0) {
    // DO NOT close chest before retry — keep it open to prevent server rollback
    console.error(`[Storage] CRITICAL: Zero items withdrawn after 3s wait. Waiting additional 2s before giving up...`);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Final verification
    const inventoryFinal = bot.inventory.items().filter(i => i.name === itemName).reduce((sum, i) => sum + i.count, 0);
    const finalWithdrawn = inventoryFinal - inventoryBefore;

    if (finalWithdrawn === 0) {
      chest.close();
      releaseChestLock(chestPos.x, chestPos.y, chestPos.z);
      throw new Error(`Failed to withdraw any ${itemName} from chest after 5s total wait. Requested ${actualCount} but got 0. ITEM MAY BE LOST IN VOID.`);
    }

    console.error(`[Storage] Recovery: ${finalWithdrawn}x ${itemName} appeared after extended wait.`);
    chest.close();
    releaseChestLock(chestPos.x, chestPos.y, chestPos.z);
    return `Took ${finalWithdrawn}x ${itemName} from chest (requested ${actualCount}, delayed sync). Inventory: ${bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ")}`;
  }

  chest.close();
  releaseChestLock(chestPos.x, chestPos.y, chestPos.z);

  // Additional wait for full inventory sync before returning
  await new Promise(resolve => setTimeout(resolve, 500));

  const newInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
  return `Took ${withdrawnCount}x ${itemName} from chest (requested ${actualCount}). Inventory: ${newInventory}`;
}

/**
 * List contents of nearest chest
 */
export async function listChest(managed: ManagedBot): Promise<string> {
  const bot = managed.bot;

  // Find nearby chest (within interaction range)
  const chestBlock = bot.findBlock({
    matching: (block) => block.name.includes("chest"),
    maxDistance: 4,
  });

  if (!chestBlock) {
    return "No chest found within 4 blocks. Move closer to a chest first.";
  }

  const pos = chestBlock.position;
  const distance = bot.entity.position.distanceTo(pos);

  if (distance > 4) {
    return `Chest found at (${pos.x}, ${pos.y}, ${pos.z}) but too far (${distance.toFixed(1)}m). Move closer first.`;
  }

  // Wait a moment to prevent timing issues
  await new Promise(resolve => setTimeout(resolve, 500));

  const chest = await bot.openContainer(chestBlock);
  const items = chest.containerItems();

  if (items.length === 0) {
    chest.close();
    return `Chest at (${pos.x}, ${pos.y}, ${pos.z}) is empty.`;
  }

  const itemList = items.map(i => `${i.name}(${i.count})`).join(", ");
  chest.close();
  return `Chest at (${pos.x}, ${pos.y}, ${pos.z}): ${itemList}`;
}
