import { BotCore } from "./bot-core.js";
import type { BotConfig, ManagedBot, ChatMessage, GameEvent } from "./types.js";

// Import bot-info functions
import {
  getChatMessages,
  getGameEvents,
  getSurroundings,
  findBlock,
  findEntities,
  getInventory,
  getStatus,
  getEquipment,
  getNearbyEntities,
  getBiome,
} from "./bot-info.js";

// Import bot-movement functions
import {
  getPosition,
  moveTo as moveToBasic,
  pillarUp,
  flee as fleeBasic,
  exploreForBiome,
  digTunnel,
  mount,
  dismount,
} from "./bot-movement.js";

// Import bot-blocks functions
import {
  placeBlock as placeBlockBasic,
  digBlock as digBlockBasic,
  levelGround as levelGroundBasic,
  activateBlock as activateBlockBasic,
} from "./bot-blocks.js";

// Import bot-crafting functions
import {
  listAllRecipes,
  listCraftableNow,
  craftItem as craftItemBasic,
  smeltItem as smeltItemBasic,
  enchant as enchantBasic,
  useAnvil as useAnvilBasic,
  brewPotion as brewPotionBasic,
} from "./bot-crafting.js";

// Import bot-items functions
import {
  collectNearbyItems as collectNearbyItemsBasic,
  listDroppedItems as listDroppedItemsBasic,
  useItem as useItemBasic,
  dropItem as dropItemBasic,
  equipArmor as equipArmorBasic,
  equipWeapon as equipWeaponBasic,
  equipItem as equipItemBasic,
} from "./bot-items.js";

// Import bot-storage functions
import {
  openChest as openChestBasic,
  storeInChest as storeInChestBasic,
  takeFromChest as takeFromChestBasic,
  listChest as listChestBasic,
} from "./bot-storage.js";

// Import bot-survival functions
import {
  chat as chatBasic,
  sleep as sleepBasic,
  attack as attackBasic,
  fight as fightBasic,
  eat as eatBasic,
  fish as fishBasic,
  tradeWithVillager as tradeWithVillagerBasic,
  respawn as respawnBasic,
  wake as wakeBasic,
  elytraFly as elytraFlyBasic,
  updateSign as updateSignBasic,
} from "./bot-survival.js";

/**
 * Unified BotManager class that extends BotCore
 * Provides wrapper methods for all extracted functions
 */
export class BotManager extends BotCore {
  // ========== Bot Info Methods ==========

  getChatMessages(username: string, clear: boolean = true): ChatMessage[] {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return getChatMessages(managed, clear);
  }

  getGameEvents(username: string, clear: boolean = true, lastN?: number): GameEvent[] {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return getGameEvents(managed, clear, lastN);
  }

  getSurroundings(username: string): string {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return getSurroundings(managed.bot);
  }

  findBlock(username: string, blockName: string, maxDistance: number = 10): string {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return findBlock(managed.bot, blockName, maxDistance);
  }

  findEntities(username: string, entityType?: string, maxDistance: number = 32): string {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return findEntities(managed.bot, entityType, maxDistance);
  }

  getInventory(username: string): { name: string; count: number }[] {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return getInventory(managed.bot);
  }

  getStatus(username: string): string {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return getStatus(managed.bot);
  }

  getEquipment(username: string): string {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return getEquipment(managed.bot);
  }

  getNearbyEntities(username: string, range: number = 16, type: string = "all"): string {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return getNearbyEntities(managed.bot, range, type);
  }

  async getBiome(username: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await getBiome(managed.bot);
  }

  // ========== Movement Methods ==========

  getPosition(username: string): { x: number; y: number; z: number } {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return getPosition(managed);
  }

