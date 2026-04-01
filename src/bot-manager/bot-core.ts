import mineflayer from "mineflayer";
import { Vec3 } from "vec3";
import { EventEmitter } from "events";
import { AsyncLocalStorage } from "async_hooks";
import pkg from "mineflayer-pathfinder";
const { pathfinder, Movements, goals } = pkg;
import type { BotConfig, ManagedBot, GameEvent } from "./types.js";
import { isHostileMob, isPassiveMob, isWaterBlock, EDIBLE_FOOD_NAMES } from "./minecraft-utils.js";
import { equipArmor } from "./bot-items.js";
import { safeSetGoal } from "./pathfinder-safety.js";
import { lastSleepTick } from "./bot-survival.js";
import { AutoSafety } from "./auto-safety.js";

// AsyncLocalStorage for per-request bot username context (multi-bot support)
export const currentBotContext = new AsyncLocalStorage<string>();

// Mamba向けの簡潔ステータスを付加するか（デフォルトはfalse=Claude向け）
const APPEND_BRIEF_STATUS = process.env.APPEND_BRIEF_STATUS === "true";

/**
 * Core bot management class - handles connection, disconnection, and lifecycle
 */
export class BotCore extends EventEmitter {
  protected bots: Map<string, ManagedBot> = new Map();
  private connectionConfigs: Map<string, BotConfig> = new Map(); // Store connection params for auto-reconnect
  private connectingPromises: Map<string, Promise<string>> = new Map(); // Track ongoing connections
  private deathTimestamps: Map<string, number> = new Map(); // Track last death time for auto-reconnect after death-disconnect
  private reconnectTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map(); // Track pending reconnect timers

  constructor() {
    super();
  }

  isConnected(username?: string): boolean {
    if (username) {
      return this.bots.has(username);
    }
    return this.bots.size > 0;
  }

  getBot(username: string): import("mineflayer").Bot | null {
    const bot = this.bots.get(username)?.bot || null;
    if (!bot) return null;
    // Return a Proxy that blocks dangerous methods
    const blockedMethods = new Set(["chat", "quit", "end"]);
    return new Proxy(bot, {
      get(target, prop, receiver) {
        if (blockedMethods.has(prop as string)) {
          return (...args: unknown[]) => {
            console.error(`[Security] BLOCKED bot.${String(prop)}(${JSON.stringify(args).slice(0, 100)})`);
          };
        }
        return Reflect.get(target, prop, receiver);
      }
    });
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

  // Get the only bot or throw error (for single-bot mode).
  // In multi-bot mode, checks AsyncLocalStorage context set by mc_execute(username).
  requireSingleBot(): string {
    // Check async context first (set by mc_execute when username is provided)
    const contextUsername = currentBotContext.getStore();
    if (contextUsername && this.bots.has(contextUsername)) return contextUsername;

    const username = this.getFirstBotUsername();
    if (!username) {
      throw new Error(`Not connected to any server. Connect first with: node scripts/mc-connect.cjs localhost 25565 ClaudeN`);
    }
    // Multi-bot: if more than one bot connected and no context, refuse to guess
    if (this.bots.size > 1) {
      const names = [...this.bots.keys()].join(", ");
      throw new Error(`Multiple bots connected (${names}). Set BOT_USERNAME=<name> env var to specify which bot to control.`);
    }
    return username;
  }

  // Wait up to maxWaitMs for a bot to become available (e.g. during death-triggered reconnect).
  // Returns the username once connected, or throws if timeout is reached.
  async waitForBot(maxWaitMs: number = 8000): Promise<string> {
    const contextUsername = currentBotContext.getStore();
    const pollInterval = 200;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      if (contextUsername && this.bots.has(contextUsername)) return contextUsername;
      const username = this.getFirstBotUsername();
      if (username) return username;
      await new Promise(r => setTimeout(r, pollInterval));
    }
    // Final check
    if (contextUsername && this.bots.has(contextUsername)) return contextUsername;
    const username = this.getFirstBotUsername();
    if (username) return username;
    const botUsername = process.env.BOT_USERNAME || "Claude";
    const mcHost = process.env.MC_HOST || "localhost";
    const mcPort = process.env.MC_PORT || "25565";
    throw new Error(
      `Not connected to any server after waiting ${maxWaitMs}ms. Use minecraft_connect(host="${mcHost}", port=${mcPort}, username="${botUsername}", agentType="game") first.`
    );
  }

