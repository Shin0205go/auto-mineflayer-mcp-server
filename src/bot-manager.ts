import mineflayer, { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import pkg from "mineflayer-pathfinder";
const { pathfinder, Movements, goals } = pkg;

export interface BotConfig {
  host: string;
  port: number;
  username: string;
  version?: string;
}

export interface BlockInfo {
  name: string;
  position: { x: number; y: number; z: number };
}

export type ThinkingState =
  | "idle"
  | "processing"
  | "searching"
  | "executing"
  | "error";

export interface ChatMessage {
  username: string;
  message: string;
  timestamp: number;
}

export interface GameEvent {
  type: string;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface ManagedBot {
  bot: Bot;
  username: string;
  config: BotConfig;
  chatMessages: ChatMessage[];
  gameEvents: GameEvent[];
  thinkingState: ThinkingState;
  particleInterval: NodeJS.Timeout | null;
}

/**
 * BotManager - Manages multiple Minecraft bots
 * Each bot is identified by username
 */
export class BotManager {
  private bots: Map<string, ManagedBot> = new Map();

  isConnected(username?: string): boolean {
    if (username) {
      return this.bots.has(username);
    }
    return this.bots.size > 0;
  }

  getBot(username: string): Bot | null {
    return this.bots.get(username)?.bot || null;
  }

  getBotByUsername(username: string): ManagedBot | null {
    return this.bots.get(username) || null;
  }

  getAllBots(): string[] {
    return Array.from(this.bots.keys());
  }

  // Get first connected bot username (for backward compatibility with single-bot stdio MCP)
  getFirstBotUsername(): string | null {
    const first = this.bots.keys().next();
    return first.done ? null : first.value;
  }

  // Get the only bot or throw error (for single-bot mode)
  requireSingleBot(): string {
    const username = this.getFirstBotUsername();
    if (!username) {
      throw new Error("Not connected to any server");
    }
    return username;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async connect(config: BotConfig): Promise<string> {
    if (this.bots.has(config.username)) {
      return `Bot '${config.username}' is already connected`;
    }

    return new Promise((resolve, reject) => {
      const bot = mineflayer.createBot({
        host: config.host,
        port: config.port,
        username: config.username,
        version: config.version,
      });

      bot.once("spawn", () => {
        // Load pathfinder plugin
        bot.loadPlugin(pathfinder);
        const movements = new Movements(bot);
        movements.canDig = false;
        movements.allow1by1towers = true;
        movements.allowFreeMotion = true;
        movements.allowParkour = true;
        movements.allowSprinting = true;
        bot.pathfinder.setMovements(movements);

        const managedBot: ManagedBot = {
          bot,
          username: config.username,
          config,
          chatMessages: [],
          gameEvents: [],
          thinkingState: "idle",
          particleInterval: null,
        };

        // Helper to add event with max 50 events kept
        const addEvent = (type: string, message: string, data?: Record<string, unknown>) => {
          managedBot.gameEvents.push({ type, message, timestamp: Date.now(), data });
          if (managedBot.gameEvents.length > 50) {
            managedBot.gameEvents.shift();
          }
        };

        // Set up chat listener
        bot.on("chat", (username: string, message: string) => {
          if (username === config.username) return;
          managedBot.chatMessages.push({
            username,
            message,
            timestamp: Date.now(),
          });
          addEvent("chat", `${username}: ${message}`, { username, message });
        });

        // Item collected
        bot.on("playerCollect", (collector, collected) => {
          if (collector.username === config.username) {
            addEvent("item_collected", `Picked up item`, {
              collectorId: collector.id,
              itemId: collected.id,
            });
          }
        });

        // Health changed
        bot.on("health", () => {
          addEvent("health_changed", `Health: ${bot.health?.toFixed(1)}/20, Food: ${bot.food}/20`, {
            health: bot.health,
            food: bot.food,
          });
        });

        // Entity hurt (including self)
        bot.on("entityHurt", (entity) => {
          if (entity === bot.entity) {
            addEvent("damaged", `Took damage! Health: ${bot.health?.toFixed(1)}/20`, {
              health: bot.health,
            });
          } else if (entity.position.distanceTo(bot.entity.position) < 10) {
            addEvent("entity_hurt", `${entity.name || "Entity"} took damage nearby`, {
              entityName: entity.name,
              distance: entity.position.distanceTo(bot.entity.position).toFixed(1),
            });
          }
        });

        // Entity spawned nearby
        bot.on("entitySpawn", (entity) => {
          const hostileMobs = ["zombie", "skeleton", "creeper", "spider", "enderman", "witch"];
          if (entity.name && hostileMobs.includes(entity.name.toLowerCase())) {
            const dist = entity.position.distanceTo(bot.entity.position);
            if (dist < 20) {
              addEvent("hostile_spawn", `${entity.name} spawned ${dist.toFixed(1)} blocks away!`, {
                entityName: entity.name,
                distance: dist.toFixed(1),
                position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
              });
            }
          }
        });

        // Handle disconnection
        bot.on("end", () => {
          if (managedBot.particleInterval) {
            clearInterval(managedBot.particleInterval);
          }
          this.bots.delete(config.username);
          console.log(`[BotManager] ${config.username} disconnected`);
        });

        bot.on("error", (err) => {
          console.error(`[BotManager] ${config.username} error:`, err);
          addEvent("error", `Error: ${err.message}`, { error: err.message });
        });

        // Auto-respawn on death
        bot.on("death", () => {
          console.log(`[BotManager] ${config.username} died! Auto-respawning...`);
          addEvent("death", "Bot died! Respawning...");
          bot.chat("やられた！リスポーン中...");
          setTimeout(() => {
            bot.chat("復活しました！");
            addEvent("respawn", "Bot respawned");
          }, 2000);
        });

        this.bots.set(config.username, managedBot);
        console.log(`[BotManager] ${config.username} connected`);
        resolve(`Connected as ${config.username}`);
      });

      bot.once("error", (err) => {
        reject(err);
      });

      bot.once("kicked", (reason) => {
        reject(new Error(`Kicked: ${reason}`));
      });
    });
  }

  async disconnect(username: string): Promise<void> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    if (managed.particleInterval) {
      clearInterval(managed.particleInterval);
    }
    managed.bot.quit();
    this.bots.delete(username);
  }

  disconnectAll(): void {
    for (const [username, managed] of this.bots) {
      if (managed.particleInterval) {
        clearInterval(managed.particleInterval);
      }
      managed.bot.quit();
    }
    this.bots.clear();
  }

  getPosition(username: string): { x: number; y: number; z: number } | null {
    const managed = this.bots.get(username);
    if (!managed) return null;
    const pos = managed.bot.entity.position;
    return { x: pos.x, y: pos.y, z: pos.z };
  }

  async moveTo(username: string, x: number, y: number, z: number): Promise<void> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const targetPos = new Vec3(x, y, z);
    const start = bot.entity.position;
    const distance = start.distanceTo(targetPos);

    const goal = new goals.GoalNear(x, y, z, 2);
    bot.pathfinder.setGoal(goal);

    return new Promise((resolve) => {
      let resolved = false;

      const checkInterval = setInterval(() => {
        if (resolved) {
          clearInterval(checkInterval);
          return;
        }

        const currentPos = bot.entity.position;
        const currentDist = currentPos.distanceTo(targetPos);

        if (currentDist < 3 || !bot.pathfinder.isMoving()) {
          clearInterval(checkInterval);
          if (!resolved) {
            resolved = true;
            bot.pathfinder.setGoal(null);
            resolve();
          }
        }
      }, 200);

      const timeout = Math.max(30000, distance * 500);
      setTimeout(() => {
        clearInterval(checkInterval);
        if (!resolved) {
          resolved = true;
          bot.pathfinder.setGoal(null);
          resolve();
        }
      }, timeout);
    });
  }

  async chat(username: string, message: string): Promise<void> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }
    managed.bot.chat(message);
  }

  getChatMessages(username: string, clear: boolean = true): ChatMessage[] {
    const managed = this.bots.get(username);
    if (!managed) return [];

    const messages = [...managed.chatMessages];
    if (clear) {
      managed.chatMessages = [];
    }
    return messages;
  }

  getGameEvents(username: string, clear: boolean = true, lastN?: number): GameEvent[] {
    const managed = this.bots.get(username);
    if (!managed) return [];

    let events = [...managed.gameEvents];
    if (lastN && lastN > 0) {
      events = events.slice(-lastN);
    }
    if (clear) {
      managed.gameEvents = [];
    }
    return events;
  }

  async lookAround(username: string, radius: number = 5): Promise<BlockInfo[]> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const blocks: BlockInfo[] = [];
    const pos = bot.entity.position;

    for (let x = -radius; x <= radius; x++) {
      for (let y = -radius; y <= radius; y++) {
        for (let z = -radius; z <= radius; z++) {
          const blockPos = pos.offset(x, y, z);
          const block = bot.blockAt(blockPos);
          if (block && block.name !== "air") {
            blocks.push({
              name: block.name,
              position: {
                x: Math.floor(blockPos.x),
                y: Math.floor(blockPos.y),
                z: Math.floor(blockPos.z),
              },
            });
          }
        }
      }
    }

    return blocks;
  }

  async placeBlock(
    username: string,
    blockType: string,
    x: number,
    y: number,
    z: number,
    useCommand: boolean = false
  ): Promise<{ success: boolean; message: string }> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const targetPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    const botPos = bot.entity.position;
    const distance = botPos.distanceTo(targetPos);
    const REACH_DISTANCE = 4.5;

    if (distance > REACH_DISTANCE) {
      return {
        success: false,
        message: `Target is too far (${distance.toFixed(1)} blocks). Max reach is ${REACH_DISTANCE} blocks.`
      };
    }

    // Creative mode or OP: use /setblock command
    if (useCommand) {
      bot.chat(`/setblock ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)} ${blockType}`);
      return { success: true, message: `Placed ${blockType} at (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})` };
    }

    // Survival mode: use actual block from inventory
    const blockItem = bot.inventory.items().find(item =>
      item.name === blockType || item.name === blockType.replace("minecraft:", "")
    );

    if (!blockItem) {
      return {
        success: false,
        message: `No ${blockType} in inventory. Available blocks: ${
          bot.inventory.items()
            .filter(i => !i.name.includes("sword") && !i.name.includes("pickaxe"))
            .map(i => `${i.name}(${i.count})`)
            .slice(0, 10)
            .join(", ")
        }`
      };
    }

    // Equip the block
    try {
      await bot.equip(blockItem, "hand");
    } catch (err) {
      return { success: false, message: `Failed to equip ${blockType}: ${err}` };
    }

    // Find a reference block to place against
    const referenceBlock = this.findReferenceBlock(bot, targetPos);
    if (!referenceBlock) {
      return {
        success: false,
        message: `No adjacent block to place against at (${x}, ${y}, ${z})`
      };
    }

    // Place the block
    try {
      await bot.placeBlock(referenceBlock.block, referenceBlock.faceVector);
      return { success: true, message: `Placed ${blockType} at (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})` };
    } catch (err) {
      return { success: false, message: `Failed to place block: ${err}` };
    }
  }

  private findReferenceBlock(bot: Bot, targetPos: Vec3): { block: any; faceVector: Vec3 } | null {
    // Check all 6 adjacent positions for a solid block to place against
    const faces = [
      { offset: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) },  // bottom
      { offset: new Vec3(0, 1, 0), face: new Vec3(0, -1, 0) },  // top
      { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) },  // west
      { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) },  // east
      { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },  // north
      { offset: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) },  // south
    ];

    for (const { offset, face } of faces) {
      const checkPos = targetPos.plus(offset);
      const block = bot.blockAt(checkPos);
      if (block && block.name !== "air" && block.name !== "water" && block.name !== "lava") {
        return { block, faceVector: face };
      }
    }

    return null;
  }

  async digBlock(username: string, x: number, y: number, z: number, useCommand: boolean = false): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const blockPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    const block = bot.blockAt(blockPos);

    if (!block || block.name === "air") {
      return "No block at that position";
    }

    const blockName = block.name;

    // Creative mode or OP: use command
    if (useCommand) {
      bot.chat(`/setblock ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)} air destroy`);
      return `Broke ${blockName} at (${x}, ${y}, ${z})`;
    }

    // Survival mode: actually dig the block
    const distance = bot.entity.position.distanceTo(blockPos);
    if (distance > 4.5) {
      return `Block is too far (${distance.toFixed(1)} blocks). Move closer first.`;
    }

    try {
      await bot.dig(block);
      return `Dug ${blockName} at (${x}, ${y}, ${z})`;
    } catch (err) {
      return `Failed to dig: ${err}`;
    }
  }

  async collectNearbyItems(username: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const inventoryBefore = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);

    // Find dropped items (entity type "item")
    const items = Object.values(bot.entities).filter(
      (entity) => entity.name === "item" && entity.position.distanceTo(bot.entity.position) < 16
    );

    if (items.length === 0) {
      return "No items nearby to collect";
    }

    // Sort by distance
    items.sort((a, b) =>
      a.position.distanceTo(bot.entity.position) -
      b.position.distanceTo(bot.entity.position)
    );

    let collected = 0;
    for (const item of items) {
      try {
        // Check if item still exists
        if (!bot.entities[item.id]) continue;

        const itemPos = item.position;
        const distance = bot.entity.position.distanceTo(itemPos);

        if (distance < 2) {
          // Already close enough, just wait for pickup
          await this.delay(500);
        } else {
          // Move directly to item position (not "near" it)
          const goal = new goals.GoalBlock(
            Math.floor(itemPos.x),
            Math.floor(itemPos.y),
            Math.floor(itemPos.z)
          );
          bot.pathfinder.setGoal(goal);

          // Wait for movement with timeout
          const startTime = Date.now();
          while (Date.now() - startTime < 5000) {
            await this.delay(200);
            // Check if we reached the item or it was picked up
            const currentDist = bot.entity.position.distanceTo(itemPos);
            if (currentDist < 1.5 || !bot.entities[item.id]) {
              break;
            }
          }
          bot.pathfinder.setGoal(null);
        }

        // Wait a bit for auto-pickup
        await this.delay(300);

        // Check if item was collected
        if (!bot.entities[item.id]) {
          collected++;
        }
      } catch {
        // Item might have been picked up or despawned
      }
    }

    const inventoryAfter = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
    const actuallyCollected = inventoryAfter - inventoryBefore;

    if (actuallyCollected > 0) {
      return `Collected ${actuallyCollected} items (inventory: ${inventoryAfter} total)`;
    } else if (collected > 0) {
      return `Moved to ${collected} item locations, but couldn't pick them up (might need to break blocks above)`;
    } else {
      return "No items collected - they may have despawned";
    }
  }

  listDroppedItems(username: string, range: number = 10): string {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
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
      return `No dropped items within ${range} blocks. Bot position: (${botPos.x.toFixed(1)}, ${botPos.y.toFixed(1)}, ${botPos.z.toFixed(1)})`;
    }

    return JSON.stringify({
      botPosition: { x: botPos.x.toFixed(1), y: botPos.y.toFixed(1), z: botPos.z.toFixed(1) },
      droppedItems: items,
    }, null, 2);
  }

  getInventory(username: string): { name: string; count: number }[] {
    const managed = this.bots.get(username);
    if (!managed) return [];

    const items: { name: string; count: number }[] = [];
    for (const item of managed.bot.inventory.items()) {
      items.push({ name: item.name, count: item.count });
    }
    return items;
  }

  async craftItem(username: string, itemName: string, count: number = 1): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const mcData = require("minecraft-data")(bot.version);

    const item = mcData.itemsByName[itemName];
    if (!item) {
      throw new Error(`Unknown item: ${itemName}`);
    }

    const recipes = bot.recipesFor(item.id, null, 1, null);
    if (recipes.length === 0) {
      throw new Error(`No recipe found for ${itemName}`);
    }

    const recipe = recipes[0];
    let craftingTable = null;

    if (recipe.requiresTable) {
      craftingTable = bot.findBlock({
        matching: mcData.blocksByName.crafting_table.id,
        maxDistance: 4,
      });

      if (!craftingTable) {
        throw new Error("This recipe requires a crafting table nearby (within 4 blocks)");
      }
    }

    for (let i = 0; i < count; i++) {
      await bot.craft(recipe, 1, craftingTable ?? undefined);
    }
    return `Crafted ${count}x ${itemName}`;
  }

  // ============ Combat Methods ============

  getStatus(username: string): string {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const health = bot.health?.toFixed(1) ?? "unknown";
    const food = bot.food ?? "unknown";
    const heldItem = bot.heldItem?.name ?? "empty";

    // Get armor info
    const armor = bot.inventory.slots
      .filter((slot, i) => i >= 5 && i <= 8 && slot)
      .map(slot => slot?.name)
      .filter(Boolean);

    return JSON.stringify({
      health: `${health}/20`,
      hunger: `${food}/20`,
      heldItem,
      armor: armor.length > 0 ? armor : ["none"],
      position: {
        x: bot.entity.position.x.toFixed(1),
        y: bot.entity.position.y.toFixed(1),
        z: bot.entity.position.z.toFixed(1),
      },
    });
  }

  getNearbyEntities(username: string, range: number = 16, type: string = "all"): string {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const hostileMobs = [
      "zombie", "skeleton", "creeper", "spider", "cave_spider", "enderman",
      "witch", "slime", "phantom", "drowned", "husk", "stray", "pillager",
      "vindicator", "ravager", "vex", "evoker", "guardian", "elder_guardian",
      "blaze", "ghast", "magma_cube", "wither_skeleton", "piglin_brute",
    ];
    const passiveMobs = [
      "cow", "pig", "sheep", "chicken", "horse", "donkey", "mule",
      "rabbit", "wolf", "cat", "fox", "bee", "villager", "iron_golem",
    ];

    const entities = Object.values(bot.entities)
      .filter(entity => {
        if (!entity || entity === bot.entity) return false;
        const dist = entity.position.distanceTo(bot.entity.position);
        if (dist > range) return false;

        const name = entity.name?.toLowerCase() || "";

        switch (type) {
          case "hostile":
            return hostileMobs.includes(name);
          case "passive":
            return passiveMobs.includes(name);
          case "player":
            return entity.type === "player";
          default:
            return true;
        }
      })
      .map(entity => ({
        name: entity.name,
        type: hostileMobs.includes(entity.name?.toLowerCase() || "") ? "hostile" :
              entity.type === "player" ? "player" : "passive",
        distance: entity.position.distanceTo(bot.entity.position).toFixed(1),
        position: {
          x: entity.position.x.toFixed(1),
          y: entity.position.y.toFixed(1),
          z: entity.position.z.toFixed(1),
        },
      }))
      .sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

    if (entities.length === 0) {
      return `No ${type === "all" ? "" : type + " "}entities within ${range} blocks`;
    }

    return JSON.stringify(entities, null, 2);
  }

  async attack(username: string, entityName?: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const hostileMobs = [
      "zombie", "skeleton", "creeper", "spider", "cave_spider", "enderman",
      "witch", "slime", "phantom", "drowned", "husk", "stray",
    ];

    // Find target
    let target = null;
    const entities = Object.values(bot.entities);

    if (entityName) {
      target = entities.find(e =>
        e.name?.toLowerCase() === entityName.toLowerCase() &&
        e.position.distanceTo(bot.entity.position) < 6
      );
    } else {
      // Find nearest hostile
      target = entities
        .filter(e => hostileMobs.includes(e.name?.toLowerCase() || ""))
        .sort((a, b) =>
          a.position.distanceTo(bot.entity.position) -
          b.position.distanceTo(bot.entity.position)
        )[0];
    }

    if (!target) {
      return entityName
        ? `No ${entityName} found within attack range`
        : "No hostile mobs nearby to attack";
    }

    const distance = target.position.distanceTo(bot.entity.position);
    if (distance > 6) {
      // Move closer first
      const goal = new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2);
      bot.pathfinder.setGoal(goal);
      await this.delay(2000);
    }

    // Attack
    try {
      await bot.attack(target);
      return `Attacked ${target.name} (distance: ${distance.toFixed(1)} blocks)`;
    } catch (err) {
      return `Failed to attack: ${err}`;
    }
  }

  async eat(username: string, foodName?: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const foods = [
      "cooked_beef", "cooked_porkchop", "cooked_mutton", "cooked_chicken",
      "cooked_rabbit", "cooked_salmon", "cooked_cod", "bread", "apple",
      "golden_apple", "enchanted_golden_apple", "carrot", "baked_potato",
      "beetroot", "melon_slice", "sweet_berries", "cookie", "pumpkin_pie",
      "beef", "porkchop", "mutton", "chicken", "rabbit", "salmon", "cod",
    ];

    // Find food in inventory
    let foodItem = null;
    if (foodName) {
      foodItem = bot.inventory.items().find(item =>
        item.name.toLowerCase() === foodName.toLowerCase()
      );
    } else {
      // Find best available food
      for (const food of foods) {
        foodItem = bot.inventory.items().find(item => item.name === food);
        if (foodItem) break;
      }
    }

    if (!foodItem) {
      return foodName
        ? `No ${foodName} in inventory`
        : "No food in inventory";
    }

    try {
      await bot.equip(foodItem, "hand");
      await bot.consume();
      return `Ate ${foodItem.name}. Hunger: ${bot.food}/20`;
    } catch (err) {
      return `Failed to eat: ${err}`;
    }
  }

  async equipArmor(username: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
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

  async equipWeapon(username: string, weaponName?: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
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

  async flee(username: string, distance: number = 20): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const hostileMobs = [
      "zombie", "skeleton", "creeper", "spider", "enderman", "witch",
    ];

    // Find nearest hostile
    const hostile = Object.values(bot.entities)
      .filter(e => hostileMobs.includes(e.name?.toLowerCase() || ""))
      .sort((a, b) =>
        a.position.distanceTo(bot.entity.position) -
        b.position.distanceTo(bot.entity.position)
      )[0];

    if (!hostile) {
      return "No hostiles nearby - safe!";
    }

    // Calculate flee direction (opposite of hostile)
    const direction = bot.entity.position.minus(hostile.position).normalize();
    const fleeTarget = bot.entity.position.plus(direction.scaled(distance));

    const goal = new goals.GoalNear(fleeTarget.x, fleeTarget.y, fleeTarget.z, 3);
    bot.pathfinder.setGoal(goal);

    // Wait for movement
    await this.delay(3000);
    bot.pathfinder.setGoal(null);

    const newDist = bot.entity.position.distanceTo(hostile.position);
    return `Fled from ${hostile.name}! Now ${newDist.toFixed(1)} blocks away`;
  }
}

// Singleton instance for compatibility
export const botManager = new BotManager();
