import mineflayer, { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { EventEmitter } from "events";
import pkg from "mineflayer-pathfinder";
const { pathfinder, Movements, goals } = pkg;
import prismarineViewer from "prismarine-viewer";
const { mineflayer: mineflayerViewer } = prismarineViewer;

// Mamba向けの簡潔ステータスを付加するか（デフォルトはfalse=Claude向け）
const APPEND_BRIEF_STATUS = process.env.APPEND_BRIEF_STATUS === "true";

// ========== Dynamic Entity/Block Helpers ==========
// These use bot.registry for version-correct data instead of hardcoded lists

/** Check if entity is hostile using registry data */
function isHostileMob(bot: Bot, entityName: string): boolean {
  if (!entityName) return false;
  const name = entityName.toLowerCase();
  const entityInfo = bot.registry.entitiesByName[name];
  return entityInfo?.type === "hostile";
}

/** Check if entity is passive/animal using registry data */
function isPassiveMob(bot: Bot, entityName: string): boolean {
  if (!entityName) return false;
  const name = entityName.toLowerCase();
  const entityInfo = bot.registry.entitiesByName[name];
  return entityInfo?.type === "passive" || entityInfo?.type === "animal";
}

/** Check if block is an ore */
function isOreBlock(blockName: string): boolean {
  return blockName.includes("_ore");
}

/** Check if block is a log */
function isLogBlock(blockName: string): boolean {
  return blockName.includes("_log");
}

/** Check if item is food (can be eaten) */
function isFoodItem(bot: Bot, itemName: string): boolean {
  // Check if item has food property in registry
  const item = bot.registry.itemsByName[itemName];
  if (!item) return false;
  // Common food items end with these suffixes or are known foods
  const foodPatterns = ["_beef", "_porkchop", "_mutton", "_chicken", "_rabbit",
    "_cod", "_salmon", "bread", "apple", "carrot", "potato", "beetroot",
    "melon_slice", "sweet_berries", "glow_berries", "cookie", "pie", "cake",
    "stew", "soup", "dried_kelp", "rotten_flesh", "spider_eye", "chorus_fruit"];
  return foodPatterns.some(p => itemName.includes(p)) ||
         itemName.startsWith("cooked_") ||
         itemName.startsWith("baked_") ||
         itemName === "golden_apple" ||
         itemName === "enchanted_golden_apple";
}

/** Check if block requires pickaxe to mine */
function requiresPickaxe(bot: Bot, blockName: string): boolean {
  const block = bot.registry.blocksByName[blockName];
  return block?.material?.includes("pickaxe") || false;
}

/** Check if block requires axe to mine */
function requiresAxe(bot: Bot, blockName: string): boolean {
  const block = bot.registry.blocksByName[blockName];
  const mat = block?.material || "";
  return mat.includes("axe") && !mat.includes("pickaxe");
}

/** Check if block requires shovel to mine */
function requiresShovel(bot: Bot, blockName: string): boolean {
  const block = bot.registry.blocksByName[blockName];
  return block?.material?.includes("shovel") || false;
}

/** Check if item can be used as fuel */
function isFuelItem(itemName: string): boolean {
  // Fuel items: coal, charcoal, logs, planks, sticks, wooden tools, etc.
  const fuelPatterns = ["coal", "charcoal", "_log", "_planks", "_wood",
    "stick", "wooden_", "bamboo", "carpet", "wool", "banner",
    "scaffolding", "ladder", "fence", "boat", "bowl", "bookshelf"];
  return fuelPatterns.some(p => itemName.includes(p)) ||
         itemName === "blaze_rod" ||
         itemName === "dried_kelp_block" ||
         itemName === "lava_bucket";
}

/** Check if block is a bed */
function isBedBlock(blockName: string): boolean {
  return blockName.includes("_bed");
}

/** Check if block is solid and can be used as scaffold */
function isScaffoldBlock(bot: Bot, blockName: string): boolean {
  const blockInfo = bot.registry.blocksByName[blockName];
  if (!blockInfo) return false;
  if (blockInfo.boundingBox !== "block") return false;
  // Exclude valuable/special blocks
  const exclude = ["_ore", "spawner", "bedrock", "obsidian", "portal",
    "diamond_block", "emerald_block", "gold_block", "iron_block", "netherite_block",
    "ancient_debris", "crying_obsidian", "reinforced_deepslate"];
  return !exclude.some(p => blockName.includes(p));
}

/** Check if a pickaxe can harvest a block (using harvestTools from registry) */
function canPickaxeHarvest(bot: Bot, blockName: string, pickaxeName: string): boolean {
  const block = bot.registry.blocksByName[blockName];
  if (!block || !block.harvestTools) return true; // No tool requirement

  const pickaxe = bot.registry.itemsByName[pickaxeName];
  if (!pickaxe) return false;

  return block.harvestTools[pickaxe.id] === true;
}

/** Get the minimum pickaxe tier required for a block */
function getRequiredPickaxeTier(bot: Bot, blockName: string): string | null {
  const block = bot.registry.blocksByName[blockName];
  if (!block || !block.harvestTools) return null;

  // Check from lowest to highest tier
  const tiers = ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe", "golden_pickaxe", "diamond_pickaxe", "netherite_pickaxe"];
  for (const tier of tiers) {
    const item = bot.registry.itemsByName[tier];
    if (item && block.harvestTools[item.id]) {
      return tier;
    }
  }
  return "diamond_pickaxe"; // Default to highest if not found
}

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
  private viewerPorts: Map<string, number> = new Map(); // username -> viewer port
  private nextViewerPort = 3007;

  constructor() {
    super();
  }

  /**
   * Start prismarine-viewer for a bot
   */
  startViewer(username: string): number | null {
    const managed = this.bots.get(username);
    if (!managed) {
      console.error(`[BotManager] Cannot start viewer: bot '${username}' not found`);
      return null;
    }

    // Check if viewer already running for this bot
    if (this.viewerPorts.has(username)) {
      const port = this.viewerPorts.get(username)!;
      console.error(`[BotManager] Viewer for ${username} already running on port ${port}`);
      return port;
    }

    const viewerPort = this.nextViewerPort++;
    try {
      console.error(`[BotManager] Starting viewer for ${username} on port ${viewerPort}...`);
      mineflayerViewer(managed.bot, { port: viewerPort, firstPerson: true, viewDistance: 6 });
      this.viewerPorts.set(username, viewerPort);
      console.error(`[BotManager] Viewer started at http://localhost:${viewerPort}`);
      return viewerPort;
    } catch (err) {
      console.error(`[BotManager] Failed to start viewer on port ${viewerPort}:`, err);
      return null;
    }
  }

  getViewerPort(username: string): number | null {
    return this.viewerPorts.get(username) || null;
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
   * Only returns status if APPEND_BRIEF_STATUS=true (for Mamba agent)
   */
  private getBriefStatus(username: string): string {
    if (!APPEND_BRIEF_STATUS) return "";

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
    // Dynamically detect interesting blocks: ores, logs, and infrastructure
    const resources: Record<string, number> = {};
    const isInterestingBlock = (name: string): boolean => {
      return name.includes("_ore") ||
             name.includes("_log") ||
             ["crafting_table", "furnace", "chest", "barrel", "smoker", "blast_furnace"].includes(name);
    };

    for (let dx = -5; dx <= 5; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dz = -5; dz <= 5; dz++) {
          const block = bot.blockAt(pos.offset(dx, dy, dz));
          if (block && isInterestingBlock(block.name)) {
            resources[block.name] = (resources[block.name] || 0) + 1;
          }
        }
      }
    }

    // Dangers and nearby entities (using dynamic registry checks)
    const dangers: string[] = [];
    const nearbyEntities: { [key: string]: number } = {};

    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity) continue;
      const dist = entity.position.distanceTo(pos);
      const entityName = entity.name || "unknown";

      if (dist < 20) {
        // Determine entity key for counting
        let key = "unknown";
        const displayLower = entity.displayName?.toLowerCase() || "";
        const nameLower = entityName.toLowerCase();

        // Use registry to check entity type
        if (isPassiveMob(bot, nameLower) || isPassiveMob(bot, displayLower)) {
          key = nameLower || displayLower;
        } else if (isHostileMob(bot, nameLower) || isHostileMob(bot, displayLower)) {
          key = nameLower || displayLower;
        } else {
          key = nameLower || displayLower || "unknown";
        }
        nearbyEntities[key] = (nearbyEntities[key] || 0) + 1;

        // Check for dangers (hostile mobs within 12 blocks)
        if (dist < 12 && isHostileMob(bot, nameLower)) {
          dangers.push(`${entityName}(${dist.toFixed(0)}m)`);
        }
      }
    }

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

        // Enable digging for obstacle removal
        movements.canDig = true;

        // Enable 1x1 tower building for vertical movement
        movements.allow1by1towers = true;

        // Set scaffolding blocks (blocks that can be used for building towers/bridges)
        // pathfinder will automatically use these from inventory
        const scaffoldBlockNames = [
          "dirt", "cobblestone", "stone", "netherrack", "cobbled_deepslate",
          "oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks",
          "andesite", "diorite", "granite", "deepslate", "tuff",
          "sand", "gravel", "sandstone", "red_sandstone"
        ];
        movements.scafoldingBlocks = [];
        for (const name of scaffoldBlockNames) {
          const block = bot.registry.blocksByName[name];
          if (block) movements.scafoldingBlocks.push(block.id);
        }

        // Movement options
        movements.allowFreeMotion = true;
        movements.allowParkour = true;
        movements.allowSprinting = true;
        movements.maxDropDown = 4;

        // Don't break blocks that would cause issues
        movements.dontMineUnderFallingBlock = true;
        movements.dontCreateFlow = true;

        bot.pathfinder.setMovements(movements);
        console.error(`[BotManager] Pathfinder configured: canDig=true, allow1by1towers=true, scaffoldingBlocks=${movements.scafoldingBlocks.length} types`);

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

        // Oxygen level check (drowning detection)
        let lastOxygenLevel = 20;
        bot.on("breath", () => {
          const oxygen = bot.oxygenLevel ?? 20;
          if (oxygen < 10 && oxygen < lastOxygenLevel) {
            addEvent("drowning", `LOW OXYGEN: ${oxygen}/20! Swim up immediately!`, {
              oxygenLevel: oxygen,
            });
          }
          lastOxygenLevel = oxygen;
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
          if (entity.name && isHostileMob(bot, entity.name.toLowerCase())) {
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

        // Time update (day/night cycle) - emit when time crosses thresholds
        let lastTimeOfDay = -1;
        bot.on("time", () => {
          const time = bot.time.timeOfDay;
          const isDay = time >= 0 && time < 12000;
          const isNight = time >= 13000 && time < 23000;
          const isDusk = time >= 12000 && time < 13000;
          const isDawn = time >= 23000 || time < 0;

          // Detect time period changes
          let currentPeriod = "day";
          if (isNight) currentPeriod = "night";
          else if (isDusk) currentPeriod = "dusk";
          else if (isDawn) currentPeriod = "dawn";

          // Only emit on period change (check every ~1000 ticks)
          const timeBucket = Math.floor(time / 1000);
          if (timeBucket !== lastTimeOfDay) {
            lastTimeOfDay = timeBucket;
            if (isDusk) {
              addEvent("time_dusk", "Sun is setting. Consider finding shelter or sleeping.", { time, period: currentPeriod });
            } else if (time >= 13000 && time < 13500) {
              addEvent("time_night", "Night has fallen. Hostile mobs will spawn!", { time, period: currentPeriod });
            } else if (isDawn) {
              addEvent("time_dawn", "Dawn is breaking. Safe to go outside.", { time, period: currentPeriod });
            }
          }
        });

        // Entity gone (killed or despawned)
        bot.on("entityGone", (entity) => {
          if (entity.name && isHostileMob(bot, entity.name.toLowerCase())) {
            addEvent("entity_gone", `${entity.name} is gone (killed or despawned)`, {
              entityName: entity.name,
              entityId: entity.id,
            });
          }
        });

        // Block update (useful for knowing when mining completes)
        bot.on("blockUpdate", (oldBlock, newBlock) => {
          // Only emit for significant changes near the bot
          if (!oldBlock || !newBlock) return;
          const dist = oldBlock.position.distanceTo(bot.entity.position);
          if (dist > 6) return; // Only nearby blocks

          // Block broken (became air)
          if (oldBlock.name !== "air" && newBlock.name === "air") {
            addEvent("block_broken", `${oldBlock.name} broken at (${oldBlock.position.x}, ${oldBlock.position.y}, ${oldBlock.position.z})`, {
              blockName: oldBlock.name,
              position: { x: oldBlock.position.x, y: oldBlock.position.y, z: oldBlock.position.z },
            });
          }
        });

        // Heartbeat event (every 30 seconds for idle detection)
        let heartbeatCount = 0;
        const heartbeatInterval = setInterval(() => {
          if (!this.bots.has(config.username)) {
            clearInterval(heartbeatInterval);
            return;
          }
          heartbeatCount++;
          // Only emit heartbeat if no other events recently (30 seconds)
          const recentEvents = managedBot.gameEvents.filter(e => Date.now() - e.timestamp < 30000);
          if (recentEvents.length === 0) {
            addEvent("heartbeat", `Idle for 30+ seconds.`, {
              tick: heartbeatCount,
              health: bot.health,
              food: bot.food,
            });
          }
        }, 30000);

        // Store heartbeat interval for cleanup
        managedBot.particleInterval = heartbeatInterval;

        this.bots.set(config.username, managedBot);
        console.error(`[BotManager] ${config.username} connected`);

        // Start prismarine-viewer for first-person view in browser
        const viewerPort = this.startViewer(config.username);
        if (viewerPort) {
          console.error(`[BotManager] Open http://localhost:${viewerPort} to see the first-person view`);
        }

        // Return connection info with game mode warning
        let result = `Connected as ${config.username} (${gameMode} mode)`;
        if (viewerPort) {
          result += `. Viewer: http://localhost:${viewerPort}`;
        }
        if (gameMode !== "survival") {
          result += `. WARNING: Not in survival mode! Run /gamemode survival ${config.username} for items to drop.`;
        }
        resolve(result);
      });

      bot.once("error", (err) => {
        reject(new Error(`Connection error: ${err.message || err}`));
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
   * MoveTo using pathfinder - simplified version that relies on pathfinder's canDig and allow1by1towers
   */
  async moveTo(username: string, x: number, y: number, z: number): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const start = bot.entity.position;
    const targetPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    const distance = start.distanceTo(targetPos);

    console.error(`[Move] From (${start.x.toFixed(1)}, ${start.y.toFixed(1)}, ${start.z.toFixed(1)}) to (${x}, ${y}, ${z}), distance: ${distance.toFixed(1)}`);

    // Check if target position is inside a solid block (like ore)
    const targetBlock = bot.blockAt(targetPos);
    if (targetBlock && targetBlock.name !== "air" && targetBlock.name !== "water" && targetBlock.name !== "lava") {
      // Target is inside solid block - suggest mining approach
      const abovePos = targetPos.offset(0, 1, 0);
      const aboveBlock = bot.blockAt(abovePos);
      const isOre = targetBlock.name.includes("ore");

      if (isOre) {
        return `Cannot move into solid block (${targetBlock.name}). This is ore - move near it and use minecraft_dig_block to mine it. Suggested: move to (${x}, ${y + 1}, ${z}) or adjacent position first.`;
      }
      return `Cannot move into solid block (${targetBlock.name}). Move to an adjacent air block instead.`;
    }

    // Use pathfinder directly - it handles digging and tower building automatically
    const result = await this.moveToBasic(username, x, y, z);

    if (result.success) {
      return result.message + this.getBriefStatus(username);
    }

    // If pathfinder failed, report the reason
    const finalPos = bot.entity.position;
    const finalDist = finalPos.distanceTo(targetPos);
    const heightDiff = y - finalPos.y;

    let failureMsg = `Cannot reach (${x}, ${y}, ${z}). Current: (${finalPos.x.toFixed(1)}, ${finalPos.y.toFixed(1)}, ${finalPos.z.toFixed(1)}), ${finalDist.toFixed(1)} blocks away.`;

    // Give specific guidance based on the failure reason
    if (result.stuckReason === "target_higher") {
      const inv = bot.inventory.items();
      const hasScaffold = inv.some(i => ["dirt", "cobblestone", "stone", "planks"].some(b => i.name.includes(b)));
      if (hasScaffold) {
        failureMsg += ` Target is ${heightDiff.toFixed(0)} blocks higher. Try minecraft_pillar_up to climb.`;
      } else {
        failureMsg += ` Target is ${heightDiff.toFixed(0)} blocks higher. Need blocks (dirt, cobblestone) to climb. Collect materials first.`;
      }
    } else if (result.stuckReason === "target_lower") {
      failureMsg += ` Target is ${Math.abs(heightDiff).toFixed(0)} blocks lower. Dig down or find stairs/cave entrance.`;
    } else {
      failureMsg += ` Path blocked. Try moving around obstacles or mining through.`;
    }

    return failureMsg + this.getBriefStatus(username);
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

    // === 生存ステータス（最優先確認） ===
    const health = bot.health ?? 20;
    const food = bot.food ?? 20;
    // oxygenLevel can be -1 in some states, clamp to 0-20
    const rawOxygen = (bot as any).oxygenLevel;
    const oxygen = (rawOxygen === undefined || rawOxygen < 0) ? 20 : Math.min(rawOxygen, 20);

    // Check inventory for food and supplies (using dynamic helpers)
    const isTorchItem = (name: string) => name.includes("torch") || name.includes("lantern");

    let foodCount = 0;
    let torchCount = 0;
    let scaffoldCount = 0;
    const foodNames: string[] = [];

    for (const item of bot.inventory.items()) {
      if (isFoodItem(bot, item.name)) {
        foodCount += item.count;
        if (!foodNames.includes(item.name)) foodNames.push(item.name);
      }
      if (isTorchItem(item.name)) {
        torchCount += item.count;
      }
      if (isScaffoldBlock(bot, item.name)) {
        scaffoldCount += item.count;
      }
    }

    // Critical warnings first
    const warnings: string[] = [];
    if (health <= 5) {
      warnings.push(`🚨 HP危険: ${health.toFixed(1)}/20 - 即時撤退！`);
    } else if (health <= 10) {
      warnings.push(`⚠️ HP低下: ${health.toFixed(1)}/20 - 食事か撤退を検討`);
    }
    if (food <= 6) {
      warnings.push(`🚨 空腹危険: ${food}/20 - 今すぐ食べる！`);
    } else if (food <= 14) {
      warnings.push(`⚠️ 空腹注意: ${food}/20 - 食事推奨`);
    }
    if (oxygen < 10) {
      warnings.push(`🚨 酸素不足: ${oxygen}/20 - 水上へ脱出！`);
    }
    if (foodCount === 0) {
      warnings.push(`⚠️ 食料なし - 採掘・探索前に食料確保必須！`);
    }

    if (warnings.length > 0) {
      lines.push(`## 🚨 警告`);
      for (const w of warnings) {
        lines.push(w);
      }
      lines.push(``);
    }

    // Survival status summary
    lines.push(`## 生存ステータス`);
    lines.push(`HP: ${health.toFixed(1)}/20, 空腹: ${food}/20`);
    lines.push(`食料: ${foodCount}個${foodNames.length > 0 ? ` (${foodNames.slice(0, 3).join(", ")})` : ""}`);
    lines.push(`松明: ${torchCount}個, 足場ブロック: ${scaffoldCount}個`);

    // Equipment info
    const slots = bot.inventory.slots;
    const head = slots[5]?.name || "なし";
    const chest = slots[6]?.name || "なし";
    const legs = slots[7]?.name || "なし";
    const feet = slots[8]?.name || "なし";
    const mainHand = bot.heldItem?.name || "なし";
    const offHand = slots[45]?.name || "なし";

    const armorParts = [head, chest, legs, feet].filter(a => a !== "なし");
    if (armorParts.length > 0) {
      lines.push(`装備: ${armorParts.join(", ")}`);
    } else {
      lines.push(`装備: なし ⚠️`);
    }
    lines.push(`手: ${mainHand}${offHand !== "なし" ? ` / 盾: ${offHand}` : ""}`);
    lines.push(``);

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

    // 光レベル（参考情報のみ）
    const lightBlock = bot.blockAt(pos);
    const currentSkyLight = lightBlock?.skyLight ?? 0;
    const currentBlockLight = lightBlock?.light ?? 0;
    const effectiveLight = Math.max(currentSkyLight, currentBlockLight);
    lines.push(`光レベル: ${effectiveLight}`);

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

    // 敵モブチェック（動的判定）
    const nearbyHostiles: string[] = [];
    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity) continue;
      const dist = entity.position.distanceTo(pos);
      if (dist < 16 && isHostileMob(bot, entity.name?.toLowerCase() || "")) {
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

    // === 近くのエンティティ（動物など）動的判定 ===
    const nearbyFriendly: string[] = [];
    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity) continue;
      const dist = entity.position.distanceTo(pos);
      if (dist < 20 && isPassiveMob(bot, entity.name?.toLowerCase() || "")) {
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
    const found: Array<{ x: number; y: number; z: number; distance: number; name: string }> = [];
    const searchName = blockName.toLowerCase();

    // Search in a cube around the bot
    for (let x = -maxDistance; x <= maxDistance; x++) {
      for (let y = -maxDistance; y <= maxDistance; y++) {
        for (let z = -maxDistance; z <= maxDistance; z++) {
          const blockPos = pos.offset(x, y, z);
          const block = bot.blockAt(blockPos);
          if (block && block.name !== "air") {
            const name = block.name.toLowerCase();
            // Match exact, suffix (e.g., "bed" matches "red_bed"), or contains
            const isMatch = name === searchName ||
                           name.endsWith("_" + searchName) ||
                           name.includes(searchName);
            if (isMatch) {
              const dist = pos.distanceTo(blockPos);
              if (dist <= maxDistance) {
                found.push({
                  x: Math.floor(blockPos.x),
                  y: Math.floor(blockPos.y),
                  z: Math.floor(blockPos.z),
                  distance: Math.round(dist * 10) / 10,
                  name: block.name,
                });
              }
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
    const result = nearest.map(b => `${b.name} at (${b.x}, ${b.y}, ${b.z}) - ${b.distance} blocks`).join("\n");
    return `Found ${found.length} matching "${blockName}". Nearest:\n${result}`;
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
      // Try to move closer to the target position
      try {
        // Move to within reach distance of the target
        const goal = new goals.GoalNear(x, y, z, REACH_DISTANCE - 0.5);
        bot.pathfinder.setGoal(goal);

        // Wait for movement with timeout
        const startTime = Date.now();
        const timeout = 10000; // 10 seconds timeout

        while (bot.entity.position.distanceTo(targetPos) > REACH_DISTANCE && Date.now() - startTime < timeout) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        bot.pathfinder.setGoal(null);

        // Check if we're now within reach
        const newDistance = bot.entity.position.distanceTo(targetPos);
        if (newDistance > REACH_DISTANCE) {
          return {
            success: false,
            message: `Could not reach target. Distance: ${newDistance.toFixed(1)} blocks. Max reach is ${REACH_DISTANCE} blocks.`
          };
        }
      } catch (err) {
        return {
          success: false,
          message: `Target is too far (${distance.toFixed(1)} blocks). Failed to move closer: ${err}`
        };
      }
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
            .map(i => `${i.name}(${i.count})`)
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
      // For non-solid blocks like torches, placeBlock may timeout waiting for blockUpdate event
      // We'll handle this by catching the timeout and checking if the block was placed anyway
      await bot.placeBlock(referenceBlock.block, referenceBlock.faceVector);

      // Verify the block was placed
      const placedBlock = bot.blockAt(targetPos);
      if (placedBlock && (placedBlock.name === blockType || placedBlock.name === blockType.replace("minecraft:", ""))) {
        return { success: true, message: `Placed ${blockType} at (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})` };
      } else {
        return { success: false, message: `Block placement verification failed` };
      }
    } catch (err: any) {
      // If it's a timeout error, check if the block was actually placed
      if (err && (err.toString().includes('timeout') || err.toString().includes('Event blockUpdate'))) {
        // Wait a bit for the server to process the placement
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check multiple times for blocks that commonly timeout
        const specialBlocks = ['torch', 'furnace', 'crafting_table', 'chest', 'oak_slab', 'stone_slab', 'slab', 'dirt', 'sand', 'gravel', 'cobblestone', 'stone', 'grass_block'];
        const maxAttempts = specialBlocks.some(b => blockType.includes(b)) ? 4 : 3;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const placedBlock = bot.blockAt(targetPos);
          if (placedBlock && (placedBlock.name === blockType || placedBlock.name === blockType.replace("minecraft:", ""))) {
            return { success: true, message: `Placed ${blockType} at (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})` };
          }

          // Wait between attempts
          if (attempt < maxAttempts - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }

        // For certain blocks, timeout is often expected behavior
        // Check one more time after a longer wait
        const verificationPendingBlocks = ['torch', 'redstone_torch', 'soul_torch', 'lever', 'button'];
        if (verificationPendingBlocks.some(b => blockType.includes(b))) {
          await new Promise(resolve => setTimeout(resolve, 500));
          const placedBlock = bot.blockAt(targetPos);
          if (placedBlock && (placedBlock.name === blockType || placedBlock.name === blockType.replace("minecraft:", ""))) {
            return { success: true, message: `Placed ${blockType} at (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})` };
          }
          // Only allow "verification pending" for small decorative blocks, NOT chests/furnaces
          return { success: true, message: `Placed ${blockType} at (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}) (verification pending)` };
        }

        // For important blocks like chest/furnace, require actual verification
        const importantBlocks = ['chest', 'furnace', 'crafting_table'];
        if (importantBlocks.some(b => blockType.includes(b))) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const placedBlock = bot.blockAt(targetPos);
          if (placedBlock && (placedBlock.name === blockType || placedBlock.name === blockType.replace("minecraft:", ""))) {
            return { success: true, message: `Placed ${blockType} at (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})` };
          }
          return { success: false, message: `Failed to place ${blockType} - block not found at target position. Try a different location.` };
        }

        // For other blocks that timeout, check one more time with longer wait
        await new Promise(resolve => setTimeout(resolve, 1000));
        const placedBlock = bot.blockAt(targetPos);
        if (placedBlock && (placedBlock.name === blockType || placedBlock.name === blockType.replace("minecraft:", ""))) {
          return { success: true, message: `Placed ${blockType} at (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})` };
        }

        // If still not placed, it might be a server lag issue
        // Try one last time with a longer wait
        await new Promise(resolve => setTimeout(resolve, 2000));
        const finalCheck = bot.blockAt(targetPos);
        if (finalCheck && (finalCheck.name === blockType || finalCheck.name === blockType.replace("minecraft:", ""))) {
          return { success: true, message: `Placed ${blockType} at (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}) (delayed verification)` };
        }

        // If still not placed, return failure
        return { success: false, message: `Failed to place block: ${err}` };
      }

      // Non-timeout errors
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

      // Try multiple movement strategies
      let moved = false;

      // Calculate target position considering Y difference
      const yDiff = Math.abs(bot.entity.position.y - y);
      let targetRange = 3;
      if (yDiff > 2) {
        // If there's significant Y difference, get closer horizontally
        targetRange = 2;
      }

      // Configure pathfinder for better vertical movement
      const originalScaffoldingBlocks = bot.pathfinder.movements.scafoldingBlocks;
      bot.pathfinder.movements.scafoldingBlocks = bot.registry.blocksArray
        .filter(block => block.material && block.material === 'rock')
        .map(block => block.id);
      bot.pathfinder.movements.allowParkour = false; // Disable parkour for more predictable movement
      bot.pathfinder.movements.allowSprinting = false; // Disable sprinting to be more careful
      bot.pathfinder.movements.maxDropDown = 10; // Allow larger drops
      bot.pathfinder.movements.infiniteLiquidDropdownDistance = true; // Allow dropping into water from any height

      // First try: Get close with pathfinder
      // Temporarily enable digging to reach difficult blocks
      const originalCanDig = bot.pathfinder.movements.canDig;
      bot.pathfinder.movements.canDig = true;

      // For large Y differences, try to build/pillar up first
      if (yDiff > 2) {
        console.error(`[Dig] Large Y difference (${yDiff.toFixed(1)}), trying to build up/dig down...`);

        // Move horizontally closer first
        const horizontalGoal = new goals.GoalXZ(Math.floor(x), Math.floor(z));
        bot.pathfinder.setGoal(horizontalGoal);

        // Wait for horizontal movement
        const horizontalStart = Date.now();
        while (Date.now() - horizontalStart < 10000) {
          await this.delay(300);
          const horizontalDistance = Math.sqrt(
            Math.pow(bot.entity.position.x - x, 2) +
            Math.pow(bot.entity.position.z - z, 2)
          );
          if (horizontalDistance <= 3 || !bot.pathfinder.isMoving()) {
            break;
          }
        }
        bot.pathfinder.setGoal(null);

        // After getting horizontally closer, enable building to reach higher blocks
        // Note: scaffolding blocks are already set above
        bot.pathfinder.movements.blocksCantBreak.clear(); // Allow breaking blocks if needed
      }

      const goal = new goals.GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), targetRange);
      bot.pathfinder.setGoal(goal);

      // Wait for movement (max 25 seconds for difficult vertical movements)
      const startTime = Date.now();
      while (Date.now() - startTime < 25000) {
        await this.delay(300);
        distance = bot.entity.position.distanceTo(blockPos);
        if (distance <= REACH_DISTANCE) {
          moved = true;
          break;
        }
        if (!bot.pathfinder.isMoving()) {
          break;
        }
      }
      bot.pathfinder.setGoal(null);

      // Restore original digging setting
      bot.pathfinder.movements.canDig = originalCanDig;

      // Second try: If still too far, try direct movement
      if (!moved && distance > REACH_DISTANCE) {
        console.error(`[Dig] Pathfinder failed, trying direct movement...`);

        // Special handling for large Y differences
        const yDiff = Math.abs(bot.entity.position.y - y);
        if (yDiff > 3) {
          console.error(`[Dig] Large Y difference detected (${yDiff.toFixed(1)} blocks), trying vertical approach...`);

          // Try to move to a position horizontally aligned but at a better Y level
          // If block is above us, try to pillar up or find a higher position
          // If block is below us, get closer horizontally
          if (bot.entity.position.y < y) {
            // Block is above, try to get to same Y level
            const targetY = Math.min(y, bot.entity.position.y + 3);
            try {
              await this.moveToBasic(username, x, targetY, z);
              await this.delay(500);
              distance = bot.entity.position.distanceTo(blockPos);
              if (distance <= REACH_DISTANCE) {
                moved = true;
              }
            } catch (e) {
              console.error(`[Dig] Vertical upward approach failed: ${e}`);
            }
          } else {
            // Block is below, get closer horizontally first
            const horizontalDistance = Math.sqrt(
              Math.pow(bot.entity.position.x - x, 2) +
              Math.pow(bot.entity.position.z - z, 2)
            );
            if (horizontalDistance > 2) {
              try {
                // Move closer horizontally while maintaining current Y
                const direction = new Vec3(x - bot.entity.position.x, 0, z - bot.entity.position.z).normalize();
                const targetPos = bot.entity.position.plus(direction.scaled(horizontalDistance - 2));
                await this.moveToBasic(username, targetPos.x, bot.entity.position.y, targetPos.z);
                await this.delay(500);
                distance = bot.entity.position.distanceTo(blockPos);
                if (distance <= REACH_DISTANCE) {
                  moved = true;
                }
              } catch (e) {
                console.error(`[Dig] Horizontal approach failed: ${e}`);
              }
            }
          }
        }

        if (!moved) {
          const direction = blockPos.minus(bot.entity.position).normalize();
          const targetPos = blockPos.minus(direction.scaled(3));

          try {
            await this.moveToBasic(username, targetPos.x, targetPos.y, targetPos.z);
            await this.delay(500);
            distance = bot.entity.position.distanceTo(blockPos);
            if (distance <= REACH_DISTANCE) {
              moved = true;
            }
          } catch (e) {
            console.error(`[Dig] Direct movement failed: ${e}`);
          }
        }
      }

      distance = bot.entity.position.distanceTo(blockPos);
      console.error(`[Dig] After moving, distance: ${distance.toFixed(1)}`);

      if (distance > REACH_DISTANCE) {
        // Try to find adjacent reachable position
        const offsets = [
          new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
          new Vec3(0, 0, 1), new Vec3(0, 0, -1),
          new Vec3(1, 0, 1), new Vec3(-1, 0, 1),
          new Vec3(1, 0, -1), new Vec3(-1, 0, -1),
          // Add Y-level variations
          new Vec3(0, 1, 0), new Vec3(0, -1, 0),
          new Vec3(1, 1, 0), new Vec3(-1, 1, 0),
          new Vec3(0, 1, 1), new Vec3(0, 1, -1)
        ];

        for (const offset of offsets) {
          const testPos = blockPos.plus(offset);
          const testDistance = bot.entity.position.distanceTo(testPos);
          if (testDistance <= REACH_DISTANCE) {
            const adjacentBlock = bot.blockAt(testPos);
            if (!adjacentBlock || adjacentBlock.name === "air") {
              console.error(`[Dig] Found reachable adjacent position`);
              distance = bot.entity.position.distanceTo(blockPos);
              break;
            }
          }
        }

        if (distance > REACH_DISTANCE) {
          // Provide more detailed error information
          const yDiff = Math.abs(bot.entity.position.y - y);
          const horizontalDistance = Math.sqrt(
            Math.pow(bot.entity.position.x - x, 2) +
            Math.pow(bot.entity.position.z - z, 2)
          );

          let reason = "";
          if (yDiff > 10) {
            reason = ` Y difference too large (${yDiff.toFixed(1)} blocks).`;
          } else if (horizontalDistance > 20) {
            reason = ` Horizontal distance too large (${horizontalDistance.toFixed(1)} blocks).`;
          } else {
            reason = ` Block may be obstructed or in unreachable location.`;
          }

          return `Cannot reach block at (${x}, ${y}, ${z}). Stopped ${distance.toFixed(1)} blocks away. Block may be unreachable.`;
        }
      }
    }

    // Check if block is diggable
    if (block.hardness < 0) {
      return `Cannot dig ${blockName} (unbreakable like bedrock)`;
    }

    // Auto-equip the best tool for this block type (using dynamic registry check)
    let toolType: "pickaxe" | "axe" | "shovel" | null = null;
    if (requiresPickaxe(bot, blockName)) {
      toolType = "pickaxe";
    } else if (requiresAxe(bot, blockName)) {
      toolType = "axe";
    } else if (requiresShovel(bot, blockName)) {
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

      // Check if tool is sufficient for this block (using dynamic registry check)
      if (toolType === "pickaxe" && equippedTool) {
        if (!canPickaxeHarvest(bot, blockName, equippedTool)) {
          const requiredTier = getRequiredPickaxeTier(bot, blockName);
          return `Cannot mine ${blockName} - requires ${requiredTier || "better pickaxe"}! You have: ${equippedTool}. Craft the required pickaxe first.`;
        }
      } else if (toolType === "pickaxe" && !equippedTool) {
        const requiredTier = getRequiredPickaxeTier(bot, blockName);
        if (requiredTier) {
          return `Cannot mine ${blockName} - requires ${requiredTier}! No pickaxe equipped. Craft the required pickaxe first.`;
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
      const currentDistance = bot.entity.position.distanceTo(blockPos);
      console.error(`[Dig] canDigBlock: ${canDig}, current distance: ${currentDistance.toFixed(1)}`);

      if (!canDig) {
        // Get more specific error information
        const reasons = [];
        if (currentDistance > REACH_DISTANCE) {
          reasons.push(`too far (${currentDistance.toFixed(1)} blocks, max: ${REACH_DISTANCE})`);
        }
        if (block.shapes && block.shapes.length === 0) {
          reasons.push(`block has no collision shape`);
        }

        // Check tool requirements dynamically using registry
        const heldItem = bot.heldItem;
        const requiredTier = getRequiredPickaxeTier(bot, blockName);

        if (requiredTier && heldItem) {
          // Check if held pickaxe can harvest this block
          if (heldItem.name.includes("pickaxe")) {
            if (!canPickaxeHarvest(bot, blockName, heldItem.name)) {
              reasons.push(`requires ${requiredTier} or better (have: ${heldItem.name})`);
            }
          } else {
            reasons.push(`requires pickaxe (have: ${heldItem.name})`);
          }
        } else if (requiredTier && !heldItem) {
          reasons.push(`requires ${requiredTier} (have: empty hand)`);
        }

        // If the only reason is distance or tool, we might still be able to dig
        // Let's try anyway if we have the right tool
        if (reasons.length === 0 || (reasons.length === 1 && !reasons[0].includes('too far'))) {
          // Continue trying to dig even if canDig is false
        } else {
          return `Cannot dig ${blockName} at (${x}, ${y}, ${z}) - ${reasons.length > 0 ? reasons.join(', ') : 'unknown reason (may be protected)'}`;
        }
      }

      // Look at the block first
      await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));

      console.error(`[Dig] Starting to dig ${blockName}...`);
      const digTime = bot.digTime(block);
      console.error(`[Dig] Estimated dig time: ${digTime}ms`);

      // Stop all movements before digging to prevent "Digging aborted" error
      bot.clearControlStates();
      bot.pathfinder.setGoal(null);

      // Wait a bit to ensure bot is stable
      await this.delay(300);

      // Re-check block exists before digging
      const blockBeforeDig = bot.blockAt(blockPos);
      if (!blockBeforeDig || blockBeforeDig.name === "air") {
        return `Block at (${x}, ${y}, ${z}) no longer exists`;
      }

      try {
        await bot.dig(blockBeforeDig, true);  // forceLook = true
        console.error(`[Dig] Finished digging ${blockName}`);
      } catch (digError: any) {
        console.error(`[Dig] Dig failed: ${digError.message}`);

        // If digging was aborted, it might be due to movement or distance
        if (digError.message.includes("aborted")) {
          // Try once more after ensuring we're close and stable
          const currentDist = bot.entity.position.distanceTo(blockPos);
          if (currentDist > 4.5) {
            // Too far, need to get closer
            return `Failed to dig ${blockName}: Too far away (${currentDist.toFixed(1)} blocks). Move closer first.`;
          }

          // Clear movements again and retry
          bot.clearControlStates();
          bot.pathfinder.setGoal(null);
          await this.delay(500);

          // Re-check and re-acquire the block reference
          const blockRetry = bot.blockAt(blockPos);
          if (!blockRetry || blockRetry.name === "air") {
            return `Block at (${x}, ${y}, ${z}) no longer exists`;
          }

          try {
            await bot.lookAt(blockRetry.position.offset(0.5, 0.5, 0.5));
            await bot.dig(blockRetry, true);
            console.error(`[Dig] Retry successful for ${blockName}`);
          } catch (retryError: any) {
            return `Failed to dig ${blockName}: ${retryError.message}`;
          }
        } else {
          return `Failed to dig ${blockName}: ${digError.message}`;
        }
      }

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

  /**
   * Level ground in an area - dig blocks above target height and fill holes below
   */
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
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const { centerX, centerZ, radius, mode } = options;
    let { targetY, fillBlock } = options;

    // Step 1: Scan area and determine target Y if not specified
    const blockHeights: Map<number, number> = new Map(); // y -> count
    const blocksToProcess: Array<{ x: number; y: number; z: number; action: "dig" | "fill" }> = [];

    console.error(`[LevelGround] Scanning area: center=(${centerX}, ${centerZ}), radius=${radius}`);

    // Scan area to find ground heights
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const x = Math.floor(centerX + dx);
        const z = Math.floor(centerZ + dz);

        // Find highest solid block at this position (scan from top down)
        for (let y = 100; y >= -60; y--) {
          const block = bot.blockAt(new (bot as any).Vec3(x, y, z));
          if (block && block.name !== "air" && !block.name.includes("leaves") && !block.name.includes("log")) {
            const count = blockHeights.get(y) || 0;
            blockHeights.set(y, count + 1);
            break;
          }
        }
      }
    }

    // Auto-detect target Y: most common ground level
    if (targetY === undefined) {
      let maxCount = 0;
      for (const [y, count] of blockHeights) {
        if (count > maxCount) {
          maxCount = count;
          targetY = y;
        }
      }
      console.error(`[LevelGround] Auto-detected targetY: ${targetY} (${maxCount} blocks at this level)`);
    }

    if (targetY === undefined) {
      return "Failed to detect ground level. Please specify target_y manually.";
    }

    // Step 2: Identify blocks to dig and positions to fill
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const x = Math.floor(centerX + dx);
        const z = Math.floor(centerZ + dz);

        // Check blocks above targetY (to dig)
        if (mode === "dig" || mode === "both") {
          for (let y = targetY + 1; y <= targetY + 10; y++) {
            const block = bot.blockAt(new (bot as any).Vec3(x, y, z));
            if (block && block.name !== "air" && !block.name.includes("bedrock")) {
              blocksToProcess.push({ x, y, z, action: "dig" });
            }
          }
        }

        // Check if position at targetY needs filling
        if (mode === "fill" || mode === "both") {
          const blockAtTarget = bot.blockAt(new (bot as any).Vec3(x, targetY, z));
          if (!blockAtTarget || blockAtTarget.name === "air" || blockAtTarget.name.includes("water")) {
            blocksToProcess.push({ x, y: targetY, z, action: "fill" });
          }
        }
      }
    }

    // Sort: dig from top to bottom, fill from bottom
    blocksToProcess.sort((a, b) => {
      if (a.action === "dig" && b.action === "dig") return b.y - a.y; // Top to bottom
      if (a.action === "fill" && b.action === "fill") return a.y - b.y; // Bottom to top
      return a.action === "dig" ? -1 : 1; // Dig before fill
    });

    console.error(`[LevelGround] Found ${blocksToProcess.length} blocks to process`);

    // Auto-select fill block from inventory if not specified
    if ((mode === "fill" || mode === "both") && !fillBlock) {
      const fillCandidates = ["dirt", "cobblestone", "stone", "sand", "gravel"];
      for (const candidate of fillCandidates) {
        const item = bot.inventory.items().find(i => i.name === candidate);
        if (item && item.count > 0) {
          fillBlock = candidate;
          console.error(`[LevelGround] Auto-selected fill block: ${fillBlock}`);
          break;
        }
      }
    }

    // Step 3: Process blocks
    let dugCount = 0;
    let filledCount = 0;
    let errorCount = 0;
    const maxErrors = 5;

    for (const task of blocksToProcess) {
      if (errorCount >= maxErrors) {
        console.error(`[LevelGround] Too many errors, stopping`);
        break;
      }

      try {
        // Move to position if too far
        const distance = Math.sqrt(
          Math.pow(bot.entity.position.x - task.x, 2) +
          Math.pow(bot.entity.position.z - task.z, 2)
        );

        if (distance > 4) {
          const goal = new goals.GoalNear(task.x, task.y, task.z, 2);
          bot.pathfinder.setGoal(goal);
          await this.delay(2000);
          bot.pathfinder.setGoal(null);
        }

        if (task.action === "dig") {
          const block = bot.blockAt(new (bot as any).Vec3(task.x, task.y, task.z));
          if (block && block.name !== "air") {
            await bot.dig(block);
            dugCount++;
          }
        } else if (task.action === "fill" && fillBlock) {
          const item = bot.inventory.items().find(i => i.name === fillBlock);
          if (item) {
            await bot.equip(item, "hand");
            const blockBelow = bot.blockAt(new (bot as any).Vec3(task.x, task.y - 1, task.z));
            if (blockBelow && blockBelow.name !== "air") {
              try {
                await bot.placeBlock(blockBelow, new (bot as any).Vec3(0, 1, 0));
                filledCount++;
              } catch {
                // Ignore placement errors
              }
            }
          }
        }

        // Brief delay between operations
        await this.delay(100);

      } catch (err) {
        errorCount++;
        console.error(`[LevelGround] Error at (${task.x}, ${task.y}, ${task.z}): ${err}`);
      }
    }

    // Collect dropped items
    await this.collectNearbyItems(username);

    const result = `Leveled ground at (${centerX}, ${centerZ}) radius ${radius}, targetY=${targetY}. ` +
      `Dug: ${dugCount} blocks, Filled: ${filledCount} blocks` +
      (errorCount > 0 ? `, Errors: ${errorCount}` : "");

    return result + this.getBriefStatus(username);
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
        // Some servers/versions may use different identifiers
        const isItem = entity.id !== bot.entity.id && (
          entity.name === "item" ||
          entity.name === "Item" ||
          (entity.type === "object" && entity.name === "item") ||
          (entity.displayName && entity.displayName.includes("item")) ||
          (entity.objectType && entity.objectType === "Item") ||
          // Additional check for items using metadata
          (entity.metadata && entity.metadata[10] !== undefined)
        );
        
        return isItem;
      });
    };

    let items = findItems();

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
          // Very close - move directly
          await bot.lookAt(itemPos);
          bot.setControlState("forward", true);
          await this.delay(500);
          bot.setControlState("forward", false);
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
            await this.delay(200);
            
            // Check if item still exists
            if (!bot.entities[item.id]) {
              reachedItem = true;
              break;
            }
            
            // Check if we're close enough
            const currentDist = bot.entity.position.distanceTo(itemPos);
            if (currentDist < 1.5) {
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
              await this.delay(800);
              bot.setControlState("forward", false);
            }
          }
        }

        // Wait for auto-pickup and check if item was collected
        await this.delay(300);
        
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
      return `Collected ${actuallyCollected} items (inventory: ${inventoryAfter} total)` + this.getBriefStatus(username);
    } else if (collectedCount > 0) {
      return `Approached ${collectedCount} items but inventory unchanged. Items may have been collected by other means or blocked.`;
    } else {
      return `No items collected after ${maxAttempts} attempts - items may have despawned or be inaccessible`;
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

  /**
   * List all recipes (categorized)
   */
  async listAllRecipes(username: string, category?: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const minecraftData = await import("minecraft-data");
    const mcData = minecraftData.default(bot.version);

    // Define useful recipes by category
    const recipes: Record<string, { name: string; ingredients: string }[]> = {
      tools: [
        { name: "wooden_pickaxe", ingredients: "3 planks + 2 sticks" },
        { name: "stone_pickaxe", ingredients: "3 cobblestone + 2 sticks" },
        { name: "iron_pickaxe", ingredients: "3 iron_ingot + 2 sticks" },
        { name: "diamond_pickaxe", ingredients: "3 diamond + 2 sticks" },
        { name: "wooden_axe", ingredients: "3 planks + 2 sticks" },
        { name: "stone_axe", ingredients: "3 cobblestone + 2 sticks" },
        { name: "iron_axe", ingredients: "3 iron_ingot + 2 sticks" },
        { name: "wooden_shovel", ingredients: "1 plank + 2 sticks" },
        { name: "stone_shovel", ingredients: "1 cobblestone + 2 sticks" },
        { name: "iron_shovel", ingredients: "1 iron_ingot + 2 sticks" },
      ],
      weapons: [
        { name: "wooden_sword", ingredients: "2 planks + 1 stick" },
        { name: "stone_sword", ingredients: "2 cobblestone + 1 stick" },
        { name: "iron_sword", ingredients: "2 iron_ingot + 1 stick" },
        { name: "diamond_sword", ingredients: "2 diamond + 1 stick" },
        { name: "bow", ingredients: "3 sticks + 3 string" },
        { name: "arrow", ingredients: "1 flint + 1 stick + 1 feather" },
        { name: "shield", ingredients: "6 planks + 1 iron_ingot" },
      ],
      armor: [
        { name: "leather_helmet", ingredients: "5 leather" },
        { name: "leather_chestplate", ingredients: "8 leather" },
        { name: "leather_leggings", ingredients: "7 leather" },
        { name: "leather_boots", ingredients: "4 leather" },
        { name: "iron_helmet", ingredients: "5 iron_ingot" },
        { name: "iron_chestplate", ingredients: "8 iron_ingot" },
        { name: "iron_leggings", ingredients: "7 iron_ingot" },
        { name: "iron_boots", ingredients: "4 iron_ingot" },
      ],
      basics: [
        { name: "crafting_table", ingredients: "4 planks (no table needed)" },
        { name: "stick", ingredients: "2 planks (no table needed)" },
        { name: "planks", ingredients: "1 log (no table needed)" },
        { name: "chest", ingredients: "8 planks" },
        { name: "furnace", ingredients: "8 cobblestone" },
        { name: "torch", ingredients: "1 coal + 1 stick" },
        { name: "bed", ingredients: "3 wool + 3 planks" },
        { name: "bucket", ingredients: "3 iron_ingot" },
      ],
      food: [
        { name: "bread", ingredients: "3 wheat" },
        { name: "cake", ingredients: "3 milk + 2 sugar + 1 egg + 3 wheat" },
        { name: "golden_apple", ingredients: "8 gold_ingot + 1 apple" },
      ],
      building: [
        { name: "stone_bricks", ingredients: "4 stone" },
        { name: "ladder", ingredients: "7 sticks" },
        { name: "fence", ingredients: "4 planks + 2 sticks" },
        { name: "door", ingredients: "6 planks" },
        { name: "trapdoor", ingredients: "6 planks" },
        { name: "glass_pane", ingredients: "6 glass" },
      ],
    };

    if (category && recipes[category]) {
      const list = recipes[category]
        .map(r => `- ${r.name}: ${r.ingredients}`)
        .join("\n");
      return `## ${category.toUpperCase()} Recipes\n${list}`;
    }

    // Return all categories summary
    let result = "## All Craftable Items\n\n";
    for (const [cat, items] of Object.entries(recipes)) {
      result += `### ${cat.toUpperCase()}\n`;
      result += items.map(r => `- ${r.name}: ${r.ingredients}`).join("\n");
      result += "\n\n";
    }
    return result;
  }

  /**
   * List items that can be crafted with current inventory
   */
  async listCraftableNow(username: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const minecraftData = await import("minecraft-data");
    const mcData = minecraftData.default(bot.version);

    // Get current inventory
    const inventory: Record<string, number> = {};
    for (const item of bot.inventory.items()) {
      inventory[item.name] = (inventory[item.name] || 0) + item.count;
    }

    // Check for crafting table nearby
    const craftingTableId = mcData.blocksByName.crafting_table?.id;
    const hasCraftingTable = !!bot.findBlock({
      matching: craftingTableId,
      maxDistance: 4,
    });

    // Define recipes with requirements
    const allRecipes = [
      { name: "planks", needs: { oak_log: 1 }, noTable: true, output: 4, alt: ["birch_log", "spruce_log"] },
      { name: "stick", needs: { oak_planks: 2 }, noTable: true, output: 4, alt: ["birch_planks", "spruce_planks"] },
      { name: "crafting_table", needs: { oak_planks: 4 }, noTable: true, alt: ["birch_planks", "spruce_planks"] },
      { name: "chest", needs: { oak_planks: 8 }, alt: ["birch_planks", "spruce_planks"] },
      { name: "furnace", needs: { cobblestone: 8 } },
      { name: "torch", needs: { coal: 1, stick: 1 }, output: 4 },
      { name: "wooden_pickaxe", needs: { oak_planks: 3, stick: 2 }, alt: ["birch_planks", "spruce_planks"] },
      { name: "stone_pickaxe", needs: { cobblestone: 3, stick: 2 } },
      { name: "iron_pickaxe", needs: { iron_ingot: 3, stick: 2 } },
      { name: "diamond_pickaxe", needs: { diamond: 3, stick: 2 } },
      { name: "wooden_sword", needs: { oak_planks: 2, stick: 1 }, alt: ["birch_planks", "spruce_planks"] },
      { name: "stone_sword", needs: { cobblestone: 2, stick: 1 } },
      { name: "iron_sword", needs: { iron_ingot: 2, stick: 1 } },
      { name: "wooden_axe", needs: { oak_planks: 3, stick: 2 }, alt: ["birch_planks", "spruce_planks"] },
      { name: "stone_axe", needs: { cobblestone: 3, stick: 2 } },
      { name: "iron_axe", needs: { iron_ingot: 3, stick: 2 } },
      { name: "bucket", needs: { iron_ingot: 3 } },
      { name: "shield", needs: { oak_planks: 6, iron_ingot: 1 }, alt: ["birch_planks", "spruce_planks"] },
      { name: "bed", needs: { oak_planks: 3, white_wool: 3 }, alt: ["birch_planks", "spruce_planks"] },
      { name: "bread", needs: { wheat: 3 } },
      { name: "iron_helmet", needs: { iron_ingot: 5 } },
      { name: "iron_chestplate", needs: { iron_ingot: 8 } },
      { name: "iron_leggings", needs: { iron_ingot: 7 } },
      { name: "iron_boots", needs: { iron_ingot: 4 } },
    ];

    const craftable: string[] = [];
    const almostCraftable: { name: string; missing: string }[] = [];

    for (const recipe of allRecipes) {
      // Skip if requires crafting table and none nearby
      if (!recipe.noTable && !hasCraftingTable) continue;

      let canCraft = true;
      const missingItems: string[] = [];

      for (const [item, count] of Object.entries(recipe.needs)) {
        let have = inventory[item] || 0;

        // Check alternative items (e.g., different wood types)
        if (have < count && recipe.alt) {
          for (const altItem of recipe.alt) {
            const altName = item.replace("oak_", "").replace("birch_", "").replace("spruce_", "");
            const checkItem = altItem.includes(altName) ? altItem : item.replace("oak_", altItem.split("_")[0] + "_");
            have += inventory[checkItem] || 0;
          }
        }

        if (have < count) {
          canCraft = false;
          missingItems.push(`${item} (need ${count}, have ${have})`);
        }
      }

      if (canCraft) {
        craftable.push(recipe.name + (recipe.output ? ` (makes ${recipe.output})` : ""));
      } else if (missingItems.length === 1) {
        almostCraftable.push({ name: recipe.name, missing: missingItems[0] });
      }
    }

    let result = `## Inventory: ${Object.entries(inventory).map(([k, v]) => `${k}(${v})`).join(", ") || "empty"}\n`;
    result += `## Crafting Table: ${hasCraftingTable ? "nearby" : "NOT nearby"}\n\n`;

    if (craftable.length > 0) {
      result += `### Can Craft NOW:\n${craftable.map(c => `- ${c}`).join("\n")}\n\n`;
    } else {
      result += "### Can Craft NOW: Nothing\n\n";
    }

    if (almostCraftable.length > 0) {
      result += `### Almost Craftable (1 item missing):\n`;
      result += almostCraftable.map(a => `- ${a.name}: missing ${a.missing}`).join("\n");
    }

    return result;
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

    // Get recipes - try with and without crafting table
    const craftingTableId = mcData.blocksByName.crafting_table?.id;

    // First check nearby (4 blocks)
    let craftingTable = bot.findBlock({
      matching: craftingTableId,
      maxDistance: 4,
    });

    // If not nearby, search wider and move to it
    if (!craftingTable) {
      const farTable = bot.findBlock({
        matching: craftingTableId,
        maxDistance: 32,
      });

      if (farTable) {
        console.error(`[Craft] Found crafting table at ${farTable.position}, moving...`);
        const goal = new goals.GoalNear(farTable.position.x, farTable.position.y, farTable.position.z, 3);
        bot.pathfinder.setGoal(goal);

        // Wait for movement
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            bot.pathfinder.setGoal(null);
            resolve();
          }, 10000);

          const check = setInterval(() => {
            const dist = bot.entity.position.distanceTo(farTable.position);
            if (dist < 4 || !bot.pathfinder.isMoving()) {
              clearInterval(check);
              clearTimeout(timeout);
              bot.pathfinder.setGoal(null);
              resolve();
            }
          }, 300);
        });

        // Re-check nearby
        craftingTable = bot.findBlock({
          matching: craftingTableId,
          maxDistance: 4,
        });
      }
    }

    // Always use recipesAll to get all possible recipes for this item
    // recipesFor sometimes misses valid recipes due to ingredient matching issues
    let recipes;
    if (craftingTable) {
      recipes = bot.recipesAll(item.id, null, craftingTable);
    } else {
      recipes = bot.recipesAll(item.id, null, null);
    }

    // Helper function to check if we have a compatible item
    // Returns a virtual item with the total count of all compatible items
    const findCompatibleItem = (ingredientName: string) => {
      // First try exact match - but sum up ALL stacks of the same item
      const exactMatches = inventoryItems.filter(i => i.name === ingredientName);
      if (exactMatches.length > 0) {
        const totalCount = exactMatches.reduce((sum, item) => sum + item.count, 0);
        // Return a virtual item representing the total count
        return { name: ingredientName, count: totalCount };
      }

      // Try compatible substitutions for common materials
      const compatibleMaterials: Record<string, string[]> = {
        // Any planks can substitute for any other planks
        "oak_planks": ["spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
        "spruce_planks": ["oak_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
        "birch_planks": ["oak_planks", "spruce_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
        "jungle_planks": ["oak_planks", "spruce_planks", "birch_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
        "acacia_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
        "dark_oak_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
        "mangrove_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "cherry_planks", "pale_oak_planks"],
        "cherry_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "pale_oak_planks"],
        "pale_oak_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks"],
        // Any logs can substitute for any other logs
        "oak_log": ["spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
        "spruce_log": ["oak_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
        "birch_log": ["oak_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
        "jungle_log": ["oak_log", "spruce_log", "birch_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
        "acacia_log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "dark_oak_log", "mangrove_log", "cherry_log"],
        "dark_oak_log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "mangrove_log", "cherry_log"],
        "mangrove_log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "cherry_log"],
        "cherry_log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log"],
        // Cobblestone and cobbled_deepslate are interchangeable for most recipes
        "cobblestone": ["cobbled_deepslate"],
        "cobbled_deepslate": ["cobblestone"],
        // Coal and charcoal are interchangeable for torch and other recipes
        "coal": ["charcoal"],
        "charcoal": ["coal"],
      };

      // Check if we have any compatible substitute
      const compatibles = compatibleMaterials[ingredientName] || [];
      for (const compatible of compatibles) {
        const compatibleMatches = inventoryItems.filter(i => i.name === compatible);
        if (compatibleMatches.length > 0) {
          const totalCount = compatibleMatches.reduce((sum, item) => sum + item.count, 0);
          // Return a virtual item representing the total count of the compatible item
          return { name: compatible, count: totalCount };
        }
      }

      // Also check reverse compatibility (e.g., if looking for cobbled_deepslate, check if cobblestone lists it as compatible)
      for (const [materialName, compatibleList] of Object.entries(compatibleMaterials)) {
        if (compatibleList.includes(ingredientName)) {
          const reverseMatches = inventoryItems.filter(i => i.name === materialName);
          if (reverseMatches.length > 0) {
            const totalCount = reverseMatches.reduce((sum, item) => sum + item.count, 0);
            return { name: materialName, count: totalCount };
          }
        }
      }

      return null;
    };

    // Filter recipes to only those we can actually craft with current inventory
    // Check both exact matches AND compatible substitutes
    const craftableRecipes = recipes.filter(recipe => {
      const delta = recipe.delta as Array<{ id: number; count: number }>;
      return delta.every(d => {
        if (d.count >= 0) return true; // Output items, always ok

        const ingredientItem = mcData.items[d.id];
        const ingredientName = ingredientItem?.name;
        if (!ingredientName) return false;

        const requiredCount = Math.abs(d.count);

        // First check if we have the EXACT item required by this recipe
        const exactMatches = inventoryItems.filter(i => i.name === ingredientName);
        const exactCount = exactMatches.reduce((sum, item) => sum + item.count, 0);

        if (exactCount >= requiredCount) {
          return true; // We have enough of the exact item
        }

        // If not enough exact matches, check for compatible substitutes
        const compatibleItem = findCompatibleItem(ingredientName);
        if (compatibleItem && compatibleItem.count >= requiredCount) {
          return true; // We have enough of a compatible substitute
        }

        return false;
      });
    });

    if (craftableRecipes.length === 0) {
      // Try to get all recipes for this item (even if we can't craft them)
      let allRecipes = bot.recipesAll(item.id, null, null);
      if (craftingTable) {
        const allRecipes3x3 = bot.recipesAll(item.id, null, craftingTable);
        if (allRecipes3x3.length > allRecipes.length) {
          allRecipes = allRecipes3x3;
        }
      }

      // First, check if we need a crafting table before checking ingredients
      // Skip this check if we're trying to craft a crafting table itself
      if (!craftingTable && itemName !== "crafting_table" && allRecipes.length > 0) {
        // Check if any of the available recipes require a crafting table
        const needsTable = allRecipes.some(r => r.requiresTable);
        if (needsTable) {
          throw new Error(`${itemName} requires a crafting_table nearby. Place one first, then craft. Inventory: ${inventory}`);
        }
      }

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

            // Check if we have enough (including compatible items)
            const compatible = findCompatibleItem(ingredientName);
            const haveCount = compatible?.count || 0;

            // For display purposes, show what ingredient we actually need
            // If we have a compatible item, show that we can use it
            // Special case for cobblestone/cobbled_deepslate - show cobblestone as primary
            if (ingredientName === "cobbled_deepslate" && findCompatibleItem("cobblestone")) {
              needed.push(`cobblestone x${requiredCount} (or cobbled_deepslate)`);
            } else if (compatible && compatible.name !== ingredientName) {
              needed.push(`${ingredientName} x${requiredCount} (or ${compatible.name})`);
            } else {
              needed.push(`${ingredientName} x${requiredCount}`);
            }

            if (haveCount < requiredCount) {
              const availableText = compatible ? `${compatible.name}(${haveCount})` : "none";
              // Check if there are compatible alternatives we could use
              // Define compatibleMaterials here since it's not in scope
              const compatibleMaterials: Record<string, string[]> = {
                // Any planks can substitute for any other planks
                "oak_planks": ["spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
                "spruce_planks": ["oak_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
                "birch_planks": ["oak_planks", "spruce_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
                "jungle_planks": ["oak_planks", "spruce_planks", "birch_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
                "acacia_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
                "dark_oak_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
                "mangrove_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "cherry_planks", "pale_oak_planks"],
                "cherry_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "pale_oak_planks"],
                "pale_oak_planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks"],
                // Any logs can substitute for any other logs
                "oak_log": ["spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
                "spruce_log": ["oak_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
                "birch_log": ["oak_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
                "jungle_log": ["oak_log", "spruce_log", "birch_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
                "acacia_log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "dark_oak_log", "mangrove_log", "cherry_log"],
                "dark_oak_log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "mangrove_log", "cherry_log"],
                "mangrove_log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "cherry_log"],
                "cherry_log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log"],
                // Cobblestone and cobbled_deepslate are interchangeable for most recipes
                "cobblestone": ["cobbled_deepslate"],
                "cobbled_deepslate": ["cobblestone"],
                // Coal and charcoal are interchangeable for torch and other recipes
                "coal": ["charcoal"],
                "charcoal": ["coal"],
              };
              const compatibles = compatibleMaterials[ingredientName] || [];
              let foundAlternative = false;

              for (const alt of compatibles) {
                const altItem = inventoryItems.find(i => i.name === alt);
                if (altItem && altItem.count >= requiredCount) {
                  // We have enough of a compatible item
                  foundAlternative = true;
                  break;
                }
              }

              if (!foundAlternative) {
                // Special handling for cobblestone/cobbled_deepslate
                if (ingredientName === "cobbled_deepslate" && compatibles.includes("cobblestone")) {
                  // Check cobblestone availability
                  const cobblestoneItem = inventoryItems.filter(i => i.name === "cobblestone");
                  const cobblestoneCount = cobblestoneItem.reduce((sum, item) => sum + item.count, 0);
                  if (cobblestoneCount > 0) {
                    missing.push(`cobblestone (need ${requiredCount}, have ${cobblestoneCount})`);
                  } else {
                    missing.push(`cobblestone or cobbled_deepslate (need ${requiredCount}, have none)`);
                  }
                } else if (compatibles.length > 0) {
                  missing.push(`${ingredientName} (need ${requiredCount}, have ${availableText}, can also use: ${compatibles.slice(0, 3).join(", ")})`);
                } else {
                  missing.push(`${ingredientName} (need ${requiredCount}, have ${availableText})`);
                }
              }
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
          "wooden_pickaxe": "Craft order: log → planks (4) → stick (from 2 planks) → wooden_pickaxe",
          "wooden_axe": "Craft order: log → planks (4) → stick (from 2 planks) → wooden_axe",
          "wooden_sword": "Craft order: log → planks (4) → stick (from 2 planks) → wooden_sword",
          "wooden_shovel": "Craft order: log → planks (4) → stick (from 2 planks) → wooden_shovel",
          "stone_pickaxe": "Need: cobblestone x3 + stick x2. Mine stone with wooden_pickaxe first.",
          "crafting_table": "Craft order: log → planks (4) → crafting_table",
          "stick": "Craft from 2 planks (any wood type gives 4 sticks)",
          "oak_planks": "Craft from 1 oak_log (gives 4 planks)",
          "spruce_planks": "Craft from 1 spruce_log (gives 4 planks)",
          "birch_planks": "Craft from 1 birch_log (gives 4 planks)",
          "jungle_planks": "Craft from 1 jungle_log (gives 4 planks)",
          "acacia_planks": "Craft from 1 acacia_log (gives 4 planks)",
          "dark_oak_planks": "Craft from 1 dark_oak_log (gives 4 planks)",
        };

        if (craftingHints[itemName]) {
          errorMsg += ` Hint: ${craftingHints[itemName]}`;
        }

        errorMsg += ` Have: ${inventory}`;
        throw new Error(errorMsg);
      }

      // No recipes at all - might need crafting table
      let errorMsg = `No recipe found for ${itemName}.`;

      // Special handling for items that commonly require crafting table
      const requiresTableItems = ["stone_pickaxe", "stone_axe", "stone_shovel", "stone_sword", "stone_hoe",
                                   "iron_pickaxe", "iron_axe", "iron_shovel", "iron_sword", "iron_hoe",
                                   "golden_pickaxe", "golden_axe", "golden_shovel", "golden_sword", "golden_hoe",
                                   "diamond_pickaxe", "diamond_axe", "diamond_shovel", "diamond_sword", "diamond_hoe",
                                   "netherite_pickaxe", "netherite_axe", "netherite_shovel", "netherite_sword", "netherite_hoe"];

      if (!craftingTable && requiresTableItems.includes(itemName)) {
        errorMsg = `${itemName} requires a crafting_table. Place one nearby first.`;
      } else if (!craftingTable) {
        errorMsg += ` Try placing a crafting_table nearby for advanced recipes.`;
      }
      errorMsg += ` Inventory: ${inventory}`;
      throw new Error(errorMsg);
    }

    // Use the first craftable recipe
    const recipe = craftableRecipes[0];

    if (recipe.requiresTable && !craftingTable) {
      throw new Error(`${itemName} requires a crafting table nearby (within 4 blocks). Inventory: ${inventory}`);
    }

    try {
      // Before crafting, ensure we have the exact items needed
      // Sometimes the bot needs specific item types even if we have compatible ones
      // This is a workaround for mineflayer's strict recipe matching
      for (let i = 0; i < count; i++) {
        // Try each craftable recipe in order until one succeeds
        let crafted = false;
        let lastError = null;

        for (const tryRecipe of craftableRecipes) {
          try {
            await bot.craft(tryRecipe, 1, craftingTable || undefined);
            crafted = true;
            break;
          } catch (craftErr) {
            lastError = craftErr;
            // Continue trying other recipes
          }
        }

        if (!crafted) {
          throw lastError;
        }
      }
      // Check new inventory
      const newInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
      return `Crafted ${count}x ${itemName}. Inventory: ${newInventory}` + this.getBriefStatus(username);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      // If error is about missing ingredients, add more context
      if (errMsg.includes("missing ingredient")) {
        // Get current inventory for accurate reporting
        const currentInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";

        // Extract recipe ingredients
        const delta = recipe.delta as Array<{ id: number; count: number }>;
        const needed: string[] = [];

        for (const d of delta) {
          if (d.count < 0) {
            const ingredientItem = mcData.items[d.id];
            const ingredientName = ingredientItem?.name || `id:${d.id}`;
            const requiredCount = Math.abs(d.count);
            needed.push(`${ingredientName}(need ${requiredCount})`);
          }
        }

        const tableInfo = craftingTable ? `table@(${craftingTable.position.x},${craftingTable.position.y},${craftingTable.position.z})` : "no_table";
        throw new Error(`Failed to craft ${itemName}: ${errMsg}. Recipe needs: ${needed.join(", ")}. ${tableInfo}. Inventory: ${currentInventory}`);
      }

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
    let furnaceBlock = bot.findBlock({
      matching: mcData.blocksByName.furnace?.id,
      maxDistance: 4,
    });

    // If not nearby, search wider and move to it
    if (!furnaceBlock) {
      const farFurnace = bot.findBlock({
        matching: mcData.blocksByName.furnace?.id,
        maxDistance: 32,
      });

      if (farFurnace) {
        console.error(`[Smelt] Found furnace at ${farFurnace.position}, moving...`);
        const goal = new goals.GoalNear(farFurnace.position.x, farFurnace.position.y, farFurnace.position.z, 3);
        bot.pathfinder.setGoal(goal);

        // Wait for movement
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            bot.pathfinder.setGoal(null);
            resolve();
          }, 10000);

          const check = setInterval(() => {
            const dist = bot.entity.position.distanceTo(farFurnace.position);
            if (dist < 4 || !bot.pathfinder.isMoving()) {
              clearInterval(check);
              clearTimeout(timeout);
              bot.pathfinder.setGoal(null);
              resolve();
            }
          }, 300);
        });

        // Re-check nearby
        furnaceBlock = bot.findBlock({
          matching: mcData.blocksByName.furnace?.id,
          maxDistance: 4,
        });
      }
    }

    if (!furnaceBlock) {
      throw new Error("No furnace found within 32 blocks. Craft one with 8 cobblestone.");
    }

    // Find the item to smelt in inventory
    const itemToSmelt = bot.inventory.items().find(i => i.name === itemName);
    if (!itemToSmelt) {
      const inventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";
      throw new Error(`No ${itemName} in inventory. Have: ${inventory}`);
    }

    // Find fuel (coal, charcoal, wood, etc.) using dynamic helper
    const fuel = bot.inventory.items().find(i => isFuelItem(i.name));
    if (!fuel) {
      throw new Error("No fuel in inventory. Need coal, charcoal, or wood.");
    }

    try {
      const furnace = await bot.openFurnace(furnaceBlock);

      // Check if output slot is full and take items if needed
      const existingOutput = furnace.outputItem();
      if (existingOutput) {
        await furnace.takeOutput();
      }

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

    // Find a bed nearby (dynamically get all bed block IDs from registry)
    const bedBlockIds = Object.values(mcData.blocksByName)
      .filter(b => isBedBlock(b.name))
      .map(b => b.id);

    const bedBlock = bot.findBlock({
      matching: bedBlockIds,
      maxDistance: 4,
    });

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

  /**
   * Get detailed equipment info for each slot
   */
  getEquipment(username: string): string {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const slots = bot.inventory.slots;

    // Mineflayer inventory slots for equipment:
    // 5: helmet, 6: chestplate, 7: leggings, 8: boots
    // 45: off-hand
    const equipment = {
      head: slots[5]?.name || "(empty)",
      chest: slots[6]?.name || "(empty)",
      legs: slots[7]?.name || "(empty)",
      feet: slots[8]?.name || "(empty)",
      mainHand: bot.heldItem?.name || "(empty)",
      offHand: slots[45]?.name || "(empty)",
    };

    const lines = [
      `## Equipment`,
      `- Head: ${equipment.head}`,
      `- Chest: ${equipment.chest}`,
      `- Legs: ${equipment.legs}`,
      `- Feet: ${equipment.feet}`,
      `- Main Hand: ${equipment.mainHand}`,
      `- Off Hand: ${equipment.offHand}`,
    ];

    return lines.join("\n");
  }

  getNearbyEntities(username: string, range: number = 16, type: string = "all"): string {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;

    const entities = Object.values(bot.entities)
      .filter(entity => {
        if (!entity || entity === bot.entity) return false;
        const dist = entity.position.distanceTo(bot.entity.position);
        if (dist > range) return false;

        const name = entity.name?.toLowerCase() || "";

        switch (type) {
          case "hostile":
            return isHostileMob(bot, name);
          case "passive":
            return isPassiveMob(bot, name);
          case "player":
            return entity.type === "player";
          default:
            return true;
        }
      })
      .map(entity => ({
        name: entity.name,
        type: isHostileMob(bot, entity.name?.toLowerCase() || "") ? "hostile" :
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

    // Find target
    let target = null;
    const entities = Object.values(bot.entities);

    if (entityName) {
      target = entities.find(e =>
        e.name?.toLowerCase() === entityName.toLowerCase() &&
        e.position.distanceTo(bot.entity.position) < 6
      );
    } else {
      // Find nearest hostile (using dynamic registry check)
      target = entities
        .filter(e => isHostileMob(bot, e.name?.toLowerCase() || ""))
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

    let distance = target.position.distanceTo(bot.entity.position);

    // Move closer if needed
    if (distance > 3) {
      console.error(`[Attack] Target ${target.name} is ${distance.toFixed(1)} blocks away, moving closer...`);
      const goal = new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2);
      bot.pathfinder.setGoal(goal);

      // Wait for movement with proper tracking
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          bot.pathfinder.setGoal(null);
          resolve();
        }, 5000);

        const check = setInterval(() => {
          // Re-check target position (it may have moved)
          const currentDist = target.position.distanceTo(bot.entity.position);
          if (currentDist < 3.5 || !bot.pathfinder.isMoving()) {
            clearInterval(check);
            clearTimeout(timeout);
            bot.pathfinder.setGoal(null);
            resolve();
          }
        }, 200);
      });

      distance = target.position.distanceTo(bot.entity.position);
    }

    // Attack
    try {
      await bot.lookAt(target.position.offset(0, target.height * 0.8, 0));
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

    // Step 2: Find target (using dynamic hostile check)
    const findTarget = () => {
      const entities = Object.values(bot.entities);
      if (entityName) {
        return entities.find(e => {
          if (!e || e === bot.entity) return false;
          const dist = e.position.distanceTo(bot.entity.position);
          if (dist > 20) return false;

          // Check various name properties
          const eName = e.name?.toLowerCase();
          const eDisplayName = e.displayName?.toLowerCase();
          const eType = e.type?.toLowerCase();
          const targetName = entityName.toLowerCase();

          return eName === targetName ||
                 eDisplayName === targetName ||
                 eType === targetName;
        }) || null;
      }
      return entities
        .filter(e => isHostileMob(bot, e.name?.toLowerCase() || ""))
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

    // Find food in inventory using dynamic detection
    let foodItem = null;
    if (foodName) {
      foodItem = bot.inventory.items().find(item =>
        item.name.toLowerCase() === foodName.toLowerCase()
      );
    } else {
      // Find all food items, prioritize by saturation (cooked > raw > other)
      const allFoods = bot.inventory.items().filter(item => isFoodItem(bot, item.name));

      // Sort by priority: cooked meats first, then bread/apples, then raw
      allFoods.sort((a, b) => {
        const getPriority = (name: string) => {
          if (name.startsWith("cooked_")) return 0;
          if (name === "golden_apple" || name === "enchanted_golden_apple") return 1;
          if (name === "bread" || name === "baked_potato") return 2;
          if (["apple", "carrot", "melon_slice"].includes(name)) return 3;
          return 4; // raw or other foods
        };
        return getPriority(a.name) - getPriority(b.name);
      });

      foodItem = allFoods[0] || null;
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

  /**
   * Fish using a fishing rod
   */
  async fish(username: string, duration: number = 30): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;

    // Check for fishing rod
    const fishingRod = bot.inventory.items().find(item => item.name === "fishing_rod");
    if (!fishingRod) {
      throw new Error("No fishing rod in inventory. Craft one with 3 sticks + 2 string.");
    }

    // Equip fishing rod
    await bot.equip(fishingRod, "hand");

    // Check if near water
    const waterBlock = bot.findBlock({
      matching: (block) => block.name === "water",
      maxDistance: 5,
    });

    if (!waterBlock) {
      throw new Error("No water nearby. Move closer to water to fish.");
    }

    // Look at water
    await bot.lookAt(waterBlock.position.offset(0.5, 0.5, 0.5));

    let caughtItems: string[] = [];
    const startTime = Date.now();
    const maxDuration = duration * 1000;

    console.error(`[Fish] Starting to fish for ${duration} seconds...`);

    // Fishing loop
    while (Date.now() - startTime < maxDuration) {
      try {
        await bot.fish();
        // Check what was caught (last item in inventory that wasn't there before)
        const inv = bot.inventory.items();
        if (inv.length > 0) {
          const lastItem = inv[inv.length - 1];
          caughtItems.push(lastItem.name);
          console.error(`[Fish] Caught: ${lastItem.name}`);
        }
      } catch (err) {
        // Fish was interrupted or failed, try again
        console.error(`[Fish] Attempt failed: ${err}`);
        await this.delay(1000);
      }
    }

    if (caughtItems.length === 0) {
      return `Fished for ${duration}s but caught nothing.` + this.getBriefStatus(username);
    }

    // Summarize catches
    const summary: Record<string, number> = {};
    for (const item of caughtItems) {
      summary[item] = (summary[item] || 0) + 1;
    }
    const catchList = Object.entries(summary).map(([k, v]) => `${k}(${v})`).join(", ");

    return `Fished for ${duration}s. Caught: ${catchList}` + this.getBriefStatus(username);
  }

  /**
   * Trade with a villager
   */
  async tradeWithVillager(username: string, tradeIndex?: number): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;

    // Find nearby villager
    const villager = Object.values(bot.entities)
      .filter(e => e.name === "villager" || e.name === "wandering_trader")
      .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];

    if (!villager) {
      throw new Error("No villager or wandering trader nearby.");
    }

    const distance = villager.position.distanceTo(bot.entity.position);

    // Move closer if needed
    if (distance > 3) {
      console.error(`[Trade] Moving to villager at ${villager.position.x.toFixed(1)}, ${villager.position.y.toFixed(1)}, ${villager.position.z.toFixed(1)}...`);
      const goal = new goals.GoalNear(villager.position.x, villager.position.y, villager.position.z, 2);
      bot.pathfinder.setGoal(goal);

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          bot.pathfinder.setGoal(null);
          resolve();
        }, 5000);

        const check = setInterval(() => {
          if (villager.position.distanceTo(bot.entity.position) < 3 || !bot.pathfinder.isMoving()) {
            clearInterval(check);
            clearTimeout(timeout);
            bot.pathfinder.setGoal(null);
            resolve();
          }
        }, 200);
      });
    }

    // Open trade window
    try {
      const villagerEntity = villager as any;
      await bot.activateEntity(villagerEntity);

      // Wait for trade window to open
      const tradeWindow = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout waiting for trade window"));
        }, 3000);

        bot.once("windowOpen", (window: any) => {
          clearTimeout(timeout);
          resolve(window);
        });
      });

      // Get trades from the window
      const trades = tradeWindow.trades || [];
      console.error(`[Trade] Window opened with ${trades.length} trades`);

      if (trades.length === 0) {
        bot.closeWindow(tradeWindow);
        return `Villager has no trades available. Type: ${villager.name}`;
      }

      // If no trade index specified, just list trades
      if (tradeIndex === undefined) {
        const tradeList = trades.map((t: any, i: number) => {
          const input1 = t.inputItem1 ? `${t.inputItem1.count}x ${t.inputItem1.name}` : "";
          const input2 = t.inputItem2 ? ` + ${t.inputItem2.count}x ${t.inputItem2.name}` : "";
          const output = t.outputItem ? `${t.outputItem.count}x ${t.outputItem.name}` : "";
          const disabled = t.tradeDisabled ? " [DISABLED]" : "";
          return `[${i}] ${input1}${input2} → ${output}${disabled}`;
        }).join("\n");

        bot.closeWindow(tradeWindow);
        return `Villager trades:\n${tradeList}\n\nUse tradeIndex parameter to execute a trade.`;
      }

      // Execute specific trade
      if (tradeIndex < 0 || tradeIndex >= trades.length) {
        bot.closeWindow(tradeWindow);
        throw new Error(`Invalid trade index ${tradeIndex}. Available: 0-${trades.length - 1}`);
      }

      const trade = trades[tradeIndex];
      if (trade.tradeDisabled) {
        bot.closeWindow(tradeWindow);
        return `Trade [${tradeIndex}] is currently disabled (villager needs to restock).`;
      }

      // Check if we have required items
      const input1 = trade.inputItem1;
      const input2 = trade.inputItem2;

      if (input1) {
        const have = bot.inventory.count(input1.type, input1.metadata);
        if (have < input1.count) {
          bot.closeWindow(tradeWindow);
          return `Not enough ${input1.name}. Need ${input1.count}, have ${have}.`;
        }
      }

      if (input2) {
        const have = bot.inventory.count(input2.type, input2.metadata);
        if (have < input2.count) {
          bot.closeWindow(tradeWindow);
          return `Not enough ${input2.name}. Need ${input2.count}, have ${have}.`;
        }
      }

      // Execute the trade using mineflayer's trade method
      await (bot as any).trade(villagerEntity, tradeIndex);
      await this.delay(300);

      const output = trade.outputItem;
      const outputDesc = output ? `${output.count}x ${output.name}` : "item";

      bot.closeWindow(tradeWindow);
      return `Trade successful! Received ${outputDesc}.`;

    } catch (err: any) {
      // Close window if open
      if (bot.currentWindow) {
        bot.closeWindow(bot.currentWindow);
      }
      return `Failed to trade: ${err.message || err}`;
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

  /**
   * Pillar up by jumping and placing blocks underfoot
   */
  async pillarUp(username: string, height: number = 1): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const startY = bot.entity.position.y;
    const startX = Math.floor(bot.entity.position.x);
    const startZ = Math.floor(bot.entity.position.z);

    // Check if we have scaffolding blocks - dynamically check if block is solid
    // Exclude ores, valuable blocks, and special blocks
    const excludePatterns = ["_ore", "spawner", "bedrock", "obsidian", "portal",
      "diamond_block", "emerald_block", "gold_block", "iron_block", "netherite_block",
      "ancient_debris", "crying_obsidian", "reinforced_deepslate"];

    const isScaffoldBlock = (itemName: string): boolean => {
      // Check if block exists in registry
      const blockInfo = bot.registry.blocksByName[itemName];
      if (!blockInfo) return false;
      // Must be solid block (boundingBox === 'block')
      if (blockInfo.boundingBox !== "block") return false;
      // Exclude valuable/special blocks
      if (excludePatterns.some(p => itemName.includes(p))) return false;
      return true;
    };

    const countScaffold = () => bot.inventory.items()
      .filter(i => isScaffoldBlock(i.name))
      .reduce((sum, i) => sum + i.count, 0);

    if (countScaffold() === 0) {
      const inv = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";
      throw new Error(`Cannot pillar up - no blocks! Need: cobblestone, dirt, stone. Have: ${inv}`);
    }

    const targetHeight = Math.min(height, 15); // Safety limit
    console.error(`[Pillar] Starting: ${targetHeight} blocks from Y=${startY.toFixed(1)}, scaffold count: ${countScaffold()}`);

    // Stop all movement and digging first
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    try {
      bot.stopDigging();
    } catch {
      // Ignore if not digging
    }
    await new Promise(r => setTimeout(r, 500)); // Longer wait to ensure previous operations complete

    let blocksPlaced = 0;

    for (let i = 0; i < targetHeight; i++) {
      const currentY = Math.floor(bot.entity.position.y);

      // 1. Dig blocks above if needed (Y+2 and Y+3 for jump clearance)
      for (const yOffset of [2, 3]) {
        const blockAbove = bot.blockAt(new Vec3(startX, currentY + yOffset, startZ));
        if (blockAbove && blockAbove.name !== "air" && blockAbove.name !== "water" && blockAbove.name !== "cave_air") {
          console.error(`[Pillar] Digging ${blockAbove.name} above at Y=${currentY + yOffset}`);
          try {
            const pickaxe = bot.inventory.items().find(i => i.name.includes("pickaxe"));
            if (pickaxe) await bot.equip(pickaxe, "hand");
            bot.clearControlStates();
            await new Promise(r => setTimeout(r, 100));
            await bot.dig(blockAbove);
          } catch (e) {
            console.error(`[Pillar] Dig failed at Y+${yOffset}: ${e}`);
            // Continue anyway - might be able to proceed
          }
        }
      }

      // 2. Equip scaffold block
      const scaffold = bot.inventory.items().find(i => isScaffoldBlock(i.name));
      if (!scaffold) {
        console.error(`[Pillar] Out of blocks after ${blocksPlaced} placed`);
        break;
      }
      await bot.equip(scaffold, "hand");

      // 3. Get block below feet to place against
      const blockBelow = bot.blockAt(new Vec3(startX, currentY - 1, startZ));
      if (!blockBelow || blockBelow.name === "air") {
        console.error(`[Pillar] No block below to place against`);
        break;
      }

      // 4. Jump and place
      bot.setControlState("jump", true);
      await new Promise(r => setTimeout(r, 180)); // Wait for jump peak

      try {
        // Place on top of block below (this puts block at feet level, lifting us up)
        await bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
        blocksPlaced++;
        console.error(`[Pillar] Placed ${blocksPlaced}/${targetHeight} at Y=${currentY}`);
      } catch (e) {
        console.error(`[Pillar] Place failed: ${e}`);
      }

      bot.setControlState("jump", false);
      await new Promise(r => setTimeout(r, 300)); // Wait to land on new block
    }

    const finalY = bot.entity.position.y;
    const gained = finalY - startY;

    if (gained < 0.5 && blocksPlaced === 0) {
      throw new Error(`Failed to pillar up. No blocks placed. Try moving to open area first.`);
    }

    return `Pillared up ${gained.toFixed(1)} blocks (Y:${startY.toFixed(0)}→${finalY.toFixed(0)}, placed ${blocksPlaced})` + this.getBriefStatus(username);
  }

  async flee(username: string, distance: number = 20): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;

    // Find nearest hostile (using dynamic registry check)
    const hostile = Object.values(bot.entities)
      .filter(e => isHostileMob(bot, e.name?.toLowerCase() || ""))
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
    const startPos = bot.entity.position.clone();

    console.error(`[Flee] Fleeing from ${hostile.name} at (${hostile.position.x.toFixed(1)}, ${hostile.position.y.toFixed(1)}, ${hostile.position.z.toFixed(1)}) to (${fleeTarget.x.toFixed(1)}, ${fleeTarget.y.toFixed(1)}, ${fleeTarget.z.toFixed(1)})`);

    const goal = new goals.GoalNear(fleeTarget.x, fleeTarget.y, fleeTarget.z, 3);
    bot.pathfinder.setGoal(goal);

    // Wait for movement with proper completion check
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        bot.pathfinder.setGoal(null);
        resolve();
      }, 8000);

      const check = setInterval(() => {
        const distMoved = bot.entity.position.distanceTo(startPos);
        const distFromHostile = bot.entity.position.distanceTo(hostile.position);

        // Success: moved enough distance or reached target
        if (distMoved >= distance * 0.7 || distFromHostile >= distance || !bot.pathfinder.isMoving()) {
          clearInterval(check);
          clearTimeout(timeout);
          bot.pathfinder.setGoal(null);
          resolve();
        }
      }, 200);
    });

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

    // Sheep spawn biomes hint - use pattern matching for grass/forest biomes
    // Sheep spawn in grassy biomes with moderate temperature
    const isSheepBiome = (name: string): boolean => {
      const grassyPatterns = ["plains", "meadow", "forest", "taiga", "savanna", "grove"];
      const excludePatterns = ["desert", "badlands", "ocean", "swamp", "jungle", "dark_forest"];
      if (excludePatterns.some(p => name.includes(p))) return false;
      return grassyPatterns.some(p => name.includes(p));
    };

    if (isSheepBiome(biomeName)) {
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
    const stepSize = 10;  // Smaller step size for more reliable movement
    let traveled = 0;
    let foundBiome: string | null = null;
    let foundAt: Vec3 | null = null;

    while (traveled < maxBlocks) {
      const targetDistance = Math.min(traveled + stepSize, maxBlocks);
      const targetX = startPos.x + dx * targetDistance;
      const targetZ = startPos.z + dz * targetDistance;

      // Move to target
      const goal = new goals.GoalNear(targetX, bot.entity.position.y, targetZ, 3);
      bot.pathfinder.setGoal(goal);

      // Wait for movement (with timeout)
      const moveStart = Date.now();
      let reachedGoal = false;
      while (Date.now() - moveStart < 10000) {  // Reduced timeout
        await this.delay(500);
        const currentPos = bot.entity.position;
        const distToGoal = Math.sqrt(
          Math.pow(currentPos.x - targetX, 2) + Math.pow(currentPos.z - targetZ, 2)
        );
        if (distToGoal < 5) {
          reachedGoal = true;
          break;
        }
      }
      bot.pathfinder.setGoal(null);

      // Update traveled to actual distance moved
      const currentPos = bot.entity.position;
      traveled = Math.floor(Math.sqrt(
        Math.pow(currentPos.x - startPos.x, 2) + Math.pow(currentPos.z - startPos.z, 2)
      ));

      // If we couldn't reach the goal, break to avoid infinite loop
      if (!reachedGoal) {
        const actualMoved = Math.sqrt(
          Math.pow(currentPos.x - startPos.x, 2) + Math.pow(currentPos.z - startPos.z, 2)
        );
        if (actualMoved < 2) {
          // Barely moved, likely stuck
          break;
        }
      }

      // Check current biome
      const block = bot.blockAt(bot.entity.position);
      const currentBiome = getBiomeName(block?.biome);

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

    const actualDistance = Math.floor(Math.sqrt(
      Math.pow(finalPos.x - startPos.x, 2) + Math.pow(finalPos.z - startPos.z, 2)
    ));

    // If we barely moved, suggest the bot might be stuck
    if (actualDistance < 5) {
      return `Could only move ${actualDistance} blocks ${direction}. Bot might be stuck or path is blocked. Current biome: ${finalBiome}. Try another direction or clear the path.`;
    }

    return `Explored ${actualDistance} blocks ${direction} (max: ${maxBlocks}). Current biome: ${finalBiome}. Target biome '${targetBiome}' not found. Try another direction.`;
  }

  /**
   * Dig a 1x2 tunnel in a direction
   * Auto-equips pickaxe, collects items, reports ores found
   */
  async digTunnel(
    username: string,
    direction: "north" | "south" | "east" | "west" | "down",
    length: number = 10
  ): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const startPos = bot.entity.position.clone();
    const inventoryBefore = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);

    // Direction vectors (no "up" - use pillar_up for that)
    const dirVectors: Record<string, { dx: number; dy: number; dz: number }> = {
      north: { dx: 0, dy: 0, dz: -1 },
      south: { dx: 0, dy: 0, dz: 1 },
      east: { dx: 1, dy: 0, dz: 0 },
      west: { dx: -1, dy: 0, dz: 0 },
      down: { dx: 0, dy: -1, dz: 0 },
    };

    const dir = dirVectors[direction];
    if (!dir) {
      throw new Error(`Invalid direction: ${direction}. Use north/south/east/west/down (for up, use pillar_up)`);
    }

    // Stop all movement and digging first to prevent conflicts
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    try {
      bot.stopDigging();
    } catch {
      // Ignore if not digging
    }
    await new Promise(r => setTimeout(r, 150));

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
      // For down tunnels (stairs), dig 1 block
      const blocksToDig: Array<{ x: number; y: number; z: number }> = [];

      if (direction === "down") {
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
      if (direction === "down") {
        // For down, just wait for gravity
        await this.delay(300);
      } else {
        // Horizontal: use pathfinder to move into the tunnel
        const goal = new goals.GoalBlock(nextX, nextY, nextZ);
        bot.pathfinder.setGoal(goal);
        await this.delay(300);
        bot.pathfinder.setGoal(null);
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
   * Use when: HP <= 2 AND no food AND no way out
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

    // Guard: Don't respawn if HP is still okay
    if (oldHP > 4) {
      const inventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
      return `Refused to respawn: HP is ${oldHP}/20 (still survivable). Try eating, fleeing, or pillar_up first. Inventory: ${inventory}`;
    }

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

  /**
   * Open a chest and list its contents
   */
  async openChest(username: string, x: number, y: number, z: number): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const chestPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    const chestBlock = bot.blockAt(chestPos);

    if (!chestBlock || !chestBlock.name.includes("chest")) {
      throw new Error(`No chest at (${x}, ${y}, ${z}). Found: ${chestBlock?.name || "nothing"}`);
    }

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
  async storeInChest(username: string, itemName: string, count?: number): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;

    // Find nearby chest
    const chestBlock = bot.findBlock({
      matching: (block) => block.name.includes("chest"),
      maxDistance: 4,
    });

    if (!chestBlock) {
      throw new Error("No chest within 4 blocks. Place a chest first.");
    }

    // Find item in inventory
    const item = bot.inventory.items().find(i => i.name === itemName);
    if (!item) {
      const inventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
      throw new Error(`No ${itemName} in inventory. Have: ${inventory}`);
    }

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
  async takeFromChest(username: string, itemName: string, count?: number): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;

    // Find nearby chest
    const chestBlock = bot.findBlock({
      matching: (block) => block.name.includes("chest"),
      maxDistance: 4,
    });

    if (!chestBlock) {
      throw new Error("No chest within 4 blocks.");
    }

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
  async listChest(username: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

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

  /**
   * Wake up from bed
   */
  async wake(username: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;

    if (!bot.isSleeping) {
      return "Not sleeping - already awake!";
    }

    try {
      await bot.wake();
      return "Woke up from bed.";
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to wake up: ${errMsg}`);
    }
  }

  /**
   * Start elytra flying (must already be falling/gliding)
   */
  async elytraFly(username: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;

    // Check if wearing elytra
    const chestSlot = bot.inventory.slots[6]; // chest armor slot
    if (!chestSlot || chestSlot.name !== "elytra") {
      throw new Error("No elytra equipped! Equip elytra to chest slot first.");
    }

    try {
      await bot.elytraFly();
      return "Started elytra flying. Use firework rockets to boost!";
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Elytra flight failed: ${errMsg}`);
    }
  }

  /**
   * Mount an entity (horse, pig, boat, minecart, etc.)
   */
  async mount(username: string, entityName?: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;

    // Check if entity is mountable using pattern matching
    // Includes: horses, donkeys, mules, pigs (with saddle), striders, boats, minecarts, camels, llamas
    const isMountable = (name: string): boolean => {
      const patterns = ["horse", "donkey", "mule", "pig", "strider", "boat", "minecart", "camel", "llama"];
      return patterns.some(p => name.includes(p));
    };

    const searchName = entityName?.toLowerCase();

    const entity = Object.values(bot.entities)
      .filter(e => {
        if (!e || e === bot.entity) return false;
        const name = (e.name || "").toLowerCase();
        const dist = bot.entity.position.distanceTo(e.position);
        if (dist > 5) return false;

        if (searchName) {
          return name.includes(searchName);
        }
        return isMountable(name);
      })
      .sort((a, b) =>
        bot.entity.position.distanceTo(a.position) -
        bot.entity.position.distanceTo(b.position)
      )[0];

    if (!entity) {
      const hint = entityName ? entityName : "horse, donkey, pig, boat, minecart, camel, llama";
      throw new Error(`No mountable entity (${hint}) found within 5 blocks.`);
    }

    try {
      await bot.mount(entity);
      return `Mounted ${entity.name || "entity"}.`;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to mount ${entity.name}: ${errMsg}`);
    }
  }

  /**
   * Dismount from current vehicle
   */
  async dismount(username: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const vehicle = (bot as any).vehicle;

    if (!vehicle) {
      return "Not mounted on anything.";
    }

    const vehicleName = vehicle.name || "vehicle";

    try {
      await bot.dismount();
      return `Dismounted from ${vehicleName}.`;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to dismount: ${errMsg}`);
    }
  }

  /**
   * Activate a block (button, lever, door, trapdoor, gate, etc.)
   */
  async activateBlock(username: string, x: number, y: number, z: number): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const pos = new Vec3(x, y, z);
    const block = bot.blockAt(pos);

    if (!block) {
      throw new Error(`No block at (${x}, ${y}, ${z})`);
    }

    const interactableBlocks = [
      "button", "lever", "door", "trapdoor", "gate",
      "chest", "barrel", "shulker", "hopper", "dropper", "dispenser",
      "note_block", "jukebox", "bell", "respawn_anchor",
      "crafting_table", "furnace", "blast_furnace", "smoker",
      "brewing_stand", "anvil", "grindstone", "stonecutter",
      "loom", "cartography_table", "smithing_table"
    ];

    const isInteractable = interactableBlocks.some(name => block.name.includes(name));
    if (!isInteractable) {
      console.error(`[ActivateBlock] Warning: ${block.name} may not be interactable`);
    }

    const dist = bot.entity.position.distanceTo(pos);
    if (dist > 5) {
      // Move closer first
      await this.moveTo(username, x, y, z);
    }

    try {
      await bot.activateBlock(block);
      return `Activated ${block.name} at (${x}, ${y}, ${z}).`;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to activate ${block.name}: ${errMsg}`);
    }
  }

  /**
   * Open enchantment table and enchant an item
   */
  async enchant(username: string, itemName: string, enchantmentLevel: number = 1): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;

    // Find nearby enchantment table
    const tableBlock = bot.findBlock({
      matching: (block) => block.name === "enchanting_table",
      maxDistance: 32,
    });

    if (!tableBlock) {
      throw new Error("No enchanting table found within 32 blocks.");
    }

    // Move closer if needed
    const dist = bot.entity.position.distanceTo(tableBlock.position);
    if (dist > 4) {
      await this.moveTo(username, tableBlock.position.x, tableBlock.position.y, tableBlock.position.z);
    }

    // Check for lapis lazuli
    const lapis = bot.inventory.items().find(i => i.name === "lapis_lazuli");
    if (!lapis) {
      throw new Error("No lapis lazuli in inventory - required for enchanting.");
    }

    // Find item to enchant
    const item = bot.inventory.items().find(i => i.name === itemName);
    if (!item) {
      const inventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";
      throw new Error(`No ${itemName} in inventory. Have: ${inventory}`);
    }

    try {
      const enchantTable = await bot.openEnchantmentTable(tableBlock);

      // Put item and lapis
      await enchantTable.putTargetItem(item);
      await enchantTable.putLapis(lapis);

      // Wait for enchantments to load
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get available enchantments
      const enchantments = enchantTable.enchantments;

      // Select enchantment level (0, 1, or 2 for levels 1-3)
      const slotIndex = Math.max(0, Math.min(2, enchantmentLevel - 1));

      if (!enchantments[slotIndex]) {
        enchantTable.close();
        return `No enchantment available at level ${enchantmentLevel}. Available: ${JSON.stringify(enchantments)}`;
      }

      await enchantTable.enchant(slotIndex);
      await enchantTable.takeTargetItem();
      enchantTable.close();

      return `Enchanted ${itemName} at level ${enchantmentLevel}.`;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to enchant ${itemName}: ${errMsg}`);
    }
  }

  /**
   * Use anvil to repair, combine, or rename items
   */
  async useAnvil(username: string, targetItem: string, materialItem?: string, newName?: string): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;

    // Find nearby anvil
    const anvilBlock = bot.findBlock({
      matching: (block) => block.name.includes("anvil"),
      maxDistance: 32,
    });

    if (!anvilBlock) {
      throw new Error("No anvil found within 32 blocks.");
    }

    // Move closer if needed
    const dist = bot.entity.position.distanceTo(anvilBlock.position);
    if (dist > 4) {
      await this.moveTo(username, anvilBlock.position.x, anvilBlock.position.y, anvilBlock.position.z);
    }

    // Find items
    const target = bot.inventory.items().find(i => i.name === targetItem);
    if (!target) {
      throw new Error(`No ${targetItem} in inventory.`);
    }

    const material = materialItem ? bot.inventory.items().find(i => i.name === materialItem) : null;
    if (materialItem && !material) {
      throw new Error(`No ${materialItem} in inventory for repair/combine.`);
    }

    try {
      const anvil = await bot.openAnvil(anvilBlock);

      let result: string;
      if (material) {
        // Combine two items (repair or enchant combine)
        await anvil.combine(target, material, newName);
        result = `Combined ${targetItem} with ${materialItem}`;
        if (newName) result += `, renamed to "${newName}"`;
      } else if (newName) {
        // Just rename
        await anvil.rename(target, newName);
        result = `Renamed ${targetItem} to "${newName}"`;
      } else {
        throw new Error("Must provide either materialItem for combining or newName for renaming.");
      }

      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Anvil operation failed: ${errMsg}`);
    }
  }

  /**
   * Update text on a sign
   */
  async updateSign(username: string, x: number, y: number, z: number, text: string, back: boolean = false): Promise<string> {
    const managed = this.bots.get(username);
    if (!managed) {
      throw new Error(`Bot '${username}' not found`);
    }

    const bot = managed.bot;
    const pos = new Vec3(x, y, z);
    const block = bot.blockAt(pos);

    if (!block) {
      throw new Error(`No block at (${x}, ${y}, ${z})`);
    }

    if (!block.name.includes("sign")) {
      throw new Error(`Block at (${x}, ${y}, ${z}) is ${block.name}, not a sign.`);
    }

    const dist = bot.entity.position.distanceTo(pos);
    if (dist > 4) {
      await this.moveTo(username, x, y, z);
    }

    try {
      bot.updateSign(block, text, back);
      return `Updated sign at (${x}, ${y}, ${z}) with text: "${text}"${back ? " (back)" : ""}`;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to update sign: ${errMsg}`);
    }
  }
}

// Singleton instance for compatibility
export const botManager = new BotManager();
