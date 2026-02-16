import mineflayer from "mineflayer";
import { Vec3 } from "vec3";
import { EventEmitter } from "events";
import pkg from "mineflayer-pathfinder";
const { pathfinder, Movements, goals } = pkg;
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

    // Derive port from username (Claude1→3001, Claude2→3002, etc.)
    const match = username.match(/(\d+)$/);
    const viewerPort = match ? 3000 + parseInt(match[1]) : this.nextViewerPort++;
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
      // Provide helpful error message suggesting to connect first
      const botUsername = process.env.BOT_USERNAME || "Claude";
      const mcHost = process.env.MC_HOST || "localhost";
      const mcPort = process.env.MC_PORT || "25565";
      throw new Error(
        `Not connected to any server. Use minecraft_connect(host="${mcHost}", port=${mcPort}, username="${botUsername}", agentType="game") first.`
      );
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
        checkTimeoutInterval: 120000, // Check for timeout every 120 seconds (default: 30s)
        hideErrors: false, // Show all errors for debugging
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

        // Avoid walking through nether/end portals (prevents accidental dimension teleport)
        const portalBlock = bot.registry.blocksByName["nether_portal"];
        const endPortalBlock = bot.registry.blocksByName["end_portal"];
        if (portalBlock) movements.blocksToAvoid.add(portalBlock.id);
        if (endPortalBlock) movements.blocksToAvoid.add(endPortalBlock.id);

        // Increase liquid cost to discourage pathfinding through water (prevents drowning)
        // Default is 1 which treats water same as land. High cost makes pathfinder prefer land.
        (movements as any).liquidCost = 100;

        // Avoid lava completely (liquidCost alone doesn't distinguish water vs lava)
        const lavaBlock = bot.registry.blocksByName["lava"];
        if (lavaBlock) movements.blocksToAvoid.add(lavaBlock.id);

        bot.pathfinder.setMovements(movements);
        console.error(`[BotManager] Pathfinder configured: canDig=true, allow1by1towers=true, scaffoldingBlocks=${movements.scafoldingBlocks.length} types`);

        // Check game mode - auto-switch to survival if not
        const gameMode = bot.game?.gameMode;
        console.error(`[BotManager] ${config.username} game mode: ${gameMode}`);
        if (gameMode !== "survival") {
          console.error(`[BotManager] Switching to survival mode...`);
          bot.chat(`/gamemode survival ${config.username}`);
        }

        // Fix gamerules to enable item drops, pickup, and mob spawning
        // This is critical for resource gathering and survival to work properly
        // These reset on server restart, so we fix them every time a bot connects
        console.error(`[BotManager] Enabling item drops, pickup, and mob spawning via gamerules...`);
        bot.chat("/gamerule doTileDrops true");
        bot.chat("/gamerule doMobLoot true");
        bot.chat("/gamerule doEntityDrops true");
        bot.chat("/gamerule doMobSpawning true");

        const managedBot: ManagedBot = {
          bot,
          username: config.username,
          config,
          chatMessages: [],
          gameEvents: [],
          thinkingState: "idle",
          particleInterval: null,
          // CRITICAL: Reset item pickup flag on connection
          // Disconnecting and reconnecting clears server-side state
          serverHasItemPickupDisabled: false,
          serverHasItemPickupDisabledTimestamp: undefined,
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

        // System/command messages (e.g., /locate results, gamerule confirmations)
        bot.on("messagestr", (message: string, messagePosition: string) => {
          // Skip chat messages that are already handled by "chat" event
          // Chat event handles player messages like "<Player> message"
          if (messagePosition === "chat" && message.match(/^<\w+>/)) return;

          // Skip noisy messages
          if (message.includes("Gamerule") || message.includes("gamerule")) return;
          if (message.includes("Set the time to")) return;
          if (message.includes("joined the game")) return;
          if (message.includes("left the game")) return;

          managedBot.chatMessages.push({
            username: "[Server]",
            message: message,
            timestamp: Date.now(),
          });
          console.error(`[System/${messagePosition}] ${message}`);
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
          if (currentFood < 18 && now - lastEatTime > 10000) {
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
                await bot.consume();
                addEvent("health_changed", `Auto-ate ${cookedFood.name}. Health: ${currentHealth.toFixed(1)}/20, Food: ${bot.food}/20`, {
                  health: currentHealth,
                  food: bot.food,
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

        // Oxygen level check (drowning detection + auto swim up)
        let lastOxygenLevel = 20;
        bot.on("breath", () => {
          const oxygen = bot.oxygenLevel ?? 20;
          // Only emit if oxygen is critically low AND decreasing (avoid false positives)
          if (oxygen < 5 && oxygen < lastOxygenLevel) {
            addEvent("drowning", `LOW OXYGEN: ${oxygen}/20! Swim up immediately!`, {
              oxygenLevel: oxygen,
            });
          }
          // Auto swim up when oxygen is getting low
          if (oxygen < 10 && oxygen < lastOxygenLevel) {
            const feetBlock = bot.blockAt(bot.entity.position.floored());
            if (feetBlock?.name === "water") {
              console.error(`[AutoSwim] Low oxygen (${oxygen}/20), swimming up!`);
              bot.pathfinder.setGoal(null); // Cancel current pathfinding
              // Look straight up so forward movement swims upward
              bot.look(bot.entity.yaw, -Math.PI / 2, true);
              bot.setControlState("jump", true);
              bot.setControlState("sprint", true);
              bot.setControlState("forward", true);
              setTimeout(() => {
                bot.setControlState("jump", false);
                bot.setControlState("sprint", false);
                bot.setControlState("forward", false);
              }, 5000); // Extended from 3s to 5s for deeper water
            }
          }
          lastOxygenLevel = oxygen;
        });

        // Entity hurt (including self)
        bot.on("entityHurt", (entity) => {
          if (entity === bot.entity) {
            addEvent("damaged", `Took damage! Health: ${bot.health?.toFixed(1)}/20`, {
              health: bot.health,
            });
            // Emergency lava escape: if standing in lava, immediately jump and sprint away
            const feetBlock = bot.blockAt(bot.entity.position.floored());
            if (feetBlock?.name === "lava") {
              console.error(`[AutoFlee] IN LAVA! Emergency escape, HP=${bot.health.toFixed(1)}`);
              bot.setControlState("jump", true);
              bot.setControlState("sprint", true);
              bot.setControlState("forward", true);
              setTimeout(() => {
                bot.setControlState("jump", false);
                bot.setControlState("sprint", false);
                bot.setControlState("forward", false);
              }, 3000);
            }
            // Auto-flee when HP drops to 10 or below after taking damage
            else if (bot.health <= 10) {
              const nearestHostile = Object.values(bot.entities)
                .filter(e => e !== bot.entity && e.name && isHostileMob(bot, e.name.toLowerCase()))
                .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
              if (nearestHostile) {
                const dir = bot.entity.position.minus(nearestHostile.position).normalize();
                const fleeTarget = bot.entity.position.plus(dir.scaled(15));
                console.error(`[AutoFlee] HP=${bot.health.toFixed(1)}, fleeing from ${nearestHostile.name}`);
                try {
                  bot.pathfinder.setGoal(new goals.GoalNear(fleeTarget.x, fleeTarget.y, fleeTarget.z, 3));
                } catch (_) { /* ignore pathfinder errors during auto-flee */ }
                // Auto-eat while fleeing to recover HP
                const food = bot.inventory.items().find(i =>
                  ["bread", "cooked_beef", "cooked_porkchop", "cooked_chicken", "baked_potato", "cooked_mutton", "cooked_cod", "cooked_salmon", "golden_apple"].includes(i.name)
                );
                if (food && bot.food < 20) {
                  bot.equip(food, "hand").then(() => bot.consume()).catch(() => {});
                }
              }
            }
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
          const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
          console.error(`[BotManager] ${config.username} disconnected. Reason: ${reasonStr}`);

          // Auto-reconnect is disabled - let the caller (Claude Code loop) handle reconnection
          // This prevents zombie connections when MCP processes are replaced
          this.connectionConfigs.delete(config.username);
          console.error(`[BotManager] ${config.username} will not auto-reconnect (managed by caller)`);
        });

        bot.on("kicked", (reason, loggedIn) => {
          const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
          console.error(`[BotManager] ${config.username} was KICKED. Reason: ${reasonStr}, LoggedIn: ${loggedIn}`);
          addEvent("kicked", `Kicked: ${reasonStr}`, { reason: reasonStr, loggedIn });
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

        // Start prismarine-viewer for first-person view in browser (unless disabled)
        let viewerPort: number | null = null;
        if (!config.disableViewer) {
          viewerPort = this.startViewer(config.username);
          if (viewerPort) {
            console.error(`[BotManager] Open http://localhost:${viewerPort} to see the first-person view`);
          }
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
    this.connectionConfigs.clear();
  }
}
