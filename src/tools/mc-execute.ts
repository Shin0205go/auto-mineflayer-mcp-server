/**
 * mc_execute - Code Execution
 *
 * Agents write raw mineflayer JavaScript.
 * Exposed: bot (raw mineflayer), Movements, goals, Vec3, log(), wait(), getMessages()
 */

import { botManager } from "../bot-manager/index.js";
import { currentBotContext } from "../bot-manager/bot-core.js";
import { getSurroundings } from "../bot-manager/bot-info.js";
import pathfinderPkg from "mineflayer-pathfinder";
import { Vec3 } from "vec3";

// mineflayer-pathfinder default import: same approach as bot-core.ts
const { Movements, goals } = pathfinderPkg as any;
if (!goals) {
  console.error("[mc_execute] WARNING: pathfinder goals is undefined — check mineflayer-pathfinder export");
}

const MAX_TIMEOUT = 600_000;
const DEFAULT_TIMEOUT = 120_000;
const MAX_WAIT_MS = 30_000;
const MAX_LOG_LINES = 200;

export async function mc_execute(
  code: string,
  timeout: number = DEFAULT_TIMEOUT,
  username?: string
): Promise<string> {
  if (username && !currentBotContext.getStore()) {
    return currentBotContext.run(username, () => mc_execute(code, timeout, undefined));
  }
  const effectiveTimeout = Math.min(Math.max(timeout, 1000), MAX_TIMEOUT);
  const logs: string[] = [];
  const startTime = Date.now();

  // Wait for bot connection
  if (!botManager.isConnected()) {
    if (botManager.isDeathReconnectPending()) {
      console.error(`[mc_execute] death-reconnect pending — waiting up to 8s`);
      try { await botManager.waitForBot(8000); }
      catch { return `Error: death/respawn reconnect timed out after 8s.\n\nFailed after ${Date.now() - startTime}ms`; }
    } else {
      console.error(`[mc_execute] not connected — waiting up to 5s`);
      try { await botManager.waitForBot(5000); }
      catch { console.error(`[mc_execute] still not connected after 5s`); }
    }
  }

  const botUsername = botManager.requireSingleBot();
  const managed = botManager.getBotByUsername(botUsername);
  if (!managed) throw new Error("Bot not connected");
  const rawBot = managed.bot;

  // aborted flag — set true on timeout so wait() rejects, terminating zombie async functions
  let aborted = false;

  // Track all timer IDs created by agent code so they can be force-cleared on timeout/abort.
  // Without this, a rapid setInterval loop (e.g. findBlock in a tight loop) leaves zombie
  // timers running after execution ends, accumulating across calls and eventually crashing
  // the daemon via memory exhaustion or uncaughtException from stale callbacks.
  const trackedTimeouts = new Set<ReturnType<typeof setTimeout>>();
  const trackedIntervals = new Set<ReturnType<typeof setInterval>>();

  const sandboxSetTimeout = (fn: (...args: any[]) => void, ms?: number, ...args: any[]): ReturnType<typeof setTimeout> => {
    const id = setTimeout((...a: any[]) => {
      trackedTimeouts.delete(id);
      fn(...a);
    }, ms, ...args);
    trackedTimeouts.add(id);
    return id;
  };
  const sandboxClearTimeout = (id?: ReturnType<typeof setTimeout>) => {
    if (id !== undefined) trackedTimeouts.delete(id);
    clearTimeout(id);
  };
  const sandboxSetInterval = (fn: (...args: any[]) => void, ms?: number, ...args: any[]): ReturnType<typeof setInterval> => {
    const id = setInterval(fn, ms, ...args);
    trackedIntervals.add(id);
    return id;
  };
  const sandboxClearInterval = (id?: ReturnType<typeof setInterval>) => {
    if (id !== undefined) trackedIntervals.delete(id);
    clearInterval(id);
  };

  const clearAllTrackedTimers = () => {
    for (const id of trackedTimeouts) clearTimeout(id);
    trackedTimeouts.clear();
    for (const id of trackedIntervals) clearInterval(id);
    trackedIntervals.clear();
  };

  const logFn = (message: unknown) => { if (logs.length < MAX_LOG_LINES) logs.push(String(message)); };
  const waitFn = (ms: number) => new Promise<void>((resolve, reject) => {
    if (aborted) { reject(new Error("Execution aborted")); return; }
    const timer = setTimeout(() => {
      if (aborted) reject(new Error("Execution aborted"));
      else resolve();
    }, Math.min(ms, MAX_WAIT_MS));
    // Store timer so it can be cleared (optional, not strictly needed)
    void timer;
  });
  const getMessagesFn = () => botManager.getChatMessages(botUsername, true);

  // Shared helper: goto with hard timeout + position-lock (stuck) detection.
  // Used by pathfinderGoto and multiStagePathfind to avoid silent hangs.
  //
  // Grace period: pathfinder spends the first several seconds computing the path
  // before the bot starts moving. On isolated platforms (Y=95) or complex terrain
  // this can take 10-15 seconds. Without a grace period, stuck detection fires
  // during path computation and calls setGoal(null), producing the
  // "goal was changed before it could be completed" error on short moves.
  //
  // Logic: stuck detection only activates after the bot has moved at least once
  // (moved >= STUCK_THRESHOLD from start position), OR after GRACE_PERIOD_MS has
  // elapsed. This prevents false aborts during path computation while still
  // catching genuine post-movement stuck conditions.
  const gotoWithStuckDetection = (goal: any, timeoutMs: number, allowDig: boolean): Promise<void> => {
    try {
      if (rawBot.pathfinder?.movements) {
        rawBot.pathfinder.movements.canDig = allowDig;
        (rawBot.pathfinder.movements as any).liquidCost = 10000;
      }
    } catch { /* ignore */ }

    const gotoPromise = (rawBot.pathfinder.goto as any)(goal);

    const STUCK_INTERVAL = 5000;
    const STUCK_THRESHOLD = 0.5;
    const MAX_STUCK_CHECKS = 2;
    // Grace period: don't start stuck-counting until bot has moved, or this many
    // ms have elapsed (covers slow path-computation on complex terrain).
    // Use thinkTimeout as the floor: on retry thinkTimeout is doubled (40s), so
    // GRACE_PERIOD_MS must also account for that to avoid false stuck detection
    // during path computation. Add 5s buffer on top of thinkTimeout.
    const currentThinkTimeout = (rawBot.pathfinder as any)?.thinkTimeout ?? 20000;
    const GRACE_PERIOD_MS = Math.max(currentThinkTimeout + 5000, 25000);
    const startTime = Date.now();
    let startPos = rawBot.entity.position.clone();
    let hasMovedOnce = false;
    let lastPos = rawBot.entity.position.clone();
    let stuckCount = 0;
    let stuckCheckTimer: ReturnType<typeof setInterval> | null = null;

    return new Promise<void>((resolve, reject) => {
      // Pathfinder silently resolves (instead of rejecting) when it cannot find a path.
      // We listen for path_update with status=noPath and reject explicitly so that
      // the canDig=true retry logic in pathfinderGoto is triggered correctly.
      const onPathUpdate = (result: any) => {
        if (result?.status === 'noPath') {
          rawBot.removeListener('path_update', onPathUpdate);
          cleanup();
          clearTimeout(hardTimeoutId);
          try { rawBot.pathfinder.setGoal(null); } catch { /* ignore */ }
          reject(new Error('No path to the goal!'));
        }
      };
      rawBot.on('path_update', onPathUpdate);

      const cleanup = () => {
        if (stuckCheckTimer !== null) { clearInterval(stuckCheckTimer); stuckCheckTimer = null; }
        rawBot.removeListener('path_update', onPathUpdate);
      };

      stuckCheckTimer = setInterval(() => {
        const currentPos = rawBot.entity.position;

        // Detect first movement from start position (pathfinder started moving)
        if (!hasMovedOnce && currentPos.distanceTo(startPos) >= STUCK_THRESHOLD) {
          hasMovedOnce = true;
        }

        // Only apply stuck detection after grace period has elapsed OR bot has moved
        const graceElapsed = Date.now() - startTime >= GRACE_PERIOD_MS;
        if (!hasMovedOnce && !graceElapsed) {
          // Still in grace period — update lastPos so we don't count pre-move time
          lastPos = currentPos.clone();
          return;
        }

        const moved = currentPos.distanceTo(lastPos);
        if (moved < STUCK_THRESHOLD) {
          stuckCount++;
          if (stuckCount >= MAX_STUCK_CHECKS) {
            cleanup();
            try { rawBot.pathfinder.setGoal(null); } catch { /* ignore */ }
            reject(new Error(`Pathfinder stuck: position unchanged for ${STUCK_INTERVAL * MAX_STUCK_CHECKS}ms`));
          }
        } else {
          stuckCount = 0;
          lastPos = currentPos.clone();
        }
      }, STUCK_INTERVAL);

      const hardTimeoutId = setTimeout(() => {
        cleanup();
        try { rawBot.pathfinder.setGoal(null); } catch { /* ignore */ }
        reject(new Error(`Pathfinder timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      gotoPromise.then(
        (val: unknown) => { cleanup(); clearTimeout(hardTimeoutId); resolve(val as void); },
        (err: unknown) => { cleanup(); clearTimeout(hardTimeoutId); reject(err); }
      );
    });
  };

  // Wrap Movements constructor to catch the common mistake of passing bot.world
  // instead of bot. new Movements(bot.world) throws "Cannot read properties of
  // undefined (reading 'blocksByName')" because Movements expects the full bot object.
  const MovementsWrapped = function(this: any, botArg: any, ...rest: any[]) {
    if (botArg && !botArg.entity && !botArg.pathfinder) {
      // bot.world was likely passed — it lacks entity/pathfinder but has block methods
      throw new Error(
        "Movements(bot.world) is incorrect — pass the full bot object: new Movements(bot)\n" +
        "Example: const movements = new Movements(bot); bot.pathfinder.setMovements(movements);"
      );
    }
    return new (Movements as any)(botArg, ...rest);
  } as any;
  MovementsWrapped.prototype = Movements.prototype;

  const ctx: Record<string, unknown> = {
    bot: rawBot,
    Movements: MovementsWrapped,
    goals,
    Vec3,
    // Utilities
    log: logFn,
    wait: waitFn,
    getMessages: getMessagesFn,
    // Pathfinder timeout wrapper utility (usage: await pathfinderGoto(goal, 30000))
    // On "No path" / "Took too long" failure, automatically retries once with canDig=true.
    // On retry, thinkTimeout is temporarily doubled to give A* more time on complex terrain.
    pathfinderGoto: async (goal: any, timeoutMs = 30000) => {
      try {
        return await gotoWithStuckDetection(goal, timeoutMs, false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // On "No path" / think-timeout errors, retry with canDig=true as fallback for complex terrain.
        // "goal was changed" means the goal was overridden externally — retrying won't help, rethrow.
        if ((msg.includes("No path") || msg.includes("no path") || msg.includes("Took to long") || msg.includes("Took too long") || msg.includes("Pathfinder stuck")) && !msg.toLowerCase().includes("goal was changed")) {
          logFn(`[pathfinderGoto] Path failed (${msg.substring(0, 60)}), retrying with canDig=true`);
          // Temporarily double thinkTimeout so the A* search has more time on complex terrain.
          const prevThinkTimeout = (rawBot.pathfinder as any)?.thinkTimeout ?? 20000;
          try {
            if (rawBot.pathfinder) (rawBot.pathfinder as any).thinkTimeout = prevThinkTimeout * 2;
            return await gotoWithStuckDetection(goal, timeoutMs, true);
          } finally {
            // Restore original thinkTimeout and canDig=false after dig-enabled navigation
            try {
              if (rawBot.pathfinder) (rawBot.pathfinder as any).thinkTimeout = prevThinkTimeout;
              if (rawBot.pathfinder?.movements) rawBot.pathfinder.movements.canDig = false;
            } catch { /* ignore */ }
          }
        }
        throw err;
      }
    },
    // Multi-stage pathfind: break long distances into waypoints
    // Usage: await multiStagePathfind(targetX, targetZ, 10)
    multiStagePathfind: async (targetX: number, targetZ: number, stageDistance: number = 10) => {
      const startPos = rawBot.entity.position;
      const dx = targetX - startPos.x;
      const dz = targetZ - startPos.z;
      const totalDist = Math.sqrt(dx*dx + dz*dz);

      if (totalDist <= stageDistance) {
        // Close enough, just go directly
        return gotoWithStuckDetection(new goals.GoalXZ(targetX, targetZ), 20000, false);
      }

      // Calculate waypoints
      const numStages = Math.ceil(totalDist / stageDistance);
      logFn(`Multi-stage pathfind: ${totalDist.toFixed(1)} blocks in ${numStages} stages`);

      // Navigate each stage
      for (let i = 1; i <= numStages; i++) {
        const frac = i / numStages;
        const wpX = startPos.x + dx * frac;
        const wpZ = startPos.z + dz * frac;

        logFn(`Stage ${i}/${numStages}: (${Math.floor(wpX)}, ${Math.floor(wpZ)})`);

        try {
          await gotoWithStuckDetection(new goals.GoalXZ(wpX, wpZ), 20000, false);
        } catch (e) {
          logFn(`Stage ${i} failed: ${String(e).substring(0, 60)}`);
          throw e;
        }
      }
    },
    // === Safe block placement (bypasses blockUpdate timeout) ===
    // Usage: await safePlaceBlock(referenceBlock, faceVector)
    // Uses raw packet directly (~50ms vs 5000ms timeout), then syncs client block cache
    safePlaceBlock: async (referenceBlock: any, faceVector: any) => {
      const pos = referenceBlock.position;
      const direction = faceVector.y === 1 ? 1 : faceVector.y === -1 ? 0 : faceVector.x === 1 ? 5 : faceVector.x === -1 ? 4 : faceVector.z === 1 ? 3 : 2;

      // Ensure we're looking at the target block
      await rawBot.lookAt(pos.offset(0.5, 0.5, 0.5), true);

      // Wait for server block_change to sync client cache (with timeout)
      const placePos = pos.offset(faceVector.x, faceVector.y, faceVector.z);
      const syncPromise = new Promise<void>(resolve => {
        const onBlockUpdate = (oldBlock: any, newBlock: any) => {
          if (newBlock.position.x === placePos.x &&
              newBlock.position.y === placePos.y &&
              newBlock.position.z === placePos.z &&
              newBlock.name !== "air") {
            rawBot.removeListener("blockUpdate", onBlockUpdate);
            resolve();
          }
        };
        rawBot.on("blockUpdate", onBlockUpdate);
        // Timeout: resolve anyway after 300ms
        setTimeout(() => {
          rawBot.removeListener("blockUpdate", onBlockUpdate);
          resolve();
        }, 300);
      });

      // Send raw packet (avoids mineflayer's 5s blockUpdate wait)
      (rawBot as any)._client.write("block_place", {
        location: { x: pos.x, y: pos.y, z: pos.z },
        direction,
        hand: 0,
        cursorX: 0.5,
        cursorY: faceVector.y === 1 ? 1.0 : 0.5,
        cursorZ: 0.5,
        insideBlock: false,
      });

      await syncPromise;
    },
    // === Reliable eat function (bypasses bot.consume() entity_status timeout) ===
    // bot.consume() depends on the server sending entity_status=9 within 2500ms.
    // On high-latency or laggy servers this packet arrives late or is missed,
    // causing "Promise timed out" errors that make food consumption impossible.
    //
    // eat() uses activateItem() via raw use_item packet + waits for the "health" event
    // (mineflayer fires this when food/saturation changes) with a 3500ms fallback.
    // This is reliable regardless of entity_status packet delivery.
    //
    // Usage: await eat()   — eats heldItem (equip the food first with bot.equip)
    eat: async () => {
      // Find and equip food automatically
      const foodNames = [
        "golden_apple", "enchanted_golden_apple",
        "cooked_beef", "cooked_porkchop", "cooked_mutton", "cooked_chicken",
        "cooked_rabbit", "cooked_cod", "cooked_salmon",
        "bread", "baked_potato", "pumpkin_pie", "cookie",
        "melon_slice", "sweet_berries", "apple", "carrot",
        "dried_kelp", "beetroot", "potato", "rotten_flesh",
      ];
      let food = rawBot.heldItem && foodNames.includes(rawBot.heldItem.name)
        ? rawBot.heldItem
        : null;
      if (!food) {
        for (const name of foodNames) {
          food = rawBot.inventory.items().find((i: any) => i.name === name) ?? null;
          if (food) break;
        }
      }
      if (!food) throw new Error("No food in inventory");
      await rawBot.equip(food, "hand");

      const itemName = food.name;
      const foodBefore = rawBot.food;

      // Start eating using activateItem (holds use button)
      rawBot.activateItem(false);

      // Wait for food event or timeout (eating takes ~1.61s)
      const eatDone = new Promise<boolean>(resolve => {
        const onFoodChange = () => {
          rawBot.removeListener("health" as any, onFoodChange);
          resolve(true);
        };
        rawBot.on("health" as any, onFoodChange);
        setTimeout(() => {
          rawBot.removeListener("health" as any, onFoodChange);
          resolve(false);
        }, 3500);
      });

      const changed = await eatDone;

      // Stop eating
      rawBot.deactivateItem();

      const foodAfter = rawBot.food;
      logFn(`[eat] ${itemName}: food ${foodBefore} → ${foodAfter}${changed ? "" : " (timeout)"}`);
      return { item: itemName, foodBefore, foodAfter };
    },

    // === Water escape utility ===
    // Usage: const result = await escapeWater()
    // Holds jump + moves toward nearest non-water block to escape water traps.
    // Returns a summary of what happened (surfaced, reached land, or still in water).
    // Call this when bot.entity.position foot=water and pathfinderGoto is unreliable.
    escapeWater: async () => {
      const isWater = (name: string | undefined) => name === "water" || name === "flowing_water";

      const feetBlock = rawBot.blockAt(rawBot.entity.position.floored());
      const headBlock = rawBot.blockAt(rawBot.entity.position.floored().offset(0, 1, 0));
      const startInWater = isWater(feetBlock?.name) || isWater(headBlock?.name);

      if (!startInWater) {
        return "Not in water — no escape needed";
      }

      const startPos = rawBot.entity.position.clone();
      logFn(`[escapeWater] In water at (${startPos.x.toFixed(1)}, ${startPos.y.toFixed(1)}, ${startPos.z.toFixed(1)}). Starting escape.`);

      // Phase 1: Swim up by holding jump for up to 5s
      rawBot.setControlState("jump", true);
      rawBot.setControlState("sprint", true);

      let surfaced = false;
      for (let i = 0; i < 25; i++) {
        await new Promise<void>(r => setTimeout(r, 200));
        const check = rawBot.blockAt(rawBot.entity.position.floored().offset(0, 1, 0));
        if (!isWater(check?.name)) {
          surfaced = true;
          break;
        }
      }

      rawBot.setControlState("jump", false);
      rawBot.setControlState("sprint", false);

      const afterSwimPos = rawBot.entity.position;
      const feetAfter = rawBot.blockAt(afterSwimPos.floored());
      const stillInWater = isWater(feetAfter?.name);

      if (!stillInWater) {
        logFn(`[escapeWater] Surfaced. Now at (${afterSwimPos.x.toFixed(1)}, ${afterSwimPos.y.toFixed(1)}, ${afterSwimPos.z.toFixed(1)})`);

        // Phase 2: Navigate toward land (non-water block at feet+1 level)
        // Search nearby XZ for a land position
        let landX = afterSwimPos.x, landZ = afterSwimPos.z;
        let foundLand = false;
        for (let r = 2; r <= 8 && !foundLand; r++) {
          for (let dx = -r; dx <= r && !foundLand; dx++) {
            for (let dz = -r; dz <= r && !foundLand; dz++) {
              if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
              const checkPos = afterSwimPos.floored().offset(dx, 0, dz);
              const landFeet = rawBot.blockAt(checkPos);
              const landHead = rawBot.blockAt(checkPos.offset(0, 1, 0));
              if (landFeet && !isWater(landFeet.name) && landFeet.name !== "air" &&
                  landHead && (landHead.name === "air" || isWater(landHead.name))) {
                // Solid ground with passable space above
                landX = checkPos.x + 0.5;
                landZ = checkPos.z + 0.5;
                foundLand = true;
              }
            }
          }
        }

        if (foundLand) {
          try {
            if (rawBot.pathfinder?.movements) {
              rawBot.pathfinder.movements.canDig = false;
              (rawBot.pathfinder.movements as any).liquidCost = 10000;
            }
            const goal = new goals.GoalNear(landX, Math.round(afterSwimPos.y), landZ, 1);
            await Promise.race([
              (rawBot.pathfinder.goto as any)(goal),
              new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000))
            ]);
          } catch { /* ignore pathfinder errors — we're on surface, which is the main goal */ }
        }
      }

      const finalPos = rawBot.entity.position;
      const finalFeet = rawBot.blockAt(finalPos.floored());
      const finalInWater = isWater(finalFeet?.name);

      if (finalInWater) {
        return `Still in water at (${finalPos.x.toFixed(1)}, ${finalPos.y.toFixed(1)}, ${finalPos.z.toFixed(1)}). Try digging sideways or placing blocks to escape.`;
      }

      return `Escaped water. Now at (${finalPos.x.toFixed(1)}, ${finalPos.y.toFixed(1)}, ${finalPos.z.toFixed(1)}) on ${finalFeet?.name ?? "unknown"}.`;
    },

    // === Meta-cognition layer: observe → understand → act ===
    // awareness() — self-state + spatial snapshot (call before any action)
    awareness: () => {
      return getSurroundings(rawBot);
    },
    // scan3D(radius?, heightRange?) — 3D spatial scan with layer views
    // Shows XZ slices at multiple Y levels + cavity/wall analysis
    scan3D: (radius: number = 5, heightRange: number = 4) => {
      const r = Math.min(radius, 10);
      const hr = Math.min(heightRange, 8);
      const pos = rawBot.entity.position;
      const cx = Math.floor(pos.x);
      const cy = Math.floor(pos.y);
      const cz = Math.floor(pos.z);

      // Block character map for compact display
      const charOf = (name: string | undefined): string => {
        if (!name || name === "air" || name === "cave_air") return " ";
        if (name === "water") return "~";
        if (name === "lava") return "!";
        if (name.includes("log") || name.includes("wood")) return "T";
        if (name.includes("leaves")) return "L";
        if (name.includes("ore")) return "*";
        if (name === "chest") return "C";
        if (name === "crafting_table") return "W";
        if (name === "furnace") return "F";
        if (name.includes("torch")) return "t";
        if (name === "grass_block" || name === "dirt") return ".";
        if (name === "stone" || name.includes("deepslate")) return "#";
        if (name === "sand" || name === "gravel") return ":";
        return "█";
      };

      const lines: string[] = [];
      lines.push(`## 3Dスキャン (${2*r+1}x${2*r+1}, Y=${cy-hr}~${cy+hr}, 中心: ${cx},${cy},${cz})`);
      lines.push(`凡例:  =空気 ~=水 !=溶岩 #=石 .=土 T=木 *=鉱石 █=固体 @=自分`);
      lines.push(``);

      // Scan all blocks into 3D array
      const blocks: Record<string, string> = {};
      for (let dy = -hr; dy <= hr; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            const block = rawBot.blockAt(new Vec3(cx + dx, cy + dy, cz + dz));
            blocks[`${dx},${dy},${dz}`] = block?.name || "air";
          }
        }
      }

      // Key Y layers: below feet, feet, head, above head
      const keyLayers = [
        { dy: -2, label: "足元-2 (地下)" },
        { dy: -1, label: "足元-1 (直下)" },
        { dy: 0,  label: "足元 (Y=" + cy + ")" },
        { dy: 1,  label: "頭 (Y=" + (cy+1) + ")" },
        { dy: 2,  label: "頭上+1" },
      ].filter(l => l.dy >= -hr && l.dy <= hr);

      for (const layer of keyLayers) {
        lines.push(`### ${layer.label}`);
        // Header row with Z offsets
        let header = "    ";
        for (let dz = -r; dz <= r; dz++) {
          header += dz === 0 ? "V" : (Math.abs(dz) <= 1 ? String(dz) : (dz % 2 === 0 ? String(Math.abs(dz) % 10) : " "));
        }
        lines.push(header);

        for (let dx = -r; dx <= r; dx++) {
          const prefix = dx === 0 ? " >" : "  ";
          let row = prefix + String(dx).padStart(2) + " ";
          for (let dz = -r; dz <= r; dz++) {
            if (dx === 0 && dz === 0 && layer.dy === 0) {
              row += "@";  // Bot position
            } else {
              const name = blocks[`${dx},${layer.dy},${dz}`];
              row += charOf(name);
            }
          }
          lines.push(row);
        }
        lines.push(``);
      }

      // === 3D structural analysis ===
      lines.push(`### 構造分析`);

      // Cavity detection: air blocks below feet level
      const cavities: string[] = [];
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          // Check if ground has cavity (air below the top solid block)
          const groundName = blocks[`${dx},-1,${dz}`];
          const belowGround = blocks[`${dx},-2,${dz}`];
          if (groundName && groundName !== "air" && groundName !== "cave_air" &&
              belowGround && (belowGround === "air" || belowGround === "cave_air")) {
            const dist = Math.sqrt(dx*dx + dz*dz);
            if (dist <= r) {
              cavities.push(`(${cx+dx},${cy-2},${cz+dz})`);
            }
          }
        }
      }
      if (cavities.length > 0) {
        lines.push(`空洞 (足元-2に空気): ${cavities.length}箇所${cavities.length <= 5 ? " " + cavities.join(" ") : ""}`);
      }

      // Drop risk: air below feet at bot's walking level
      const dropRisks: string[] = [];
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const atFeet = blocks[`${dx},0,${dz}`];
          const belowFeet = blocks[`${dx},-1,${dz}`];
          if ((atFeet === "air" || atFeet === "cave_air") &&
              (belowFeet === "air" || belowFeet === "cave_air")) {
            const dist = Math.sqrt(dx*dx + dz*dz);
            if (dist <= r && dist > 0) {
              dropRisks.push(`(${cx+dx},${cz+dz})`);
            }
          }
        }
      }
      if (dropRisks.length > 0) {
        lines.push(`落下リスク (穴): ${dropRisks.length}箇所${dropRisks.length <= 5 ? " " + dropRisks.join(" ") : ""}`);
      }

      // Wall thickness in 4 cardinal directions
      const wallDirs = [
        { name: "北(Z-)", dx: 0, dz: -1 },
        { name: "南(Z+)", dx: 0, dz: 1 },
        { name: "東(X+)", dx: 1, dz: 0 },
        { name: "西(X-)", dx: -1, dz: 0 },
      ];
      const wallInfo: string[] = [];
      for (const dir of wallDirs) {
        let thickness = 0;
        let hitSolid = false;
        for (let i = 1; i <= r; i++) {
          const feetBlock = blocks[`${dir.dx * i},0,${dir.dz * i}`];
          const headBlock = blocks[`${dir.dx * i},1,${dir.dz * i}`];
          const isPassable = (!feetBlock || feetBlock === "air" || feetBlock === "water") &&
                             (!headBlock || headBlock === "air" || headBlock === "water");
          if (!isPassable && !hitSolid) {
            hitSolid = true;
            thickness = 1;
          } else if (!isPassable && hitSolid) {
            thickness++;
          } else if (isPassable && hitSolid) {
            break; // Wall ended
          }
        }
        if (hitSolid) {
          wallInfo.push(`${dir.name}:壁${thickness}ブロック`);
        } else {
          wallInfo.push(`${dir.name}:通路`);
        }
      }
      lines.push(`壁: ${wallInfo.join(", ")}`);

      // Height map for terrain leveling (surface Y per XZ)
      lines.push(``);
      lines.push(`### 高さマップ (整地用)`);
      let totalTopY = 0, topCount = 0;
      let surfMinY = 999, surfMaxY = -999;
      const surfHeights: Record<string, number> = {};
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dy = hr; dy >= -hr; dy--) {
            const name = blocks[`${dx},${dy},${dz}`];
            if (name && name !== "air" && name !== "cave_air" && name !== "water" && name !== "lava") {
              const absY = cy + dy;
              surfHeights[`${dx},${dz}`] = absY;
              totalTopY += absY;
              topCount++;
              if (absY < surfMinY) surfMinY = absY;
              if (absY > surfMaxY) surfMaxY = absY;
              break;
            }
          }
        }
      }
      const avgY = topCount > 0 ? Math.round(totalTopY / topCount) : cy;
      let toDig = 0, toFill = 0;
      for (const [, y] of Object.entries(surfHeights)) {
        if (y > avgY) toDig += (y - avgY);
        if (y < avgY) toFill += (avgY - y);
      }
      lines.push(`平均Y: ${avgY}, 高低差: ${surfMaxY - surfMinY}, 掘る: ${toDig}, 埋める: ${toFill}`);

      return lines.join("\n");
    },

    // === pillarUp — build a pillar under the bot to gain height ===
    // Usage: const result = await pillarUp(height?)  — default height=4
    // Builds a column of cobblestone/dirt directly below the bot while jumping.
    // Each block is placed via raw packet (no blockUpdate timeout) with a 300ms fallback.
    // Returns a summary of blocks placed and final Y position.
    // Note: bot.pillarUp() does NOT exist on the mineflayer Bot directly — use this helper.
    pillarUp: async (height: number = 4) => {
      const h = Math.min(Math.max(1, height), 20); // clamp 1-20
      const SCAFFOLD_NAMES = ["cobblestone", "dirt", "stone", "gravel", "sand", "oak_planks",
                              "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks",
                              "dark_oak_planks", "netherrack", "cobbled_deepslate"];
      let placed = 0;
      const startY = Math.floor(rawBot.entity.position.y);

      for (let i = 0; i < h; i++) {
        // Find scaffold material
        const block = rawBot.inventory.items().find((item: any) => SCAFFOLD_NAMES.includes(item.name));
        if (!block) {
          logFn(`[pillarUp] No scaffold blocks in inventory after placing ${placed}`);
          break;
        }
        await rawBot.equip(block, "hand");

        // Jump first so the bot rises above the block it will stand on
        rawBot.setControlState("jump", true);
        await new Promise<void>(r => setTimeout(r, 250));
        rawBot.setControlState("jump", false);

        // Place block at feet level using raw packet (avoids 5s blockUpdate timeout)
        const feetPos = rawBot.entity.position.floored();
        const groundPos = feetPos.offset(0, -1, 0);

        const syncP = new Promise<void>(resolve => {
          const handler = (_o: any, n: any) => {
            if (n.position.x === feetPos.x && n.position.y === feetPos.y && n.position.z === feetPos.z && n.name !== "air") {
              rawBot.removeListener("blockUpdate", handler);
              resolve();
            }
          };
          rawBot.on("blockUpdate", handler);
          setTimeout(() => { rawBot.removeListener("blockUpdate", handler); resolve(); }, 300);
        });

        await rawBot.lookAt(groundPos.offset(0.5, 0.5, 0.5), true);
        (rawBot as any)._client.write("block_place", {
          location: { x: groundPos.x, y: groundPos.y, z: groundPos.z },
          direction: 1, // top face
          hand: 0,
          cursorX: 0.5, cursorY: 1.0, cursorZ: 0.5,
          insideBlock: false,
        });
        await syncP;
        placed++;

        // Short wait for physics to settle (bot rises to stand on placed block)
        await new Promise<void>(r => setTimeout(r, 150));
      }

      const finalY = Math.floor(rawBot.entity.position.y);
      logFn(`[pillarUp] Placed ${placed}/${h} blocks, Y ${startY} → ${finalY}`);
      return { placed, startY, finalY };
    },

    // === Terrain management: fill holes within radius ===
    // Usage: const count = await fillHoles(radius?)  — default radius=6
    // Scans for fall-risk positions (air+air below at foot level) and fills with cobblestone/dirt
    // Only fills blocks within placement reach (4.5 blocks). Skips unreachable holes.
    fillHoles: async (radius: number = 6) => {
      const MAX_PLACE_DIST = 4.5;
      const r = Math.min(radius, 10);
      const pos = rawBot.entity.position;
      const cx = Math.floor(pos.x);
      const cy = Math.floor(pos.y);
      const cz = Math.floor(pos.z);
      let filled = 0;
      let skippedFar = 0;

      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dz === 0) continue;
          // Check foot level: air + air below = fall risk
          const atFeet = rawBot.blockAt(new Vec3(cx + dx, cy, cz + dz));
          const below = rawBot.blockAt(new Vec3(cx + dx, cy - 1, cz + dz));
          if (!atFeet || !below) continue;
          if ((atFeet.name !== "air" && atFeet.name !== "cave_air") ||
              (below.name !== "air" && below.name !== "cave_air")) continue;

          // Find support: first solid block going down from foot-1
          let supportY = cy - 2;
          while (supportY > cy - 10) {
            const s = rawBot.blockAt(new Vec3(cx + dx, supportY, cz + dz));
            if (s && s.name !== "air" && s.name !== "cave_air" && s.name !== "water") break;
            supportY--;
          }

          // Fill from support up to foot level
          for (let fy = supportY; fy < cy; fy++) {
            const base = rawBot.blockAt(new Vec3(cx + dx, fy, cz + dz));
            const above = rawBot.blockAt(new Vec3(cx + dx, fy + 1, cz + dz));
            if (!base || !above) continue;
            if (base.name === "air" || base.name === "cave_air") continue;
            if (above.name !== "air" && above.name !== "cave_air") continue;

            // Distance check: server rejects placement beyond ~4.5 blocks
            const blockCenter = base.position.offset(0.5, 1.5, 0.5); // center of placement target
            const dist = blockCenter.distanceTo(rawBot.entity.position);
            if (dist > MAX_PLACE_DIST) { skippedFar++; continue; }

            const cobble = rawBot.inventory.items().find((i: any) => i.name === "cobblestone" || i.name === "dirt");
            if (!cobble) { logFn("[fillHoles] Out of fill material"); return filled; }

            await rawBot.equip(cobble, "hand");
            // Use safePlaceBlock logic (raw packet + sync)
            const bPos = base.position;
            await rawBot.lookAt(bPos.offset(0.5, 0.5, 0.5), true);
            const syncP = new Promise<void>(resolve => {
              const handler = (_o: any, n: any) => {
                if (n.position.x === bPos.x && n.position.y === bPos.y + 1 && n.position.z === bPos.z && n.name !== "air") {
                  rawBot.removeListener("blockUpdate", handler);
                  resolve();
                }
              };
              rawBot.on("blockUpdate", handler);
              setTimeout(() => { rawBot.removeListener("blockUpdate", handler); resolve(); }, 300);
            });
            (rawBot as any)._client.write("block_place", {
              location: { x: bPos.x, y: bPos.y, z: bPos.z },
              direction: 1, hand: 0,
              cursorX: 0.5, cursorY: 1.0, cursorZ: 0.5, insideBlock: false,
            });
            await syncP;
            filled++;
          }
        }
      }
      logFn(`[fillHoles] Filled ${filled} blocks, skipped ${skippedFar} out-of-reach (radius ${r})`);
      return filled;
    },

    // === collectDrops — pick up dropped items near the bot ===
    // Call after bot.dig() or bot.attack() to collect entity drops.
    // Usage: const result = await collectDrops(radius?)  — default radius=8
    // Returns a summary string with item counts.
    collectDrops: async (radius: number = 8) => {
      const r = Math.min(radius, 20);
      const NON_ITEM_OBJECTS = new Set([
        "boat", "chest_boat", "oak_boat", "spruce_boat", "birch_boat", "jungle_boat",
        "acacia_boat", "dark_oak_boat", "minecart", "chest_minecart", "furnace_minecart",
        "tnt_minecart", "hopper_minecart", "tnt", "falling_block", "armor_stand",
        "item_frame", "glow_item_frame", "painting", "end_crystal", "fishing_bobber",
        "firework_rocket", "eye_of_ender", "thrown_item",
      ]);
      const findDrops = () => Object.values(rawBot.entities).filter((e: any) => {
        if (!e || e === rawBot.entity || !e.position) return false;
        if (e.position.distanceTo(rawBot.entity.position) > r) return false;
        return e.name === "item" ||
          e.displayName === "Item" || e.displayName === "Dropped Item" ||
          (e.type === "object" && !NON_ITEM_OBJECTS.has(e.name || "")) ||
          (e.type === "other" && e.name === "item");
      });

      const inventoryBefore = rawBot.inventory.items().reduce((s: number, i: any) => s + i.count, 0);

      // Wait up to 4s for drops to appear (server may delay spawning drop entities)
      let drops = findDrops();
      for (let t = 0; t < 8 && drops.length === 0; t++) {
        await new Promise<void>(resolve => setTimeout(resolve, 500));
        drops = findDrops();
      }

      if (drops.length === 0) {
        return "collectDrops: no drops found nearby";
      }

      // Navigate to each drop and pick up
      let collected = 0;
      for (const drop of drops.slice(0, 12)) {
        if (!drop.position) continue;
        const dist = drop.position.distanceTo(rawBot.entity.position);
        if (dist > 1.5) {
          // Move close enough for auto-pickup (within 1.5 blocks)
          try {
            const goal = new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1);
            await Promise.race([
              (rawBot.pathfinder.goto as any)(goal),
              new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
            ]);
          } catch { /* item may have already been picked up or moved */ }
        }
        // Short wait for auto-pickup
        await new Promise<void>(resolve => setTimeout(resolve, 200));
        collected++;
      }

      const inventoryAfter = rawBot.inventory.items().reduce((s: number, i: any) => s + i.count, 0);
      const gained = inventoryAfter - inventoryBefore;
      logFn(`[collectDrops] Approached ${collected} drops, inventory +${gained} items`);
      return `collectDrops: approached ${collected} drops, gained ${gained} items`;
    },

    // === smeltItems — open furnace and smelt with fuel ===
    // Usage: await smeltItems(furnaceBlock, inputItem, fuelItem, count?)
    // furnaceBlock must be obtained via bot.findBlock({ matching: furnaceId, maxDistance: N })
    // Returns a summary of what was smelted.
    // NOTE: bot.openContainer() does NOT work for furnaces — use bot.openFurnace() directly.
    smeltItems: async (furnaceBlock: any, inputItemName: string, fuelItemName: string, count: number = 1) => {
      if (!furnaceBlock) throw new Error("smeltItems: furnaceBlock is null");

      // Verify position: must be within 4 blocks of furnace
      const dist = rawBot.entity.position.distanceTo(furnaceBlock.position);
      if (dist > 5) {
        throw new Error(`smeltItems: too far from furnace (${dist.toFixed(1)} blocks). Navigate closer first.`);
      }

      // Find items in inventory
      const inputItem = rawBot.inventory.items().find((i: any) => i.name === inputItemName);
      if (!inputItem) throw new Error(`smeltItems: no ${inputItemName} in inventory`);

      const fuelItem = rawBot.inventory.items().find((i: any) => i.name === fuelItemName);
      if (!fuelItem) throw new Error(`smeltItems: no ${fuelItemName} in inventory (fuel)`);

      // Pre-open the furnace GUI to avoid windowOpen timeout.
      // openFurnace() internally waits for the windowOpen event (up to 20s on laggy servers).
      // Register the windowOpen listener BEFORE calling activateBlock to prevent a race
      // where the event fires before the listener is attached.
      // Skip if a window is already open (e.g. leftover from a previous call).
      if (!rawBot.currentWindow) {
        try {
          const windowOpenPromise = new Promise<void>(resolve => {
            const onWindow = () => {
              rawBot.removeListener("windowOpen" as any, onWindow);
              resolve();
            };
            rawBot.on("windowOpen" as any, onWindow);
            setTimeout(() => {
              rawBot.removeListener("windowOpen" as any, onWindow);
              resolve();
            }, 1500);
          });
          await rawBot.activateBlock(furnaceBlock);
          await windowOpenPromise;
        } catch { /* ignore activateBlock errors — openFurnace will open it */ }
      }

      // Open furnace using the correct API (bot.openFurnace, NOT bot.openContainer)
      const furnace = await rawBot.openFurnace(furnaceBlock) as any;

      try {
        // Put fuel first, then input
        await furnace.putFuel(fuelItem.type, null, Math.min(fuelItem.count, 64));
        await furnace.putInput(inputItem.type, null, Math.min(count, inputItem.count));

        // Record output count before smelting begins (furnace may already have output from a
        // previous session — we must not treat pre-existing items as freshly smelted).
        const outputBefore = (furnace.outputItem()?.count ?? 0);
        const targetOutputCount = outputBefore + Math.min(count, inputItem.count);

        // Wait for smelting: 10s per item + 5s startup buffer.
        // Use targetOutputCount so pre-existing output does not cause early resolve.
        const waitMs = Math.min(count, inputItem.count) * 10000 + 5000;
        const smeltDone = new Promise<void>(resolve => {
          const check = () => {
            const out = furnace.outputItem();
            if (out && out.count >= targetOutputCount) {
              furnace.removeListener("update", check);
              resolve();
            }
          };
          furnace.on("update", check);
          setTimeout(() => { furnace.removeListener("update", check); resolve(); }, waitMs);
        });
        await smeltDone;

        // Take output
        const output = furnace.outputItem();
        const outputCount = output ? output.count : 0;
        if (output) await furnace.takeOutput();

        const smelted = Math.max(0, outputCount - outputBefore);
        logFn(`[smeltItems] Smelted ${inputItemName} x${smelted} with ${fuelItemName} → output: ${outputCount}`);
        return { input: inputItemName, fuel: fuelItemName, outputCount: smelted };
      } finally {
        furnace.close();
      }
    },

    // === plantSeeds — plant seeds on farmland blocks ===
    // Usage: await plantSeeds(farmlandBlock)
    // Must have seeds equipped or in inventory. Must be standing adjacent to farmland.
    // Correct mineflayer API: bot.equip(seedItem, 'hand') then bot.placeBlock(farmlandBlock, new Vec3(0,1,0))
    // NOTE: bot.place(), bot.interact(), bot.activate() do NOT exist in mineflayer.
    plantSeeds: async (farmlandBlock: any, seedItemName?: string) => {
      if (!farmlandBlock) throw new Error("plantSeeds: farmlandBlock is null");

      // Find seeds in inventory
      const seedNames = seedItemName
        ? [seedItemName]
        : ["wheat_seeds", "carrot", "potato", "beetroot_seeds", "melon_seeds", "pumpkin_seeds"];

      let seedItem: any = null;
      for (const name of seedNames) {
        seedItem = rawBot.inventory.items().find((i: any) => i.name === name);
        if (seedItem) break;
      }
      if (!seedItem) throw new Error(`plantSeeds: no seeds in inventory (tried: ${seedNames.join(", ")})`);

      // Equip seeds in hand
      await rawBot.equip(seedItem, "hand");

      // Must be within reach (3 blocks) to place
      const dist = rawBot.entity.position.distanceTo(farmlandBlock.position);
      if (dist > 4) {
        throw new Error(`plantSeeds: too far from farmland (${dist.toFixed(1)} blocks). Navigate closer first.`);
      }

      // Plant: place block on top face of farmland using raw packet to avoid
      // bot.placeBlock()'s 5-second blockUpdate timeout (server may not ack reliably).
      const fPos = farmlandBlock.position;
      const plantPos = fPos.offset(0, 1, 0);
      await rawBot.lookAt(fPos.offset(0.5, 1.0, 0.5), true);

      // Listen for blockUpdate at the target position (seed crop appears 1 block above farmland)
      const syncPromise = new Promise<void>(resolve => {
        const handler = (_o: any, n: any) => {
          if (n.position.x === plantPos.x && n.position.y === plantPos.y && n.position.z === plantPos.z) {
            rawBot.removeListener("blockUpdate", handler);
            resolve();
          }
        };
        rawBot.on("blockUpdate", handler);
        // Fallback: resolve after 500ms even if no blockUpdate arrives
        setTimeout(() => { rawBot.removeListener("blockUpdate", handler); resolve(); }, 500);
      });

      (rawBot as any)._client.write("block_place", {
        location: { x: fPos.x, y: fPos.y, z: fPos.z },
        direction: 1,   // top face
        hand: 0,
        cursorX: 0.5, cursorY: 1.0, cursorZ: 0.5,
        insideBlock: false,
      });
      await syncPromise;

      logFn(`[plantSeeds] Planted ${seedItem.name} on farmland at (${fPos.x}, ${fPos.y}, ${fPos.z})`);
      return { planted: seedItem.name, position: farmlandBlock.position };
    },

    // AutoSafety state (read-only from agent code)
    // Defined as a getter so agent always reads the latest live state object.
    // Without a getter, managed.safetyState would be captured as null if AutoSafety
    // had not yet assigned it at sandbox construction time (race condition on first call).
    get safetyState() { return managed.safetyState ?? null; },

    // === recipesFor wrapper ===
    // bot.recipesFor(id, null, 1, null) only returns 2x2 recipes when no table is passed.
    // This wrapper auto-finds a nearby crafting table and passes it, returning 3x3 recipes too.
    // Usage: const recipes = recipesFor(itemId)  — equivalent to bot.recipesFor but table-aware
    recipesFor: (itemId: number, metadata: any = null, count: number = 1) => {
      // First try without table (2x2 recipes)
      const recipesNoTable = rawBot.recipesFor(itemId, metadata, count, null);
      // Then try with nearby crafting table (3x3 recipes)
      const tableId = (rawBot.registry?.blocksByName as any)?.crafting_table?.id;
      const table = tableId
        ? rawBot.findBlock({ matching: tableId, maxDistance: 6 })
        : null;
      if (!table) return recipesNoTable;
      const recipesWithTable = rawBot.recipesFor(itemId, metadata, count, table);
      // Merge: prefer 3x3 if found, otherwise fall back to 2x2
      const seen = new Set<number>();
      const merged: any[] = [];
      for (const r of [...recipesWithTable, ...recipesNoTable]) {
        // Deduplicate by result id
        if (!seen.has(r.result?.id ?? -1)) {
          seen.add(r.result?.id ?? -1);
          merged.push(r);
        }
      }
      return merged;
    },

    // === craftWithTable — reliable crafting with crafting table ===
    // mineflayer's bot.craft() requires the crafting window to be open first.
    // Calling bot.craft(recipe, count, table) directly fails ~40% of the time with
    // "Event windowOpen did not fire within timeout of 20000ms" because the window
    // open is not always acknowledged before the craft call runs.
    //
    // Fix: activate the block first (opens the window), wait 200ms, then craft.
    // This reduces the windowOpen timeout failure rate to near-zero.
    //
    // Usage: await craftWithTable(itemName, count?)
    //   itemName: item to craft (e.g. "bread", "crafting_table", "wooden_pickaxe")
    //   count: how many to craft (default 1)
    // Returns: { crafted: itemName, count: number, tableUsed: boolean }
    craftWithTable: async (itemName: string, count: number = 1) => {
      const itemDef = (rawBot.registry?.itemsByName as any)?.[itemName];
      if (!itemDef) throw new Error(`craftWithTable: unknown item "${itemName}"`);

      // Find nearby crafting table (within 4 blocks)
      const tableId = (rawBot.registry?.blocksByName as any)?.crafting_table?.id;
      const table = tableId
        ? rawBot.findBlock({ matching: tableId, maxDistance: 4 })
        : null;

      // Get recipes (with table if available for 3x3)
      // NOTE: recipesFor's 3rd arg is minResultCount — a filter that checks whether the
      // bot has enough materials to craft that many times.  Passing `count` here causes
      // "no recipe found" whenever the bot has ingredients for fewer than `count` crafts.
      // We always pass 1 so the filter only checks "can I craft at least once?", then
      // let bot.craft(recipe, count, table) handle the repeated crafting loop.
      const recipes = table
        ? rawBot.recipesFor(itemDef.id, null, 1, table)
        : rawBot.recipesFor(itemDef.id, null, 1, null);
      if (!recipes || recipes.length === 0) {
        throw new Error(`craftWithTable: no recipe found for "${itemName}"${table ? " (with table)" : " (no table nearby)"}`);
      }
      const recipe = recipes[0];

      // If using a table, open it first to avoid windowOpen timeout.
      // Register the windowOpen listener BEFORE calling activateBlock to prevent
      // a race where the event fires before the listener is attached.
      if (table) {
        // Skip if window already open (e.g. leftover from previous call)
        if (!rawBot.currentWindow) {
          try {
            const windowOpenPromise = new Promise<void>(resolve => {
              const onWindow = () => {
                rawBot.removeListener("windowOpen" as any, onWindow);
                resolve();
              };
              rawBot.on("windowOpen" as any, onWindow);
              setTimeout(() => {
                rawBot.removeListener("windowOpen" as any, onWindow);
                resolve();
              }, 1500);
            });
            await rawBot.activateBlock(table);
            await windowOpenPromise;
          } catch { /* ignore activateBlock errors — bot.craft handles the window */ }
        }
      }

      // Craft
      const countBefore = rawBot.inventory.items().find((i: any) => i.name === itemName)?.count ?? 0;
      await rawBot.craft(recipe, count, table ?? undefined);

      // Recovery: bot.craft()'s grabResult() calls putAway(0) to collect the output, but
      // on laggy servers putAway(0) can arrive before the server confirms slot 0, leaving
      // the item stuck there.  Shift-click slot 0 to recover it.
      await new Promise<void>(r => setTimeout(r, 300));
      const resultSlot = rawBot.inventory.slots[0];
      if (resultSlot && resultSlot.count > 0) {
        try {
          await rawBot.clickWindow(0, 0, 1); // shift-click to move to inventory
          await new Promise<void>(r => setTimeout(r, 400));
          logFn(`[craftWithTable] Recovered ${resultSlot.name}×${resultSlot.count} from result slot`);
        } catch { /* ignore — may already have been moved */ }
      }
      // Also close the crafting window if it's still open (prevents inventory leak)
      if (table && rawBot.currentWindow) {
        try { rawBot.closeWindow(rawBot.currentWindow); } catch { /* ignore */ }
      }

      const countAfter = rawBot.inventory.items().find((i: any) => i.name === itemName)?.count ?? 0;
      const crafted = countAfter - countBefore;

      logFn(`[craftWithTable] Crafted ${itemName} x${crafted} (requested ${count}), table=${!!table}`);
      return { crafted: itemName, count: crafted, tableUsed: !!table };
    },

    // === openChest — reliable chest/barrel/shulker_box access ===
    // bot.openContainer() requires the windowOpen event within 20s or throws.
    // On laggy servers the window packet can be delayed, causing "Event windowOpen did
    // not fire within timeout of 20000ms".
    //
    // Fix (same pattern as craftWithTable): call activateBlock first to pre-open the
    // GUI, wait up to 1000ms for windowOpen, then call openContainer for the handle.
    //
    // Usage: const chest = await openChest(chestBlock)
    //   Returns: the chest window object (same as bot.openContainer())
    //   Use chest.containerItems() to list contents, chest.withdraw() / chest.deposit(),
    //   then await chest.close() when done.
    // Example:
    //   const chestId = bot.registry.blocksByName['chest'].id;
    //   const chestBlock = bot.findBlock({ matching: chestId, maxDistance: 5 });
    //   if (chestBlock) {
    //     await pathfinderGoto(new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2), 15000);
    //     const chest = await openChest(chestBlock);
    //     log(JSON.stringify(chest.containerItems().map(i => i.name)));
    //     await chest.close();
    //   }
    openChest: async (chestBlock: any) => {
      if (!chestBlock) throw new Error("openChest: chestBlock is null");

      // Pre-open the GUI to avoid windowOpen timeout.
      // Register the windowOpen listener BEFORE calling activateBlock to prevent a race
      // where the event fires before the listener is attached.
      // Skip if a window is already open.
      if (!rawBot.currentWindow) {
        try {
          const windowOpenPromise = new Promise<void>(resolve => {
            const onWindow = () => {
              rawBot.removeListener("windowOpen" as any, onWindow);
              resolve();
            };
            rawBot.on("windowOpen" as any, onWindow);
            setTimeout(() => {
              rawBot.removeListener("windowOpen" as any, onWindow);
              resolve();
            }, 1500);
          });
          await rawBot.activateBlock(chestBlock);
          await windowOpenPromise;
        } catch { /* ignore activateBlock errors — openContainer will open it */ }
      }

      // Open container for programmatic access
      const chest = await rawBot.openContainer(chestBlock);
      return chest;
    },

    // === enterPortal — stand in nether/end portal until dimension changes ===
    // Usage: const result = await enterPortal(timeoutMs?)  — default 30000ms
    //
    // Mineflayer does not have a dedicated portal-enter API.  The only reliable way
    // to teleport is to stand inside the portal block (nether_portal / end_portal)
    // and wait for the server to change the dimension.  This takes ~4 seconds
    // (the "portal delay" mechanic) after the bot walks into the portal block.
    //
    // Returns: { success: true, dimensionBefore, dimensionAfter } on teleport
    //          { success: false, reason: "timeout", ... } if dimension didn't change
    //
    // The bot must already be adjacent to / standing in the portal before calling.
    // Use pathfinderGoto(GoalBlock(px, py, pz)) to walk into the portal first.
    enterPortal: async (timeoutMs: number = 30000) => {
      const dimensionBefore = (rawBot.game as any)?.dimension ?? (rawBot as any).dimension ?? "unknown";

      // Detect portal block at bot feet/head position
      const feetBlock = rawBot.blockAt(rawBot.entity.position.floored());
      const headBlock = rawBot.blockAt(rawBot.entity.position.floored().offset(0, 1, 0));
      const inPortal =
        feetBlock?.name === "nether_portal" || feetBlock?.name === "end_portal" ||
        headBlock?.name === "nether_portal" || headBlock?.name === "end_portal";

      if (!inPortal) {
        // Attempt to walk into nearest portal block within 2 blocks
        const portalBlock =
          rawBot.findBlock({ matching: (b: any) => b.name === "nether_portal" || b.name === "end_portal", maxDistance: 3 });
        if (portalBlock) {
          logFn(`[enterPortal] Moving into portal block at (${portalBlock.position.x},${portalBlock.position.y},${portalBlock.position.z})`);
          try {
            await Promise.race([
              (rawBot.pathfinder.goto as any)(new goals.GoalBlock(portalBlock.position.x, portalBlock.position.y, portalBlock.position.z)),
              new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000))
            ]);
          } catch { /* may already be inside */ }
        }
      }

      // Hold forward to stay inside portal (prevents server from cancelling the teleport)
      rawBot.setControlState("forward", true);

      // Mineflayer fires "respawn" for dimension transitions (nether/end portal).
      // On some server versions the event may be delayed or named differently.
      // Fallback: poll bot.game.dimension every 500ms so we detect the change
      // even if the "respawn" event does not fire in time.
      const teleportDone = new Promise<string | null>(resolve => {
        let resolved = false;
        const done = (dim: string | null) => {
          if (resolved) return;
          resolved = true;
          rawBot.removeListener("respawn" as any, onRespawn);
          clearInterval(pollId);
          clearTimeout(timeoutId);
          resolve(dim);
        };

        const onRespawn = () => {
          const dim = (rawBot.game as any)?.dimension ?? (rawBot as any).dimension ?? "unknown";
          done(dim);
        };
        rawBot.on("respawn" as any, onRespawn);

        // Fallback poll: check if dimension changed every 500ms
        const pollId = setInterval(() => {
          const current = (rawBot.game as any)?.dimension ?? (rawBot as any).dimension ?? "unknown";
          if (current !== dimensionBefore) {
            done(current);
          }
        }, 500);

        const timeoutId = setTimeout(() => done(null), timeoutMs);
      });

      const dimensionAfter = await teleportDone;
      rawBot.setControlState("forward", false);

      if (dimensionAfter === null) {
        logFn(`[enterPortal] Timeout — dimension did not change after ${timeoutMs}ms`);
        return { success: false, reason: "timeout", dimensionBefore, dimensionAfter: dimensionBefore };
      }

      logFn(`[enterPortal] Teleported: ${dimensionBefore} → ${dimensionAfter}`);
      return { success: true, dimensionBefore, dimensionAfter };
    },

    // Standard JS
    console: {
      log: (...args: unknown[]) => { if (logs.length < MAX_LOG_LINES) logs.push(args.map(String).join(" ")); },
      error: (...args: unknown[]) => { if (logs.length < MAX_LOG_LINES) logs.push("[error] " + args.map(String).join(" ")); },
      warn: (...args: unknown[]) => { if (logs.length < MAX_LOG_LINES) logs.push("[warn] " + args.map(String).join(" ")); },
    },
    JSON, Math, Date, Array, Object, String, Number, Boolean,
    Map, Set, RegExp, Error, Promise,
    parseInt, parseFloat, isNaN, isFinite,
    setTimeout: sandboxSetTimeout,
    setInterval: sandboxSetInterval,
    clearTimeout: sandboxClearTimeout,
    clearInterval: sandboxClearInterval,
  };

  const keys = Object.keys(ctx);
  const values = Object.values(ctx);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;
  const fn = new AsyncFunction(...keys, `\n${code}\n`);

  console.error(`[mc_execute] Executing code (${code.length} chars, timeout: ${effectiveTimeout}ms)`);

  // Apply safe pathfinder defaults for mc_execute sandbox
  // Agents use bot.pathfinder.goto() directly — without these, maxDropDown is unset
  // and pathfinder routes over cliffs causing massive fall damage.
  // maxDropDown=1: Minecraft fall damage starts at >3-block drops (>3 blocks = 0.5HP damage).
  // maxDropDown=2 caused cumulative damage on mountainous terrain (Y=85-120) via repeated 2-block
  // drops. maxDropDown=1 prevents all fall damage while still allowing natural terrain descent.
  try {
    if (rawBot.pathfinder?.movements) {
      rawBot.pathfinder.movements.canDig = false;
      rawBot.pathfinder.movements.maxDropDown = 1;
      rawBot.pathfinder.movements.dontCreateFlow = true;
    }
  } catch { /* pathfinder may not be loaded yet */ }

  try {
    // Set execute flag ONLY during actual code execution to prevent race conditions
    managed.mcExecuteActive = true;
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => { aborted = true; reject(new Error(`Execution timed out after ${effectiveTimeout}ms`)); }, effectiveTimeout)
      );
      const result = await Promise.race([fn(...values), timeoutPromise]);
      const elapsed = Date.now() - startTime;

      // Cancel any ongoing pathfinder navigation to prevent zombie goto() from previous execution
      try { rawBot.pathfinder.setGoal(null); } catch {}

      // Clear any sandbox setInterval/setTimeout created by agent code.
      // A tight findBlock loop or rapid setInterval would otherwise accumulate across
      // executions and eventually exhaust memory or trigger uncaughtException.
      clearAllTrackedTimers();

      const parts: string[] = [];
      if (result !== undefined && result !== null) {
        try { parts.push(`Result:\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}`); }
        catch { parts.push(`Result: ${String(result)}`); }
      }
      if (logs.length > 0) parts.push(`Logs:\n${logs.join("\n")}`);
      parts.push(`Executed in ${elapsed}ms`);
      return parts.join("\n\n");
    } finally {
      // Clear execute flag when code execution finishes (success or error)
      managed.mcExecuteActive = false;
    }

  } catch (error) {
    const elapsed = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Cancel any ongoing pathfinder navigation (especially on timeout — stops zombie goto())
    try { rawBot.pathfinder.setGoal(null); } catch {}

    // Force-clear any zombie timers left by agent code (critical on execution timeout)
    clearAllTrackedTimers();

    const parts = [`Error: ${errorMessage}`];
    if (logs.length > 0) parts.push(`Logs before error:\n${logs.join("\n")}`);
    parts.push(`Failed after ${elapsed}ms`);
    console.error(`[mc_execute] Error: ${errorMessage}`);
    return parts.join("\n\n");
  }
}