  // Check if a death-triggered reconnect is currently pending (bot recently died)
  isDeathReconnectPending(username?: string): boolean {
    if (username) {
      return this.reconnectTimeouts.has(username);
    }
    return this.reconnectTimeouts.size > 0;
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
      if (!entity.position) continue;
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
       try {
        // Load pathfinder plugin
        bot.loadPlugin(pathfinder);
        const movements = new Movements(bot);

        // SAFETY: Disable digging — pathfinder digging through terrain creates cave openings
        // and underground routing that has caused 30+ deaths across Bot1/Bot2/Bot3.
        // Previously canDig=true, but moveToBasic had to override it to false at night/low-HP.
        // Even the daytime override to true caused deaths: pathfinder digs surface blocks,
        // opens caves, bot falls in, gets surrounded by mobs. Use mc_tunnel for intentional digging.
        movements.canDig = false;

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

        // Movement options - SAFETY: disable risky movements to prevent fall damage
        const isNether = bot.game.dimension === "the_nether";
        movements.allowFreeMotion = false; // SAFETY: Disable everywhere — free motion skips intermediate path nodes, causing bot to walk off cliff edges between waypoints
        movements.allowParkour = false; // DISABLED in all dimensions (prevent gap jumps that can fail → fall damage)
        movements.allowSprinting = true;
        movements.maxDropDown = 2; // Allow 2-block drops for natural terrain. maxDropDown=1 was too restrictive — pathfinder couldn't find paths in hilly biomes (birch_forest). Physics fall detector (>3 blocks) catches unsafe falls.

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
        (movements as any).liquidCost = 10000;

        // Avoid water completely — liquidCost alone is not sufficient.
        // When no land route is available, pathfinder falls back to water routing regardless of liquidCost.
        // blocksToAvoid makes water impassable so pathfinder returns no_path instead of routing through water.
        // Bot1 Sessions 31-34,40b,44,64: 7+ deaths from water routing.
        // Also add flowing_water to movements.liquids — pathfinder's default liquids set only includes
        // water (source block), not flowing_water. Without this, flowing_water is treated as safe
        // walkable space (liquid=false, safe=true) and the "dont go underwater" checks don't apply.
        const waterBlock = bot.registry.blocksByName["water"];
        const flowingWaterBlock = bot.registry.blocksByName["flowing_water"];
        if (waterBlock) movements.blocksToAvoid.add(waterBlock.id);
        if (flowingWaterBlock) movements.blocksToAvoid.add(flowingWaterBlock.id);
        // Ensure flowing_water is treated as liquid by pathfinder (not just source water)
        if (flowingWaterBlock) (movements as any).liquids.add(flowingWaterBlock.id);

        // Avoid lava completely (liquidCost alone doesn't distinguish water vs lava)
        // Bot2: "tried to swim in lava" — must avoid both static and flowing lava.
        const lavaBlock = bot.registry.blocksByName["lava"];
        if (lavaBlock) movements.blocksToAvoid.add(lavaBlock.id);
        const flowingLavaBlock = bot.registry.blocksByName["flowing_lava"];
        if (flowingLavaBlock) movements.blocksToAvoid.add(flowingLavaBlock.id);

        // Avoid fire and soul_fire blocks (common in Nether fortresses)
        const fireBlock = bot.registry.blocksByName["fire"];
        const soulFireBlock = bot.registry.blocksByName["soul_fire"];
        if (fireBlock) movements.blocksToAvoid.add(fireBlock.id);
        if (soulFireBlock) movements.blocksToAvoid.add(soulFireBlock.id);

        bot.pathfinder.setMovements(movements);

        // Guard: validate goal objects before they reach pathfinder internals.
        // Agents sometimes pass plain {x,y,z} objects which lack isValid()/hasChanged()/isEnd()
        // causing uncaught TypeError("stateGoal.isValid is not a function") every physics tick.
        // Bug [2026-03-29]: silent rejection of invalid goals caused "goal was changed" race condition.
        // When goal is invalid, we still need to call origSetGoal(null) to properly clear any existing goal.
        // This prevents the pathfinder from staying in a stale state waiting for the old goal to complete.
        {
          const origSetGoal = bot.pathfinder.setGoal.bind(bot.pathfinder);
          (bot.pathfinder as any).setGoal = (goal: any, dynamic?: boolean) => {
            if (goal !== null && goal !== undefined &&
                (typeof goal.isValid !== "function" || typeof goal.isEnd !== "function")) {
              console.error(`[Pathfinder] INVALID goal rejected (missing isValid/isEnd): ${JSON.stringify(goal)}`);
              // Still clear the pathfinder's internal goal state by passing null
              origSetGoal(null, dynamic);
              return;
            }
            origSetGoal(goal, dynamic);
          };
        }

        // Extend pathfinder think timeout for long-distance navigation.
        // Default thinkTimeout=5000ms is insufficient for 100-200 block paths through hilly terrain
        // (spawn area cliff/mountain geography). With water/lava/digging disabled, pathfinder must
        // find longer surface routes which require more A* search time.
        // Bot1 Session 64: moveTo(200,70,200) arrived at (4,65,-3) — pathfinder timed out and
        // fell back to the "best partial node" near spawn instead of the actual target.
        // 10000ms gives the A* search 2× the time to find long surface routes.
        (bot.pathfinder as any).thinkTimeout = 10000;
        console.error(`[BotManager] Pathfinder configured: canDig=false, allow1by1towers=true, scaffoldingBlocks=${movements.scafoldingBlocks.length} types, thinkTimeout=10000ms`);

        // PATCH: Fix mineflayer's block_place sequence bug (hardcoded 0 in both
        // generic_place.js and inventory.js activateBlock).
        // Minecraft 1.19+ requires incrementing sequence IDs for block_place packets.
        // Without this fix, activateBlock (hoe tilling, seed planting, bucket use, etc.) silently fails.
        {
          let placeSequence = 0;
          const origWrite = bot._client.write.bind(bot._client);
          (bot._client as any).write = function(name: string, data: any) {
            if (name === 'block_place' && data && typeof data.sequence !== 'undefined') {
              data.sequence = ++placeSequence;
            }
            return origWrite(name, data);
          };
          console.error(`[BotManager] Patched _client.write to fix block_place sequence (mineflayer bug)`);
        }

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
        bot.chat("/gamerule keepInventory true");

        // Initialize lastSleepTick to current world age on connect.
        // Without this, lastSleepTick defaults to 0, making ticksSinceLastSleep = worldAge
        // (always huge), which falsely triggers Phantom insomnia warnings on every fresh
        // connection. By assuming the bot "just slept" on connect, we avoid the false alarm
        // and start tracking from connection time. If the bot truly hasn't slept, phantoms
        // will spawn after 72000 ticks from this point — giving the agent time to craft a bed.
        // Bot1/Bot2/Bot3 [2026-03-22]: repeated false phantom insomnia warnings on session start.
        const connectWorldAge = bot.time?.age ?? 0;
        if (connectWorldAge > 0) {
          lastSleepTick.set(config.username, connectWorldAge);
          console.error(`[BotManager] Initialized lastSleepTick for ${config.username} to world age ${connectWorldAge}`);
        }

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

          // Skip noisy but expected gamerule confirmation messages
          // e.g. "Gamerule doTileDrops is now set to: true"
          // BUT keep permission errors / unknown command errors so the agent sees failures.
          if (message.match(/^Gamerule \w+ is now set to:/)) return;
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

        // Dimension change (portal teleport) - update pathfinder safety settings
        let lastDimension = bot.game.dimension;
        bot.on("spawn", () => {
          const newDimension = bot.game.dimension;

          if (newDimension !== lastDimension) {
            lastDimension = newDimension;
            console.error(`[BotManager] Dimension changed to ${newDimension}, updating pathfinder safety settings...`);

            const movements = bot.pathfinder.movements;
            const isNether = newDimension === "the_nether";

            // NETHER SAFETY: Restrict risky movements to prevent lava deaths and cliff falls
            movements.allowFreeMotion = false; // SAFETY: Disable everywhere — prevents cliff falls from skipped path nodes
            movements.allowParkour = false; // DISABLED in all dimensions (prevents fall damage)
            movements.maxDropDown = 2; // Allow 2-block drops for terrain navigation. Physics fall detector catches >2.5 block falls.

            bot.pathfinder.setMovements(movements);
            console.error(`[BotManager] Pathfinder updated for ${newDimension}: allowFreeMotion=${movements.allowFreeMotion}, allowParkour=${movements.allowParkour}, maxDropDown=${movements.maxDropDown}`);
          }
        });

        // Health changed — event notification only (agent decides when to eat)
        bot.on("health", () => {
          const currentFood = bot.food ?? 20;
          const currentHealth = bot.health ?? 20;

          // Early-exit for stable state
          if (currentFood >= 18 && currentHealth >= 18) {
            return;
          }

          addEvent("health_changed", `Health: ${currentHealth.toFixed(1)}/20, Food: ${currentFood}/20`, {
            health: currentHealth,
            food: currentFood,
          });
        });

        // Oxygen level check — event notification only (agent decides how to respond).
        // Bot2 [2026-03-23]: oxygenLevel returned 0 on land (Mineflayer version-dependent),
        // causing false drowning events. Same pattern fixed in mc-execute.ts wait() and
        // bot-info.ts status(). Only emit drowning events when bot is actually in water
        // (block check at feet or head). The water block check is the reliable signal;
        // oxygenLevel alone is unreliable on some Mineflayer versions.
        let lastOxygenLevel = 20;
        bot.on("breath", () => {
          const oxygenRaw = bot.oxygenLevel ?? 20;
          const oxygen = Math.min(20, Math.max(0, oxygenRaw));
          // Only warn if bot is actually in water — oxygenLevel can be 0 on land
          const feetBlock = bot.blockAt(bot.entity.position);
          const headBlock = bot.blockAt(bot.entity.position.offset(0, 1, 0));
          const inWater = isWaterBlock(feetBlock?.name) || isWaterBlock(headBlock?.name);
          if (oxygen < 5 && oxygen < lastOxygenLevel && inWater) {
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
            // Emergency escape: if standing in lava or fire, immediately jump and sprint away
            const feetBlock = bot.blockAt(bot.entity.position.floored());
            const feetBlockBelow = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0));
            const isInLava = feetBlock?.name === "lava";
            const isInFire = feetBlock?.name === "fire" || feetBlock?.name === "soul_fire" || feetBlockBelow?.name === "magma_block";
            if (isInLava || isInFire) {
              console.error(`[AutoFlee] ${isInLava ? "IN LAVA" : "ON FIRE"}! Emergency escape, HP=${bot.health.toFixed(1)}`);
              bot.setControlState("jump", true);
              bot.setControlState("sprint", true);
              bot.setControlState("forward", true);
              setTimeout(() => {
                bot.setControlState("jump", false);
                bot.setControlState("sprint", false);
                bot.setControlState("forward", false);
              }, isInLava ? 3000 : 1500);
              // Auto-eat while escaping fire/lava — use EDIBLE_FOOD_NAMES for complete coverage.
              const food = bot.inventory.items().find(i => EDIBLE_FOOD_NAMES.has(i.name));
              if (food && bot.food < 20) {
                bot.equip(food, "hand").then(() => bot.consume()).catch(() => {});
              }
            }
            // Low HP — notify agent (agent decides whether to flee/eat/fight)
            else if (bot.health <= 10) {
              addEvent("low_hp", `LOW HP: ${bot.health.toFixed(1)}/20! Consider fleeing or eating.`, {
                health: bot.health,
                food: bot.food,
              });
            }
          } else if (entity.position?.distanceTo(bot.entity.position) < 10) {
            addEvent("entity_hurt", `${entity.name || "Entity"} took damage nearby`, {
              entityName: entity.name,
              distance: entity.position?.distanceTo(bot.entity.position).toFixed(1),
            });
          }
        });

