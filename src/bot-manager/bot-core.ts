import mineflayer from "mineflayer";
import { Vec3 } from "vec3";
import { EventEmitter } from "events";
import pkg from "mineflayer-pathfinder";
const { pathfinder, Movements } = pkg;
import prismarineViewer from "prismarine-viewer";
const { mineflayer: mineflayerViewer } = prismarineViewer;
import type { BotConfig, ManagedBot, GameEvent } from "./types.js";
import { isHostileMob, isPassiveMob } from "./minecraft-utils.js";

// Mamba向けの簡潔ステータスを付加するか（デフォルトはfalse=Claude向け）
const APPEND_BRIEF_STATUS = process.env.APPEND_BRIEF_STATUS === "true";

/**
 * Core bot management class - handles connection, disconnection, and lifecycle
 */
export class BotCore extends EventEmitter {
  protected bots: Map<string, ManagedBot> = new Map();
  private viewerPorts: Map<string, number> = new Map(); // username -> viewer port
  private nextViewerPort = 3007;
  private connectionConfigs: Map<string, BotConfig> = new Map(); // Store connection params for auto-reconnect
  private connectingPromises: Map<string, Promise<string>> = new Map(); // Track ongoing connections

  constructor() {
    super();
  }

  /**
   * Start prismarine-viewer for a bot
   */
  startViewer(username: string): number | null {
    // Disable viewer in stdio MCP mode to prevent process crashes
    // Set ENABLE_VIEWER=true to enable viewer
    if (process.env.ENABLE_VIEWER !== 'true') {
      console.error(`[BotManager] Viewer disabled (set ENABLE_VIEWER=true to enable)`);
      return null;
    }

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
      const viewer = mineflayerViewer(managed.bot, { port: viewerPort, firstPerson: true, viewDistance: 6 });

      // Handle viewer server errors to prevent process crash
      if (viewer && viewer.on) {
        viewer.on('error', (err: Error) => {
          console.error(`[BotManager] Viewer error on port ${viewerPort}:`, err.message);
          // Don't crash - just log and continue
        });
      }

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

  getBot(username: string): import("mineflayer").Bot | null {
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

  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get brief status after an action (HP, hunger, position, surroundings, dangers)
   * Only returns status if APPEND_BRIEF_STATUS=true (for Mamba agent)
   */
  protected getBriefStatus(username: string): string {
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

    // If already connecting, wait for that connection to complete
    if (this.connectingPromises.has(config.username)) {
      console.error(`[BotManager] ${config.username} is already connecting, waiting...`);
      return this.connectingPromises.get(config.username)!;
    }

    // Store connection config for auto-reconnect
    this.connectionConfigs.set(config.username, config);

    // Create connection promise
    const connectionPromise = new Promise<string>((resolve, reject) => {
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

        // Fix gamerule to enable item drops and pickup
        // This is critical for resource gathering to work properly
        console.error(`[BotManager] Enabling item drops and pickup via gamerules...`);
        bot.chat("/gamerule doTileDrops true");
        bot.chat("/gamerule doMobLoot true");
        bot.chat("/gamerule doEntityDrops true");

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
        let lastEatTime = 0;
        bot.on("health", async () => {
          const currentFood = bot.food ?? 20;
          const currentHealth = bot.health ?? 20;

          // Early-exit for stable state: if both hunger and health are sufficient, skip event
          if (currentFood >= 18 && currentHealth >= 18) {
            return;
          }

          // Fast-path: immediate food consumption if hunger < 18 with cooldown
          const now = Date.now();
          if (currentFood < 18 && now - lastEatTime > 30000) {
            lastEatTime = now;
            const inventory = bot.inventory.items();

            // Check for cooked food first
            const cookedFood = inventory.find(item =>
              item.name === 'cooked_beef' || item.name === 'cooked_porkchop' ||
              item.name === 'cooked_chicken' || item.name === 'cooked_mutton' ||
              item.name === 'cooked_salmon' || item.name === 'cooked_cod' ||
              item.name === 'bread' || item.name === 'baked_potato' ||
              item.name === 'golden_carrot' || item.name === 'golden_apple'
            );

            if (cookedFood) {
              try {
                await bot.equip(cookedFood, 'hand');
                bot.activateItem();
                addEvent("health_changed", `Food consumed (${cookedFood.name}). Health: ${currentHealth.toFixed(1)}/20, Food: ${currentFood}/20`, {
                  health: currentHealth,
                  food: currentFood,
                  consumed: cookedFood.name,
                  resolved: true
                });
                return;
              } catch (err) {
                // Fall through to raw food or normal event
              }
            }

            // Check for raw food + fuel (smelt immediately if available)
            const rawFood = inventory.find(item =>
              item.name === 'beef' || item.name === 'porkchop' ||
              item.name === 'chicken' || item.name === 'mutton' ||
              item.name === 'salmon' || item.name === 'cod' || item.name === 'potato'
            );
            const fuel = inventory.find(item =>
              item.name === 'coal' || item.name === 'charcoal' ||
              item.name === 'planks' || item.name.includes('log')
            );

            if (rawFood && fuel) {
              addEvent("health_changed", `LOW FOOD (${currentFood}/20)! Raw food+fuel available. Smelt ${rawFood.name} immediately!`, {
                health: currentHealth,
                food: currentFood,
                rawFood: rawFood.name,
                fuel: fuel.name,
                urgent: true
              });
              return;
            }
          }

          // Normal event if no immediate action taken
          addEvent("health_changed", `Health: ${currentHealth.toFixed(1)}/20, Food: ${currentFood}/20`, {
            health: currentHealth,
            food: currentFood,
          });
        });

        // Oxygen level check (drowning detection)
        let lastOxygenLevel = 20;
        bot.on("breath", () => {
          const oxygen = bot.oxygenLevel ?? 20;
          // Only emit if oxygen is critically low AND decreasing (avoid false positives)
          if (oxygen < 5 && oxygen < lastOxygenLevel) {
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

        // Handle disconnection with auto-reconnect
        bot.on("end", (reason) => {
          if (managedBot.particleInterval) {
            clearInterval(managedBot.particleInterval);
          }
          this.bots.delete(config.username);
          console.error(`[BotManager] ${config.username} disconnected. Reason:`, reason || "Unknown");

          // Auto-reconnect after 5 seconds
          const savedConfig = this.connectionConfigs.get(config.username);
          if (savedConfig) {
            console.error(`[BotManager] Auto-reconnecting ${config.username} in 5 seconds...`);
            setTimeout(() => {
              this.connect(savedConfig).then((result) => {
                console.error(`[BotManager] Auto-reconnect successful: ${result}`);
              }).catch((error) => {
                console.error(`[BotManager] Auto-reconnect failed:`, error);
              });
            }, 5000);
          }
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
        this.connectingPromises.delete(config.username);
        resolve(result);
      });

      bot.once("error", (err) => {
        this.connectingPromises.delete(config.username);
        reject(new Error(`Connection error: ${err.message || err}`));
      });

      bot.once("kicked", (reason) => {
        this.connectingPromises.delete(config.username);
        const reasonText = typeof reason === 'string' ? reason : JSON.stringify(reason);
        reject(new Error(`Kicked: ${reasonText}`));
      });
    });

    // Store the promise and return it
    this.connectingPromises.set(config.username, connectionPromise);
    return connectionPromise;
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
    this.connectionConfigs.delete(username); // Remove config to prevent auto-reconnect
  }

  disconnectAll(): void {
    for (const [_username, managed] of this.bots) {
      if (managed.particleInterval) {
        clearInterval(managed.particleInterval);
      }
      managed.bot.quit();
    }
    this.bots.clear();
  }
}
