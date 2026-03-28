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

// Timestamp used for cache-busting on mc_reload.
let _botManagerVersion = 0;
export function bumpBotManagerVersion(): void {
  _botManagerVersion = Date.now();
}

/**
 * Unified BotManager class that extends BotCore
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

  // ========== Chat Method ==========

  chat(username: string, message: string): void {
    const managed = this.getBotByUsername(username);
    if (!managed) throw new Error(`Bot ${username} not found`);
    managed.bot.chat(message);
  }
}

// Export singleton instance
export const botManager = new BotManager();

// Re-export types for convenience
export type { BotConfig, ManagedBot, ChatMessage, GameEvent };
