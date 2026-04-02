/**
 * mc_execute - Code Execution
 *
 * Agents write raw mineflayer JavaScript.
 * Exposed: bot (raw mineflayer), Movements, goals, Vec3, log(), wait(), getMessages()
 */

import { botManager } from "../bot-manager/index.js";
import { currentBotContext } from "../bot-manager/bot-core.js";
import { getSurroundings } from "../bot-manager/bot-info.js";
import { EDIBLE_FOOD_NAMES } from "../bot-manager/minecraft-utils.js";
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
    // Use sandboxSetTimeout so the timer is tracked and cleared by clearAllTrackedTimers()
    // on execution timeout/abort. Without this, a long wait() left mid-execution creates
    // a zombie timer that fires after the sandbox has already finished, potentially calling
    // resolve/reject on a stale Promise and causing confusing log output.
    const timer = sandboxSetTimeout(() => {
      if (aborted) reject(new Error("Execution aborted"));
      else resolve();
    }, Math.min(ms, MAX_WAIT_MS));
    void timer;
  });
  const getMessagesFn = () => {
    const msgs = botManager.getChatMessages(botUsername, true);
    // Deduplicate: consecutive identical [Server] messages get collapsed to one entry.
    // This suppresses spam loops (e.g. repeated gamerule or command confirmations)
    // that would otherwise flood the agent's context and impair decision-making.
    const deduped: typeof msgs = [];
    for (const m of msgs) {
      const prev = deduped[deduped.length - 1];
      if (prev && prev.username === m.username && prev.message === m.message) {
        // Skip exact duplicate
        continue;
      }
      deduped.push(m);
    }
    return deduped;
  };

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
        // maxDropDown controls how many blocks pathfinder will route the bot to fall in one step.
        // canDig=false (initial attempt): use maxDropDown=1 to avoid fall damage on normal terrain.
        //   1-block steps = no fall damage (Minecraft: >3 blocks = damage).
        // canDig=true (retry after noPath/timeout): allow larger drops so pathfinder can find a
        //   route through complex terrain (caves, cliffs). Scale by current Y:
        //   - Y > 100: allow up to 6 blocks (elevated terrain, large drops common)
        //   - Y > 70:  allow up to 4 blocks (mid-elevation terrain)
        //   - Y <= 70: allow 4 blocks (underground caves)
        //   This is a technical parameter, not agent logic — pathfinder needs it to compute routes.
        //   Without this, GoalNear(x, 62, z) from Y=86 produces "noPath" with maxDropDown=4
        //   because the A* search can't bridge the 24-block Y gap in the allowed step sizes.
        if (allowDig) {
          const currentY = rawBot.entity.position.y;
          const dropAllowance = currentY > 100 ? 6 : 4;
          rawBot.pathfinder.movements.maxDropDown = dropAllowance;
        } else {
          rawBot.pathfinder.movements.maxDropDown = 1;
        }
      }
    } catch { /* ignore */ }

    // Cap pathfinder thinkTimeout so that A* computation gives up BEFORE the hard
    // timeout fires. Without this, when timeoutMs < thinkTimeout (e.g. agent passes
    // 20000ms but thinkTimeout=20000ms), the hard timeout fires first and the caller
    // gets a generic "timeout" error instead of "noPath", preventing canDig retry.
    // Keep at least 5000ms for the computation; reserve 3000ms for navigation after.
    const prevThinkTimeout = (rawBot.pathfinder as any)?.thinkTimeout ?? 20000;
    const cappedThinkTimeout = Math.min(prevThinkTimeout, Math.max(timeoutMs - 3000, 5000));
    try {
      if (rawBot.pathfinder) (rawBot.pathfinder as any).thinkTimeout = cappedThinkTimeout;
    } catch { /* ignore */ }

    const gotoPromise = (rawBot.pathfinder.goto as any)(goal);

    // NOTE: thinkTimeout is NOT restored here.
    // pathfinder reads bot.pathfinder.thinkTimeout dynamically on the first physicsTick
    // AFTER setGoal() — restoring immediately (before that tick) would undo the cap and
    // cause the pathfinder to compute for the full 20s while the hard timeout fires at 15s.
    // thinkTimeout is restored inside cleanup() once path computation has started/finished.

    const STUCK_INTERVAL = 5000;
    const STUCK_THRESHOLD = 0.5;
    const MAX_STUCK_CHECKS = 2;
    // Grace period: don't start stuck-counting until bot has moved, or this many
    // ms have elapsed (covers slow path-computation on complex terrain).
    // Use cappedThinkTimeout (not prevThinkTimeout) so grace matches what pathfinder
    // will actually spend on path computation. Add 5s buffer.
    // IMPORTANT: Cap grace period below timeoutMs so that stuck detection can fire
    // at least once before the hard timeout. Without this cap, GRACE_PERIOD_MS can
    // exceed timeoutMs (e.g. grace=22000 > timeout=20000), making stuck detection
    // never activate and the hard timeout always firing first.
    const GRACE_PERIOD_MS = Math.min(
      Math.max(cappedThinkTimeout + 5000, 15000),
      timeoutMs - STUCK_INTERVAL  // ensure at least one stuck check fires before hard timeout
    );
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
        // 'noPath' = A* exhausted search space with no solution
        // 'timeout' = thinkTimeout elapsed before path was found ("Took too long to decide path to goal!")
        // Both should trigger the canDig=true retry in pathfinderGoto.
        if (result?.status === 'noPath' || result?.status === 'timeout') {
          rawBot.removeListener('path_update', onPathUpdate);
          cleanup();
          sandboxClearTimeout(hardTimeoutId);
          try { rawBot.pathfinder.setGoal(null); } catch { /* ignore */ }
          const errMsg = result.status === 'timeout'
            ? 'Took too long to decide path to goal!'
            : 'No path to the goal!';
          reject(new Error(errMsg));
        }
      };
      rawBot.on('path_update', onPathUpdate);

      const cleanup = () => {
        if (stuckCheckTimer !== null) { sandboxClearInterval(stuckCheckTimer); stuckCheckTimer = null; }
        rawBot.removeListener('path_update', onPathUpdate);
        // Restore thinkTimeout now that path computation is done (or timed out).
        // This must happen in cleanup(), not immediately after goto() starts, because
        // pathfinder reads thinkTimeout dynamically on the first physicsTick after setGoal().
        try { if (rawBot.pathfinder) (rawBot.pathfinder as any).thinkTimeout = prevThinkTimeout; } catch { /* ignore */ }
      };

      // Use sandboxSetInterval/setTimeout so these timers are tracked by clearAllTrackedTimers().
      // Without this, when the mc_execute outer timeout fires first, these internal timers
      // survive as zombies that later call rawBot.pathfinder.setGoal(null), interfering
      // with the NEXT mc_execute call's pathfinder.
      stuckCheckTimer = sandboxSetInterval(() => {
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

      const hardTimeoutId = sandboxSetTimeout(() => {
        cleanup();
        try { rawBot.pathfinder.setGoal(null); } catch { /* ignore */ }
        reject(new Error(`Pathfinder timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      gotoPromise.then(
        (val: unknown) => { cleanup(); sandboxClearTimeout(hardTimeoutId); resolve(val as void); },
        (err: unknown) => { cleanup(); sandboxClearTimeout(hardTimeoutId); reject(err); }
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

  // Maximum timeout for any single pathfinder goto call.
  // Prevents agents from passing 120000ms (the mc_execute outer timeout) which causes
  // the pathfinder to hang for the full duration instead of failing fast.
  // 60s is enough for any reasonable navigation — longer means the path is truly impossible.
  const MAX_PATHFINDER_TIMEOUT = 60_000;

  // Wrap rawBot.pathfinder.goto() so that even direct bot.pathfinder.goto() calls inside
  // agent code go through gotoWithStuckDetection (hard timeout + stuck detection).
  // This prevents the 120s deadlock reported in bot1_session3_pathfinder_deadlock.md.
  const pathfinderProxy = rawBot.pathfinder ? new Proxy(rawBot.pathfinder, {
    get(target: any, prop: string | symbol) {
      if (prop === 'goto') {
        // Replace goto with our safe wrapper.
        // Cap at MAX_PATHFINDER_TIMEOUT regardless of what the agent passes.
        // Mirrors pathfinderGoto: first attempt with canDig=false, then canDig=true retry on noPath/timeout.
        // Without the retry, bot.pathfinder.goto() in complex terrain (Nether/End) always fails
        // on the first attempt with "No path to the goal!" even though canDig=true would succeed.
        return async (goal: any) => {
          try {
            return await gotoWithStuckDetection(goal, MAX_PATHFINDER_TIMEOUT, false);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if ((msg.includes("No path") || msg.includes("no path") || msg.includes("Took to long") || msg.includes("Took too long") || msg.includes("Pathfinder stuck")) && !msg.toLowerCase().includes("goal was changed")) {
              // Retry with canDig=true for complex terrain (Nether, End, caves)
              try {
                return await gotoWithStuckDetection(goal, MAX_PATHFINDER_TIMEOUT, true);
              } finally {
                try { if (rawBot.pathfinder?.movements) rawBot.pathfinder.movements.canDig = false; } catch { /* ignore */ }
              }
            }
            throw err;
          }
        };
      }
      // Pass Symbol properties through without modification.
      if (typeof prop === 'symbol') return target[prop];
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    },
    set(target: any, prop: string, value: any) {
      target[prop] = value;
      return true;
    },
  }) : rawBot.pathfinder;

  // Shadow rawBot with a proxy that replaces .pathfinder with our safe version.
  // IMPORTANT: EventEmitter methods (on, once, emit, removeListener, etc.) and _client
  // must NOT be wrapped with bind() — they must be returned as-is from the target to
  // preserve the EventEmitter chain.  Wrapping them with bind(target) is functionally
  // equivalent but can interfere with internal Symbol properties (Symbol.for('nodejs.*'))
  // and prototype chain inspection used by minecraft-protocol's packet dispatch.
  // Only non-EventEmitter methods get bind(target) to preserve the correct `this` context.
  const EVENT_EMITTER_PROPS = new Set([
    '_client', 'emit', 'on', 'once', 'off', 'addListener',
    'removeListener', 'removeAllListeners', 'listeners', 'rawListeners',
    'listenerCount', 'prependListener', 'prependOnceListener', 'eventNames',
  ]);
  // Wrap bot.dig() with a 15-second timeout (Rule A: mineflayer API can hang indefinitely).
  // Without this, a single dig() call can block the entire mc_execute sandbox for 120s.
  // 15s is generous: most blocks take <2s; hardest (obsidian w/ gold pick) takes ~9s.
  const DIG_TIMEOUT_MS = 15000;
  const digWithTimeout = (block: any): Promise<void> => {
    return Promise.race<void>([
      rawBot.dig(block),
      new Promise<void>((_, reject) =>
        sandboxSetTimeout(() => reject(new Error(`bot.dig() timed out after ${DIG_TIMEOUT_MS}ms — block may be out of reach or undiggable`)), DIG_TIMEOUT_MS)
      ),
    ]);
  };

  // Wrap bot.openContainer() to pre-activate the block before opening.
  // Direct calls to bot.openContainer() fail ~40% of the time with "Event windowOpen did not
  // fire within timeout of 20000ms" because the server sends windowOpen only after the client
  // activates the block. This wrapper mirrors the openChest() helper but intercepts the raw API
  // so agents who call bot.openContainer() directly also benefit from the pre-activation.
  const openContainerWithPreActivate = async (block: any) => {
    if (block && !rawBot.currentWindow) {
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
          }, 3000);
        });
        await rawBot.activateBlock(block);
        await windowOpenPromise;
      } catch { /* ignore — openContainer will open the window */ }
    }
    return rawBot.openContainer(block);
  };

  // Wrap bot.openFurnace() to pre-activate the block before opening.
  // Without pre-activation, openFurnace() fails with "Event windowOpen did not fire within
  // timeout of 20000ms" ~40% of the time (same issue as openContainer).
  // The smeltItems() sandbox helper already does this, but agents that call bot.openFurnace()
  // directly (e.g. from CLAUDE.md examples) hit this bug.
  // This wrapper is identical to openContainerWithPreActivate but calls openFurnace() at the end.
  const openFurnaceWithPreActivate = async (block: any) => {
    if (block && !rawBot.currentWindow) {
      try {
        const windowOpenPromise = new Promise<void>(resolve => {
          const onWindow = () => {
            rawBot.removeListener("windowOpen" as any, onWindow);
            resolve();
          };
          rawBot.on("windowOpen" as any, onWindow);
          // 3000ms timeout: enough for laggy servers (matches openChest/openContainer)
          setTimeout(() => {
            rawBot.removeListener("windowOpen" as any, onWindow);
            resolve();
          }, 3000);
        });
        await rawBot.activateBlock(block);
        await windowOpenPromise;
      } catch { /* ignore activateBlock errors — openFurnace will open it */ }
    }
    return rawBot.openFurnace(block);
  };

  // Wrap bot.consume() with a 5-second timeout (Rule A: entity_status packet can be delayed
  // indefinitely on laggy servers). Without this, bot.consume() hangs forever.
  // The eat() helper in ctx is preferred and handles food selection + health event detection,
  // but for agents that call bot.consume() directly this ensures a bounded wait.
  //
  // Also rejects immediately when bot is airborne (onGround=false) — eating mid-fall causes
  // fatal fall damage on landing (matches the same guard in eat()). This was the cause of
  // the Y=135 instant-death bug in bot1_food_death.md.
  const CONSUME_TIMEOUT_MS = 5000;
  const consumeWithTimeout = (): Promise<void> => {
    // Guard: reject immediately if airborne. Eating mid-fall = fatal fall damage on landing.
    if (!(rawBot.entity as any).onGround) {
      return Promise.reject(new Error(
        `bot.consume() called while airborne (onGround=false, Y=${rawBot.entity.position.y.toFixed(1)}). ` +
        `Land first — eating mid-fall causes fatal fall damage on landing. Use eat() for the same guard.`
      ));
    }
    return Promise.race<void>([
      rawBot.consume(),
      new Promise<void>((_, reject) =>
        sandboxSetTimeout(
          () => reject(new Error(`bot.consume() timed out after ${CONSUME_TIMEOUT_MS}ms — use eat() instead for reliable food consumption`)),
          CONSUME_TIMEOUT_MS
        )
      ),
    ]);
  };

  // Wrap bot.recipesFor() to automatically include a nearby crafting table.
  // Direct calls to rawBot.recipesFor(id, meta, count, null) only return 2x2 recipes.
  // Items like bread, bucket, and most tools require a 3x3 crafting table recipe.
  // Without the table argument, recipesFor() always returns [] for those items,
  // causing "no recipe found" errors even when a crafting table is nearby.
  // This wrapper mirrors the sandbox recipesFor() helper but intercepts bot.recipesFor()
  // calls directly so agents who call bot.recipesFor() also get 3x3 recipes.
  const recipesForWithTable = (itemId: number, metadata: any = null, count: number = 1, table: any = null) => {
    // If agent explicitly passes a table (4th arg), use it directly.
    if (table !== null) return rawBot.recipesFor(itemId, metadata, count, table);
    // Otherwise auto-find a nearby crafting table (within 6 blocks)
    const tableId = (rawBot.registry?.blocksByName as any)?.crafting_table?.id;
    const nearbyTable = tableId ? rawBot.findBlock({ matching: tableId, maxDistance: 6 }) : null;
    if (!nearbyTable) return rawBot.recipesFor(itemId, metadata, count, null);
    // Prefer 3x3 (with table) results; fall back to 2x2 if table gives nothing
    const withTable = rawBot.recipesFor(itemId, metadata, count, nearbyTable);
    if (withTable.length > 0) return withTable;
    return rawBot.recipesFor(itemId, metadata, count, null);
  };

  // Wrap bot.placeBlock() with a raw-packet implementation to bypass the 5-second
  // blockUpdate timeout in mineflayer's placeBlock().  The server sometimes delays
  // or drops the blockUpdate ack for placements, causing "Event blockUpdate:(...) did
  // not fire within timeout of 5000ms".  This wrapper mirrors safePlaceBlock() but
  // intercepts the standard bot.placeBlock(referenceBlock, faceVec) call so agents
  // who use bot.placeBlock() directly also benefit from the fix.
  // Agents should prefer safePlaceBlock() from ctx, but this ensures the raw bot API
  // is also reliable.
  const placeBlockWithRawPacket = async (referenceBlock: any, faceVec: any): Promise<void> => {
    const pos = referenceBlock.position;
    const fv = faceVec || { x: 0, y: 1, z: 0 };
    const direction = fv.y === 1 ? 1 : fv.y === -1 ? 0 : fv.x === 1 ? 5 : fv.x === -1 ? 4 : fv.z === 1 ? 3 : 2;

    // Look at the block before placing (server rejects placements without facing)
    try { await rawBot.lookAt(pos.offset(0.5, 0.5, 0.5), true); } catch { /* ignore */ }

    // Wait for blockUpdate at the placement position (new block created above reference)
    const placePos = pos.offset(fv.x, fv.y, fv.z);
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
      // 500ms fallback — same generous window as safePlaceBlock
      setTimeout(() => { rawBot.removeListener("blockUpdate", onBlockUpdate); resolve(); }, 500);
    });

    // Send raw block_place packet (avoids mineflayer's 5s blockUpdate wait)
    (rawBot as any)._client.write("block_place", {
      location: { x: pos.x, y: pos.y, z: pos.z },
      direction,
      hand: 0,
      cursorX: 0.5,
      cursorY: fv.y === 1 ? 1.0 : 0.5,
      cursorZ: 0.5,
      insideBlock: false,
    });

    await syncPromise;
  };

  const botProxy = new Proxy(rawBot, {
    get(target: any, prop: string | symbol) {
      if (prop === 'pathfinder') return pathfinderProxy;
      // Wrap dig() with a hard timeout so a single stuck dig() doesn't block the sandbox.
      if (prop === 'dig') return digWithTimeout;
      // Wrap placeBlock() with raw packet to bypass the 5-second blockUpdate timeout.
      // Server sometimes delays or drops the blockUpdate ack, causing placement failures.
      if (prop === 'placeBlock') return placeBlockWithRawPacket;
      // Wrap openContainer() to pre-activate the block and avoid windowOpen timeout.
      if (prop === 'openContainer') return openContainerWithPreActivate;
      // Wrap openFurnace() to pre-activate the block and avoid windowOpen timeout.
      // Same race condition as openContainer: server sends windowOpen only after activateBlock.
      if (prop === 'openFurnace') return openFurnaceWithPreActivate;
      // Wrap consume() with a hard timeout — entity_status packet can be delayed indefinitely.
      if (prop === 'consume') return consumeWithTimeout;
      // Wrap recipesFor() to automatically include nearby crafting table for 3x3 recipes.
      // Without this, bread/bucket/tools return [] even when standing next to a crafting table.
      if (prop === 'recipesFor') return recipesForWithTable;
      // Pass EventEmitter methods and _client through without bind() to preserve
      // the full EventEmitter chain and minecraft-protocol packet dispatch.
      if (typeof prop === 'string' && EVENT_EMITTER_PROPS.has(prop)) {
        const val = target[prop];
        return typeof val === 'function' ? val.bind(target) : val;
      }
      // For Symbol properties (e.g. Symbol.iterator, Symbol.for('nodejs.*')):
      // always pass through without modification.
      if (typeof prop === 'symbol') {
        return target[prop];
      }
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    },
    set(target: any, prop: string, value: any) {
      target[prop] = value;
      return true;
    },
  });

  const ctx: Record<string, unknown> = {
    bot: botProxy,
    Movements: MovementsWrapped,
    goals,
    Vec3,
    // Utilities
    log: logFn,
    wait: waitFn,
    getMessages: getMessagesFn,
    // Pathfinder timeout wrapper utility (usage: await pathfinderGoto(goal, 45000))
    // On "No path" / "Took too long" failure, automatically retries once with canDig=true.
    // On retry, thinkTimeout is capped to (timeoutMs - 3000) so A* finishes before the hard timeout.
    // timeoutMs is capped at MAX_PATHFINDER_TIMEOUT (60s) — passing 120000 won't cause a 120s hang.
    // Default 45s: A* path computation on high-altitude terrain (Y=100+) can take 20-30s,
    // and the previous 30s default was too short, causing false "stuck" detections.
    pathfinderGoto: async (goal: any, timeoutMs = 45000) => {
      const effectiveTimeoutMs = Math.min(timeoutMs, MAX_PATHFINDER_TIMEOUT);
      try {
        return await gotoWithStuckDetection(goal, effectiveTimeoutMs, false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // On "No path" / think-timeout errors, retry with canDig=true as fallback for complex terrain.
        // "goal was changed" means the goal was overridden externally — retrying won't help, rethrow.
        if ((msg.includes("No path") || msg.includes("no path") || msg.includes("Took to long") || msg.includes("Took too long") || msg.includes("Pathfinder stuck")) && !msg.toLowerCase().includes("goal was changed")) {
          logFn(`[pathfinderGoto] Path failed (${msg.substring(0, 60)}), retrying with canDig=true`);
          // Retry with canDig=true. gotoWithStuckDetection will cap thinkTimeout to
          // timeoutMs-3000 so the A* computation finishes before the hard timeout fires.
          try {
            return await gotoWithStuckDetection(goal, effectiveTimeoutMs, true);
          } finally {
            // Restore canDig=false after dig-enabled navigation
            try {
              if (rawBot.pathfinder?.movements) rawBot.pathfinder.movements.canDig = false;
            } catch { /* ignore */ }
          }
        }
        throw err;
      }
    },
    // Multi-stage pathfind: break long distances into waypoints
    // Usage: await multiStagePathfind(targetX, targetZ, stageDistance?, targetY?)
    // Each stage retries with canDig=true on noPath/timeout, same as pathfinderGoto.
    // targetY: optional Y coordinate for the final goal. When provided the last stage
    //   uses GoalNear(x, y, z, 3) instead of GoalXZ so the bot actually descends/ascends
    //   to the correct altitude (important in the Nether where terrain has large Y variation).
    // skipFailedStages: intermediate stages that fail are logged but skipped (not thrown),
    //   allowing the bot to advance toward the goal even over partially blocked terrain.
    //   The final stage always throws on failure so the caller knows if goal was not reached.
    multiStagePathfind: async (targetX: number, targetZ: number, stageDistance: number = 10, targetY?: number) => {
      const startPos = rawBot.entity.position;
      const dx = targetX - startPos.x;
      const dz = targetZ - startPos.z;
      const totalDist = Math.sqrt(dx*dx + dz*dz);

      // Helper: one stage goto with canDig retry (mirrors pathfinderGoto logic)
      const stageGoto = async (goal: any, label: string): Promise<void> => {
        try {
          await gotoWithStuckDetection(goal, 20000, false);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if ((msg.includes("No path") || msg.includes("no path") || msg.includes("Took to long") || msg.includes("Took too long") || msg.includes("Pathfinder stuck")) && !msg.toLowerCase().includes("goal was changed")) {
            logFn(`[multiStagePathfind] ${label} retry with canDig=true`);
            try {
              await gotoWithStuckDetection(goal, 20000, true);
            } finally {
              try { if (rawBot.pathfinder?.movements) rawBot.pathfinder.movements.canDig = false; } catch { /* ignore */ }
            }
          } else {
            throw err;
          }
        }
      };

      if (totalDist <= stageDistance) {
        // Close enough, just go directly.
        // If targetY was provided, use GoalNear with Y so the bot moves to the right altitude.
        const directGoal = targetY !== undefined
          ? new goals.GoalNear(targetX, targetY, targetZ, 3)
          : new goals.GoalXZ(targetX, targetZ);
        return stageGoto(directGoal, "direct");
      }

      // Calculate waypoints
      const numStages = Math.ceil(totalDist / stageDistance);
      logFn(`Multi-stage pathfind: ${totalDist.toFixed(1)} blocks in ${numStages} stages`);

      // Interpolate Y if targetY was provided (linear approach from current Y to targetY)
      const startY = startPos.y;
      const dyTotal = targetY !== undefined ? (targetY - startY) : 0;

      // Record starting dimension so we can abort if the bot enters a portal mid-navigation
      const multiStageStartDimension = (rawBot.game as any)?.dimension ?? (rawBot as any).dimension ?? "overworld";

      // Navigate each stage
      for (let i = 1; i <= numStages; i++) {
        // Abort immediately if the dimension changed (e.g. bot walked into a portal)
        const currentDimension = (rawBot.game as any)?.dimension ?? (rawBot as any).dimension ?? multiStageStartDimension;
        if (currentDimension !== multiStageStartDimension) {
          logFn(`[multiStagePathfind] ABORT: dimension changed from "${multiStageStartDimension}" to "${currentDimension}". Stopping navigation.`);
          return;
        }

        const frac = i / numStages;
        const wpX = startPos.x + dx * frac;
        const wpZ = startPos.z + dz * frac;
        const isFinal = i === numStages;

        // For intermediate stages use GoalXZ (Y-agnostic) to avoid getting stuck on terrain.
        // For the final stage, use GoalNear with Y if targetY was specified.
        const goal = (isFinal && targetY !== undefined)
          ? new goals.GoalNear(wpX, startY + dyTotal, wpZ, 3)
          : new goals.GoalXZ(wpX, wpZ);

        logFn(`Stage ${i}/${numStages}: (${Math.floor(wpX)}, ${Math.floor(wpZ)})${isFinal && targetY !== undefined ? ` Y=${Math.floor(startY + dyTotal)}` : ""}`);

        try {
          await stageGoto(goal, `stage ${i}`);
        } catch (e) {
          logFn(`Stage ${i} failed: ${String(e).substring(0, 60)}`);
          // Intermediate stage failures are logged and skipped — the bot may have
          // advanced partway and can still attempt the next waypoint.
          // The final stage always re-throws so the caller knows if the goal was not reached.
          if (isFinal) {
            throw e;
          }
          logFn(`[multiStagePathfind] Stage ${i} skipped, continuing toward goal`);
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
      // Find and equip food automatically.
      // Uses EDIBLE_FOOD_NAMES from minecraft-utils.ts as the single source of truth.
      // Previously this function had its own hardcoded list that diverged from EDIBLE_FOOD_NAMES,
      // causing bugs where items in one list but not the other were silently ignored.
      // Priority order: cooked/golden items first (most nutrition), raw/emergency food last.
      const PRIORITY_ORDER = [
        "golden_apple", "enchanted_golden_apple",
        "cooked_beef", "cooked_porkchop", "cooked_mutton", "cooked_chicken",
        "cooked_rabbit", "cooked_cod", "cooked_salmon",
        "bread", "baked_potato", "pumpkin_pie", "cookie",
        "golden_carrot", "melon_slice", "sweet_berries", "glow_berries",
        "apple", "carrot", "potato", "beetroot", "dried_kelp",
        "mushroom_stew", "rabbit_stew", "beetroot_soup", "suspicious_stew",
        "chorus_fruit",
        "raw_beef", "raw_porkchop", "raw_mutton", "raw_chicken",
        "raw_rabbit", "raw_cod", "raw_salmon",
        "beef", "porkchop", "mutton", "chicken", "rabbit", "cod", "salmon",
        "rotten_flesh",
      ];
      // Build the ordered list: priority items first, then any remaining EDIBLE_FOOD_NAMES entries
      const foodNames = [
        ...PRIORITY_ORDER.filter(n => EDIBLE_FOOD_NAMES.has(n)),
        ...[...EDIBLE_FOOD_NAMES].filter(n => !PRIORITY_ORDER.includes(n)),
      ];

      let food = rawBot.heldItem && EDIBLE_FOOD_NAMES.has(rawBot.heldItem.name)
        ? rawBot.heldItem
        : null;
      if (!food) {
        for (const name of foodNames) {
          food = rawBot.inventory.items().find((i: any) => i.name === name) ?? null;
          if (food) break;
        }
      }
      if (!food) {
        // Check if the held item is a non-edible item that might confuse the agent (e.g. wheat)
        const heldName = rawBot.heldItem?.name;
        if (heldName && !EDIBLE_FOOD_NAMES.has(heldName)) {
          throw new Error(`No edible food in inventory. Held item "${heldName}" cannot be eaten. wheat/seeds are ingredients, not food — craft bread first.`);
        }
        throw new Error("No food in inventory");
      }
      // Rule C (honest return value): eating while falling causes instant death on landing.
      // Minecraft lets you eat in mid-air but the fall damage is fatal (72 blocks = 70+ HP).
      // Throw immediately so the agent knows it must land before eating.
      if (!(rawBot.entity as any).onGround) {
        throw new Error(`eat() called while airborne (onGround=false, Y=${rawBot.entity.position.y.toFixed(1)}). Land first — eating mid-fall causes fatal fall damage on landing.`);
      }

      await rawBot.equip(food, "hand");

      const itemName = food.name;
      const foodBefore = rawBot.food;

      // Start eating using activateItem (holds use button)
      rawBot.activateItem(false);

      // Wait for food event or timeout (eating takes ~1.61s)
      // Use sandboxSetTimeout so this timer is cancelled if mc_execute times out
      // before eating completes — prevents a zombie health listener from firing on
      // the next mc_execute call and falsely resolving an unrelated eat() call.
      const eatDone = new Promise<boolean>(resolve => {
        const onFoodChange = () => {
          rawBot.removeListener("health" as any, onFoodChange);
          sandboxClearTimeout(eatTimeoutId);
          resolve(true);
        };
        rawBot.on("health" as any, onFoodChange);
        const eatTimeoutId = sandboxSetTimeout(() => {
          rawBot.removeListener("health" as any, onFoodChange);
          resolve(false);
        }, 3500);
      });

      const changed = await eatDone;

      // Stop eating
      rawBot.deactivateItem();

      const foodAfter = rawBot.food;
      logFn(`[eat] ${itemName}: food ${foodBefore} → ${foodAfter}${changed ? "" : " (timeout)"}`);

      // If food level did not change after timeout, eating failed (server did not respond).
      // This can happen when the server connection is stale or use_item packet was not processed.
      // Throw an error so the agent knows eating did not succeed rather than silently continuing.
      if (!changed && foodAfter <= foodBefore) {
        throw new Error(`eat() timed out: ${itemName} was not consumed (food ${foodBefore} → ${foodAfter}). Server may not be responding to use_item packets.`);
      }

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
            // Use gotoWithStuckDetection for stuck detection + proper timeout.
            // rawBot.pathfinder.goto() bypasses pathfinderProxy and has no stuck detection.
            await gotoWithStuckDetection(goal, 8000, false);
          } catch { /* ignore pathfinder errors — we're on surface, which is the main goal */ }
        }
      }

      const finalPos = rawBot.entity.position;
      const finalFeet = rawBot.blockAt(finalPos.floored());
      const finalInWater = isWater(finalFeet?.name);

      if (finalInWater) {
        // Phase 3: Still in water (enclosed water trap). Try digging upward to escape.
        // This handles cases where the water pocket is surrounded by solid blocks on all sides.
        logFn(`[escapeWater] Still in water. Attempting upward dig escape.`);
        const DIG_UP_ATTEMPTS = 8;
        for (let i = 0; i < DIG_UP_ATTEMPTS; i++) {
          const digPos = rawBot.entity.position.floored().offset(0, 1, 0);
          const digBlock = rawBot.blockAt(digPos);
          if (!digBlock || isWater(digBlock.name) || digBlock.name === 'air' || digBlock.name === 'cave_air') {
            // Nothing solid to dig above — try holding jump to rise through water
            rawBot.setControlState('jump', true);
            await new Promise<void>(r => setTimeout(r, 400));
            rawBot.setControlState('jump', false);
          } else {
            // Solid block above — dig it
            try {
              await digWithTimeout(digBlock);
              logFn(`[escapeWater] Dug ${digBlock.name} at y=${digBlock.position.y}`);
            } catch { /* ignore */ }
            await new Promise<void>(r => setTimeout(r, 300));
          }
          // Check if we've escaped
          const checkPos = rawBot.entity.position.floored();
          const checkFeet = rawBot.blockAt(checkPos);
          const checkHead = rawBot.blockAt(checkPos.offset(0, 1, 0));
          if (!isWater(checkFeet?.name) && !isWater(checkHead?.name)) {
            logFn(`[escapeWater] Escaped via upward dig at Y=${Math.floor(rawBot.entity.position.y)}`);
            break;
          }
        }
        rawBot.setControlState('jump', false);

        // Re-check final state
        const digEscapePos = rawBot.entity.position;
        const digEscapeFeet = rawBot.blockAt(digEscapePos.floored());
        const digEscapeInWater = isWater(digEscapeFeet?.name);
        if (digEscapeInWater) {
          return `Still in water at (${digEscapePos.x.toFixed(1)}, ${digEscapePos.y.toFixed(1)}, ${digEscapePos.z.toFixed(1)}). Water pocket fully enclosed — admin teleport required.`;
        }
        return `Escaped water via dig at (${digEscapePos.x.toFixed(1)}, ${digEscapePos.y.toFixed(1)}, ${digEscapePos.z.toFixed(1)}) on ${digEscapeFeet?.name ?? "unknown"}.`;
      }

      return `Escaped water. Now at (${finalPos.x.toFixed(1)}, ${finalPos.y.toFixed(1)}, ${finalPos.z.toFixed(1)}) on ${finalFeet?.name ?? "unknown"}.`;
    },

    // === Meta-cognition layer: observe → understand → act ===
    // awareness() — self-state + spatial snapshot (call before any action)
    // Appends AutoSafety periodic scan cache (ores, chests, water within 32 blocks)
    // so agents can avoid redundant findBlock calls for common resources.
    awareness: () => {
      const base = getSurroundings(rawBot);
      const ss = managed.safetyState;
      if (!ss) return base;

      const lines: string[] = [base];

      // Append AutoSafety scan cache if it is recent (< 30 seconds old)
      const scanAge = Date.now() - ss.lastScanTime;
      if (ss.lastScanTime > 0 && scanAge < 30000) {
        lines.push(`\n## AutoSafety スキャンキャッシュ (${Math.round(scanAge / 1000)}秒前)`);
        if (ss.nearbyOres.length > 0) {
          const oreList = ss.nearbyOres.map(o => `${o.name}@(${o.pos.x},${o.pos.y},${o.pos.z})`).join(", ");
          lines.push(`鉱石: ${oreList}`);
        }
        if (ss.nearbyChests.length > 0) {
          const chestList = ss.nearbyChests.map(c => `(${c.x},${c.y},${c.z})`).join(", ");
          lines.push(`チェスト: ${chestList}`);
        }
        if (ss.nearbyWater.length > 0) {
          const waterList = ss.nearbyWater.map(w => `(${w.x},${w.y},${w.z})`).join(", ");
          lines.push(`水源: ${waterList}`);
        }
      }

      return lines.join("\n");
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

    // === descendSafely — 足元を掘りながら安全に降下 ===
    // Usage: await descendSafely(65)  — Y=65まで降りる
    // Usage: await descendSafely(-59, 300)  — 深部への長距離降下
    // Bot の真下を1ブロックずつ掘って降りる。崖でも使える。
    // maxDigAttempts のデフォルトは 300 (Y=73→Y=-59 の 132 ブロック降下に十分)
    // 各ループは平均 ~0.4s なので 300 attempts ≈ 120s (mc_execute のデフォルト timeout と同等)
    //
    // 最適化: 連続する空洞(落下可能区間)はまとめて自由落下する。
    // ブロックを掘る必要がない連続空洞は物理エンジンに任せて落下させることで
    // 空洞1ブロックにつき300+200msかかっていた待機を大幅削減する。
    descendSafely: async (targetY: number, maxDigAttempts: number = 300) => {
      let attempts = 0;
      // Stall detection: track Y every STALL_CHECK_INTERVAL iterations.
      // If Y has not decreased by at least 0.5 blocks over STALL_WINDOW consecutive checks,
      // abort — the bot is not making downward progress (broken world state, stuck, etc.).
      const STALL_CHECK_INTERVAL = 5;
      const STALL_WINDOW = 3; // 3 consecutive stall-checks = 15 attempts without progress
      let stallCheckYHistory: number[] = [];
      let stalled = false;

      const startY = Math.floor(rawBot.entity.position.y);
      // Record starting dimension so we can abort if a dimension change is detected mid-descent.
      // This prevents the bot from digging through purpur_block / end_stone in The End when
      // a prior multiStagePathfind() or portal transition placed the bot in the wrong dimension.
      const startDimension = (rawBot.game as any)?.dimension ?? (rawBot as any).dimension ?? "overworld";

      // Sanity check: if bot is already at or below target, nothing to do.
      if (startY <= targetY + 1) {
        const finalY = Math.floor(rawBot.entity.position.y);
        logFn(`[descendSafely] Already at target Y=${finalY} (target=${targetY}), no descent needed`);
        return { reached: true, finalY };
      }

      while (Math.floor(rawBot.entity.position.y) > targetY + 1 && attempts < maxDigAttempts) {
        attempts++;

        // Dimension-change abort: if the bot is no longer in the starting dimension,
        // a portal transition happened while descending (e.g. falling into an end_portal
        // or a prior navigation sent the bot to The End / Nether).  Continuing to dig
        // purpur_block or netherrack forever would never reach the overworld targetY.
        const currentDimension = (rawBot.game as any)?.dimension ?? (rawBot as any).dimension ?? startDimension;
        if (currentDimension !== startDimension) {
          logFn(`[descendSafely] ABORT: dimension changed from "${startDimension}" to "${currentDimension}". Possible portal transit — stopping descent.`);
          stalled = true;
          break;
        }

        const pos = rawBot.entity.position.floored();
        const blockBelow = rawBot.blockAt(pos.offset(0, -1, 0));

        const isAirLike = (name: string | undefined) =>
          !name || name === 'air' || name === 'cave_air' || name === 'water' || name === 'lava';

        if (blockBelow && !isAirLike(blockBelow.name)) {
          // 固体ブロックがある → 掘る
          // digWithTimeout (15s) を使用して無限ハングを防ぐ。
          // rawBot.dig() を直接呼ぶとbot.dig()のラッパーが適用されずタイムアウトなしでハングする。
          try {
            await digWithTimeout(blockBelow);
            logFn(`[descendSafely] Dug ${blockBelow.name} at y=${blockBelow.position.y}`);
          } catch(e) { /* ignore */ }
          // After dig, bot may fall automatically — give physics time to settle
          await new Promise<void>(r => setTimeout(r, 200));
        } else {
          // 下が空洞/水/溶岩 → 自由落下させる。
          // sneak を解除して sneak+forward で端から踏み出す。
          // 連続空洞は落下完了(onGround=true)まで待機し、1回のattemptで複数ブロック降下する。
          rawBot.setControlState('sneak', false);
          // 端にいる可能性があるため前進して確実に落下させる
          rawBot.setControlState('forward', true);
          await new Promise<void>(r => setTimeout(r, 100));
          rawBot.setControlState('forward', false);

          // Wait for the bot to land (onGround) or up to 2 seconds for a deep drop
          const fallStart = rawBot.entity.position.y;
          const FALL_WAIT_MS = 2000;
          const FALL_POLL_MS = 50;
          let waited = 0;
          while (waited < FALL_WAIT_MS) {
            await new Promise<void>(r => setTimeout(r, FALL_POLL_MS));
            waited += FALL_POLL_MS;
            if ((rawBot.entity as any).onGround) break;
            // Also break if we've reached target
            if (Math.floor(rawBot.entity.position.y) <= targetY + 1) break;
          }
          const dropped = fallStart - rawBot.entity.position.y;
          if (dropped > 0.5) {
            logFn(`[descendSafely] Fell ${dropped.toFixed(1)} blocks to Y=${Math.floor(rawBot.entity.position.y)}`);
          }
        }

        const newY = Math.floor(rawBot.entity.position.y);
        if (attempts % 10 === 0) {
          logFn(`[descendSafely] Y=${newY}, target=${targetY}, attempt=${attempts}`);
        }

        if (newY <= targetY + 1) break;

        // Stall detection: every STALL_CHECK_INTERVAL attempts, record current Y.
        // If the last STALL_WINDOW recorded Y values show no downward progress, abort.
        if (attempts % STALL_CHECK_INTERVAL === 0) {
          stallCheckYHistory.push(newY);
          if (stallCheckYHistory.length > STALL_WINDOW) {
            stallCheckYHistory.shift();
          }
          if (stallCheckYHistory.length === STALL_WINDOW) {
            const oldest = stallCheckYHistory[0];
            const newest = stallCheckYHistory[stallCheckYHistory.length - 1];
            // No downward progress: newest Y >= oldest Y - 0.5 (not decreasing)
            if (newest >= oldest - 0.5) {
              logFn(`[descendSafely] STALL detected: Y stuck at ~${newY} for ${STALL_WINDOW * STALL_CHECK_INTERVAL} attempts. Aborting.`);
              stalled = true;
              break;
            }
          }
          // Also detect upward drift: if current Y > startY + 3, something is very wrong
          if (newY > startY + 3) {
            logFn(`[descendSafely] ABORT: Y=${newY} increased above startY=${startY} — bot may be in wrong dimension or world state is broken`);
            stalled = true;
            break;
          }
        }
      }
      const finalY = Math.floor(rawBot.entity.position.y);
      const reason = stalled ? " (stalled)" : attempts >= maxDigAttempts ? " (maxAttempts)" : "";
      logFn(`[descendSafely] Done: Y=${finalY} (target=${targetY}, attempts=${attempts}${reason})`);
      return { reached: finalY <= targetY + 2, finalY };
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

      // Wait up to 4s for drops to appear (server may delay spawning drop entities).
      // Use waitFn (which checks aborted flag) so we exit promptly on mc_execute timeout.
      let drops = findDrops();
      for (let t = 0; t < 8 && drops.length === 0; t++) {
        await waitFn(500);
        drops = findDrops();
      }

      if (drops.length === 0) {
        return "collectDrops: no drops found nearby";
      }

      // Navigate to each drop and pick up
      let collected = 0;
      for (const drop of drops.slice(0, 12)) {
        if (!drop.position) continue;
        // Re-check entity still exists (may have been picked up already)
        const stillExists = rawBot.entities[drop.id as any];
        if (!stillExists) { collected++; continue; }
        const dist = drop.position.distanceTo(rawBot.entity.position);
        if (dist > 0.8) {
          // Move close enough for auto-pickup (within 0.8 blocks).
          // Use gotoWithStuckDetection so stuck pathfinder doesn't hang indefinitely.
          // If pathfinder fails, fall through and hope the item gets picked up by proximity.
          try {
            await gotoWithStuckDetection(
              new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 0),
              5000,
              false
            );
          } catch { /* item may have been picked up or pathfinder blocked */ }
        }
        // Wait up to 800ms for the server to confirm item pickup (server round-trip latency)
        await waitFn(800);
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
            // 3000ms timeout: matches openChest for consistency on laggy servers
            setTimeout(() => {
              rawBot.removeListener("windowOpen" as any, onWindow);
              resolve();
            }, 3000);
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
        // Use sandboxSetTimeout so this timer is cancelled if mc_execute times out —
        // a zombie furnace "update" listener from a previous timed-out smeltItems()
        // call would otherwise keep firing on subsequent executions.
        const waitMs = Math.min(count, inputItem.count) * 10000 + 5000;
        const smeltDone = new Promise<void>(resolve => {
          const check = () => {
            const out = furnace.outputItem();
            if (out && out.count >= targetOutputCount) {
              furnace.removeListener("update", check);
              sandboxClearTimeout(smeltTimeoutId);
              resolve();
            }
          };
          furnace.on("update", check);
          const smeltTimeoutId = sandboxSetTimeout(() => { furnace.removeListener("update", check); resolve(); }, waitMs);
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

    // === tillLand — convert dirt/grass to farmland using a hoe ===
    // Usage: const result = await tillLand(dirtBlock)
    // Equips any hoe in inventory, sends raw use_item packet on the block's top face,
    // then waits up to 600ms for a blockUpdate confirming the farmland conversion.
    // Returns { tilled: boolean, blockName: string, position } so the caller can
    // verify the server actually changed the block (activateBlock alone does not
    // guarantee a sync'd client block state update).
    //
    // NOTE: bot.activateBlock(dirtBlock) is the mineflayer API for right-clicking a
    // block. However it does not wait for the resulting blockUpdate, so findBlocks()
    // called immediately after may still see "dirt" instead of "farmland". This helper
    // explicitly waits for the blockUpdate so subsequent findBlocks calls are reliable.
    tillLand: async (dirtBlock: any) => {
      if (!dirtBlock) throw new Error("tillLand: dirtBlock is null");

      // Find and equip a hoe
      const hoeNames = ["wooden_hoe", "stone_hoe", "iron_hoe", "golden_hoe", "diamond_hoe", "netherite_hoe"];
      let hoe: any = null;
      for (const name of hoeNames) {
        hoe = rawBot.inventory.items().find((i: any) => i.name === name);
        if (hoe) break;
      }
      if (!hoe) throw new Error("tillLand: no hoe in inventory");
      await rawBot.equip(hoe, "hand");

      const fPos = dirtBlock.position;

      // Listen for blockUpdate at the tilled position BEFORE sending the packet
      // to avoid a race where the server acks before we attach the listener.
      const syncPromise = new Promise<string>(resolve => {
        const handler = (_o: any, n: any) => {
          if (n.position.x === fPos.x && n.position.y === fPos.y && n.position.z === fPos.z) {
            rawBot.removeListener("blockUpdate", handler);
            resolve(n.name);
          }
        };
        rawBot.on("blockUpdate", handler);
        // Fallback: resolve after 600ms even if no blockUpdate arrives
        setTimeout(() => {
          rawBot.removeListener("blockUpdate", handler);
          // Re-read block from world state as fallback
          const current = rawBot.blockAt(fPos);
          resolve(current?.name ?? "unknown");
        }, 600);
      });

      // Look at the block top face and right-click it (activateBlock)
      await rawBot.lookAt(fPos.offset(0.5, 1.0, 0.5), true);
      try {
        await rawBot.activateBlock(dirtBlock);
      } catch { /* ignore — server may not send an ack */ }

      const resultName = await syncPromise;
      const tilled = resultName === "farmland";
      logFn(`[tillLand] (${fPos.x},${fPos.y},${fPos.z}): ${dirtBlock.name} → ${resultName} (tilled=${tilled})`);
      return { tilled, blockName: resultName, position: fPos };
    },

    // === applyBoneMeal — use bone_meal on a crop/sapling/grass block ===
    // Usage: await applyBoneMeal(targetBlock)
    // Equips bone_meal, sends a raw block_place packet on the target block, then
    // waits up to 500ms for a blockUpdate confirming crop growth (or resolves on timeout).
    // Returns { applied: boolean, blockNameAfter: string }
    //
    // NOTE: bot.activateBlock() with bone_meal equipped should work in principle, but
    // on some server versions the right-click packet is not sent with the held item
    // information needed for bone_meal consumption. The raw block_place packet is more
    // reliable because it explicitly encodes hand=0 (main hand with bone_meal equipped).
    applyBoneMeal: async (targetBlock: any) => {
      if (!targetBlock) throw new Error("applyBoneMeal: targetBlock is null");

      // Find and equip bone_meal
      const boneMeal = rawBot.inventory.items().find((i: any) => i.name === "bone_meal");
      if (!boneMeal) throw new Error("applyBoneMeal: no bone_meal in inventory");
      await rawBot.equip(boneMeal, "hand");

      const tPos = targetBlock.position;

      // Wait for blockUpdate (crop grows, grass spreads, etc.)
      const syncPromise = new Promise<string>(resolve => {
        const handler = (_o: any, n: any) => {
          if (n.position.x === tPos.x && n.position.y === tPos.y && n.position.z === tPos.z) {
            rawBot.removeListener("blockUpdate", handler);
            resolve(n.name);
          }
        };
        rawBot.on("blockUpdate", handler);
        setTimeout(() => {
          rawBot.removeListener("blockUpdate", handler);
          const current = rawBot.blockAt(tPos);
          resolve(current?.name ?? "unknown");
        }, 500);
      });

      // Look at the target block and send raw block_place packet (most reliable for item use)
      await rawBot.lookAt(tPos.offset(0.5, 0.5, 0.5), true);
      (rawBot as any)._client.write("block_place", {
        location: { x: tPos.x, y: tPos.y, z: tPos.z },
        direction: 1,   // top face
        hand: 0,        // main hand (bone_meal)
        cursorX: 0.5, cursorY: 1.0, cursorZ: 0.5,
        insideBlock: false,
      });

      const blockNameAfter = await syncPromise;
      const applied = blockNameAfter !== targetBlock.name;
      logFn(`[applyBoneMeal] (${tPos.x},${tPos.y},${tPos.z}): ${targetBlock.name} → ${blockNameAfter}`);
      return { applied, blockNameAfter };
    },

    // AutoSafety state (read-only from agent code)
    // Defined as a getter so agent always reads the latest live state object.
    // Without a getter, managed.safetyState would be captured as null if AutoSafety
    // had not yet assigned it at sandbox construction time (race condition on first call).
    get safetyState() { return managed.safetyState ?? null; },

    // === recipesFor wrapper ===
    // bot.recipesFor(id, null, 1, null) only returns 2x2 recipes when no table is passed.
    // This wrapper auto-finds a nearby crafting table and passes it, returning 3x3 recipes too.
    // Usage: const recipes = recipesFor(itemId)    — numeric item ID
    //        const recipes = recipesFor('bread')   — item name string also accepted
    recipesFor: (itemIdOrName: number | string, metadata: any = null, count: number = 1) => {
      // Accept item name string (e.g. 'bread') in addition to numeric ID.
      // bot.recipesFor() requires a numeric id — resolve name to id first.
      let itemId: number;
      if (typeof itemIdOrName === 'string') {
        const itemDef = (rawBot.registry?.itemsByName as any)?.[itemIdOrName];
        if (!itemDef) {
          logFn(`[recipesFor] Unknown item name: "${itemIdOrName}"`);
          return [];
        }
        itemId = itemDef.id;
      } else {
        itemId = itemIdOrName;
      }

      // First try without table (2x2 recipes)
      const recipesNoTable = rawBot.recipesFor(itemId, metadata, count, null);
      // Then try with nearby crafting table (3x3 recipes)
      const tableId = (rawBot.registry?.blocksByName as any)?.crafting_table?.id;
      const table = tableId
        ? rawBot.findBlock({ matching: tableId, maxDistance: 6 })
        : null;
      if (!table) {
        // No crafting table nearby: only 2x2 recipes available.
        // Items like bread/bucket require a crafting table (3x3 grid).
        // If recipesNoTable is empty, this is likely why — navigate to crafting table first.
        if (recipesNoTable.length === 0) {
          logFn(`[recipesFor] No recipes found for item ${itemIdOrName} and no crafting table within 6 blocks. 3x3 recipes (like bread/bucket) require a crafting table nearby.`);
        }
        return recipesNoTable;
      }
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

      // Find nearby crafting table (within 6 blocks — matches recipesFor search radius)
      const tableId = (rawBot.registry?.blocksByName as any)?.crafting_table?.id;
      const table = tableId
        ? rawBot.findBlock({ matching: tableId, maxDistance: 6 })
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
        throw new Error(
          `craftWithTable: no recipe found for "${itemName}"` +
          (table ? " (with table)" : " — no crafting table within 4 blocks. Navigate to crafting table first, then call craftWithTable.")
        );
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
              // 3000ms timeout: matches openChest for consistency on laggy servers
              setTimeout(() => {
                rawBot.removeListener("windowOpen" as any, onWindow);
                resolve();
              }, 3000);
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
      await waitFn(300);
      const resultSlot = rawBot.inventory.slots[0];
      if (resultSlot && resultSlot.count > 0) {
        try {
          await rawBot.clickWindow(0, 0, 1); // shift-click to move to inventory
          await waitFn(400);
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

    // === enchantItem — enchant an item at an enchanting table ===
    // putTargetItem()/moveSlotItem() fail with "invalid operation" because they pass
    // the raw bot inventory slot number (e.g. 42) to clickWindow(), but the enchanting
    // window only has 38 slots (0-37).  Slot 42 > inventoryEnd(38) → assert fails.
    //
    // Fix: find the item's window slot by scanning currentWindow.slots directly,
    // then call bot.clickWindow() with the window-relative slot index.
    //
    // Usage: await enchantItem(itemName, enchantChoice?)
    //   itemName:      item to enchant (e.g. "diamond_pickaxe", "iron_sword")
    //   enchantChoice: 0=cheapest, 1=medium, 2=most expensive (default 2)
    //   enchantTableBlock: optional — if omitted, finds the nearest enchanting_table
    // Returns: { enchanted: itemName, choice, level }
    enchantItem: async (itemName: string, enchantChoice: number = 2, enchantTableBlock?: any) => {
      // Step 1: Find enchanting table
      const tableId = (rawBot.registry?.blocksByName as any)?.enchanting_table?.id;
      const tableBlock = enchantTableBlock
        ?? (tableId ? rawBot.findBlock({ matching: tableId, maxDistance: 6 }) : null);
      if (!tableBlock) {
        throw new Error("enchantItem: no enchanting_table within 6 blocks. Navigate closer first.");
      }

      // Step 2: Find the item in inventory
      let itemToEnchant = rawBot.inventory.items().find((i: any) => i.name === itemName);
      if (!itemToEnchant) {
        throw new Error(`enchantItem: "${itemName}" not found in inventory`);
      }

      // Step 3: Get lapis reference (no pre-movement needed — window slot formula handles hotbar)
      const lapisItem = rawBot.inventory.items().find((i: any) => i.name === 'lapis_lazuli');

      // Step 4: Open the enchanting table
      if (rawBot.currentWindow) {
        try { rawBot.closeWindow(rawBot.currentWindow); } catch { /* ignore */ }
        await waitFn(300);
      }

      const table = await (rawBot as any).openEnchantmentTable(tableBlock);
      await waitFn(500);
      logFn(`[enchantItem] Window opened: type=${table.type}, slots=${table.slots.length}, item bot_slot=${itemToEnchant.slot}`);

      // Step 5: Place item in enchanting slot 0 using bot.clickWindow with the WINDOW slot.
      //
      // Root cause: mineflayer's putTargetItem/moveSlotItem passes the BOT inventory slot
      // (e.g. 10) directly to clickWindow. But with an enchanting table open, the window
      // has 2 extra slots (slots 0-1), so player inventory is offset:
      //   enchanting window slot = bot_inventory_slot - 7
      //   (bot slots 9-35 → window slots 2-28, bot slots 36-44 → window slots 29-37)
      //
      // clickWindow(10) with enchanting window open hits window.slots[10] = bot_slot_17 (flint),
      // not the pickaxe at bot_slot_10 = window_slot_3.
      //
      // Fix: compute the window slot and use bot.clickWindow() directly.
      const itemWindowSlot = itemToEnchant.slot - 7;
      logFn(`[enchantItem] Moving item from window_slot=${itemWindowSlot} to slot 0`);

      // Verify the window slot contains our item
      const slotContent = table.slots[itemWindowSlot];
      if (!slotContent || slotContent.type !== itemToEnchant.type) {
        // Fallback: scan table.slots for the item
        let foundSlot = -1;
        for (let s = 2; s < table.slots.length; s++) {
          if (table.slots[s]?.type === itemToEnchant.type) { foundSlot = s; break; }
        }
        if (foundSlot !== -1) {
          logFn(`[enchantItem] Formula failed, scan found item at window_slot=${foundSlot}`);
          await (rawBot as any).clickWindow(foundSlot, 0, 0);
        } else {
          table.close();
          throw new Error(`enchantItem: could not find ${itemName} in enchanting window (bot_slot=${itemToEnchant.slot})`);
        }
      } else {
        await (rawBot as any).clickWindow(itemWindowSlot, 0, 0);
      }
      // Place it in slot 0
      await waitFn(300);
      await (rawBot as any).clickWindow(0, 0, 0);
      await waitFn(500);
      logFn(`[enchantItem] Item placed: slot[0]=${table.slots[0]?.name ?? 'null'}`);

      // Step 5b: Place lapis in slot 1
      if (lapisItem) {
        const lapisWindowSlot = lapisItem.slot - 7;
        const lapisSlotContent = table.slots[lapisWindowSlot];
        if (!lapisSlotContent || lapisSlotContent.type !== lapisItem.type) {
          let foundSlot = -1;
          for (let s = 2; s < table.slots.length; s++) {
            if (table.slots[s]?.type === lapisItem.type) { foundSlot = s; break; }
          }
          if (foundSlot !== -1) {
            logFn(`[enchantItem] Lapis scan found at window_slot=${foundSlot}`);
            await (rawBot as any).clickWindow(foundSlot, 0, 0);
          }
        } else {
          await (rawBot as any).clickWindow(lapisWindowSlot, 0, 0);
        }
        await waitFn(300);
        await (rawBot as any).clickWindow(1, 0, 0);
        await waitFn(500);
        logFn(`[enchantItem] Lapis placed: slot[1]=${table.slots[1]?.name ?? 'null'}`);
      } else {
        logFn(`[enchantItem] Warning: no lapis_lazuli in inventory — enchantments may not appear`);
      }

      // Wait for server to send enchantment options (craft_progress_bar packets)
      await waitFn(2000);

      // Step 6: Check if enchantment options are available
      const enchants = table.enchantments;
      logFn(`[enchantItem] Enchantments: ${JSON.stringify(enchants)}`);

      const allNegative = enchants.every((e: any) => e.level < 0);
      if (allNegative) {
        // Item may not be in slot yet — wait a bit more
        await waitFn(1500);
        logFn(`[enchantItem] Enchantments after extra wait: ${JSON.stringify(table.enchantments)}`);
      }

      // Step 7: Apply enchantment
      const choice = Math.min(Math.max(0, enchantChoice), 2);
      const chosenEnchant = table.enchantments[choice];
      if (!chosenEnchant || chosenEnchant.level <= 0) {
        // Try to find any available slot
        const availableChoice = table.enchantments.findIndex((e: any) => e.level > 0);
        if (availableChoice === -1) {
          table.close();
          throw new Error(
            `enchantItem: no enchantment options available. ` +
            `Check: 1) XP level >= 3 for slot 0, 2) lapis lazuli in inventory, ` +
            `3) bookshelves may boost max level. Enchantments: ${JSON.stringify(table.enchantments)}`
          );
        }
        logFn(`[enchantItem] Choice ${choice} not available (level=${chosenEnchant?.level}), using choice ${availableChoice}`);
        const result = await table.enchant(availableChoice);
        table.close();
        logFn(`[enchantItem] Enchanted ${itemName} with choice ${availableChoice}, level=${table.enchantments[availableChoice]?.level}`);
        return { enchanted: itemName, choice: availableChoice, level: table.enchantments[availableChoice]?.level ?? -1 };
      }

      const result = await table.enchant(choice);
      table.close();
      logFn(`[enchantItem] Enchanted ${itemName} with choice ${choice}, level=${chosenEnchant.level}`);
      return { enchanted: itemName, choice, level: chosenEnchant.level };
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
            // 3000ms timeout: enough for laggy servers (was 1500ms, increased for reliability)
            setTimeout(() => {
              rawBot.removeListener("windowOpen" as any, onWindow);
              resolve();
            }, 3000);
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
            await gotoWithStuckDetection(
              new goals.GoalBlock(portalBlock.position.x, portalBlock.position.y, portalBlock.position.z),
              8000,
              false
            );
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
          sandboxClearInterval(pollId);
          sandboxClearTimeout(timeoutId);
          resolve(dim);
        };

        const onRespawn = () => {
          const dim = (rawBot.game as any)?.dimension ?? (rawBot as any).dimension ?? "unknown";
          done(dim);
        };
        rawBot.on("respawn" as any, onRespawn);

        // Fallback poll: check if dimension changed every 500ms
        // Use sandboxSetInterval/sandboxSetTimeout so these timers are cleaned up if
        // mc_execute times out before the portal transfer completes.  Without this,
        // zombie timers from a timed-out enterPortal() call would keep running in the
        // background and trigger spurious "dimension changed" detections in subsequent
        // mc_execute calls.
        const pollId = sandboxSetInterval(() => {
          const current = (rawBot.game as any)?.dimension ?? (rawBot as any).dimension ?? "unknown";
          if (current !== dimensionBefore) {
            done(current);
          }
        }, 500);

        const timeoutId = sandboxSetTimeout(() => done(null), timeoutMs);
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
