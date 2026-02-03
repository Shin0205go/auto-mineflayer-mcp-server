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

  /**
   * Get brief status after an action (HP, hunger, position, surroundings, dangers)
   */
  private getBriefStatus(username: string): string {
    const managed = this.bots.get(username);
    if (!managed) return "";

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
      } else if (!canWalk) {
        blocked.push(`${dir}:${feet}`);
      }
    }

    // Quick resource scan (radius 5)
    const resources: Record<string, number> = {};
    const interestingBlocks = ["coal_ore", "iron_ore", "copper_ore", "gold_ore", "diamond_ore",
      "deepslate_coal_ore", "deepslate_iron_ore", "deepslate_diamond_ore",
      "oak_log", "birch_log", "spruce_log", "crafting_table", "furnace", "chest"];

    for (let dx = -5; dx <= 5; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dz = -5; dz <= 5; dz++) {
          const block = bot.blockAt(pos.offset(dx, dy, dz));
          if (block && interestingBlocks.includes(block.name)) {
            resources[block.name] = (resources[block.name] || 0) + 1;
          }
        }
      }
    }

    // Dangers and nearby entities
    const dangers: string[] = [];
    const nearbyEntities: { [key: string]: number } = {};
    const hostileMobs = ["zombie", "skeleton", "creeper", "spider", "enderman", "witch", "drowned"];
    const passiveMobs = ["cow", "pig", "sheep", "chicken", "horse", "villager"];
    
    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity) continue;
      const dist = entity.position.distanceTo(pos);
      const entityName = entity.name || "unknown";
      const entityType = entity.type || entityName;
      const entityMobType = entity.mobType || "unknown";
      const entityDisplayName = entity.displayName || "unknown";
      
      if (dist < 20) {
        // Count all nearby entities using name, type, and mobType
        // Prioritize mobType for passive mobs like cow, pig, sheep
        let key = "unknown";
        // Check all variations with case-insensitive comparison
        const mobTypeLower = entityMobType.toLowerCase();
        const nameLower = entityName.toLowerCase();
        const displayNameLower = entityDisplayName.toLowerCase();
        const typeLower = entityType.toLowerCase();
        
        // Check for passive mobs - handle various naming conventions
        // entity.mobType is often capitalized (e.g., 'Cow', 'Pig', 'Chicken')
        if (entity.mobType) {
          const mobTypeLower = entity.mobType.toLowerCase();
          if (passiveMobs.includes(mobTypeLower)) {
            key = mobTypeLower;
          } else if (entity.mobType === 'Cow') {
            key = 'cow';
          } else if (entity.mobType === 'Pig') {
            key = 'pig';
          } else if (entity.mobType === 'Chicken') {
            key = 'chicken';
          } else if (entity.mobType === 'Sheep') {
            key = 'sheep';
          }
        } else if (entity.name && passiveMobs.includes(entity.name.toLowerCase())) {
          key = entity.name.toLowerCase();
        } else if (entity.displayName && passiveMobs.includes(entity.displayName.toLowerCase())) {
          key = entity.displayName.toLowerCase();
        } else if (typeof entity.type === 'string' && passiveMobs.includes(entity.type.toLowerCase())) {
          key = entity.type.toLowerCase();
        } else {
          // For other entities, use whatever is available
          key = entity.name?.toLowerCase() || entity.mobType?.toLowerCase() || entity.displayName?.toLowerCase() || entity.type?.toString().toLowerCase() || "unknown";
        }
        nearbyEntities[key] = (nearbyEntities[key] || 0) + 1;
        
        // Check for dangers (hostile mobs within 12 blocks)
        if (dist < 12 && hostileMobs.includes(entityName)) {
          dangers.push(`${entity.name}(${dist.toFixed(0)}m)`);
        }
      }
    }

    const posBlock = bot.blockAt(pos);
    const posLight = Math.max(posBlock?.skyLight ?? 0, posBlock?.light ?? 0);
    if (posLight < 8) dangers.push(`暗(光${posLight})`);
    if (bot.health < 10) dangers.push(`HP低`);
    if (bot.food < 6) dangers.push(`空腹`);

    // Build status
    let status = `\n---\n📍(${x},${y},${z}) ❤️${hp} 🍖${food}`;
    status += `\n歩ける: ${walkable.join(",") || "なし"} | 壁: ${blocked.slice(0, 3).join(", ") || "なし"}`;

    if (Object.keys(resources).length > 0) {
      const res = Object.entries(resources).slice(0, 4).map(([k, v]) => `${k.replace("deepslate_", "").replace("_ore", "").replace("_log", "")}:${v}`).join(" ");
      status += `\n近く: ${res}`;
    }

    if (dangers.length > 0) {
      status += `\n⚠️ ${dangers.join(", ")}`;
    }

    return status;
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
        movements.maxDropDown = 4;  // 落下許容を4ブロックに緩和して探索効率を改善
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
          // Keep only 20 events instead of 50 to reduce memory usage
          if (managedBot.gameEvents.length > 20) {
            managedBot.gameEvents.splice(0, managedBot.gameEvents.length - 20);
          }
          // Emit for WebSocket push with error handling
          try {
            this.emit("gameEvent", config.username, event);
          } catch (error) {
            console.error(`[BotManager] Failed to emit gameEvent:`, error);
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

  /**
   * Basic pathfinding move (internal use)
   */
  private async moveToBasic(username: string, x: number, y: number, z: number): Promise<{ success: boolean; message: string; stuckReason?: string }> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const targetPos = new Vec3(x, y, z);
    const start = bot.entity.position;
    const distance = start.distanceTo(targetPos);

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
          const yDiff = y - finalPos.y;
          resolve({
            success: false,
            message: `Cannot reach target - no path found. Stopped at (${finalPos.x.toFixed(1)}, ${finalPos.y.toFixed(1)}, ${finalPos.z.toFixed(1)}), ${finalDist.toFixed(1)} blocks away.`,
            stuckReason: Math.abs(yDiff) > 2 ? (yDiff > 0 ? "target_higher" : "target_lower") : "no_path"
          });
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

        if (currentDist < 3) {
          clearInterval(checkInterval);
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve({ success: true, message: `Reached destination (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)})` });
          }
          return;
        }

        const moved = currentPos.distanceTo(lastPos);
        if (moved < 0.1) {
          noProgressCount++;
          if (noProgressCount >= 5) {
            clearInterval(checkInterval);
            if (!resolved) {
              resolved = true;
              cleanup();
              const yDiff = y - currentPos.y;
              resolve({
                success: false,
                message: `Stuck at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). ${currentDist.toFixed(1)} blocks from target.`,
                stuckReason: Math.abs(yDiff) > 2 ? (yDiff > 0 ? "target_higher" : "target_lower") : "obstacle"
              });
            }
            return;
          }
        } else {
          noProgressCount = 0;
          lastPos = currentPos.clone();
        }

        if (!bot.pathfinder.isMoving() && currentDist > 3) {
          clearInterval(checkInterval);
          if (!resolved) {
            resolved = true;
            cleanup();
            const yDiff = y - currentPos.y;
            resolve({
              success: false,
              message: `Pathfinder stopped at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). ${currentDist.toFixed(1)} blocks from target.`,
              stuckReason: Math.abs(yDiff) > 2 ? (yDiff > 0 ? "target_higher" : "target_lower") : "pathfinder_stopped"
            });
          }
          return;
        }
      }, 300);

      const timeout = Math.max(10000, distance * 800);
      setTimeout(() => {
        clearInterval(checkInterval);
        if (!resolved) {
          resolved = true;
          cleanup();
          const finalPos = bot.entity.position;
          const finalDist = finalPos.distanceTo(targetPos);
          resolve({
            success: false,
            message: `Movement timeout. Stopped at (${finalPos.x.toFixed(1)}, ${finalPos.y.toFixed(1)}, ${finalPos.z.toFixed(1)}), ${finalDist.toFixed(1)} blocks from target.`,
            stuckReason: "timeout"
          });
        }
      }, timeout);
    });
  }

  /**
   * Smart moveTo with auto-recovery on stuck
   */
  async moveTo(username: string, x: number, y: number, z: number): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const start = bot.entity.position;
    const targetPos = new Vec3(x, y, z);
    const distance = start.distanceTo(targetPos);

    console.error(`[Move] From (${start.x.toFixed(1)}, ${start.y.toFixed(1)}, ${start.z.toFixed(1)}) to (${x}, ${y}, ${z}), distance: ${distance.toFixed(1)}`);

    // Try basic move first
    let result = await this.moveToBasic(username, x, y, z);

    if (result.success) {
      return result.message + this.getBriefStatus(username);
    }

    // Auto-recovery based on stuck reason
    console.error(`[Move] Stuck: ${result.stuckReason}. Attempting recovery...`);

    const currentPos = bot.entity.position;
    const yDiff = y - currentPos.y;

    // Recovery strategy 1: Target is higher - try to pillar up
    if (result.stuckReason === "target_higher" && yDiff > 0) {
      console.error(`[Move] Target is ${yDiff.toFixed(1)} blocks higher. Trying pillar up...`);

      // Check if we have blocks to pillar
      const inventory = bot.inventory.items();
      const placeableBlock = inventory.find(item =>
        ["dirt", "cobblestone", "stone", "netherrack", "sand", "gravel"].some(b => item.name.includes(b))
      );

      if (placeableBlock) {
        const pillarHeight = Math.min(Math.ceil(yDiff), 5);
        try {
          await this.pillarUp(username, pillarHeight, false);
          // Retry move after pillar
          result = await this.moveToBasic(username, x, y, z);
          if (result.success) {
            return `[Auto-recovery: pillared up ${pillarHeight}] ` + result.message + this.getBriefStatus(username);
          }
        } catch (e) {
          console.error(`[Move] Pillar recovery failed:`, e);
        }
      }
    }

    // Recovery strategy 2: Try to dig obstacle in front
    if (result.stuckReason === "obstacle" || result.stuckReason === "pathfinder_stopped") {
      console.error(`[Move] Obstacle detected. Trying to dig through...`);

      // Calculate direction to target
      const dx = x - currentPos.x;
      const dz = z - currentPos.z;
      const len = Math.sqrt(dx * dx + dz * dz);

      if (len > 0) {
        const frontX = Math.floor(currentPos.x + dx / len);
        const frontY = Math.floor(currentPos.y);
        const frontZ = Math.floor(currentPos.z + dz / len);

        try {
          // Try to dig block in front
          const blockInFront = bot.blockAt(new Vec3(frontX, frontY, frontZ));
          if (blockInFront && blockInFront.name !== "air" && blockInFront.name !== "water" && blockInFront.name !== "lava") {
            await this.digBlock(username, frontX, frontY, frontZ);
            // Also try block above (head level)
            const blockAbove = bot.blockAt(new Vec3(frontX, frontY + 1, frontZ));
            if (blockAbove && blockAbove.name !== "air") {
              await this.digBlock(username, frontX, frontY + 1, frontZ);
            }
            // Retry move
            result = await this.moveToBasic(username, x, y, z);
            if (result.success) {
              return `[Auto-recovery: dug through obstacle] ` + result.message + this.getBriefStatus(username);
            }
          }
        } catch (e) {
          console.error(`[Move] Dig recovery failed:`, e);
        }
      }
    }

    // Recovery strategy 3: Try small random offset to unstick
    if (!result.success) {
      console.error(`[Move] Trying random offset to unstick...`);
      const offsets = [
        { x: 2, z: 0 }, { x: -2, z: 0 }, { x: 0, z: 2 }, { x: 0, z: -2 },
        { x: 1, z: 1 }, { x: -1, z: -1 }, { x: 1, z: -1 }, { x: -1, z: 1 }
      ];

      for (const offset of offsets) {
        const offsetResult = await this.moveToBasic(
          username,
          currentPos.x + offset.x,
          currentPos.y,
          currentPos.z + offset.z
        );
        if (offsetResult.success) {
          // Now try original target again
          result = await this.moveToBasic(username, x, y, z);
          if (result.success) {
            return `[Auto-recovery: detoured via offset] ` + result.message + this.getBriefStatus(username);
          }
          break;
        }
      }
    }

    // All recovery attempts failed
    const finalPos = bot.entity.position;
    const finalDist = finalPos.distanceTo(targetPos);
    return `Movement failed after recovery attempts. Final position: (${finalPos.x.toFixed(1)}, ${finalPos.y.toFixed(1)}, ${finalPos.z.toFixed(1)}), ${finalDist.toFixed(1)} blocks from target. Reason: ${result.stuckReason}` + this.getBriefStatus(username);
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

    // Helper to get direction string
    const getDirection = (dx: number, dy: number, dz: number): string => {
      const parts: string[] = [];
      if (dy > 0) parts.push("up");
      if (dy < 0) parts.push("down");
      if (dz < 0) parts.push("north");
      if (dz > 0) parts.push("south");
      if (dx > 0) parts.push("east");
      if (dx < 0) parts.push("west");
      return parts.join("-") || "here";
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

    // Check what's at feet level (in water? in lava?)
    const atFeet = getBlock(x, feetY, z);

    // === 環境情報 ===
    const lines: string[] = [];

    // 基本位置
    lines.push(`## 現在地`);
    lines.push(`座標: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);

    // バイオーム
    try {
      const biome = bot.blockAt(pos)?.biome?.name || "unknown";
      lines.push(`バイオーム: ${biome}`);
    } catch {
      // biome not available
    }

    // 時刻と天気
    const time = bot.time.timeOfDay;
    const isDay = time < 12000 || time > 23000;
    const timeStr = isDay ? "昼" : "夜";
    lines.push(`時刻: ${timeStr} (${time})`);

    if (bot.isRaining) {
      lines.push(`天気: 雨${bot.thunderState > 0 ? "（雷雨）" : ""}`);
    }

    // 地形タイプ判定
    let terrainType = "地表";
    const skyLight = bot.blockAt(pos)?.skyLight ?? 15;
    if (pos.y < 0) {
      terrainType = "ディープダーク層";
    } else if (pos.y < 60 && skyLight < 4) {
      terrainType = "洞窟";
    } else if (atFeet === "water") {
      terrainType = "水中";
    } else if (pos.y > 100) {
      terrainType = "高所";
    }
    lines.push(`地形: ${terrainType}`);

    // 光レベル（モブスポーン判定）
    // skyLight = 太陽光、light = 松明等の光源
    const lightBlock = bot.blockAt(pos);
    const currentSkyLight = lightBlock?.skyLight ?? 0;
    const currentBlockLight = lightBlock?.light ?? 0;
    // 実効光レベル = max(skyLight, light) ※昼間は skyLight が高い
    const effectiveLight = Math.max(currentSkyLight, currentBlockLight);
    const lightWarning = effectiveLight < 8 ? " ⚠️モブスポーン危険" : "";
    lines.push(`光レベル: ${effectiveLight} (sky:${currentSkyLight}, block:${currentBlockLight})${lightWarning}`);

    lines.push(``);
    lines.push(`## 移動可能方向`);
    lines.push(`歩ける: ${passable.length > 0 ? passable.join(", ") : "なし"}`);
    lines.push(`壁: ${blocked.length > 0 ? blocked.join(", ") : "なし"}`);
    lines.push(`足元: ${below}, 頭上: ${above}`);

    if (atFeet !== "air") {
      lines.push(`足の位置: ${atFeet}`);
    }

    // Can jump up?
    const canJumpUp = above === "air";
    lines.push(`ジャンプ可: ${canJumpUp ? "はい" : "いいえ（頭上に障害物）"}`);

    // === 危険度評価 ===
    const dangers: string[] = [];

    // 落下危険
    if (below === "air") {
      dangers.push("落下危険（足元が空）");
    }

    // 溶岩チェック（周囲5ブロック）
    let lavaCount = 0;
    let lavaDir = "";
    for (let dx = -5; dx <= 5; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dz = -5; dz <= 5; dz++) {
          const block = bot.blockAt(pos.offset(dx, dy, dz));
          if (block?.name === "lava") {
            lavaCount++;
            if (!lavaDir) lavaDir = getDirection(dx, dy, dz);
          }
        }
      }
    }
    if (lavaCount > 0) {
      dangers.push(`溶岩あり (${lavaCount}ブロック, ${lavaDir}方向)`);
    }

    // 敵モブチェック
    const hostileMobs = ["zombie", "skeleton", "creeper", "spider", "enderman", "witch", "drowned", "husk", "stray", "phantom", "pillager", "vindicator"];
    const nearbyHostiles: string[] = [];
    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity) continue;
      const dist = entity.position.distanceTo(pos);
      if (dist < 16 && hostileMobs.includes(entity.name?.toLowerCase() || "")) {
        const dir = getDirection(
          entity.position.x - pos.x,
          entity.position.y - pos.y,
          entity.position.z - pos.z
        );
        nearbyHostiles.push(`${entity.name}(${dist.toFixed(1)}m, ${dir})`);
      }
    }
    if (nearbyHostiles.length > 0) {
      dangers.push(`敵: ${nearbyHostiles.join(", ")}`);
    }

    if (dangers.length > 0) {
      lines.push(``);
      lines.push(`## ⚠️ 危険`);
      for (const d of dangers) {
        lines.push(`- ${d}`);
      }
    }

    // === 近くのエンティティ（動物など） ===
    const friendlyMobs = ["cow", "pig", "sheep", "chicken", "rabbit", "horse", "donkey", "llama", "villager", "wolf", "cat", "fox"];
    const nearbyFriendly: string[] = [];
    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity) continue;
      const dist = entity.position.distanceTo(pos);
      if (dist < 20 && friendlyMobs.includes(entity.name?.toLowerCase() || "")) {
        const dir = getDirection(
          entity.position.x - pos.x,
          entity.position.y - pos.y,
          entity.position.z - pos.z
        );
        nearbyFriendly.push(`${entity.name}(${dist.toFixed(1)}m, ${dir})`);
      }
    }
    if (nearbyFriendly.length > 0) {
      lines.push(``);
      lines.push(`## 動物・村人`);
      lines.push(nearbyFriendly.slice(0, 10).join(", "));
    }

    // === 近くの資源（位置情報付き） ===
    const resourceBlocks = [
      "coal_ore", "iron_ore", "copper_ore", "gold_ore", "diamond_ore", "emerald_ore", "lapis_ore", "redstone_ore",
      "deepslate_coal_ore", "deepslate_iron_ore", "deepslate_copper_ore", "deepslate_gold_ore", "deepslate_diamond_ore", "deepslate_emerald_ore", "deepslate_lapis_ore", "deepslate_redstone_ore",
      "oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "cherry_log", "mangrove_log",
      "crafting_table", "furnace", "chest", "bed",
    ];

    interface ResourceInfo {
      count: number;
      nearest: { dx: number; dy: number; dz: number; dist: number };
    }
    const resources: Record<string, ResourceInfo> = {};

    const radius = 10;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const block = bot.blockAt(pos.offset(dx, dy, dz));
          if (block && resourceBlocks.includes(block.name)) {
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (!resources[block.name]) {
              resources[block.name] = { count: 0, nearest: { dx, dy, dz, dist } };
            }
            resources[block.name].count++;
            if (dist < resources[block.name].nearest.dist) {
              resources[block.name].nearest = { dx, dy, dz, dist };
            }
          }
        }
      }
    }

    if (Object.keys(resources).length > 0) {
      lines.push(``);
      lines.push(`## 近くの資源`);

      // 優先度順にソート（鉱石 > 木 > 設備）
      const oreOrder = ["diamond", "emerald", "gold", "iron", "copper", "coal", "lapis", "redstone"];
      const sorted = Object.entries(resources).sort((a, b) => {
        const aOre = oreOrder.findIndex(o => a[0].includes(o));
        const bOre = oreOrder.findIndex(o => b[0].includes(o));
        if (aOre !== -1 && bOre !== -1) return aOre - bOre;
        if (aOre !== -1) return -1;
        if (bOre !== -1) return 1;
        return a[1].nearest.dist - b[1].nearest.dist;
      });

      for (const [name, info] of sorted.slice(0, 12)) {
        const { dx, dy, dz, dist } = info.nearest;
        const dir = getDirection(dx, dy, dz);
        const coordStr = `(${Math.floor(pos.x + dx)}, ${Math.floor(pos.y + dy)}, ${Math.floor(pos.z + dz)})`;
        lines.push(`- ${name}: ${info.count}個, 最寄り${dist.toFixed(1)}m ${dir} ${coordStr}`);
      }
    } else {
      lines.push(``);
      lines.push(`## 近くの資源`);
      lines.push(`特になし`);
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

    // Auto-equip the best tool for this block type
    const pickaxeBlocks = ["stone", "cobblestone", "coal_ore", "iron_ore", "copper_ore", "gold_ore", "diamond_ore",
      "deepslate", "deepslate_coal_ore", "deepslate_iron_ore", "deepslate_copper_ore", "deepslate_gold_ore", "deepslate_diamond_ore",
      "andesite", "diorite", "granite", "netherrack", "blackstone", "basalt", "obsidian", "furnace", "smooth_stone"];
    const axeBlocks = ["oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log",
      "oak_planks", "birch_planks", "spruce_planks", "crafting_table", "chest", "oak_wood", "birch_wood"];
    const shovelBlocks = ["dirt", "grass_block", "sand", "gravel", "clay", "soul_sand", "soul_soil", "snow"];

    let toolType: "pickaxe" | "axe" | "shovel" | null = null;
    if (pickaxeBlocks.some(b => blockName.includes(b) || blockName.endsWith("_ore"))) {
      toolType = "pickaxe";
    } else if (axeBlocks.some(b => blockName.includes(b) || blockName.endsWith("_log") || blockName.endsWith("_planks"))) {
      toolType = "axe";
    } else if (shovelBlocks.some(b => blockName.includes(b))) {
      toolType = "shovel";
    }

    if (toolType) {
      const toolPriority = [
        `netherite_${toolType}`, `diamond_${toolType}`, `iron_${toolType}`, `stone_${toolType}`, `wooden_${toolType}`
      ];
      const inventory = bot.inventory.items();
      let equippedTool: string | null = null;
      for (const toolName of toolPriority) {
        const tool = inventory.find(i => i.name === toolName);
        if (tool) {
          await bot.equip(tool, "hand");
          equippedTool = toolName;
          console.error(`[Dig] Auto-equipped ${toolName} for ${blockName}`);
          break;
        }
      }

      // Check if tool is sufficient for this block (ore tier requirements)
      const needsStonePickaxe = ["iron_ore", "deepslate_iron_ore", "copper_ore", "deepslate_copper_ore",
        "lapis_ore", "deepslate_lapis_ore", "gold_ore", "deepslate_gold_ore", "emerald_ore", "deepslate_emerald_ore",
        "diamond_ore", "deepslate_diamond_ore", "redstone_ore", "deepslate_redstone_ore"];
      const needsDiamondPickaxe = ["obsidian", "ancient_debris", "crying_obsidian"];

      if (needsDiamondPickaxe.some(b => blockName.includes(b))) {
        if (!equippedTool || !equippedTool.match(/^(netherite|diamond)_pickaxe$/)) {
          return `Cannot mine ${blockName} - requires diamond pickaxe or better! You have: ${equippedTool || "no pickaxe"}. Craft diamond_pickaxe first.`;
        }
      } else if (needsStonePickaxe.some(b => blockName.includes(b))) {
        if (!equippedTool || equippedTool === "wooden_pickaxe") {
          return `Cannot mine ${blockName} - requires stone pickaxe or better! Wooden pickaxe won't drop items. Craft stone_pickaxe first (need 3 cobblestone + 2 sticks).`;
        }
      }
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

      // Wait for item to spawn (items spawn after ~100-200ms)
      await this.delay(200);

      // Check inventory immediately - items within 1 block are auto-collected
      let inventoryAfter = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
      let pickedUp = inventoryAfter - inventoryBefore;
      console.error(`[Dig] Inventory check 1: before=${inventoryBefore}, after=${inventoryAfter}, picked=${pickedUp}`);

      // If nothing picked up yet, aggressively move to collect
      if (pickedUp === 0) {
        // Step 1: Walk directly through the block position
        await bot.lookAt(blockPos.offset(0.5, 0, 0.5));
        bot.setControlState("forward", true);
        await this.delay(500);
        bot.setControlState("forward", false);

        inventoryAfter = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
        pickedUp = inventoryAfter - inventoryBefore;
        console.error(`[Dig] Inventory check 2 (walk through): picked=${pickedUp}`);
      }

      // Step 2: Try pathfinder if still nothing
      if (pickedUp === 0) {
        const goal = new goals.GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), 0);
        bot.pathfinder.setGoal(goal);
        await this.delay(1500);
        bot.pathfinder.setGoal(null);

        inventoryAfter = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
        pickedUp = inventoryAfter - inventoryBefore;
        console.error(`[Dig] Inventory check 3 (pathfinder): picked=${pickedUp}`);
      }

      // Step 3: Jump in case item is slightly above
      if (pickedUp === 0) {
        bot.setControlState("jump", true);
        await this.delay(300);
        bot.setControlState("jump", false);
        await this.delay(300);

        inventoryAfter = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
        pickedUp = inventoryAfter - inventoryBefore;
        console.error(`[Dig] Inventory check 4 (jump): picked=${pickedUp}`);
      }

      if (pickedUp > 0) {
        return `Dug ${blockName} with ${heldItem} and picked up ${pickedUp} item(s)!` + this.getBriefStatus(username);
      }

      // Look for dropped items nearby that weren't picked up
      const droppedItems = Object.values(bot.entities).filter(e =>
        e && e !== bot.entity &&
        e.position.distanceTo(blockPos) < 5 &&
        (e.name === "item" || e.type === "object" || e.displayName === "Item")
      );

      if (droppedItems.length > 0) {
        // Try one more aggressive collection
        console.error(`[Dig] Found ${droppedItems.length} uncollected items, attempting pickup...`);
        for (const item of droppedItems.slice(0, 3)) {
          await bot.lookAt(item.position);
          bot.setControlState("forward", true);
          await this.delay(400);
          bot.setControlState("forward", false);
          await this.delay(200);
        }

        inventoryAfter = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
        pickedUp = inventoryAfter - inventoryBefore;

        if (pickedUp > 0) {
          return `Dug ${blockName} and collected ${pickedUp} item(s) after extra effort!` + this.getBriefStatus(username);
        }

        return `Dug ${blockName} but ${droppedItems.length} item(s) couldn't be picked up (may be stuck in block)` + this.getBriefStatus(username);
      } else {
        // Check if we expected drops but got none (wrong tool warning)
        const oresNeedingPickaxe = ["_ore", "stone", "cobblestone", "deepslate"];
        const isOre = oresNeedingPickaxe.some(s => blockName.includes(s));
        const hasPickaxe = heldItem.includes("pickaxe");

        if (isOre && !hasPickaxe) {
          return `WARNING: Dug ${blockName} with ${heldItem} but NO ITEM DROPPED! Need pickaxe for ore/stone!` + this.getBriefStatus(username);
        }

        return `Dug ${blockName} with ${heldItem} (no drops or auto-collected).` + this.getBriefStatus(username);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Dig] Error: ${errMsg}`);
      return `Failed to dig ${blockName}: ${errMsg}`;
    }
  }

  async minecraft_collect_items(username?: string): Promise<string> {
    const actualUsername = username || this.requireSingleBot();
    return this.collectNearbyItems(actualUsername);
  }

  async collectNearbyItems(username: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const inventoryBefore = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);

    // Find dropped items with multiple detection strategies
    const findItems = () => {
      const allEntities = Object.values(bot.entities);
      console.error(`[Collect] Scanning ${allEntities.length} total entities`);
      
      return allEntities.filter((entity) => {
        if (!entity || entity === bot.entity) return false;
        
        // Check position validity before distance calculation
        if (!entity.position || !bot.entity.position) {
          console.error(`[Collect] Entity without valid position: id=${entity.id}, name="${entity.name}"`);
          return false;
        }
        
        const dist = entity.position.distanceTo(bot.entity.position);
        
        // Log all entities within extended range for debugging
        if (dist <= 30) {
          console.error(`[Collect] Entity: name="${entity.name}", displayName="${entity.displayName}", type="${entity.type}", id=${entity.id}, dist=${dist.toFixed(1)}`);
        }
        
        if (dist > 15) return false; // Reduced range for better detection
        
        const name = (entity.name || "").toLowerCase();
        const displayName = (entity.displayName || "").toLowerCase();
        const type = (entity.type || "").toLowerCase();
        
        // Simplified and more reliable item detection
        const isItem = (
          // Standard Minecraft item entity detection (cast to any to bypass strict type checking)
          entity.name === "item" ||
          entity.objectType === "Item" ||
          entity.type === "object" ||
          (entity as any).type === "item" ||
          (entity.type && (entity.type as string).includes?.("item")) ||
          // Additional detection for different server implementations
          (entity.metadata && typeof entity.metadata[10] !== 'undefined') || // Item entity metadata check
          (entity.entityType && entity.entityType === 2) || // Numeric entity type for items
          // More lenient detection for unknown entity types
          (!entity.username && !entity.type && entity.velocity && entity.onGround !== undefined) ||
          // Check for typical item entity properties
          ((entity as any).itemId !== undefined || (entity as any).itemCount !== undefined)
        ) && !entity.username && entity.id !== undefined && entity.position && entity.id !== bot.entity.id
        
        if (isItem) {
          console.error(`[Collect] Found item entity: ${entity.name || entity.displayName || entity.type} at dist ${dist.toFixed(1)}, id: ${entity.id}`);
        }
        
        return isItem;
      });
    };

    let items = findItems();
    console.error(`[Collect] Found ${items.length} item entities`);

    if (items.length === 0) {
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
    let attempts = 0;
    const maxAttempts = Math.min(items.length * 2, 10);

    while (attempts < maxAttempts) {
      attempts++;

      // Re-find items (they may have been picked up or moved)
      items = findItems().sort((a, b) =>
        a.position.distanceTo(bot.entity.position) -
        b.position.distanceTo(bot.entity.position)
      );

      if (items.length === 0) break;

      const item = items[0];
      const itemPos = item.position.clone();
      const botPos = bot.entity.position;
      const distance = botPos.distanceTo(itemPos);

      console.error(`[Collect] Attempt ${attempts}: item at (${itemPos.x.toFixed(1)}, ${itemPos.y.toFixed(1)}, ${itemPos.z.toFixed(1)}), dist: ${distance.toFixed(1)}`);

      try {
        if (distance < 1.5) {
          // Very close - just walk through
          bot.setControlState("forward", true);
          await this.delay(300);
          bot.setControlState("forward", false);
        } else if (distance < 3) {
          // Close - walk directly without pathfinder
          await bot.lookAt(itemPos);
          bot.setControlState("forward", true);

          const startTime = Date.now();
          while (Date.now() - startTime < 2000) {
            await this.delay(100);
            if (!bot.entities[item.id]) break;
            const newDist = bot.entity.position.distanceTo(itemPos);
            if (newDist < 0.5) break;
          }

          bot.setControlState("forward", false);
        } else {
          // Far - use pathfinder
          const goal = new goals.GoalNear(
            Math.floor(itemPos.x),
            Math.floor(itemPos.y),
            Math.floor(itemPos.z),
            1
          );
          bot.pathfinder.setGoal(goal);

          const startTime = Date.now();
          while (Date.now() - startTime < 5000) {
            await this.delay(200);
            if (!bot.entities[item.id]) break;
            const currentDist = bot.entity.position.distanceTo(itemPos);
            if (currentDist < 1.5) {
              // Close enough, walk through
              bot.pathfinder.setGoal(null);
              bot.setControlState("forward", true);
              await this.delay(500);
              bot.setControlState("forward", false);
              break;
            }
            if (!bot.pathfinder.isMoving()) break;
          }
          bot.pathfinder.setGoal(null);
        }

        // Check Y difference - try jumping if item is slightly above
        const yDiff = itemPos.y - bot.entity.position.y;
        if (yDiff > 0.5 && yDiff < 2 && bot.entities[item.id]) {
          console.error(`[Collect] Item is ${yDiff.toFixed(1)} blocks above, trying jump...`);
          bot.setControlState("jump", true);
          await this.delay(300);
          bot.setControlState("jump", false);
          await this.delay(200);
        }

        // Wait for auto-pickup
        await this.delay(200);

        if (!bot.entities[item.id]) {
          collected++;
          console.error(`[Collect] Item collected!`);
        }
      } catch (e) {
        console.error(`[Collect] Error:`, e);
      }
    }

    const inventoryAfter = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
    const actuallyCollected = inventoryAfter - inventoryBefore;

    if (actuallyCollected > 0) {
      return `Collected ${actuallyCollected} items (inventory: ${inventoryAfter} total)` + this.getBriefStatus(username);
    } else if (collected > 0) {
      return `Approached ${collected} items but inventory unchanged. Items may have glitched or been blocked.`;
    } else {
      return `No items collected after ${attempts} attempts - they may have despawned or be unreachable`;
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

    // Get available recipes - try 2x2 (no table) first, then 3x3 (with table)
    // This is important because simple recipes like planks are 2x2 and don't need a table
    let recipes = bot.recipesFor(item.id, null, 1, null);
    console.error(`[Craft] Recipes without table (2x2): ${recipes.length}`);

    // If no 2x2 recipe found, try 3x3 recipes (need crafting table)
    if (recipes.length === 0) {
      if (craftingTable) {
        recipes = bot.recipesFor(item.id, null, 1, craftingTable);
        console.error(`[Craft] Recipes with table (3x3): ${recipes.length}`);
      } else {
        // Check if 3x3 recipes EXIST but we just don't have a table
        const possible3x3 = bot.recipesAll(item.id, null, true as any);
        if (possible3x3.length > 0) {
          console.error(`[Craft] No crafting table nearby but 3x3 recipe exists`);
          throw new Error(`${itemName} requires a crafting_table nearby. Place one first, then craft. Inventory: ${inventory}`);
        }
      }
    }

    if (recipes.length === 0) {
      // Try to get all recipes for this item (even if we can't craft them)
      // Must check both with and without crafting table to get all possible recipes
      let allRecipes = bot.recipesAll(item.id, null, null);
      // Also try with a "fake" crafting table to get 3x3 recipes
      const allRecipes3x3 = bot.recipesAll(item.id, null, craftingTable || true as any);
      if (allRecipes3x3.length > allRecipes.length) {
        allRecipes = allRecipes3x3;
      }
      console.error(`[Craft] Total possible recipes: ${allRecipes.length}`);

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
            needed.push(`${ingredientName} x${requiredCount}`);

            // Check if we have enough
            const inInventory = inventoryItems.find(i => i.name === ingredientName);
            const haveCount = inInventory?.count || 0;
            if (haveCount < requiredCount) {
              missing.push(`${ingredientName} (need ${requiredCount}, have ${haveCount})`);
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
          "wooden_pickaxe": "Craft order: oak_log → oak_planks (4) → stick (from 2 planks) → wooden_pickaxe",
          "wooden_axe": "Craft order: oak_log → oak_planks (4) → stick (from 2 planks) → wooden_axe",
          "wooden_sword": "Craft order: oak_log → oak_planks (4) → stick (from 2 planks) → wooden_sword",
          "wooden_shovel": "Craft order: oak_log → oak_planks (4) → stick (from 2 planks) → wooden_shovel",
          "stone_pickaxe": "Need: cobblestone x3 + stick x2. Mine stone with wooden_pickaxe first.",
          "crafting_table": "Craft order: oak_log → oak_planks (4) → crafting_table",
          "stick": "Craft from 2 oak_planks (gives 4 sticks)",
          "oak_planks": "Craft from 1 oak_log (gives 4 planks)",
        };

        if (craftingHints[itemName]) {
          errorMsg += ` Hint: ${craftingHints[itemName]}`;
        }

        errorMsg += ` Have: ${inventory}`;
        throw new Error(errorMsg);
      }

      // No recipes at all - might need crafting table
      let errorMsg = `No recipe found for ${itemName}.`;
      if (!craftingTable) {
        errorMsg += ` Try placing a crafting_table nearby for advanced recipes.`;
      }
      errorMsg += ` Inventory: ${inventory}`;
      throw new Error(errorMsg);
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
      return `Crafted ${count}x ${itemName}. Inventory: ${newInventory}` + this.getBriefStatus(username);
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
        return `Fled! Health was ${health}. Attacked ${attackCount} times.` + this.getBriefStatus(username);
      }

      // Re-find target (it might have moved or died)
      target = Object.values(bot.entities).find(e => e.id === targetId) || null;
      if (!target) {
        return `${targetName} defeated! Attacked ${attackCount} times.` + this.getBriefStatus(username);
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

    return `Combat ended. Attacked ${attackCount} times. Target may still be alive.` + this.getBriefStatus(username);
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
      return `Ate ${foodItem.name}. Hunger: ${bot.food}/20` + this.getBriefStatus(username);
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
      const available = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
      throw new Error(`No ${itemName} in inventory. Available: ${available || "nothing"}`);
    }

    try {
      await bot.equip(item, "hand");
      return `Equipped ${item.name}`;
    } catch (err) {
      return `Failed to equip ${item.name}: ${err}`;
    }
  }

  async pillarUp(username: string, height: number = 1, untilSky: boolean = false): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const startY = bot.entity.position.y;
    const maxHeight = untilSky ? 100 : height; // Safety limit

    // Find placeable blocks
    const buildBlocks = ["cobblestone", "dirt", "stone", "andesite", "diorite", "granite", "deepslate", "oak_planks", "spruce_planks", "birch_planks", "netherrack"];

    let blocksPlaced = 0;
    let blocksDug = 0;
    let lastBlockUsed = "";

    console.error(`[Pillar] Starting from Y=${startY.toFixed(1)}, target height=${maxHeight}, untilSky=${untilSky}`);

    for (let i = 0; i < maxHeight; i++) {
      const pos = bot.entity.position;
      const headPos = new Vec3(Math.floor(pos.x), Math.floor(pos.y) + 2, Math.floor(pos.z));
      const blockAbove = bot.blockAt(headPos);

      // Check if we reached sky (no solid block above for 3 blocks)
      if (untilSky) {
        let clearAbove = true;
        for (let j = 1; j <= 3; j++) {
          const checkBlock = bot.blockAt(new Vec3(Math.floor(pos.x), Math.floor(pos.y) + j, Math.floor(pos.z)));
          if (checkBlock && checkBlock.name !== "air" && checkBlock.name !== "water") {
            clearAbove = false;
            break;
          }
        }
        if (clearAbove) {
          console.error(`[Pillar] Reached open sky at Y=${pos.y.toFixed(1)}`);
          break;
        }
      }

      // If there's a block above, dig it first
      if (blockAbove && blockAbove.name !== "air" && blockAbove.name !== "water" && blockAbove.hardness >= 0) {
        try {
          // Equip pickaxe for digging
          const pickaxes = ["netherite_pickaxe", "diamond_pickaxe", "iron_pickaxe", "stone_pickaxe", "wooden_pickaxe"];
          for (const pickaxeName of pickaxes) {
            const pickaxe = bot.inventory.items().find(item => item.name === pickaxeName);
            if (pickaxe) {
              await bot.equip(pickaxe, "hand");
              break;
            }
          }

          await bot.lookAt(headPos.offset(0.5, 0.5, 0.5));
          await bot.dig(blockAbove, true);
          blocksDug++;
          console.error(`[Pillar] Dug ${blockAbove.name} above`);
          await this.delay(200);
        } catch (err) {
          console.error(`[Pillar] Failed to dig ${blockAbove.name}: ${err}`);
          // Can't dig, stop here
          break;
        }
      }

      // Find a block to place
      let blockItem = null;
      for (const blockName of buildBlocks) {
        blockItem = bot.inventory.items().find(item => item.name === blockName);
        if (blockItem) {
          lastBlockUsed = blockItem.name;
          break;
        }
      }

      if (!blockItem) {
        console.error(`[Pillar] No blocks left to place`);
        break;
      }

      // Equip the block
      await bot.equip(blockItem, "hand");

      try {
        // Jump and place
        bot.setControlState("jump", true);
        await this.delay(250);

        const currentPos = bot.entity.position;
        const belowPos = new Vec3(Math.floor(currentPos.x), Math.floor(currentPos.y) - 1, Math.floor(currentPos.z));
        const blockBelow = bot.blockAt(belowPos);

        if (blockBelow && blockBelow.name === "air") {
          const groundBlock = bot.blockAt(belowPos.offset(0, -1, 0));
          if (groundBlock && groundBlock.name !== "air") {
            await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
            blocksPlaced++;
          }
        }

        bot.setControlState("jump", false);
        await this.delay(200);
      } catch (err) {
        console.error(`[Pillar] Place error: ${err}`);
        bot.setControlState("jump", false);
      }
    }

    bot.setControlState("jump", false);
    const finalY = bot.entity.position.y;

    const dugInfo = blocksDug > 0 ? `, dug ${blocksDug} blocks above` : "";
    const blockInfo = lastBlockUsed ? ` using ${lastBlockUsed}` : "";
    return `Pillared up ${blocksPlaced} blocks (from Y:${startY.toFixed(1)} to Y:${finalY.toFixed(1)})${blockInfo}${dugInfo}`;
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
          const name = (e.name || "").toLowerCase();
          const displayName = (e.displayName || "").toLowerCase();
          const type = (e.type || "").toLowerCase();
          const searchType = entityType.toLowerCase();
          
          // より柔軟な検索: 複数のパターンを試す
          const patterns = [
            searchType,  // 完全一致
            searchType.charAt(0).toUpperCase() + searchType.slice(1),  // 先頭大文字
            `minecraft:${searchType}`,  // namespace付き
            `entity.${searchType}.name`,  // display name形式
          ];
          
          // name, displayName, typeのいずれかがパターンに一致するかチェック
          return patterns.some(pattern => 
            name === pattern.toLowerCase() || 
            name.includes(pattern.toLowerCase()) ||
            displayName === pattern.toLowerCase() || 
            displayName.includes(pattern.toLowerCase()) ||
            type === pattern.toLowerCase() || 
            type.includes(pattern.toLowerCase())
          ) || 
          // 部分一致も試す（cowがcow_entityなどの場合に対応）
          name.includes(searchType) || 
          displayName.includes(searchType) || 
          type.includes(searchType);
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

      // More flexible biome matching
      const biomeLower = currentBiome.toLowerCase();
      const targetLower = targetBiome.toLowerCase();
      const isMatch = biomeLower.includes(targetLower) || 
                     targetLower.includes(biomeLower) ||
                     (targetLower === 'plains' && (biomeLower.includes('plain') || biomeLower === 'meadow')) ||
                     (targetLower === 'forest' && biomeLower.includes('forest')) ||
                     (targetLower === 'desert' && biomeLower.includes('desert'));
      
      if (isMatch) {
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

  /**
   * Dig a 1x2 tunnel in a direction
   * Auto-equips pickaxe, collects items, reports ores found
   */
  async digTunnel(
    username: string,
    direction: "north" | "south" | "east" | "west" | "up" | "down",
    length: number = 10
  ): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const startPos = bot.entity.position.clone();
    const inventoryBefore = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);

    // Direction vectors
    const dirVectors: Record<string, { dx: number; dy: number; dz: number }> = {
      north: { dx: 0, dy: 0, dz: -1 },
      south: { dx: 0, dy: 0, dz: 1 },
      east: { dx: 1, dy: 0, dz: 0 },
      west: { dx: -1, dy: 0, dz: 0 },
      up: { dx: 0, dy: 1, dz: 0 },
      down: { dx: 0, dy: -1, dz: 0 },
    };

    const dir = dirVectors[direction];
    if (!dir) {
      throw new Error(`Invalid direction: ${direction}. Use north/south/east/west/up/down`);
    }

    // Auto-equip best pickaxe
    const pickaxePriority = ["netherite_pickaxe", "diamond_pickaxe", "iron_pickaxe", "stone_pickaxe", "wooden_pickaxe"];
    let equippedTool = "empty hand";
    for (const toolName of pickaxePriority) {
      const tool = bot.inventory.items().find(i => i.name === toolName);
      if (tool) {
        await bot.equip(tool, "hand");
        equippedTool = toolName;
        console.error(`[Tunnel] Equipped ${toolName}`);
        break;
      }
    }

    let blocksDug = 0;
    const oresFound: Record<string, number> = {};
    const currentPos = {
      x: Math.floor(startPos.x),
      y: Math.floor(startPos.y),
      z: Math.floor(startPos.z)
    };

    console.error(`[Tunnel] Starting ${direction} tunnel from (${currentPos.x}, ${currentPos.y}, ${currentPos.z}), length ${length}`);

    for (let i = 0; i < length; i++) {
      // Calculate next position
      const nextX = currentPos.x + dir.dx;
      const nextY = currentPos.y + dir.dy;
      const nextZ = currentPos.z + dir.dz;

      // For horizontal tunnels, dig 2 blocks high (feet and head level)
      // For vertical tunnels, dig 1 block
      const blocksToDig: Array<{ x: number; y: number; z: number }> = [];

      if (direction === "up" || direction === "down") {
        blocksToDig.push({ x: nextX, y: nextY, z: nextZ });
      } else {
        // Horizontal: dig at feet level and head level
        blocksToDig.push({ x: nextX, y: nextY, z: nextZ });      // feet
        blocksToDig.push({ x: nextX, y: nextY + 1, z: nextZ });  // head
      }

      for (const blockPos of blocksToDig) {
        const block = bot.blockAt(new Vec3(blockPos.x, blockPos.y, blockPos.z));
        if (!block || block.name === "air" || block.name === "water" || block.name === "lava") {
          continue;
        }

        // Track ores
        if (block.name.includes("_ore")) {
          oresFound[block.name] = (oresFound[block.name] || 0) + 1;
        }

        // Check if unbreakable
        if (block.hardness < 0) {
          console.error(`[Tunnel] Hit unbreakable block: ${block.name}`);
          continue;
        }

        try {
          // Look at and dig the block
          await bot.lookAt(new Vec3(blockPos.x + 0.5, blockPos.y + 0.5, blockPos.z + 0.5));
          await bot.dig(block, true);
          blocksDug++;

          // Brief pause for item spawn
          await this.delay(100);
        } catch (err) {
          console.error(`[Tunnel] Failed to dig ${block.name}: ${err}`);
        }
      }

      // Move forward into the tunnel
      if (direction !== "up" && direction !== "down") {
        const goal = new goals.GoalBlock(nextX, nextY, nextZ);
        bot.pathfinder.setGoal(goal);
        await this.delay(500);
        bot.pathfinder.setGoal(null);
      } else if (direction === "down") {
        // For down, just wait for gravity
        await this.delay(300);
      } else if (direction === "up") {
        // For up, need to pillar or jump
        // Just move up if possible
        await this.delay(300);
      }

      // Update current position
      currentPos.x = nextX;
      currentPos.y = nextY;
      currentPos.z = nextZ;

      // Check HP periodically
      if (bot.health < 8) {
        console.error(`[Tunnel] HP low (${bot.health}), stopping`);
        break;
      }
    }

    // Final item collection
    await this.delay(500);
    const inventoryAfter = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
    const itemsCollected = inventoryAfter - inventoryBefore;

    // Build result message
    const finalPos = bot.entity.position;
    let result = `Tunneled ${blocksDug} blocks ${direction} with ${equippedTool}.`;
    result += ` Position: (${Math.floor(finalPos.x)}, ${Math.floor(finalPos.y)}, ${Math.floor(finalPos.z)}).`;
    result += ` Items collected: ${itemsCollected}.`;

    if (Object.keys(oresFound).length > 0) {
      const oreList = Object.entries(oresFound).map(([name, count]) => `${name}x${count}`).join(", ");
      result += ` ORES FOUND: ${oreList}!`;
    }

    const newInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
    result += ` Inventory: ${newInventory || "empty"}`;

    return result;
  }

  /**
   * Intentionally die and respawn (for hopeless situations)
   * Use when: stuck underground with no food, low HP, no way out
   */
  async respawn(username: string, reason?: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const oldPos = bot.entity.position.clone();
    const oldHP = bot.health;
    const oldFood = bot.food;

    console.error(`[Respawn] Intentional death requested. Reason: ${reason || "unspecified"}`);
    console.error(`[Respawn] Before: HP=${oldHP}, Food=${oldFood}, Pos=(${oldPos.x.toFixed(1)}, ${oldPos.y.toFixed(1)}, ${oldPos.z.toFixed(1)})`);

    // Use /kill command
    bot.chat(`/kill ${username}`);

    // Wait for death and respawn
    await this.delay(3000);

    // Check new status
    const newPos = bot.entity.position;
    const newHP = bot.health;
    const newFood = bot.food;

    console.error(`[Respawn] After: HP=${newHP}, Food=${newFood}, Pos=(${newPos.x.toFixed(1)}, ${newPos.y.toFixed(1)}, ${newPos.z.toFixed(1)})`);

    return `Respawned! Old: (${oldPos.x.toFixed(0)}, ${oldPos.y.toFixed(0)}, ${oldPos.z.toFixed(0)}) HP:${oldHP?.toFixed(0)}/20 Food:${oldFood}/20 → New: (${newPos.x.toFixed(0)}, ${newPos.y.toFixed(0)}, ${newPos.z.toFixed(0)}) HP:${newHP?.toFixed(0)}/20 Food:${newFood}/20. Reason: ${reason || "strategic reset"}. Inventory lost!`;
  }
}

// Singleton instance for compatibility
export const botManager = new BotManager();
