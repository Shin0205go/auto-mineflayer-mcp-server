import mineflayer, { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { EventEmitter } from "events";
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
 * Emits 'gameEvent' when events occur (for WebSocket push)
 */
export class BotManager extends EventEmitter {
  private bots: Map<string, ManagedBot> = new Map();

  constructor() {
    super();
  }

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

        // Check game mode - auto-switch to survival if not
        const gameMode = bot.game?.gameMode;
        console.error(`[BotManager] ${config.username} game mode: ${gameMode}`);
        if (gameMode !== "survival") {
          console.error(`[BotManager] Switching to survival mode...`);
          bot.chat(`/gamemode survival ${config.username}`);
        }

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
        // Also emits 'gameEvent' for WebSocket push notifications
        const addEvent = (type: string, message: string, data?: Record<string, unknown>) => {
          const event: GameEvent = { type, message, timestamp: Date.now(), data };
          managedBot.gameEvents.push(event);
          if (managedBot.gameEvents.length > 50) {
            managedBot.gameEvents.shift();
          }
          // Emit for WebSocket push
          this.emit("gameEvent", config.username, event);
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
          console.error(`[BotManager] ${config.username} disconnected`);
        });

        bot.on("error", (err) => {
          console.error(`[BotManager] ${config.username} error:`, err);
          addEvent("error", `Error: ${err.message}`, { error: err.message });
        });

        // Auto-respawn on death
        bot.on("death", () => {
          console.error(`[BotManager] ${config.username} died! Auto-respawning...`);
          addEvent("death", "Bot died! Respawning...");
          bot.chat("やられた！リスポーン中...");
          setTimeout(() => {
            bot.chat("復活しました！");
            addEvent("respawn", "Bot respawned");
          }, 2000);
        });

        this.bots.set(config.username, managedBot);
        console.error(`[BotManager] ${config.username} connected`);

        // Return connection info with game mode warning
        let result = `Connected as ${config.username} (${gameMode} mode)`;
        if (gameMode !== "survival") {
          result += `. WARNING: Not in survival mode! Run /gamemode survival ${config.username} for items to drop.`;
        }
        resolve(result);
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

  async moveTo(username: string, x: number, y: number, z: number): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const targetPos = new Vec3(x, y, z);
    const start = bot.entity.position;
    const distance = start.distanceTo(targetPos);

    console.error(`[Move] From (${start.x.toFixed(1)}, ${start.y.toFixed(1)}, ${start.z.toFixed(1)}) to (${x}, ${y}, ${z}), distance: ${distance.toFixed(1)}`);

    const goal = new goals.GoalNear(x, y, z, 2);

    return new Promise((resolve) => {
      let resolved = false;
      let noProgressCount = 0;
      let lastPos = start.clone();

      const cleanup = () => {
        bot.pathfinder.setGoal(null);
        bot.removeListener("path_reset", onPathReset);
      };

      const onPathReset = () => {
        if (!resolved) {
          resolved = true;
          cleanup();
          const finalPos = bot.entity.position;
          const finalDist = finalPos.distanceTo(targetPos);
          console.error(`[Move] Path reset - no path found. Distance remaining: ${finalDist.toFixed(1)}`);
          resolve(`Cannot reach target - no path found. Stopped at (${finalPos.x.toFixed(1)}, ${finalPos.y.toFixed(1)}, ${finalPos.z.toFixed(1)}), ${finalDist.toFixed(1)} blocks away.`);
        }
      };

      bot.once("path_reset", onPathReset);

      bot.pathfinder.setGoal(goal);

      const checkInterval = setInterval(() => {
        if (resolved) {
          clearInterval(checkInterval);
          return;
        }

        const currentPos = bot.entity.position;
        const currentDist = currentPos.distanceTo(targetPos);

        // Check if reached goal
        if (currentDist < 3) {
          clearInterval(checkInterval);
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve(`Reached destination (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)})`);
          }
          return;
        }

        // Check if stuck (no progress for 3 checks = 1.5 seconds)
        const moved = currentPos.distanceTo(lastPos);
        if (moved < 0.1) {
          noProgressCount++;
          if (noProgressCount >= 5) {
            clearInterval(checkInterval);
            if (!resolved) {
              resolved = true;
              cleanup();
              console.error(`[Move] Stuck - no progress for ${noProgressCount * 300}ms`);
              resolve(`Stuck at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). Cannot reach target, ${currentDist.toFixed(1)} blocks away. Try moving around obstacles.`);
            }
            return;
          }
        } else {
          noProgressCount = 0;
          lastPos = currentPos.clone();
        }

        // Check if pathfinder stopped
        if (!bot.pathfinder.isMoving() && currentDist > 3) {
          clearInterval(checkInterval);
          if (!resolved) {
            resolved = true;
            cleanup();
            console.error(`[Move] Pathfinder stopped before reaching goal`);
            resolve(`Pathfinder stopped at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). ${currentDist.toFixed(1)} blocks from target.`);
          }
          return;
        }
      }, 300);

      // Timeout based on distance
      const timeout = Math.max(15000, distance * 1000);
      setTimeout(() => {
        clearInterval(checkInterval);
        if (!resolved) {
          resolved = true;
          cleanup();
          const finalPos = bot.entity.position;
          const finalDist = finalPos.distanceTo(targetPos);
          console.error(`[Move] Timeout after ${timeout}ms`);
          resolve(`Movement timeout. Stopped at (${finalPos.x.toFixed(1)}, ${finalPos.y.toFixed(1)}, ${finalPos.z.toFixed(1)}), ${finalDist.toFixed(1)} blocks from target.`);
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

  getSurroundings(username: string): string {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const pos = bot.entity.position;
    const feetY = Math.floor(pos.y);
    const headY = feetY + 1;

    // Helper to get block at position
    const getBlock = (x: number, y: number, z: number) => {
      const block = bot.blockAt(new Vec3(x, y, z));
      return block?.name || "unknown";
    };

    const x = Math.floor(pos.x);
    const z = Math.floor(pos.z);

    // Check all directions at feet and head level
    const directions = {
      north: { dx: 0, dz: -1 },
      south: { dx: 0, dz: 1 },
      east: { dx: 1, dz: 0 },
      west: { dx: -1, dz: 0 },
    };

    const passable: string[] = [];
    const blocked: string[] = [];

    for (const [dir, { dx, dz }] of Object.entries(directions)) {
      const feetBlock = getBlock(x + dx, feetY, z + dz);
      const headBlock = getBlock(x + dx, headY, z + dz);
      const groundBlock = getBlock(x + dx, feetY - 1, z + dz);

      const canPass = (feetBlock === "air" || feetBlock === "water") &&
                      (headBlock === "air" || headBlock === "water");
      const hasGround = groundBlock !== "air" && groundBlock !== "water";

      if (canPass && hasGround) {
        passable.push(dir);
      } else if (!canPass) {
        blocked.push(`${dir}(${feetBlock})`);
      } else {
        blocked.push(`${dir}(no ground)`);
      }
    }

    // Check above and below
    const above = getBlock(x, headY + 1, z);
    const below = getBlock(x, feetY - 1, z);
    const twoBelow = getBlock(x, feetY - 2, z);

    // Check what's at feet level (in water? in lava?)
    const atFeet = getBlock(x, feetY, z);

    // Build result
    const lines = [
      `Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`,
      `Standing on: ${below}`,
      `Above head: ${above}`,
      `Can walk: ${passable.length > 0 ? passable.join(", ") : "nowhere"}`,
      `Blocked: ${blocked.length > 0 ? blocked.join(", ") : "nothing"}`,
    ];

    if (atFeet !== "air") {
      lines.push(`At feet: ${atFeet}`);
    }

    // Can jump up?
    const canJumpUp = above === "air";

    lines.push(`Can jump up: ${canJumpUp ? "yes" : "no (blocked)"}`);

    if (below === "air") {
      lines.push(`Warning: No ground below!`);
    }

    // Scan for nearby resources (radius 8)
    const resourceCounts: Record<string, number> = {};
    const interestingBlocks = [
      "coal_ore", "iron_ore", "copper_ore", "gold_ore", "diamond_ore", "emerald_ore",
      "deepslate_coal_ore", "deepslate_iron_ore", "deepslate_copper_ore", "deepslate_gold_ore", "deepslate_diamond_ore",
      "oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log",
      "crafting_table", "furnace", "chest",
      "water", "lava",
    ];

    const radius = 8;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const block = bot.blockAt(pos.offset(dx, dy, dz));
          if (block && interestingBlocks.includes(block.name)) {
            resourceCounts[block.name] = (resourceCounts[block.name] || 0) + 1;
          }
        }
      }
    }

    if (Object.keys(resourceCounts).length > 0) {
      const resources = Object.entries(resourceCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `${name}: ${count}`)
        .join(", ");
      lines.push(`Nearby resources: ${resources}`);
    } else {
      lines.push(`Nearby resources: none found`);
    }

    return lines.join("\n");
  }

  findBlock(username: string, blockName: string, maxDistance: number = 10): string {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const pos = bot.entity.position;
    const found: Array<{ x: number; y: number; z: number; distance: number }> = [];

    // Search in a cube around the bot
    for (let x = -maxDistance; x <= maxDistance; x++) {
      for (let y = -maxDistance; y <= maxDistance; y++) {
        for (let z = -maxDistance; z <= maxDistance; z++) {
          const blockPos = pos.offset(x, y, z);
          const block = bot.blockAt(blockPos);
          if (block && block.name === blockName) {
            const dist = pos.distanceTo(blockPos);
            if (dist <= maxDistance) {
              found.push({
                x: Math.floor(blockPos.x),
                y: Math.floor(blockPos.y),
                z: Math.floor(blockPos.z),
                distance: Math.round(dist * 10) / 10,
              });
            }
          }
        }
      }
    }

    if (found.length === 0) {
      return `No ${blockName} found within ${maxDistance} blocks`;
    }

    // Sort by distance
    found.sort((a, b) => a.distance - b.distance);

    // Return up to 10 nearest
    const nearest = found.slice(0, 10);
    const result = nearest.map(b => `(${b.x}, ${b.y}, ${b.z}) - ${b.distance} blocks away`).join("\n");
    return `Found ${found.length} ${blockName}. Nearest:\n${result}`;
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
    let distance = bot.entity.position.distanceTo(blockPos);
    console.error(`[Dig] ${blockName} at (${x}, ${y}, ${z}), distance: ${distance.toFixed(1)}`);

    // Auto-move closer if too far (Minecraft survival reach is 4.5 blocks)
    const REACH_DISTANCE = 4.5;
    if (distance > REACH_DISTANCE) {
      console.error(`[Dig] Too far, moving closer...`);
      const goal = new goals.GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), 3);
      bot.pathfinder.setGoal(goal);

      // Wait for movement (max 10 seconds)
      const startTime = Date.now();
      while (Date.now() - startTime < 10000) {
        await this.delay(300);
        distance = bot.entity.position.distanceTo(blockPos);
        if (distance <= REACH_DISTANCE || !bot.pathfinder.isMoving()) {
          break;
        }
      }
      bot.pathfinder.setGoal(null);

      distance = bot.entity.position.distanceTo(blockPos);
      console.error(`[Dig] After moving, distance: ${distance.toFixed(1)}`);

      if (distance > REACH_DISTANCE) {
        return `Cannot reach block at (${x}, ${y}, ${z}). Stopped ${distance.toFixed(1)} blocks away. Block may be unreachable.`;
      }
    }

    // Check if block is diggable
    if (block.hardness < 0) {
      return `Cannot dig ${blockName} (unbreakable like bedrock)`;
    }

    const heldItem = bot.heldItem?.name || "empty hand";
    const gameMode = bot.game?.gameMode || "unknown";
    console.error(`[Dig] Held item: ${heldItem}, block hardness: ${block.hardness}, gameMode: ${gameMode}`);

    try {
      const inventoryBefore = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);

      // Check if bot can dig this block
      const canDig = bot.canDigBlock(block);
      console.error(`[Dig] canDigBlock: ${canDig}`);

      if (!canDig) {
        return `Cannot dig ${blockName} - bot may be too far, block may be protected, or wrong tool equipped`;
      }

      // Look at the block first
      await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));

      console.error(`[Dig] Starting to dig ${blockName}...`);
      const digTime = bot.digTime(block);
      console.error(`[Dig] Estimated dig time: ${digTime}ms`);

      await bot.dig(block, true);  // forceLook = true
      console.error(`[Dig] Finished digging ${blockName}`);

      // Verify block is actually gone
      const blockAfter = bot.blockAt(blockPos);
      console.error(`[Dig] Block after dig: ${blockAfter?.name || "null"}`);
      if (blockAfter && blockAfter.name !== "air") {
        return `Dig seemed to complete but block is still there (${blockAfter.name}). May be protected area.`;
      }

      // Wait for item to spawn and fall
      await this.delay(500);

      // Move to the block position (or below if item fell) to auto-pickup
      // Items often fall to y-1 after block breaks
      const pickupY = Math.floor(y) - 1;
      console.error(`[Dig] Moving to pickup location (${Math.floor(x)}, ${pickupY}, ${Math.floor(z)})`);
      const goal = new goals.GoalNear(Math.floor(x), pickupY, Math.floor(z), 1);
      bot.pathfinder.setGoal(goal);
      await this.delay(1500);
      bot.pathfinder.setGoal(null);

      // Extra wait for pickup
      await this.delay(300);

      // Check if item was picked up
      const inventoryAfter = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
      const pickedUp = inventoryAfter - inventoryBefore;

      if (pickedUp > 0) {
        return `Dug ${blockName} and picked up ${pickedUp} item(s)! Inventory now has ${inventoryAfter} items.`;
      }

      // Look for dropped items nearby that weren't picked up
      const droppedItems = Object.values(bot.entities).filter(e =>
        e && e !== bot.entity &&
        e.position.distanceTo(blockPos) < 5 &&
        (e.name === "item" || e.type === "object" || e.displayName === "Item")
      );

      if (droppedItems.length > 0) {
        return `Dug ${blockName} - ${droppedItems.length} item(s) nearby but couldn't pick up. Try collect_items.`;
      } else {
        return `Dug ${blockName}. Check inventory with get_inventory.`;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Dig] Error: ${errMsg}`);
      return `Failed to dig ${blockName}: ${errMsg}`;
    }
  }

  async collectNearbyItems(username: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const inventoryBefore = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);

    // Debug: log all nearby entities first
    const allNearby = Object.values(bot.entities)
      .filter(e => e && e !== bot.entity && e.position.distanceTo(bot.entity.position) < 16);
    console.error(`[Collect] Total entities within 16 blocks: ${allNearby.length}`);
    allNearby.slice(0, 5).forEach(e => {
      console.error(`[Collect]   - name:${e.name}, displayName:${e.displayName}, type:${e.type}, dist:${e.position.distanceTo(bot.entity.position).toFixed(1)}`);
    });

    // Find dropped items - check both "item" name and displayName
    const items = Object.values(bot.entities).filter((entity) => {
      if (!entity || entity === bot.entity) return false;
      const dist = entity.position.distanceTo(bot.entity.position);
      if (dist > 16) return false;
      // Items can be detected by name "item" or displayName "Item"
      // Note: entity.objectType is deprecated, use displayName instead
      return entity.name === "item" ||
             entity.displayName === "Item" ||
             entity.displayName === "Dropped Item" ||
             entity.type === "object";  // Dropped items are "object" type in some versions
    });

    console.error(`[Collect] Found ${items.length} item entities`);

    if (items.length === 0) {
      // Debug: show what entities ARE nearby
      const nearbyEntities = Object.values(bot.entities)
        .filter(e => e && e !== bot.entity && e.position.distanceTo(bot.entity.position) < 10)
        .map(e => `${e.name || e.displayName || "unknown"}(type:${e.type})`)
        .slice(0, 10);
      return `No items nearby. Entities found: ${nearbyEntities.length > 0 ? nearbyEntities.join(", ") : "none"}`;
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

    console.error(`[Craft] MC version: ${bot.version}`);
    console.error(`[Craft] Looking for recipes for ${itemName} (id: ${item.id})`);
    console.error(`[Craft] Current inventory: ${inventory}`);

    // Get recipes - try with and without crafting table
    const craftingTableId = mcData.blocksByName.crafting_table?.id;
    console.error(`[Craft] Crafting table block ID: ${craftingTableId}`);

    let craftingTable = bot.findBlock({
      matching: craftingTableId,
      maxDistance: 4,
    });
    console.error(`[Craft] Crafting table found: ${craftingTable ? `yes at (${craftingTable.position.x}, ${craftingTable.position.y}, ${craftingTable.position.z})` : 'no'}`);

    // Get available recipes - try both with and without table
    let recipes = bot.recipesFor(item.id, null, 1, craftingTable);
    console.error(`[Craft] Recipes with table: ${recipes.length}`);

    if (recipes.length === 0 && !craftingTable) {
      // Maybe try without table parameter
      recipes = bot.recipesFor(item.id, null, 1, null);
      console.error(`[Craft] Recipes without table: ${recipes.length}`);
    }

    if (recipes.length === 0) {
      // Try to get all recipes for this item (even if we can't craft them)
      const allRecipes = bot.recipesAll(item.id, null, craftingTable);
      console.error(`[Craft] Total possible recipes: ${allRecipes.length}`);

      if (allRecipes.length > 0) {
        // Show ALL possible ways to craft this item (up to 5)
        const recipeOptions = allRecipes.slice(0, 5).map((recipe: { delta: Array<{ id: number; count: number }> }) => {
          const ingredients = recipe.delta
            .filter((d) => d.count < 0)
            .map((d) => {
              const ingredientItem = mcData.items[d.id];
              return `${ingredientItem?.name || `id:${d.id}`} x${Math.abs(d.count)}`;
            })
            .join(" + ");
          return ingredients;
        });

        // Remove duplicates and format
        const uniqueOptions = [...new Set(recipeOptions)].slice(0, 3);
        throw new Error(`Cannot craft ${itemName}: missing materials. Options: [${uniqueOptions.join("] or [")}]. Have: ${inventory}`);
      }

      throw new Error(`No recipe found for ${itemName}. Inventory: ${inventory}`);
    }

    const recipe = recipes[0];
    console.error(`[Craft] Using recipe: requiresTable=${recipe.requiresTable}`);

    if (recipe.requiresTable && !craftingTable) {
      throw new Error(`${itemName} requires a crafting table nearby (within 4 blocks). Inventory: ${inventory}`);
    }

    try {
      for (let i = 0; i < count; i++) {
        await bot.craft(recipe, 1, craftingTable || undefined);
      }
      // Check new inventory
      const newInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
      return `Crafted ${count}x ${itemName}. Inventory: ${newInventory}`;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to craft ${itemName}: ${errMsg}. Inventory: ${inventory}`);
    }
  }

  /**
   * Smelt items in a furnace
   */
  async smeltItem(username: string, itemName: string, count: number = 1): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const minecraftData = await import("minecraft-data");
    const mcData = minecraftData.default(bot.version);

    // Find a furnace nearby
    const furnaceBlock = bot.findBlock({
      matching: mcData.blocksByName.furnace?.id,
      maxDistance: 4,
    });

    if (!furnaceBlock) {
      throw new Error("No furnace found within 4 blocks. Craft one with 8 cobblestone.");
    }

    // Find the item to smelt in inventory
    const itemToSmelt = bot.inventory.items().find(i => i.name === itemName);
    if (!itemToSmelt) {
      const inventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";
      throw new Error(`No ${itemName} in inventory. Have: ${inventory}`);
    }

    // Find fuel (coal, charcoal, wood, etc.)
    const fuelItems = ["coal", "charcoal", "oak_log", "birch_log", "spruce_log", "oak_planks", "birch_planks", "spruce_planks"];
    const fuel = bot.inventory.items().find(i => fuelItems.includes(i.name));
    if (!fuel) {
      throw new Error("No fuel in inventory. Need coal, charcoal, or wood.");
    }

    try {
      const furnace = await bot.openFurnace(furnaceBlock);

      // Put fuel if needed
      if (!furnace.fuelItem()) {
        await furnace.putFuel(fuel.type, null, Math.min(fuel.count, 8));
      }

      // Put item to smelt
      const smeltCount = Math.min(count, itemToSmelt.count);
      await furnace.putInput(itemToSmelt.type, null, smeltCount);

      // Wait for smelting (roughly 10 seconds per item)
      const waitTime = Math.min(smeltCount * 10000, 60000);
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Take output
      const output = furnace.outputItem();
      if (output) {
        await furnace.takeOutput();
      }

      furnace.close();

      const newInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
      return `Smelted ${smeltCount}x ${itemName}. Inventory: ${newInventory}`;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to smelt ${itemName}: ${errMsg}`);
    }
  }

  /**
   * Sleep in a bed to skip the night
   */
  async sleep(username: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const minecraftData = await import("minecraft-data");
    const mcData = minecraftData.default(bot.version);

    // Check if it's night time
    const time = bot.time.timeOfDay;
    if (time < 12541 || time > 23458) {
      return "Cannot sleep - it's not night time yet. Wait until dusk.";
    }

    // Find a bed nearby
    const bedBlocks = ["white_bed", "orange_bed", "magenta_bed", "light_blue_bed", "yellow_bed",
                       "lime_bed", "pink_bed", "gray_bed", "light_gray_bed", "cyan_bed",
                       "purple_bed", "blue_bed", "brown_bed", "green_bed", "red_bed", "black_bed"];

    let bedBlock = null;
    for (const bedName of bedBlocks) {
      const bedId = mcData.blocksByName[bedName]?.id;
      if (bedId) {
        bedBlock = bot.findBlock({
          matching: bedId,
          maxDistance: 4,
        });
        if (bedBlock) break;
      }
    }

    if (!bedBlock) {
      throw new Error("No bed found within 4 blocks. Craft a bed with 3 wool + 3 planks.");
    }

    try {
      await bot.sleep(bedBlock);
      // Wait a bit for the sleep to complete
      await new Promise(resolve => setTimeout(resolve, 5000));
      return "Slept through the night. It's now morning!";
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("monsters")) {
        return "Cannot sleep - there are monsters nearby!";
      }
      throw new Error(`Failed to sleep: ${errMsg}`);
    }
  }

  /**
   * Use an item (bucket, flint_and_steel, ender_eye, etc.)
   */
  async useItem(username: string, itemName?: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;

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
      await bot.activateItem();
      return `Used ${heldItem.name}`;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to use ${heldItem.name}: ${errMsg}`);
    }
  }

  /**
   * Drop items from inventory
   */
  async dropItem(username: string, itemName: string, count?: number): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;

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

  /**
   * Fight an entity until it dies or we need to flee
   * Handles: equip weapon, approach, attack loop, health check
   */
  async fight(
    username: string,
    entityName?: string,
    fleeHealthThreshold: number = 6
  ): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const hostileMobs = [
      "zombie", "skeleton", "creeper", "spider", "cave_spider", "enderman",
      "witch", "slime", "phantom", "drowned", "husk", "stray", "pillager",
    ];

    // Step 1: Equip best weapon
    const weaponPriority = [
      "netherite_sword", "diamond_sword", "iron_sword", "stone_sword", "wooden_sword",
      "netherite_axe", "diamond_axe", "iron_axe", "stone_axe", "wooden_axe",
    ];
    const inventory = bot.inventory.items();
    for (const weaponName of weaponPriority) {
      const weapon = inventory.find(i => i.name === weaponName);
      if (weapon) {
        await bot.equip(weapon, "hand");
        console.error(`[BotManager] Equipped ${weaponName}`);
        break;
      }
    }

    // Step 2: Find target
    const findTarget = () => {
      const entities = Object.values(bot.entities);
      if (entityName) {
        return entities.find(e =>
          e.name?.toLowerCase() === entityName.toLowerCase() &&
          e.position.distanceTo(bot.entity.position) < 20
        ) || null;
      }
      return entities
        .filter(e => hostileMobs.includes(e.name?.toLowerCase() || ""))
        .sort((a, b) =>
          a.position.distanceTo(bot.entity.position) -
          b.position.distanceTo(bot.entity.position)
        )[0] || null;
    };

    let target = findTarget();
    if (!target) {
      return entityName
        ? `No ${entityName} found nearby`
        : "No hostile mobs nearby";
    }

    const targetName = target.name || "entity";
    const targetId = target.id;
    let attackCount = 0;
    const maxAttacks = 30; // Safety limit

    console.error(`[BotManager] Starting fight with ${targetName}`);

    // Step 3: Combat loop
    while (attackCount < maxAttacks) {
      // Check health - flee if low
      const health = bot.health;
      if (health <= fleeHealthThreshold) {
        console.error(`[BotManager] Health low (${health}), fleeing!`);
        bot.pathfinder.setGoal(null);
        await this.flee(username, 20);
        return `Fled! Health was ${health}. Attacked ${attackCount} times.`;
      }

      // Re-find target (it might have moved or died)
      target = Object.values(bot.entities).find(e => e.id === targetId) || null;
      if (!target) {
        return `${targetName} defeated! Attacked ${attackCount} times.`;
      }

      const distance = target.position.distanceTo(bot.entity.position);

      // Creeper special case - keep distance and use bow if available
      if (target.name === "creeper" && distance < 4) {
        console.error(`[BotManager] Creeper too close! Backing up.`);
        const direction = bot.entity.position.minus(target.position).normalize();
        const backupPos = bot.entity.position.plus(direction.scaled(6));
        bot.pathfinder.setGoal(new goals.GoalNear(backupPos.x, backupPos.y, backupPos.z, 2));
        await this.delay(1000);
        continue;
      }

      // Move closer if needed
      if (distance > 3.5) {
        bot.pathfinder.setGoal(new goals.GoalNear(
          target.position.x, target.position.y, target.position.z, 2
        ));
        await this.delay(500);
        continue;
      }

      // Attack!
      try {
        bot.pathfinder.setGoal(null); // Stop moving during attack
        await bot.lookAt(target.position.offset(0, target.height * 0.8, 0));
        await bot.attack(target);
        attackCount++;
        console.error(`[BotManager] Hit ${targetName} (#${attackCount})`);
      } catch (err) {
        // Target might have died
        console.error(`[BotManager] Attack error: ${err}`);
      }

      // Attack cooldown (Minecraft attack speed)
      await this.delay(500);
    }

    return `Combat ended. Attacked ${attackCount} times. Target may still be alive.`;
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

  async equipItem(username: string, itemName: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const item = bot.inventory.items().find(i =>
      i.name.toLowerCase() === itemName.toLowerCase() ||
      i.name.toLowerCase().includes(itemName.toLowerCase())
    );

    if (!item) {
      const available = bot.inventory.items().map(i => i.name).join(", ");
      return `No ${itemName} in inventory. Available: ${available || "nothing"}`;
    }

    try {
      await bot.equip(item, "hand");
      return `Equipped ${item.name}`;
    } catch (err) {
      return `Failed to equip ${item.name}: ${err}`;
    }
  }

  async pillarUp(username: string, height: number = 1): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;

    // Find a block to place (dirt, cobblestone, etc.)
    const buildBlocks = ["cobblestone", "dirt", "stone", "oak_planks", "spruce_planks", "birch_planks", "netherrack"];
    let blockItem = null;
    for (const blockName of buildBlocks) {
      blockItem = bot.inventory.items().find(i => i.name === blockName);
      if (blockItem) break;
    }

    if (!blockItem) {
      const available = bot.inventory.items()
        .filter(i => !i.name.includes("pickaxe") && !i.name.includes("sword"))
        .map(i => i.name)
        .slice(0, 5);
      return `No blocks to pillar up with. Available: ${available.join(", ") || "nothing"}`;
    }

    // Equip the block
    await bot.equip(blockItem, "hand");

    let blocksPlaced = 0;
    const startY = bot.entity.position.y;

    for (let i = 0; i < height; i++) {
      try {
        // Jump
        bot.setControlState("jump", true);
        await this.delay(200);

        // Place block below
        const pos = bot.entity.position;
        const belowPos = new Vec3(Math.floor(pos.x), Math.floor(pos.y) - 1, Math.floor(pos.z));
        const blockBelow = bot.blockAt(belowPos);

        if (blockBelow && blockBelow.name === "air") {
          // Find adjacent block to place against
          const groundBlock = bot.blockAt(belowPos.offset(0, -1, 0));
          if (groundBlock && groundBlock.name !== "air") {
            await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
            blocksPlaced++;
          }
        }

        bot.setControlState("jump", false);
        await this.delay(300);
      } catch (err) {
        console.error(`[Pillar] Error: ${err}`);
        bot.setControlState("jump", false);
      }
    }

    bot.setControlState("jump", false);
    const finalY = bot.entity.position.y;

    return `Pillared up ${blocksPlaced} blocks (from Y:${startY.toFixed(1)} to Y:${finalY.toFixed(1)}) using ${blockItem.name}`;
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

  /**
   * Get current biome information
   */
  async getBiome(username: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const pos = bot.entity.position;
    const block = bot.blockAt(pos);

    if (!block) {
      return "Cannot determine biome - chunk not loaded";
    }

    const biome = block.biome;

    if (!biome) {
      return "Biome information not available";
    }

    // Get biome name from ID using minecraft-data
    let biomeName = biome.name;
    if (!biomeName && biome.id !== undefined) {
      try {
        const minecraftData = await import("minecraft-data");
        const mcData = minecraftData.default(bot.version);
        const biomeData = mcData.biomes?.[biome.id] || (mcData as any).biomesArray?.find((b: any) => b.id === biome.id);
        biomeName = biomeData?.name || `biome_${biome.id}`;
      } catch {
        biomeName = `biome_${biome.id}`;
      }
    }
    biomeName = biomeName || "unknown";

    // Biome info
    const lines = [
      `Current biome: ${biomeName}`,
      `Position: (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`,
    ];

    // Add biome characteristics if available
    if (biome.temperature !== undefined) {
      lines.push(`Temperature: ${biome.temperature}`);
    }
    if (biome.rainfall !== undefined) {
      lines.push(`Rainfall: ${biome.rainfall}`);
    }

    // Sheep spawn biomes hint
    const sheepBiomes = ["plains", "sunflower_plains", "meadow", "forest", "birch_forest", "flower_forest", "snowy_plains", "snowy_taiga"];
    if (sheepBiomes.some(b => biomeName.includes(b))) {
      lines.push("★ This biome can spawn sheep!");
    } else {
      lines.push(`Tip: Sheep spawn in plains, meadow, forest biomes. Try exploring in one direction.`);
    }

    return lines.join("\n");
  }

  /**
   * Find nearby entities (mobs, animals, players)
   */
  findEntities(username: string, entityType?: string, maxDistance: number = 32): string {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const pos = bot.entity.position;

    // Get all entities
    const entities = Object.values(bot.entities)
      .filter(e => {
        if (!e || e === bot.entity) return false;
        const dist = pos.distanceTo(e.position);
        if (dist > maxDistance) return false;
        if (entityType) {
          const name = e.name?.toLowerCase() || e.displayName?.toLowerCase() || "";
          return name.includes(entityType.toLowerCase());
        }
        return true;
      })
      .map(e => ({
        name: e.name || e.displayName || "unknown",
        type: e.type,
        position: e.position,
        distance: pos.distanceTo(e.position),
      }))
      .sort((a, b) => a.distance - b.distance);

    if (entities.length === 0) {
      if (entityType) {
        return `No ${entityType} found within ${maxDistance} blocks`;
      }
      return `No entities found within ${maxDistance} blocks`;
    }

    // Group by type
    const grouped: Record<string, typeof entities> = {};
    for (const e of entities) {
      const key = e.name;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(e);
    }

    const lines = [`Entities within ${maxDistance} blocks:`];
    for (const [name, list] of Object.entries(grouped)) {
      const nearest = list[0];
      lines.push(`- ${name} x${list.length} (nearest: ${nearest.distance.toFixed(1)} blocks at ${Math.floor(nearest.position.x)}, ${Math.floor(nearest.position.y)}, ${Math.floor(nearest.position.z)})`);
    }

    return lines.join("\n");
  }

  /**
   * Explore in a direction looking for a biome type
   */
  async exploreForBiome(
    username: string,
    targetBiome: string,
    direction: "north" | "south" | "east" | "west" | "random",
    maxBlocks: number = 200
  ): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const startPos = bot.entity.position.clone();

    // Load minecraft-data for biome lookup
    const minecraftData = await import("minecraft-data");
    const mcData = minecraftData.default(bot.version);

    // Helper to get biome name from ID
    const getBiomeName = (biome: any): string => {
      if (!biome) return "unknown";
      if (biome.name) return biome.name;
      if (biome.id !== undefined) {
        const biomeData = mcData.biomes?.[biome.id] || (mcData as any).biomesArray?.find((b: any) => b.id === biome.id);
        return biomeData?.name || `biome_${biome.id}`;
      }
      return "unknown";
    };

    // Determine direction vector
    let dx = 0, dz = 0;
    switch (direction) {
      case "north": dz = -1; break;
      case "south": dz = 1; break;
      case "east": dx = 1; break;
      case "west": dx = -1; break;
      case "random":
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const picked = dirs[Math.floor(Math.random() * dirs.length)];
        dx = picked[0];
        dz = picked[1];
        break;
    }

    console.error(`[BotManager] Exploring ${direction} looking for ${targetBiome}`);

    // Walk in steps, checking biome
    const stepSize = 50;
    let traveled = 0;
    let foundBiome: string | null = null;
    let foundAt: Vec3 | null = null;

    while (traveled < maxBlocks) {
      const targetX = startPos.x + dx * (traveled + stepSize);
      const targetZ = startPos.z + dz * (traveled + stepSize);

      // Move to target
      const goal = new goals.GoalNear(targetX, bot.entity.position.y, targetZ, 5);
      bot.pathfinder.setGoal(goal);

      // Wait for movement (with timeout)
      const moveStart = Date.now();
      while (Date.now() - moveStart < 15000) {
        await this.delay(500);
        const currentPos = bot.entity.position;
        const distToGoal = Math.sqrt(
          Math.pow(currentPos.x - targetX, 2) + Math.pow(currentPos.z - targetZ, 2)
        );
        if (distToGoal < 10) break;
      }
      bot.pathfinder.setGoal(null);

      traveled += stepSize;

      // Check current biome
      const block = bot.blockAt(bot.entity.position);
      const currentBiome = getBiomeName(block?.biome);

      console.error(`[BotManager] At ${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.z)} - biome: ${currentBiome}`);

      if (currentBiome.toLowerCase().includes(targetBiome.toLowerCase())) {
        foundBiome = currentBiome;
        foundAt = bot.entity.position.clone();
        break;
      }

      // Also check for target entities while exploring (sheep in this case)
      const sheep = Object.values(bot.entities).find(e =>
        e && e.name?.toLowerCase() === "sheep" &&
        bot.entity.position.distanceTo(e.position) < 30
      );
      if (sheep) {
        return `Found sheep while exploring! At (${Math.floor(sheep.position.x)}, ${Math.floor(sheep.position.y)}, ${Math.floor(sheep.position.z)}) - current biome: ${currentBiome}`;
      }
    }

    if (foundBiome && foundAt) {
      return `Found ${foundBiome} biome at (${Math.floor(foundAt.x)}, ${Math.floor(foundAt.y)}, ${Math.floor(foundAt.z)}) after exploring ${traveled} blocks ${direction}`;
    }

    const finalPos = bot.entity.position;
    const finalBlock = bot.blockAt(finalPos);
    const finalBiome = getBiomeName(finalBlock?.biome);

    return `Explored ${traveled} blocks ${direction}. Current biome: ${finalBiome}. Target biome '${targetBiome}' not found. Try another direction.`;
  }
}

// Singleton instance for compatibility
export const botManager = new BotManager();