        // Entity spawned nearby
        bot.on("entitySpawn", (entity) => {
          if (entity.name && isHostileMob(bot, entity.name.toLowerCase())) {
            if (!entity.position) return;
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

        // Handle disconnection with conditional auto-reconnect
        bot.on("end", (reason) => {
          if (managedBot.particleInterval) {
            clearInterval(managedBot.particleInterval);
          }
          // Stop AutoSafety on disconnect
          autoSafety.stop();
          this.bots.delete(config.username);
          const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
          console.error(`[BotManager] ${config.username} disconnected. Reason: ${reasonStr}`);

          // Check if disconnect was caused by death (death event fired within the last 10 seconds).
          // When a bot dies in Minecraft, the server sends a disconnect+respawn sequence, which
          // causes Mineflayer's "end" event to fire even though keepInventory is ON and the bot
          // should immediately respawn. Without auto-reconnect, all subsequent mc_execute calls
          // fail with "Not connected after 1ms" — the bot is still alive in the game but removed
          // from botManager.bots. Bug [2026-03-26]: "Session 76 - CRITICAL: bot.status() disconnects bot".
          const lastDeathTime = this.deathTimestamps.get(config.username) ?? 0;
          const msSinceDeath = Date.now() - lastDeathTime;
          const storedConfig = this.connectionConfigs.get(config.username);
          const isDeath = msSinceDeath < 10000 && storedConfig;

          if (isDeath) {
            // Reduce reconnect delay from 3000ms to 1000ms.
            // The 3s gap caused farm()/build() to throw "Bot not found" mid-operation
            // because getBotByUsername() returns null during the entire reconnect window.
            // 1s is sufficient for the Minecraft server to process death+respawn before
            // reconnect, while minimizing the window where bots map is empty.
            console.error(`[BotManager] ${config.username} disconnected after death (${msSinceDeath}ms ago). Auto-reconnecting in 1s...`);
            // Cancel any existing pending reconnect for this username
            const existingTimer = this.reconnectTimeouts.get(config.username);
            if (existingTimer) {
              clearTimeout(existingTimer);
            }
            const timer = setTimeout(async () => {
              this.reconnectTimeouts.delete(config.username);
              this.deathTimestamps.delete(config.username);
              // Only reconnect if not already connected or connecting
              if (this.bots.has(config.username) || this.connectingPromises.has(config.username)) {
                console.error(`[BotManager] ${config.username} already connected/connecting, skipping auto-reconnect`);
                return;
              }
              try {
                console.error(`[BotManager] Auto-reconnecting ${config.username} after death...`);
                await this.connect(storedConfig);
                console.error(`[BotManager] ${config.username} auto-reconnected successfully after death`);
              } catch (err) {
                console.error(`[BotManager] ${config.username} auto-reconnect after death failed:`, err);
              }
            }, 1000);
            this.reconnectTimeouts.set(config.username, timer);
          } else {
            // Non-death disconnect: auto-reconnect after 2s delay.
            // Previously "do not auto-reconnect" — but this caused the bot to be permanently
            // disconnected between mc_execute calls. The Minecraft server kicks the bot when
            // it sends no movement packets for ~3s between calls. Auto-reconnect ensures the
            // bot is available for the next mc_execute without requiring manual mc_connect.
            // Bug [Sessions 65-100]: all long-running operations failed because the bot
            // disconnected after one call and wasn't reconnected until mc_connect was called again.
            console.error(`[BotManager] ${config.username} disconnected (non-death). Auto-reconnecting in 2s...`);
            const existingTimer = this.reconnectTimeouts.get(config.username);
            if (existingTimer) {
              clearTimeout(existingTimer);
            }
            const timer = setTimeout(async () => {
              this.reconnectTimeouts.delete(config.username);
              if (this.bots.has(config.username) || this.connectingPromises.has(config.username)) {
                console.error(`[BotManager] ${config.username} already connected/connecting, skipping auto-reconnect`);
                return;
              }
              // Only reconnect if config still exists (not explicitly disconnected via mc_disconnect)
              const reconnectConfig = this.connectionConfigs.get(config.username);
              if (!reconnectConfig) {
                console.error(`[BotManager] ${config.username} config removed, skipping auto-reconnect`);
                return;
              }
              try {
                console.error(`[BotManager] Auto-reconnecting ${config.username} after non-death disconnect...`);
                await this.connect(reconnectConfig);
                console.error(`[BotManager] ${config.username} auto-reconnected successfully`);
              } catch (err) {
                console.error(`[BotManager] ${config.username} auto-reconnect failed:`, err);
              }
            }, 2000);
            this.reconnectTimeouts.set(config.username, timer);
          }
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
          // Record death timestamp so end handler can distinguish death-disconnect from real disconnects
          this.deathTimestamps.set(config.username, Date.now());
          addEvent("death", "Bot died! Respawning...");
          bot.chat("やられた！リスポーン中...");
          setTimeout(async () => {
            bot.chat("復活しました！");
            addEvent("respawn", "Bot respawned");

            // Auto-equip best armor after respawn
            try {
              await equipArmor(bot);
              console.error(`[BotManager] Auto-equipped armor after respawn`);
            } catch (_) { /* ignore armor equip errors */ }

            // Safety check: warn if unarmed and at night
            setTimeout(() => {
              const hasWeapon = bot.inventory.items().some(i =>
                i.name.includes("sword") || i.name.includes("axe")
              );
              const hasArmor = bot.inventory.items().some(i =>
                i.name.includes("helmet") || i.name.includes("chestplate") ||
                i.name.includes("leggings") || i.name.includes("boots")
              );
              const time = bot.time.timeOfDay;
              const isNight = time >= 12541 && time < 23458;

              if (!hasWeapon || !hasArmor) {
                console.error(`[Respawn Safety] ${config.username} respawned without equipment! Weapon: ${hasWeapon}, Armor: ${hasArmor}`);
                if (isNight) {
                  bot.chat("[警告] 装備なし+夜間。移動危険。シェルター待機推奨");
                  addEvent("respawn_warning", "Respawned without equipment during night");
                } else {
                  bot.chat("[警告] 装備なし。Base帰還・装備回復推奨");
                  addEvent("respawn_warning", "Respawned without equipment");
                }
              }
            }, 1000);
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

        // AutoSafety: deterministic safety layer (auto-eat, creeper flee, general flee, auto-sleep)
        const autoSafety = new AutoSafety(managedBot);
        autoSafety.start();

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

        // Return connection info
        const result = `Connected as ${config.username} (${gameMode} mode)`;
        if (gameMode !== "survival") {
          this.connectingPromises.delete(config.username);
          return resolve(`${result}. WARNING: Not in survival mode! Run /gamemode survival ${config.username} for items to drop.`);
        }
        this.connectingPromises.delete(config.username);
        resolve(result);
       } catch (err) {
        // If spawn handler throws, reject the promise instead of hanging forever
        console.error(`[BotManager] Spawn handler error for ${config.username}:`, err);
        this.connectingPromises.delete(config.username);
        try { bot.quit(); } catch (_) { /* ignore */ }
        reject(new Error(`Spawn handler error: ${err instanceof Error ? err.message : String(err)}`));
       }
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

    // Add 60s timeout to prevent indefinite hangs
    const CONNECTION_TIMEOUT_MS = 60_000;
    const timeoutPromise = new Promise<string>((_, reject) => {
      setTimeout(() => {
        this.connectingPromises.delete(config.username);
        reject(new Error(`Connection timed out after ${CONNECTION_TIMEOUT_MS / 1000}s for ${config.username}`));
      }, CONNECTION_TIMEOUT_MS);
    });
    const racedPromise = Promise.race([connectionPromise, timeoutPromise]);

    // Store the promise and return it
    this.connectingPromises.set(config.username, racedPromise);
    return racedPromise;
  }

  async disconnect(username: string): Promise<void> {
    // Cancel any pending reconnect so explicit disconnect is final
    const existingTimer = this.reconnectTimeouts.get(username);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.reconnectTimeouts.delete(username);
    }
    this.deathTimestamps.delete(username);
    this.connectionConfigs.delete(username); // Remove config to prevent auto-reconnect

    const managed = this.bots.get(username);
    if (!managed) {
      // Bot not currently connected (may be between auto-reconnects) — config already cleared above
      return;
    }

    if (managed.particleInterval) {
      clearInterval(managed.particleInterval);
    }
    managed.bot.quit();
    this.bots.delete(username);
  }

  disconnectAll(): void {
    // Cancel all pending death-triggered reconnects
    for (const [_username, timer] of this.reconnectTimeouts) {
      clearTimeout(timer);
    }
    this.reconnectTimeouts.clear();
    this.deathTimestamps.clear();

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
