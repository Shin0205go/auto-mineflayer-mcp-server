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
import { isHostileMob } from "../bot-manager/minecraft-utils.js";
import { equipArmor } from "../bot-manager/bot-items.js";

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
      return await mc_flee(distance ?? 20);
    },
    pillarUp: async (height?: number) => {
      return await minecraft_pillar_up(height ?? 1);
    },

    // Resources
    gather: async (block: string, count?: number, maxDistance?: number) => {
      return await mc_gather(block, count ?? 1, maxDistance);
    },
    craft: async (item: string, count?: number, autoGather?: boolean) => {
      return await mc_craft(item, count ?? 1, autoGather ?? false);
    },
    smelt: async (item: string, count?: number) => {
      return await mc_smelt(item, count ?? 1);
    },

    // Combat & Survival
    eat: async (food?: string) => {
      return await mc_eat(food);
    },
    combat: async (target?: string, fleeAtHp?: number) => {
      // Use ?? (not ||) so that fleeAtHp=0 is respected (meaning "never flee").
      // With ||, fleeAtHp=0 was silently overridden to 10, ignoring the agent's intent.
      return await mc_combat(target, fleeAtHp ?? 10);
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
    wait: async (ms: number) => {
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

          // PRE-WAIT AUTO-EQUIP ARMOR: bot.wait() can last up to 30s — the bot is
          // stationary and exposed to mob attacks the entire time. Without armor,
          // each skeleton arrow deals 5 damage, each zombie hit 3-6 damage.
          // Bot2 [2026-03-22]: HP 20→0.5 during night wait loops — no armor equipped.
          // Bot2 [2026-03-23]: HP dropped from 15.8 during wait — unarmored.
          // Equipping armor takes <200ms and significantly reduces damage taken.
          try {
            await equipArmor(waitBot);
          } catch { /* continue without armor */ }

          // PRE-WAIT HOSTILE PROXIMITY CHECK: if a hostile mob is within 6 blocks
          // at the start of wait, auto-flee before entering the wait loop.
          // Bot2 [2026-03-22]: HP 20→0.5 during repeated wait(5000) calls because
          // mobs were already adjacent when wait started — the HP-drop check only
          // fires AFTER the first hit, by which time 2-5 damage is already dealt.
          // Bot2 [2026-03-23]: mob approached during wait and killed bot between calls.
          // Pre-emptive flee before wait creates distance, preventing damage entirely.
          {
            let closestHostileDist = Infinity;
            let closestHostileName = "";
            for (const entity of Object.values(waitBot.entities)) {
              if (!entity || !entity.position || entity === waitBot.entity) continue;
              const eName = entity.name?.toLowerCase() ?? "";
              if (!isHostileMob(waitBot, eName)) continue;
              const dist = entity.position.distanceTo(waitBot.entity.position);
              if (dist < closestHostileDist) {
                closestHostileDist = dist;
                closestHostileName = eName;
              }
            }
            // Threshold raised from 6 to 8: a zombie at 6 blocks reaches melee in
            // ~2.6s. The pre-wait flee takes ~1-2s to execute, meaning the zombie may hit
            // the bot during the flee. At 8 blocks (3.5s to melee), the flee completes with
            // ~1.5s buffer. Matches the mid-wait check threshold for consistency.
            if (closestHostileDist <= 8) {
              if (logs.length < MAX_LOG_LINES) {
                logs.push(`[wait] Pre-wait: ${closestHostileName} at ${closestHostileDist.toFixed(1)} blocks — auto-fleeing before wait`);
              }
              try {
                await mc_flee(15);
                if (logs.length < MAX_LOG_LINES) {
                  logs.push(`[wait] Pre-wait flee complete (HP: ${(waitBot.health ?? 0).toFixed(1)})`);
                }
              } catch (fleeErr) {
                if (logs.length < MAX_LOG_LINES) {
                  logs.push(`[wait] Pre-wait flee failed: ${fleeErr}`);
                }
              }
              // Re-clear control states after flee
              try { waitBot.pathfinder.setGoal(null); } catch { /* ignore */ }
              waitBot.clearControlStates();
            }
          }
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
        let waitStartHp = -1; // Track HP at wait start for stable-HP detection
        let monitorCount = 0;
        const safetyInterval = setInterval(async () => {
          monitorCount++;
          try {
            const username = botManager.requireSingleBot();
            const waitBot = botManager.getBot(username);
            if (!waitBot) return;
            const hp = waitBot.health ?? 20;
            // Initialize lastCheckHp and waitStartHp on first check
            if (lastCheckHp < 0) lastCheckHp = hp;
            if (waitStartHp < 0) waitStartHp = hp;
            // Abort wait if HP critically low AND actually dropping.
            // Bot1 Session 47 [2026-03-23]: wait() aborted at HP=5.0 even though HP was
            // stable (not dropping). The bot pillarUp'd for safety at HP=5, then wait()
            // immediately aborted because `hp < 6` triggered on stable HP. This created
            // an infinite abort loop — bot couldn't wait for morning.
            // Fix: Only abort at low HP if HP has actually decreased since wait started.
            // If HP started at 5.0 and is still 5.0, the bot is safe (just low).
            // If HP started at 8.0 and dropped to 5.0, something is actively damaging it.
            // Keep an absolute floor at HP < 3 regardless — at that level, any single hit
            // is lethal and waiting is never safe.
            const hpDroppedSinceStart = waitStartHp - hp;
            if (hp < 3 || (hp < 6 && hpDroppedSinceStart >= 1)) {
              if (logs.length < MAX_LOG_LINES) {
                logs.push(`[wait] ABORTED: HP dropped to ${hp.toFixed(1)} during wait — auto-fleeing from danger`);
              }
              // Auto-flee when HP critically low during wait: the agent takes 1-3s to
              // react after wait() resolves, during which another mob hit is lethal.
              // Bot2 [2026-03-22]: HP dropped 20→0.5 during repeated wait() calls because
              // the bot only aborted but didn't flee — mobs continued hitting between calls.
              // Bot2 [2026-03-23]: HP 15.8→3.8→death between wait() calls from mob damage.
              // Auto-fleeing before resolving creates distance from the attacker, giving the
              // agent time to eat/heal. Same pattern as the water auto-flee (line ~344).
              try {
                await mc_flee(15);
                if (logs.length < MAX_LOG_LINES) {
                  logs.push(`[wait] Auto-fled from danger (HP now: ${(waitBot.health ?? 0).toFixed(1)})`);
                }
              } catch (fleeErr) {
                if (logs.length < MAX_LOG_LINES) {
                  logs.push(`[wait] Auto-flee failed: ${fleeErr}`);
                }
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
                logs.push(`[wait] ABORTED: Taking damage (HP ${lastCheckHp.toFixed(1)}→${hp.toFixed(1)}, -${hpDrop.toFixed(1)} in 0.5s) — auto-fleeing from attacker`);
              }
              lastCheckHp = hp;
              // Auto-flee when taking active damage during wait: mob attacks deal 2-8 HP
              // per hit, and the agent takes 1-3s to react after wait() resolves.
              // Without auto-flee, the bot stays in melee range and takes 2-3 more hits
              // before the agent can call flee() — often lethal at HP<14.
              // Bot2 [2026-03-22]: HP 20→0.5 across repeated wait() calls, no auto-flee.
              // Bot2 [2026-03-23]: HP 10→death during wait, zombie attacked from behind.
              try {
                await mc_flee(15);
                if (logs.length < MAX_LOG_LINES) {
                  logs.push(`[wait] Auto-fled from attacker (HP now: ${(waitBot.health ?? 0).toFixed(1)})`);
                }
              } catch (fleeErr) {
                if (logs.length < MAX_LOG_LINES) {
                  logs.push(`[wait] Auto-flee failed: ${fleeErr}`);
                }
              }
              doResolve();
              return;
            }
            lastCheckHp = hp;
            // MID-WAIT HOSTILE APPROACH DETECTION: check for hostiles closing in
            // and auto-flee BEFORE they attack (preemptive, not reactive).
            // The HP-drop check above only triggers AFTER taking a hit (2+ HP loss).
            // By then, the bot has already lost health that may be unrecoverable (no food).
            // Bot2 [2026-03-22]: HP 20→0.5 during wait — mobs attacked repeatedly between
            // 1s checks, each hit undetected until cumulative damage reached threshold.
            // Bot2 [2026-03-23]: zombie approached during wait, killed bot between calls.
            // Checking entity proximity every 1s catches mobs approaching BEFORE they hit.
            // Check every interval (every 1s) — previous 2s interval missed zombies
            // that closed from 8 blocks to melee between checks. A zombie walks 2.3 blocks/s,
            // so at 2s intervals a zombie at 5 blocks reaches melee before the next check.
            // Bot2 [2026-03-23]: zombie approached during wait, killed bot between 2s checks.
            // At 1s intervals + 8 block threshold, the bot gets 2-3 checks before a zombie
            // reaches melee range, giving reliable time to auto-flee.
            {
              let midWaitClosestDist = Infinity;
              let midWaitClosestName = "";
              for (const entity of Object.values(waitBot.entities)) {
                if (!entity || !entity.position || entity === waitBot.entity) continue;
                const eName = entity.name?.toLowerCase() ?? "";
                if (!isHostileMob(waitBot, eName)) continue;
                const dist = entity.position.distanceTo(waitBot.entity.position);
                if (dist < midWaitClosestDist) {
                  midWaitClosestDist = dist;
                  midWaitClosestName = eName;
                }
              }
              // Threshold raised from 5 to 8 blocks: a zombie at 5 blocks reaches melee
              // in ~2.2s at 2.3 blocks/s — with 1s check interval, only 2 checks before hit.
              // At 8 blocks, there are 3-4 checks before melee, giving reliable abort time.
              // Skeletons shoot from 16 blocks but deal less damage per hit (2-5 vs 3-6);
              // the HP-drop check catches ranged damage. This check focuses on melee approach.
              if (midWaitClosestDist <= 8) {
                if (logs.length < MAX_LOG_LINES) {
                  logs.push(`[wait] ABORTED: ${midWaitClosestName} approaching (${midWaitClosestDist.toFixed(1)} blocks) — auto-fleeing before attack`);
                }
                try {
                  await mc_flee(15);
                  if (logs.length < MAX_LOG_LINES) {
                    logs.push(`[wait] Auto-fled from approaching ${midWaitClosestName} (HP now: ${(waitBot.health ?? 0).toFixed(1)})`);
                  }
                } catch (fleeErr) {
                  if (logs.length < MAX_LOG_LINES) {
                    logs.push(`[wait] Auto-flee failed: ${fleeErr}`);
                  }
                }
                doResolve();
                return;
              }
            }
            // Abort wait if bot is in water — drowning risk at ANY HP level.
            // Bot2 [2026-03-23]: previous threshold (HP<10) was too late; bot drowned
            // from HP 15.8 because abort didn't trigger until HP<10, leaving only ~4s.
            // Water contact always warrants immediate abort + emergency escape.
            // Check three Y levels: below feet (-0.5 for sinking), feet, and head (+1).
            // Bot2 [2026-03-23]: bot sank into water from an elevated position during wait.
            // Checking only feet and head missed partial submersion where the bot is standing
            // on a water surface block and slowly sinking. The below-feet check catches
            // "standing in shallow water" before the bot fully submerges.
            const feetBlock = waitBot.blockAt(waitBot.entity.position);
            const headBlock = waitBot.blockAt(waitBot.entity.position.offset(0, 1, 0));
            const belowBlock = waitBot.blockAt(waitBot.entity.position.offset(0, -0.5, 0));
            const isWater = (n: string | undefined) => n === "water" || n === "flowing_water";
            const inWater = isWater(feetBlock?.name) || isWater(headBlock?.name) || isWater(belowBlock?.name);
            // Also check oxygenLevel — Mineflayer exposes bot.oxygenLevel (max 300, decreases underwater).
            // ONLY check oxygenLevel when already in water (block check positive).
            // Bot2 [2026-03-23]: oxygenLevel returned 0 on land (Mineflayer version-dependent),
            // causing "[wait] ABORTED: oxygen depleting" on every check even at y=69 on solid
            // ground. This made bot.wait() completely non-functional — bots couldn't wait for
            // dawn, causing them to wander at night and die. The water block check (inWater) is
            // the reliable signal; oxygenLevel is only useful as a secondary confirmation when
            // already in water (catches edge cases where block check misses due to floating point).
            const oxygenLow = inWater && ((waitBot as any).oxygenLevel ?? 300) < 250;
            if (inWater || oxygenLow) {
              if (logs.length < MAX_LOG_LINES) {
                const reason = oxygenLow ? "oxygen depleting underwater" : "in water";
                logs.push(`[wait] ABORTED: ${reason} with HP=${hp.toFixed(1)} — drowning risk. Attempting emergency jump.`);
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
                for (let scanDist = 1; scanDist <= 10; scanDist++) {
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
                // Jump + forward to swim out.
                // Set jump FIRST — in water, jump makes the bot swim upward to the surface.
                // Without surfacing first, forward movement is ineffective (bot swims into
                // underwater terrain instead of toward land on the surface).
                // Bot2 [2026-03-23]: 5 cycles of forward+jump didn't exit water because
                // forward was set before jump, causing the bot to swim horizontally underwater
                // instead of surfacing first then swimming toward shore.
                // Increase swim attempts from 5 to 8 and duration per attempt from 400ms to 600ms.
                // Bot2 [2026-03-23]: 5 * 500ms = 2.5s of swimming was insufficient to exit
                // large water bodies in birch_forest biome. HP dropped 15.8→3.8→death between
                // wait() calls because the bot couldn't reach shore. 8 * 700ms = 5.6s gives
                // enough time to swim ~10 blocks (Minecraft swim speed ~1.8 blocks/s).
                let exitedWater = false;
                for (let jumpAttempt = 0; jumpAttempt < 8; jumpAttempt++) {
                  waitBot.setControlState("jump", true);
                  waitBot.setControlState("forward", true);
                  await new Promise(r => setTimeout(r, 600));
                  waitBot.setControlState("jump", false);
                  await new Promise(r => setTimeout(r, 100));
                  // Check if we exited water
                  const checkFeet = waitBot.blockAt(waitBot.entity.position);
                  const checkHead = waitBot.blockAt(waitBot.entity.position.offset(0, 1, 0));
                  if (!isWater(checkFeet?.name) && !isWater(checkHead?.name)) {
                    exitedWater = true;
                    break;
                  }
                }
                // Only clear control states if we exited water.
                // If still submerged, keep jump=true so the bot continues swimming upward
                // between wait() calls — clearing states would make the bot sink and drown.
                // Bot2 [2026-03-23]: clearControlStates() after failed swim stopped all
                // upward momentum, bot sank back from HP 9.8 to death between wait calls.
                if (exitedWater) {
                  waitBot.clearControlStates();
                } else {
                  // Swim escape failed — bot is still in water.
                  // Bot2 [2026-03-23]: 8 swim cycles didn't exit large water body in birch_forest.
                  // HP dropped 15.8→3.8→death between wait() calls because the agent couldn't
                  // react fast enough after wait() resolved. Simply keeping jump=true and hoping
                  // the agent calls flee() is insufficient — drowning deals 2 HP/s.
                  // Fix: use mc_flee() internally to pathfind out of the water body before
                  // resolving wait(). mc_flee uses the pathfinder with liquidCost=10000, which
                  // will find the shortest path to land. This takes ~2-5s but prevents death.
                  waitBot.clearControlStates();
                  if (logs.length < MAX_LOG_LINES) {
                    logs.push(`[wait] Swim escape failed — auto-fleeing to land via pathfinder.`);
                  }
                  try {
                    await mc_flee(10);
                  } catch (fleeErr) {
                    if (logs.length < MAX_LOG_LINES) {
                      logs.push(`[wait] Auto-flee from water failed: ${fleeErr}`);
                    }
                    // Last resort: keep jumping to stay near surface
                    try {
                      waitBot.setControlState("jump", true);
                      waitBot.setControlState("forward", false);
                    } catch { /* ignore */ }
                  }
                }
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
