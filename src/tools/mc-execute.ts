/**
 * mc_execute - Code Execution with MCP
 *
 * Instead of calling individual MCP tools, the agent writes JavaScript code
 * that executes against a bot API object. Enables multiple operations,
 * conditional logic, and loops in a single tool call.
 *
 * Uses node:vm for sandboxed execution with no access to require/process/fs.
 */

import * as vm from "node:vm";
import {
  mc_status,
  mc_gather,
  mc_craft,
  mc_farm,
  mc_build,
  mc_navigate,
  mc_combat,
  mc_drop,
  mc_eat,
  mc_store,
  mc_chat,
  mc_flee,
  minecraft_pillar_up,
  mc_smelt,
} from "./core-tools.js";
import { botManager } from "../bot-manager/index.js";

const MAX_TIMEOUT = 600_000;  // 10 minutes max for gameplay loops
const DEFAULT_TIMEOUT = 120_000;  // 2 minutes default
const MAX_WAIT_MS = 30_000;  // 30s per wait call (for crop growth etc)
const MAX_LOG_LINES = 200;

/**
 * Execute JavaScript code against the bot API in a sandboxed context.
 */
export async function mc_execute(
  code: string,
  timeout: number = DEFAULT_TIMEOUT
): Promise<string> {
  const effectiveTimeout = Math.min(Math.max(timeout, 1000), MAX_TIMEOUT);
  const logs: string[] = [];
  const startTime = Date.now();

  // Build the bot API object that delegates to core-tools
  const botApi = {
    // Status
    status: async () => {
      const raw = await mc_status();
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },
    inventory: () => {
      const username = botManager.requireSingleBot();
      return botManager.getInventory(username);
    },

    // Movement
    moveTo: async (x: number, y: number, z: number) => {
      return await mc_navigate({ x, y, z });
    },
    navigate: async (target: string | { x?: number; y?: number; z?: number; target_block?: string; target_entity?: string; max_distance?: number }) => {
      if (typeof target === "string") {
        // Guess if it's a block or entity name
        // Common entity names
        const entities = new Set([
          "cow", "pig", "chicken", "sheep", "horse", "villager", "iron_golem",
          "zombie", "skeleton", "creeper", "spider", "enderman", "blaze",
          "ghast", "witch", "pillager", "ravager", "phantom", "drowned",
          "wolf", "cat", "fox", "rabbit", "bee", "goat", "axolotl",
          "player", "wandering_trader",
        ]);
        if (entities.has(target.toLowerCase())) {
          return await mc_navigate({ target_entity: target });
        }
        return await mc_navigate({ target_block: target });
      }
      return await mc_navigate(target);
    },
    flee: async (distance?: number) => {
      return await mc_flee(distance || 20);
    },
    pillarUp: async (height?: number) => {
      return await minecraft_pillar_up(height || 1);
    },

    // Resources
    gather: async (block: string, count?: number) => {
      return await mc_gather(block, count || 1);
    },
    craft: async (item: string, count?: number, autoGather?: boolean) => {
      return await mc_craft(item, count || 1, autoGather || false);
    },
    smelt: async (item: string, count?: number) => {
      return await mc_smelt(item, count || 1);
    },

    // Combat & Survival
    eat: async (food?: string) => {
      return await mc_eat(food);
    },
    combat: async (target?: string, fleeAtHp?: number) => {
      return await mc_combat(target, fleeAtHp || 10);
    },
    equipArmor: async () => {
      const username = botManager.requireSingleBot();
      return await botManager.equipArmor(username);
    },

    // Building
    place: async (blockType: string, x: number, y: number, z: number) => {
      const username = botManager.requireSingleBot();
      const result = await botManager.placeBlock(username, blockType, x, y, z);
      return result.message;
    },
    build: async (preset: string, size?: string) => {
      return await mc_build(preset as any, (size as any) || "small");
    },
    farm: async () => {
      return await mc_farm();
    },

    // Storage
    store: async (action: string, itemName?: string, count?: number, chestX?: number, chestY?: number, chestZ?: number, keepItems?: string[]) => {
      return await mc_store(action as any, itemName, count, chestX, chestY, chestZ, keepItems);
    },
    drop: async (itemName: string, count?: number) => {
      return await mc_drop(itemName, count);
    },

    // Chat
    chat: async (message: string) => {
      return await mc_chat(message);
    },
    getMessages: async () => {
      return await mc_chat(undefined, true);
    },

    // Utility
    log: (message: unknown) => {
      if (logs.length < MAX_LOG_LINES) {
        logs.push(String(message));
      }
    },
    wait: (ms: number) => {
      // Bot1 [2026-03-22]: drowned during bot.wait() at y=86 with hunger=0.
      // wait() was a raw setTimeout with no safety monitoring — bot took damage
      // from water/mobs for the entire wait duration with no abort mechanism.
      // Now: check HP every 1s during wait. If HP drops below 4, or bot is in water,
      // resolve early so the agent can react (flee, eat, move to safety).
      //
      // Bot2 [2026-03-23]: drowned from HP 15.8 during wait. Previous code only
      // aborted on (inWater && hp < 10) with 2s checks. Drowning deals 2 HP/s,
      // so HP 15.8→death in ~8s. With 2s interval + HP<10 threshold, the bot
      // would only abort at ~HP 8 with only 4s left — often too late.
      // Fix: (1) check every 1s instead of 2s, (2) abort on ANY water contact
      // regardless of HP, (3) attempt emergency jump to escape water before resolving.
      const waitMs = Math.min(ms, MAX_WAIT_MS);
      // Pre-wait: clear stale movement states that could drift the bot into danger.
      // Bot2 [2026-03-23]: bot moved into water during wait() despite no movement
      // instructions — lingering pathfinder goal or control states from a previous
      // action (flee, navigate) continued executing during wait, pushing the bot
      // into water. Clearing goal + controls ensures the bot stays put.
      try {
        const username = botManager.requireSingleBot();
        const waitBot = botManager.getBot(username);
        if (waitBot) {
          try { waitBot.pathfinder.setGoal(null); } catch { /* ignore */ }
          waitBot.clearControlStates();
        }
      } catch { /* ignore if no bot */ }
      return new Promise<void>((resolve) => {
        let resolved = false;
        const doResolve = () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timer);
          clearInterval(safetyInterval);
          resolve();
        };
        const timer = setTimeout(doResolve, waitMs);
        // Track HP between checks to detect rapid HP loss from mob attacks.
        // Bot2 [2026-03-22]: HP dropped 20→0.5 during wait loops from mob damage.
        // The old check only aborted at HP<4 — by then the bot was already nearly dead.
        // Tracking HP delta detects ongoing attacks early (3+ HP drop in 1s = mob hit).
        let lastCheckHp = -1;
        const safetyInterval = setInterval(async () => {
          try {
            const username = botManager.requireSingleBot();
            const waitBot = botManager.getBot(username);
            if (!waitBot) return;
            const hp = waitBot.health ?? 20;
            // Initialize lastCheckHp on first check
            if (lastCheckHp < 0) lastCheckHp = hp;
            // Abort wait if HP critically low — bot is under attack or drowning
            if (hp < 4) {
              if (logs.length < MAX_LOG_LINES) {
                logs.push(`[wait] ABORTED: HP dropped to ${hp.toFixed(1)} during wait`);
              }
              doResolve();
              return;
            }
            // Abort wait if HP dropped significantly since last check (mob attack).
            // Bot2 [2026-03-22]: HP dropped 20→0.5 during repeated wait() calls.
            // Each mob hit deals 2-8 damage. A 3+ HP drop in 1s means active combat.
            // Aborting early lets the agent flee/eat before HP reaches lethal levels.
            // Only trigger after first check (lastCheckHp > 0) to avoid false positive
            // on initial interval when lastCheckHp was just initialized.
            const hpDrop = lastCheckHp - hp;
            if (hpDrop >= 2 && lastCheckHp > 0) {
              if (logs.length < MAX_LOG_LINES) {
                logs.push(`[wait] ABORTED: Taking damage (HP ${lastCheckHp.toFixed(1)}→${hp.toFixed(1)}, -${hpDrop.toFixed(1)} in 0.5s) — under attack`);
              }
              lastCheckHp = hp;
              doResolve();
              return;
            }
            lastCheckHp = hp;
            // Abort wait if bot is in water — drowning risk at ANY HP level.
            // Bot2 [2026-03-23]: previous threshold (HP<10) was too late; bot drowned
            // from HP 15.8 because abort didn't trigger until HP<10, leaving only ~4s.
            // Water contact always warrants immediate abort + emergency escape.
            const feetBlock = waitBot.blockAt(waitBot.entity.position);
            const headBlock = waitBot.blockAt(waitBot.entity.position.offset(0, 1, 0));
            const isWater = (n: string | undefined) => n === "water" || n === "flowing_water";
            const inWater = isWater(feetBlock?.name) || isWater(headBlock?.name);
            if (inWater) {
              if (logs.length < MAX_LOG_LINES) {
                logs.push(`[wait] ABORTED: In water with HP=${hp.toFixed(1)} — drowning risk. Attempting emergency jump.`);
              }
              // Emergency: jump + move forward toward land to escape drowning.
              // Bot2 [2026-03-23]: previous 3x jump-in-place didn't exit the water
              // body — bot rose to surface briefly then sank back each time, still
              // taking drowning damage. HP 15.8→3.8→death between wait() calls.
              // Fix: scan 4 cardinal directions for nearest non-water block, look
              // toward it, then jump+forward to actually swim out of the water.
              try {
                const { Vec3 } = await import("vec3");
                const wPos = waitBot.entity.position;
                const wx = Math.floor(wPos.x);
                const wy = Math.floor(wPos.y);
                const wz = Math.floor(wPos.z);
                // Find nearest non-water direction to swim toward
                let bestAngle = 0;
                let bestDist = Infinity;
                const isWaterName = (n: string | undefined) => n === "water" || n === "flowing_water" || n === "air" || n === "cave_air";
                for (let scanDist = 1; scanDist <= 6; scanDist++) {
                  for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
                    const cx = wx + dx * scanDist;
                    const cz = wz + dz * scanDist;
                    // Check if there's solid ground at or near water level
                    for (let dy = -1; dy <= 2; dy++) {
                      const block = waitBot.blockAt(new Vec3(cx, wy + dy, cz));
                      if (block && !isWaterName(block.name) && block.boundingBox === "block") {
                        const dist = Math.sqrt(dx * dx * scanDist * scanDist + dz * dz * scanDist * scanDist);
                        if (dist < bestDist) {
                          bestDist = dist;
                          // Mineflayer yaw: atan2(-dx, dz) faces direction (dx, dz)
                          bestAngle = Math.atan2(-(dx * scanDist), dz * scanDist);
                        }
                      }
                    }
                  }
                  if (bestDist < Infinity) break;
                }
                // Look toward land (or random if no land found)
                await waitBot.look(bestAngle, 0, true);
                // Jump + forward to swim out
                for (let jumpAttempt = 0; jumpAttempt < 5; jumpAttempt++) {
                  waitBot.setControlState("forward", true);
                  waitBot.setControlState("jump", true);
                  await new Promise(r => setTimeout(r, 350));
                  waitBot.setControlState("jump", false);
                  await new Promise(r => setTimeout(r, 50));
                  // Check if we exited water
                  const checkFeet = waitBot.blockAt(waitBot.entity.position);
                  const checkHead = waitBot.blockAt(waitBot.entity.position.offset(0, 1, 0));
                  if (!isWater(checkFeet?.name) && !isWater(checkHead?.name)) {
                    break;
                  }
                }
                waitBot.clearControlStates();
              } catch { /* ignore jump errors */ }
              doResolve();
              return;
            }
          } catch { /* ignore errors during safety check */ }
        }, 500);
        // Clean up interval when wait resolves normally
        setTimeout(() => {
          clearInterval(safetyInterval);
        }, waitMs + 100);
      });
    },
  };

  // Create sandboxed context - no require, process, eval, fs access
  const sandbox: Record<string, unknown> = {
    bot: botApi,
    console: {
      log: (...args: unknown[]) => {
        if (logs.length < MAX_LOG_LINES) {
          logs.push(args.map(String).join(" "));
        }
      },
      error: (...args: unknown[]) => {
        if (logs.length < MAX_LOG_LINES) {
          logs.push("[error] " + args.map(String).join(" "));
        }
      },
      warn: (...args: unknown[]) => {
        if (logs.length < MAX_LOG_LINES) {
          logs.push("[warn] " + args.map(String).join(" "));
        }
      },
    },
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
    RegExp,
    Error,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    setTimeout: undefined,
    setInterval: undefined,
    setImmediate: undefined,
    clearTimeout: undefined,
    clearInterval: undefined,
    require: undefined,
    process: undefined,
    global: undefined,
    globalThis: undefined,
    eval: undefined,
    Function: undefined,
    Proxy: undefined,
    Reflect: undefined,
    import: undefined,
  };

  const context = vm.createContext(sandbox, {
    name: "mc_execute sandbox",
    codeGeneration: { strings: false, wasm: false },
  });

  // Wrap code in an async function so await works
  const wrappedCode = `
(async () => {
${code}
})()
`;

  console.error(`[mc_execute] Executing code (${code.length} chars, timeout: ${effectiveTimeout}ms)`);

  try {
    const script = new vm.Script(wrappedCode, {
      filename: "mc_execute_input.js",
    });

    // vm.Script timeout only works for synchronous code. For async, we need
    // a manual timeout wrapper.
    const resultPromise = script.runInContext(context, {
      timeout: effectiveTimeout,
    });

    // Race the execution against a timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Execution timed out after ${effectiveTimeout}ms`)), effectiveTimeout);
    });

    const result = await Promise.race([resultPromise, timeoutPromise]);

    const elapsed = Date.now() - startTime;

    // Format output
    const parts: string[] = [];

    if (result !== undefined && result !== null) {
      try {
        const resultStr = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        parts.push(`Result:\n${resultStr}`);
      } catch {
        parts.push(`Result: ${String(result)}`);
      }
    }

    if (logs.length > 0) {
      parts.push(`Logs:\n${logs.join("\n")}`);
    }

    parts.push(`Executed in ${elapsed}ms`);

    return parts.join("\n\n");
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    const parts: string[] = [];
    parts.push(`Error: ${errorMessage}`);

    if (logs.length > 0) {
      parts.push(`Logs before error:\n${logs.join("\n")}`);
    }

    parts.push(`Failed after ${elapsed}ms`);

    console.error(`[mc_execute] Error: ${errorMessage}`);
    return parts.join("\n\n");
  }
}
