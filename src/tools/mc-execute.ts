/**
 * mc_execute - Code Execution
 *
 * Agents write raw mineflayer JavaScript.
 * Exposed: bot (raw mineflayer), Movements, goals, Vec3, log(), wait(), getMessages()
 */

import { botManager } from "../bot-manager/index.js";
import { currentBotContext } from "../bot-manager/bot-core.js";
import { getSurroundings } from "../bot-manager/bot-info.js";
import * as pathfinderPkg from "mineflayer-pathfinder";
import { Vec3 } from "vec3";

// mineflayer-pathfinder is CJS: Movements is a named ESM export but goals is only on default
const { Movements } = pathfinderPkg;
const goals = (pathfinderPkg as any).default?.goals ?? (pathfinderPkg as any).goals;

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

  const ctx: Record<string, unknown> = {
    bot: rawBot,
    Movements,
    goals,
    Vec3,
    // Utilities
    log: logFn,
    wait: waitFn,
    getMessages: getMessagesFn,
    // Pathfinder timeout wrapper utility (usage: await pathfinderGoto(goal, 30000))
    pathfinderGoto: (goal: any, timeoutMs = 30000) => {
      const gotoPromise = (rawBot.pathfinder.goto as any)(goal);
      return Promise.race([
        gotoPromise,
        new Promise<void>((_resolve, reject) =>
          setTimeout(() => reject(new Error(`Pathfinder timeout after ${timeoutMs}ms`)), timeoutMs)
        )
      ]);
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
        const gotoPromise = (rawBot.pathfinder.goto as any)(new goals.GoalXZ(targetX, targetZ));
        return Promise.race([
          gotoPromise,
          new Promise<void>((_resolve, reject) =>
            setTimeout(() => reject(new Error(`Pathfinder timeout after 20000ms`)), 20000)
          )
        ]);
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

        const gotoPromise = (rawBot.pathfinder.goto as any)(new goals.GoalXZ(wpX, wpZ));
        try {
          await Promise.race([
            gotoPromise,
            new Promise<void>((_resolve, reject) =>
              setTimeout(() => reject(new Error(`Pathfinder timeout after 20000ms`)), 20000)
            )
          ]);
        } catch (e) {
          logFn(`Stage ${i} failed: ${String(e).substring(0, 60)}`);
          throw e;
        }
      }
    },
    // === Meta-cognition layer: observe → understand → act ===
    // awareness() — self-state + spatial snapshot (call before any action)
    awareness: () => {
      return getSurroundings(rawBot);
    },
    // scanTerrain(radius?) — 2D height map for terrain diff / leveling
    // Returns { heightMap, stats } where heightMap[dx][dz] = topSolidY
    scanTerrain: (radius: number = 8) => {
      const r = Math.min(radius, 16);
      const pos = rawBot.entity.position;
      const cx = Math.floor(pos.x);
      const cz = Math.floor(pos.z);
      const baseY = Math.floor(pos.y);

      const heights: Record<string, number> = {};
      let minY = 999, maxY = -999;
      let totalY = 0, count = 0;

      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          // Scan downward from bot+10 to find top solid block
          let topY = baseY - 1;
          for (let dy = 10; dy >= -20; dy--) {
            const block = rawBot.blockAt(new Vec3(cx + dx, baseY + dy, cz + dz));
            if (block && block.name !== "air" && block.name !== "water" &&
                block.name !== "lava" && block.name !== "cave_air") {
              topY = baseY + dy;
              break;
            }
          }
          heights[`${dx},${dz}`] = topY;
          if (topY < minY) minY = topY;
          if (topY > maxY) maxY = topY;
          totalY += topY;
          count++;
        }
      }

      const avgY = Math.round(totalY / count);

      // Generate text grid (compact height diff from average)
      const lines: string[] = [];
      lines.push(`## 地形スキャン (${2*r+1}x${2*r+1}, 中心: ${cx},${baseY},${cz})`);
      lines.push(`平均Y: ${avgY}, 最低: ${minY}, 最高: ${maxY}, 高低差: ${maxY - minY}`);
      lines.push(``);

      // Visual grid: show height diff from avgY
      lines.push(`高さマップ (数字 = Y - ${avgY}, . = 平坦, + = 高い, - = 低い):`);
      const header = "   " + Array.from({length: 2*r+1}, (_, i) => {
        const dz = i - r;
        return (dz % 4 === 0) ? String(dz).padStart(2) : "  ";
      }).join("");
      lines.push(header);

      for (let dx = -r; dx <= r; dx++) {
        if (dx % 2 !== 0 && r > 4) continue; // skip rows for readability in large scans
        let row = String(dx).padStart(3) + " ";
        for (let dz = -r; dz <= r; dz++) {
          const y = heights[`${dx},${dz}`];
          const diff = y - avgY;
          if (diff === 0) row += ". ";
          else if (diff > 0 && diff <= 3) row += `${diff} `;
          else if (diff > 3) row += "# ";
          else if (diff < 0 && diff >= -3) row += `${diff}`;
          else row += "v ";
        }
        lines.push(row);
      }

      // Dig/fill summary for leveling to avgY
      let toDig = 0, toFill = 0;
      for (const [, y] of Object.entries(heights)) {
        if (y > avgY) toDig += (y - avgY);
        if (y < avgY) toFill += (avgY - y);
      }
      lines.push(``);
      lines.push(`整地 (Y=${avgY}に平坦化): 掘る${toDig}ブロック, 埋める${toFill}ブロック`);

      return lines.join("\n");
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
    setTimeout, setInterval, clearTimeout, clearInterval,
  };

  const keys = Object.keys(ctx);
  const values = Object.values(ctx);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;
  const fn = new AsyncFunction(...keys, `\n${code}\n`);

  console.error(`[mc_execute] Executing code (${code.length} chars, timeout: ${effectiveTimeout}ms)`);

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

    const parts = [`Error: ${errorMessage}`];
    if (logs.length > 0) parts.push(`Logs before error:\n${logs.join("\n")}`);
    parts.push(`Failed after ${elapsed}ms`);
    console.error(`[mc_execute] Error: ${errorMessage}`);
    return parts.join("\n\n");
  }
}
