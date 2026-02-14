import { Vec3 } from "vec3";
import pathfinderPkg from "mineflayer-pathfinder";
const { goals } = pathfinderPkg;
import type { ManagedBot } from "./types.js";

/**
 * Open a chest and list its contents
 */
export async function openChest(
  managed: ManagedBot,
  x: number,
  y: number,
  z: number
): Promise<string> {
  const bot = managed.bot;
  const chestPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
  const chestBlock = bot.blockAt(chestPos);

  if (!chestBlock || !chestBlock.name.includes("chest")) {
    throw new Error(`No chest at (${x}, ${y}, ${z}). Found: ${chestBlock?.name || "nothing"}`);
  }

  // Move close to chest if needed
  const distance = bot.entity.position.distanceTo(chestPos);
  if (distance > 4) {
    const pathfinder = bot.pathfinder;
    const { GoalNear } = goals;
    await pathfinder.goto(new GoalNear(chestPos.x, chestPos.y, chestPos.z, 2));
  }

  // Look at chest before opening
  await bot.lookAt(chestPos.offset(0.5, 0.5, 0.5));
  await new Promise(resolve => setTimeout(resolve, 500));

  const chest = await bot.openContainer(chestBlock);
  const items = chest.containerItems();

  if (items.length === 0) {
    chest.close();
    return `Chest at (${x}, ${y}, ${z}) is empty.`;
  }

  const itemList = items.map(i => `${i.name}(${i.count})`).join(", ");
  chest.close();
  return `Chest at (${x}, ${y}, ${z}) contains: ${itemList}`;
}

/**
 * Store items from inventory into a nearby chest
 */
export async function storeInChest(
  managed: ManagedBot,
  itemName: string,
  count?: number
): Promise<string> {
  const bot = managed.bot;

  // Find nearby chest
  const chestBlock = bot.findBlock({
    matching: (block) => block.name.includes("chest"),
    maxDistance: 32,
  });

  if (!chestBlock) {
    throw new Error("No chest within 32 blocks. Place a chest first.");
  }

  // Find item in inventory
  const item = bot.inventory.items().find(i => i.name === itemName);
  if (!item) {
    const inventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
    throw new Error(`No ${itemName} in inventory. Have: ${inventory}`);
  }

  // Move close to chest if needed
  const pos = chestBlock.position;
  const distance = bot.entity.position.distanceTo(pos);
  if (distance > 4) {
    const pathfinder = bot.pathfinder;
    const { GoalNear } = goals;
    await pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 2));
  }

  // Look at chest before opening
  await bot.lookAt(pos.offset(0.5, 0.5, 0.5));
  await new Promise(resolve => setTimeout(resolve, 500));

  const chest = await bot.openContainer(chestBlock);
  const storeCount = count || item.count;
  const actualCount = Math.min(storeCount, item.count);

  await chest.deposit(item.type, null, actualCount);
  chest.close();

  const newInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
  return `Stored ${actualCount}x ${itemName} in chest at (${chestBlock.position.x}, ${chestBlock.position.y}, ${chestBlock.position.z}). Inventory: ${newInventory}`;
}

/**
 * Take items from a nearby chest
 */
export async function takeFromChest(
  managed: ManagedBot,
  itemName: string,
  count?: number
): Promise<string> {
  const bot = managed.bot;

  // Find nearby chest
  const chestBlock = bot.findBlock({
    matching: (block) => block.name.includes("chest"),
    maxDistance: 32,
  });

  if (!chestBlock) {
    throw new Error("No chest within 32 blocks.");
  }

  // Move close to chest if needed
  const pos = chestBlock.position;
  const distance = bot.entity.position.distanceTo(pos);
  if (distance > 4) {
    const pathfinder = bot.pathfinder;
    const { GoalNear } = goals;
    await pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 2));
  }

  // Look at chest before opening
  await bot.lookAt(pos.offset(0.5, 0.5, 0.5));
  await new Promise(resolve => setTimeout(resolve, 500));

  const chest = await bot.openContainer(chestBlock);
  const items = chest.containerItems();

  const item = items.find(i => i.name === itemName);
  if (!item) {
    const chestContents = items.map(i => `${i.name}(${i.count})`).join(", ") || "empty";
    chest.close();
    throw new Error(`No ${itemName} in chest. Chest contains: ${chestContents}`);
  }

  const takeCount = count || item.count;
  const actualCount = Math.min(takeCount, item.count);

  await chest.withdraw(item.type, null, actualCount);
  chest.close();

  const newInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
  return `Took ${actualCount}x ${itemName} from chest. Inventory: ${newInventory}`;
}

/**
 * List contents of nearest chest
 */
export async function listChest(managed: ManagedBot): Promise<string> {
  const bot = managed.bot;

  // Find nearby chest
  const chestBlock = bot.findBlock({
    matching: (block) => block.name.includes("chest"),
    maxDistance: 32,
  });

  if (!chestBlock) {
    return "No chest found within 32 blocks.";
  }

  const pos = chestBlock.position;

  // Move close to chest if needed
  const distance = bot.entity.position.distanceTo(pos);
  if (distance > 4) {
    const pathfinder = bot.pathfinder;
    const { GoalNear } = goals;
    await pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, 2));
  }

  // Look at chest before opening
  await bot.lookAt(pos.offset(0.5, 0.5, 0.5));
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