  async moveTo(username: string, x: number, y: number, z: number): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await moveToBasic(managed, x, y, z);
  }

  async pillarUp(username: string, height: number = 1): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await pillarUp(managed, height);
  }

  async flee(username: string, distance: number = 20): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await fleeBasic(managed, distance);
  }

  async exploreForBiome(
    username: string,
    targetBiome: string,
    direction: "north" | "south" | "east" | "west" | "random",
    maxBlocks: number = 200
  ): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await exploreForBiome(managed, targetBiome, direction, maxBlocks);
  }

  async digTunnel(
    username: string,
    direction: "north" | "south" | "east" | "west" | "down",
    length: number = 10
  ): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await digTunnel(managed, direction, length);
  }

  async mount(username: string, entityName?: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await mount(managed, entityName);
  }

  async dismount(username: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await dismount(managed);
  }

  // ========== Block Manipulation Methods ==========

  async placeBlock(
    username: string,
    blockType: string,
    x: number,
    y: number,
    z: number,
    useCommand: boolean = false
  ): Promise<{ success: boolean; message: string }> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await placeBlockBasic(
      managed,
      blockType,
      x,
      y,
      z,
      useCommand,
      this.delay.bind(this),
      this.getBriefStatus.bind(this)
    );
  }

  async digBlock(username: string, x: number, y: number, z: number, useCommand: boolean = false, autoCollect: boolean = true): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);

    // Create moveToBasic wrapper for digBlock
    const moveToBasicWrapper = async (user: string, tx: number, ty: number, tz: number) => {
      const result = await this.moveTo(user, tx, ty, tz);
      return { success: true, message: result };
    };

    return await digBlockBasic(
      managed,
      x,
      y,
      z,
      useCommand,
      this.delay.bind(this),
      moveToBasicWrapper,
      this.getBriefStatus.bind(this),
      autoCollect
    );
  }

  async levelGround(
    username: string,
    options: {
      centerX: number;
      centerZ: number;
      radius: number;
      targetY?: number;
      fillBlock?: string;
      mode: "dig" | "fill" | "both";
    }
  ): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await levelGroundBasic(
      managed,
      options,
      this.delay.bind(this),
      this.collectNearbyItems.bind(this),
      this.getBriefStatus.bind(this)
    );
  }

  async activateBlock(username: string, x: number, y: number, z: number): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);

    // Create moveTo wrapper for activateBlock
    const moveToWrapper = async (user: string, tx: number, ty: number, tz: number) => {
      return await this.moveTo(user, tx, ty, tz);
    };

    return await activateBlockBasic(managed, x, y, z, moveToWrapper);
  }

  // ========== Crafting Methods ==========

  async listAllRecipes(username: string, category?: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await listAllRecipes(managed, category);
  }

  async listCraftableNow(username: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await listCraftableNow(managed);
  }

  async craftItem(username: string, itemName: string, count: number = 1): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await craftItemBasic(managed, itemName, count);
  }

  async smeltItem(username: string, itemName: string, count: number = 1): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await smeltItemBasic(managed, itemName, count);
  }

  async enchant(username: string, itemName: string, enchantmentLevel: number = 1): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await enchantBasic(managed, itemName, enchantmentLevel);
  }

  async brewPotion(username: string, basePotionName: string, ingredientName: string, count: number = 1): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await brewPotionBasic(managed, basePotionName, ingredientName, count);
  }

  async useAnvil(username: string, targetItem: string, materialItem?: string, newName?: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await useAnvilBasic(managed, targetItem, materialItem, newName);
  }

  // ========== Item Methods ==========

  async collectNearbyItems(username: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await collectNearbyItemsBasic(managed.bot);
  }

  listDroppedItems(username: string, range: number = 10): string {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return listDroppedItemsBasic(managed.bot, range);
  }

  async useItem(username: string, itemName?: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await useItemBasic(managed.bot, itemName);
  }

  async dropItem(username: string, itemName: string, count?: number): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await dropItemBasic(managed.bot, itemName, count);
  }

  async equipArmor(username: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await equipArmorBasic(managed.bot);
  }

  async equipWeapon(username: string, weaponName?: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await equipWeaponBasic(managed.bot, weaponName);
  }

  async equipItem(username: string, itemName: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await equipItemBasic(managed.bot, itemName);
  }

  // ========== Storage Methods ==========

  async openChest(username: string, x: number, y: number, z: number): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await openChestBasic(managed, x, y, z);
  }

  async storeInChest(username: string, itemName: string, count?: number): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await storeInChestBasic(managed, itemName, count);
  }

  async takeFromChest(username: string, itemName: string, count?: number): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await takeFromChestBasic(managed, itemName, count);
  }

  async listChest(username: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await listChestBasic(managed);
  }

  // ========== Survival Methods ==========

  chat(username: string, message: string): void {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    chatBasic(managed, message);
  }

  async sleep(username: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await sleepBasic(managed);
  }

  async attack(username: string, entityName?: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await attackBasic(managed, entityName);
  }

  async fight(username: string, entityName?: string, fleeHealthThreshold: number = 6): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);

    // Create flee callback
    const fleeCallback = async (m: ManagedBot, distance: number) => {
      return await fleeBasic(m, distance);
    };

    return await fightBasic(managed, fleeCallback, entityName, fleeHealthThreshold);
  }

  async eat(username: string, foodName?: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await eatBasic(managed, foodName);
  }

  async fish(username: string, duration: number = 30): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await fishBasic(managed, duration);
  }

  async tradeWithVillager(username: string, tradeIndex?: number): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await tradeWithVillagerBasic(managed, tradeIndex);
  }

  async respawn(username: string, reason?: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await respawnBasic(managed, reason);
  }

  async wake(username: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await wakeBasic(managed);
  }

  async elytraFly(username: string): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    return await elytraFlyBasic(managed);
  }

  async updateSign(
    username: string,
    x: number,
    y: number,
    z: number,
    text: string,
    back: boolean = false
  ): Promise<string> {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);

    // Create moveTo wrapper for updateSign
    const moveToWrapper = async (m: ManagedBot, tx: number, ty: number, tz: number) => {
      return await moveToBasic(m, tx, ty, tz);
    };

    return await updateSignBasic(managed, moveToWrapper, x, y, z, text, back);
  }
}

// Export singleton instance
export const botManager = new BotManager();

// Re-export types for convenience
export type { BotConfig, ManagedBot, ChatMessage, GameEvent };
