import { Vec3 } from "vec3";
import type { ManagedBot } from "./types.js";
import pkg from "mineflayer-pathfinder";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const { goals } = pkg;

/**
 * File-based chest lock directory (shared across all bot processes)
 * Use project root (relative to this file) instead of process.cwd()
 * because Claude Desktop launches with cwd=/ which causes ENOENT
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const LOCK_DIR = path.join(PROJECT_ROOT, ".chest-locks");
const LOCK_TIMEOUT_MS = 10000; // 10s max lock duration

// Ensure lock directory exists
if (!fs.existsSync(LOCK_DIR)) {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
}

/**
 * Acquire lock for chest access using file system
 * Returns true if lock acquired, false if chest is locked by another bot
 */
function acquireChestLock(x: number, y: number, z: number): boolean {
  const lockKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  const lockFile = path.join(LOCK_DIR, `${lockKey}.lock`);
  const now = Date.now();

  // Clean up expired locks
  try {
    const files = fs.readdirSync(LOCK_DIR);
    files.forEach(file => {
      const filePath = path.join(LOCK_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > LOCK_TIMEOUT_MS) {
          fs.unlinkSync(filePath);
          console.error(`[Storage] Cleaned up expired lock: ${file}`);
        }
      } catch (err) {
        // Ignore errors (file may have been deleted by another process)
      }
    });
  } catch (err) {
    console.error(`[Storage] Failed to clean up locks: ${err}`);
  }

  // Check if lock file exists
  if (fs.existsSync(lockFile)) {
    try {
      const stats = fs.statSync(lockFile);
      if (now - stats.mtimeMs < LOCK_TIMEOUT_MS) {
        return false; // Chest is locked and lock is still valid
      }
      // Lock expired, delete it
      fs.unlinkSync(lockFile);
    } catch (err) {
      // File may have been deleted, treat as unlocked
    }
  }

  // Acquire lock by creating file
  try {
    fs.writeFileSync(lockFile, now.toString());
    return true;
  } catch (err) {
    console.error(`[Storage] Failed to acquire lock for ${lockKey}: ${err}`);
    return false;
  }
}

/**
 * Release lock for chest access
 */
function releaseChestLock(x: number, y: number, z: number): void {
  const lockKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  const lockFile = path.join(LOCK_DIR, `${lockKey}.lock`);
  try {
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
  } catch (err) {
    console.error(`[Storage] Failed to release lock for ${lockKey}: ${err}`);
  }
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

  // If too far, try to move closer (with timeout to prevent hang)
  if (initialDistance > 4) {
    const GoalGetToBlock = goals.GoalGetToBlock;

    try {
      await Promise.race([
        bot.pathfinder.goto(new GoalGetToBlock(chestPos.x, chestPos.y, chestPos.z)),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Navigation timeout")), 15000))
      ]);
    } catch (err) {
      try { bot.pathfinder.setGoal(null); } catch (_) {}
      throw new Error(`Chest at (${x}, ${y}, ${z}) is ${initialDistance.toFixed(1)} blocks away and unreachable. Move closer manually first.`);
    }

    // Verify we're close enough now
    const finalDistance = bot.entity.position.distanceTo(chestPos);
    if (finalDistance > 4) {
      throw new Error(`Still too far from chest (${finalDistance.toFixed(1)} blocks). Move closer manually.`);
    }
  }

  // Close any currently open window to prevent "in use" errors on reconnect
  if (bot.currentWindow) {
    bot.closeWindow(bot.currentWindow);
    await new Promise(resolve => setTimeout(resolve, 300));
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

  // Wait for chest window contents to be populated by server
  await new Promise(resolve => setTimeout(resolve, 500));

  // Retry containerItems() in case data hasn't arrived yet
  let items = chest.containerItems();
  if (items.length === 0) {
    await new Promise(resolve => setTimeout(resolve, 500));
    items = chest.containerItems();
  }

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
    // Search within interaction range only (4 blocks) to avoid mixing up nearby chests.
    // Always specify coordinates if multiple chests are nearby.
    chestBlock = bot.findBlock({
      matching: (block) => block.name.includes("chest"),
      maxDistance: 4,
    });
  }

  if (!chestBlock) {
    throw new Error("No chest within 4 blocks. Move closer to a chest or specify coordinates (x, y, z) to target a specific chest.");
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
    try {
      await Promise.race([
        bot.pathfinder.goto(goal),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Navigation timeout")), 15000))
      ]);
    } catch (_) {
      try { bot.pathfinder.setGoal(null); } catch (__) {}
      throw new Error(`Cannot reach chest at (${chestPos.x}, ${chestPos.y}, ${chestPos.z}) — ${distance.toFixed(1)} blocks away. Move closer first.`);
    }
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

  // Record inventory before deposit for verification
  const invCountBefore = bot.inventory.items().filter(i => i.name === itemName).reduce((sum, i) => sum + i.count, 0);

  try {
    await chest.deposit(item.type, null, actualCount);
  } catch (err) {
    chest.close();
    releaseChestLock(chestPos.x, chestPos.y, chestPos.z);
    throw new Error(`Failed to deposit into chest: ${err}`);
  }

  // Wait for inventory sync — event-driven with timeout fallback
  // Previous 3s fixed wait was too slow for batch deposits
  await new Promise<void>(resolve => {
    const onUpdate = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { bot.inventory.removeListener("updateSlot", onUpdate); resolve(); }, 1500);
    bot.inventory.once("updateSlot", onUpdate);
  });

  // Verify items were actually removed from inventory (i.e., deposit succeeded)
  const invCountAfter = bot.inventory.items().filter(i => i.name === itemName).reduce((sum, i) => sum + i.count, 0);
  const storedCount = invCountBefore - invCountAfter;

  if (storedCount === 0) {
    // Deposit may have failed silently - wait a bit more and check again
    await new Promise(resolve => setTimeout(resolve, 1500));
    const invCountFinal = bot.inventory.items().filter(i => i.name === itemName).reduce((sum, i) => sum + i.count, 0);
    const storedCountFinal = invCountBefore - invCountFinal;
    if (storedCountFinal === 0) {
      chest.close();
      releaseChestLock(chestPos.x, chestPos.y, chestPos.z);
      throw new Error(`Deposit of ${actualCount}x ${itemName} may have failed: inventory unchanged after 3s wait. Items may not have been stored.`);
    }
    chest.close();
    releaseChestLock(chestPos.x, chestPos.y, chestPos.z);
    const newInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
    return `Stored ${storedCountFinal}x ${itemName} in chest at (${chestBlock.position.x}, ${chestBlock.position.y}, ${chestBlock.position.z}) (delayed sync). Inventory: ${newInventory}`;
  }

  chest.close();
  releaseChestLock(chestPos.x, chestPos.y, chestPos.z);

  const newInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
  return `Stored ${storedCount}x ${itemName} in chest at (${chestBlock.position.x}, ${chestBlock.position.y}, ${chestBlock.position.z}). Inventory: ${newInventory}`;
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
    // Search within interaction range only (4 blocks) to avoid mixing up nearby chests.
    // Always specify coordinates if multiple chests are nearby.
    chestBlock = bot.findBlock({
      matching: (block) => block.name.includes("chest"),
      maxDistance: 4,
    });
  }

  if (!chestBlock) {
    throw new Error("No chest within 4 blocks. Move closer to a chest or specify coordinates (x, y, z) to target a specific chest.");
  }

  // Move closer to chest to ensure we're within interaction range (1.5 blocks)
  const chestPos = chestBlock.position;
  const distance = bot.entity.position.distanceTo(chestPos);
  if (distance > 3) {
    const goal = new goals.GoalNear(chestPos.x, chestPos.y, chestPos.z, 2);
    try {
      await Promise.race([
        bot.pathfinder.goto(goal),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Navigation timeout")), 15000))
      ]);
    } catch (_) {
      try { bot.pathfinder.setGoal(null); } catch (__) {}
      throw new Error(`Cannot reach chest at (${chestPos.x}, ${chestPos.y}, ${chestPos.z}) — ${distance.toFixed(1)} blocks away. Move closer first.`);
    }
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

  // Wait for chest window contents to be populated by server (prevents chest sync bug)
  await new Promise(resolve => setTimeout(resolve, 500));

  // Retry containerItems() in case data hasn't arrived yet
  let items = chest.containerItems();
  if (items.length === 0) {
    await new Promise(resolve => setTimeout(resolve, 500));
    items = chest.containerItems();
  }

  const item = items.find((i: any) => i.name === itemName);
  if (!item) {
    const chestContents = items.map((i: any) => `${i.name}(${i.count})`).join(", ") || "empty";
    chest.close();
    releaseChestLock(chestPos.x, chestPos.y, chestPos.z);
    throw new Error(`No ${itemName} in chest. Chest contains: ${chestContents}`);
  }

  const takeCount = count || item.count;
  const actualCount = Math.min(takeCount, item.count);

  // Check if player inventory has space to receive items.
  // Mineflayer's chest.withdraw() silently fails (no error, no items transferred) when
  // player inventory is full. This was causing misleading "ITEM MAY BE LOST IN VOID" errors.
  // 36 slots = 9 hotbar + 27 main inventory. Each distinct stack occupies 1 slot.
  const usedSlots = bot.inventory.items().length;
  const MAX_INVENTORY_SLOTS = 36;
  if (usedSlots >= MAX_INVENTORY_SLOTS) {
    chest.close();
    releaseChestLock(chestPos.x, chestPos.y, chestPos.z);
    throw new Error(`Cannot take ${itemName} from chest: inventory is full (${usedSlots}/${MAX_INVENTORY_SLOTS} slots used). Drop or store some items first to make room.`);
  }

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

  // Wait for inventory to sync — use event-driven approach with timeout fallback
  // Previous 5s fixed wait was too slow for batch operations (15 items = 75s+)
  await new Promise<void>(resolve => {
    const onUpdate = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { bot.inventory.removeListener("updateSlot", onUpdate); resolve(); }, 2000);
    bot.inventory.once("updateSlot", onUpdate);
  });

  // Verify items were actually withdrawn
  const inventoryAfter = bot.inventory.items().filter(i => i.name === itemName).reduce((sum, i) => sum + i.count, 0);
  const withdrawnCount = inventoryAfter - inventoryBefore;
  console.error(`[Storage] After withdrawal: ${itemName} count in inventory = ${inventoryAfter}, withdrawn = ${withdrawnCount}`);

  // Also check if chest lost the items (inventory sync may lag but chest reflects truth)
  const chestItemsAfterWithdraw = chest.containerItems();
  const chestCountAfter = chestItemsAfterWithdraw.filter((i: any) => i.name === itemName).reduce((sum: number, i: any) => sum + i.count, 0);
  const chestCountBefore = item.count;
  const chestReduced = chestCountBefore - chestCountAfter;
  console.error(`[Storage] Chest ${itemName}: before=${chestCountBefore}, after=${chestCountAfter}, reduced=${chestReduced}`);

  // Only throw if zero items were withdrawn AND chest didn't lose items
  if (withdrawnCount === 0) {
    // If chest lost items, they're in transit — wait more
    if (chestReduced > 0) {
      console.error(`[Storage] Chest lost ${chestReduced} items but inventory hasn't updated yet. Waiting 3s more...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      const inventoryRecovery = bot.inventory.items().filter(i => i.name === itemName).reduce((sum, i) => sum + i.count, 0);
      const recoveredCount = inventoryRecovery - inventoryBefore;
      if (recoveredCount > 0) {
        console.error(`[Storage] Recovery: ${recoveredCount}x ${itemName} appeared after extended wait.`);
        chest.close();
        releaseChestLock(chestPos.x, chestPos.y, chestPos.z);
        return `Took ${recoveredCount}x ${itemName} from chest (requested ${actualCount}, delayed sync). Inventory: ${bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ")}`;
      }
    }

    // Retry: close chest and re-open for a fresh withdraw attempt
    console.error(`[Storage] CRITICAL: Zero items withdrawn. Retrying with chest close/reopen...`);
    chest.close();
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const chest2 = await Promise.race([
        bot.openContainer(chestBlock),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Chest reopen timeout")), 8000))
      ]) as any;
      await new Promise(resolve => setTimeout(resolve, 500));

      const items2 = chest2.containerItems();
      const retryItem = items2.find((i: any) => i.name === itemName);
      if (retryItem) {
        const retryCount = Math.min(actualCount, retryItem.count);
        await chest2.withdraw(retryItem.type, null, retryCount);
        await new Promise(resolve => setTimeout(resolve, 5000));

        const inventoryRetry = bot.inventory.items().filter(i => i.name === itemName).reduce((sum, i) => sum + i.count, 0);
        const retryWithdrawn = inventoryRetry - inventoryBefore;
        chest2.close();

        if (retryWithdrawn > 0) {
          console.error(`[Storage] Retry succeeded: ${retryWithdrawn}x ${itemName} withdrawn.`);
          releaseChestLock(chestPos.x, chestPos.y, chestPos.z);
          return `Took ${retryWithdrawn}x ${itemName} from chest (retry succeeded). Inventory: ${bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ")}`;
        }
      } else {
        chest2.close();
      }
    } catch (retryErr) {
      console.error(`[Storage] Retry failed: ${retryErr}`);
    }

    releaseChestLock(chestPos.x, chestPos.y, chestPos.z);
    throw new Error(`Failed to withdraw any ${itemName} from chest after retry. Requested ${actualCount} but got 0.`);
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

  // Find nearby chest (within 32 blocks, navigate if needed)
  const chestBlock = bot.findBlock({
    matching: (block) => block.name.includes("chest"),
    maxDistance: 32,
  });

  if (!chestBlock) {
    return "No chest found within 32 blocks.";
  }

  const pos = chestBlock.position;
  const distance = bot.entity.position.distanceTo(pos);

  // Navigate to chest if too far (with timeout to prevent infinite hang)
  if (distance > 4) {
    const GoalGetToBlock = goals.GoalGetToBlock;
    try {
      await Promise.race([
        bot.pathfinder.goto(new GoalGetToBlock(pos.x, pos.y, pos.z)),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Navigation timeout")), 15000))
      ]);
    } catch (_) {
      try { bot.pathfinder.setGoal(null); } catch (__) {}
      return `Chest found at (${pos.x}, ${pos.y}, ${pos.z}) but cannot reach it (${distance.toFixed(1)} blocks away).`;
    }

    // Verify we're close enough now
    const finalDistance = bot.entity.position.distanceTo(pos);
    if (finalDistance > 4) {
      return `Chest at (${pos.x}, ${pos.y}, ${pos.z}) is ${finalDistance.toFixed(1)} blocks away after navigation. Move closer manually.`;
    }
  }

  // Close any currently open window to prevent "in use" errors
  if (bot.currentWindow) {
    bot.closeWindow(bot.currentWindow);
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // Wait a moment to prevent timing issues
  await new Promise(resolve => setTimeout(resolve, 500));

  // Open chest with timeout to prevent hang (matches openChest behavior)
  let chest: any;
  try {
    chest = await Promise.race([
      bot.openContainer(chestBlock),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Chest open timeout")), 5000))
    ]);
  } catch (err) {
    return `Cannot open chest at (${pos.x}, ${pos.y}, ${pos.z}). It may be obstructed or in use. Error: ${err}`;
  }

  // Wait for chest window contents to be populated by server
  await new Promise(resolve => setTimeout(resolve, 500));

  let items = chest.containerItems();
  // Retry once if empty (server may need more time to send contents)
  if (items.length === 0) {
    await new Promise(resolve => setTimeout(resolve, 500));
    items = chest.containerItems();
  }

  if (items.length === 0) {
    chest.close();
    return `Chest at (${pos.x}, ${pos.y}, ${pos.z}) is empty.`;
  }

  const itemList = items.map((i: any) => `${i.name}(${i.count})`).join(", ");
  chest.close();
  return `Chest at (${pos.x}, ${pos.y}, ${pos.z}): ${itemList}`;
}
